import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import { buildBasicProjection } from './interpretation-visibility';
import {
  decideDeepGeneration, findFloorViolations, shapeInterpretation, shouldRequestDeepInterpretation,
} from './response-shaping';
import { projectBasic, servedBasic, visibleClaimProjection, withClaimAuthority } from './claim-authority';
import { buildTrendEvidence } from './trend-evidence';
import { resolveTier } from './tier';
import { entitlementUnavailable, generationVisibilityMode } from './entitlement-response';
import { commitGeneratedInterpretation, decideIntroductoryAccess } from './introductory-access';
import { deriveBloodDrawIdentity, hashDrawKey } from './blood-draw-identity';
import { isRateLimitExceeded, RATE_LIMIT_EXCEEDED } from './rate-limit';
import { readInterpretation } from './interpretation-read';
import * as versionWrite from './interpretation-version-write';

/**
 * PK-PL-A (owner-ruled pre-launch items b and c), executed from source like
 * interpretation-version-write.handler.test.ts: the real generate-interpretation
 * handler, shared pipeline, introductory ledger flow and version-store wiring,
 * against a fake Supabase that records every table write and every RPC.
 *
 * (b) A regeneration that fails writes nothing: no version, no claim, no
 *     attempt counter (`regeneration_count`), and no `status: 'error'` brand on
 *     a report whose interpretation is intact — for every failure outcome, in
 *     both flag states. The SQL half (every refusal of the writer and ledger RPCs
 *     leaves the report row, claims and store byte-identical) is harness §12,
 *     interpretation-versions.no-attempt.sql.
 * (c) get-interpretation's `regeneration` agrees with what this handler does for
 *     the same facts: `unavailable` exactly when it refuses as not retryable.
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

const USER = 'u';
const REPORT = '0a8b4d6e-1f2a-4b3c-8d9e-000000000001';
const REQUEST = '0a8b4d6e-1f2a-4b3c-8d9e-0f1a2b3c4d5e';
const HISTORY = 'h';
const OFFLINE = { code: 'XX000', message: 'synthetic outage' };
const generated = () => ({
  headline: 'Current-policy headline', questions_for_doctor: [], disclaimer: 'd', key_findings: [],
  cycle_context: { estimated_cycle_day: 3, estimated_cycle_phase: 'luteal', confidence: 'high', explanation: 'model prose' },
});
const ANALYTE = {
  id: 'a1', raw_name: 'TSH', canonical_slug: 'tsh', value_numeric: 9, raw_value_text: '9', unit: 'mIU/L',
  raw_reference_range: '0.4-4.0', normalized_min: 0.4, normalized_max: 4.0, normalized_operator: null,
  normalized_operator_value: null, is_core: true,
};
const COMMITTED = { id: 'v0', historical_interpretation_id: HISTORY, generated_at: '2026-10-10T00:00:00Z',
  json_output: { headline: 'committed version' }, json_output_basic: { headline: 'committed basic' } };

type Entitlement = 'allowed' | 'blocked' | 'onboarding' | 'error';
interface Scenario {
  flagOn?: boolean;
  /** Free tier (flag on): the real introductory ledger flow runs. */
  free?: boolean;
  entitlement?: Entitlement;
  anchor?: boolean;
  committed?: boolean;
  claim?: boolean;
  claimCount?: number;
  ledgerOutcome?: 'committed' | 'already_claimed' | 'limit_reached';
  ledgerError?: { code: string; message: string };
  appendError?: { code: string; message: string };
  anchorReadError?: boolean;
  versionReadError?: boolean;
  claimReadError?: boolean;
  identityReadError?: boolean;
  rateLimited?: boolean;
  postLimitGeneration?: string;
  model?: Record<string, unknown> | null;
  requestId?: string | null;
  handlerSource?: string;
}
type Rpc = { name: string; args: Record<string, unknown> };

