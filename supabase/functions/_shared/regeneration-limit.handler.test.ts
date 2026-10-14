import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import { z } from 'zod';
import { buildBasicProjection } from './interpretation-visibility';
import {
  findFloorViolations, shapeInterpretation, shouldGenerateDeepInterpretation, shouldRequestDeepInterpretation,
} from './response-shaping';
import { projectBasic, servedBasic, visibleClaimProjection, withClaimAuthority } from './claim-authority';
import { buildTrendEvidence } from './trend-evidence';
import { resolveTier } from './tier';
import { entitlementUnavailable, generationVisibilityMode } from './entitlement-response';
import { commitGeneratedInterpretation, decideIntroductoryAccess } from './introductory-access';
import { deriveBloodDrawIdentity, hashDrawKey } from './blood-draw-identity';
import { decideDeepGeneration } from './regeneration-availability';
import * as versionWrite from './interpretation-version-write';
import * as regenerationLimit from './regeneration-limit';
import { classifyRegenerationFailure } from '../../../src/lib/regenerationFailure';

/**
 * PK-REGEN-01 (R26): generate-interpretation enforces "Regenerate (N left)".
 * Executed from source against a stateful fake Supabase whose
 * lab_reports.regeneration_count only the server's record_regeneration RPC can
 * move (the GRANT half is supabase/migrations/__verification__/
 * regeneration-limit.sql). Proves: the count rises only on a successful write;
 * a no-write failure leaves it unchanged; the fourth regeneration is refused
 * before any model spend with the calm 4xx the client reads as "unavailable".
 * The request schema is the real one.
 */

const source = readFileSync(new URL('../generate-interpretation/index.ts', import.meta.url), 'utf8');
const schemaSource = readFileSync(new URL('./schemas/requests.ts', import.meta.url), 'utf8');
function evaluate(fragment: string, values: Record<string, unknown>) {
  const { code } = transformSync(fragment, { loader: 'ts', target: 'es2022' });
  return new Function(...Object.keys(values), code)(...Object.values(values));
}
const slice = (text: string, start: string, end: string) => text.slice(text.indexOf(start), text.indexOf(end, text.indexOf(start)));
const schemas = evaluate(schemaSource.replace(/^import .*$/m, '').replace(/export (const|type) /g, '$1 ')
  + '\nreturn { GenerateInterpretationRequestSchema };', { z }) as { GenerateInterpretationRequestSchema: unknown };

const USER = 'u';
const REPORT = '0a8b4d6e-1f2a-4b3c-8d9e-000000000003';
const generated = () => ({
  headline: 'Synthetic regenerated headline', questions_for_doctor: [], disclaimer: 'd', key_findings: [],
  cycle_context: { estimated_cycle_day: 3, estimated_cycle_phase: 'luteal', confidence: 'high', explanation: 'model prose' },
});
const ANALYTE = {
  id: 'a1', raw_name: 'TSH', canonical_slug: 'tsh', value_numeric: 9, raw_value_text: '9', unit: 'mIU/L',
  raw_reference_range: '0.4-4.0', normalized_min: 0.4, normalized_max: 4.0, normalized_operator: null,
  normalized_operator_value: null, is_core: true,
};

interface Report { count: number }
interface Scenario {
  plan?: 'off' | 'premium' | 'free';
  anchor?: boolean;
  storedDepth?: string;
  purpose?: string;
  requestId?: string | null;
  model?: Record<string, unknown> | null;
  claim?: boolean;
  claimCount?: number;
  ledgerOutcome?: 'committed' | 'already_claimed' | 'limit_reached';
  appendError?: { code: string; message: string };
  /** The version store already holds this request's version (a committed retry), or does after a reuse error (a twin). */
  committed?: boolean;
  twinAfterReuse?: boolean;
  versionReadError?: boolean;
  countReadError?: boolean;
  recordError?: boolean;
  postLimit?: string;
}

