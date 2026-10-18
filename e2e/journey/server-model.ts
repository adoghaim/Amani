import { randomUUID } from 'node:crypto';
import { readInterpretation } from '../../supabase/functions/_shared/interpretation-read';
import { resolveEntitlement, isOnboarded } from '../../supabase/functions/_shared/entitlement';
import { decideIntroductoryAccess, commitGeneratedInterpretation, type ClaimRecord, type IntroductoryAccessActions } from '../../supabase/functions/_shared/introductory-access';
import { shapeInterpretation, findFloorViolations, type InterpretationPayload } from '../../supabase/functions/_shared/response-shaping';
import { withClaimAuthority, projectBasic, servedBasic, visibleClaimProjection } from '../../supabase/functions/_shared/claim-authority';
import { buildTrendEvidence } from '../../supabase/functions/_shared/trend-evidence';
import { decideDeepGeneration } from '../../supabase/functions/_shared/regeneration-availability';
import { generationVisibilityMode } from '../../supabase/functions/_shared/entitlement-response';
import { resolveTier } from '../../supabase/functions/_shared/tier';
import { createConsentGate, consentRefusal } from '../../supabase/functions/_shared/consent';
import { enforceRateLimit, isRateLimitExceeded } from '../../supabase/functions/_shared/rate-limit';
import { logServerEvent, type ServerEventInput } from '../../supabase/functions/_shared/app-events';
import { USER_DATA_REGISTRY } from '../../supabase/functions/_shared/user-data-registry';
import { deleteUserAccount, deleteUserDataTables, checkUserDataTablesReady, AccountDeletionNotReadyError, StoreSubscriptionAcknowledgementRequiredError } from '../../supabase/functions/_shared/account-deletion';
import {
  isVersionable, versionIdentity, regenerationFailedResponse, REQUEST_ID_REQUIRED, type StoredVersion,
} from '../../supabase/functions/_shared/interpretation-version-write';
import type { FakeSupabase, Row } from './fake-supabase';

/*
  PK-03e-I: the Edge Function answers for the fresh-user journey, computed by the
  REAL pure server modules in supabase/functions/_shared over the stand-in's
  rows. The Deno handlers are thin wiring around exactly these modules; what is
  modelled here is only their I/O (which rows a query returns):

  - get-interpretation  -> readInterpretation + resolveEntitlement, readSelected
    mirroring read_interpretation_for_server (premium or claim -> json_output,
    else json_output_basic; the selected version's identity when one exists);
  - generate-interpretation -> resolveEntitlement, decideIntroductoryAccess,
    buildTrendEvidence (prior report by report_date, as loadGenerationContext),
    shapeInterpretation, withClaimAuthority, projectBasic, isVersionable and
    versionIdentity; a regeneration of an anchored report appends a version and
    needs a request_id, exactly like the handler;
  - delete-user-data -> deleteUserAccount with actions over the stand-in.

  The OpenAI call is the one thing no module can supply. The model proposal is
  a synthetic body whose every free-text field is MODEL_CANARY, so a test can
  prove the client renders only server-authorized content and never the model's
  unauthorized prose. No clinical content is authored here: values, units and
  printed intervals come from the synthetic lab fixtures.
*/

export const MODEL_CANARY = 'PK03EI model canary: unauthorized model prose that must never render';

interface Anchor {
  id: string; generated_at: string; full: InterpretationPayload; basic: InterpretationPayload;
  source: 'ai' | 'fallback'; depth: 'deep' | 'standard'; tier: string;
}
interface Thread { anchor: Anchor; versions: StoredVersion[] }

