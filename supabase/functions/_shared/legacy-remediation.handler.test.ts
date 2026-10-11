import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import { buildBasicProjection } from './interpretation-visibility';
import { findFloorViolations, shapeInterpretation, shouldRequestDeepInterpretation } from './response-shaping';
import { projectBasic, visibleClaimProjection, withClaimAuthority } from './claim-authority';
import { buildTrendEvidence } from './trend-evidence';
import * as remediation from './legacy-remediation';

/**
 * Executes the real generate-interpretation remediation wiring and the real
 * shared pipeline from source (the entitlement-response.test.ts technique), with
 * a fake Supabase that records every table, write and RPC. Proves the wiring,
 * not the SQL: eligibility and the append are fakes here and SQL-proven in
 * supabase/migrations/__verification__/interpretation-versions.remediation.sql.
 */

const source = readFileSync(new URL('../generate-interpretation/index.ts', import.meta.url), 'utf8');
function evaluate(fragment: string, values: Record<string, unknown>) {
  const { code } = transformSync(fragment, { loader: 'ts', target: 'es2022' });
  return new Function(...Object.keys(values), code)(...Object.values(values));
}
function slice(startMarker: string, endMarker: string) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  expect(start).toBeGreaterThan(0);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

const USER = 'u';
const REPORT = 'r';
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

type Rpc = { name: string; args: Record<string, unknown> };
function fakeSupabase(opts: {
  eligible?: boolean;
  existing?: Record<string, unknown> | null;
  appendError?: { code: string; message: string };
} = {}) {
  const rpcs: Rpc[] = [];
  const tables: string[] = [];
  const writes: string[] = [];
  const reply = (table: string, selection: string) => table === 'lab_reports'
    ? selection.includes('context') ? { id: REPORT, report_date: '2026-09-26', estimated_cycle_day: 21, estimated_cycle_phase: 'luteal' } : null
    : table === 'report_analytes' ? [ANALYTE]
      : table === 'interpretation_versions' ? opts.existing ?? null : null;
  const from = (table: string) => {
    tables.push(table);
    let selection = '';
    const query: Record<string, unknown> = {};
    for (const method of ['eq', 'neq', 'lt', 'order', 'limit', 'is']) query[method] = () => query;
    for (const method of ['update', 'insert', 'upsert', 'delete']) query[method] = () => { writes.push(`${method}:${table}`); return query; };
    query.select = (value: string) => { selection = value; return query; };
    query.maybeSingle = async () => ({ data: reply(table, selection), error: null });
    query.single = query.maybeSingle;
    query.then = (done: (v: unknown) => void) => Promise.resolve({ data: reply(table, selection), error: null }).then(done);
    return query;
  };
  const rpc = async (name: string, args: Record<string, unknown>) => {
    rpcs.push({ name, args });
    if (name === 'evaluate_legacy_remediation') {
      return { data: [opts.eligible === false ? { eligible: false, history_id: null, claim_id: null }
        : { eligible: true, history_id: HISTORY, claim_id: 'c' }], error: null };
    }
    if (name === 'append_remediation_version') {
      return opts.appendError ? { data: null, error: opts.appendError }
        : { data: [{ version_id: 'v1', history_id: HISTORY, version_generated_at: '2026-10-11T00:00:00Z' }], error: null };
    }
    return { data: null, error: { code: 'XX000', message: `unexpected rpc ${name}` } };
  };
  return { client: { from, rpc }, rpcs, tables, writes };
}

