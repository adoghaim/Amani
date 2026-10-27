// Proves scripts/smoke/v2-post-deploy.mjs (PR #93 runbook step 8) against a
// network fake. Nothing here reaches a real network: every request goes to
// `fake.fetch`, which fails the test on any host or route it does not model.
//
// The fake's generate-interpretation failures are built from the server's own
// response helpers, so the smoke is proven against the bodies the function
// actually sends, not against a copy that can drift from them (the 2026-10-17
// run met a fallback first generation and a 503 the old fake never modelled).
import { describe, expect, it } from 'vitest';
// @ts-expect-error -- plain Node ESM script without type declarations
import * as smoke from './v2-post-deploy.mjs';
import { regenerationFailedResponse } from '../../supabase/functions/_shared/interpretation-version-write';
import {
  fallbackDiagnostics, refusalDiagnostics, type FallbackReason, type ModelFailure, type RegenerationFailureReason,
} from '../../supabase/functions/_shared/generation-outcome';

const BASE = 'https://smoke-test.supabase.example';
const USER = '11111111-1111-4111-8111-111111111111';
const OTHER_USER = '99999999-9999-4999-8999-999999999999';
const REPORT_OLD = 'aaaaaaaa-0000-4000-8000-000000000001';
const REPORT_NEW = 'aaaaaaaa-0000-4000-8000-000000000002';
const REPORT_NEWEST = 'aaaaaaaa-0000-4000-8000-000000000003';
const ANCHOR = 'bbbbbbbb-0000-4000-8000-000000000001';
const VERSION = 'cccccccc-0000-4000-8000-000000000001';
const REQUEST = 'dddddddd-0000-4000-8000-000000000001';
const TOKEN = 'user-access-token';
// Sentinels that must never reach the output: bodies, values, identifiers.
const BODY_SENTINEL = 'Synthetic interpretation body SENTINEL-7f3a';

