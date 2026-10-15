import { test as base, expect } from '@playwright/test';
import { assertNetworkAllowed, guardWebSocket, origin } from './network-guard';
import type { SyntheticReport } from './reports/synthetic-reports';

const apiOrigin = 'https://amani-e2e.invalid';
const userId = '00000000-0000-4000-8000-000000000043';
const user = {
  id: userId,
  aud: 'authenticated',
  role: 'authenticated',
  email: 'synthetic@example.invalid',
  app_metadata: { provider: 'email', providers: ['email'] },
  user_metadata: {},
  created_at: '2026-01-01T00:00:00.000Z',
};

/*
  PK-CFG-01: the app reads app_public_config once per launch, signed in or not.
  Default reply: the migration's seed (no version gate, every flag off), so
  every existing test runs exactly as before. A test may swap in another reply,
  including a failure, and counts the reads through `runtimeConfigReads`.
*/
export interface RuntimeConfigReply { status: number; body: unknown }
export const RUNTIME_CONFIG_SEED_REPLY: RuntimeConfigReply = {
  status: 200,
  body: [
    { key: 'min_version_ios', value: null },
    { key: 'min_version_android', value: null },
    { key: 'latest_version_ios', value: null },
    { key: 'latest_version_android', value: null },
    { key: 'features', value: {} },
  ],
};