function fakeSupabase(opts: Scenario) {
  const rpcs: Rpc[] = [];
  const writes: { method: string; table: string; value: unknown }[] = [];
  const claimRow = { user_id: USER, blood_draw_id: 'd', report_id: REPORT, evidence_tier: 'content_hash', claimed_at: '2026-10-01T00:00:00Z' };
  const reply = (table: string, selection: string): { data: unknown; error: unknown } => {
    if (table === 'lab_reports') {
      if (selection === 'id, user_id') return { data: { id: REPORT, user_id: USER }, error: null };
      if (selection === 'file_url, content_hash') {
        return opts.identityReadError ? { data: null, error: OFFLINE } : { data: { file_url: null, content_hash: 'c'.repeat(64) }, error: null };
      }
      return { data: selection.includes('context')
        ? { id: REPORT, report_date: '2026-09-26', estimated_cycle_day: 21, estimated_cycle_phase: 'luteal' } : null, error: null };
    }
    if (table === 'report_analytes') return { data: [ANALYTE], error: null };
    if (table === 'interpretation_visibility_config') return { data: { enabled: true }, error: null };
    if (table === 'interpretation_versions') {
      return opts.versionReadError ? { data: null, error: OFFLINE } : { data: opts.committed ? COMMITTED : null, error: null };
    }
    if (table === 'introductory_deep_access_claims') {
      return opts.claimReadError ? { data: null, error: OFFLINE } : { data: opts.claim ? claimRow : null, error: null };
    }
    return { data: null, error: null };
  };
  const from = (table: string) => {
    let selection = '';
    const query: Record<string, unknown> = {};
    for (const method of ['eq', 'neq', 'lt', 'order', 'limit', 'is', 'or']) query[method] = () => query;
    for (const method of ['update', 'insert', 'upsert', 'delete']) {
      query[method] = (value: unknown) => { writes.push({ method, table, value }); return query; };
    }
    query.select = (value: string) => { selection = value; return query; };
    query.maybeSingle = async () => reply(table, selection);
    query.single = query.maybeSingle;
    query.then = (done: (v: unknown) => void) => Promise.resolve({ ...reply(table, selection),
      count: table === 'introductory_deep_access_claims' && !opts.claimReadError ? (opts.claimCount ?? (opts.claim ? 1 : 0)) : null,
    }).then(done);
    return query;
  };
  const rpc = async (name: string, args: Record<string, unknown>) => {
    rpcs.push({ name, args });
    if (name === 'read_interpretation_for_server') {
      if (opts.anchorReadError) return { data: null, error: OFFLINE };
      return { data: opts.anchor ? [{ json_output: {}, has_claim: !!opts.claim }] : [], error: null };
    }
    if (name === 'append_interpretation_version') {
      if (opts.appendError) return { data: null, error: opts.appendError };
      return { data: [{ version_id: 'v1', history_id: HISTORY, version_generated_at: '2026-10-11T00:00:00Z' }], error: null };
    }
    if (name === 'commit_deep_access_version') {
      if (opts.ledgerError) return { data: null, error: opts.ledgerError };
      const outcome = opts.ledgerOutcome ?? (opts.claim ? 'already_claimed' : 'committed');
      return { data: [outcome === 'limit_reached'
        ? { outcome, version_id: null, history_id: null, version_generated_at: null }
        : { outcome, version_id: 'v2', history_id: HISTORY, version_generated_at: '2026-10-11T01:00:00Z' }], error: null };
    }
    if (name === 'commit_deep_access_v2') return { data: opts.ledgerOutcome ?? (opts.claim ? 'already_claimed' : 'committed'), error: null };
    if (name === 'save_interpretation') return { data: null, error: null };
    return { data: null, error: { code: 'XX000', message: `unexpected rpc ${name}` } };
  };
  return { client: { from, rpc, auth: { getUser: async () => ({ data: { user: { id: USER } }, error: null }) } }, rpcs, writes };
}

