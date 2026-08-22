import { describe, expect, it } from 'vitest';
import { resolveEntitlement as client, TRIAL_DURATION_MS } from './entitlement';
import { resolveEntitlement as server } from '../../supabase/functions/_shared/entitlement';

/**
 * `src/lib/entitlement.ts` is a hand-kept mirror of the server module, the same
 * way src/lib/errors.ts mirrors _shared/errors.ts. Mirrors drift silently, and
 * drift here means the client bounces a user the server would have allowed (or
 * shows paid UI to someone who will get a 402). This suite runs both copies
 * over a full matrix and fails the moment they disagree.
 */

const NOW = Date.parse('2026-08-21T00:00:00Z');
const future = new Date(NOW + 86_400_000).toISOString();
const past = new Date(NOW - 86_400_000).toISOString();

const STRIPE = [null, 'active', 'trialing', 'past_due', 'canceled', 'incomplete'];
const IAP = [
  [],
  [{ status: 'active', expires_at: future }],
  [{ status: 'active', expires_at: past }],
  [{ status: 'active', expires_at: null }],
  [{ status: 'active', expires_at: future, environment: 'sandbox' }],
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

describe('client/server entitlement parity', () => {
  it('agrees on every combination of source states', () => {
    const disagreements: string[] = [];
    let cases = 0;

    for (const stripeStatus of STRIPE) {
      for (const iapRecords of IAP) {
        for (const trialStartDate of TRIALS) {
          for (const allowSandbox of [false, true]) {
            const input = { stripeStatus, iapRecords, trialStartDate, now: NOW, allowSandbox };
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

    expect(cases).toBeGreaterThan(500);
    expect(disagreements).toEqual([]);
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
});