function fakeSupabase(s: Scenario, report: Report) {
  const rpcs: string[] = [];
  const writes: string[] = [];
  let twinVisible = false;
  const committedRow = { id: 'v0', historical_interpretation_id: 'h', generated_at: '2026-10-12T00:00:00Z',
    json_output: { headline: 'committed' }, json_output_basic: { headline: 'committed basic' } };
  const reply = (table: string, selection: string) => {
    if (table === 'lab_reports') {
      if (selection === 'id, user_id') return { data: { id: REPORT, user_id: USER }, error: null };
      if (selection === 'regeneration_count') return s.countReadError
        ? { data: null, error: { message: 'synthetic count read failure' } } : { data: { regeneration_count: report.count }, error: null };
      if (selection === 'file_url, content_hash') return { data: { file_url: null, content_hash: 'c'.repeat(64) }, error: null };
      return { data: selection.includes('context')
        ? { id: REPORT, report_date: '2026-09-26', estimated_cycle_day: 21, estimated_cycle_phase: 'luteal' } : null, error: null };
    }
    if (table === 'report_analytes') return { data: [ANALYTE], error: null };
    if (table === 'interpretation_visibility_config') return { data: { enabled: true }, error: null };
    if (table === 'interpretation_versions') {
      if (s.versionReadError) return { data: null, error: { message: 'synthetic version read failure' } };
      return { data: s.committed || twinVisible ? committedRow : null, error: null };
    }
    if (table === 'introductory_deep_access_claims') return { data: s.claim
      ? { user_id: USER, blood_draw_id: 'd', report_id: REPORT, evidence_tier: 'content_hash', claimed_at: '2026-10-01T00:00:00Z' } : null, error: null };
    return { data: null, error: null };
  };
  const from = (table: string) => {
    let selection = '';
    const query: Record<string, unknown> = {};
    for (const method of ['eq', 'neq', 'lt', 'order', 'limit', 'is', 'or']) query[method] = () => query;
    for (const method of ['update', 'insert', 'upsert', 'delete']) {
      query[method] = (value: unknown) => { writes.push(`${method}:${table}:${JSON.stringify(value)}`); return query; };
    }
    query.select = (value: string) => { selection = value; return query; };
    query.maybeSingle = async () => reply(table, selection);
    query.single = query.maybeSingle;
    query.then = (done: (v: unknown) => void) => Promise.resolve({ ...reply(table, selection),
      count: table === 'introductory_deep_access_claims' ? (s.claimCount ?? (s.claim ? 1 : 0)) : null }).then(done);
    return query;
  };
  const rpc = async (name: string) => {
    rpcs.push(name);
    if (name === 'read_interpretation_for_server') {
      return { data: s.anchor === false ? [] : [{ json_output: {}, has_claim: !!s.claim, stored_depth: s.storedDepth ?? 'deep' }], error: null };
    }
    if (name === 'record_regeneration') {
      if (s.recordError) return { data: null, error: { message: 'synthetic record failure' } };
      report.count += 1;
      return { data: report.count, error: null };
    }
    if (name === 'append_interpretation_version') {
      if (s.appendError) { twinVisible = !!s.twinAfterReuse; return { data: null, error: s.appendError }; }
      return { data: [{ version_id: 'v1', history_id: 'h', version_generated_at: '2026-10-13T00:00:00Z' }], error: null };
    }
    if (name === 'commit_deep_access_version') {
      const outcome = s.ledgerOutcome ?? (s.claim ? 'already_claimed' : 'committed');
      return { data: [outcome === 'limit_reached' ? { outcome, version_id: null, history_id: null, version_generated_at: null }
        : { outcome, version_id: 'v2', history_id: 'h', version_generated_at: '2026-10-13T01:00:00Z' }], error: null };
    }
    if (name === 'save_interpretation') return { data: null, error: null };
    return { data: null, error: { code: 'XX000', message: `unexpected rpc ${name}` } };
  };
  return { client: { from, rpc, auth: { getUser: async () => ({ data: { user: { id: USER } }, error: null }) } }, rpcs, writes };
}

