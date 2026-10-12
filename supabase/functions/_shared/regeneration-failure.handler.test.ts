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
import { commitGeneratedInterpretation, decideIntroductoryAccess } from './introductory-access';
import { deriveBloodDrawIdentity, hashDrawKey } from './blood-draw-identity';
import { decideDeepGeneration } from './regeneration-availability';
import { readInterpretation } from './interpretation-read';
import * as versionWrite from './interpretation-version-write';
import { classifyRegenerationFailure } from '../../../src/lib/regenerationFailure';

/**
 * PK-PL-A, Adell's pre-launch rulings (b) and (c), proved against the real
 * generate-interpretation handler executed from source (the technique of
 * interpretation-version-write.handler.test.ts, whose harness this mirrors):
 * the real shared pipeline, the real introductory ledger flow and the real
 * version-store wiring, against a fake Supabase that records every table write
 * and every RPC.
 *
 * (b) A regeneration that fails writes nothing — no version, no claim, no
 *     attempt counter — and never brands the report "error": its
 *     interpretation is intact. Every outcome, in both flag states. The SQL half
 *     (each writer and ledger refusal leaves the report row, the claims and the
 *     store byte-identical) is supabase/migrations/__verification__/
 *     regeneration-no-write.sql.
 * (c) get-interpretation's `regeneration` is what this handler does for the same
 *     facts: "unavailable" exactly when it refuses as not retryable.
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
const REPORT = '0a8b4d6e-1f2a-4b3c-8d9e-000000000002';
const REQUEST = '0a8b4d6e-1f2a-4b3c-8d9e-0f1a2b3c4d5f';
const HISTORY = 'h';
const generated = () => ({
  headline: 'Synthetic regenerated headline', questions_for_doctor: [], disclaimer: 'd', key_findings: [],
  cycle_context: { estimated_cycle_day: 3, estimated_cycle_phase: 'luteal', confidence: 'high', explanation: 'model prose' },
});
const ANALYTE = {
  id: 'a1', raw_name: 'TSH', canonical_slug: 'tsh', value_numeric: 9, raw_value_text: '9', unit: 'mIU/L',
  raw_reference_range: '0.4-4.0', normalized_min: 0.4, normalized_max: 4.0, normalized_operator: null,
  normalized_operator_value: null, is_core: true,
};

type Plan = 'off' | 'premium' | 'free';
interface Scenario {
  plan: Plan;
  /** The report holds its interpretation (the readers' anchor). */
  anchor?: boolean;
  /** Request id sent; null sends none. */
  requestId?: string | null;
  model?: Record<string, unknown> | null;
  /** Free: this draw/report holds a claim (the generate path's findClaim and the readers' has_claim). */
  claim?: boolean;
  claimCount?: number;
  postLimit?: string;
  appendError?: { code: string; message: string };
  ledgerOutcome?: 'committed' | 'already_claimed' | 'limit_reached';
  ledgerError?: { code: string; message: string };
  /** The anchor read itself fails (before the handler knows whether the report holds one). */
  anchorError?: boolean;
  /** The version-store read fails after the anchor read. */
  versionReadError?: boolean;
}

const PERSISTING = ['append_interpretation_version', 'commit_deep_access_version', 'commit_deep_access_v2', 'save_interpretation'];

