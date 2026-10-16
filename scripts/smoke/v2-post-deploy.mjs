#!/usr/bin/env node
// V2 post-deploy smoke: PR #93 production runbook step 8.
//
//   "Smoke: first generation; regeneration; returned version identity; old
//    interpretation not overwritten; account deletion on a test account."
//
// OWNER-RUN ONLY, after runbook steps 1-7, against ONE disposable test account.
// The factory never runs this against production; it is proven by
// scripts/smoke/v2-post-deploy.test.ts against network fakes.
//
// Inputs come only from these environment variables (never put values in a
// file that is committed, and never paste them into a chat or a PR):
//   SMOKE_SUPABASE_URL       the project URL (https://<ref>.supabase.co)
//   SMOKE_SUPABASE_ANON_KEY  the public anon / publishable key (never service role)
//   SMOKE_TEST_EMAIL         the disposable test account (must contain "smoke")
//   SMOKE_TEST_PASSWORD      its password
//
//   node scripts/smoke/v2-post-deploy.mjs --i-understand-this-hits-production
//
// Before running, sign in to the app once with the test account and upload one
// synthetic lab report that has no interpretation yet; the account must be able
// to generate a deep AI interpretation (Plus, or Free with an introductory claim
// while freemium is active). The script never creates lab data itself.
//
// Safety: it acts only through the test account's own session (anon key +
// that user's JWT), so RLS and the functions' own ownership checks scope every
// read and write to that one user. It refuses a service-role key, refuses an
// account whose email lacks "smoke", refuses rows that belong to anyone else,
// and never prints interpretation bodies, emails or tokens. The last check
// DELETES THE TEST ACCOUNT through delete-user-data.

import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';

export const PRODUCTION_FLAG = '--i-understand-this-hits-production';
export const ENV_NAMES = Object.freeze([
  'SMOKE_SUPABASE_URL',
  'SMOKE_SUPABASE_ANON_KEY',
  'SMOKE_TEST_EMAIL',
  'SMOKE_TEST_PASSWORD',
]);
export const CHECKS = Object.freeze([
  'sign-in (disposable test account)',
  'first generation',
  'regeneration',
  'returned version identity',
  'old interpretation not overwritten',
  'account deletion',
]);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const GENERATION_TIMEOUT_MS = 150_000;
const DEFAULT_TIMEOUT_MS = 20_000;

function decodeJwtRole(key) {
  const parts = key.split('.');
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
    return typeof payload.role === 'string' ? payload.role : null;
  } catch {
    return null;
  }
}

/** Validates flags and environment. Never performs I/O. */
export function parseInvocation(argv, env) {
  const args = argv.slice();
  const unknown = args.filter((a) => a !== PRODUCTION_FLAG);
  if (unknown.length > 0) return { ok: false, reason: `Unknown argument(s): ${unknown.join(' ')}. The only accepted argument is ${PRODUCTION_FLAG}.` };
  if (!args.includes(PRODUCTION_FLAG)) {
    return { ok: false, reason: `Refusing to run: this smoke writes to and deletes a real account. Re-run with ${PRODUCTION_FLAG} once runbook steps 1-7 are done.` };
  }
  const missing = ENV_NAMES.filter((name) => !env[name] || String(env[name]).trim() === '');
  if (missing.length > 0) return { ok: false, reason: `Missing environment variable(s): ${missing.join(', ')}.` };

  let url;
  try {
    url = new URL(env.SMOKE_SUPABASE_URL);
  } catch {
    return { ok: false, reason: 'SMOKE_SUPABASE_URL is not a URL.' };
  }
  const local = url.hostname === '127.0.0.1' || url.hostname === 'localhost';
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) {
    return { ok: false, reason: 'SMOKE_SUPABASE_URL must use https (http only for a local stack).' };
  }
  if (url.pathname !== '/' || url.search || url.hash) {
    return { ok: false, reason: 'SMOKE_SUPABASE_URL must be the bare project URL, with no path or query.' };
  }

  const key = String(env.SMOKE_SUPABASE_ANON_KEY).trim();
  if (key.startsWith('sb_secret_')) return { ok: false, reason: 'SMOKE_SUPABASE_ANON_KEY is a secret key. Use the public anon/publishable key; this smoke never uses elevated keys.' };
  if (!key.startsWith('sb_publishable_')) {
    const role = decodeJwtRole(key);
    if (role !== 'anon') return { ok: false, reason: 'SMOKE_SUPABASE_ANON_KEY is not an anon key (its role is not "anon"). This smoke never uses elevated keys.' };
  }

  const email = String(env.SMOKE_TEST_EMAIL).trim();
  if (!/^[^@\s]+@[^@\s]+$/.test(email)) return { ok: false, reason: 'SMOKE_TEST_EMAIL is not an email address.' };
  if (!email.split('@')[0].toLowerCase().includes('smoke')) {
    return { ok: false, reason: 'SMOKE_TEST_EMAIL must be a disposable smoke account whose address contains "smoke" before the @ (the last check deletes it).' };
  }

  return {
    ok: true,
    config: { baseUrl: url.origin, anonKey: key, email, password: String(env.SMOKE_TEST_PASSWORD) },
  };
}

