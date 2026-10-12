import { randomUUID } from 'node:crypto';
import { readInterpretation } from '../../supabase/functions/_shared/interpretation-read';
import { resolveEntitlement, isOnboarded } from '../../supabase/functions/_shared/entitlement';
import { decideIntroductoryAccess, type ClaimRecord } from '../../supabase/functions/_shared/introductory-access';
import { shapeInterpretation, findFloorViolations, type InterpretationPayload } from '../../supabase/functions/_shared/response-shaping';
import { withClaimAuthority, projectBasic, servedBasic, visibleClaimProjection } from '../../supabase/functions/_shared/claim-authority';
import { buildTrendEvidence } from '../../supabase/functions/_shared/trend-evidence';
import { deleteUserAccount } from '../../supabase/functions/_shared/account-deletion';
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
  readonly threads = new Map<string, Thread>();
  /** Every generate-interpretation body received, in order. */
  readonly generateRequests: Row[] = [];
  /** Base64 data URL -> the OCR function's `items` for that image. */
  readonly ocr = new Map<string, Row[]>();

  constructor(private readonly db: FakeSupabase) {
    db.functions = {
      'parse-lab-report-ocr': async (_uid, body) => this.parse(body),
      'generate-interpretation': async (uid, body) => this.generate(uid, body),
      'get-interpretation': async (uid, body) => this.read(uid, body),
      'delete-user-data': async (uid, body) => this.erase(uid, body),
    };
    db.views.interpretations = uid => this.compatibleView(uid);
  }

  /** Stands in for stripe-webhook having written an active subscription. */
  grantStripeSubscription(userId: string) {
    this.db.tables.stripe_subscriptions.push({ user_id: userId, customer_id: `cus_synthetic_${userId.slice(0, 8)}`,
      subscription_id: `sub_synthetic_${userId.slice(0, 8)}`, status: 'active', price_id: 'price_synthetic',
      current_period_end: Math.floor(Date.now() / 1000) + 30 * 86400 });
  }

  private entitlement(uid: string) {
    const user = this.db.tables.users.find(r => r.id === uid);
    const stripe = this.db.tables.stripe_subscriptions.find(r => r.user_id === uid);
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
    if (!items) return { status: 500, body: { error: 'synthetic OCR fixture not registered' } };
    return { status: 200, body: { items, metadata: { cycle_day: null, cycle_phase: null } } };
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

    const entitlement = this.entitlement(uid);
    if (!entitlement.allowed) return { status: 402, body: { error: 'subscription_required', reason: entitlement.reason } };
    const tier = entitlement.plan === 'premium' ? 'plus' as const : 'free' as const;

    const analytes = this.db.tables.report_analytes.filter(r => r.lab_report_id === reportId);
    const prior = this.db.tables.lab_reports
      .filter(r => r.user_id === uid && r.id !== reportId && String(r.report_date) < String(report.report_date))
      .sort((a, b) => String(b.report_date).localeCompare(String(a.report_date)))[0];
    const priorAnalytes = prior ? this.db.tables.report_analytes.filter(r => r.lab_report_id === prior.id) : [];
    const values = (rows: Row[]) => rows.map(a => ({ slug: slug(a), name: String(a.raw_name), value: a.value_numeric, unit: a.unit as string | null }));
    const trendEvidence = buildTrendEvidence(values(analytes), values(priorAnalytes), (prior?.report_date as string) ?? null);

    const decision = await decideIntroductoryAccess({
      findClaim: async (userId, drawId) => this.claims(userId).find(c => c.blood_draw_id === drawId || c.report_id === reportId) ?? null,
      countClaims: async userId => this.claims(userId).length,
      commitDeepAccess: async () => { throw new Error('committed below'); },
    }, { tier, userId: uid, bloodDrawId: `synthetic-draw:${reportId}` });

    const shaped = shapeInterpretation({
      tier, deepAccessGranted: decision.granted,
      aiInterpretation: decision.granted ? {
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
    if (decision.granted && decision.consumesCredit) {
      this.db.tables.introductory_deep_access_claims.push({ id: randomUUID(), user_id: uid, report_id: reportId,
        blood_draw_id: `synthetic-draw:${reportId}`, evidence_tier: 'synthetic', claimed_at: now });
    }

    let identity: Record<string, unknown> = {};
    if (thread) {
      if (!isVersionable({ source: shaped.source, depth: shaped.depth, floorViolations })) {
        const refused = regenerationFailedResponse(false);
        report.status = 'ready';
        return refused;
      }
      const version: StoredVersion = { versionId: randomUUID(), historicalInterpretationId: thread.anchor.id,
        generatedAt: now, full, basic };
      thread.versions.push(version);
      identity = { reused: false, ...versionIdentity(version) };
    } else {
      this.threads.set(reportId, { versions: [], anchor: { id: randomUUID(), generated_at: now, full, basic,
        source: shaped.source, depth: shaped.depth, tier: shaped.tier } });
    }
    report.status = 'ready';
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
      await deleteUserAccount({
        listStoreSubscriptions: async userId => db.tables.iap_subscriptions.filter(r => r.user_id === userId) as never,
        getStripeCustomerId: async userId => (db.tables.stripe_subscriptions.find(r => r.user_id === userId)?.customer_id as string) ?? null,
        cancelStripeSubscriptions: async () => undefined,
        deleteStripeCustomer: async () => undefined,
        deleteStorageFiles: async userId => { for (const path of [...db.storage.keys()]) if (path.startsWith(`${userId}/`)) db.storage.delete(path); },
        // public.delete_user_data (20261011000000): every user-owned row, one transaction.
        deleteDataTables: async userId => {
          const reports = new Set(db.tables.lab_reports.filter(r => r.user_id === userId).map(r => r.id));
          for (const id of reports) this.threads.delete(String(id));
          for (const table of ['biomarkers', 'report_analytes']) db.tables[table] = db.tables[table].filter(r => !reports.has(r.lab_report_id));
          for (const table of Object.keys(db.tables)) if (table !== 'users') db.tables[table] = db.tables[table].filter(r => r.user_id !== userId);
          db.tables.users = db.tables.users.filter(r => r.id !== userId);
        },
        deleteAuthUser: async userId => db.deleteAuthUser(userId),
      }, uid, { acknowledgedStoreSubscriptions: body.acknowledge_store_subscriptions === true },
      { attempts: 1, baseDelayMs: 0, sleep: async () => undefined });
      return { status: 200, body: { success: true } };
    } catch (error) {
      return { status: 500, body: { error: (error as Error).message } };
    }
  }
}