function remediationFn(model: Record<string, unknown> | null) {
  const sink: Record<string, Record<string, unknown> | unknown> = {};
  evaluate(slice('function classifyAnalyte(', 'function displayVal(') + '\nsink.a = { classifyAnalyte, slug };', { sink });
  evaluate(slice('function deterministicCycleFacts(', 'function generateFallbackInterpretation(')
    + '\nsink.c = { deterministicCycleFacts, modelCycleExplanation };', { sink });
  const tryOpenAI = vi.fn(async () => (model === null ? null : structuredClone(model)));
  evaluate(slice('// ─── Shared generation pipeline', '// ─── Claim-only legacy remediation')
    + '\nsink.p = { loadGenerationContext, trendEvidenceFor, produceInterpretation };', {
    sink, sanitizeReportContext: () => undefined, buildPrimaryContext: () => null, debugLog: () => {}, errorMessage: String,
    UserProfileContextSchema: { safeParse: () => ({ success: false, error: { flatten: () => ({}) } }) },
    formatUserContextBlock: () => null, buildTrendEvidence, withClaimAuthority, projectBasic, buildBasicProjection,
    findFloorViolations, shapeInterpretation, shouldRequestDeepInterpretation, formatPrimarySummary: () => '',
    generateFallbackInterpretation: () => ({ headline: 'deterministic fallback' }), tryOpenAI,
    ...(sink.a as object), ...(sink.c as object),
  });
  evaluate(slice('// ─── Claim-only legacy remediation', '// ─── Handler') + '\nsink.r = legacyRemediationResponse;', {
    sink, corsHeaders: {}, errorMessage: String, visibleClaimProjection, ...remediation, ...(sink.p as object),
  });
  return { run: sink.r as (input: Record<string, unknown>) => Promise<Response>, tryOpenAI };
}

async function call(model: Record<string, unknown> | null, opts: Parameters<typeof fakeSupabase>[0] = {}) {
  const fake = fakeSupabase(opts);
  const { run, tryOpenAI } = remediationFn(model);
  const samples: unknown[] = [];
  const silence = [vi.spyOn(console, 'log'), vi.spyOn(console, 'warn'), vi.spyOn(console, 'error')]
    .map(spy => spy.mockImplementation(() => {}));
  try {
    const response = await run({
      supabase: fake.client, userId: USER, reportId: REPORT, requestId: REQUEST, pinnedSlug: null,
      openaiApiKey: 'test-key', recordCost: (sample: unknown) => samples.push(sample),
    });
    return { ...fake, response, body: await response.json(), tryOpenAI };
  } finally {
    silence.forEach(spy => spy.mockRestore());
  }
}

const FORBIDDEN_RPCS = ['save_interpretation', 'commit_deep_access', 'commit_deep_access_v2'];
const FORBIDDEN_TABLES = ['introductory_deep_access_claims', 'stripe_customers', 'stripe_subscriptions',
  'iap_subscriptions', 'complimentary_entitlements', 'interpretation_visibility_config', 'interpretations'];

function expectNoForbiddenEffects(result: { rpcs: Rpc[]; tables: string[]; writes: string[] }) {
  expect(result.writes).toEqual([]);
  expect(result.rpcs.map(r => r.name).filter(n => FORBIDDEN_RPCS.includes(n))).toEqual([]);
  expect(result.tables.filter(t => FORBIDDEN_TABLES.includes(t))).toEqual([]);
}