/** Same rule as classifyAnalyte in generate-interpretation/index.ts. */
function classify(a: Row): 'in_range' | 'borderline' | 'out_of_range' | 'unknown' {
  const v = Number(a.value_numeric);
  if (a.normalized_min != null && a.normalized_max != null) {
    const min = Number(a.normalized_min), max = Number(a.normalized_max);
    const buf = (max - min) * 0.08;
    if (v < min - buf || v > max + buf) return 'out_of_range';
    if (v < min || v > max) return 'borderline';
    return 'in_range';
  }
  return 'unknown';
}
const slug = (a: Row) => (a.canonical_slug as string | null) ?? String(a.raw_name).toLowerCase().replace(/\s+/g, '_');

export class ServerModel {
  // Production pin: FREEMIUM_ACTIVE=true, visibility=true, post-limit UNSET.
  // Owner Ruling 9 activation record, 2026-10-16 (control repo).
  visibilityEnabled = true;
  aiPaused = false;
  private failModel = false;
  readonly deletionSteps: string[] = [];
  private readonly requests = new Map<string, StoredVersion>();
  failNextModelCall() { this.failModel = true; }

  private async event(input: ServerEventInput) {
    await logServerEvent({ insertEvent: async row => { this.db.tables.app_events.push({ ...row }); } }, input);
  }

  private async rate(uid: string, endpoint: string, limitPerDay: number) {
    await enforceRateLimit({ incrementAndGet: async ({ userId, endpoint, windowStart }) => {
      let row = this.db.tables.rate_limits.find(r => r.user_id === userId && r.endpoint === endpoint && r.window_start === windowStart);
      if (!row) {
        row = { user_id: userId, endpoint, window_start: windowStart, count: 0 };
        this.db.tables.rate_limits.push(row);
      }
      row.count = (row.count ?? 0) + 1;
      return { data: row.count, error: null };
    } }, { userId: uid, endpoint, limitPerDay });
  }

  private async guarded(uid: string, endpoint: string, limit: number, action: () => Promise<{status: number; body: unknown}>) {
    try {
      // consent_gate and every other feature stay off. Unexpected activation
      // is outside this fixture, not permission to synthesize consent.
      const features = this.db.tables.app_public_config.find(r => r.key === 'features')?.value as Row;
      if (Object.values(features).some(Boolean)) throw new Error('unmodelled: feature flag on');
      const gate = createConsentGate({ readPublicConfig: async () => this.db.tables.app_public_config,
        readCurrentConsents: async () => { throw new Error('unmodelled: consent on'); }, now: Date.now });
      if (endpoint !== 'get-interpretation') {
        const refused = consentRefusal(await gate.check(uid));
        if (refused) return refused;
      }
      await this.rate(uid, endpoint, limit);
      return await action();
    } catch (error) {
      if (isRateLimitExceeded(error)) return { status: 429, body: { error: 'Rate limit reached. Please try again tomorrow.' } };
      throw error;
    }
  }

  readonly threads = new Map<string, Thread>();
  /** Every generate-interpretation body received, in order. */
  readonly generateRequests: Row[] = [];
  /** Base64 data URL -> the OCR function's `items` for that image. */
  readonly ocr = new Map<string, Row[]>();

  constructor(private readonly db: FakeSupabase) {
    db.functions = {
      'parse-lab-report-ocr': async (uid, body) => this.guarded(uid, 'parse-lab-report-ocr', 20, async () => this.parse(body)),
      'generate-interpretation': async (uid, body) => this.guarded(uid, 'generate-interpretation', 20, () => this.generate(uid, body)),
      'get-interpretation': async (uid, body) => this.guarded(uid, 'get-interpretation', 600, () => this.read(uid, body)),
      'delete-user-data': async (uid, body) => this.erase(uid, body),
    };
    db.views.interpretations = uid => this.compatibleView(uid);
  }

  /** Stands in for stripe-webhook having written an active subscription. */
  grantStripeSubscription(userId: string) {
    const customerId = `cus_synthetic_${userId.slice(0, 8)}`;
    this.db.tables.stripe_customers.push({ user_id: userId, customer_id: customerId });
    this.db.tables.stripe_subscriptions.push({ customer_id: customerId,
      subscription_id: `sub_synthetic_${userId.slice(0, 8)}`, status: 'active', price_id: 'price_synthetic',
      current_period_end: Math.floor(Date.now() / 1000) + 30 * 86400 });
  }

