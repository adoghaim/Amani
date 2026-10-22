import { describe, expect, it } from 'vitest'
import { hasPremiumEntitlement, revenueCatEntitlementId, webBillingProvider } from './billingProvider'
import { buildRcAttributes } from './rcAttributes'
import { webPurchaseBlockReason } from './rcWeb'

describe('webBillingProvider', () => {
  it('defaults to stripe', () => expect(webBillingProvider({})).toBe('stripe'))
  it('needs both flag and key', () => {
    expect(webBillingProvider({ VITE_WEB_BILLING_PROVIDER: 'revenuecat' })).toBe('stripe')
    expect(webBillingProvider({ VITE_WEB_BILLING_PROVIDER: 'revenuecat', VITE_REVENUECAT_WEB_KEY: 'rcb_x' })).toBe('revenuecat')
  })
  it('entitlement id default', () => expect(revenueCatEntitlementId({})).toBe('premium'))
})

describe('hasPremiumEntitlement', () => {
  it('checks the active map', () => {
    expect(hasPremiumEntitlement({ entitlements: { active: { premium: {} } } }, 'premium')).toBe(true)
    expect(hasPremiumEntitlement({ entitlements: { active: {} } }, 'premium')).toBe(false)
    expect(hasPremiumEntitlement(null, 'premium')).toBe(false)
  })
})

describe('buildRcAttributes', () => {
  it('maps utm, promo, ref', () => {
    expect(
      buildRcAttributes({ utm_source: 'ig', utm_campaign: 'fall', ref: 'AMY1', promo: 'FALL20' }, null),
    ).toEqual({ utm_source: 'ig', $mediaSource: 'ig', utm_campaign: 'fall', $campaign: 'fall', promo_code: 'FALL20', ref_code: 'AMY1' })
  })
  it('saved promo wins and invalid codes drop', () => {
    expect(buildRcAttributes({ promo: 'A', ref: 'bad code!' }, 'SAVED')).toEqual({ promo_code: 'SAVED' })
    expect(buildRcAttributes(undefined, undefined)).toEqual({})
  })
})

describe('webPurchaseBlockReason', () => {
  it('blocks a second purchase for any active entitlement', () => {
    expect(webPurchaseBlockReason('ios', false)).toBe('native')
    expect(webPurchaseBlockReason('android', false)).toBe('native')
    expect(webPurchaseBlockReason('stripe', false)).toBe('stripe')
    expect(webPurchaseBlockReason('web', false)).toBe('web')
    expect(webPurchaseBlockReason('none', true)).toBe('web')
  })
  it('allows purchase with no entitlement', () => {
    expect(webPurchaseBlockReason('none', false)).toBeNull()
    expect(webPurchaseBlockReason('trial', false)).toBeNull()
    expect(webPurchaseBlockReason('complimentary', false)).toBeNull()
  })
})
