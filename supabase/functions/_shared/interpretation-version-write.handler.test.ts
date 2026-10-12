import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import { buildBasicProjection } from './interpretation-visibility';
import {
  findFloorViolations, shapeInterpretation, shouldGenerateDeepInterpretation, shouldRequestDeepInterpretation,
} from './response-shaping';
import { projectBasic, servedBasic, visibleClaimProjection, withClaimAuthority } from './claim-authority';
import { buildTrendEvidence } from './trend-evidence';
import { resolveTier } from './tier';
import { entitlementUnavailable, generationVisibilityMode } from './entitlement-response';
import * as versionWrite from './interpretation-version-write';

/**
 * TASK-048 turn 10: executes the real generate-interpretation handler, the real
 * shared pipeline and the real version-store wiring from source (the
 * entitlement-response.test.ts technique), against a fake Supabase that records
 * every RPC and write. Proves the cutover wiring, not the SQL: the writer is a
 * fake here and SQL-proven in
 * supabase/migrations/__verification__/interpretation-versions.writer.sql.
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

// The model tries to author a server-owned key; claim authority must replace it.
const generated = () => ({
  headline: 'Current-policy headline', questions_for_doctor: [], disclaimer: 'd', key_findings: [],
  cycle_context: { estimated_cycle_day: 3, estimated_cycle_phase: 'pregnancy_t2', confidence: 'high', explanation: 'model prose' },
  clinical_claims: 'model forged',
});
const ANALYTE = {
  id: 'a1', raw_name: 'TSH', canonical_slug: 'tsh', value_numeric: 9, raw_value_text: '9', unit: 'mIU/L',
  raw_reference_range: '0.4-4.0', normalized_min: 0.4, normalized_max: 4.0, normalized_operator: null,
  normalized_operator_value: null, is_core: true,
};
const COMMITTED = { id: 'v0', historical_interpretation_id: HISTORY, generated_at: '2026-10-10T00:00:00Z',
  json_output: { headline: 'committed version' }, json_output_basic: { headline: 'committed basic' } };

type Rpc = { name: string; args: Record<string, unknown> };
interface Scenario {
  anchor?: boolean;
  committed?: boolean;
  appendError?: { code: string; message: string };
  twinAfterReuse?: boolean;
}
function fakeSupabase(opts: Scenario) {
  const rpcs: Rpc[] = [];
  const writes: string[] = [];
  let twinVisible = false;
  const reply = (table: string, selection: string) => {
    if (table === 'lab_reports') {
      if (selection === 'id, user_id') return { id: REPORT, user_id: USER };
      return selection.includes('context') ? { id: REPORT, report_date: '2026-09-26', estimated_cycle_day: 21, estimated_cycle_phase: 'luteal' } : null;
    }
    if (table === 'report_analytes') return [ANALYTE];
    if (table === 'interpretation_visibility_config') return { enabled: true };
    if (table === 'interpretation_versions') return opts.committed || twinVisible ? COMMITTED : null;
    return null;
  };
  const from = (table: string) => {
    let selection = '';
    const query: Record<string, unknown> = {};
    for (const method of ['eq', 'neq', 'lt', 'order', 'limit', 'is']) query[method] = () => query;
    for (const method of ['update', 'insert', 'upsert', 'delete']) {
      query[method] = (value: unknown) => { writes.push(`${method}:${table}:${JSON.stringify(value)}`); return query; };
    }
    query.select = (value: string) => { selection = value; return query; };
    query.maybeSingle = async () => ({ data: reply(table, selection), error: null });
    query.single = query.maybeSingle;
    query.then = (done: (v: unknown) => void) => Promise.resolve({ data: reply(table, selection), error: null }).then(done);
    return query;
  };
  const rpc = async (name: string, args: Record<string, unknown>) => {
    rpcs.push({ name, args });
    if (name === 'read_interpretation_for_server') return { data: opts.anchor ? [{ json_output: {} }] : [], error: null };
    if (name === 'append_interpretation_version') {
      if (opts.appendError) {
        twinVisible = !!opts.twinAfterReuse;
        return { data: null, error: opts.appendError };
      }
      return { data: [{ version_id: 'v1', history_id: HISTORY, version_generated_at: '2026-10-11T00:00:00Z' }], error: null };
    }
    if (name === 'save_interpretation') return { data: null, error: null };
    return { data: null, error: { code: 'XX000', message: `unexpected rpc ${name}` } };
  };
  return { client: { from, rpc, auth: { getUser: async () => ({ data: { user: { id: USER } }, error: null }) } }, rpcs, writes };
}

const CUTOVER = 'const appendsVersion = await hasAnchor(supabase, user.id, reportId);';
const REQUIRE_REQUEST = 'if (appendsVersion && requestId === null) {';

function buildHandler(handlerSource: string, model: Record<string, unknown> | null, flagOn: boolean, client: unknown) {
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
    + '\nsink.v = { hasAnchor, findRequestVersion, appendVersion };', { sink, ...versionWrite });
  let handler: (req: Request) => Promise<Response> = async () => new Response(null, { status: 500 });
  const recordGenerationCosts = vi.fn(async () => {});
  const noCall = vi.fn(() => { throw new Error('Free ledger reached'); });
  evaluate(handlerSource.slice(handlerSource.indexOf('Deno.serve(')), {
    Deno: { env: { get: (name: string) => name === 'OPENAI_API_KEY' ? 'test-key' : undefined },
      serve: (fn: typeof handler) => { handler = fn; } },
    createClient: () => client, corsHeaders: {}, debugLog: () => {}, enforceRateLimit: async () => {}, createRateLimitStore: () => ({}),
    GenerateInterpretationRequestSchema: { safeParse: (body: { reportId: string; request_id?: string }) =>
      ({ success: true, data: { reportId: body.reportId, request_id: body.request_id } }) },
    checkUserSubscription: async () => flagOn
      ? { allowed: true, plan: 'premium', reason: 'active_subscription', source: 'active_subscription' }
      : { allowed: true, reason: 'trial' },
    freemiumActive: () => flagOn, generationVisibilityMode, entitlementUnavailable, resolveTier,
    shouldGenerateDeepInterpretation, decideIntroductoryAccess: noCall, commitGeneratedInterpretation: noCall,
    deriveBloodDrawIdentity: noCall, hashDrawKey: noCall, recordGenerationCosts,
    isRateLimitExceeded: () => false, errorMessage: String, servedBasic, visibleClaimProjection,
    ...versionWrite, ...(sink.p as object), ...(sink.v as object),
  });
  return { handler, tryOpenAI, noCall };
}

async function call(scenario: Scenario & { model?: Record<string, unknown> | null; flagOn?: boolean; requestId?: string | null;
  handlerSource?: string }) {
  const fake = fakeSupabase(scenario);
  const { handler, tryOpenAI, noCall } = buildHandler(scenario.handlerSource ?? source,
    scenario.model === undefined ? generated() : scenario.model, !!scenario.flagOn, fake.client);
  const silence = [vi.spyOn(console, 'log'), vi.spyOn(console, 'warn'), vi.spyOn(console, 'error')]
    .map(spy => spy.mockImplementation(() => {}));
  try {
    const body: Record<string, unknown> = { reportId: REPORT };
    const requestId = scenario.requestId === undefined ? REQUEST : scenario.requestId;
    if (requestId !== null) body.request_id = requestId;
    const response = await handler(new Request('https://example.invalid', {
      method: 'POST', headers: { Authorization: 'Bearer test' }, body: JSON.stringify(body) }));
    return { ...fake, response, body: await response.json(), tryOpenAI, noCall };
  } finally {
    silence.forEach(spy => spy.mockRestore());
  }
}

const names = (rpcs: Rpc[]) => rpcs.map(r => r.name);

describe('generate-interpretation V2 version cutover (executed from source)', () => {
  const run = call;

  it.each([false, true])('a report with an anchor appends a version, never save_interpretation (flag on: %s)', async flagOn => {
    const result = await run({ anchor: true, flagOn });
    expect(result.response.status).toBe(200);
    expect(names(result.rpcs)).toEqual(['read_interpretation_for_server', 'append_interpretation_version']);
    const args = result.rpcs[1].args;
    expect(args).toMatchObject({ p_user_id: USER, p_report_id: REPORT, p_request_id: REQUEST, p_depth: 'deep',
      p_disclaimer: '1.0', p_provenance: { pipeline: 'generate-interpretation', mode: 'regeneration', claim_policy_version: 'v2-03c.1' } });
    const full = args.p_full as Record<string, unknown>;
    // V2-03c claim authority ran in both switch states: the model's forged key is gone.
    expect(full.clinical_claims).not.toBe('model forged');
    expect(full).toHaveProperty('findings');
    expect(full).toHaveProperty('claim_audit');
    expect(args.p_basic).toEqual(projectBasic(full, { source: 'ai' }));
    expect(result.body).toMatchObject({ success: true, source: 'ai', reused: false,
      historical_interpretation_id: HISTORY, version: { id: 'v1', generated_at: '2026-10-11T00:00:00Z' } });
    expect(result.body).not.toHaveProperty('id');
    // Only the report status is written; never the interpretation, a claim or a counter.
    expect(result.writes).toEqual([`update:lab_reports:${JSON.stringify({ status: 'ready' })}`]);
    expect(result.noCall).not.toHaveBeenCalled();
  });

  it('a report without an anchor keeps today\'s first-generation path; the writer is never called', async () => {
    const result = await run({ anchor: false, requestId: null });
    expect(result.response.status).toBe(200);
    expect(names(result.rpcs)).toEqual(['read_interpretation_for_server', 'save_interpretation']);
    expect(result.body).toEqual({ success: true, source: 'ai' });
    // Flag off, first generation: the inactive payload, unchanged (no claim authority).
    expect(result.rpcs[1].args.p_interpretation).not.toHaveProperty('findings');
  });

  it('a regeneration of an existing row without a request_id is 400 before any model spend', async () => {
    const result = await run({ anchor: true, requestId: null });
    expect(result.response.status).toBe(400);
    expect(result.body).toEqual({ error: 'request_id_required' });
    expect(result.tryOpenAI).not.toHaveBeenCalled();
    expect(names(result.rpcs)).toEqual(['read_interpretation_for_server']);
    expect(result.writes).toEqual([]);
  });

  it('a retried request is served from the version store without a second write or model call', async () => {
    const result = await run({ anchor: true, committed: true });
    expect(result.response.status).toBe(200);
    expect(result.tryOpenAI).not.toHaveBeenCalled();
    expect(names(result.rpcs)).toEqual(['read_interpretation_for_server']);
    expect(result.body).toEqual({ success: true, source: 'ai', reused: true,
      historical_interpretation_id: HISTORY, version: { id: 'v0', generated_at: '2026-10-10T00:00:00Z' } });
  });

  it('a failed model persists nothing and never falls back to stored or deterministic prose', async () => {
    const result = await run({ anchor: true, model: null });
    expect(result.response.status).toBe(503);
    expect(result.body).toEqual({ error: 'regeneration_failed', retryable: true });
    expect(names(result.rpcs)).toEqual(['read_interpretation_for_server']);
    expect(result.writes).toEqual([]);
    expect(JSON.stringify(result.body)).not.toContain('deterministic fallback');
  });

  it('a floor violation is refused rather than appended permanently', async () => {
    const { questions_for_doctor: _dropped, ...withoutQuestions } = generated();
    const result = await run({ anchor: true, model: withoutQuestions });
    expect(result.response.status).toBe(503);
    expect(names(result.rpcs)).toEqual(['read_interpretation_for_server']);
  });

  it('maps writer refusals: 55000 to 409 without branding the report; a committed twin is served', async () => {
    const protectedResult = await run({ anchor: true, appendError: { code: '55000', message: 'immutable' } });
    expect(protectedResult.response.status).toBe(409);
    expect(protectedResult.body).toEqual({ error: 'legacy_history_protected' });
    expect(protectedResult.writes).toEqual([]);
    const twin = await run({ anchor: true, appendError: { code: '22023', message: 'reused' }, twinAfterReuse: true });
    expect(twin.response.status).toBe(200);
    expect(twin.body).toMatchObject({ reused: true, version: { id: 'v0' } });
    const failed = await run({ anchor: true, appendError: { code: '40001', message: 'stale' } });
    expect(failed.response.status).toBe(500);
    expect(failed.writes).toEqual([]);
  });

  // Negative controls, executed and reverted in memory: each mutation of the
  // handler source must turn the corresponding proof red.
  it('negative control: with the cutover disabled the in-place writer is reached', async () => {
    expect(source.split(CUTOVER)).toHaveLength(2);
    const mutated = source.replace(CUTOVER, 'const appendsVersion = false;');
    const result = await run({ anchor: true, handlerSource: mutated });
    expect(names(result.rpcs)).toContain('save_interpretation');
    expect(names(result.rpcs)).not.toContain('append_interpretation_version');
  });

  it('negative control: without the request_id check a regeneration proceeds unkeyed', async () => {
    expect(source.split(REQUIRE_REQUEST)).toHaveLength(2);
    const mutated = source.replace(REQUIRE_REQUEST, 'if (false) {');
    const result = await run({ anchor: true, requestId: null, handlerSource: mutated });
    expect(result.response.status).not.toBe(400);
    expect(result.tryOpenAI).toHaveBeenCalled();
  });
});