function buildHandler(s: Scenario, client: unknown, handlerSource: string) {
  const sink: Record<string, unknown> = {};
  evaluate(slice(source, 'function classifyAnalyte(', 'function displayVal(') + '\nsink.a = { classifyAnalyte, slug };', { sink });
  evaluate(slice(source, 'function deterministicCycleFacts(', 'function generateFallbackInterpretation(')
    + '\nsink.c = { deterministicCycleFacts, modelCycleExplanation };', { sink });
  const model = s.model === undefined ? generated() : s.model;
  const tryOpenAI = vi.fn(async () => (model === null ? null : structuredClone(model)));
  evaluate(slice(source, '// ─── Shared generation pipeline', '// ─── Version store')
    + '\nsink.p = { loadGenerationContext, trendEvidenceFor, produceInterpretation };', {
    sink, sanitizeReportContext: () => undefined, buildPrimaryContext: () => null, debugLog: () => {}, errorMessage: String,
    UserProfileContextSchema: { safeParse: () => ({ success: false, error: { flatten: () => ({}) } }) },
    formatUserContextBlock: () => null, buildTrendEvidence, withClaimAuthority, projectBasic, buildBasicProjection,
    findFloorViolations, shapeInterpretation, shouldRequestDeepInterpretation, formatPrimarySummary: () => '',
    generateFallbackInterpretation: () => ({ headline: 'deterministic fallback' }), tryOpenAI,
    ...(sink.a as object), ...(sink.c as object),
  });
  evaluate(slice(handlerSource, '// ─── Version store', '// ─── Handler')
    + '\nsink.v = { readAnchor, findRequestVersion, appendVersion, commitLedgerVersion, regenerationLimitActions };', { sink, ...versionWrite });
  let handler: (req: Request) => Promise<Response> = async () => new Response(null, { status: 500 });
  const plan = s.plan ?? 'premium';
  evaluate(handlerSource.slice(handlerSource.indexOf('Deno.serve(')), {
    Deno: { env: { get: (name: string) => name === 'OPENAI_API_KEY' ? 'test-key'
      : name === 'FREEMIUM_POST_LIMIT_GENERATION' ? s.postLimit : undefined },
      serve: (fn: typeof handler) => { handler = fn; } },
    createClient: () => client, corsHeaders: {}, debugLog: () => {}, enforceRateLimit: async () => {}, createRateLimitStore: () => ({}),
    ...schemas,
    checkUserSubscription: async () => plan === 'off' ? { allowed: true, reason: 'trial' }
      : plan === 'free' ? { allowed: true, plan: 'free', reason: 'free_plan', source: 'free' }
        : { allowed: true, plan: 'premium', reason: 'active_subscription', source: 'active_subscription' },
    freemiumActive: () => plan !== 'off', generationVisibilityMode, entitlementUnavailable, resolveTier,
    shouldGenerateDeepInterpretation, decideDeepGeneration, decideIntroductoryAccess, commitGeneratedInterpretation,
    deriveBloodDrawIdentity, hashDrawKey, recordGenerationCosts: vi.fn(async () => {}),
    isRateLimitExceeded: () => false, errorMessage: String, servedBasic, visibleClaimProjection,
    ...versionWrite, ...regenerationLimit, ...(sink.p as object), ...(sink.v as object),
  });
  return { handler, tryOpenAI };
}

let tap = 0;
const requestId = () => `0a8b4d6e-1f2a-4b3c-8d9e-${String(++tap).padStart(12, '0')}`;
const warnings: string[] = [];
afterEach(() => { warnings.length = 0; });

async function regenerate(s: Scenario, report: Report, handlerSource = source) {
  const fake = fakeSupabase(s, report);
  const { handler, tryOpenAI } = buildHandler(s, fake.client, handlerSource);
  const silence = [vi.spyOn(console, 'log'), vi.spyOn(console, 'error')].map(spy => spy.mockImplementation(() => {}));
  const warn = vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => { warnings.push(args.join(' ')); });
  try {
    const body: Record<string, unknown> = { reportId: REPORT };
    const id = s.requestId === undefined ? requestId() : s.requestId;
    if (id !== null) body.request_id = id;
    if (s.purpose !== undefined) body.purpose = s.purpose;
    const response = await handler(new Request('https://example.invalid', {
      method: 'POST', headers: { Authorization: 'Bearer test' }, body: JSON.stringify(body) }));
    return { ...fake, status: response.status, body: await response.json(), tryOpenAI };
  } finally {
    [...silence, warn].forEach(spy => spy.mockRestore());
  }
}

