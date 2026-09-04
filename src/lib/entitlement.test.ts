import { describe, expect, it } from 'vitest';
import {
  resolveEntitlement as client,
  toBetaTester as clientToBetaTester,
  SOLD_IAP_PRODUCT_IDS as CLIENT_SOLD_PRODUCTS,
  BETA_TESTER_COLUMNS as CLIENT_BETA_COLUMNS,
  TRIAL_DURATION_MS,
  type BetaTester,
} from './entitlement';
import {
  resolveEntitlement as server,
  toBetaTester as serverToBetaTester,
  SOLD_IAP_PRODUCT_IDS as SERVER_SOLD_PRODUCTS,
  BETA_TESTER_COLUMNS as SERVER_BETA_COLUMNS,
} from '../../supabase/functions/_shared/entitlement';
import { IAP_PRODUCT_IDS } from './iap-config';

/**
 * `src/lib/entitlement.ts` is a hand-kept mirror of the server module, the same
 * way src/lib/errors.ts mirrors _shared/errors.ts. Mirrors drift silently, and
 * drift here means the client bounces a user the server would have allowed (or
 * shows paid UI to someone who will get a 402). This suite runs both copies
 * over a full matrix and fails the moment they disagree.
 *
 * The matrix now includes the sandbox beta allowlist, because that is exactly
 * where the two copies used to diverge: sandbox entitlement was a build-time
 * `VITE_ALLOW_SANDBOX_IAP` on the client and an `ALLOW_SANDBOX_IAP` secret on
 * the server, kept in step by hand, and when they drifted a TestFlight tester
 * past their trial saw "Active Subscription" on /app/billing and was then
 * bounced out of every paid screen. Both flags are gone; both copies now read
 * the same server-owned `iap_beta_testers` row.
 */

const NOW = Date.parse('2026-08-21T00:00:00Z');
const future = new Date(NOW + 86_400_000).toISOString();
const past = new Date(NOW - 86_400_000).toISOString();

const USER = '11111111-1111-4111-8111-111111111111';
const OTHER_USER = '22222222-2222-4222-8222-222222222222';
const MONTHLY = 'com.amani.health.premium.monthly';
const UNSOLD = 'com.amani.health.premium.lifetime';

const STRIPE = [null, 'active', 'trialing', 'past_due', 'canceled', 'incomplete'];
const IAP = [
  [],
  [{ status: 'active', expires_at: future }],
  [{ status: 'active', expires_at: past }],
  [{ status: 'active', expires_at: null }],
  // Production receipts, which the allowlist must never affect either way.
  [{ status: 'active', expires_at: future, environment: 'production', platform: 'ios', product_id: MONTHLY }],
  [{ status: 'expired', expires_at: past, environment: 'production', platform: 'ios', product_id: MONTHLY }],
  // Sandbox receipts, across both storefronts, sold and unsold products, and
  // one with the platform/product columns missing altogether.
  [{ status: 'active', expires_at: future, environment: 'sandbox' }],
  [{ status: 'active', expires_at: future, environment: 'sandbox', platform: 'ios', product_id: MONTHLY }],
  [{ status: 'active', expires_at: future, environment: 'sandbox', platform: 'android', product_id: MONTHLY }],
  [{ status: 'active', expires_at: future, environment: 'sandbox', platform: 'ios', product_id: UNSOLD }],
  [{ status: 'in_grace_period', expires_at: future }],
  [{ status: 'billing_retry', expires_at: future }],
  [{ status: 'expired', expires_at: past }],
  [{ status: 'revoked', expires_at: future }],
  [{ status: 'active', expires_at: 'garbage' }],
  [{ status: 'expired', expires_at: past }, { status: 'active', expires_at: future }],
];
const TRIALS = [
  null,
  new Date(NOW - 1000).toISOString(),
  new Date(NOW - TRIAL_DURATION_MS).toISOString(),
  new Date(NOW - TRIAL_DURATION_MS - 1).toISOString(),
  'not-a-date',
];

/** Every allowlist state that changes an answer, plus the ones that must not. */
const BETA_TESTERS: Array<BetaTester | null> = [
  null,
  { user_id: USER, platform: 'both', expires_at: null, enabled: true },
  { user_id: USER, platform: 'apple', expires_at: future, enabled: true },
  { user_id: USER, platform: 'google', expires_at: future, enabled: true },
  { user_id: USER, platform: 'both', expires_at: past, enabled: true },
  { user_id: USER, platform: 'both', expires_at: null, enabled: false },
  { user_id: USER, platform: 'both', expires_at: 'not-a-date', enabled: true },
  { user_id: OTHER_USER, platform: 'both', expires_at: null, enabled: true },
];