function entitlementFor(opts: Scenario, active: boolean) {
  const kind = opts.entitlement ?? 'allowed';
  if (kind === 'error') return { allowed: false, reason: 'error', detail: 'synthetic outage' };
  if (kind === 'onboarding') return { allowed: false, reason: 'onboarding_incomplete' };
  if (kind === 'blocked') return { allowed: false, reason: 'no_subscription' };
  if (!active) return { allowed: true, reason: 'trial' };
  return opts.free ? { allowed: true, plan: 'free', reason: 'free_plan', source: 'free' }
    : { allowed: true, plan: 'premium', reason: 'active_subscription', source: 'active_subscription' };
}

async function run(opts: Scenario) {
  const fake = fakeSupabase(opts);
  const flagOn = !!opts.flagOn || !!opts.free;
  const model = opts.model === undefined ? generated() : opts.model;
  const sink: Record<string, unknown> = {};
  evaluate(slice(source, 'function classifyAnalyte(', 'function displayVal(') + '\nsink.a = { classifyAnalyte, slug };', { sink });
  evaluate(slice(source, 'function deterministicCycleFacts(', 'function generateFallbackInterpretation(')
    + '\nsink.c = { deterministicCycleFacts, modelCycleExplanation };', { sink });
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
  evaluate(slice(source, '// ─── Version store', '// ─── Handler')
    + '\nsink.v = { readAnchor, findRequestVersion, appendVersion, commitLedgerVersion };', { sink, ...versionWrite });
  let handler: (req: Request) => Promise<Response> = async () => new Response(null, { status: 500 });
  const handlerSource = opts.handlerSource ?? source;
  evaluate(handlerSource.slice(handlerSource.indexOf('Deno.serve(')), {
    Deno: { env: { get: (name: string) => name === 'OPENAI_API_KEY' ? 'test-key'
      : name === 'FREEMIUM_POST_LIMIT_GENERATION' ? opts.postLimitGeneration : undefined },
    serve: (fn: typeof handler) => { handler = fn; } },
    createClient: () => fake.client, corsHeaders: {}, debugLog: () => {}, createRateLimitStore: () => ({}),
    enforceRateLimit: async () => { if (opts.rateLimited) throw new Error(RATE_LIMIT_EXCEEDED); },
    GenerateInterpretationRequestSchema: { safeParse: (body: { reportId: string; request_id?: string }) =>
      ({ success: true, data: { reportId: body.reportId, request_id: body.request_id } }) },
    checkUserSubscription: async (_client: unknown, _user: string, active: boolean) => entitlementFor(opts, active),
    freemiumActive: () => flagOn, generationVisibilityMode, entitlementUnavailable, resolveTier,
    decideDeepGeneration, decideIntroductoryAccess, commitGeneratedInterpretation, deriveBloodDrawIdentity, hashDrawKey,
    recordGenerationCosts: vi.fn(async () => {}), isRateLimitExceeded, errorMessage: String, servedBasic, visibleClaimProjection,
    ...versionWrite, ...(sink.p as object), ...(sink.v as object),
  });
  const silence = [vi.spyOn(console, 'log'), vi.spyOn(console, 'warn'), vi.spyOn(console, 'error')]
    .map(spy => spy.mockImplementation(() => {}));
  try {
    const body: Record<string, unknown> = { reportId: REPORT };
    const requestId = opts.requestId === undefined ? REQUEST : opts.requestId;
    if (requestId !== null) body.request_id = requestId;
    const response = await handler(new Request('https://example.invalid', {
      method: 'POST', headers: { Authorization: 'Bearer test' }, body: JSON.stringify(body) }));
    return { ...fake, status: response.status, body: await response.json() as Record<string, unknown>, tryOpenAI };
  } finally {
    silence.forEach(spy => spy.mockRestore());
  }
}

