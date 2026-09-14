/*
  What the Dashboard may claim about entitlement, and when.

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

export interface DashboardEntitlementInput {
  /** `loading` from `useSubscription`: true until that query settles. */
  subscriptionLoading: boolean;
  /** `entitled` from `useSubscription`: the Stripe/StoreKit/Play/trial union. */
  entitled: boolean;
  /** `source` from `useSubscription`: which of those is doing the entitling. */
  source: SubscriptionSource;
}

export interface DashboardEntitlementView {
  /** Enables the "New panel" CTA and the empty-state upload button. */
  canCreateReport: boolean;
  /** The "Your trial has ended" notice. */
  showTrialEndedNotice: boolean;
  /** The pricing banner. Evaluated only once `canCreateReport` is true. */
  showUpsell: boolean;
}

export function resolveDashboardEntitlementView({
  subscriptionLoading,
  entitled,
  source,
}: DashboardEntitlementInput): DashboardEntitlementView {
  if (subscriptionLoading) {
    return {
      canCreateReport: true,
      showTrialEndedNotice: false,
      showUpsell: false,
    };
  }

  return {
    canCreateReport: entitled,
    showTrialEndedNotice: !entitled,
    /*
      Trial users are entitled but still worth an upgrade prompt; paid users of
      any storefront are not. Identical to the expression this replaced — only
      the loading branch above is new behaviour.
    */
    showUpsell: !entitled || source === 'trial',
  };
}
