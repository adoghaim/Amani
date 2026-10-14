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
import * as versionWrite from './interpretation-version-write';
import { callModelUnlessPaused } from './ai-pause';
import { consentRefusal, createConsentGate } from './consent';
// PK-CONSENT-01: features.consent_gate off (the seed), as before the gate existed; a consent read would throw.
const consentGateOff = () => createConsentGate({ readPublicConfig: async () => [{ key: 'features', value: {} }],
  readCurrentConsents: async () => { throw new Error('flag off: consent is never read'); }, now: () => 0 });

/**
 * TASK-048 turns 10 and 11: executes the real generate-interpretation handler,
 * the real shared pipeline, the real introductory-access ledger flow and the
 * real version-store wiring from source (the entitlement-response.test.ts
 * technique), against a fake Supabase that records every RPC and write. Proves
 * the cutover wiring, not the SQL: the writer and the ledger RPCs are fakes here
 * and SQL-proven in supabase/migrations/__verification__/interpretation-versions
 * .writer.sql and .ledger.sql.
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
  /** Free tier with the switch on: the real introductory ledger flow runs. */
  free?: boolean;
  /** The introductory claim this draw/report already holds (Free only). */
  claim?: boolean;
  /** Lifetime claims already spent (Free only). */
  claimCount?: number;
  /** What the reader's shared claim derivation says about the anchor. */
  hasClaim?: boolean;
  /** Forces the ledger RPC's outcome (the commit-time race for the last credit). */
  ledgerOutcome?: 'committed' | 'already_claimed' | 'limit_reached';
  ledgerError?: { code: string; message: string };
}
const LEDGER_RPCS = ['commit_deep_access_version', 'commit_deep_access_v2'];
function fakeSupabase(opts: Scenario) {
  const rpcs: Rpc[] = [];
  const writes: string[] = [];
  const reads: string[] = [];
  let twinVisible = false;
  const claimRow = { user_id: USER, blood_draw_id: 'd', report_id: REPORT, evidence_tier: 'content_hash', claimed_at: '2026-10-01T00:00:00Z' };
  const reply = (table: string, selection: string) => {
    if (table === 'lab_reports') {
      if (selection === 'id, user_id') return { id: REPORT, user_id: USER };
      if (selection === 'file_url, content_hash') return { file_url: null, content_hash: 'c'.repeat(64) };
      return selection.includes('context') ? { id: REPORT, report_date: '2026-09-26', estimated_cycle_day: 21, estimated_cycle_phase: 'luteal' } : null;
    }
    if (table === 'report_analytes') return [ANALYTE];
    if (table === 'interpretation_visibility_config') return { enabled: true };
    if (table === 'interpretation_versions') return opts.committed || twinVisible ? COMMITTED : null;
    if (table === 'introductory_deep_access_claims') return opts.claim ? claimRow : null;
    return null;
  };
  const from = (table: string) => {
    let selection = '';
    const query: Record<string, unknown> = {};
    for (const method of ['eq', 'neq', 'lt', 'order', 'limit', 'is', 'or']) query[method] = () => query;
    for (const method of ['update', 'insert', 'upsert', 'delete']) {
      query[method] = (value: unknown) => { writes.push(`${method}:${table}:${JSON.stringify(value)}`); return query; };
    }
    query.select = (value: string) => { selection = value; reads.push(table); return query; };
    query.maybeSingle = async () => ({ data: reply(table, selection), error: null });
    query.single = query.maybeSingle;
    query.then = (done: (v: unknown) => void) => Promise.resolve({ data: reply(table, selection), error: null,
      count: table === 'introductory_deep_access_claims' ? (opts.claimCount ?? (opts.claim ? 1 : 0)) : null }).then(done);
    return query;
  };
  const rpc = async (name: string, args: Record<string, unknown>) => {
    rpcs.push({ name, args });
    if (name === 'read_interpretation_for_server') {
      return { data: opts.anchor ? [{ json_output: {}, has_claim: !!opts.hasClaim }] : [], error: null };
    }
    if (name === 'append_interpretation_version') {
      if (opts.appendError) {
        twinVisible = !!opts.twinAfterReuse;
        return { data: null, error: opts.appendError };
      }
      return { data: [{ version_id: 'v1', history_id: HISTORY, version_generated_at: '2026-10-11T00:00:00Z' }], error: null };
    }
    if (name === 'commit_deep_access_version') {
      if (opts.ledgerError) {
        twinVisible = !!opts.twinAfterReuse;
        return { data: null, error: opts.ledgerError };
      }
      const outcome = opts.ledgerOutcome ?? (opts.claim ? 'already_claimed' : 'committed');
      return { data: [outcome === 'limit_reached'
        ? { outcome, version_id: null, history_id: null, version_generated_at: null }
        : { outcome, version_id: 'v2', history_id: HISTORY, version_generated_at: '2026-10-11T01:00:00Z' }], error: null };
    }
    if (name === 'commit_deep_access_v2') return { data: opts.ledgerOutcome ?? (opts.claim ? 'already_claimed' : 'committed'), error: null };
    if (name === 'save_interpretation') return { data: null, error: null };
    return { data: null, error: { code: 'XX000', message: `unexpected rpc ${name}` } };
  };
  return { client: { from, rpc, auth: { getUser: async () => ({ data: { user: { id: USER } }, error: null }) } }, rpcs, writes, reads };
}