/** RPCs that persist when they succeed. A limit_reached ledger answer persisted nothing (harness §11/§12). */
const PERSISTING = ['append_interpretation_version', 'commit_deep_access_version', 'commit_deep_access_v2', 'save_interpretation'];
const persisted = (result: Awaited<ReturnType<typeof run>>) => result.rpcs.map(r => r.name).filter(n => PERSISTING.includes(n));

// Every regeneration failure outcome the handler has, with the answer it gives.
const FAILURES: [string, Scenario, number, Record<string, unknown> | null][] = [
  ['400 request_id_required (anchored, unkeyed)', { anchor: true, requestId: null }, 400, { error: 'request_id_required' }],
  ['402 flag off, not entitled', { anchor: true, entitlement: 'blocked' }, 402, null],
  ['402 flag on, onboarding incomplete', { anchor: true, flagOn: true, entitlement: 'onboarding' }, 402, null],
  ['429 daily limit', { anchor: true, rateLimited: true }, 429, null],
  ['503 entitlement unavailable', { anchor: true, flagOn: true, entitlement: 'error' }, 503, { code: 'entitlement_unavailable', retryable: true }],
  ['503 model failure, flag off', { anchor: true, model: null }, 503, { error: 'regeneration_failed', retryable: true }],
  ['503 model failure, Premium', { anchor: true, flagOn: true, model: null }, 503, { error: 'regeneration_failed', retryable: true }],
  ['503 model failure, Free with a credit', { anchor: true, free: true, claimCount: 1, model: null }, 503, { error: 'regeneration_failed', retryable: true }],
  ['503 floor violation', { anchor: true, model: { headline: 'no floor' } }, 503, { error: 'regeneration_failed', retryable: true }],
  ['503 Free limit reached at commit', { anchor: true, free: true, claimCount: 2, ledgerOutcome: 'limit_reached' }, 503,
    { error: 'regeneration_failed', retryable: true }],
  ['503 Free post-limit, on_demand (cannot succeed)', { anchor: true, free: true, claimCount: 3, postLimitGeneration: 'on_demand' }, 503,
    { error: 'regeneration_failed', retryable: false }],
  ['409 writer refused (55000)', { anchor: true, appendError: { code: '55000', message: 'immutable' } }, 409, { error: 'legacy_history_protected' }],
  ['409 ledger refused (55000)', { anchor: true, free: true, claim: true, ledgerError: { code: '55000', message: 'immutable' } }, 409,
    { error: 'legacy_history_protected' }],
  ['500 writer failed (40001)', { anchor: true, appendError: { code: '40001', message: 'stale' } }, 500, { error: 'Failed to save interpretation' }],
  ['500 ledger failed (40001)', { anchor: true, free: true, claim: true, ledgerError: { code: '40001', message: 'stale' } }, 500,
    { error: 'Failed to save interpretation' }],
  ['500 anchor read failed (keyed request)', { anchor: true, anchorReadError: true }, 500, { error: 'Internal server error' }],
  ['500 version-store read failed', { anchor: true, versionReadError: true }, 500, { error: 'Internal server error' }],
  ['500 Free claim read failed', { anchor: true, free: true, claimReadError: true }, 500, { error: 'Internal server error' }],
  ['500 Free draw identity read failed', { anchor: true, free: true, identityReadError: true }, 500, { error: 'Internal server error' }],
];

