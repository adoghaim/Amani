import { test as base, expect } from '@playwright/test';
import { assertNetworkAllowed, guardWebSocket, origin } from './network-guard';

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

export const test = base.extend<{ authenticated: boolean; networkGuard: void }>({
  authenticated: [false, { option: true }],
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
  networkGuard: [async ({ context, authenticated }, provide) => {
    const unexpected: string[] = [];
    await context.route('**/*', async route => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin === origin && request.method() === 'GET') {
        await route.continue();
        return;
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
        if (emptyUserTables.includes(url.pathname) && url.searchParams.get('user_id') === `eq.${userId}`) {
          await route.fulfill({ json: [] });
          return;
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