describe('generate-interpretation remediation wiring (executed from source)', () => {
  it('an ineligible report: no model, no lookup, no table, no write', async () => {
    const result = await call(generated(), { eligible: false });
    expect(result.response.status).toBe(404);
    expect(result.body).toEqual({ error: 'remediation_not_available' });
    expect(result.tryOpenAI).not.toHaveBeenCalled();
    expect(result.rpcs.map(r => r.name)).toEqual(['evaluate_legacy_remediation']);
    expect(result.tables).toEqual([]);
    expectNoForbiddenEffects(result);
  });

  it('a committed request is served from the version store without model spend', async () => {
    const existing = { id: 'v0', historical_interpretation_id: HISTORY, generated_at: '2026-10-10T00:00:00Z',
      json_output: { headline: 'stored version' }, json_output_basic: { headline: 'basic' } };
    const result = await call(generated(), { existing });
    expect(result.response.status).toBe(200);
    expect(result.body).toMatchObject({ reused: true, interpretation: { headline: 'stored version' },
      historical_interpretation_id: HISTORY, version: { id: 'v0', generated_at: '2026-10-10T00:00:00Z' } });
    expect(result.tryOpenAI).not.toHaveBeenCalled();
    expect(result.rpcs.map(r => r.name)).toEqual(['evaluate_legacy_remediation']);
    expectNoForbiddenEffects(result);
  });

  it('runs the activated pipeline and commits only through the wrapper', async () => {
    const result = await call(generated());
    expect(result.response.status).toBe(200);
    expect(result.tryOpenAI).toHaveBeenCalledTimes(1);
    expect(result.rpcs.map(r => r.name)).toEqual(['evaluate_legacy_remediation', 'append_remediation_version']);
    const args = result.rpcs[1].args;
    expect(args).toMatchObject({ p_user_id: USER, p_report_id: REPORT, p_request_id: REQUEST, p_depth: 'deep',
      p_disclaimer: '1.0', p_provenance: { pipeline: 'generate-interpretation', mode: 'legacy_remediation' } });
    const full = args.p_full as Record<string, unknown>;
    // V2-03c claim authority ran even though no switch was consulted.
    expect(full.clinical_claims).not.toBe('model forged');
    expect(full).toHaveProperty('findings');
    expect(full).toHaveProperty('claim_audit');
    // Cycle facts come from the report, not the model.
    expect(full.cycle_context).toMatchObject({ estimated_cycle_day: 21, estimated_cycle_phase: 'luteal', explanation: 'model prose' });
    expect(args.p_basic).toEqual(projectBasic(full, { source: 'ai' }));
    expect(result.body).toMatchObject({ success: true, reused: false, access: 'full', interpretation: full,
      historical_interpretation_id: HISTORY, version: { id: 'v1', generated_at: '2026-10-11T00:00:00Z' } });
    expect(result.body).not.toHaveProperty('id');
    expectNoForbiddenEffects(result);
  });

  it('a failed model returns the retryable code and writes nothing', async () => {
    const result = await call(null);
    expect(result.response.status).toBe(503);
    expect(result.body).toEqual({ error: 'remediation_failed', retryable: true });
    expect(result.rpcs.map(r => r.name)).toEqual(['evaluate_legacy_remediation']);
    expectNoForbiddenEffects(result);
  });

  it('a floor violation is refused rather than appended permanently', async () => {
    const { questions_for_doctor: _dropped, ...withoutQuestions } = generated();
    const result = await call(withoutQuestions);
    expect(result.response.status).toBe(503);
    expect(result.rpcs.map(r => r.name)).toEqual(['evaluate_legacy_remediation']);
    expectNoForbiddenEffects(result);
  });

  it('maps commit-time refusals to stable codes', async () => {
    const refused = await call(generated(), { appendError: { code: 'P0490', message: 'remediation not available' } });
    expect(refused.response.status).toBe(404);
    expect(refused.body).toEqual({ error: 'remediation_not_available' });
    const stale = await call(generated(), { appendError: { code: '40001', message: 'stale current interpretation version' } });
    expect(stale.response.status).toBe(503);
    expect(stale.body).toEqual({ error: 'remediation_failed', retryable: true });
    expectNoForbiddenEffects(refused);
    expectNoForbiddenEffects(stale);
  });
});

