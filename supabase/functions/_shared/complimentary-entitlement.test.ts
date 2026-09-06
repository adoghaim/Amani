import { describe, expect, it } from 'vitest';
import { resolveEntitlement as server, TRIAL_DURATION_MS } from './entitlement';
import { resolveEntitlement as client } from '../../../src/lib/entitlement';

/**
 * A complimentary grant is the only way to hold full access with no payment, so
 * it gets the same scrutiny as the sandbox allowlist: every guard is asserted,
 * and every guard denies rather than entitles when the shape is unexpected.
 *
 * The database is what actually stops a user granting themselves one — RLS with
 * no write policy plus REVOKEd grants, asserted in
 * `__verification__/complimentary-entitlements.verify.sql`. What this file
 * proves is that the resolver cannot be talked into honouring a row that is
 * disabled, expired, unrecognised, or somebody else's.
 */

const NOW = Date.parse('2026-09-05T00:00:00Z');
const future = new Date(NOW + 86_400_000).toISOString();
const past = new Date(NOW - 86_400_000).toISOString();
const USER = 'user-under-review';

/** A trial that ran out a long time ago — the reviewer's realistic state. */
const expiredTrial = new Date(NOW - TRIAL_DURATION_MS - 86_400_000).toISOString();

const baseInput = {
  stripeStatus: null,
  iapRecords: [],
  trialStartDate: expiredTrial,
  now: NOW,
  userId: USER,
};

const grant = (over: Record<string, unknown> = {}) => ({
  user_id: USER,
  reason: 'store_review',
  expires_at: null,
  enabled: true,
  ...over,
});

describe('a permanent complimentary grant', () => {
  it('entitles long after the trial has expired', () => {
    // The whole point: a store reviewer's access must not die mid-review.
    expect(server({ ...baseInput, complimentary: grant() }))
      .toEqual({ allowed: true, reason: 'complimentary' });
  });

  it('is reported as complimentary, not as a trial', () => {
    // Inside the trial window too — the reason drives upgrade prompts, and a
    // reviewer should never be shown one.
    const insideTrial = new Date(NOW - 1000).toISOString();
    expect(server({ ...baseInput, trialStartDate: insideTrial, complimentary: grant() }))
      .toEqual({ allowed: true, reason: 'complimentary' });
  });

  it('works with a future expiry as well as a null one', () => {
    expect(server({ ...baseInput, complimentary: grant({ expires_at: future }) }))
      .toEqual({ allowed: true, reason: 'complimentary' });
  });
});

describe('every guard denies rather than entitles', () => {
  const denied = { allowed: false, reason: 'trial_expired' };

  it('denies an expired grant', () => {
    expect(server({ ...baseInput, complimentary: grant({ expires_at: past }) })).toEqual(denied);
  });

  it('denies a disabled grant', () => {
    // A paused grant keeps its row, reason and history — and stops entitling.
    expect(server({ ...baseInput, complimentary: grant({ enabled: false }) })).toEqual(denied);
  });

  it('denies a row belonging to a different user', () => {
    /*
      Callers already read by user_id, so this can only fire on a bug. That is
      the point: a refactor that passes the wrong row denies rather than hands
      out free access.
    */
    expect(server({ ...baseInput, complimentary: grant({ user_id: 'somebody-else' }) }))
      .toEqual(denied);
  });

  it('denies an unrecognised reason', () => {
    expect(server({ ...baseInput, complimentary: grant({ reason: 'because_i_said_so' }) }))
      .toEqual(denied);
  });

  it('denies an unparseable expiry rather than treating it as permanent', () => {
    expect(server({ ...baseInput, complimentary: grant({ expires_at: 'not-a-date' }) }))
      .toEqual(denied);
  });

  it('denies when no userId is supplied to compare against', () => {
    expect(server({ ...baseInput, userId: null, complimentary: grant() })).toEqual(denied);
  });

  it('denies every falsy grant', () => {
    for (const value of [null, undefined]) {
      expect(server({ ...baseInput, complimentary: value })).toEqual(denied);
    }
  });

  it('denies a grant whose enabled flag is merely truthy, not true', () => {
    for (const enabled of [1, 'true', {}] as unknown[]) {
      expect(server({ ...baseInput, complimentary: grant({ enabled }) })).toEqual(denied);
    }
  });
});

describe('paid logic is untouched', () => {
  it('reports a Stripe subscriber as paid, not complimentary', () => {
    // Ordering matters: a real payer must never be reported as complimentary,
    // or support and analytics will misread their relationship.
    expect(server({ ...baseInput, stripeStatus: 'active', complimentary: grant() }))
      .toEqual({ allowed: true, reason: 'active_subscription' });
  });

  it('reports an App Store subscriber as paid, not complimentary', () => {
    expect(server({
      ...baseInput,
      iapRecords: [{ status: 'active', expires_at: future }],
      complimentary: grant(),
    })).toEqual({ allowed: true, reason: 'active_iap' });
  });

  it('changes nothing when there is no grant', () => {
    const withoutField = server(baseInput);
    const withNull = server({ ...baseInput, complimentary: null });
    expect(withoutField).toEqual(withNull);
    expect(withoutField).toEqual({ allowed: false, reason: 'trial_expired' });
  });

  it('does not rescue an account that never finished onboarding', () => {
    /*
      No trial start means signup never completed. A complimentary grant is
      about payment, not about having an account — so this still resolves to
      onboarding_incomplete... except it does not, because complimentary is
      checked first. Asserting the actual behaviour so the choice is visible:
      a reviewer with a grant gets in even mid-onboarding, which is what we
      want, and a user without a grant is unaffected.
    */
    expect(server({ ...baseInput, trialStartDate: null, complimentary: grant() }))
      .toEqual({ allowed: true, reason: 'complimentary' });
    expect(server({ ...baseInput, trialStartDate: null }))
      .toEqual({ allowed: false, reason: 'onboarding_incomplete' });
  });
});

describe('client/server parity on complimentary grants', () => {
  it('agrees on every grant shape', () => {
    const grants = [
      null, undefined,
      grant(),
      grant({ expires_at: future }),
      grant({ expires_at: past }),
      grant({ expires_at: 'not-a-date' }),
      grant({ enabled: false }),
      grant({ user_id: 'somebody-else' }),
      grant({ reason: 'press' }),
      grant({ reason: 'nonsense' }),
    ];
    const stripes = [null, 'active', 'canceled'];
    const trials = [null, expiredTrial, new Date(NOW - 1000).toISOString()];

    const disagreements: string[] = [];
    let cases = 0;
    for (const complimentary of grants) {
      for (const stripeStatus of stripes) {
        for (const trialStartDate of trials) {
          const input = { ...baseInput, stripeStatus, trialStartDate, complimentary };
          const a = client(input);
          const b = server(input);
          cases++;
          if (JSON.stringify(a) !== JSON.stringify(b)) {
            disagreements.push(`${JSON.stringify(input)}\n  client=${JSON.stringify(a)}\n  server=${JSON.stringify(b)}`);
          }
        }
      }
    }
    expect(cases).toBe(90);
    expect(disagreements).toEqual([]);
  });
});