describe('client/server entitlement parity', () => {
  it('agrees on every combination of source states', () => {
    const disagreements: string[] = [];
    let cases = 0;

    for (const stripeStatus of STRIPE) {
      for (const iapRecords of IAP) {
        for (const trialStartDate of TRIALS) {
          for (const betaTester of BETA_TESTERS) {
            for (const userId of [USER, null]) {
              const input = {
                stripeStatus,
                iapRecords,
                trialStartDate,
                now: NOW,
                userId,
                betaTester,
              };
              const a = client(input);
              const b = server(input);
              cases++;
              if (JSON.stringify(a) !== JSON.stringify(b)) {
                disagreements.push(
                  `${JSON.stringify(input)}\n  client=${JSON.stringify(a)}\n  server=${JSON.stringify(b)}`
                );
              }
            }
          }
        }
      }
    }

    expect(cases).toBeGreaterThan(500);
    expect(disagreements).toEqual([]);
  });

  it('agrees on how to read an iap_beta_testers row', () => {
    const rows: unknown[] = [
      null,
      undefined,
      [],
      'apple',
      42,
      {},
      { user_id: USER },
      { user_id: USER, platform: 'apple', expires_at: null, enabled: true },
      { user_id: USER, platform: 'google', expires_at: future, enabled: true },
      { user_id: USER, platform: 'both', expires_at: past, enabled: false },
      { user_id: USER, platform: 'ios', expires_at: null, enabled: true },
      { user_id: '', platform: 'apple', expires_at: null, enabled: true },
      { user_id: USER, platform: 'apple', expires_at: 1, enabled: true },
      { user_id: USER, platform: 'apple', expires_at: null, enabled: 'yes' },
      { user_id: USER, platform: 'apple', enabled: true },
    ];

    for (const row of rows) {
      expect(JSON.stringify(clientToBetaTester(row))).toBe(
        JSON.stringify(serverToBetaTester(row))
      );
    }
  });

  it('reads the same allowlist columns on both sides', () => {
    expect(CLIENT_BETA_COLUMNS).toBe(SERVER_BETA_COLUMNS);
  });
});

/**
 * The sandbox product check is enforced against a list duplicated on both sides
 * of the mirror — an edge function cannot import from `src/`. This is the guard
 * against the third copy, `src/lib/iap-config.ts`, being the only one updated
 * when a product is added: ship a new store product without touching these two
 * lists and its sandbox purchases silently fail to entitle for every beta
 * tester.
 */
describe('sold-product catalog', () => {
  it('is identical on the client and the server', () => {
    expect([...CLIENT_SOLD_PRODUCTS].sort()).toEqual([...SERVER_SOLD_PRODUCTS].sort());
  });

  it('matches the store product catalog in iap-config.ts', () => {
    expect([...CLIENT_SOLD_PRODUCTS].sort()).toEqual([...IAP_PRODUCT_IDS].sort());
  });
});

describe('client entitlement — the cases the gate depends on', () => {
  it('lets an active App Store subscriber through', () => {
    expect(
      client({
        stripeStatus: null,
        iapRecords: [{ status: 'active', expires_at: future }],
        trialStartDate: new Date(NOW - TRIAL_DURATION_MS - 1).toISOString(),
        now: NOW,
      })
    ).toEqual({ allowed: true, reason: 'active_iap' });
  });

  it('blocks a lapsed App Store subscriber and routes to billing', () => {
    expect(
      client({
        stripeStatus: null,
        iapRecords: [{ status: 'expired', expires_at: past }],
        trialStartDate: new Date(NOW - TRIAL_DURATION_MS - 1).toISOString(),
        now: NOW,
      })
    ).toEqual({ allowed: false, reason: 'no_subscription' });
  });

  it('shows an allowlisted TestFlight tester as entitled', () => {
    // The bug the allowlist exists to prevent is this screen and the server
    // guard disagreeing. Both now read the same row.
    expect(
      client({
        stripeStatus: null,
        iapRecords: [
          {
            status: 'active',
            expires_at: future,
            environment: 'sandbox',
            platform: 'ios',
            product_id: MONTHLY,
          },
        ],
        trialStartDate: new Date(NOW - TRIAL_DURATION_MS - 1).toISOString(),
        now: NOW,
        userId: USER,
        betaTester: { user_id: USER, platform: 'apple', expires_at: future, enabled: true },
      })
    ).toEqual({ allowed: true, reason: 'active_iap' });
  });

  it('shows a sandbox purchase by a non-tester as not entitled', () => {
    expect(
      client({
        stripeStatus: null,
        iapRecords: [
          {
            status: 'active',
            expires_at: future,
            environment: 'sandbox',
            platform: 'ios',
            product_id: MONTHLY,
          },
        ],
        trialStartDate: new Date(NOW - TRIAL_DURATION_MS - 1).toISOString(),
        now: NOW,
        userId: USER,
        betaTester: null,
      })
    ).toEqual({ allowed: false, reason: 'no_subscription' });
  });
});