function client(config, fetchImpl) {
  return async function call(method, path, { token, body, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    const headers = {
      apikey: config.anonKey,
      Authorization: `Bearer ${token ?? config.anonKey}`,
      Accept: 'application/json',
    };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    let res;
    try {
      res = await fetchImpl(`${config.baseUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      return { status: 0, json: null, networkError: err instanceof Error ? err.name : 'error' };
    }
    let json = null;
    try {
      json = await res.json();
    } catch {
      json = null;
    }
    return { status: res.status, json };
  };
}

// Only fixed server strings are echoed; bodies and identifiers of content are not.
function describe(res) {
  if (res.status === 0) return `no response (${res.networkError})`;
  const code = res.json && (res.json.error ?? res.json.code ?? res.json.error_code);
  return `HTTP ${res.status}${typeof code === 'string' ? ` ${code.slice(0, 80)}` : ''}`;
}

async function signIn(call, config) {
  return call('POST', '/auth/v1/token?grant_type=password', { body: { email: config.email, password: config.password } });
}

async function readServedInterpretation(call, token, reportId) {
  const res = await call('GET', `/rest/v1/interpretations?select=id,lab_report_id&lab_report_id=eq.${reportId}`, { token });
  if (res.status !== 200 || !Array.isArray(res.json)) return { error: describe(res) };
  if (res.json.some((row) => row.lab_report_id !== reportId)) return { error: 'a row for another report came back' };
  if (res.json.length !== 1) return { error: `expected 1 served row, got ${res.json.length}` };
  return { id: res.json[0].id };
}

/**
 * Runs the step-8 checks. `deps.fetch` and `deps.randomUUID` are injectable so
 * tests drive it against fakes. Returns one result per CHECKS entry, in order.
 */
export async function runSmoke(config, deps = {}) {
  const call = client(config, deps.fetch ?? globalThis.fetch);
  const uuid = deps.randomUUID ?? randomUUID;
  const results = new Map(CHECKS.map((c) => [c, { check: c, status: 'NOT RUN', detail: '' }]));
  const set = (check, status, detail) => results.set(check, { check, status, detail });
  const done = () => CHECKS.map((c) => results.get(c));
  let wroteData = false;
  let token;
  let userId;

  const steps = async () => {
    // 1. Sign in as the test account, and prove it is that account.
    const auth = await signIn(call, config);
    token = auth.json?.access_token;
    userId = auth.json?.user?.id;
    const authEmail = auth.json?.user?.email;
    if (auth.status !== 200 || typeof token !== 'string' || !UUID.test(String(userId))) {
      set(CHECKS[0], 'FAIL', `sign-in refused: ${describe(auth)}`);
      return;
    }
    if (typeof authEmail !== 'string' || authEmail.toLowerCase() !== config.email.toLowerCase()) {
      set(CHECKS[0], 'FAIL', 'the session belongs to a different account than SMOKE_TEST_EMAIL; stopping');
      return;
    }

    // Target: the newest of this user's reports that has no interpretation yet.
    const reports = await call('GET', `/rest/v1/lab_reports?select=id,user_id,upload_date&user_id=eq.${userId}&order=upload_date.desc&limit=50`, { token });
    if (reports.status !== 200 || !Array.isArray(reports.json)) {
      set(CHECKS[0], 'FAIL', `could not list the test account's reports: ${describe(reports)}`);
      return;
    }
    if (reports.json.some((r) => r.user_id !== userId)) {
      set(CHECKS[0], 'FAIL', 'a report belonging to another user came back; stopping without writing anything');
      return;
    }
    const ids = reports.json.map((r) => r.id).filter((id) => UUID.test(String(id)));
    let interpreted = new Set();
    if (ids.length > 0) {
      const served = await call('GET', `/rest/v1/interpretations?select=lab_report_id&lab_report_id=in.(${ids.join(',')})`, { token });
      if (served.status !== 200 || !Array.isArray(served.json)) {
        set(CHECKS[0], 'FAIL', `could not read the test account's interpretations: ${describe(served)}`);
        return;
      }
      interpreted = new Set(served.json.map((row) => row.lab_report_id));
    }
    const reportId = ids.find((id) => !interpreted.has(id));
    if (!reportId) {
      set(CHECKS[0], 'FAIL', 'the test account has no report without an interpretation; upload one synthetic report in the app first (nothing was written)');
      return;
    }
    set(CHECKS[0], 'PASS', `signed in; ${ids.length} report(s) owned, target report has no interpretation`);

    // 2. First generation: creates the report's anchor interpretation.
    wroteData = true;
    const first = await call('POST', '/functions/v1/generate-interpretation', { token, body: { reportId }, timeoutMs: GENERATION_TIMEOUT_MS });
    if (first.status !== 200 || first.json?.success !== true) {
      set(CHECKS[1], 'FAIL', describe(first));
      return;
    }
    const anchor = await readServedInterpretation(call, token, reportId);
    if (anchor.error || !UUID.test(String(anchor.id))) {
      set(CHECKS[1], 'FAIL', `generated, but no served interpretation: ${anchor.error ?? 'invalid id'}`);
      return;
    }
    set(CHECKS[1], 'PASS', `HTTP 200, source ${String(first.json.source)}; anchor interpretation served`);

    // 3. Regeneration with a fresh per-tap request id: appends a version.
    const requestId = uuid();
    const regen = await call('POST', '/functions/v1/generate-interpretation', {
      token, body: { reportId, request_id: requestId }, timeoutMs: GENERATION_TIMEOUT_MS,
    });
    if (regen.status !== 200 || regen.json?.success !== true || regen.json?.source !== 'ai') {
      set(CHECKS[2], 'FAIL', regen.status === 200 ? `HTTP 200 but source ${String(regen.json?.source)} (no versioned AI regeneration)` : describe(regen));
      return;
    }
    set(CHECKS[2], 'PASS', 'HTTP 200, source ai');

    // 4. Version identity: present, distinct from the anchor, stable on retry,
    //    and what the reader now serves.
    const version = regen.json.version;
    const historicalId = regen.json.historical_interpretation_id;
    const problems = [];
    if (!version || !UUID.test(String(version.id))) problems.push('no version.id');
    if (!version || Number.isNaN(Date.parse(String(version.generated_at)))) problems.push('no version.generated_at');
    if (!UUID.test(String(historicalId))) problems.push('no historical_interpretation_id');
    if (version && version.id === anchor.id) problems.push('version.id equals the anchor id');
    if (regen.json.reused !== false) problems.push('first regeneration reported reused');
    if (problems.length === 0) {
      const retry = await call('POST', '/functions/v1/generate-interpretation', {
        token, body: { reportId, request_id: requestId }, timeoutMs: GENERATION_TIMEOUT_MS,
      });
      if (retry.status !== 200 || retry.json?.reused !== true || retry.json?.version?.id !== version.id) {
        problems.push(`retry with the same request_id did not return the same version (${describe(retry)})`);
      }
      const served = await readServedInterpretation(call, token, reportId);
      if (served.error) problems.push(`reader: ${served.error}`);
      else if (served.id !== version.id) problems.push('the reader does not serve the new version');
    }
    if (problems.length > 0) {
      set(CHECKS[3], 'FAIL', problems.join('; '));
    } else {
      set(CHECKS[3], 'PASS', 'version id + generated_at returned; idempotent retry returned the same version; reader serves it');
    }

    // 5. The old interpretation was not overwritten: the version is anchored on
    //    the first generation's row, which keeps its own identity. (Byte-level
    //    immutability is the history guard's job, verified at runbook step 7.)
    if (historicalId === anchor.id && version && version.id !== anchor.id) {
      set(CHECKS[4], 'PASS', 'regeneration is anchored on the first interpretation (historical_interpretation_id unchanged) and stored as a separate version');
    } else {
      set(CHECKS[4], 'FAIL', 'historical_interpretation_id does not match the first generation\'s interpretation');
    }
  };

  try {
    await steps();
  } catch (err) {
    // An unexpected client-side error: record it on the first check not yet run.
    const pending = CHECKS.slice(0, 5).find((c) => results.get(c).status === 'NOT RUN');
    if (pending) set(pending, 'FAIL', `smoke error: ${err instanceof Error ? err.name : 'error'}`);
  } finally {
    // 6. Delete the disposable account, whenever this run wrote data to it.
    if (wroteData && token) {
      const del = await call('POST', '/functions/v1/delete-user-data', { token, body: {} });
      if (del.status !== 200) {
        set(CHECKS[5], 'FAIL', `${describe(del)}; the test account still exists, delete it from the app`);
      } else {
        const again = await signIn(call, config);
        const leftovers = await call('GET', `/rest/v1/lab_reports?select=id&user_id=eq.${userId}`, { token });
        const reportsGone = leftovers.status === 401 || leftovers.status === 403
          || (leftovers.status === 200 && Array.isArray(leftovers.json) && leftovers.json.length === 0);
        if (again.status === 200) set(CHECKS[5], 'FAIL', 'delete-user-data answered 200 but the account can still sign in');
        else if (!reportsGone) set(CHECKS[5], 'FAIL', `delete-user-data answered 200 but reports remain (${describe(leftovers)})`);
        else set(CHECKS[5], 'PASS', 'HTTP 200; sign-in now refused; no reports remain');
      }
    }
  }
  return done();
}

export function formatTable(results) {
  const w1 = Math.max(5, ...results.map((r) => r.check.length));
  const w2 = 7;
  const line = `+-${'-'.repeat(w1)}-+-${'-'.repeat(w2)}-+`;
  const rows = results.map((r) => `| ${r.check.padEnd(w1)} | ${r.status.padEnd(w2)} | ${r.detail}`);
  return [line, `| ${'check'.padEnd(w1)} | ${'result'.padEnd(w2)} | detail`, line, ...rows, line].join('\n');
}

/** CLI entry. Returns the process exit code: 0 all pass, 1 any check failed, 2 refused. */
export async function main(argv, env, deps = {}) {
  const out = deps.log ?? ((s) => process.stdout.write(`${s}\n`));
  const parsed = parseInvocation(argv, env);
  if (!parsed.ok) {
    out(parsed.reason);
    return 2;
  }
  out(`V2 post-deploy smoke (PR #93 runbook step 8) against ${new URL(parsed.config.baseUrl).host}`);
  const results = await runSmoke(parsed.config, deps);
  out(formatTable(results));
  const ok = results.every((r) => r.status === 'PASS');
  out(ok ? 'RESULT: PASS' : 'RESULT: FAIL');
  return ok ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2), process.env).then((code) => { process.exitCode = code; });
}