describe('PK-PL-A (b): a regeneration that fails writes nothing — no version, claim, attempt or error brand', () => {
  it.each(FAILURES)('%s', async (_name, scenario, status, body) => {
    const result = await run(scenario);
    expect(result.status).toBe(status);
    if (body) expect(result.body).toEqual(body);
    // Not one table write: no status (neither "error" nor anything else), no
    // regeneration_count, no claim row, no interpretation.
    expect(result.writes).toEqual([]);
    // Nothing persisted through an RPC either; the one ledger call allowed is the
    // limit_reached answer, which persists nothing by contract.
    expect(persisted(result).filter(n => !(scenario.ledgerOutcome === 'limit_reached' && n === 'commit_deep_access_version'))).toEqual([]);
  });

  it('a refusal that cannot succeed spends no model call', async () => {
    const result = await run({ anchor: true, free: true, claimCount: 3, postLimitGeneration: 'on_demand' });
    expect(result.body).toEqual({ error: 'regeneration_failed', retryable: false });
    expect(result.tryOpenAI).not.toHaveBeenCalled();
  });

  it.each([false, true])('success writes only the report status — the server never consumes the attempt counter (flag on: %s)', async flagOn => {
    const result = await run({ anchor: true, flagOn });
    expect(result.status).toBe(200);
    expect(result.writes).toEqual([{ method: 'update', table: 'lab_reports', value: { status: 'ready' } }]);
    expect(JSON.stringify(result.writes)).not.toContain('regeneration_count');
  });

  it('a first generation that fails is still marked error (unchanged behaviour)', async () => {
    const result = await run({ anchor: false, free: true, claimReadError: true, requestId: null });
    expect(result.status).toBe(500);
    expect(result.writes).toEqual([{ method: 'update', table: 'lab_reports', value: { status: 'error' } }]);
  });

  it('negative control: without the regeneration guard, a failed regeneration brands an intact report', async () => {
    const guard = 'if (reportId && !regeneration) {';
    expect(source.split(guard)).toHaveLength(2);
    const result = await run({ anchor: true, versionReadError: true, handlerSource: source.replace(guard, 'if (reportId) {') });
    expect(result.status).toBe(500);
    expect(result.writes).toEqual([{ method: 'update', table: 'lab_reports', value: { status: 'error' } }]);
  });
});

describe('PK-PL-A (c): get-interpretation `regeneration` is what generate-interpretation does', () => {
  const FACTS = [
    { name: 'Premium', free: false, claim: false, used: 3 },
    { name: 'Free, claim on the report', free: true, claim: true, used: 3 },
    { name: 'Free, credit left', free: true, claim: false, used: 2 },
    { name: 'Free, post-limit', free: true, claim: false, used: 3 },
  ];
  const POST_LIMIT = [undefined, 'always', 'on_demand', 'invalid'];

  async function outcomes(handlerSource?: string) {
    const rows: { case: string; handler: string; reader: string | undefined }[] = [];
    for (const facts of FACTS) for (const postLimitGeneration of POST_LIMIT) {
      const result = await run({ anchor: true, flagOn: true, free: facts.free, claim: facts.claim, claimCount: facts.used,
        postLimitGeneration, handlerSource });
      const read = await readInterpretation({
        ownsReport: async () => true,
        resolveEntitlement: async () => entitlementFor({ free: facts.free }, true) as never,
        readSelected: async () => ({ json_output: { headline: 'stored' }, stored_depth: 'standard', has_claim: facts.claim, tier: 'free',
          interpretation_source: 'fallback' }),
        countClaims: async () => facts.used,
        postLimitGeneration,
      }, true);
      rows.push({ case: `${facts.name} / post-limit ${String(postLimitGeneration)}`,
        handler: result.status === 200 ? 'available' : result.status === 503 && result.body.retryable === false ? 'unavailable' : `other ${result.status}`,
        reader: read.body.regeneration });
    }
    return rows;
  }

  it('agrees for every viewer and post-limit setting, and both outcomes occur', async () => {
    const rows = await outcomes();
    for (const row of rows) expect(row.reader, row.case).toBe(row.handler);
    expect(new Set(rows.map(r => r.handler))).toEqual(new Set(['available', 'unavailable']));
  });

  it('negative control: a handler that decides depth without the ledger decision disagrees with the reader', async () => {
    const anchor = 'freemiumActive: active, tier: tierDecision.tier, decision: accessDecision,';
    expect(source.split(anchor)).toHaveLength(2);
    const rows = await outcomes(source.replace(anchor, 'freemiumActive: active, tier: tierDecision.tier, decision: null,'));
    expect(rows.some(row => row.reader !== row.handler)).toBe(true);
  });
});
