import { describe, expect, it } from 'vitest';
import {
  FREE_ALLOWANCES,
  MEDICAL_FLOOR,
  PLUS_ALLOWANCES,
  normalizeTierForClient,
  resolveTier as client,
} from './tier';
import { resolveTier as server } from '../../supabase/functions/_shared/tier';
import type { EntitlementResult } from './entitlement';

/**
 * Two jobs here.
 *
 * 1. Mirror parity, same as entitlement.test.ts — drift between the client and
 *    server copies means the UI and the API disagree about who is a subscriber.
 *
 * 2. The golden compatibility guarantee: while freemium is inactive, this
 *    module reproduces pre-freemium behaviour exactly. A feature flag states
 *    that intent; this suite is what proves it, and it is the gate on merging
 *    PRs 2 and 3 safely.
 */

const ENTITLEMENTS: EntitlementResult[] = [
  { allowed: true, reason: 'active_subscription' },
  { allowed: true, reason: 'active_iap' },
  { allowed: true, reason: 'trial' },
  { allowed: false, reason: 'trial_expired' },
  { allowed: false, reason: 'no_subscription' },
  { allowed: false, reason: 'onboarding_incomplete' },
];

describe('client/server tier parity', () => {
  it('agrees on every entitlement at both switch positions', () => {
    const disagreements: string[] = [];
    let cases = 0;

    for (const entitlement of ENTITLEMENTS) {
      for (const freemiumActive of [false, true]) {
        const input = { entitlement, freemiumActive };
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

    expect(cases).toBe(12);
    expect(disagreements).toEqual([]);
  });
});

describe('golden compatibility — freemium inactive is a no-op', () => {
  /*
    The contract, stated as an assertion rather than a comment: with the switch
    off, `gate` is exactly the pre-freemium 402 decision and nobody is ever
    served a Free-shaped response.
  */
  it('reproduces the legacy 402 decision for every entitlement', () => {
    for (const entitlement of ENTITLEMENTS) {
      const decision = client({ entitlement, freemiumActive: false });
      const legacyWouldAllow = entitlement.allowed;

      expect(decision.gate.gate).toBe(legacyWouldAllow ? 'allow' : 'block');
      if (!legacyWouldAllow && decision.gate.gate === 'block') {
        // The client routes on this reason — /billing vs /pricing — so it has
        // to survive verbatim, not just be "some blocking reason".
        expect(decision.gate.reason).toBe(entitlement.reason);
      }
    }
  });

  it('resolves every user to Plus, so no response is ever Free-shaped', () => {
    for (const entitlement of ENTITLEMENTS) {
      const decision = client({ entitlement, freemiumActive: false });
      expect(decision.tier).toBe('plus');
      expect(decision.allowances).toBe(PLUS_ALLOWANCES);
    }
  });

  it('gives currently-entitled users an unmetered allowance set', () => {
    for (const entitlement of ENTITLEMENTS.filter((e) => e.allowed)) {
      const decision = client({ entitlement, freemiumActive: false });
      expect(decision.allowances.deepInterpretation).toEqual({ kind: 'unlimited' });
      expect(decision.allowances.fullComparison).toEqual({ kind: 'unlimited' });
      expect(decision.allowances.aiQuestions).toEqual({ kind: 'unlimited' });
      expect(decision.allowances.revealedTrendInsights).toEqual({ kind: 'unlimited' });
    }
  });
});

describe('freemium active', () => {
  it('keeps entitled users on Plus', () => {
    for (const entitlement of ENTITLEMENTS.filter((e) => e.allowed)) {
      const decision = client({ entitlement, freemiumActive: true });
      expect(decision).toMatchObject({ tier: 'plus', reason: 'entitled', gate: { gate: 'allow' } });
    }
  });

  it('lets lapsed and never-subscribed users in as Free instead of bouncing them', () => {
    for (const reason of ['trial_expired', 'no_subscription'] as const) {
      const decision = client({
        entitlement: { allowed: false, reason },
        freemiumActive: true,
      });
      expect(decision).toMatchObject({ tier: 'free', reason: 'free_tier', gate: { gate: 'allow' } });
      expect(decision.allowances).toBe(FREE_ALLOWANCES);
    }
  });

  it('still blocks an incomplete account at both switch positions', () => {
    // Not a paywall — they never finished signup, so they belong in onboarding
    // rather than on a Free report.
    for (const freemiumActive of [false, true]) {
      const decision = client({
        entitlement: { allowed: false, reason: 'onboarding_incomplete' },
        freemiumActive,
      });
      expect(decision.gate).toEqual({ gate: 'block', reason: 'onboarding_incomplete' });
    }
  });

  it('meters the Free tier at the frozen beta limits', () => {
    const decision = client({
      entitlement: { allowed: false, reason: 'trial_expired' },
      freemiumActive: true,
    });
    expect(decision.allowances.deepInterpretation).toEqual({ kind: 'lifetime', limit: 3 });
    expect(decision.allowances.fullComparison).toEqual({ kind: 'lifetime', limit: 1 });
    expect(decision.allowances.aiQuestions).toEqual({ kind: 'monthly', limit: 5 });
    expect(decision.allowances.revealedTrendInsights).toEqual({ kind: 'lifetime', limit: 1 });
  });
});

describe('the medical floor is not a tier feature', () => {
  it('is identical on Free and Plus', () => {
    expect(FREE_ALLOWANCES.floor).toEqual(PLUS_ALLOWANCES.floor);
    expect(FREE_ALLOWANCES.floor).toBe(MEDICAL_FLOOR);
  });

  it('never withholds a user\'s own values, flags, history or the deterministic read', () => {
    // Paywalling an abnormal flag on a health app is indefensible whatever the
    // pricing model says. If this test is ever "fixed", read it again.
    expect(MEDICAL_FLOOR).toEqual({
      rawValues: true,
      abnormalFlags: true,
      fullHistory: true,
      deterministicInterpretation: true,
    });
  });

  it('meters trend ANALYSIS, never biomarker visibility', () => {
    /*
      The allowance is deliberately called `revealedTrendInsights` and not
      anything shaped like `trendBiomarkers`. A limit named for a count of
      biomarkers invites a future reader to implement "show only N biomarkers",
      which breaks the floor. All biomarkers stay visible on Free; only the
      premium analysis about them is metered. If a rename is ever proposed here,
      this test is the argument against it.
    */
    const free = client({
      entitlement: { allowed: false, reason: 'trial_expired' },
      freemiumActive: true,
    });
    expect(free.allowances.floor.rawValues).toBe(true);
    expect(free.allowances.floor.abnormalFlags).toBe(true);
    expect(free.allowances.floor.fullHistory).toBe(true);
    expect(Object.keys(free.allowances)).not.toContain('trendsAndCorrelations');
    expect(Object.keys(free.allowances)).toContain('revealedTrendInsights');
  });

  it('is frozen against mutation', () => {
    expect(Object.isFrozen(MEDICAL_FLOOR)).toBe(true);
    expect(Object.isFrozen(FREE_ALLOWANCES)).toBe(true);
    expect(Object.isFrozen(PLUS_ALLOWANCES)).toBe(true);
  });
});

describe('normalizeTierForClient — fail open on shape, closed on entitlement', () => {
  it('reads a Free response as Free', () => {
    expect(normalizeTierForClient('free')).toBe('free');
  });

  it('renders an unknown future tier as Plus-shaped rather than crashing', () => {
    // A shipped 1.0.3 native build must survive a tier it has never heard of.
    // The server has already removed whatever that viewer may not see, so
    // rendering is safe; guessing "locked" would blank a paid user's report.
    for (const unknown of ['premium', 'clinician', 'trial', 42, {}, [], true]) {
      expect(normalizeTierForClient(unknown)).toBe('plus');
    }
  });

  it('renders a missing tier as Plus-shaped', () => {
    // Every response predating this change omits the field entirely.
    expect(normalizeTierForClient(undefined)).toBe('plus');
    expect(normalizeTierForClient(null)).toBe('plus');
  });
});

describe('resolved plan and error decisions', () => {
  it('allows a resolved Free plan with Free allowances', () => {
    const input = { freemiumActive: true, entitlement: { allowed: true as const, plan: 'free' as const } };
    expect(client(input)).toEqual(server(input));
    expect(client(input)).toMatchObject({ tier: 'free', reason: 'free_tier', gate: { gate: 'allow' } });
  });
  it('surfaces infrastructure failure without resolving Free', () => {
    const input = { freemiumActive: true, entitlement: { allowed: false as const, reason: 'error' as const, detail: 'offline' } };
    expect(client(input)).toEqual(server(input));
    expect(client(input)).toMatchObject({ reason: 'error', gate: { gate: 'block', reason: 'error' } });
    expect(client(input).tier).not.toBe('free');
  });
});
