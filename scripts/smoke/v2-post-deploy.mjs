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
// What the account and the backend need (2026-10-17 smoke: a fallback first
// generation and a 503 regeneration, with nothing saying why):
//   - The account has finished onboarding, and has consented if the consent
//     gate is on.
//   - Its plan generates deeply: Plus, or Free while FREEMIUM_ACTIVE is "true"
//     and the interpretation visibility switch is on. With
//     FREEMIUM_POST_LIMIT_GENERATION unset or "always", a Free account generates
//     deeply at any claim count (the 3 introductory analyses decide access, not
//     generation). With any other value it needs an unused introductory analysis
//     (fewer than 3 used), or a target that is a byte-identical re-upload of a
//     draw it already claimed. A new draw uses one introductory analysis.
//   - generate-interpretation has OPENAI_API_KEY set, the AI kill switch
//     (app_server_config.ai_kill_switch) is off, and the account has at least 3
//     of its 20 daily generations left.
//   - One synthetic report with parsed markers and no interpretation yet. The app
//     generates on upload and again when a report is opened, so such a report is
//     one whose generation never ran; the script picks the newest one that has
//     markers and is not still processing, and never creates lab data itself.
//
// Each row reads PASS, FAIL (the deployment misbehaved), BLOCKED (a
// precondition above was not met, so the row proves nothing) or NOT RUN (with
// the reason). Exit 0: every row PASS. 1: any FAIL. 2: refused to start.
// 3: no FAIL, but a precondition BLOCKED the run.
//
// Safety: it acts only through the test account's own session (anon key +
// that user's JWT), so RLS and the functions' own ownership checks scope every
// read and write to that one user. It refuses a service-role key, refuses an
// account whose email lacks "smoke", refuses rows that belong to anyone else,
// and never prints interpretation bodies, values, emails, ids or tokens: only
// fixed server codes, booleans, counts and timings. When it wrote anything, its
// last check DELETES THE TEST ACCOUNT through delete-user-data.

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
  'target report (preconditions)',
  'first generation',
  'regeneration',
  'returned version identity',
  'old interpretation not overwritten',
  'account deletion',
]);
export const EXIT = Object.freeze({ PASS: 0, FAIL: 1, REFUSED: 2, BLOCKED: 3 });

/*
  What each generate-interpretation reason means for this run. The server sends
  `fallback_reason` with a 200 whose source is "fallback", and `reason` with a
  503 regeneration_failed (supabase/functions/_shared/generation-outcome.ts).
  `blocked` reasons are preconditions above, not deployment defects; `final`
  reasons make a regeneration certain to fail, so it is not attempted.
*/
export const REASONS = Object.freeze({
  introductory_access_exhausted: { blocked: true, final: true,
    hint: 'the account has no deep generation left: use Plus, or a Free account with an unused introductory analysis' },
  no_analytes: { blocked: true, final: true, hint: 'the target report has no parsed markers' },
  ai_paused: { blocked: true, final: true, hint: 'the AI kill switch is on (app_server_config.ai_kill_switch)' },
  ai_not_configured: { blocked: false, final: true, hint: 'OPENAI_API_KEY is not set for generate-interpretation' },
  report_unavailable: { blocked: false, final: true, hint: 'the server could not read the target report' },
  model_failed: { blocked: false, final: false,
    hint: 'the model call produced nothing usable (model_failure says how: check the OpenAI key, quota, model access and timeouts)' },
  floor_violation: { blocked: false, final: false, hint: "the model's interpretation failed the medical floor" },
  introductory_limit_reached: { blocked: false, final: false,
    hint: 'the last introductory analysis went to another request at commit' },
});
const NO_REASON_HINT = 'no reason in the answer (the deployed generate-interpretation predates the reason codes)';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// A fixed server code (regeneration_failed, http_429, PGRST301, 42703). Free
// text a server sends in these fields is never echoed.
const TOKEN = /^[A-Za-z0-9][A-Za-z0-9_]{0,63}$/;
const GENERATION_TIMEOUT_MS = 150_000;
const DEFAULT_TIMEOUT_MS = 20_000;
const MAX_CANDIDATES = 5;

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

