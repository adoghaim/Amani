import { describe, expect, it, vi } from 'vitest';
import { entitlementUnavailable, generationVisibilityMode, premiumRequired } from './entitlement-response';

describe('entitlement wire boundary', () => {
  it('uses retryable 503 rather than payment semantics', async () => {
    const response = entitlementUnavailable({ 'Access-Control-Allow-Origin': '*' });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ code: 'entitlement_unavailable', retryable: true });
    expect(premiumRequired({ allowed: true, plan: 'free' })).toBe(true);
  });
  it('does not touch config when inactive or Premium', async () => {
    const readEnabled = vi.fn(); const warn = vi.fn();
    expect(await generationVisibilityMode({ active: false, entitlement: { allowed: true, reason: 'trial' }, readEnabled, warn })).toBe(false);
    expect(await generationVisibilityMode({ active: true, entitlement: { allowed: true, plan: 'premium', reason: 'active_subscription', source: 'active_subscription' }, readEnabled, warn })).toBe(true);
    expect(readEnabled).not.toHaveBeenCalled();
  });
  it('refuses active Free generation with switch off and propagates DB failure', async () => {
    const warn = vi.fn();
    const input = { active: true, entitlement: { allowed: true as const, plan: 'free' as const }, warn };
    expect(await generationVisibilityMode({ ...input, readEnabled: async () => false })).toBe(false);
    expect(warn).toHaveBeenCalledOnce();
    expect(await generationVisibilityMode({ ...input, readEnabled: async () => true })).toBe(true);
    await expect(generationVisibilityMode({ ...input, readEnabled: async () => { throw new Error('offline'); } })).rejects.toThrow('offline');
  });
});

// Exercise the actual handler body in a fake Deno/Supabase runtime. Transpile
// only the serve callback so importing unrelated Deno npm/jsr modules is not
// needed by Vitest. Production branch ordering is executed, not reproduced.
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import { resolveTier } from './tier';
import { buildBasicProjection } from './interpretation-visibility';
import { decideDeepGeneration, findFloorViolations, shapeInterpretation, shouldGenerateDeepInterpretation, shouldRequestDeepInterpretation } from './response-shaping';
import { generationSample } from './generation-cost';
import * as versionWrite from './interpretation-version-write';