const PLANS = ['off', 'premium', 'free'] as const;
const NO_WRITE: [string, Scenario][] = [
  ['the model failed (503 retryable)', { model: null }],
  ['a floor violation (503 retryable)', { model: (({ questions_for_doctor: _q, ...rest }) => rest)(generated()) }],
  ['the history guard refused the writer (409)', { appendError: { code: '55000', message: 'immutable' } }],
  ['the writer failed (500)', { appendError: { code: '40001', message: 'stale' } }],
  ['the version store read failed (500)', { versionReadError: true }],
  ['the Free ledger lost the last credit (503 retryable)', { plan: 'free', claim: false, claimCount: 2, ledgerOutcome: 'limit_reached' }],
  ['Free introductory access used up, post-limit on demand (503 not retryable)', { plan: 'free', claim: false, claimCount: 3, postLimit: 'on_demand' }],
];

describe('PK-REGEN-01: the count rises only on a successful write', () => {
  it.each(PLANS)('a successful regeneration is counted exactly once, by the server (%s)', async plan => {
    const report = { count: 1 };
    const result = await regenerate({ plan, claim: plan === 'free' }, report);
    expect(result.status).toBe(200);
    expect(report.count).toBe(2);
    expect(result.rpcs.filter(n => n === 'record_regeneration')).toHaveLength(1);
    // Counted after the write, never before it.
    const persisted = result.rpcs.findIndex(n => n === 'append_interpretation_version' || n === 'commit_deep_access_version');
    expect(persisted).toBeGreaterThan(-1);
    expect(result.rpcs.indexOf('record_regeneration')).toBeGreaterThan(persisted);
    // The server never writes the count through the table API either.
    expect(result.writes.filter(w => w.includes('regeneration_count'))).toEqual([]);
  });

  it.each(NO_WRITE)('no-write failure leaves the count unchanged: %s', async (_label, scenario) => {
    const report = { count: 1 };
    const result = await regenerate(scenario, report);
    expect(result.status).toBeGreaterThanOrEqual(400);
    expect(report.count).toBe(1);
    expect(result.rpcs).not.toContain('record_regeneration');
    expect(result.writes).toEqual([]);
  });

  it('a retry of a committed request is served and not counted again', async () => {
    const report = { count: 2 };
    const result = await regenerate({ committed: true }, report);
    expect(result.status).toBe(200);
    expect(result.body.reused).toBe(true);
    expect(report.count).toBe(2);
    expect(result.tryOpenAI).not.toHaveBeenCalled();
  });

  it("a concurrent twin's version (request id reused) is served and not counted by this request", async () => {
    const report = { count: 1 };
    const result = await regenerate({ appendError: { code: '22023', message: 'reused' }, twinAfterReuse: true }, report);
    expect(result.status).toBe(200);
    expect(result.body.reused).toBe(true);
    expect(report.count).toBe(1);
  });

  it('a first generation (no stored analysis) never reads or spends the count', async () => {
    const report = { count: 3 };
    const result = await regenerate({ anchor: false, requestId: null }, report);
    expect(result.status).toBe(200);
    expect(result.rpcs).toEqual(['read_interpretation_for_server', 'save_interpretation']);
    expect(report.count).toBe(3);
  });

  it('a count that cannot be recorded leaves the written version standing: 200, logged, attempt not spent', async () => {
    const report = { count: 1 };
    const result = await regenerate({ recordError: true }, report);
    expect(result.status).toBe(200);
    expect(result.body.success).toBe(true);
    expect(report.count).toBe(1);
    expect(warnings.some(w => w.includes('count not recorded'))).toBe(true);
  });
});