const codeOf = (value) => (typeof value === 'string' && TOKEN.test(value) ? value : null);
const record = (json) => (json && typeof json === 'object' && !Array.isArray(json) ? json : {});

/** The reason a generation answer carries, if any: `reason` on a 503, `fallback_reason` on a 200. */
export function reasonOf(json) {
  const j = record(json);
  return codeOf(j.reason) ?? codeOf(j.fallback_reason);
}

/** Diagnostic fields, as fixed codes only: reason, model_failure, retryable, ai_paused. */
export function diagnostics(json) {
  const j = record(json);
  const parts = [];
  if (codeOf(j.fallback_reason)) parts.push(`fallback_reason ${j.fallback_reason}`);
  if (codeOf(j.reason)) parts.push(`reason ${j.reason}`);
  if (codeOf(j.model_failure)) parts.push(`model_failure ${j.model_failure}`);
  if (typeof j.retryable === 'boolean') parts.push(`retryable ${j.retryable}`);
  if (j.ai_paused === true) parts.push('ai_paused');
  return parts.length > 0 ? ` (${parts.join(', ')})` : '';
}

// Only fixed server strings are echoed; bodies and identifiers of content are not.
export function describe(res) {
  if (res.status === 0) return `no response (${res.networkError})`;
  const j = record(res.json);
  const code = codeOf(j.error) ?? codeOf(j.code) ?? codeOf(j.error_code)
    ?? (j.error === 'Internal server error' ? 'Internal server error' : null);
  return `HTTP ${res.status}${code ? ` ${code}` : ''}${diagnostics(j)}`;
}

/** What a reason means here, as a sentence for the table. */
export function hintFor(reason) {
  return reason && REASONS[reason] ? REASONS[reason].hint : NO_REASON_HINT;
}

const seconds = (ms) => `${(Math.max(0, ms) / 1000).toFixed(1)} s`;

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

/** The plan as get-interpretation reports it to the app: counts and fixed values only. */
function planSummary(res) {
  const j = record(res.json);
  if (res.status !== 200) return `plan not read (${describe(res)})`;
  const plan = codeOf(j.plan) ?? 'unknown';
  const c = record(j.complimentary);
  const counts = Number.isInteger(c.used) && Number.isInteger(c.total) ? `, ${c.used} of ${c.total} introductory analyses used` : '';
  return `plan ${plan}${counts}`;
}

/**
 * Runs the step-8 checks. `deps.fetch`, `deps.randomUUID` and `deps.now` are
 * injectable so tests drive it against fakes. Returns one result per CHECKS
 * entry, in order.
 */
