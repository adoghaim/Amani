import { describe, expect, it } from 'vitest';
import {
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

const resolved = (s: (typeof STATES)[number]): DashboardEntitlementInput => ({
  subscriptionLoading: false,
  entitled: s.entitled,
  source: s.source,
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
    expect(view({ subscriptionLoading: true, entitled: false, source: 'none' }).showTrialEndedNotice).toBe(
      false,
    );
  });

  it('does not disable New panel merely because the query is in flight', () => {
    // Safe to leave enabled: SubscriptionGate on /app/new does a live server
    // check and fails closed, so the button is an affordance, not the boundary.
    expect(view({ subscriptionLoading: true, entitled: false, source: 'none' }).canCreateReport).toBe(true);
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
    expect(view({ subscriptionLoading: false, entitled: true, source: 'trial' }).showUpsell).toBe(true);
  });

  for (const source of ['stripe', 'ios', 'android'] as const) {
    it(`never shows the upsell to a paying ${source} subscriber`, () => {
      expect(view({ subscriptionLoading: false, entitled: true, source }).showUpsell).toBe(false);
    });
  }

  it('still blocks and warns an expired trial', () => {
    const v = view({ subscriptionLoading: false, entitled: false, source: 'none' });
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

describe('entitlement logic itself is unchanged', () => {
  it('matches the pre-fix expressions once resolved', () => {
    // Guards the "do not change source-of-truth behaviour" requirement: for
    // every resolved input the result must equal what Dashboard computed before.
    for (const entitled of [true, false]) {
      for (const source of ['stripe', 'ios', 'android', 'trial', 'none'] as const) {
        const v = view({ subscriptionLoading: false, entitled, source });
        expect(v.canCreateReport).toBe(entitled);
        expect(v.showTrialEndedNotice).toBe(!entitled);
        expect(v.showUpsell).toBe(!entitled || source === 'trial');
      }
    }
  });
});
