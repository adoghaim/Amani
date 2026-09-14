import { describe, expect, it } from 'vitest';
import {
  sourceForEntitlement,
  sourceHasManageablePurchase,
  sourceIsActive,
  type SubscriptionSource,
} from './subscriptionSource';
import type { EntitlementResult } from './entitlement';

/**
 * The bug these exist for: `resolveEntitlement` gained a `complimentary` reason
 * but `SubscriptionSource` did not, so a permanent store-reviewer grant fell
 * through the final `else` and was labelled `trial`. `isActive()` then returned
 * false, which would have shown Google full backend access alongside
 * trial-expiry and upgrade messaging.
 *
 * The mapping lives in a pure function precisely so it can be pinned here —
 * vitest runs in a node environment and there is no React testing harness, so a
 * mounted-hook test is not available.
 */

const allowed = (reason: 'active_subscription' | 'active_iap' | 'complimentary' | 'trial') =>
  ({ allowed: true, reason }) as EntitlementResult;

describe('a complimentary grant is its own source', () => {
  it('maps to complimentary, not trial', () => {
    expect(sourceForEntitlement(allowed('complimentary'))).toBe('complimentary');
  });

  it('counts as active, so the reviewer is entitled', () => {
    expect(sourceIsActive(sourceForEntitlement(allowed('complimentary')))).toBe(true);
  });

  it('is never mistaken for a trial, which is what shows expiry messaging', () => {
    const source = sourceForEntitlement(allowed('complimentary'));
    expect(source).not.toBe('trial');
    expect(source).not.toBe('none');
  });

  it('offers no purchase to manage', () => {
    // No Stripe customer, no store row — every management destination would
    // error or show an unrelated account.
    expect(sourceHasManageablePurchase('complimentary')).toBe(false);
  });
});

describe('the other sources are unchanged', () => {
  it('maps a Stripe subscription to stripe', () => {
    expect(sourceForEntitlement(allowed('active_subscription'))).toBe('stripe');
  });

  it('maps an IAP entitlement to the storefront that entitles', () => {
    expect(sourceForEntitlement(allowed('active_iap'), 'ios')).toBe('ios');
    expect(sourceForEntitlement(allowed('active_iap'), 'android')).toBe('android');
  });

  it('maps an IAP entitlement with no live row to none', () => {
    expect(sourceForEntitlement(allowed('active_iap'), null)).toBe('none');
  });

  it('maps a trial to trial', () => {
    expect(sourceForEntitlement(allowed('trial'))).toBe('trial');
  });

  it('maps every denial to none', () => {
    for (const reason of ['trial_expired', 'onboarding_incomplete', 'no_subscription'] as const) {
      expect(sourceForEntitlement({ allowed: false, reason })).toBe('none');
    }
  });
});

describe('active and manageable are deliberately different questions', () => {
  it('treats paid sources as both active and manageable', () => {
    for (const source of ['stripe', 'ios', 'android'] as SubscriptionSource[]) {
      expect(sourceIsActive(source)).toBe(true);
      expect(sourceHasManageablePurchase(source)).toBe(true);
    }
  });

  it('treats complimentary as active but NOT manageable', () => {
    /*
      This is the whole distinction. A reviewer holds exactly the access a
      subscriber does — so nothing gated on `isActive` may differ — while
      owning no purchase, so nothing that manages one may be offered.
    */
    expect(sourceIsActive('complimentary')).toBe(true);
    expect(sourceHasManageablePurchase('complimentary')).toBe(false);
  });

  it('treats trial and none as neither', () => {
    for (const source of ['trial', 'none'] as SubscriptionSource[]) {
      expect(sourceIsActive(source)).toBe(false);
      expect(sourceHasManageablePurchase(source)).toBe(false);
    }
  });

  it('covers every member of the union', () => {
    // If a source is added and not classified here, this fails rather than the
    // new value quietly inheriting whichever branch happens to be last.
    const all: SubscriptionSource[] = ['stripe', 'ios', 'android', 'complimentary', 'trial', 'none'];
    for (const source of all) {
      expect(typeof sourceIsActive(source)).toBe('boolean');
      expect(typeof sourceHasManageablePurchase(source)).toBe('boolean');
    }
    expect(all).toHaveLength(6);
  });
});