export async function runSmoke(config, deps = {}) {
  const call = client(config, deps.fetch ?? globalThis.fetch);
  const uuid = deps.randomUUID ?? randomUUID;
  const now = deps.now ?? (() => performance.now());
  const results = new Map(CHECKS.map((c) => [c, { check: c, status: 'NOT RUN', detail: '' }]));
  const set = (check, status, detail) => results.set(check, { check, status, detail });
  const skip = (from, why) => {
    for (const c of CHECKS.slice(CHECKS.indexOf(from), CHECKS.length - 1)) {
      if (results.get(c).status === 'NOT RUN' && !results.get(c).detail) set(c, 'NOT RUN', why);
    }
  };
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
      skip(CHECKS[1], 'not run: sign-in failed');
      return;
    }
    if (typeof authEmail !== 'string' || authEmail.toLowerCase() !== config.email.toLowerCase()) {
      set(CHECKS[0], 'FAIL', 'the session belongs to a different account than SMOKE_TEST_EMAIL; stopping');
      skip(CHECKS[1], 'not run: sign-in failed');
      return;
    }

    // 2. Target: the newest report with no interpretation that has parsed markers
    //    and is not still processing (the app may be generating it). Read only.
    const reports = await call('GET', `/rest/v1/lab_reports?select=id,user_id,upload_date,status&user_id=eq.${userId}&order=upload_date.desc&limit=50`, { token });
    if (reports.status !== 200 || !Array.isArray(reports.json)) {
      set(CHECKS[0], 'FAIL', `could not list the test account's reports: ${describe(reports)}`);
      skip(CHECKS[1], 'not run: sign-in failed');
      return;
    }
    if (reports.json.some((r) => r.user_id !== userId)) {
      set(CHECKS[0], 'FAIL', 'a report belonging to another user came back; stopping without writing anything');
      skip(CHECKS[1], 'not run: sign-in failed');
      return;
    }
    const owned = reports.json.filter((r) => UUID.test(String(r.id)));
    const ids = owned.map((r) => r.id);
    let interpreted = new Set();
    if (ids.length > 0) {
      const served = await call('GET', `/rest/v1/interpretations?select=lab_report_id&lab_report_id=in.(${ids.join(',')})`, { token });
      if (served.status !== 200 || !Array.isArray(served.json)) {
        set(CHECKS[0], 'FAIL', `could not read the test account's interpretations: ${describe(served)}`);
        skip(CHECKS[1], 'not run: sign-in failed');
        return;
      }
      interpreted = new Set(served.json.map((row) => row.lab_report_id));
    }
    set(CHECKS[0], 'PASS', `signed in; ${ids.length} report(s) owned`);

    const candidates = owned.filter((r) => !interpreted.has(r.id));
    if (candidates.length === 0) {
      set(CHECKS[1], 'BLOCKED', 'the test account has no report without an interpretation; upload one synthetic report in the app first (nothing was written)');
      skip(CHECKS[2], 'not run: no target report');
      return;
    }
    let reportId = null;
    let processing = 0;
    let markerless = 0;
    for (const candidate of candidates.slice(0, MAX_CANDIDATES)) {
      if (candidate.status === 'processing') { processing += 1; continue; }
      const markers = await call('GET', `/rest/v1/report_analytes?select=id&lab_report_id=eq.${candidate.id}&limit=1`, { token });
      if (markers.status !== 200 || !Array.isArray(markers.json)) {
        set(CHECKS[1], 'FAIL', `could not read a candidate report's markers: ${describe(markers)} (nothing was written)`);
        skip(CHECKS[2], 'not run: no target report');
        return;
      }
      if (markers.json.length === 0) { markerless += 1; continue; }
      reportId = candidate.id;
      break;
    }
    const skipped = [markerless ? `${markerless} without parsed markers` : '', processing ? `${processing} still processing` : '']
      .filter(Boolean).join(', ');
    if (!reportId) {
      const unchecked = candidates.length > MAX_CANDIDATES ? `; checked the newest ${MAX_CANDIDATES} of ${candidates.length}` : '';
      set(CHECKS[1], 'BLOCKED', `no report without an interpretation is ready to interpret (${skipped}${unchecked}); confirm the markers of one synthetic report in the app (nothing was written)`);
      skip(CHECKS[2], 'not run: no target report');
      return;
    }
    const plan = await call('POST', '/functions/v1/get-interpretation', { token, body: { reportId } });
    if (plan.status === 403 && fieldCode(plan.json) === 'onboarding_incomplete') {
      set(CHECKS[1], 'BLOCKED', 'the account has not finished onboarding (get-interpretation 403 onboarding_incomplete); finish it in the app (nothing was written)');
      skip(CHECKS[2], 'not run: account not ready');
      return;
    }
    set(CHECKS[1], 'PASS', `target has parsed markers and no interpretation${skipped ? ` (skipped ${skipped})` : ''}; ${planSummary(plan)}`);

    // 3. First generation: creates the report's anchor interpretation. Only the
    //    model's deep work passes: the deterministic fallback proves nothing
    //    about AI generation, and a regeneration can only append an AI version.
    wroteData = true;
    const firstStarted = now();
    const first = await call('POST', '/functions/v1/generate-interpretation', { token, body: { reportId }, timeoutMs: GENERATION_TIMEOUT_MS });
    const firstTook = seconds(now() - firstStarted);
    if (first.status !== 200 || first.json?.success !== true) {
      set(CHECKS[2], 'FAIL', `${describe(first)} after ${firstTook}`);
      skip(CHECKS[3], 'not run: first generation failed');
      return;
    }
    const anchor = await readServedInterpretation(call, token, reportId);
    if (anchor.error || !UUID.test(String(anchor.id))) {
      set(CHECKS[2], 'FAIL', `generated, but no served interpretation: ${anchor.error ?? 'invalid id'}`);
      skip(CHECKS[3], 'not run: first generation failed');
      return;
    }
    const source = fieldCode(first.json, 'source') ?? 'unknown';
    if (source !== 'ai') {
      const reason = reasonOf(first.json);
      const meaning = reason ? REASONS[reason] : undefined;
      set(CHECKS[2], meaning?.blocked ? 'BLOCKED' : 'FAIL',
        `HTTP 200 after ${firstTook}, but source ${source}${diagnostics(first.json)}: ${hintFor(reason)}; the anchor saved is the deterministic interpretation, not an AI one`);
      if (meaning?.final) {
        skip(CHECKS[3], `not run: a regeneration cannot append an AI version while ${reason}`);
        return;
      }
    } else {
      set(CHECKS[2], 'PASS', `HTTP 200 after ${firstTook}, source ai; anchor interpretation served`);
    }

    // 4. Regeneration with a fresh per-tap request id: appends a version.
    const requestId = uuid();
    const regenStarted = now();
    const regen = await call('POST', '/functions/v1/generate-interpretation', {
      token, body: { reportId, request_id: requestId }, timeoutMs: GENERATION_TIMEOUT_MS,
    });
    const regenTook = seconds(now() - regenStarted);
    if (regen.status !== 200 || regen.json?.success !== true || regen.json?.source !== 'ai') {
      const reason = reasonOf(regen.json);
      const blocked = regen.status === 402 || regen.status === 429
        || (regen.status === 503 && (REASONS[reason]?.blocked === true || regen.json?.retryable === false));
      const detail = regen.status === 200
        ? `HTTP 200 but source ${String(fieldCode(regen.json, 'source') ?? 'unknown')}${diagnostics(regen.json)} (no versioned AI regeneration)`
        : `${describe(regen)}${regen.status === 503 ? `: ${hintFor(reason)}` : ''}`;
      set(CHECKS[3], blocked ? 'BLOCKED' : 'FAIL', `${detail} after ${regenTook}`);
      skip(CHECKS[4], 'not run: needs a successful regeneration');
      return;
    }
    set(CHECKS[3], 'PASS', `HTTP 200 after ${regenTook}, source ai`);

    // 5. Version identity: present, distinct from the anchor, stable on retry,
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
      set(CHECKS[4], 'FAIL', problems.join('; '));
    } else {
      set(CHECKS[4], 'PASS', 'version id + generated_at returned; idempotent retry returned the same version; reader serves it');
    }

    // 6. The old interpretation was not overwritten: the version is anchored on
    //    the first generation's row, which keeps its own identity. (Byte-level
    //    immutability is the history guard's job, verified at runbook step 7.)
    if (historicalId === anchor.id && version && version.id !== anchor.id) {
      set(CHECKS[5], 'PASS', 'regeneration is anchored on the first interpretation (historical_interpretation_id unchanged) and stored as a separate version');
    } else {
      set(CHECKS[5], 'FAIL', 'historical_interpretation_id does not match the first generation\'s interpretation');
    }
  };

  try {
    await steps();
  } catch (err) {
    // An unexpected client-side error: record it on the first check not yet run.
    const open = CHECKS.slice(0, CHECKS.length - 1).filter((c) => results.get(c).status === 'NOT RUN');
    const pending = open.find((c) => !results.get(c).detail) ?? open[0];
    if (pending) {
      set(pending, 'FAIL', `smoke error: ${err instanceof Error ? err.name : 'error'}`);
      skip(pending, 'not run: the smoke stopped on an error');
    }
  } finally {
    // 7. Delete the disposable account, whenever this run wrote data to it.
    if (wroteData && token) {
      const del = await call('POST', '/functions/v1/delete-user-data', { token, body: {} });
      if (del.status !== 200) {
        set(CHECKS[6], 'FAIL', `${describe(del)}; the test account still exists, delete it from the app`);
      } else {
        const again = await signIn(call, config);
        const leftovers = await call('GET', `/rest/v1/lab_reports?select=id&user_id=eq.${userId}`, { token });
        const reportsGone = leftovers.status === 401 || leftovers.status === 403
          || (leftovers.status === 200 && Array.isArray(leftovers.json) && leftovers.json.length === 0);
        if (again.status === 200) set(CHECKS[6], 'FAIL', 'delete-user-data answered 200 but the account can still sign in');
        else if (!reportsGone) set(CHECKS[6], 'FAIL', `delete-user-data answered 200 but reports remain (${describe(leftovers)})`);
        else set(CHECKS[6], 'PASS', 'HTTP 200; sign-in now refused; no reports remain');
      }
    } else if (results.get(CHECKS[6]).status === 'NOT RUN') {
      set(CHECKS[6], 'NOT RUN', 'not run: nothing was written, so the account was kept');
    }
  }
  return done();
}