describe('generate-interpretation handler routing (executed from source)', () => {
  function handlerWith(values: Record<string, unknown>) {
    let handler: (req: Request) => Promise<Response> = async () => new Response(null, { status: 500 });
    evaluate(source.slice(source.indexOf('Deno.serve(')), {
      Deno: { env: { get: () => 'test' }, serve: (fn: typeof handler) => { handler = fn; } },
      corsHeaders: {}, debugLog: () => {}, enforceRateLimit: async () => {}, createRateLimitStore: () => ({}),
      GenerateInterpretationRequestSchema: { safeParse: (body: { reportId: string }) => ({ success: true, data: { reportId: body.reportId } }) },
      parseRemediationRequest: remediation.parseRemediationRequest, LEGACY_REMEDIATION_MODE: remediation.LEGACY_REMEDIATION_MODE,
      isRateLimitExceeded: () => false, errorMessage: String, ...values,
    });
    return handler;
  }
  const request = (body: unknown) => new Request('https://example.invalid', {
    method: 'POST', headers: { Authorization: 'Bearer test' }, body: JSON.stringify(body) });

  it('routes remediation before the ownership and subscription checks, and tags costs', async () => {
    const noCall = vi.fn(() => { throw new Error('ordinary path reached'); });
    const legacyRemediationResponse = vi.fn(async () => new Response('{}', { status: 200 }));
    const recordGenerationCosts = vi.fn(async () => {});
    const client = { from: noCall, rpc: noCall, auth: { getUser: async () => ({ data: { user: { id: USER } }, error: null }) } };
    const handler = handlerWith({ createClient: () => client, checkUserSubscription: noCall, freemiumActive: noCall,
      legacyRemediationResponse, recordGenerationCosts });
    const response = await handler(request({ reportId: REPORT, mode: 'legacy_remediation', request_id: REQUEST }));
    expect(response.status).toBe(200);
    expect(legacyRemediationResponse).toHaveBeenCalledWith(expect.objectContaining({
      userId: USER, reportId: REPORT, requestId: REQUEST, pinnedSlug: null }));
    expect(noCall).not.toHaveBeenCalled();
    expect(recordGenerationCosts).toHaveBeenCalledWith(
      expect.objectContaining({ planAtRequest: 'legacy_remediation', claimConsumed: false, deep: true }),
      [], expect.any(Function), expect.any(Function));
  });

  it('an ordinary regeneration refused by the history guard is 409, and the report is not branded error', async () => {
    const fake = fakeSupabase();
    const lab = fake.client.from;
    // Ownership, the visibility switch and the ordinary save, which the guard refuses.
    const from = (table: string) => {
      const query = lab(table) as Record<string, unknown>;
      const select = query.select as (v: string) => Record<string, unknown>;
      query.select = (value: string) => {
        const q = select(value);
        if (table === 'lab_reports' && value === 'id, user_id') q.maybeSingle = async () => ({ data: { id: REPORT, user_id: USER }, error: null });
        if (table === 'interpretation_visibility_config') q.single = async () => ({ data: { enabled: false }, error: null });
        return q;
      };
      return query;
    };
    const rpcs: Rpc[] = [];
    const rpc = async (name: string, args: Record<string, unknown>) => {
      rpcs.push({ name, args });
      return { data: null, error: { code: '55000', message: 'historical interpretation is immutable; append a version' } };
    };
    const sink: Record<string, unknown> = {};
    evaluate(slice('function deterministicCycleFacts(', 'function generateFallbackInterpretation(')
      + '\nsink.c = { deterministicCycleFacts, modelCycleExplanation };', { sink });
    evaluate(slice('// ─── Shared generation pipeline', '// ─── Claim-only legacy remediation')
      + '\nsink.p = { loadGenerationContext, trendEvidenceFor, produceInterpretation };', {
      sink, sanitizeReportContext: () => undefined, buildPrimaryContext: () => null, debugLog: () => {}, errorMessage: String,
      shouldRequestDeepInterpretation, shapeInterpretation, buildBasicProjection, findFloorViolations,
      tryOpenAI: async () => generated(), ...(sink.c as object),
    });
    const { resolveTier } = await import('./tier');
    const { generationVisibilityMode, entitlementUnavailable } = await import('./entitlement-response');
    const { shouldGenerateDeepInterpretation } = await import('./response-shaping');
    const handler = handlerWith({
      createClient: () => ({ from, rpc, auth: { getUser: async () => ({ data: { user: { id: USER } }, error: null }) } }),
      checkUserSubscription: async () => ({ allowed: true, reason: 'trial' }), freemiumActive: () => false,
      generationVisibilityMode, entitlementUnavailable, resolveTier, shouldGenerateDeepInterpretation,
      ...(sink.p as object), isHistoryProtected: remediation.isHistoryProtected,
      ProtectedHistoryError: remediation.ProtectedHistoryError,
      legacyHistoryProtectedResponse: remediation.legacyHistoryProtectedResponse, recordGenerationCosts: vi.fn(),
    });
    const silence = [vi.spyOn(console, 'log'), vi.spyOn(console, 'warn')].map(spy => spy.mockImplementation(() => {}));
    try {
      const response = await handler(request({ reportId: REPORT }));
      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({ error: 'legacy_history_protected' });
      expect(rpcs.map(r => r.name)).toEqual(['save_interpretation']);
      expect(fake.writes).toEqual([]);
    } finally {
      silence.forEach(spy => spy.mockRestore());
    }
  });

  it('refuses an unknown mode before touching anything', async () => {
    const noCall = vi.fn(() => { throw new Error('reached'); });
    const client = { from: noCall, rpc: noCall, auth: { getUser: async () => ({ data: { user: { id: USER } }, error: null }) } };
    const handler = handlerWith({ createClient: () => client, checkUserSubscription: noCall, freemiumActive: noCall,
      legacyRemediationResponse: noCall, recordGenerationCosts: noCall });
    const response = await handler(request({ reportId: REPORT, mode: 'remediate', request_id: REQUEST }));
    expect(response.status).toBe(400);
    expect(noCall).not.toHaveBeenCalled();
  });
});