export const test = base.extend<{ authenticated: boolean; syntheticReports: SyntheticReport[]; syntheticBasicResponse: { reportId: string; body: unknown } | null; runtimeConfigReply: RuntimeConfigReply; runtimeConfigReads: string[]; networkGuard: void }>({
  authenticated: [false, { option: true }],
  runtimeConfigReply: [RUNTIME_CONFIG_SEED_REPLY, { option: true }],
  // eslint-disable-next-line no-empty-pattern -- Playwright fixtures take their dependencies by destructuring.
  runtimeConfigReads: async ({}, provide) => { await provide([]); },
  // Opt-in synthetic report rows (V2-03). Empty by default, so every existing
  // test keeps the exact allowlist it had.
  syntheticReports: [[], { option: true }],
  syntheticBasicResponse: [null, { option: true }],
  storageState: async ({ authenticated }, provide) => {
    const expiresAt = Math.floor(Date.now() / 1000) + 3600;
    // Unsigned, deliberately invalid outside this fixture. No real credential.
    const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const token = `${encode({ alg: 'none', typ: 'JWT' })}.${encode({ sub: userId, exp: expiresAt, role: 'authenticated' })}.synthetic`;
    await provide({
      cookies: [],
      origins: authenticated ? [{
        origin,
        localStorage: [{
          // Derived from the installed supabase-js client's defaultStorageKey.
          name: 'sb-amani-e2e-auth-token',
          value: JSON.stringify({
            access_token: token,
            refresh_token: 'synthetic-refresh-not-a-credential',
            token_type: 'bearer',
            expires_in: 3600,
            expires_at: expiresAt,
            user,
          }),
        }],
      }] : [],
    });
  },
  networkGuard: [async ({ context, authenticated, syntheticReports, syntheticBasicResponse, runtimeConfigReply, runtimeConfigReads }, provide) => {
    const unexpected: string[] = [];
    await context.route('**/*', async route => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin === origin && request.method() === 'GET') {
        await route.continue();
        return;
      }
      // PK-CFG-01: exactly the launch read of the public runtime config.
      if (url.origin === apiOrigin && request.method() === 'GET' && url.pathname === '/rest/v1/app_public_config'
        && url.searchParams.get('select') === 'key,value' && [...url.searchParams.keys()].length === 1) {
        runtimeConfigReads.push(`${request.method()} ${url.pathname}`);
        await route.fulfill({ status: runtimeConfigReply.status, json: runtimeConfigReply.body });
        return;
      }
      // Opt-in projection proof: exact synthetic endpoint, method and report only.
      if (authenticated && syntheticBasicResponse && url.origin === apiOrigin) {
        if (request.method() === 'POST' && url.pathname === '/functions/v1/get-interpretation'
          && request.postDataJSON()?.reportId === syntheticBasicResponse.reportId) {
          await route.fulfill({ json: syntheticBasicResponse.body });
          return;
        }
        if (request.method() === 'HEAD' && url.pathname === '/rest/v1/introductory_deep_access_claims'
          && url.searchParams.get('user_id') === `eq.${userId}` && url.searchParams.get('select') === '*') {
          await route.fulfill({ status: 200, headers: { 'content-range': '0-2/3' } });
          return;
        }
      }
      if (authenticated && url.origin === apiOrigin && request.method() === 'GET') {
        // Persistent handler: getUser() runs again as layouts mount and reload.
        if (url.pathname === '/auth/v1/user') {
          await route.fulfill({ json: user });
          return;
        }
        if (url.pathname === '/rest/v1/users' && url.searchParams.get('id') === `eq.${userId}`) {
          await route.fulfill({ json: [{
            id: userId,
            email: user.email,
            full_name: 'Synthetic Fixture',
            onboarding_completed: true,
            onboarding_skipped: false,
          }] });
          return;
        }
        // Empty account data, including dashboard reads observed by the Lead.
        // Keep the exact table allowlist and require the synthetic user's filter.
        const emptyUserTables = [
          '/rest/v1/lab_reports',
          '/rest/v1/period_logs',
          '/rest/v1/symptom_logs',
          '/rest/v1/interventions',
          '/rest/v1/iap_subscriptions',
          '/rest/v1/iap_beta_testers',
          '/rest/v1/complimentary_entitlements',
        ];
        // Prior-report history for opted-in synthetic reports (V2-03 amendment
        // 2): the exact projection, filters and orderings ReportView requests.
        // With no synthetic reports this answers [] exactly as before.
        if (url.pathname === '/rest/v1/lab_reports' && url.searchParams.get('select') === 'id,report_date'
          && url.searchParams.get('user_id') === `eq.${userId}`) {
          const before = /^lt\.(\d{4}-\d{2}-\d{2})$/.exec(url.searchParams.get('report_date') ?? '')?.[1];
          const order = url.searchParams.get('order');
          const limit = url.searchParams.get('limit');
          if (before && (order === 'report_date.desc' || order === 'report_date.asc') && (limit === null || limit === '1')) {
            const rows = syntheticReports
              .map(r => ({ id: r.report.id, report_date: r.report.report_date }))
              .filter(r => r.report_date < before)
              .sort((a, b) => (order === 'report_date.asc' ? 1 : -1) * a.report_date.localeCompare(b.report_date));
            await route.fulfill({ json: limit === '1' ? rows.slice(0, 1) : rows });
            return;
          }
        }
        if (emptyUserTables.includes(url.pathname) && url.searchParams.get('user_id') === `eq.${userId}`) {
          await route.fulfill({ json: [] });
          return;
        }
        // Exact per-report reads for opted-in synthetic reports only: one table,
        // one filter, one fixture id each. Anything else still falls through.
        const reportFor = (filter: string | null) =>
          syntheticReports.find(r => filter === `eq.${r.report.id}`);
        if (url.pathname === '/rest/v1/lab_reports' && url.searchParams.get('select') === '*') {
          const match = reportFor(url.searchParams.get('id'));
          if (match) { await route.fulfill({ json: [match.report] }); return; }
        }
        const byReport: Record<string, (r: SyntheticReport) => unknown[]> = {
          '/rest/v1/biomarkers': r => r.biomarkers,
          // V2-03b: a fixture may carry its own lab-panel rows; absent means [] as before.
          '/rest/v1/report_analytes': r => r.analytes ?? [],
          '/rest/v1/interpretations': r => [r.interpretation],
        };
        // ReportView also polls interpretations with this narrower projection
        // while the first read is in flight.
        const select = url.searchParams.get('select');
        const allowedSelect = select === '*'
          || (url.pathname === '/rest/v1/interpretations' && select === 'id,json_output,tier');
        if (Object.hasOwn(byReport, url.pathname) && allowedSelect) {
          const match = reportFor(url.searchParams.get('lab_report_id'));
          if (match) { await route.fulfill({ json: byReport[url.pathname](match) }); return; }
        }
        // ReportView's historical read: one projection, an in-list of fixture ids only.
        const historyColumns = ['name', 'value', 'unit', 'reference_min', 'reference_max', 'lab_report_id'] as const;
        if (url.pathname === '/rest/v1/biomarkers' && select === historyColumns.join(',')) {
          const ids = /^in\.\(([^()]*)\)$/.exec(url.searchParams.get('lab_report_id') ?? '')?.[1]?.split(',') ?? [];
          const matches = ids.map(id => syntheticReports.find(r => r.report.id === id));
          if (ids.length > 0 && matches.every(m => m !== undefined)) {
            await route.fulfill({ json: matches.flatMap(m => m!.biomarkers.map(b =>
              Object.fromEntries(historyColumns.map(c => [c, b[c]])))) });
            return;
          }
        }
        // This existing view is read without a user filter by useSubscription.
        // An empty response grants no subscription; no real backend is involved.
        if (url.pathname === '/rest/v1/stripe_user_subscriptions' && url.searchParams.get('select') === '*') {
          await route.fulfill({ json: [] });
          return;
        }
      }
      // Do not record query strings, headers, or payloads in failure messages.
      unexpected.push(`${request.method()} ${url.origin}${url.pathname}`);
      await route.abort('blockedbyclient');
    });
    await context.routeWebSocket('**/*', socket => guardWebSocket(socket, unexpected));
    await provide();
    assertNetworkAllowed(unexpected);
  }, { auto: true }],
});

export { expect };