  private entitlement(uid: string) {
    const user = this.db.tables.users.find(r => r.id === uid);
    const customer = this.db.tables.stripe_customers.find(r => r.user_id === uid);
    const stripe = this.db.tables.stripe_subscriptions.find(r => customer && r.customer_id === customer.customer_id);
    return resolveEntitlement({
      freemiumActive: true, onboarded: isOnboarded(user), stripeStatus: (stripe?.status as string) ?? null,
      iapRecords: [], trialStartDate: (user?.trial_start_date as string) ?? null, now: Date.now(), userId: uid,
      betaTester: null, complimentary: null,
    });
  }

  private claims(uid: string) {
    return this.db.tables.introductory_deep_access_claims.filter(r => r.user_id === uid) as unknown as ClaimRecord[];
  }

  private hasClaim(uid: string, reportId: string) {
    return this.claims(uid).some(c => c.report_id === reportId);
  }

  private parse(body: Row) {
    const images = body.base64Images as string[] | undefined;
    const items = images?.length === 1 ? this.ocr.get(images[0]) : undefined;
    // An image this stand-in was not given is a test bug, never a guess.
    if (!items) throw new Error('unmodelled: OCR image');
    return { status: 200, body: { items, metadata: { cycle_day: null, cycle_phase: null }, _source_format: 'ocr', _parser_version: 'v2_vision_fallback' } };
  }