// A fixed code from a body field (default `code`), or null.
function fieldCode(json, field = 'code') {
  return codeOf(record(json)[field]);
}

export function formatTable(results) {
  const w1 = Math.max(5, ...results.map((r) => r.check.length));
  const w2 = 7;
  const line = `+-${'-'.repeat(w1)}-+-${'-'.repeat(w2)}-+`;
  const rows = results.map((r) => `| ${r.check.padEnd(w1)} | ${r.status.padEnd(w2)} | ${r.detail}`);
  return [line, `| ${'check'.padEnd(w1)} | ${'result'.padEnd(w2)} | detail`, line, ...rows, line].join('\n');
}

/** The run's exit code from its rows: any FAIL wins, then BLOCKED. */
export function exitCodeOf(results) {
  if (results.every((r) => r.status === 'PASS')) return EXIT.PASS;
  if (results.some((r) => r.status === 'FAIL')) return EXIT.FAIL;
  if (results.some((r) => r.status === 'BLOCKED')) return EXIT.BLOCKED;
  return EXIT.FAIL;
}

/** CLI entry. Returns the process exit code (EXIT). */
export async function main(argv, env, deps = {}) {
  const out = deps.log ?? ((s) => process.stdout.write(`${s}\n`));
  const parsed = parseInvocation(argv, env);
  if (!parsed.ok) {
    out(parsed.reason);
    return EXIT.REFUSED;
  }
  out(`V2 post-deploy smoke (PR #93 runbook step 8) against ${new URL(parsed.config.baseUrl).host}`);
  const results = await runSmoke(parsed.config, deps);
  out(formatTable(results));
  const code = exitCodeOf(results);
  out(code === EXIT.PASS ? 'RESULT: PASS' : code === EXIT.BLOCKED ? 'RESULT: BLOCKED (a precondition was not met; see the BLOCKED rows)' : 'RESULT: FAIL');
  return code;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2), process.env).then((code) => { process.exitCode = code; });
}