describe('PK-REGEN-01: the fourth regeneration is refused by the server', () => {
  it.each(PLANS)('three regenerations succeed, the fourth is refused before any model spend (%s)', async plan => {
    const report = { count: 0 };
    for (let i = 1; i <= 3; i++) {
      const ok = await regenerate({ plan, claim: plan === 'free' }, report);
      expect(ok.status, `regeneration ${i}`).toBe(200);
      expect(report.count).toBe(i);
    }
    const refused = await regenerate({ plan, claim: plan === 'free' }, report);
    expect(refused.status).toBe(400);
    expect(refused.body).toEqual({ error: 'regeneration_limit_reached' });
    expect(refused.tryOpenAI).not.toHaveBeenCalled();
    expect(refused.rpcs).toEqual(['read_interpretation_for_server']);
    expect(refused.writes).toEqual([]);
    expect(report.count).toBe(3);
    // The calm outcome the client already shows: a new analysis isn't available, the current one is unchanged.
    expect(classifyRegenerationFailure(refused.status, refused.body)).toBe('unavailable');
  });

  it('a count reset through the API is no longer possible, and a stale client cannot talk past the server', async () => {
    // The client's own number is not consulted: only the stored count is.
    const refused = await regenerate({}, { count: 7 });
    expect(refused.status).toBe(400);
  });

  it('a count that cannot be read fails closed: no model spend, nothing written, no "error" brand', async () => {
    const report = { count: 0 };
    const result = await regenerate({ countReadError: true }, report);
    expect(result.status).toBe(500);
    expect(result.tryOpenAI).not.toHaveBeenCalled();
    expect(result.writes).toEqual([]);
  });

  it('the fuller-analysis offer on a stored analysis that is not yet deep is neither counted nor refused', async () => {
    const report = { count: 3 };
    const result = await regenerate({ purpose: 'fuller_analysis', storedDepth: 'standard' }, report);
    expect(result.status).toBe(200);
    expect(report.count).toBe(3);
    expect(result.rpcs).not.toContain('record_regeneration');
  });

  it('the fuller-analysis label on an analysis that is already deep is an ordinary regeneration: counted, then refused', async () => {
    const report = { count: 2 };
    expect((await regenerate({ purpose: 'fuller_analysis', storedDepth: 'deep' }, report)).status).toBe(200);
    expect(report.count).toBe(3);
    expect((await regenerate({ purpose: 'fuller_analysis', storedDepth: 'deep' }, report)).status).toBe(400);
  });

  it('the request schema refuses a purpose it does not know (no "correction" until PK-CORRECT-01)', async () => {
    const result = await regenerate({ purpose: 'correction' }, { count: 3 });
    expect(result.status).toBe(400);
    expect(result.body.error).toBe('Invalid request body');
  });

  // Negative controls, in memory against mutated handler source.
  it('negative control: without the server-side check the fourth regeneration is generated and written', async () => {
    const check = 'if (limitActions && !(await admitRegeneration(limitActions)).admitted) {';
    expect(source.split(check)).toHaveLength(2);
    const report = { count: 3 };
    const result = await regenerate({}, report, source.replace(check, 'if (false) {'));
    expect(result.status).toBe(200);
    expect(result.tryOpenAI).toHaveBeenCalled();
    expect(report.count).toBe(4);
  });

  it('negative control: counting before the write spends an attempt on a no-write failure', async () => {
    const record = 'if (limitActions) await recordRegeneration(limitActions, { counted: countedRegeneration, created: appended?.created === true });';
    const admit = 'if (limitActions && !(await admitRegeneration(limitActions)).admitted) {';
    expect(source.split(record)).toHaveLength(2);
    const early = source.replace(record, '').replace(admit,
      'if (limitActions) await recordRegeneration(limitActions, { counted: true, created: true });\n    ' + admit);
    const report = { count: 1 };
    const result = await regenerate({ model: null }, report, early);
    expect(result.status).toBe(503);
    expect(report.count).toBe(2);
  });
});