  private async generate(uid: string, body: Row) {
    this.generateRequests.push(body);
    const reportId = body.reportId as string;
    const report = this.db.tables.lab_reports.find(r => r.id === reportId);
    if (!report) return { status: 404, body: { error: 'Report not found' } };
    if (report.user_id !== uid) return { status: 403, body: { error: 'Forbidden' } };
    const thread = this.threads.get(reportId);
    const requestId = typeof body.request_id === 'string' ? body.request_id : null;
    if (thread && !requestId) return { status: 400, body: { error: REQUEST_ID_REQUIRED } };

    // generate-interpretation/index.ts:1753-1801: switch, tier, request reuse.
    if (!this.visibilityEnabled) throw new Error('unmodelled: visibility switch off');
    const entitlement = this.entitlement(uid);
    await generationVisibilityMode({ active: true, entitlement, readEnabled: async () => this.visibilityEnabled, warn: () => { throw new Error('unmodelled: visibility switch off'); } });
    const tierDecision = resolveTier({ entitlement, freemiumActive: true });
    if (tierDecision.gate.gate === 'block') return { status: 402, body: { error: 'subscription_required', reason: tierDecision.gate.reason } };
    const tier = tierDecision.tier;
    const reused = requestId ? this.requests.get(`${reportId}:${requestId}`) : undefined;
    if (thread && reused) {
      report.status = 'ready';
      const full = tier === 'plus' || this.hasClaim(uid, reportId);
      return { status: 200, body: { success: true, source: 'ai', reused: true,
        access: full ? 'full' : 'basic', interpretation: full ? reused.full : servedBasic(reused.basic),
        ...visibleClaimProjection(reused.basic), ...versionIdentity(reused) } };
    }

    const analytes = this.db.tables.report_analytes.filter(r => r.lab_report_id === reportId);
    const prior = this.db.tables.lab_reports
      .filter(r => r.user_id === uid && r.id !== reportId && String(r.report_date) < String(report.report_date))
      .sort((a, b) => String(b.report_date).localeCompare(String(a.report_date)))[0];
    const priorAnalytes = prior ? this.db.tables.report_analytes.filter(r => r.lab_report_id === prior.id) : [];
    const values = (rows: Row[]) => rows.map(a => ({ slug: slug(a), name: String(a.raw_name), value: a.value_numeric, unit: a.unit as string | null }));
    const trendEvidence = buildTrendEvidence(values(analytes), values(priorAnalytes), (prior?.report_date as string) ?? null);

    let ledgerLimitReached = false;
    const introActions: IntroductoryAccessActions = {
      findClaim: async (userId, drawId) => this.claims(userId).find(c => c.blood_draw_id === drawId) ?? null,
      countClaims: async userId => this.claims(userId).length,
      commitDeepAccess: async input => {
        if (this.claims(uid).some(c => c.blood_draw_id === input.bloodDrawId)) return 'already_claimed';
        if (input.consumeCredit && this.claims(uid).length >= 3) {
          ledgerLimitReached = true;
          return 'limit_reached';
        }
        if (input.consumeCredit) this.db.tables.introductory_deep_access_claims.push({
          user_id: uid, report_id: reportId, blood_draw_id: input.bloodDrawId,
          evidence_tier: input.evidenceTier, claimed_at: new Date().toISOString(),
        });
        return 'committed';
      },
    };
    // Distinct synthetic images: report identity substitutes for the handler's
    // storage SHA-256 draw identity; upload/re-upload deduplication is unmodelled.
    const decision = tier === 'free' ? await decideIntroductoryAccess(introActions,
      { tier, userId: uid, bloodDrawId: `synthetic-draw:${reportId}` }) : null;
    const generateDeep = decideDeepGeneration({ freemiumActive: true, tier, decision, postLimitGeneration: undefined });
    if (this.aiPaused) throw new Error('unmodelled: AI pause');
    const modelReturned = generateDeep && analytes.length > 0 && !this.failModel;
    this.failModel = false;

    const shaped = shapeInterpretation({
      tier, deepAccessGranted: generateDeep,
      aiInterpretation: modelReturned ? {
        headline: MODEL_CANARY, overall_interpretation: MODEL_CANARY, summary_bullets: [MODEL_CANARY],
        pattern_signals: [{ title: MODEL_CANARY, explanation: MODEL_CANARY, confidence: 'high' }],
        key_findings: [], questions_for_doctor: [],
        // The handler replaces phase/day/confidence with the report's own facts.
        cycle_context: { estimated_cycle_day: null, estimated_cycle_phase: 'unknown', confidence: 'low', explanation: '' },
        disclaimer: 'Synthetic fixture. Not medical advice.',
      } : null,
      // The handler's no-lab-data floor shape; generateFallbackInterpretation's
      // clinical prose lives in the Deno handler and is not reproduced here.
      deterministicInterpretation: () => ({
        headline: 'Synthetic deterministic summary', summary_bullets: [], top_findings: [], pattern_signals: [],
        cycle_context: { estimated_cycle_day: null, estimated_cycle_phase: 'unknown', confidence: 'low', explanation: '' },
        questions_for_doctor: [], disclaimer: 'Synthetic fixture. Not medical advice.',
      }),
    });
    const full = withClaimAuthority(shaped.payload, {
      source: shaped.source, trendEvidence,
      statuses: analytes.map(a => ({ biomarker_slug: slug(a), marker: String(a.raw_name),
        value: Number(a.value_numeric), unit: String(a.unit ?? ''), status: classify(a) })),
    });
    const basic = projectBasic(full, { source: shaped.source });
    const floorViolations = findFloorViolations(full);
    const now = new Date().toISOString();
    // generate-interpretation/index.ts:1945-1997: refuse before ledger writes.
    if (thread && !isVersionable({ source: shaped.source, depth: shaped.depth, floorViolations })) {
      return regenerationFailedResponse(generateDeep);
    }
    if (tier === 'free') {
      const committed = await commitGeneratedInterpretation(introActions, {
        freemiumActive: true, tier, decision,
        completion: { parseConfident: analytes.length > 0, interpretationGenerated: modelReturned },
        request: { userId: uid, reportId, bloodDrawId: `synthetic-draw:${reportId}`, evidenceTier: 'unidentified', interpretation: full },
      });
      shaped.tier = committed.tier;
    }

    if (thread && ledgerLimitReached) return regenerationFailedResponse(true);
    let identity: Record<string, unknown> = {};
    if (thread) {
      const version: StoredVersion = { versionId: randomUUID(), historicalInterpretationId: thread.anchor.id,
        generatedAt: now, full, basic };
      thread.versions.push(version);
      this.requests.set(`${reportId}:${requestId}`, version);
      identity = { reused: false, ...versionIdentity(version) };
    } else {
      this.threads.set(reportId, { versions: [], anchor: { id: randomUUID(), generated_at: now, full, basic,
        source: shaped.source, depth: shaped.depth, tier: shaped.tier } });
    }
    report.status = 'ready';
    await this.event({ event: 'interpretation_generated', userId: uid, props: { tier: shaped.tier } });
    const plus = shaped.tier === 'plus';
    return { status: 200, body: { success: true, source: shaped.source, access: plus ? 'full' : 'basic',
      interpretation: plus ? full : servedBasic(basic), ...visibleClaimProjection(basic), ...identity } };
  }