const source = readFileSync(new URL('../generate-interpretation/index.ts', import.meta.url), 'utf8');
function evaluate(fragment: string, values: Record<string, unknown>) {
  const { code } = transformSync(fragment, { loader: 'ts', target: 'es2022' });
  return new Function(...Object.keys(values), code)(...Object.values(values));
}
function pipelineSource() {
  const start = source.indexOf('// ─── Shared generation pipeline');
  const end = source.indexOf('// ─── Version store', start);
  expect(start).toBeGreaterThan(0);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

it.each([false, true])('handler inactive/mismatch (%s): unchanged payload, no findings, costs or ledger', async activeFlag => {
  let handler: (req: Request) => Promise<Response> = async () => new Response(null, { status: 500 });
  const queried: string[] = [];
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  // The model tries to author phase/day/confidence; only its explanation may survive.
  const generated: Record<string, unknown> = { headline: 'h', cycle_context: { estimated_cycle_day: 3, estimated_cycle_phase: 'pregnancy_t2',
    confidence: 'high', explanation: 'model prose' }, questions_for_doctor: [], disclaimer: 'd', key_findings: [], deep_body: 'full' };
  const sink: { helpers?: Record<string, unknown>; pipeline?: Record<string, unknown> } = {};
  evaluate(source.slice(source.indexOf('function deterministicCycleFacts('), source.indexOf('function generateFallbackInterpretation('))
    + '\nsink.helpers = { deterministicCycleFacts, modelCycleExplanation };', { sink });
  const from = (table: string) => {
    queried.push(table);
    let selection = '';
    const reply = () => ({ data: table === 'lab_reports'
      ? selection === 'id, user_id' ? { id: 'r', user_id: 'u' }
        : selection.includes('context') ? { id: 'r', report_date: '2026-09-26', estimated_cycle_day: 21, estimated_cycle_phase: 'luteal' } : null
      : table === 'report_analytes' ? [{ value_numeric: 1 }]
        : table === 'interpretation_visibility_config' ? { enabled: false } : null, error: null });
    const query: Record<string, unknown> = {};
    for (const method of ['eq','neq','lt','order','limit','update']) query[method] = () => query;
    query.select = (value: string) => { selection = value; return query; };
    query.maybeSingle = async () => reply();
    query.single = async () => reply();
    query.then = (done: (v: unknown) => void) => Promise.resolve(reply()).then(done);
    return query;
  };
  const client = { from, auth: { getUser: async () => ({ data: { user: { id: 'u' } }, error: null }) },
    rpc: async (name: string, args: Record<string, unknown>) => { calls.push({ name, args }); return { error: null }; } };
  const noCall = vi.fn(() => { throw new Error('inactive branch accessed'); });
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  // The stages shared with regeneration (TASK-048) are executed from source too.
  evaluate(pipelineSource() + '\nsink.pipeline = { loadGenerationContext, trendEvidenceFor, produceInterpretation };', {
    sink, sanitizeReportContext: () => undefined, buildPrimaryContext: () => null, debugLog: () => {},
    errorMessage: String, UserProfileContextSchema: { safeParse: noCall }, formatUserContextBlock: noCall,
    buildTrendEvidence: noCall, slug: noCall, classifyAnalyte: noCall, withClaimAuthority: noCall, projectBasic: noCall,
    generateFallbackInterpretation: noCall, formatPrimarySummary: noCall,
    tryOpenAI: async () => generated, shouldRequestDeepInterpretation, shapeInterpretation, buildBasicProjection,
    findFloorViolations, ...sink.helpers,
  });
  try {
    evaluate(source.slice(source.indexOf('Deno.serve(')), {
      Deno: { env: { get: (name: string) => name === 'OPENAI_API_KEY' ? 'test-key' : 'test' }, serve: (fn: typeof handler) => { handler = fn; } },
      createClient: () => client, corsHeaders: {}, debugLog: () => {},
      enforceRateLimit: async () => {}, createRateLimitStore: () => ({}),
      GenerateInterpretationRequestSchema: { safeParse: () => ({ success: true, data: { reportId: 'r' } }) },
      checkUserSubscription: async (_client: unknown, _user: string, active: boolean) => active
        ? ({ allowed: true, plan: 'free' }) : ({ allowed: true, reason: 'trial' }), freemiumActive: () => activeFlag,
      generationVisibilityMode, entitlementUnavailable, resolveTier,
      sanitizeReportContext: () => undefined, buildPrimaryContext: () => null,
      decideDeepGeneration, shouldGenerateDeepInterpretation, shouldRequestDeepInterpretation, shapeInterpretation,
      tryOpenAI: async () => generated, addFindingMetadata: noCall, buildBasicProjection,
      findFloorViolations, commitGeneratedInterpretation: noCall, recordGenerationCosts: noCall,
      isRateLimitExceeded: () => false, errorMessage: String, ...sink.helpers, ...sink.pipeline,
      ...versionWrite, readAnchor: async () => null, findRequestVersion: noCall, appendVersion: noCall,
      commitLedgerVersion: noCall,
    });
    const response = await handler(new Request('https://example.invalid', { method: 'POST', headers: { Authorization: 'Bearer test' }, body: '{}' }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, source: 'ai' });
    expect(calls).toHaveLength(1);
    expect(calls[0].name).toBe('save_interpretation');
    expect(calls[0].args.p_interpretation).toEqual(generated);
    expect((calls[0].args.p_interpretation as Record<string, unknown>).cycle_context).toEqual({
      estimated_cycle_day: 21, estimated_cycle_phase: 'luteal', confidence: 'medium', explanation: 'model prose' });
    expect(calls[0].args.p_interpretation).not.toHaveProperty('findings');
    expect(calls[0].args.p_interpretation).not.toHaveProperty('trend_evidence');
    expect(calls[0].args.p_basic).toEqual(buildBasicProjection(generated));
    expect(queried).not.toContain('introductory_deep_access_claims');
    expect(queried).not.toContain('interpretation_generation_costs');
    expect(queried.includes('interpretation_visibility_config')).toBe(activeFlag);
    expect(noCall).not.toHaveBeenCalled();
  } finally { log.mockRestore(); }
});

it('actual OpenAI call records one null-usage sample on a non-OK response', async () => {
  const start = source.indexOf('async function callOpenAIOnce(');
  const end = source.indexOf('// ─── Context sanitization', start);
  const sample = vi.fn();
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    const call = evaluate(source.slice(start, end) + '\nreturn callOpenAIOnce;', {
      fetchWithBackoff: async () => new Response('synthetic failure', { status: 503 }),
      generationSample, errorMessage: String,
    }) as (key: string, prompt: string, callback: typeof sample) => Promise<unknown>;
    expect(await call('fake-key', 'synthetic prompt', sample)).toBeNull();
    expect(sample).toHaveBeenCalledOnce();
    expect(sample.mock.calls[0][0]).toMatchObject({ model: 'gpt-4o-mini', promptTokens: null, completionTokens: null, totalTokens: null });
  } finally { warn.mockRestore(); }
});

it.each(['extract-biomarkers', 'parse-lab-report-ocr', 'lab-insights', 'generate-interpretation'])('%s actual guard maps read errors to 503', async name => {
  const handlerSource = readFileSync(new URL(`../${name}/index.ts`, import.meta.url), 'utf8');
  const start = handlerSource.indexOf(name === 'generate-interpretation' ? '    let active = freemiumActive();' : '    const subCheck = await checkUserSubscription(');
  const end = handlerSource.indexOf(name === 'generate-interpretation' ? '    const ctx = await loadGenerationContext(' : name === 'lab-insights' ? '    if (!openaiApiKey)' : '    const supabaseAdmin', start);
  expect(start).toBeGreaterThan(0);
  expect(end).toBeGreaterThan(start);
  const response = await evaluate('return (async () => {\n' + handlerSource.slice(start, end) + '\n})();', {
    supabase: {}, supabaseAuth: {}, supabaseUser: {}, user: { id: 'u' }, userId: 'u', corsHeaders: {},
    checkUserSubscription: async () => ({ allowed: false, reason: 'error', detail: 'offline' }),
    entitlementUnavailable, premiumRequired, freemiumActive: () => true,
  }) as Response;
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ code: 'entitlement_unavailable', retryable: true });
});

it('lab-insights actual guard rejects Free with premium_required', async () => {
  const handlerSource = readFileSync(new URL('../lab-insights/index.ts', import.meta.url), 'utf8');
  const start = handlerSource.indexOf('    const subCheck = await checkUserSubscription(');
  const end = handlerSource.indexOf('    if (!openaiApiKey)', start);
  const response = await evaluate('return (async () => {\n' + handlerSource.slice(start, end) + '\n})();', {
    supabaseAuth: {}, userId: 'u', corsHeaders: {}, entitlementUnavailable, premiumRequired,
    checkUserSubscription: async () => ({ allowed: true, plan: 'free' }),
  }) as Response;
  expect(response.status).toBe(402);
  expect(await response.json()).toEqual({ code: 'premium_required' });
});
