// Proves scripts/smoke/v2-post-deploy.mjs (PR #93 runbook step 8) against a
// network fake. Nothing here reaches a real network: every request goes to
// `fake.fetch`, which fails the test on any host or route it does not model.
import { describe, expect, it } from 'vitest';
// @ts-expect-error -- plain Node ESM script without type declarations
import * as smoke from './v2-post-deploy.mjs';

const BASE = 'https://smoke-test.supabase.example';
const USER = '11111111-1111-4111-8111-111111111111';
const OTHER_USER = '99999999-9999-4999-8999-999999999999';
const REPORT_OLD = 'aaaaaaaa-0000-4000-8000-000000000001';
const REPORT_NEW = 'aaaaaaaa-0000-4000-8000-000000000002';
const ANCHOR = 'bbbbbbbb-0000-4000-8000-000000000001';
const VERSION = 'cccccccc-0000-4000-8000-000000000001';
const REQUEST = 'dddddddd-0000-4000-8000-000000000001';
const TOKEN = 'user-access-token';

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

type Faults = Partial<{
  signInStatus: number;
  sessionEmail: string;
  foreignReport: boolean;
  allInterpreted: boolean;
  firstStatus: number;
  regenStatus: number;
  regenSource: string;
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
  const state = {
    deleted: false,
    reports: [
      { id: REPORT_NEW, user_id: USER, created_at: '2026-10-02T00:00:00Z' },
      { id: REPORT_OLD, user_id: USER, created_at: '2026-10-01T00:00:00Z' },
    ] as Array<{ id: string; user_id: string; created_at: string }>,
    // report id -> served interpretation id (anchor, or selected version)
    served: new Map<string, string>([[REPORT_OLD, 'eeeeeeee-0000-4000-8000-000000000000']]),
    versions: new Map<string, string>(), // request id -> version id
  };
  if (faults.allInterpreted) state.served.set(REPORT_NEW, ANCHOR);
  if (faults.foreignReport) state.reports.push({ id: 'ffffffff-0000-4000-8000-000000000000', user_id: OTHER_USER, created_at: '2026-10-03T00:00:00Z' });

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
      if (state.deleted) return reply(200, []);
      return reply(200, state.reports);
    }
    if (route === 'GET /rest/v1/interpretations') {
      const filter = url.searchParams.get('lab_report_id') ?? '';
      const ids = filter.startsWith('in.(') ? filter.slice(4, -1).split(',') : [filter.replace(/^eq\./, '')];
      return reply(200, ids.filter((id) => state.served.has(id)).map((id) => ({ id: state.served.get(id), lab_report_id: id })));
    }
    if (route === 'POST /functions/v1/generate-interpretation') {
      const { reportId, request_id: requestId } = body;
      if (!state.served.has(reportId)) {
        if (faults.firstStatus) return reply(faults.firstStatus, { error: 'Internal server error' });
        state.served.set(reportId, ANCHOR);
        return reply(200, { success: true, source: 'ai' });
      }
      if (!requestId) return reply(400, { error: 'request_id_required' });
      if (faults.regenStatus) return reply(faults.regenStatus, { error: 'subscription_required' });
      const reused = state.versions.has(requestId) && !faults.retryNewVersion;
      const versionId = reused ? state.versions.get(requestId)! : (state.versions.size === 0 ? VERSION : 'cccccccc-0000-4000-8000-000000000099');
      state.versions.set(requestId, versionId);
      if (faults.overwriteAnchor) state.served.set(reportId, ANCHOR);
      else state.served.set(reportId, versionId);
      const identity = faults.omitVersion ? {} : {
        historical_interpretation_id: faults.overwriteAnchor || faults.replacedAnchor ? 'bbbbbbbb-0000-4000-8000-0000000000ff' : ANCHOR,
        version: { id: faults.overwriteAnchor ? ANCHOR : versionId, generated_at: '2026-10-13T12:00:00Z' },
      };
      return reply(200, { success: true, source: faults.regenSource ?? 'ai', reused, ...identity });
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
  const code = await smoke.main([FLAG], ENV, { fetch: fake.fetch, randomUUID: () => REQUEST, log: (s: string) => lines.push(s) });
  const output = lines.join('\n');
  const status = (check: string) => {
    const row = output.split('\n').find((l) => l.startsWith(`| ${check} `));
    return row?.split('|')[2]?.trim();
  };
  return { code, output, status, fake };
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
    const { code, output, status, fake } = await run();
    expect(code).toBe(0);
    for (const check of smoke.CHECKS) expect(status(check)).toBe('PASS');
    expect(output).toContain('RESULT: PASS');
    expect(output).toMatch(/\| check\s+\| result\s+\| detail/);
    // Targeted the un-interpreted report, never the already-interpreted one.
    const gens = fake.seen.filter((s) => s.url.pathname.endsWith('/generate-interpretation'));
    expect(gens.map((g) => (g.body as { reportId: string }).reportId)).toEqual([REPORT_NEW, REPORT_NEW, REPORT_NEW]);
    expect(gens.map((g) => (g.body as { request_id?: string }).request_id)).toEqual([undefined, REQUEST, REQUEST]);
    expect(fake.state.deleted).toBe(true);
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

  it('never prints the email, password, token or keys', async () => {
    const { output } = await run();
    for (const secret of [ENV.SMOKE_TEST_EMAIL, ENV.SMOKE_TEST_PASSWORD, TOKEN, ANON_KEY]) expect(output).not.toContain(secret);
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

  it('fails regeneration that is not a versioned AI regeneration, and still deletes the account', async () => {
    const r1 = await run({ regenStatus: 402 });
    expect(r1.status('regeneration')).toBe('FAIL');
    expect(r1.output).toContain('HTTP 402 subscription_required');
    expect(r1.status('returned version identity')).toBe('NOT RUN');
    expect(r1.status('account deletion')).toBe('PASS');
    const r2 = await run({ regenSource: 'fallback' });
    expect(r2.status('regeneration')).toBe('FAIL');
  });

  it('fails first generation and still deletes the account it wrote to', async () => {
    const { code, status, fake } = await run({ firstStatus: 500 });
    expect(code).toBe(1);
    expect(status('first generation')).toBe('FAIL');
    expect(status('regeneration')).toBe('NOT RUN');
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

  it('writes nothing and deletes nothing when no report is ready to interpret', async () => {
    const { code, status, fake } = await run({ allInterpreted: true });
    expect(code).toBe(1);
    expect(status('sign-in (disposable test account)')).toBe('FAIL');
    expect(fake.seen.some((s) => s.method === 'POST' && s.url.pathname.startsWith('/functions/'))).toBe(false);
    expect(status('account deletion')).toBe('NOT RUN');
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
});
