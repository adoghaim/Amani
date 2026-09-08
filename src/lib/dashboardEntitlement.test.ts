import { describe, expect, it } from 'vitest';
import {
  TRIAL_COUNTDOWN_THRESHOLD_DAYS,
  resolveDashboardEntitlementView as view,
  type DashboardEntitlementInput,
} from './dashboardEntitlement';
import type { SubscriptionSource } from '../hooks/useSubscription';

/**
 * The regression under test: while `useSubscription` is still loading it
 * reports `entitled: false, source: 'none'`, which is indistinguishable from a
 * user with no subscription. Dashboard treated the two the same and briefly
 * told paying subscribers their trial had ended.
 *
 * So every case below is asserted twice — once resolved, once still loading —
 * and the loading half is the half that was broken.
 */

/** The six entitlement states the Dashboard has to render. */
const STATES: Array<{
  name: string;
  entitled: boolean;
  source: SubscriptionSource;
  /** Is this someone who has paid us money? They must never see an upsell. */
  paying: boolean;
}> = [
  { name: 'active Stripe subscriber', entitled: true, source: 'stripe', paying: true },
  { name: 'active iOS IAP subscriber', entitled: true, source: 'ios', paying: true },
  { name: 'active Android IAP subscriber', entitled: true, source: 'android', paying: true },
  { name: 'active trial', entitled: true, source: 'trial', paying: false },
  { name: 'expired trial', entitled: false, source: 'none', paying: false },
  { name: 'no entitlement', entitled: false, source: 'none', paying: false },
];

/**
 * Every case below is built with a live trial clock, because that is the
 * regression: `getTrialDaysRemaining` reads `subscription_status`, which is
 * `DEFAULT 'trial'` and never written, so it keeps returning a number after the
 * user pays. Someone who subscribes inside their first week looks exactly like
 * this — paying, and still two days from the end of a "trial". If the countdown
 * were still driven by that column, every state here would show one.
 */
const TRIAL_DAYS_INSIDE_WINDOW = 2;

const resolved = (
  s: (typeof STATES)[number],
  trialDaysRemaining: number | null = TRIAL_DAYS_INSIDE_WINDOW,
): DashboardEntitlementInput => ({
  subscriptionLoading: false,
  entitled: s.entitled,
  source: s.source,
  trialDaysRemaining,
});

const loading = (s: (typeof STATES)[number]): DashboardEntitlementInput => ({
  ...resolved(s),
  // What the hook actually reports before its query settles, regardless of
  // what the user is really entitled to.
  subscriptionLoading: true,
  entitled: false,
  source: 'none',
});

describe('resolveDashboardEntitlementView — while entitlement is unresolved', () => {
  for (const state of STATES) {
    it(`commits to nothing for a ${state.name}`, () => {
      const v = view(loading(state));
      expect(v.showTrialEndedNotice).toBe(false);
      expect(v.showUpsell).toBe(false);
      expect(v.canCreateReport).toBe(true);
    });
  }

  it('never claims the trial has ended before it knows', () => {
    // The specific string a paying customer was shown. #63 fixed the permanent
    // case; this is the transient one.
    expect(view({ subscriptionLoading: true, entitled: false, source: 'none', trialDaysRemaining: TRIAL_DAYS_INSIDE_WINDOW }).showTrialEndedNotice).toBe(
      false,
    );
  });

  it('does not disable New panel merely because the query is in flight', () => {
    // Safe to leave enabled: SubscriptionGate on /app/new does a live server
    // check and fails closed, so the button is an affordance, not the boundary.
    expect(view({ subscriptionLoading: true, entitled: false, source: 'none', trialDaysRemaining: TRIAL_DAYS_INSIDE_WINDOW }).canCreateReport).toBe(true);
  });
});

describe('resolveDashboardEntitlementView — once entitlement resolves', () => {
  for (const state of STATES) {
    it(`renders the ${state.name} correctly`, () => {
      const v = view(resolved(state));
      expect(v.canCreateReport).toBe(state.entitled);
      expect(v.showTrialEndedNotice).toBe(!state.entitled);
    });
  }

  it('shows the upsell to trial users', () => {
    expect(view({ subscriptionLoading: false, entitled: true, source: 'trial', trialDaysRemaining: TRIAL_DAYS_INSIDE_WINDOW }).showUpsell).toBe(true);
  });

  for (const source of ['stripe', 'ios', 'android'] as const) {
    it(`never shows the upsell to a paying ${source} subscriber`, () => {
      expect(view({ subscriptionLoading: false, entitled: true, source, trialDaysRemaining: TRIAL_DAYS_INSIDE_WINDOW }).showUpsell).toBe(false);
    });
  }

  it('still blocks and warns an expired trial', () => {
    const v = view({ subscriptionLoading: false, entitled: false, source: 'none', trialDaysRemaining: TRIAL_DAYS_INSIDE_WINDOW });
    expect(v.canCreateReport).toBe(false);
    expect(v.showTrialEndedNotice).toBe(true);
  });
});