function fakeSupabase(s: Scenario) {
  const rpcs: { name: string; args: Record<string, unknown> }[] = [];
  const writes: string[] = [];
  const claimRow = { user_id: USER, blood_draw_id: 'd', report_id: REPORT, evidence_tier: 'content_hash', claimed_at: '2026-10-01T00:00:00Z' };
  const reply = (table: string, selection: string) => {
    if (table === 'lab_reports') {
      if (selection === 'id, user_id') return { data: { id: REPORT, user_id: USER }, error: null };
      if (selection === 'file_url, content_hash') return { data: { file_url: null, content_hash: 'c'.repeat(64) }, error: null };
      return { data: selection.includes('context')
        ? { id: REPORT, report_date: '2026-09-26', estimated_cycle_day: 21, estimated_cycle_phase: 'luteal' } : null, error: null };
    }
    if (table === 'report_analytes') return { data: [ANALYTE], error: null };
    if (table === 'interpretation_visibility_config') return { data: { enabled: true }, error: null };
    if (table === 'interpretation_versions') {
      return s.versionReadError ? { data: null, error: { message: 'synthetic version read failure' } } : { data: null, error: null };
    }
    if (table === 'introductory_deep_access_claims') return { data: s.claim ? claimRow : null, error: null };
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
  const rpc = async (name: string, args: Record<string, unknown>) => {
    rpcs.push({ name, args });
    if (name === 'read_interpretation_for_server') {
      if (s.anchorError) return { data: null, error: { message: 'synthetic anchor read failure' } };
      return { data: s.anchor === false ? [] : [{ json_output: {}, has_claim: !!s.claim }], error: null };
    }
    if (name === 'append_interpretation_version') {
      if (s.appendError) return { data: null, error: s.appendError };
      return { data: [{ version_id: 'v1', history_id: HISTORY, version_generated_at: '2026-10-12T00:00:00Z' }], error: null };
    }
    if (name === 'commit_deep_access_version') {
      if (s.ledgerError) return { data: null, error: s.ledgerError };
      const outcome = s.ledgerOutcome ?? (s.claim ? 'already_claimed' : 'committed');
      return { data: [outcome === 'limit_reached'
        ? { outcome, version_id: null, history_id: null, version_generated_at: null }
        : { outcome, version_id: 'v2', history_id: HISTORY, version_generated_at: '2026-10-12T01:00:00Z' }], error: null };
    }
    if (name === 'commit_deep_access_v2') return { data: s.ledgerOutcome ?? (s.claim ? 'already_claimed' : 'committed'), error: null };
    if (name === 'save_interpretation') return { data: null, error: null };
    return { data: null, error: { code: 'XX000', message: `unexpected rpc ${name}` } };
  };
  return { client: { from, rpc, auth: { getUser: async () => ({ data: { user: { id: USER } }, error: null }) } }, rpcs, writes };
}

function buildHandler(s: Scenario, client: unknown, handlerSource = source) {
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
  evaluate(slice(source, '// ─── Version store', '// ─── Handler')
    + '\nsink.v = { readAnchor, findRequestVersion, appendVersion, commitLedgerVersion };', { sink, ...versionWrite });
  let handler: (req: Request) => Promise<Response> = async () => new Response(null, { status: 500 });
  const flagOn = s.plan !== 'off';
  evaluate(handlerSource.slice(handlerSource.indexOf('Deno.serve(')), {
    Deno: { env: { get: (name: string) => name === 'OPENAI_API_KEY' ? 'test-key'
      : name === 'FREEMIUM_POST_LIMIT_GENERATION' ? s.postLimit : undefined },
    serve: (fn: typeof handler) => { handler = fn; } },
    createClient: () => client, corsHeaders: {}, debugLog: () => {}, enforceRateLimit: async () => {}, createRateLimitStore: () => ({}),
    GenerateInterpretationRequestSchema: { safeParse: (body: { reportId: string; request_id?: string }) =>
      ({ success: true, data: { reportId: body.reportId, request_id: body.request_id } }) },
    checkUserSubscription: async () => !flagOn
      ? { allowed: true, reason: 'trial' }
      : s.plan === 'free'
        ? { allowed: true, plan: 'free', reason: 'free_plan', source: 'free' }
        : { allowed: true, plan: 'premium', reason: 'active_subscription', source: 'active_subscription' },
    freemiumActive: () => flagOn, generationVisibilityMode, entitlementUnavailable, resolveTier,
    shouldGenerateDeepInterpretation, decideDeepGeneration, decideIntroductoryAccess, commitGeneratedInterpretation,
    deriveBloodDrawIdentity, hashDrawKey, recordGenerationCosts: vi.fn(async () => {}),
    isRateLimitExceeded: () => false, errorMessage: String, servedBasic, visibleClaimProjection,
    ...versionWrite, ...(sink.p as object), ...(sink.v as object),
  });
  return { handler, tryOpenAI };
}

async function regenerate(s: Scenario, handlerSource = source) {
  const fake = fakeSupabase(s);
  const { handler, tryOpenAI } = buildHandler(s, fake.client, handlerSource);
  const silence = [vi.spyOn(console, 'log'), vi.spyOn(console, 'warn'), vi.spyOn(console, 'error')]
    .map(spy => spy.mockImplementation(() => {}));
  try {
    const body: Record<string, unknown> = { reportId: REPORT };
    const requestId = s.requestId === undefined ? REQUEST : s.requestId;
    if (requestId !== null) body.request_id = requestId;
    const response = await handler(new Request('https://example.invalid', {
      method: 'POST', headers: { Authorization: 'Bearer test' }, body: JSON.stringify(body) }));
    const persisted = fake.rpcs.map(r => r.name).filter(n => PERSISTING.includes(n));
    return { ...fake, persisted, status: response.status, body: await response.json(), tryOpenAI };
  } finally {
    silence.forEach(spy => spy.mockRestore());
  }
}

/** The no-write contract: nothing but the RPC that refused, no write of any table. */
function expectNothingWritten(result: Awaited<ReturnType<typeof regenerate>>, refusedBy: string[] = []) {
  expect(result.writes).toEqual([]);
  expect(result.persisted).toEqual(refusedBy);
}

const PLANS: Plan[] = ['off', 'premium', 'free'];

describe('PK-PL-A (b): a regeneration that fails writes nothing and never brands the report', () => {
  it.each(PLANS)('400 request_id_required: before any model spend, nothing written (%s)', async plan => {
    const result = await regenerate({ plan, requestId: null, claim: true });
    expect(result.status).toBe(400);
    expect(result.body).toEqual({ error: 'request_id_required' });
    expect(result.tryOpenAI).not.toHaveBeenCalled();
    expectNothingWritten(result);
  });

  it.each(PLANS)('503 retryable: the model failed, nothing written, no claim settled (%s)', async plan => {
    const result = await regenerate({ plan, model: null, claim: false, claimCount: 1 });
    expect(result.status).toBe(503);
    expect(result.body).toEqual({ error: 'regeneration_failed', retryable: true });
    expectNothingWritten(result);
  });

  it.each(PLANS)('503 retryable: a floor violation is refused, nothing written (%s)', async plan => {
    const { questions_for_doctor: _dropped, ...violating } = generated();
    const result = await regenerate({ plan, model: violating, claim: true });
    expect(result.status).toBe(503);
    expect(result.body).toEqual({ error: 'regeneration_failed', retryable: true });
    expectNothingWritten(result);
  });

  it.each(['off', 'premium'] as const)('409 legacy_history_protected from the writer: nothing written (%s)', async plan => {
    const result = await regenerate({ plan, appendError: { code: '55000', message: 'immutable' } });
    expect(result.status).toBe(409);
    expect(result.body).toEqual({ error: 'legacy_history_protected' });
    expectNothingWritten(result, ['append_interpretation_version']);
  });

  it('409 legacy_history_protected from the Free ledger: the claim rolled back with it, nothing written', async () => {
    const result = await regenerate({ plan: 'free', claim: false, claimCount: 1, ledgerError: { code: '55000', message: 'immutable' } });
    expect(result.status).toBe(409);
    expect(result.body).toEqual({ error: 'legacy_history_protected' });
    expectNothingWritten(result, ['commit_deep_access_version']);
  });

  it('503 retryable: the last credit went to another request at commit (limit_reached), nothing written', async () => {
    const result = await regenerate({ plan: 'free', claim: false, claimCount: 2, ledgerOutcome: 'limit_reached' });
    expect(result.status).toBe(503);
    expect(result.body).toEqual({ error: 'regeneration_failed', retryable: true });
    expectNothingWritten(result, ['commit_deep_access_version']);
  });

  it('503 not retryable: Free, introductory access used up, post-limit generation on demand — no model spend, nothing written', async () => {
    const result = await regenerate({ plan: 'free', claim: false, claimCount: 3, postLimit: 'on_demand' });
    expect(result.status).toBe(503);
    expect(result.body).toEqual({ error: 'regeneration_failed', retryable: false });
    expect(result.tryOpenAI).not.toHaveBeenCalled();
    expectNothingWritten(result);
  });

  it.each(PLANS)('500 from a store error after the anchor read: no "error" brand (%s)', async plan => {
    const appendFailed = await regenerate({ plan, claim: true, appendError: { code: '40001', message: 'stale' },
      ledgerError: { code: '40001', message: 'stale' } });
    expect(appendFailed.status).toBe(500);
    expect(appendFailed.writes).toEqual([]);
    const readFailed = await regenerate({ plan, versionReadError: true });
    expect(readFailed.status).toBe(500);
    expect(readFailed.body).toEqual({ error: 'Internal server error' });
    expectNothingWritten(readFailed);
  });

  it.each(PLANS)('a keyed request whose anchor read fails is not branded either (%s)', async plan => {
    const result = await regenerate({ plan, anchorError: true });
    expect(result.status).toBe(500);
    expectNothingWritten(result);
  });

  it.each(PLANS)('control: an unkeyed first generation that fails is still marked "error" (%s)', async plan => {
    const result = await regenerate({ plan, anchor: false, requestId: null, anchorError: true });
    expect(result.status).toBe(500);
    expect(result.writes).toEqual([`update:lab_reports:${JSON.stringify({ status: 'error' })}`]);
  });

  it('control: a successful regeneration writes the version and the status, and is what the failures are not', async () => {
    const result = await regenerate({ plan: 'off' });
    expect(result.status).toBe(200);
    expect(result.persisted).toEqual(['append_interpretation_version']);
    expect(result.writes).toEqual([`update:lab_reports:${JSON.stringify({ status: 'ready' })}`]);
  });

  it('the client reads every failure answer as its calm outcome (src/lib/regenerationFailure.ts)', async () => {
    const cases: [Scenario, string][] = [
      [{ plan: 'off', requestId: null }, 'unavailable'],
      [{ plan: 'premium', model: null }, 'retryable'],
      [{ plan: 'off', appendError: { code: '55000', message: 'immutable' } }, 'already_saved'],
      [{ plan: 'free', claim: false, claimCount: 2, ledgerOutcome: 'limit_reached' }, 'retryable'],
      [{ plan: 'free', claim: false, claimCount: 3, postLimit: 'on_demand' }, 'unavailable'],
      [{ plan: 'premium', appendError: { code: '40001', message: 'stale' } }, 'retryable'],
      [{ plan: 'off', versionReadError: true }, 'retryable'],
    ];
    for (const [scenario, kind] of cases) {
      const result = await regenerate(scenario);
      expect(result.status, JSON.stringify(scenario)).toBeGreaterThanOrEqual(400);
      expect(classifyRegenerationFailure(result.status, result.body), JSON.stringify(scenario)).toBe(kind);
    }
  });

  // Negative control, executed in memory against mutated handler source.
  it('negative control: with the PK-PL-A guard removed, a failed regeneration is branded "error" again', async () => {
    const guard = 'if (reportId && !regeneration) {';
    expect(source.split(guard)).toHaveLength(2);
    const result = await regenerate({ plan: 'off', versionReadError: true }, source.replace(guard, 'if (reportId) {'));
    expect(result.status).toBe(500);
    expect(result.writes).toEqual([`update:lab_reports:${JSON.stringify({ status: 'error' })}`]);
  });
});

describe('PK-PL-A (c): get-interpretation says a regeneration is unavailable exactly when this handler refuses it', () => {
  const premiumEntitlement = { allowed: true as const, plan: 'premium' as const, reason: 'active_subscription' as const, source: 'active_subscription' as const };
  const freeEntitlement = { allowed: true as const, plan: 'free' as const, reason: 'free_plan' as const, source: 'free' as const };
  // A floor-complete stored body, so the read path has nothing to log.
  const stored = { headline: 'Stored synthetic analysis', cycle_context: {}, questions_for_doctor: [], disclaimer: 'd', key_findings: [] };
  const read = (premium: boolean, claim: boolean, claimCount: number, postLimit: string | undefined, stored_depth = 'standard') =>
    readInterpretation({
      ownsReport: async () => true,
      resolveEntitlement: async () => (premium ? premiumEntitlement : freeEntitlement),
      readSelected: async () => ({ json_output: stored, stored_depth, has_claim: claim,
        tier: premium ? 'plus' : 'free', interpretation_source: 'fallback' }),
      countClaims: async () => claimCount,
      postLimitGeneration: postLimit,
    }, true);

  const matrix = [true, false].flatMap(premium => [true, false].flatMap(claim => [0, 2, 3].flatMap(claimCount =>
    [undefined, 'always', 'on_demand', 'unknown_value'].map(postLimit => ({ premium, claim, claimCount, postLimit })))));

  it('agrees on every plan, claim, count and post-limit setting (flag on)', async () => {
    const outcomes: string[] = [];
    for (const { premium, claim, claimCount, postLimit } of matrix) {
      const label = JSON.stringify({ premium, claim, claimCount, postLimit });
      const served = await read(premium, claim, claimCount, postLimit);
      expect(served.status, label).toBe(200);
      const availability = served.body.regeneration;
      expect(availability, label).toBeDefined();
      const result = await regenerate({ plan: premium ? 'premium' : 'free', claim, claimCount, postLimit });
      if (availability!.available) {
        expect(result.status, label).toBe(200);
        expect(result.body.success, label).toBe(true);
      } else {
        expect(availability!.reason, label).toBe('introductory_access_exhausted');
        expect(result.status, label).toBe(503);
        expect(result.body, label).toEqual({ error: 'regeneration_failed', retryable: false });
        expectNothingWritten(result);
      }
      outcomes.push(availability!.available ? 'available' : 'unavailable');
    }
    // Non-vacuous: the matrix reaches both answers.
    expect(new Set(outcomes)).toEqual(new Set(['available', 'unavailable']));
  });

  it('serves the same answer whatever the stored depth and access shape', async () => {
    for (const stored_depth of ['standard', 'deep']) {
      for (const premium of [true, false]) {
        const served = await read(premium, false, 3, 'on_demand', stored_depth);
        expect(served.body.regeneration).toEqual(premium
          ? { available: true, reason: null } : { available: false, reason: 'introductory_access_exhausted' });
      }
    }
  });

  it('is absent where it does not apply: flag off, nothing stored, an error', async () => {
    const off = await readInterpretation({
      ownsReport: async () => true, resolveEntitlement: async () => freeEntitlement,
      readSelected: async () => ({ json_output: stored, stored_depth: 'standard', has_claim: false, tier: 'free' }),
      countClaims: async () => 3, postLimitGeneration: 'on_demand',
    }, false);
    expect(off.body).not.toHaveProperty('regeneration');
    const nothingStored = await readInterpretation({
      ownsReport: async () => true, resolveEntitlement: async () => freeEntitlement, readSelected: async () => null,
      countClaims: async () => 3, postLimitGeneration: 'on_demand',
    }, true);
    expect(nothingStored.body.access).toBe('generation_needed');
    expect(nothingStored.body).not.toHaveProperty('regeneration');
    const failed = await readInterpretation({
      ownsReport: async () => true, resolveEntitlement: async () => { throw new Error('offline'); },
      readSelected: async () => null, countClaims: async () => 3,
    }, true);
    expect(failed.body.access).toBe('error');
    expect(failed.body).not.toHaveProperty('regeneration');
  });

  it('negative control: a read path that ignored the post-limit setting would disagree with the handler', async () => {
    const drifted = await read(false, false, 3, undefined);
    const result = await regenerate({ plan: 'free', claim: false, claimCount: 3, postLimit: 'on_demand' });
    expect(drifted.body.regeneration?.available).toBe(true);
    expect(result.status).toBe(503);
  });

  it('the endpoint reads the post-limit setting exactly as generate-interpretation does', () => {
    const endpoint = readFileSync(new URL('../get-interpretation/index.ts', import.meta.url), 'utf8');
    const envRead = 'Deno.env.get("FREEMIUM_POST_LIMIT_GENERATION")';
    expect(endpoint.split(envRead)).toHaveLength(2);
    expect(source.split(envRead)).toHaveLength(2);
    // And generate-interpretation decides depth only through the shared function.
    expect(source).toContain('const generateDeep = decideDeepGeneration({');
    expect(source).not.toMatch(/shouldGenerateDeepInterpretation\(/);
  });
});