  /** read_interpretation_for_server: one projection, the selected version's identity. */
  private selected(uid: string, reportId: string, premium: boolean) {
    const thread = this.threads.get(reportId);
    if (!thread) return null;
    const version = thread.versions.at(-1);
    const covered = this.hasClaim(uid, reportId);
    const full = version ? version.full : thread.anchor.full;
    const basic = version ? version.basic : thread.anchor.basic;
    return {
      json_output: premium || covered ? full : basic, stored_depth: version ? 'deep' : thread.anchor.depth,
      has_claim: covered, tier: version ? 'plus' : thread.anchor.tier,
      interpretation_source: version ? 'ai' : thread.anchor.source,
      historical_interpretation_id: version ? thread.anchor.id : null,
      selected_version_id: version?.versionId ?? null, selected_generated_at: version?.generatedAt ?? null,
    };
  }

  private async read(uid: string, body: Row) {
    const reportId = body.reportId as string;
    return readInterpretation({
      postLimitGeneration: undefined,
      ownsReport: async () => this.db.tables.lab_reports.some(r => r.id === reportId && r.user_id === uid),
      resolveEntitlement: async () => this.entitlement(uid),
      readSelected: async premium => this.selected(uid, reportId, premium),
      countClaims: async () => this.claims(uid).length,
    }, true);
  }

  /** read_compatible_interpretations: full only for a claim or Premium reader. */
  private compatibleView(uid: string): Row[] {
    const premium = this.entitlement(uid).plan === 'premium';
    return this.db.tables.lab_reports.filter(r => r.user_id === uid && this.threads.has(String(r.id))).map(r => {
      const thread = this.threads.get(String(r.id))!;
      const version = thread.versions.at(-1);
      const full = premium || this.hasClaim(uid, String(r.id));
      return { id: version?.versionId ?? thread.anchor.id, lab_report_id: r.id,
        json_output: full ? (version ?? thread.anchor).full : (version ?? thread.anchor).basic,
        generated_at: version?.generatedAt ?? thread.anchor.generated_at, disclaimer_version: '1.0',
        interpretation_source: version ? 'ai' : thread.anchor.source, tier: version ? 'plus' : thread.anchor.tier };
    });
  }

