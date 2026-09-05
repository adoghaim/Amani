import { describe, expect, it } from 'vitest';
import {
  getIapProduct,
  getStripeTwin,
  normalizeIapProductId,
} from './iap-config';
import { resolveEntitlement as clientResolve } from './entitlement';
import { resolveEntitlement as serverResolve } from '../../supabase/functions/_shared/entitlement';

const NOW = Date.parse('2026-09-05T00:00:00Z');
const FUTURE = new Date(NOW + 86_400_000).toISOString();
const EXPIRED_TRIAL = new Date(NOW - 8 * 86_400_000).toISOString();
const USER = '11111111-1111-4111-8111-111111111111';
const MONTHLY = 'com.amani.health.premium.monthly';
const PLAY_MONTHLY = `${MONTHLY}:monthly`;

describe('Google Play base-plan identifiers', () => {
  it('canonicalizes RevenueCat subscriptionId:basePlanId to the Amani product id', () => {
    expect(normalizeIapProductId(PLAY_MONTHLY)).toBe(MONTHLY);
    expect(normalizeIapProductId(MONTHLY)).toBe(MONTHLY);
  });

  it('matches Android products to the same catalog entries used by iOS', () => {
    expect(getIapProduct(PLAY_MONTHLY)).toMatchObject({
      productId: MONTHLY,
      interval: 'month',
    });
    expect(getStripeTwin(PLAY_MONTHLY)?.interval).toBe('month');
  });

  it('does not turn an unknown parent subscription into a sold product', () => {
    expect(getIapProduct('com.amani.health.premium.lifetime:lifetime')).toBeUndefined();
  });

  it('entitles an allowlisted Google sandbox tester when RevenueCat stores the base-plan suffix', () => {
    const input = {
      stripeStatus: null,
      iapRecords: [
        {
          status: 'active',
          expires_at: FUTURE,
          environment: 'sandbox',
          platform: 'android',
          product_id: PLAY_MONTHLY,
        },
      ],
      trialStartDate: null,
      now: NOW,
      userId: USER,
      betaTester: {
        user_id: USER,
        platform: 'google',
        expires_at: FUTURE,
        enabled: true,
      },
    } as const;

    expect(clientResolve(input)).toEqual({ allowed: true, reason: 'active_iap' });
    expect(serverResolve(input)).toEqual({ allowed: true, reason: 'active_iap' });
  });

  it('keeps the normalization Android-only in the entitlement boundary', () => {
    const input = {
      stripeStatus: null,
      iapRecords: [
        {
          status: 'active',
          expires_at: FUTURE,
          environment: 'sandbox',
          platform: 'ios',
          product_id: PLAY_MONTHLY,
        },
      ],
      trialStartDate: EXPIRED_TRIAL,
      now: NOW,
      userId: USER,
      betaTester: {
        user_id: USER,
        platform: 'apple',
        expires_at: FUTURE,
        enabled: true,
      },
    } as const;

    expect(clientResolve(input)).toEqual({ allowed: false, reason: 'no_subscription' });
    expect(serverResolve(input)).toEqual({ allowed: false, reason: 'no_subscription' });
  });
});