const CUTOVER = 'const appendsVersion = anchor !== null;';
const REQUIRE_REQUEST = 'if (appendsVersion && requestId === null) {';
const LEDGER_CUTOVER = 'if (appendsVersion) {\n          const settled = await commitLedgerVersion(';
const VERSIONABLE_FIRST = 'if (appendsVersion && !isVersionable(';

function buildHandler(handlerSource: string, model: Record<string, unknown> | null, flagOn: boolean, free: boolean, client: unknown,
  aiPaused = false) {
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
    generateFallbackInterpretation: () => ({ headline: 'deterministic fallback' }), tryOpenAI, callModelUnlessPaused,
    ...(sink.a as object), ...(sink.c as object),
  });
  evaluate(slice(source, '// ─── Version store', '// ─── Handler')
    + '\nsink.v = { readAnchor, findRequestVersion, appendVersion, commitLedgerVersion };', { sink, ...versionWrite });
  let handler: (req: Request) => Promise<Response> = async () => new Response(null, { status: 500 });
  const recordGenerationCosts = vi.fn(async () => {});
  evaluate(handlerSource.slice(handlerSource.indexOf('Deno.serve(')), {
    Deno: { env: { get: (name: string) => name === 'OPENAI_API_KEY' ? 'test-key' : undefined },
      serve: (fn: typeof handler) => { handler = fn; } },
    createClient: () => client, corsHeaders: {}, debugLog: () => {}, enforceRateLimit: async () => {}, createRateLimitStore: () => ({}),
    // PK-EXP5: the funnel event is a no-op here; app-events.test.ts covers it.
    logServerEvent: async () => true, createAppEventSink: () => ({}),
    consentRefusal, consentGateFor: consentGateOff,
    GenerateInterpretationRequestSchema: { safeParse: (body: { reportId: string; request_id?: string }) =>
      ({ success: true, data: { reportId: body.reportId, request_id: body.request_id } }) },
    checkUserSubscription: async () => !flagOn
      ? { allowed: true, reason: 'trial' }
      : free
        ? { allowed: true, plan: 'free', reason: 'free_plan', source: 'free' }
        : { allowed: true, plan: 'premium', reason: 'active_subscription', source: 'active_subscription' },
    freemiumActive: () => flagOn, generationVisibilityMode, entitlementUnavailable, resolveTier,
    // The real ledger flow: never stubbed out of the version path.
    shouldGenerateDeepInterpretation, decideIntroductoryAccess, commitGeneratedInterpretation,
    deriveBloodDrawIdentity, hashDrawKey, recordGenerationCosts,
    isRateLimitExceeded: () => false, errorMessage: String, servedBasic, visibleClaimProjection,
    // PK-FIX-01b guards: the kill switch as the scenario sets it; telemetry is inert here.
    aiPausedNow: async () => aiPaused, inBackground: (p: Promise<unknown>) => { void p; },
    costLedger: { record: async () => {} }, reporter: { captureException: async () => false },
    ...versionWrite, ...(sink.p as object), ...(sink.v as object),
  });
  return { handler, tryOpenAI };
}