describe('paying subscribers are never shown an upsell or a disabled CTA', () => {
  // The acceptance criterion for #63, asserted across both phases so it cannot
  // regress into the loading window again.
  for (const state of STATES.filter((s) => s.paying)) {
    it(`${state.name}: not in either phase`, () => {
      for (const input of [loading(state), resolved(state)]) {
        const v = view(input);
        expect(v.showUpsell).toBe(false);
        expect(v.showTrialEndedNotice).toBe(false);
        expect(v.canCreateReport).toBe(true);
      }
    });
  }
});

describe('trial countdown — only for people actually on a trial', () => {
  /*
    The regression: `getTrialDaysRemaining` reads the dead `subscription_status`
    column, so it keeps reporting days left after the user pays. Each case here
    supplies a live clock, so anything still driven by that column shows a
    countdown and fails.
  */
  for (const source of ['stripe', 'ios', 'android'] as const) {
    it(`is hidden for a paying ${source} subscriber who is still inside their first week`, () => {
      const v = view({
        subscriptionLoading: false,
        entitled: true,
        source,
        trialDaysRemaining: TRIAL_DAYS_INSIDE_WINDOW,
      });
      expect(v.showTrialCountdown).toBe(false);
    });
  }

  it('is shown to a genuine active trial inside the window', () => {
    const v = view({
      subscriptionLoading: false,
      entitled: true,
      source: 'trial',
      trialDaysRemaining: TRIAL_DAYS_INSIDE_WINDOW,
    });
    expect(v.showTrialCountdown).toBe(true);
  });

  it('is hidden for a genuine trial that is not near its end yet', () => {
    const v = view({
      subscriptionLoading: false,
      entitled: true,
      source: 'trial',
      trialDaysRemaining: TRIAL_COUNTDOWN_THRESHOLD_DAYS + 1,
    });
    expect(v.showTrialCountdown).toBe(false);
  });

  it('treats the threshold as inclusive, exactly as before', () => {
    const at = view({
      subscriptionLoading: false,
      entitled: true,
      source: 'trial',
      trialDaysRemaining: TRIAL_COUNTDOWN_THRESHOLD_DAYS,
    });
    expect(at.showTrialCountdown).toBe(true);
  });

  it('is hidden when there is no trial clock at all', () => {
    const v = view({
      subscriptionLoading: false,
      entitled: true,
      source: 'trial',
      trialDaysRemaining: null,
    });
    expect(v.showTrialCountdown).toBe(false);
  });

  for (const state of STATES.filter((s) => !s.entitled)) {
    it(`is hidden for ${state.name} — an ended trial is not an active one`, () => {
      expect(view(resolved(state)).showTrialCountdown).toBe(false);
    });
  }

  it('is hidden while entitlement is still loading', () => {
    for (const state of STATES) {
      expect(view(loading(state)).showTrialCountdown).toBe(false);
    }
  });

  it('is hidden for a complimentary grant, without needing a rule for it', () => {
    /*
      #56 adds a `'complimentary'` source. The check is an allow-list — only
      `'trial'` qualifies — so a source this file has never heard of is excluded
      by construction. The cast is what a future union member would look like
      here today.
    */
    const v = view({
      subscriptionLoading: false,
      entitled: true,
      source: 'complimentary' as SubscriptionSource,
      trialDaysRemaining: TRIAL_DAYS_INSIDE_WINDOW,
    });
    expect(v.showTrialCountdown).toBe(false);
  });
});

describe('entitlement logic itself is unchanged', () => {
  it('preserves the old countdown expression for genuine trials', () => {
    /*
      Trial duration and the threshold are untouched: for someone the
      authoritative source agrees is on a trial, the answer is still exactly
      `trialDaysRemaining !== null && trialDaysRemaining <= 3`. Only who is
      allowed to reach that expression has changed.
    */
    for (const days of [null, 0, 1, 2, 3, 4, 7, 30]) {
      const v = view({
        subscriptionLoading: false,
        entitled: true,
        source: 'trial',
        trialDaysRemaining: days,
      });
      expect(v.showTrialCountdown).toBe(days !== null && days <= 3);
    }
  });

  it('matches the pre-fix expressions once resolved', () => {
    // Guards the "do not change source-of-truth behaviour" requirement: for
    // every resolved input the result must equal what Dashboard computed before.
    for (const entitled of [true, false]) {
      for (const source of ['stripe', 'ios', 'android', 'trial', 'none'] as const) {
        const v = view({ subscriptionLoading: false, entitled, source, trialDaysRemaining: TRIAL_DAYS_INSIDE_WINDOW });
        expect(v.canCreateReport).toBe(entitled);
        expect(v.showTrialEndedNotice).toBe(!entitled);
        expect(v.showUpsell).toBe(!entitled || source === 'trial');
      }
    }
  });
});
