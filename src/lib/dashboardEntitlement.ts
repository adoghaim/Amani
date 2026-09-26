/*
  What the Dashboard may claim about entitlement, and when.

  Every entitlement-driven element on that page is decided here, so there is one
  place to check that they agree with each other and with the server. Two bugs
  put it here, both the same shape — a subscription question answered by
  something that was not the subscription:

    - the "trial has ended" notice and the disabled CTA, answered by `entitled`
      while it was still loading and therefore still false;
    - the trial countdown, answered by `userProfile.subscription_status`, a dead
      column that reads 'trial' forever.

  `useSubscription` starts at `entitled: false, source: 'none'` and resolves on
  its own clock — a query independent of the Dashboard's own data fetch. The
  Dashboard read `entitled` without reading `loading`, so in the window between
  its own data arriving and the subscription query returning, a paying
  subscriber was shown the not-entitled UI: a disabled "New panel" button and
  the "Your trial has ended" notice. That notice is the exact thing #63 set out
  to stop showing paying customers; it fixed the permanent case and left a
  transient one, because the loading state was never threaded through.

  `SubscriptionStatus` already had this right — it renders a skeleton while
  `loading || subscriptionLoading` and commits to nothing until it knows. This
  module applies the same rule to the Dashboard, kept as a pure function so the
  entitlement states can be tested without a DOM (vitest runs `environment:
  'node'` and there is no component-test harness in this repo).

  The rule is: unresolved is not the same as unentitled. While loading we
  withhold the negative UI rather than assert the positive — no "trial ended"
  notice, no upsell — and leave the "New panel" affordance enabled.

  Enabling it optimistically is safe because the button was never the security
  boundary. `/app/new` is wrapped in `SubscriptionGate` (`App.tsx:92`), which
  runs `checkSubscriptionLive` against the server and fails closed — its `catch`
  redirects to `/pricing` — and `NewReport.tsx:172` guards again behind it. A
  genuinely unentitled user who taps the button during that window lands on the
  same redirect they would have got anyway. The cost of guessing wrong in this
  direction is one extra navigation; the cost of guessing wrong in the other is
  telling a paying customer their trial has ended.
*/

import type { SubscriptionSource } from '../hooks/useSubscription';

/**
 * The countdown is a nudge, not a status readout: it appears only in the last
 * few days, when there is something left to act on.
 */
export const TRIAL_COUNTDOWN_THRESHOLD_DAYS = 3;

export interface DashboardEntitlementInput {
  /** `loading` from `useSubscription`: true until that query settles. */
  subscriptionLoading: boolean;
  /** `entitled` from `useSubscription`: the Stripe/StoreKit/Play/trial union. */
  entitled: boolean;
  /** `source` from `useSubscription`: which of those is doing the entitling. */
  source: SubscriptionSource;
  /**
   * `getTrialDaysRemaining(userProfile)`; null when there is no trial clock.
   * Consulted only once `source` has confirmed a trial is what is actually
   * entitling this user — see `showTrialCountdown` below for why.
   */
  trialDaysRemaining: number | null;
  /**
   * `clientFreemiumActive()`. On, uploading is part of Free and there is no
   * trial to count down or to have ended; the plan itself is shown by
   * SubscriptionStatus, and the paywall is entered from reports and Billing.
   */
  freemiumActive?: boolean;
}

export interface DashboardEntitlementView {
  /** Enables the "New panel" CTA and the empty-state upload button. */
  canCreateReport: boolean;
  /** The "Your trial has ended" notice. */
  showTrialEndedNotice: boolean;
  /** The pricing banner. Evaluated only once `canCreateReport` is true. */
  showUpsell: boolean;
  /** The "N days left in your trial" countdown. */
  showTrialCountdown: boolean;
}

export function resolveDashboardEntitlementView({
  subscriptionLoading,
  entitled,
  source,
  trialDaysRemaining,
  freemiumActive = false,
}: DashboardEntitlementInput): DashboardEntitlementView {
  if (freemiumActive) {
    return {
      canCreateReport: true,
      showTrialEndedNotice: false,
      showUpsell: false,
      showTrialCountdown: false,
    };
  }

  if (subscriptionLoading) {
    return {
      canCreateReport: true,
      showTrialEndedNotice: false,
      showUpsell: false,
      showTrialCountdown: false,
    };
  }

  /*
    `source`, not `userProfile.subscription_status`.

    `getTrialDaysRemaining` returns a number whenever `subscription_status ===
    'trial'` and a `trial_start_date` exists. That column is `DEFAULT 'trial'`
    and nothing writes it — the same dead source of truth #63 removed from every
    other subscription decision on this page — so it still reads 'trial' after
    someone pays. A subscriber who bought inside their first week was therefore
    told "3 days left in your trial" while actively paying for a subscription.

    Asking `source === 'trial'` asks the authoritative union instead. It is an
    allow-list, which is why the `'complimentary'` source #56 adds needs no
    change here: anything that is not literally a trial gets no trial countdown,
    by construction rather than by remembering to add another exclusion.

    `entitled &&` is redundant today — `useSubscription` sets `source: 'none'`
    whenever entitlement fails, so an expired trial cannot reach this line — but
    it makes "no countdown for an expired trial" a property of this function
    rather than one inherited from a hook two modules away.
  */
  const onGenuineTrial = entitled && source === 'trial';

  return {
    canCreateReport: entitled,
    showTrialEndedNotice: !entitled,
    /*
      Trial users are entitled but still worth an upgrade prompt; paid users of
      any storefront are not. Identical to the expression this replaced — only
      the loading branch above is new behaviour.
    */
    showUpsell: !entitled || source === 'trial',
    showTrialCountdown:
      onGenuineTrial &&
      trialDaysRemaining !== null &&
      trialDaysRemaining <= TRIAL_COUNTDOWN_THRESHOLD_DAYS,
  };
}
