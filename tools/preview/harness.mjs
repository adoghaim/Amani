/**
 * Renders the signed-in app against synthetic data, with no credentials and no
 * network access to the real project.
 *
 * Amani's big pages fetch their own data — ReportView, NewReport, Tracker and
 * Dashboard each call Supabase directly from inside the component — so they
 * cannot be previewed by passing props the way the /dev/design gallery
 * previews shared components. That made the four largest screens the four
 * hardest to look at, which is exactly backwards.
 *
 * This intercepts at the network boundary instead: a fake session is planted in
 * localStorage before any app code runs, and every Supabase request is answered
 * from tools/preview/fixtures.mjs. The app is entirely unmodified — no preview
 * flags, no injected props, no test-only branches in production code.
 */
import { TABLES, USER_ID } from './fixtures.mjs';

const PROJECT_REF = 'eyfvqdnczorscwveaadv';

/** Shape supabase-js expects in localStorage. The token is decorative — every
 *  request that would validate it is intercepted before it leaves the page. */
function fakeSession() {
  const claims = {
    sub: USER_ID, email: 'sample@amani.test', role: 'authenticated',
    aud: 'authenticated', iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
  };
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const jwt = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(claims)}.preview-not-a-real-signature`;
  return {
    access_token: jwt,
    refresh_token: 'preview-refresh',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: claims.exp,
    user: {
      id: USER_ID, aud: 'authenticated', role: 'authenticated',
      email: 'sample@amani.test', email_confirmed_at: new Date().toISOString(),
      phone: '', confirmed_at: new Date().toISOString(),
      last_sign_in_at: new Date().toISOString(),
      app_metadata: { provider: 'email', providers: ['email'] },
      user_metadata: { full_name: 'Sample Account' },
      identities: [], created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(), is_anonymous: false,
    },
  };
}

/**
 * Enough PostgREST to satisfy the app's reads.
 *
 * Supports eq./in./is. filters, order, limit, and the single-object Accept
 * header that .single() and .maybeSingle() send. Deliberately not a complete
 * implementation — it covers what the pages actually ask for, and anything
 * unhandled is logged rather than silently returning [], so a missing filter
 * shows up as a warning instead of an empty screen.
 */
function query(table, url, wantsSingle, warn) {
  let rows = [...(TABLES[table] ?? [])];
  if (!TABLES[table]) warn(`no fixture for table "${table}"`);

  for (const [key, raw] of url.searchParams.entries()) {
    if (['select', 'order', 'limit', 'offset', 'on_conflict'].includes(key)) continue;
    const [op, ...rest] = raw.split('.');
    const val = rest.join('.');
    if (op === 'eq') rows = rows.filter(r => String(r[key]) === val);
    else if (op === 'neq') rows = rows.filter(r => String(r[key]) !== val);
    else if (op === 'in') {
      const set = new Set(val.replace(/^\(|\)$/g, '').split(',').map(s => s.replace(/^"|"$/g, '')));
      rows = rows.filter(r => set.has(String(r[key])));
    }
    else if (op === 'is') rows = rows.filter(r => (val === 'null' ? r[key] == null : r[key] != null));
    else if (op === 'gte') rows = rows.filter(r => r[key] >= val);
    else if (op === 'lte') rows = rows.filter(r => r[key] <= val);
    else if (op === 'gt') rows = rows.filter(r => r[key] > val);
    else if (op === 'lt') rows = rows.filter(r => r[key] < val);
    else if (op === 'like' || op === 'ilike') {
      const re = new RegExp('^' + val.replace(/%/g, '.*') + '$', op === 'ilike' ? 'i' : '');
      rows = rows.filter(r => re.test(String(r[key] ?? '')));
    }
    else warn(`unhandled filter ${key}=${raw} on ${table}`);
  }

  const order = url.searchParams.get('order');
  if (order) {
    const [col, dir] = order.split('.');
    rows.sort((a, b) => (a[col] > b[col] ? 1 : a[col] < b[col] ? -1 : 0) * (dir === 'desc' ? -1 : 1));
  }
  const limit = url.searchParams.get('limit');
  if (limit) rows = rows.slice(0, Number(limit));

  return wantsSingle ? (rows[0] ?? null) : rows;
}

/**
 * Installs the harness on a Playwright page. Returns a `problems` array that
 * collects page errors, console errors and unhandled queries — check it after
 * navigating, so a screenshot that merely *looks* fine cannot hide a failure.
 */
export async function installHarness(page) {
  const problems = [];
  const warn = (m) => problems.push(`harness: ${m}`);

  page.on('pageerror', e => problems.push(`pageerror: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });

  await page.addInitScript(
    ([key, session]) => {
      window.localStorage.setItem(key, JSON.stringify(session));
    },
    [`sb-${PROJECT_REF}-auth-token`, fakeSession()],
  );

  const json = (route, body, status = 200) =>
    route.fulfill({
      status,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify(body),
    });

  await page.route(`**/${PROJECT_REF}.supabase.co/**`, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname;

    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } });

    if (path.startsWith('/auth/v1/user')) return json(route, fakeSession().user);
    if (path.startsWith('/auth/v1/token')) return json(route, fakeSession());
    if (path.startsWith('/auth/v1/logout')) return json(route, {});

    if (path.startsWith('/rest/v1/')) {
      const table = path.replace('/rest/v1/', '').split('/')[0];
      // Writes succeed without persisting — enough for optimistic UI to settle.
      if (req.method() !== 'GET') return json(route, [], 201);
      const wantsSingle = (req.headers()['accept'] ?? '').includes('vnd.pgrst.object');
      const result = query(table, url, wantsSingle, warn);
      if (wantsSingle && result === null) return json(route, { message: 'No rows found' }, 406);
      return json(route, result);
    }

    if (path.startsWith('/functions/v1/')) {
      warn(`edge function called: ${path}`);
      return json(route, { error: 'not available in preview' }, 501);
    }
    if (path.startsWith('/storage/v1/')) return json(route, {});

    warn(`unrouted supabase path: ${path}`);
    return json(route, {});
  });

  return problems;
}