  private async erase(uid: string, body: Row) {
    const db = this.db;
    try {
      // delete-user-data/index.ts:238-247. External billing APIs are recorded
      // no-ops (store-teardown.ts is Deno-only); real local deletion policy runs.
      await deleteUserAccount({
        checkDataTablesReady: () => checkUserDataTablesReady(async table => {
          if (!Array.isArray(db.tables[table])) throw new Error(`unmodelled: deletion table ${table}`);
        }),
        listStoreSubscriptions: async userId => db.tables.iap_subscriptions.filter(r => r.user_id === userId).map(row => {
          const { platform, product_id, store_subscription_id, status, expires_at, environment } = row;
          if (typeof platform !== 'string' || typeof product_id !== 'string' || typeof store_subscription_id !== 'string'
            || typeof status !== 'string' || typeof environment !== 'string' || (expires_at !== null && typeof expires_at !== 'string')) {
            throw new Error('unmodelled: malformed store subscription');
          }
          return { platform, product_id, store_subscription_id, status, expires_at, environment };
        }),
        cancelPlaySubscriptions: async () => { this.deletionSteps.push('cancelPlaySubscriptions'); },
        getStripeCustomerId: async userId => db.tables.stripe_customers.find(r => r.user_id === userId)?.customer_id
          ?? db.tables.users.find(r => r.id === userId)?.stripe_customer_id ?? null,
        cancelStripeSubscriptions: async () => { this.deletionSteps.push('cancelStripeSubscriptions'); },
        deleteStripeCustomer: async () => { this.deletionSteps.push('deleteStripeCustomer'); },
        deleteLocalStripeRecords: async (userId, customerId) => {
          this.deletionSteps.push('deleteLocalStripeRecords');
          db.tables.stripe_customers = db.tables.stripe_customers.filter(r => r.user_id !== userId);
          db.tables.stripe_subscriptions = db.tables.stripe_subscriptions.filter(r => r.customer_id !== customerId);
          db.tables.stripe_orders = db.tables.stripe_orders.filter(r => r.customer_id !== customerId);
        },
        deleteStorageFiles: async userId => { for (const path of [...db.storage.keys()]) if (path.startsWith(`${userId}/`)) db.storage.delete(path); },
        deleteDataTables: userId => deleteUserDataTables({
          listReportIds: async id => db.tables.lab_reports.filter(r => r.user_id === id).map(r => String(r.id)),
          eraseReports: async ids => {
            for (const id of ids) {
              this.threads.delete(id);
              for (const key of this.requests.keys()) if (key.startsWith(`${id}:`)) this.requests.delete(key);
            }
            for (const entry of USER_DATA_REGISTRY.filter(e => e.mechanism === 'erase_reports_cascade')) {
              // Interpretation graph is represented by threads + request index.
              if (['interpretations', 'interpretation_versions', 'interpretation_current_versions', 'interpretation_history_protection'].includes(entry.table)) continue;
              const rows = db.tables[entry.table];
              if (!rows) throw new Error(`unmodelled: report cascade ${entry.table}`);
              db.tables[entry.table] = rows.filter(r => !ids.includes(String(r.lab_report_id)));
            }
            db.tables.lab_reports = db.tables.lab_reports.filter(r => !ids.includes(String(r.id)));
            for (const claim of db.tables.introductory_deep_access_claims) if (ids.includes(String(claim.report_id))) claim.report_id = null;
          },
          deleteOwnedRows: async (table, column, id) => {
            if (!db.tables[table]) throw new Error(`unmodelled: deletion table ${table}`);
            this.deletionSteps.push(`delete:${table}`);
            db.tables[table] = db.tables[table].filter(r => r[column] !== id);
          },
        }, userId, USER_DATA_REGISTRY),
        deleteRevenueCatSubscriber: async () => { this.deletionSteps.push('deleteRevenueCatSubscriber'); },
        deleteAuthUser: async userId => { this.deletionSteps.push('deleteAuthUser'); db.deleteAuthUser(userId); },
      }, uid, { acknowledgedStoreSubscriptions: body.acknowledge_store_subscriptions === true });
      await this.event({ event: 'account_deleted', userId: null });
      this.deletionSteps.push('account_deleted');
      return { status: 200, body: { success: true } };
    } catch (error) {
      if (error instanceof AccountDeletionNotReadyError) return { status: 503, body: { error: error.message, code: error.code } };
      if (error instanceof StoreSubscriptionAcknowledgementRequiredError) return { status: 409, body: { error: error.message, code: error.code, subscriptions: error.subscriptions } };
      throw error;
    }
  }
}