async function call(scenario: Scenario & { model?: Record<string, unknown> | null; flagOn?: boolean; requestId?: string | null;
  handlerSource?: string; aiPaused?: boolean }) {
  const fake = fakeSupabase(scenario);
  const flagOn = !!scenario.flagOn || !!scenario.free;
  const { handler, tryOpenAI } = buildHandler(scenario.handlerSource ?? source,
    scenario.model === undefined ? generated() : scenario.model, flagOn, !!scenario.free, fake.client, !!scenario.aiPaused);
  const silence = [vi.spyOn(console, 'log'), vi.spyOn(console, 'warn'), vi.spyOn(console, 'error')]
    .map(spy => spy.mockImplementation(() => {}));
  try {
    const body: Record<string, unknown> = { reportId: REPORT };
    const requestId = scenario.requestId === undefined ? REQUEST : scenario.requestId;
    if (requestId !== null) body.request_id = requestId;
    const response = await handler(new Request('https://example.invalid', {
      method: 'POST', headers: { Authorization: 'Bearer test' }, body: JSON.stringify(body) }));
    return { ...fake, response, body: await response.json(), tryOpenAI };
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
    // Premium and flag-off requests never touch the introductory ledger.
    expect(result.reads).not.toContain('introductory_deep_access_claims');
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

describe('generate-interpretation Free ledger on an anchored report (turn 11, executed from source)', () => {
  const run = call;
  const persisting = (rpcs: Rpc[]) => names(rpcs).filter(n => n !== 'read_interpretation_for_server');

  it('an existing claim settles and appends through commit_deep_access_version only', async () => {
    const result = await run({ anchor: true, free: true, claim: true });
    expect(result.response.status).toBe(200);
    expect(persisting(result.rpcs)).toEqual(['commit_deep_access_version']);
    const args = result.rpcs.find(r => r.name === 'commit_deep_access_version')!.args;
    expect(args).toMatchObject({ p_user_id: USER, p_report_id: REPORT, p_request_id: REQUEST, p_consume_credit: false,
      p_provenance: { pipeline: 'generate-interpretation', mode: 'regeneration', claim_policy_version: 'v2-03c.1' } });
    expect(args.p_blood_draw_id).toMatch(/^[0-9a-f]{64}$/);
    // The version body passed V2-03c claim authority; Basic is its projection.
    const full = args.p_full as Record<string, unknown>;
    expect(full.clinical_claims).not.toBe('model forged');
    expect(full).toHaveProperty('claim_audit');
    expect(args.p_basic).toEqual(projectBasic(full, { source: 'ai' }));
    // Served Full under the version's identity, never the historical row's.
    expect(result.body).toMatchObject({ success: true, source: 'ai', access: 'full', reused: false,
      historical_interpretation_id: HISTORY, version: { id: 'v2', generated_at: '2026-10-11T01:00:00Z' } });
    expect(result.body.interpretation).toEqual(full);
    expect(result.writes).toEqual([`update:lab_reports:${JSON.stringify({ status: 'ready' })}`]);
  });

  it('a fresh credit is consumed in the same RPC as the version', async () => {
    const result = await run({ anchor: true, free: true, claim: false, claimCount: 1 });
    expect(result.response.status).toBe(200);
    expect(persisting(result.rpcs)).toEqual(['commit_deep_access_version']);
    expect(result.rpcs.find(r => r.name === 'commit_deep_access_version')!.args.p_consume_credit).toBe(true);
    expect(result.body).toMatchObject({ access: 'full', version: { id: 'v2' } });
  });

  it('limit_reached at commit persists nothing and is not appended as a Free version', async () => {
    const result = await run({ anchor: true, free: true, claim: false, claimCount: 2, ledgerOutcome: 'limit_reached' });
    expect(result.response.status).toBe(503);
    expect(result.body).toEqual({ error: 'regeneration_failed', retryable: true });
    expect(persisting(result.rpcs)).toEqual(['commit_deep_access_version']);
    expect(result.writes).toEqual([]);
  });

  it('a non-versionable body is refused before the ledger: no claim, nothing written', async () => {
    const failed = await run({ anchor: true, free: true, claim: false, claimCount: 1, model: null });
    expect(failed.response.status).toBe(503);
    expect(persisting(failed.rpcs)).toEqual([]);
    expect(failed.writes).toEqual([]);
    const { questions_for_doctor: _dropped, ...withoutQuestions } = generated();
    const violating = await run({ anchor: true, free: true, claim: true, model: withoutQuestions });
    expect(violating.response.status).toBe(503);
    expect(persisting(violating.rpcs)).toEqual([]);
  });

  it('introductory access exhausted before the model (post-limit default): ordinary writer, no ledger, served Basic', async () => {
    const result = await run({ anchor: true, free: true, claim: false, claimCount: 3 });
    expect(result.response.status).toBe(200);
    expect(persisting(result.rpcs)).toEqual(['append_interpretation_version']);
    expect(result.body).toMatchObject({ access: 'basic', version: { id: 'v1' } });
  });

  it('maps ledger refusals: 55000 to 409, a committed twin is served, other errors 500 without branding the report', async () => {
    const guarded = await run({ anchor: true, free: true, claim: true, ledgerError: { code: '55000', message: 'immutable' } });
    expect(guarded.response.status).toBe(409);
    expect(guarded.body).toEqual({ error: 'legacy_history_protected' });
    expect(guarded.writes).toEqual([]);
    const twin = await run({ anchor: true, free: true, claim: true, ledgerError: { code: '22023', message: 'reused' }, twinAfterReuse: true });
    expect(twin.response.status).toBe(200);
    expect(twin.body).toMatchObject({ access: 'full', reused: true, version: { id: 'v0' } });
    const failed = await run({ anchor: true, free: true, claim: true, ledgerError: { code: '40001', message: 'stale' } });
    expect(failed.response.status).toBe(500);
    expect(failed.writes).toEqual([]);
  });

  it('a report with no anchor keeps the first-generation ledger commit', async () => {
    const result = await run({ anchor: false, free: true, claim: false, claimCount: 0, requestId: null });
    expect(result.response.status).toBe(200);
    expect(persisting(result.rpcs)).toEqual(['commit_deep_access_v2']);
    expect(result.body).toMatchObject({ access: 'full' });
    expect(result.body).not.toHaveProperty('version');
  });

  it('a committed retry is served with the readers\' access rule: a claim on the report is Full', async () => {
    const covered = await run({ anchor: true, free: true, committed: true, hasClaim: true });
    expect(covered.response.status).toBe(200);
    expect(covered.tryOpenAI).not.toHaveBeenCalled();
    expect(persisting(covered.rpcs)).toEqual([]);
    expect(covered.body).toMatchObject({ access: 'full', interpretation: COMMITTED.json_output, reused: true, version: { id: 'v0' } });
    const uncovered = await run({ anchor: true, free: true, committed: true, hasClaim: false });
    expect(uncovered.body).toMatchObject({ access: 'basic', reused: true });
    expect(uncovered.body.interpretation).not.toEqual(COMMITTED.json_output);
  });

  // Negative controls, executed in memory against mutated handler source.
  it('negative control: a ledger branch that ignores appendsVersion reaches commit_deep_access_v2', async () => {
    expect(source.split(LEDGER_CUTOVER)).toHaveLength(2);
    const mutated = source.replace(LEDGER_CUTOVER, 'if (false) {\n          const settled = await commitLedgerVersion(');
    const result = await run({ anchor: true, free: true, claim: true, handlerSource: mutated });
    expect(persisting(result.rpcs)).toContain('commit_deep_access_v2');
    expect(persisting(result.rpcs)).not.toContain('commit_deep_access_version');
  });

  it('negative control: without the early versionable check a failed model is appended', async () => {
    expect(source.split(VERSIONABLE_FIRST)).toHaveLength(2);
    const mutated = source.replace(VERSIONABLE_FIRST, 'if (false && !isVersionable(');
    const result = await run({ anchor: true, free: true, claim: false, claimCount: 1, model: null, handlerSource: mutated });
    expect(persisting(result.rpcs)).toContain('append_interpretation_version');
  });

  it('PK-FIX-01b DT9: kill switch on, Free first generation with a credit: no model call, no claim, no credit, Basic, ai_paused', async () => {
    const paused = await run({ anchor: false, free: true, claim: false, claimCount: 0, requestId: null, aiPaused: true });
    expect(paused.tryOpenAI).not.toHaveBeenCalled();
    expect(paused.response.status).toBe(200);
    expect(persisting(paused.rpcs)).toEqual(['save_interpretation']);
    expect(names(paused.rpcs)).not.toContain('commit_deep_access_v2');
    expect(names(paused.rpcs)).not.toContain('commit_deep_access_version');
    expect(paused.rpcs.find(r => r.name === 'save_interpretation')!.args).toMatchObject({ p_source: 'fallback', p_tier: 'free' });
    expect(paused.body).toMatchObject({ success: true, access: 'basic', ai_paused: true });

    // Control: the same request with the switch off calls the model and commits the claim.
    const live = await run({ anchor: false, free: true, claim: false, claimCount: 0, requestId: null });
    expect(live.tryOpenAI).toHaveBeenCalledTimes(1);
    expect(persisting(live.rpcs)).toEqual(['commit_deep_access_v2']);
    expect(live.body).not.toHaveProperty('ai_paused');
  });

  it('PK-FIX-01b DT9: kill switch on, a regeneration appends nothing, claims nothing, and the refusal says paused', async () => {
    const paused = await run({ anchor: true, free: true, claim: false, claimCount: 0, aiPaused: true });
    expect(paused.tryOpenAI).not.toHaveBeenCalled();
    expect(paused.response.status).toBe(503);
    expect(persisting(paused.rpcs)).toEqual([]);
    expect(paused.writes).toEqual([]);
    expect(paused.body).toMatchObject({ error: 'regeneration_failed', ai_paused: true });
  });

  it('PK-FIX-01b: kill switch on, a Premium first generation serves the deterministic interpretation with ai_paused', async () => {
    const paused = await run({ anchor: false, flagOn: true, requestId: null, aiPaused: true });
    expect(paused.tryOpenAI).not.toHaveBeenCalled();
    expect(paused.response.status).toBe(200);
    expect(persisting(paused.rpcs)).toEqual(['save_interpretation']);
    expect(paused.body).toMatchObject({ success: true, source: 'fallback', ai_paused: true });
  });

  it('no Free path with an anchor reaches an in-place writer', async () => {
    for (const scenario of [{ claim: true }, { claim: false, claimCount: 1 }, { claim: false, claimCount: 2, ledgerOutcome: 'limit_reached' as const },
      { claim: false, claimCount: 3 }]) {
      const result = await run({ anchor: true, free: true, ...scenario });
      expect(names(result.rpcs)).not.toContain('save_interpretation');
      expect(names(result.rpcs)).not.toContain('commit_deep_access_v2');
      expect(names(result.rpcs).filter(n => LEDGER_RPCS.includes(n) || n === 'append_interpretation_version').length).toBeLessThanOrEqual(1);
    }
  });
});
