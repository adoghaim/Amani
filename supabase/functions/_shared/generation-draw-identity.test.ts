import * as generationOutcome from './generation-outcome';
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import { deriveBloodDrawIdentity, fingerprintAnalytes, hashDrawKey } from './blood-draw-identity';
import { resolveGenerationDrawIdentity, type GenerationDrawIdentityActions } from './generation-draw-identity';
import { buildBasicProjection } from './interpretation-visibility';
import {
  findFloorViolations, shapeInterpretation, shouldGenerateDeepInterpretation, shouldRequestDeepInterpretation,
} from './response-shaping';
import { projectBasic, servedBasic, visibleClaimProjection, withClaimAuthority } from './claim-authority';
import { buildTrendEvidence } from './trend-evidence';
import { resolveTier } from './tier';
import { entitlementUnavailable, generationVisibilityMode } from './entitlement-response';
import { commitGeneratedInterpretation, decideIntroductoryAccess } from './introductory-access';
import { decideDeepGeneration } from './regeneration-availability';
import * as versionWrite from './interpretation-version-write';
import { callModelUnlessPaused } from './ai-pause';
import { consentRefusal, createConsentGate } from './consent';

/**
 * RV-GI2. F032: the upload is hashed only from the caller's own folder. F042:
 * the draw key is bound to the analytes the interpretation is generated from.
 * Synthetic ids, bytes and values only.
 */

const USER = '0a8b4d6e-1f2a-4b3c-8d9e-0000000000aa';
const OTHER_USER = '0a8b4d6e-1f2a-4b3c-8d9e-0000000000bb';
const REPORT = '0a8b4d6e-1f2a-4b3c-8d9e-000000000101';
const BYTES = 'synthetic lab file bytes';
const OWNED = `${USER}/1730000000000.pdf`;

const TSH = {
  id: 'a1', raw_name: 'TSH', canonical_slug: 'tsh', value_numeric: 2.1, raw_value_text: '2.1', unit: 'mIU/L',
  raw_reference_range: '0.4-4.0', normalized_min: 0.4, normalized_max: 4, normalized_operator: null,
  normalized_operator_value: null, is_core: true,
};
const FERRITIN = {
  id: 'a2', raw_name: 'Ferritin', canonical_slug: 'ferritin', value_numeric: 18, raw_value_text: '18', unit: 'ng/mL',
  raw_reference_range: '16-154', normalized_min: 16, normalized_max: 154, normalized_operator: null,
  normalized_operator_value: null, is_core: false,
};
const ANALYTES = [TSH, FERRITIN];