function jwt(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(payload)}.signature`;
}
const ANON_KEY = jwt({ role: 'anon', iss: 'supabase' });
const SERVICE_KEY = jwt({ role: 'service_role', iss: 'supabase' });

const ENV = {
  SMOKE_SUPABASE_URL: BASE,
  SMOKE_SUPABASE_ANON_KEY: ANON_KEY,
  SMOKE_TEST_EMAIL: 'owner+amani-smoke@example.com',
  SMOKE_TEST_PASSWORD: 'synthetic-password',
};
const FLAG = '--i-understand-this-hits-production';

interface Report { id: string; user_id: string; upload_date: string; status: string; markers: number }

type Faults = Partial<{
  signInStatus: number;
  sessionEmail: string;
  foreignReport: boolean;
  allInterpreted: boolean;
  /** Overrides on the uninterpreted target (REPORT_NEW). */
  target: Partial<Pick<Report, 'status' | 'markers'>>;
  /** A newer uninterpreted report in front of the target. */
  newest: Partial<Pick<Report, 'status' | 'markers'>>;
  markersStatus: number;
  planStatus: number;
  planCode: string;
  firstStatus: number;
  /** First generation answers 200 with the deterministic interpretation. */
  firstFallback: { reason?: FallbackReason; modelFailure?: ModelFailure; aiPaused?: boolean };
  regenStatus: number;
  regenSource: string;
  /** Regeneration answers the server's own 503. */
  regenRefusal: { retryable: boolean; reason?: RegenerationFailureReason; modelFailure?: ModelFailure; aiPaused?: boolean };
  omitVersion: boolean;
  overwriteAnchor: boolean;
  replacedAnchor: boolean;
  retryNewVersion: boolean;
  deleteStatus: number;
  deleteKeepsLogin: boolean;
}>;

interface Seen { method: string; url: URL; headers: Record<string, string>; body: unknown }

function makeFake(faults: Faults = {}) {
  const seen: Seen[] = [];
  const reports: Report[] = [
    { id: REPORT_NEW, user_id: USER, upload_date: '2026-10-02T00:00:00Z', status: 'ready', markers: 12, ...faults.target },
    { id: REPORT_OLD, user_id: USER, upload_date: '2026-10-01T00:00:00Z', status: 'ready', markers: 12 },
  ];
  if (faults.newest) reports.unshift({ id: REPORT_NEWEST, user_id: USER, upload_date: '2026-10-03T00:00:00Z', status: 'ready', markers: 12, ...faults.newest });
  if (faults.foreignReport) reports.push({ id: 'ffffffff-0000-4000-8000-000000000000', user_id: OTHER_USER, upload_date: '2026-10-04T00:00:00Z', status: 'ready', markers: 1 });
  const state = {
    deleted: false,
    reports,
    // report id -> served interpretation id (anchor, or selected version)
    served: new Map<string, string>([[REPORT_OLD, 'eeeeeeee-0000-4000-8000-000000000000']]),
    versions: new Map<string, string>(), // request id -> version id
  };
  if (faults.allInterpreted) for (const r of reports) state.served.set(r.id, ANCHOR);

  const reply = (status: number, json: unknown) => ({ status, json: async () => json });

  async function fetch(input: string, init: { method: string; headers: Record<string, string>; body?: string }) {
    const url = new URL(input);
    const body = init.body ? JSON.parse(init.body) : undefined;
    seen.push({ method: init.method, url, headers: init.headers, body });
    if (url.origin !== BASE) throw new Error(`unexpected host ${url.origin}`);
    const route = `${init.method} ${url.pathname}`;
    const authed = init.headers.Authorization === `Bearer ${TOKEN}`;

    if (route === 'POST /auth/v1/token') {
      if (state.deleted && !faults.deleteKeepsLogin) return reply(400, { error_code: 'invalid_credentials' });
      if (faults.signInStatus) return reply(faults.signInStatus, { error_code: 'invalid_credentials' });
      if (body.email !== ENV.SMOKE_TEST_EMAIL || body.password !== ENV.SMOKE_TEST_PASSWORD) return reply(400, { error_code: 'invalid_credentials' });
      return reply(200, { access_token: TOKEN, user: { id: USER, email: faults.sessionEmail ?? ENV.SMOKE_TEST_EMAIL } });
    }
    if (!authed) return reply(401, { code: 'unauthorized' });

    if (route === 'GET /rest/v1/lab_reports') {
      expect(url.searchParams.get('select')).toBe(state.deleted ? 'id' : 'id,user_id,upload_date,status');
      expect(url.searchParams.get('order')).toBe(state.deleted ? null : 'upload_date.desc');
      if (state.deleted) return reply(200, []);
      return reply(200, state.reports.map(({ markers: _markers, ...row }) => row));
    }
    if (route === 'GET /rest/v1/interpretations') {
      const filter = url.searchParams.get('lab_report_id') ?? '';
      const ids = filter.startsWith('in.(') ? filter.slice(4, -1).split(',') : [filter.replace(/^eq\./, '')];
      return reply(200, ids.filter((id) => state.served.has(id)).map((id) => ({ id: state.served.get(id), lab_report_id: id })));
    }
    if (route === 'GET /rest/v1/report_analytes') {
      expect(url.searchParams.get('select')).toBe('id');
      expect(url.searchParams.get('limit')).toBe('1');
      if (faults.markersStatus) return reply(faults.markersStatus, { code: 'PGRST301', message: 'synthetic read failure' });
      const id = (url.searchParams.get('lab_report_id') ?? '').replace(/^eq\./, '');
      const report = state.reports.find((r) => r.id === id);
      return reply(200, report && report.markers > 0 ? [{ id: 'a0000000-0000-4000-8000-000000000001' }] : []);
    }
    if (route === 'POST /functions/v1/get-interpretation') {
      if (faults.planStatus) return reply(faults.planStatus, { access: 'error', code: faults.planCode ?? 'entitlement_unavailable' });
      return reply(200, { access: 'generation_needed', interpretation: null, plan: 'free',
        complimentary: { used: 1, total: 3, remaining: 2 } });
    }
    if (route === 'POST /functions/v1/generate-interpretation') {
      const { reportId, request_id: requestId } = body;
      if (!state.served.has(reportId)) {
        if (faults.firstStatus) return reply(faults.firstStatus, { error: 'Internal server error' });
        state.served.set(reportId, ANCHOR);
        if (faults.firstFallback) {
          const { reason, modelFailure, aiPaused } = faults.firstFallback;
          return reply(200, { success: true, source: 'fallback', access: 'basic', interpretation: { headline: BODY_SENTINEL },
            ...(reason ? fallbackDiagnostics(reason, modelFailure ?? null) : {}), ...(aiPaused ? { ai_paused: true } : {}) });
        }
        return reply(200, { success: true, source: 'ai', interpretation: { headline: BODY_SENTINEL } });
      }
      if (!requestId) return reply(400, { error: 'request_id_required' });
      if (faults.regenStatus) return reply(faults.regenStatus, { error: 'subscription_required', reason: 'onboarding_incomplete' });
      if (faults.regenRefusal) {
        const { retryable, reason, modelFailure, aiPaused } = faults.regenRefusal;
        const refused = regenerationFailedResponse(retryable, reason ? refusalDiagnostics(reason, modelFailure ?? null) : undefined);
        return reply(refused.status, { ...refused.body, ...(aiPaused ? { ai_paused: true } : {}) });
      }
      const reused = state.versions.has(requestId) && !faults.retryNewVersion;
      const versionId = reused ? state.versions.get(requestId)! : (state.versions.size === 0 ? VERSION : 'cccccccc-0000-4000-8000-000000000099');
      state.versions.set(requestId, versionId);
      if (faults.overwriteAnchor) state.served.set(reportId, ANCHOR);
      else state.served.set(reportId, versionId);
      const identity = faults.omitVersion ? {} : {
        historical_interpretation_id: faults.overwriteAnchor || faults.replacedAnchor ? 'bbbbbbbb-0000-4000-8000-0000000000ff' : ANCHOR,
        version: { id: faults.overwriteAnchor ? ANCHOR : versionId, generated_at: '2026-10-13T12:00:00Z' },
      };
      return reply(200, { success: true, source: faults.regenSource ?? 'ai', reused, interpretation: { headline: BODY_SENTINEL }, ...identity });
    }
    if (route === 'POST /functions/v1/delete-user-data') {
      if (faults.deleteStatus) return reply(faults.deleteStatus, { error: 'Internal server error' });
      state.deleted = true;
      return reply(200, { success: true });
    }
    throw new Error(`unmodelled route ${route}`);
  }
  return { fetch, seen, state };
}

async function run(faults: Faults = {}) {
  const fake = makeFake(faults);
  const lines: string[] = [];
  let clock = 0;
  // Every call to the clock advances it 1.5 s, so each timed call reads "1.5 s".
  const now = () => { clock += 1500; return clock; };
  const code = await smoke.main([FLAG], ENV, { fetch: fake.fetch, randomUUID: () => REQUEST, now, log: (s: string) => lines.push(s) });
  const output = lines.join('\n');
  const row = (check: string) => output.split('\n').find((l) => l.startsWith(`| ${check} `));
  const status = (check: string) => row(check)?.split('|')[2]?.trim();
  const detail = (check: string) => row(check)?.split('|').slice(3).join('|').trim();
  const generations = fake.seen.filter((s) => s.url.pathname.endsWith('/generate-interpretation'));
  return { code, output, status, detail, fake, generations };
}

describe('v2 post-deploy smoke: refusals (no network)', () => {
  const noFetch = async () => { throw new Error('network must not be touched'); };

  it('refuses to run without the explicit production flag', async () => {
    const lines: string[] = [];
    const code = await smoke.main([], ENV, { fetch: noFetch, log: (s: string) => lines.push(s) });
    expect(code).toBe(2);
    expect(lines.join('\n')).toContain(FLAG);
  });

  it('refuses unknown arguments, including a misspelled flag', () => {
    expect(smoke.parseInvocation(['--i-understand'], ENV).ok).toBe(false);
    expect(smoke.parseInvocation([FLAG, '--force'], ENV).ok).toBe(false);
  });

  it('names missing variables by NAME only and never echoes values', () => {
    const r = smoke.parseInvocation([FLAG], { ...ENV, SMOKE_TEST_PASSWORD: '', SMOKE_SUPABASE_URL: undefined });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('SMOKE_SUPABASE_URL');
    expect(r.reason).toContain('SMOKE_TEST_PASSWORD');
    expect(r.reason).not.toContain(ENV.SMOKE_TEST_EMAIL);
    expect(smoke.ENV_NAMES).toEqual(['SMOKE_SUPABASE_URL', 'SMOKE_SUPABASE_ANON_KEY', 'SMOKE_TEST_EMAIL', 'SMOKE_TEST_PASSWORD']);
  });

  it('refuses a service-role or secret key in place of the anon key', () => {
    expect(smoke.parseInvocation([FLAG], { ...ENV, SMOKE_SUPABASE_ANON_KEY: SERVICE_KEY }).reason).toMatch(/not an anon key/);
    expect(smoke.parseInvocation([FLAG], { ...ENV, SMOKE_SUPABASE_ANON_KEY: 'sb_secret_abc' }).reason).toMatch(/secret key/);
    expect(smoke.parseInvocation([FLAG], { ...ENV, SMOKE_SUPABASE_ANON_KEY: 'sb_publishable_abc' }).ok).toBe(true);
  });

  it('refuses an account that is not marked as a disposable smoke account', () => {
    expect(smoke.parseInvocation([FLAG], { ...ENV, SMOKE_TEST_EMAIL: 'real.customer@example.com' }).reason).toMatch(/smoke/);
    expect(smoke.parseInvocation([FLAG], { ...ENV, SMOKE_TEST_EMAIL: 'owner@smoke.example.com' }).ok).toBe(false);
  });

  it('refuses plain http to a remote host and URLs with a path', () => {
    expect(smoke.parseInvocation([FLAG], { ...ENV, SMOKE_SUPABASE_URL: 'http://smoke-test.supabase.example' }).ok).toBe(false);
    expect(smoke.parseInvocation([FLAG], { ...ENV, SMOKE_SUPABASE_URL: `${BASE}/rest/v1` }).ok).toBe(false);
    expect(smoke.parseInvocation([FLAG], { ...ENV, SMOKE_SUPABASE_URL: 'http://127.0.0.1:54321' }).ok).toBe(true);
  });
});

describe('v2 post-deploy smoke: runbook step 8 against a fake', () => {
  it('passes every check on a healthy deployment and prints a pass/fail table', async () => {
    const { code, output, status, detail, fake, generations } = await run();
    expect(code).toBe(0);
    for (const check of smoke.CHECKS) expect(status(check)).toBe('PASS');
    expect(output).toContain('RESULT: PASS');
    expect(output).toMatch(/\| check\s+\| result\s+\| detail/);
    // Targeted the un-interpreted report, never the already-interpreted one.
    expect(generations.map((g) => (g.body as { reportId: string }).reportId)).toEqual([REPORT_NEW, REPORT_NEW, REPORT_NEW]);
    expect(generations.map((g) => (g.body as { request_id?: string }).request_id)).toEqual([undefined, REQUEST, REQUEST]);
    expect(fake.state.deleted).toBe(true);
    // The plan the run used is on the record, as counts only.
    expect(detail('target report (preconditions)')).toContain('plan free, 1 of 3 introductory analyses used');
    expect(detail('first generation')).toContain('after 1.5 s, source ai');
  });

  it('acts only as the test user: one host, anon key, the user JWT, never a service key', async () => {
    const { fake } = await run();
    for (const s of fake.seen) {
      expect(s.url.origin).toBe(BASE);
      expect(s.headers.apikey).toBe(ANON_KEY);
      if (s.url.pathname === '/auth/v1/token') expect(s.headers.Authorization).toBe(`Bearer ${ANON_KEY}`);
      else expect(s.headers.Authorization).toBe(`Bearer ${TOKEN}`);
      if (s.url.pathname === '/rest/v1/lab_reports') expect(s.url.searchParams.get('user_id')).toBe(`eq.${USER}`);
      expect(s.method === 'GET' || s.method === 'POST').toBe(true);
    }
  });

  it('never prints the email, password, token, keys, bodies or identifiers', async () => {
    for (const faults of [{}, { firstFallback: { reason: 'model_failed' as const, modelFailure: 'timeout' as const } }]) {
      const { output } = await run(faults);
      for (const secret of [ENV.SMOKE_TEST_EMAIL, ENV.SMOKE_TEST_PASSWORD, TOKEN, ANON_KEY, BODY_SENTINEL, REPORT_NEW, ANCHOR, VERSION, USER]) {
        expect(output).not.toContain(secret);
      }
    }
  });

  it('fails "old interpretation not overwritten" when regeneration is not anchored on the first interpretation', async () => {
    const { code, status } = await run({ overwriteAnchor: true });
    expect(code).toBe(1);
    expect(status('old interpretation not overwritten')).toBe('FAIL');
    expect(status('returned version identity')).toBe('FAIL');
    expect(status('account deletion')).toBe('PASS');
  });

  it('fails only "old interpretation not overwritten" when the version hangs off a different (replaced) anchor', async () => {
    const { code, status } = await run({ replacedAnchor: true });
    expect(code).toBe(1);
    expect(status('returned version identity')).toBe('PASS');
    expect(status('old interpretation not overwritten')).toBe('FAIL');
  });

  it('fails "returned version identity" when the response carries no version', async () => {
    const { code, status } = await run({ omitVersion: true });
    expect(code).toBe(1);
    expect(status('returned version identity')).toBe('FAIL');
    expect(status('old interpretation not overwritten')).toBe('FAIL');
  });

  it('fails "returned version identity" when a retry with the same request_id appends a new version', async () => {
    const { code, status, output } = await run({ retryNewVersion: true });
    expect(code).toBe(1);
    expect(status('returned version identity')).toBe('FAIL');
    expect(output).toContain('retry with the same request_id');
  });

  it('fails first generation and still deletes the account it wrote to', async () => {
    const { code, status, detail, fake } = await run({ firstStatus: 500 });
    expect(code).toBe(1);
    expect(status('first generation')).toBe('FAIL');
    expect(status('regeneration')).toBe('NOT RUN');
    expect(detail('regeneration')).toBe('not run: first generation failed');
    expect(status('account deletion')).toBe('PASS');
    expect(fake.state.deleted).toBe(true);
  });

  it('fails account deletion when delete-user-data errors or the account survives', async () => {
    const r1 = await run({ deleteStatus: 500 });
    expect(r1.code).toBe(1);
    expect(r1.status('account deletion')).toBe('FAIL');
    expect(r1.output).toContain('still exists');
    const r2 = await run({ deleteKeepsLogin: true });
    expect(r2.status('account deletion')).toBe('FAIL');
    expect(r2.output).toContain('can still sign in');
  });

  it('stops without writing when any row of another user comes back', async () => {
    const { code, output, fake } = await run({ foreignReport: true });
    expect(code).toBe(1);
    expect(output).toContain('another user');
    expect(fake.seen.some((s) => s.url.pathname.startsWith('/functions/'))).toBe(false);
  });

  it('stops when the session is not the SMOKE_TEST_EMAIL account, or sign-in fails', async () => {
    const r1 = await run({ sessionEmail: 'someone-else@example.com' });
    expect(r1.status('sign-in (disposable test account)')).toBe('FAIL');
    expect(r1.fake.seen).toHaveLength(1);
    const r2 = await run({ signInStatus: 400 });
    expect(r2.status('sign-in (disposable test account)')).toBe('FAIL');
    expect(r2.fake.seen).toHaveLength(1);
  });

  it('gives every row that did not run its reason', async () => {
    for (const faults of [{ signInStatus: 400 }, { allInterpreted: true }, { firstStatus: 500 }, { regenStatus: 402 },
      { firstFallback: { reason: 'ai_paused' as const, aiPaused: true } }] as Faults[]) {
      const { output } = await run(faults);
      const notRun = output.split('\n').filter((l) => l.includes('| NOT RUN |'));
      expect(notRun.length, JSON.stringify(faults)).toBeGreaterThan(0);
      for (const line of notRun) expect(line.split('|').slice(3).join('|').trim(), line).toMatch(/^not run: /);
    }
  });
});

describe('v2 post-deploy smoke: the target report is checked before anything is written', () => {
  const wroteNothing = (fake: ReturnType<typeof makeFake>) =>
    expect(fake.seen.some((s) => s.url.pathname === '/functions/v1/generate-interpretation'
      || s.url.pathname === '/functions/v1/delete-user-data')).toBe(false);

  it('BLOCKED when no report is waiting for an interpretation, and nothing is written or deleted', async () => {
    const { code, status, detail, fake } = await run({ allInterpreted: true });
    expect(code).toBe(3);
    expect(status('sign-in (disposable test account)')).toBe('PASS');
    expect(status('target report (preconditions)')).toBe('BLOCKED');
    expect(status('account deletion')).toBe('NOT RUN');
    expect(detail('account deletion')).toBe('not run: nothing was written, so the account was kept');
    wroteNothing(fake);
  });

  it('BLOCKED when the only candidate has no parsed markers: the 2026-10-17 target, refused before any write', async () => {
    const { code, status, detail, output, fake } = await run({ target: { markers: 0 } });
    expect(code).toBe(3);
    expect(status('target report (preconditions)')).toBe('BLOCKED');
    expect(detail('target report (preconditions)')).toContain('1 without parsed markers');
    expect(output).toContain('RESULT: BLOCKED');
    wroteNothing(fake);
  });

  it('skips a newer report without markers, or one still processing, in favour of the older one that is ready', async () => {
    for (const newest of [{ markers: 0 }, { status: 'processing' }]) {
      const { code, detail, generations } = await run({ newest });
      expect(code, JSON.stringify(newest)).toBe(0);
      expect(generations.map((g) => (g.body as { reportId: string }).reportId)).toEqual([REPORT_NEW, REPORT_NEW, REPORT_NEW]);
      expect(detail('target report (preconditions)')).toMatch(/skipped 1 (without parsed markers|still processing)/);
    }
  });

  it('FAIL without writing when the markers cannot be read', async () => {
    const { code, status, detail, fake } = await run({ markersStatus: 500 });
    expect(code).toBe(1);
    expect(status('target report (preconditions)')).toBe('FAIL');
    expect(detail('target report (preconditions)')).toContain('HTTP 500 PGRST301');
    wroteNothing(fake);
  });

  it('BLOCKED without writing when the account has not finished onboarding', async () => {
    const { code, status, fake } = await run({ planStatus: 403, planCode: 'onboarding_incomplete' });
    expect(code).toBe(3);
    expect(status('target report (preconditions)')).toBe('BLOCKED');
    wroteNothing(fake);
  });

  it('a plan that cannot be read is reported, and does not stop the run', async () => {
    const { code, detail } = await run({ planStatus: 503 });
    expect(code).toBe(0);
    expect(detail('target report (preconditions)')).toContain('plan not read (HTTP 503 entitlement_unavailable)');
  });
});

describe('v2 post-deploy smoke: a deterministic first generation is never a pass', () => {
  it('the 2026-10-17 answers against today\'s deployment: FAIL, and the reason is said to be missing', async () => {
    // What production sent: 200 source fallback, then 503 regeneration_failed, no reason codes.
    const { code, status, detail, generations } = await run({ firstFallback: {}, regenRefusal: { retryable: true } });
    expect(code).toBe(1);
    expect(status('first generation')).toBe('FAIL');
    expect(detail('first generation')).toContain('HTTP 200 after 1.5 s, but source fallback');
    expect(detail('first generation')).toContain('predates the reason codes');
    expect(status('regeneration')).toBe('FAIL');
    expect(detail('regeneration')).toBe('HTTP 503 regeneration_failed (retryable true): no reason in the answer (the deployed generate-interpretation predates the reason codes) after 1.5 s');
    expect(status('returned version identity')).toBe('NOT RUN');
    expect(detail('returned version identity')).toBe('not run: needs a successful regeneration');
    expect(generations).toHaveLength(2);
    expect(status('account deletion')).toBe('PASS');
  });

  it('a model failure is a FAIL that names how it failed, and the regeneration is still tried once', async () => {
    const { code, status, detail, generations } = await run({
      firstFallback: { reason: 'model_failed', modelFailure: 'timeout' },
      regenRefusal: { retryable: true, reason: 'model_failed', modelFailure: 'http_429' },
    });
    expect(code).toBe(1);
    expect(status('first generation')).toBe('FAIL');
    expect(detail('first generation')).toContain('(fallback_reason model_failed, model_failure timeout)');
    expect(detail('first generation')).toContain('model_failure says how');
    expect(status('regeneration')).toBe('FAIL');
    expect(detail('regeneration')).toContain('HTTP 503 regeneration_failed (reason model_failed, model_failure http_429, retryable true)');
    expect(generations).toHaveLength(2);
  });

  it('a transient model failure on first generation does not hide a working regeneration', async () => {
    const { code, status } = await run({ firstFallback: { reason: 'model_failed' } });
    expect(code).toBe(1);
    expect(status('first generation')).toBe('FAIL');
    expect(status('regeneration')).toBe('PASS');
    expect(status('returned version identity')).toBe('PASS');
    expect(status('old interpretation not overwritten')).toBe('PASS');
  });

  it.each([
    ['ai_paused', 'BLOCKED', 3, 'the AI kill switch is on'],
    ['introductory_access_exhausted', 'BLOCKED', 3, 'no deep generation left'],
    ['no_analytes', 'BLOCKED', 3, 'no parsed markers'],
    ['ai_not_configured', 'FAIL', 1, 'OPENAI_API_KEY is not set'],
    ['report_unavailable', 'FAIL', 1, 'could not read the target report'],
  ] as const)('%s: %s, and a regeneration that cannot append an AI version is not attempted', async (reason, verdict, exit, hint) => {
    const { code, status, detail, generations } = await run({ firstFallback: { reason, aiPaused: reason === 'ai_paused' } });
    expect(code).toBe(exit);
    expect(status('first generation')).toBe(verdict);
    expect(detail('first generation')).toContain(`fallback_reason ${reason}`);
    expect(detail('first generation')).toContain(hint);
    expect(status('regeneration')).toBe('NOT RUN');
    expect(detail('regeneration')).toBe(`not run: a regeneration cannot append an AI version while ${reason}`);
    expect(generations).toHaveLength(1);
    // It wrote an anchor, so it still deletes the account.
    expect(status('account deletion')).toBe('PASS');
  });
});

describe('v2 post-deploy smoke: regeneration answers', () => {
  it('a refused regeneration prints the server\'s reason; one that cannot succeed for this account is BLOCKED', async () => {
    const exhausted = await run({ regenRefusal: { retryable: false, reason: 'introductory_access_exhausted' } });
    expect(exhausted.code).toBe(3);
    expect(exhausted.status('regeneration')).toBe('BLOCKED');
    expect(exhausted.detail('regeneration')).toContain('(reason introductory_access_exhausted, retryable false)');
    const oldServer = await run({ regenRefusal: { retryable: false } });
    expect(oldServer.status('regeneration')).toBe('BLOCKED');
    const paused = await run({ regenRefusal: { retryable: true, reason: 'ai_paused', aiPaused: true } });
    expect(paused.status('regeneration')).toBe('BLOCKED');
    expect(paused.detail('regeneration')).toContain('ai_paused');
    const floor = await run({ regenRefusal: { retryable: true, reason: 'floor_violation' } });
    expect(floor.status('regeneration')).toBe('FAIL');
    expect(floor.detail('regeneration')).toContain('medical floor');
  });

  it('fails regeneration that is not a versioned AI regeneration, and still deletes the account', async () => {
    const r1 = await run({ regenStatus: 402 });
    expect(r1.status('regeneration')).toBe('BLOCKED');
    expect(r1.output).toContain('HTTP 402 subscription_required (reason onboarding_incomplete)');
    expect(r1.status('returned version identity')).toBe('NOT RUN');
    expect(r1.status('account deletion')).toBe('PASS');
    const r2 = await run({ regenSource: 'fallback' });
    expect(r2.status('regeneration')).toBe('FAIL');
  });
});

describe('v2 post-deploy smoke: output', () => {
  it('describe() echoes only fixed codes, never server sentences or bodies', () => {
    expect(smoke.describe({ status: 503, json: { error: 'regeneration_failed', retryable: true, reason: 'model_failed', model_failure: 'http_401' } }))
      .toBe('HTTP 503 regeneration_failed (reason model_failed, model_failure http_401, retryable true)');
    expect(smoke.describe({ status: 503, json: { error: 'regeneration_failed', retryable: true, reason: 'The model said: take 5000 IU' } }))
      .toBe('HTTP 503 regeneration_failed (retryable true)');
    expect(smoke.describe({ status: 403, json: { error: 'You need to accept the terms first.', code: 'consent_required' } }))
      .toBe('HTTP 403 consent_required');
    expect(smoke.describe({ status: 0, json: null, networkError: 'TimeoutError' })).toBe('no response (TimeoutError)');
    // PostgREST and SQLSTATE codes still come through: 42703 is what diagnosed the 2026-10-16 run.
    expect(smoke.describe({ status: 400, json: { code: '42703', message: 'column lab_reports.created_at does not exist' } }))
      .toBe('HTTP 400 42703');
    expect(smoke.describe({ status: 500, json: { error: 'Internal server error' } })).toBe('HTTP 500 Internal server error');
    expect(smoke.describe({ status: 500, json: { error: 'private upstream text must not escape' } })).toBe('HTTP 500');
  });

  it('every reason the server can send has a meaning here', () => {
    for (const reason of ['introductory_access_exhausted', 'report_unavailable', 'no_analytes', 'ai_not_configured', 'ai_paused',
      'model_failed', 'floor_violation', 'introductory_limit_reached']) {
      expect(smoke.REASONS[reason], reason).toBeDefined();
      expect(smoke.hintFor(reason)).not.toContain('predates');
    }
    expect(smoke.hintFor(null)).toContain('predates the reason codes');
  });

  it('exit codes: any FAIL wins, then BLOCKED', () => {
    const rows = (...statuses: string[]) => statuses.map((status, i) => ({ check: String(i), status, detail: '' }));
    expect(smoke.exitCodeOf(rows('PASS', 'PASS'))).toBe(0);
    expect(smoke.exitCodeOf(rows('PASS', 'BLOCKED', 'NOT RUN'))).toBe(3);
    expect(smoke.exitCodeOf(rows('BLOCKED', 'FAIL'))).toBe(1);
    expect(smoke.exitCodeOf(rows('PASS', 'NOT RUN'))).toBe(1);
  });
});