async function sha256Hex(text: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function port(stored: { file_url: string | null; content_hash: string | null } | null, objects: Record<string, string> = {}) {
  const calls = { downloads: [] as string[], saves: [] as [string, string][] };
  const actions: GenerationDrawIdentityActions = {
    async readReportFile(reportId) {
      expect(reportId).toBe(REPORT);
      return stored;
    },
    async downloadOwnedObject(path) {
      calls.downloads.push(path);
      if (!(path in objects)) throw new Error('synthetic: object not found');
      return new TextEncoder().encode(objects[path]).buffer as ArrayBuffer;
    },
    async saveContentHash(reportId, contentHash) {
      calls.saves.push([reportId, contentHash]);
    },
  };
  return { actions, calls };
}

const resolve = (actions: GenerationDrawIdentityActions, analytes: readonly object[] = ANALYTES) =>
  resolveGenerationDrawIdentity(actions, { userId: USER, reportId: REPORT, analytes });

describe('resolveGenerationDrawIdentity — F032: only her own file is read', () => {
  it.each([
    `${OTHER_USER}/1.pdf`,
    '../x',
    '%2e%2e/x',
    `${USER}/../${OTHER_USER}/1.pdf`,
    `https://example.supabase.co/storage/v1/object/public/avatars/${USER}/1.pdf`,
    `https://example.supabase.co/storage/v1/object/public/lab-files/${OTHER_USER}/1.pdf`,
    '   ',
  ])('refuses %j: no download, no hash write, and a fixed reason', async (fileUrl) => {
    // The object exists: the refusal must not depend on whether it does.
    const { actions, calls } = port({ file_url: fileUrl, content_hash: null },
      { [fileUrl.trim()]: BYTES, [`${OTHER_USER}/1.pdf`]: BYTES });
    const error = await resolve(actions).then(() => null, (e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/^Report file is not in the caller's folder \((foreign|unrecognized)\)$/);
    expect((error as Error).message).not.toContain(OTHER_USER);
    expect(calls.downloads).toEqual([]);
    expect(calls.saves).toEqual([]);
  });

  it('treats an empty file_url as no file, as before: no download, no write, keyed to the report', async () => {
    const { actions, calls } = port({ file_url: '', content_hash: null }, { '': BYTES });
    const identity = await resolve(actions);
    expect(identity.evidenceTier).toBe('unidentified');
    expect(identity.legacyBloodDrawId).toBe(await hashDrawKey(`report:${REPORT}`));
    expect(calls.downloads).toEqual([]);
    expect(calls.saves).toEqual([]);
  });

  it.each([
    OWNED,
    `/${OWNED}`,
    `  ${OWNED}  `,
    `https://example.supabase.co/storage/v1/object/public/lab-files/${OWNED}`,
    `https://example.supabase.co/storage/v1/object/authenticated/lab-files/${OWNED}`,
  ])('downloads %j once, as the mapped path, and saves its hash', async (fileUrl) => {
    // An object stored under the raw reference must never be the one hashed.
    const { actions, calls } = port({ file_url: fileUrl, content_hash: null }, { [fileUrl]: 'other bytes', [OWNED]: BYTES });
    const identity = await resolve(actions);
    const contentHash = await sha256Hex(BYTES);
    expect(calls.downloads).toEqual([OWNED]);
    expect(calls.saves).toEqual([[REPORT, contentHash]]);
    expect(identity.evidenceTier).toBe('content_hash');
    expect(identity.legacyBloodDrawId).toBe(await hashDrawKey(`sha256:${contentHash}`));
  });

  it('uses a stored hash as is: no download, no write', async () => {
    const { actions, calls } = port({ file_url: `${OTHER_USER}/1.pdf`, content_hash: 'c'.repeat(64) });
    const identity = await resolve(actions);
    expect(identity.legacyBloodDrawId).toBe(await hashDrawKey(`sha256:${'c'.repeat(64)}`));
    expect(calls.downloads).toEqual([]);
    expect(calls.saves).toEqual([]);
  });

  it('propagates a failed download of her own file and saves nothing', async () => {
    const { actions, calls } = port({ file_url: OWNED, content_hash: null });
    await expect(resolve(actions)).rejects.toThrow('synthetic: object not found');
    expect(calls.downloads).toEqual([OWNED]);
    expect(calls.saves).toEqual([]);
  });

  it('keys a report whose row is gone to the report, as before', async () => {
    const { actions, calls } = port(null);
    const identity = await resolve(actions);
    expect(identity.evidenceTier).toBe('unidentified');
    expect(calls.downloads).toEqual([]);
  });
});

describe('resolveGenerationDrawIdentity — F042: the key is bound to the analytes', () => {
  it('returns the analyte-bound id, the pre-binding id and the evidence tier', async () => {
    const { actions } = port({ file_url: OWNED, content_hash: 'c'.repeat(64) });
    const fingerprint = await fingerprintAnalytes(ANALYTES);
    expect(await resolve(actions)).toEqual({
      bloodDrawId: await hashDrawKey(`sha256:${'c'.repeat(64)}:analytes:${fingerprint}`),
      legacyBloodDrawId: await hashDrawKey(`sha256:${'c'.repeat(64)}`),
      evidenceTier: 'content_hash',
    });
  });

  it('binds the per-report key too, when there is no file', async () => {
    const { actions } = port({ file_url: null, content_hash: null });
    const fingerprint = await fingerprintAnalytes(ANALYTES);
    expect(await resolve(actions)).toEqual({
      bloodDrawId: await hashDrawKey(`report:${REPORT}:analytes:${fingerprint}`),
      legacyBloodDrawId: await hashDrawKey(`report:${REPORT}`),
      evidenceTier: 'unidentified',
    });
  });

  it('the same rows in another order are the same draw; another value is another draw, same legacy id', async () => {
    const { actions } = port({ file_url: OWNED, content_hash: 'c'.repeat(64) });
    const original = await resolve(actions);
    expect(await resolve(actions, [FERRITIN, TSH])).toEqual(original);
    const edited = await resolve(actions, [{ ...TSH, value_numeric: 9, raw_value_text: '9' }, FERRITIN]);
    expect(edited.bloodDrawId).not.toBe(original.bloodDrawId);
    expect(edited.legacyBloodDrawId).toBe(original.legacyBloodDrawId);
  });
});

/*
  Through the handler. The real generate-interpretation handler, shared
  pipeline, introductory ledger flow and version-store wiring, executed from
  source (the interpretation-version-write.handler.test.ts technique), against
  one stateful fake: lab_reports, report_analytes, a lab-files bucket, the
  claims ledger with settle_introductory_claim's rule (already_claimed on
  blood_draw_id = p OR report_id = p, 20261011000003), and the reports' anchors.
  A request is a fresh handler over the same state, so a scenario is a sequence
  of requests by one user. The SQL itself is proven by the migration harness.
*/
const source = readFileSync(new URL('../generate-interpretation/index.ts', import.meta.url), 'utf8');
function evaluate(fragment: string, values: Record<string, unknown>) {
  const { code } = transformSync(fragment, { loader: 'ts', target: 'es2022' });
  return new Function(...Object.keys(values), code)(...Object.values(values));
}
function slice(text: string, startMarker: string, endMarker: string) {
  const start = text.indexOf(startMarker);
  const end = text.indexOf(endMarker, start);
  expect(start).toBeGreaterThan(0);
  expect(end).toBeGreaterThan(start);
  return text.slice(start, end);
}
// PK-CONSENT-01: features.consent_gate off (the seed); a consent read would throw.
const consentGateOff = () => createConsentGate({ readPublicConfig: async () => [{ key: 'features', value: {} }],
  readCurrentConsents: async () => { throw new Error('flag off: consent is never read'); }, now: () => 0 });

const R1 = '0a8b4d6e-1f2a-4b3c-8d9e-000000000201';
const R2 = '0a8b4d6e-1f2a-4b3c-8d9e-000000000202';
const REQUEST = '0a8b4d6e-1f2a-4b3c-8d9e-0f1a2b3c4d60';
const FIRST_FILE = `${USER}/1730000000001.pdf`;
const SECOND_FILE = `${USER}/1730000000002.pdf`;
const EDITED = [{ ...TSH, value_numeric: 9, raw_value_text: '9' }, FERRITIN];
const generated = () => ({
  headline: 'Synthetic headline', questions_for_doctor: [], disclaimer: 'd', key_findings: [],
  cycle_context: { estimated_cycle_day: 3, estimated_cycle_phase: 'luteal', confidence: 'high', explanation: 'model prose' },
});

interface Claim { user_id: string; blood_draw_id: string; report_id: string | null; evidence_tier: string; claimed_at: string }
interface World {
  reports: Record<string, { user_id: string; file_url: string | null; content_hash: string | null }>;
  analytes: Record<string, object[]>;
  /** The lab-files bucket: object path to bytes. */
  objects: Record<string, string>;
  claims: Claim[];
  /** Reports holding their anchor interpretation, with the draw id stored on it. */
  anchors: Record<string, { tier: string; blood_draw_id: string | null }>;
}
const world = (): World => ({ reports: {}, analytes: {}, objects: {}, claims: [], anchors: {} });
const claimOf = (blood_draw_id: string, report_id: string | null, evidence_tier = 'content_hash'): Claim =>
  ({ user_id: USER, blood_draw_id, report_id, evidence_tier, claimed_at: '2026-10-01T00:00:00Z' });
function upload(w: World, reportId: string, fileUrl: string | null, bytes: string | null, analytes: object[]) {
  w.reports[reportId] = { user_id: USER, file_url: fileUrl, content_hash: null };
  if (fileUrl !== null && bytes !== null) w.objects[fileUrl] = bytes;
  w.analytes[reportId] = analytes;
}

type Rpc = { name: string; args: Record<string, unknown> };
function fakeSupabase(w: World) {
  const rpcs: Rpc[] = [];
  const settled: string[] = [];
  const writes: string[] = [];
  const reads: string[] = [];
  const downloads: string[] = [];
  let versions = 0;

  const settle = (a: Record<string, unknown>) => {
    const mine = w.claims.filter(c => c.user_id === a.p_user_id);
    if (mine.some(c => c.blood_draw_id === a.p_blood_draw_id || c.report_id === a.p_report_id)) return 'already_claimed';
    if (a.p_consume_credit !== true) return { code: '22023', message: 'an unclaimed report must consume a credit' };
    if (mine.length >= 3) return 'limit_reached';
    w.claims.push({ user_id: String(a.p_user_id), blood_draw_id: String(a.p_blood_draw_id), report_id: String(a.p_report_id),
      evidence_tier: String(a.p_evidence_tier), claimed_at: '2026-10-24T00:00:00Z' });
    return 'committed';
  };

  const from = (table: string) => {
    let selection = '';
    let head = false;
    let update: Record<string, unknown> | null = null;
    const filters: [string, unknown][] = [];
    let anyOf: [string, string][] | null = null;
    const query: Record<string, unknown> = {};
    for (const method of ['neq', 'lt', 'order', 'limit']) query[method] = () => query;
    query.eq = (column: string, value: unknown) => { filters.push([column, value]); return query; };
    query.is = (column: string, value: unknown) => { filters.push([column, value]); return query; };
    query.or = (expression: string) => {
      anyOf = expression.split(',').map(part => {
        const [column, operator, ...value] = part.split('.');
        expect(operator).toBe('eq');
        return [column, value.join('.')] as [string, string];
      });
      return query;
    };
    query.update = (value: Record<string, unknown>) => { update = value; writes.push(`update:${table}:${JSON.stringify(value)}`); return query; };
    for (const method of ['insert', 'upsert', 'delete']) {
      query[method] = (value: unknown) => { writes.push(`${method}:${table}:${JSON.stringify(value)}`); return query; };
    }
    query.select = (value: string, options?: { head?: boolean }) => {
      selection = value; head = !!options?.head; reads.push(`${table}:${value}`); return query;
    };
    const filtered = (row: Record<string, unknown>) => filters.every(([column, value]) => row[column] === value)
      && (anyOf === null || anyOf.some(([column, value]) => String(row[column]) === value));
    const answer = () => {
      if (table === 'lab_reports') {
        const id = filters.find(([column]) => column === 'id')?.[1] as string | undefined;
        const report = id === undefined ? undefined : w.reports[id];
        if (update) {
          if (report && 'content_hash' in update && report.content_hash === null) report.content_hash = String(update.content_hash);
          return { data: null, error: null };
        }
        if (!report) return { data: null, error: null };
        if (selection === 'id, user_id') return { data: { id, user_id: report.user_id }, error: null };
        if (selection === 'file_url, content_hash') return { data: { file_url: report.file_url, content_hash: report.content_hash }, error: null };
        if (selection.includes('context')) {
          return { data: { id, report_date: '2026-09-26', estimated_cycle_day: 21, estimated_cycle_phase: 'luteal' }, error: null };
        }
        return { data: null, error: null };
      }
      if (table === 'report_analytes') {
        const id = filters.find(([column]) => column === 'lab_report_id')?.[1] as string;
        return { data: w.analytes[id] ?? [], error: null };
      }
      if (table === 'interpretation_visibility_config') return { data: { enabled: true }, error: null };
      if (table === 'introductory_deep_access_claims') {
        const rows = w.claims.filter(c => filtered(c as unknown as Record<string, unknown>));
        return head ? { data: null, error: null, count: rows.length } : { data: rows[0] ?? null, error: null };
      }
      return { data: null, error: null };
    };
    query.maybeSingle = async () => answer();
    query.single = query.maybeSingle;
    query.then = (done: (v: unknown) => unknown, fail?: (e: unknown) => unknown) => Promise.resolve().then(answer).then(done, fail);
    return query;
  };

  const rpc = async (name: string, args: Record<string, unknown>) => {
    rpcs.push({ name, args });
    const reportId = String(args.p_report_id);
    if (name === 'read_interpretation_for_server') {
      const anchor = w.anchors[reportId];
      if (!anchor) return { data: [], error: null };
      const covered = w.claims.some(c => c.user_id === args.p_user_id
        && (c.report_id === reportId || c.blood_draw_id === anchor.blood_draw_id));
      return { data: [{ json_output: {}, has_claim: covered }], error: null };
    }
    if (name === 'commit_deep_access_v2' || name === 'commit_deep_access_version') {
      if (name === 'commit_deep_access_v2' && w.anchors[reportId]) {
        return { data: null, error: { code: '55000', message: 'synthetic: history protected' } };
      }
      const outcome = settle(args);
      if (typeof outcome !== 'string') return { data: null, error: outcome };
      settled.push(outcome);
      if (name === 'commit_deep_access_v2') {
        if (outcome !== 'limit_reached') w.anchors[reportId] = { tier: 'plus', blood_draw_id: String(args.p_blood_draw_id) };
        return { data: outcome, error: null };
      }
      if (outcome === 'limit_reached') {
        return { data: [{ outcome, version_id: null, history_id: null, version_generated_at: null }], error: null };
      }
      versions++;
      return { data: [{ outcome, version_id: `v${versions}`, history_id: 'h', version_generated_at: '2026-10-24T01:00:00Z' }], error: null };
    }
    if (name === 'save_interpretation') {
      if (w.anchors[reportId]) return { data: null, error: { code: '55000', message: 'synthetic: history protected' } };
      w.anchors[reportId] = { tier: String(args.p_tier), blood_draw_id: (args.p_blood_draw_id as string | null) ?? null };
      return { data: null, error: null };
    }
    if (name === 'append_interpretation_version') {
      versions++;
      return { data: [{ version_id: `v${versions}`, history_id: 'h', version_generated_at: '2026-10-24T01:00:00Z' }], error: null };
    }
    return { data: null, error: { code: 'XX000', message: `unexpected rpc ${name}` } };
  };

  const storage = {
    from: (bucket: string) => ({
      async download(path: string) {
        downloads.push(`${bucket}:${path}`);
        const bytes = bucket === 'lab-files' ? w.objects[path] : undefined;
        return bytes === undefined ? { data: null, error: { message: 'Object not found' } } : { data: new Blob([bytes]), error: null };
      },
    }),
  };
  const client = { from, rpc, storage, auth: { getUser: async () => ({ data: { user: { id: USER } }, error: null }) } };
  return { client, rpcs, settled, writes, reads, downloads };
}

type Plan = 'free' | 'premium' | 'off';
function buildHandler(client: unknown, plan: Plan, postLimit: string | undefined, resolver: typeof resolveGenerationDrawIdentity) {
  const sink: Record<string, unknown> = {};
  evaluate(slice(source, 'function classifyAnalyte(', 'function displayVal(') + '\nsink.a = { classifyAnalyte, slug };', { sink });
  evaluate(slice(source, 'function deterministicCycleFacts(', 'function generateFallbackInterpretation(')
    + '\nsink.c = { deterministicCycleFacts, modelCycleExplanation };', { sink });
  const tryOpenAI = vi.fn(async () => structuredClone(generated()));
  evaluate(slice(source, '// ─── Shared generation pipeline', '// ─── Version store')
    + '\nsink.p = { loadGenerationContext, trendEvidenceFor, produceInterpretation };', {
    sink, sanitizeReportContext: () => undefined, buildPrimaryContext: () => null, debugLog: () => {}, errorMessage: String,
    UserProfileContextSchema: { safeParse: () => ({ success: false, error: { flatten: () => ({}) } }) },
    formatUserContextBlock: () => null, buildTrendEvidence, withClaimAuthority, projectBasic, buildBasicProjection,
    findFloorViolations, shapeInterpretation, shouldRequestDeepInterpretation, formatPrimarySummary: () => '',
    generateFallbackInterpretation: () => ({ headline: 'deterministic fallback' }), tryOpenAI, callModelUnlessPaused, ...generationOutcome,
    ...(sink.a as object), ...(sink.c as object),
  });
  evaluate(slice(source, '// ─── Version store', '// ─── Handler')
    + '\nsink.v = { readAnchor, findRequestVersion, appendVersion, commitLedgerVersion };', { sink, ...versionWrite });
  let handler: (req: Request) => Promise<Response> = async () => new Response(null, { status: 500 });
  const flagOn = plan !== 'off';
  evaluate(source.slice(source.indexOf('Deno.serve(')), {
    Deno: { env: { get: (name: string) => name === 'OPENAI_API_KEY' ? 'test-key'
      : name === 'FREEMIUM_POST_LIMIT_GENERATION' ? postLimit : undefined },
    serve: (fn: typeof handler) => { handler = fn; } },
    createClient: () => client, corsHeaders: {}, debugLog: () => {}, enforceRateLimit: async () => {}, createRateLimitStore: () => ({}),
    consentRefusal, consentGateFor: consentGateOff,
    logServerEvent: async () => true, createAppEventSink: () => ({}),
    GenerateInterpretationRequestSchema: { safeParse: (body: { reportId: string; request_id?: string }) =>
      ({ success: true, data: { reportId: body.reportId, request_id: body.request_id } }) },
    checkUserSubscription: async () => !flagOn
      ? { allowed: true, reason: 'trial' }
      : plan === 'free'
        ? { allowed: true, plan: 'free', reason: 'free_plan', source: 'free' }
        : { allowed: true, plan: 'premium', reason: 'active_subscription', source: 'active_subscription' },
    freemiumActive: () => flagOn, generationVisibilityMode, entitlementUnavailable, resolveTier,
    shouldGenerateDeepInterpretation, decideDeepGeneration, decideIntroductoryAccess, commitGeneratedInterpretation,
    // 03f9a85's identity wiring and RV-GI2's, so the same harness runs either handler.
    deriveBloodDrawIdentity, hashDrawKey, resolveGenerationDrawIdentity: resolver, recordGenerationCosts: vi.fn(async () => {}),
    isRateLimitExceeded: () => false, errorMessage: String, servedBasic, visibleClaimProjection,
    aiPausedNow: async () => false, inBackground: (p: Promise<unknown>) => { void p; },
    costLedger: { record: async () => {} }, reporter: { captureException: async () => false },
    ...versionWrite, ...generationOutcome, ...(sink.p as object), ...(sink.v as object),
  });
  return { handler, tryOpenAI };
}

async function generate(w: World, request: { reportId: string; requestId?: string; plan?: Plan; postLimit?: string }) {
  const fake = fakeSupabase(w);
  const resolver = vi.fn(resolveGenerationDrawIdentity);
  const { handler, tryOpenAI } = buildHandler(fake.client, request.plan ?? 'free', request.postLimit, resolver);
  const logged: unknown[][] = [];
  const spies = [vi.spyOn(console, 'log'), vi.spyOn(console, 'warn'), vi.spyOn(console, 'error')]
    .map(spy => spy.mockImplementation((...args: unknown[]) => { logged.push(args); }));
  try {
    const body: Record<string, unknown> = { reportId: request.reportId };
    if (request.requestId) body.request_id = request.requestId;
    const response = await handler(new Request('https://example.invalid', {
      method: 'POST', headers: { Authorization: 'Bearer test' }, body: JSON.stringify(body) }));
    return { ...fake, status: response.status, body: await response.json(), tryOpenAI, resolver, logged };
  } finally {
    spies.forEach(spy => spy.mockRestore());
  }
}

const persisting = (rpcs: Rpc[]) => rpcs.map(r => r.name).filter(n => n !== 'read_interpretation_for_server');
const argsOf = (rpcs: Rpc[], name: string) => rpcs.find(r => r.name === name)?.args;

describe('generate-interpretation F032: a Free generation reads only her own file (executed from source)', () => {
  it('another user\'s object is never downloaded or hashed: the fixed 500, logged without the path', async () => {
    const w = world();
    upload(w, R1, `${OTHER_USER}/1.pdf`, BYTES, ANALYTES);
    const result = await generate(w, { reportId: R1 });
    expect(result.downloads).toEqual([]);
    expect(result.writes.filter(write => write.includes('content_hash'))).toEqual([]);
    expect(w.reports[R1].content_hash).toBeNull();
    expect(result.status).toBe(500);
    expect(result.body).toEqual({ error: 'Internal server error' });
    expect(result.tryOpenAI).not.toHaveBeenCalled();
    expect(persisting(result.rpcs)).toEqual([]);
    expect(JSON.stringify(result.logged)).toContain("Report file is not in the caller's folder (foreign)");
    expect(JSON.stringify(result.logged)).not.toContain(OTHER_USER);
  });

  it('answers the same whether or not that object exists: no existence oracle', async () => {
    const present = world();
    upload(present, R1, `${OTHER_USER}/1.pdf`, BYTES, ANALYTES);
    const absent = world();
    upload(absent, R1, `${OTHER_USER}/1.pdf`, null, ANALYTES);
    const a = await generate(present, { reportId: R1 });
    const b = await generate(absent, { reportId: R1 });
    expect({ status: a.status, body: a.body, writes: a.writes }).toEqual({ status: b.status, body: b.body, writes: b.writes });
  });

  it('her own path is downloaded once and its hash saved', async () => {
    const w = world();
    upload(w, R1, FIRST_FILE, BYTES, ANALYTES);
    const result = await generate(w, { reportId: R1 });
    expect(result.status).toBe(200);
    expect(result.downloads).toEqual([`lab-files:${FIRST_FILE}`]);
    expect(w.reports[R1].content_hash).toBe(await sha256Hex(BYTES));
    expect(result.body).toMatchObject({ access: 'full' });
  });

  it('a legacy public URL downloads its mapped path, not the URL', async () => {
    const w = world();
    upload(w, R1, `https://example.supabase.co/storage/v1/object/public/lab-files/${FIRST_FILE}`, null, ANALYTES);
    w.objects[FIRST_FILE] = BYTES;
    const result = await generate(w, { reportId: R1 });
    expect(result.downloads).toEqual([`lab-files:${FIRST_FILE}`]);
    expect(result.status).toBe(200);
    expect(w.reports[R1].content_hash).toBe(await sha256Hex(BYTES));
  });
});

describe('generate-interpretation F042: a claim covers its own draw only (executed from source)', () => {
  /** Her first report, generated: it claims a credit. */
  async function claimFirstReport(w: World) {
    const before = w.claims.length;
    upload(w, R1, FIRST_FILE, BYTES, ANALYTES);
    const first = await generate(w, { reportId: R1 });
    expect(first.status).toBe(200);
    expect(first.settled).toEqual(['committed']);
    expect(w.claims).toHaveLength(before + 1);
  }

  it.each([
    ['a byte-identical new object', SECOND_FILE],
    ['the claimed object\'s own path', FIRST_FILE],
  ])('(a) a new report of the same bytes with other analytes is a new draw, through %s: a credit, never already_claimed', async (_label, fileUrl) => {
    const w = world();
    await claimFirstReport(w);
    upload(w, R2, fileUrl, BYTES, EDITED);
    const second = await generate(w, { reportId: R2 });
    expect(second.status).toBe(200);
    expect(second.settled).toEqual(['committed']);
    expect(argsOf(second.rpcs, 'commit_deep_access_v2')).toMatchObject({ p_report_id: R2, p_consume_credit: true });
    expect(second.body).toMatchObject({ access: 'full' });
    expect(w.claims).toHaveLength(2);
  });

  it('(a) with every credit spent it is the exhausted path: served Basic, nothing claimed', async () => {
    const w = world();
    w.claims.push(claimOf('1'.repeat(64), null), claimOf('2'.repeat(64), null));
    await claimFirstReport(w);
    upload(w, R2, SECOND_FILE, BYTES, EDITED);
    const second = await generate(w, { reportId: R2 });
    expect(second.status).toBe(200);
    expect(second.settled).toEqual([]);
    expect(persisting(second.rpcs)).toEqual(['save_interpretation']);
    expect(argsOf(second.rpcs, 'save_interpretation')).toMatchObject({ p_tier: 'free' });
    expect(second.body).toMatchObject({ access: 'basic' });
    expect(w.claims).toHaveLength(3);
  });

  it('(b) the same bytes with the same analytes, in any order, is the claimed draw: served free, no credit', async () => {
    const w = world();
    await claimFirstReport(w);
    upload(w, R2, SECOND_FILE, BYTES, [FERRITIN, TSH]);
    const second = await generate(w, { reportId: R2 });
    expect(second.status).toBe(200);
    expect(second.settled).toEqual(['already_claimed']);
    expect(argsOf(second.rpcs, 'commit_deep_access_v2')).toMatchObject({ p_report_id: R2, p_consume_credit: false });
    expect(second.body).toMatchObject({ access: 'full' });
    expect(w.claims).toHaveLength(1);
  });

  it.each([undefined, 'always', 'on_demand'])('(c) a claimed report whose analytes were edited is refused (post-limit %s): no model call, nothing claimed or written', async postLimit => {
    const w = world();
    await claimFirstReport(w);
    w.analytes[R1] = EDITED;
    const again = await generate(w, { reportId: R1, requestId: REQUEST, postLimit });
    expect(again.status).toBe(503);
    expect(again.body).toEqual({ error: 'regeneration_failed', reason: 'introductory_access_exhausted', retryable: false });
    expect(again.tryOpenAI).not.toHaveBeenCalled();
    expect(again.settled).toEqual([]);
    expect(persisting(again.rpcs)).toEqual([]);
    expect(again.writes).toEqual([]);
    expect(w.claims).toHaveLength(1);
  });

  it('(c) control: the claimed report regenerated with its claimed analytes is served free', async () => {
    const w = world();
    await claimFirstReport(w);
    const again = await generate(w, { reportId: R1, requestId: REQUEST });
    expect(again.status).toBe(200);
    expect(again.settled).toEqual(['already_claimed']);
    expect(argsOf(again.rpcs, 'commit_deep_access_version')).toMatchObject({ p_consume_credit: false });
    expect(again.body).toMatchObject({ access: 'full' });
  });

  it('(c) a report claimed for other analytes and holding no interpretation is served Basic: no model call, nothing claimed', async () => {
    const w = world();
    upload(w, R1, FIRST_FILE, BYTES, ANALYTES);
    w.claims.push(claimOf('e'.repeat(64), R1));
    const result = await generate(w, { reportId: R1 });
    expect(result.status).toBe(200);
    expect(result.tryOpenAI).not.toHaveBeenCalled();
    expect(result.settled).toEqual([]);
    expect(persisting(result.rpcs)).toEqual(['save_interpretation']);
    expect(argsOf(result.rpcs, 'save_interpretation')).toMatchObject({ p_tier: 'free', p_source: 'fallback' });
    expect(result.body).toMatchObject({ access: 'basic', source: 'fallback' });
    expect(w.claims).toHaveLength(1);
  });

  it.each(['content_hash', 'unidentified'] as const)('(d) a claim made before the binding, regenerated on its own report, is served free as before (%s)', async tier => {
    const w = world();
    upload(w, R1, tier === 'content_hash' ? FIRST_FILE : null, BYTES, ANALYTES);
    if (tier === 'content_hash') w.reports[R1].content_hash = await sha256Hex(BYTES);
    const legacy = await hashDrawKey(tier === 'content_hash' ? `sha256:${await sha256Hex(BYTES)}` : `report:${R1}`);
    w.claims.push(claimOf(legacy, R1, tier));
    w.anchors[R1] = { tier: 'plus', blood_draw_id: legacy };
    const again = await generate(w, { reportId: R1, requestId: REQUEST });
    expect(again.status).toBe(200);
    expect(again.settled).toEqual(['already_claimed']);
    expect(argsOf(again.rpcs, 'commit_deep_access_version')).toMatchObject({ p_consume_credit: false });
    expect(again.body).toMatchObject({ access: 'full' });
    expect(w.claims).toHaveLength(1);
  });

  it('(e) a claim made before the binding, with another report of the same bytes, is a new draw: a credit', async () => {
    const w = world();
    upload(w, R1, FIRST_FILE, BYTES, ANALYTES);
    w.reports[R1].content_hash = await sha256Hex(BYTES);
    const legacy = await hashDrawKey(`sha256:${await sha256Hex(BYTES)}`);
    w.claims.push(claimOf(legacy, R1));
    w.anchors[R1] = { tier: 'plus', blood_draw_id: legacy };
    upload(w, R2, SECOND_FILE, BYTES, ANALYTES);
    const second = await generate(w, { reportId: R2 });
    expect(second.status).toBe(200);
    expect(second.settled).toEqual(['committed']);
    expect(argsOf(second.rpcs, 'commit_deep_access_v2')).toMatchObject({ p_report_id: R2, p_consume_credit: true });
    expect(w.claims).toHaveLength(2);
  });
});

describe('generate-interpretation (f): Plus and flag-off requests derive no draw identity (executed from source)', () => {
  it.each(['premium', 'off'] as const)('%s: no fingerprint, no claim read, no file read, no Storage call', async plan => {
    const w = world();
    // A foreign reference and a mismatched claim: either would change a Free answer.
    upload(w, R1, `${OTHER_USER}/1.pdf`, BYTES, ANALYTES);
    w.claims.push(claimOf('e'.repeat(64), R1));
    const result = await generate(w, { reportId: R1, plan });
    expect(result.status).toBe(200);
    expect(result.resolver).not.toHaveBeenCalled();
    expect(result.downloads).toEqual([]);
    expect(result.reads.filter(read => read.startsWith('introductory_deep_access_claims:')
      || read === 'lab_reports:file_url, content_hash')).toEqual([]);
    expect(persisting(result.rpcs)).toEqual(['save_interpretation']);
    expect(argsOf(result.rpcs, 'save_interpretation')).toMatchObject({ p_blood_draw_id: null });
    expect(result.tryOpenAI).toHaveBeenCalledTimes(1);
  });
});
