import { describe, expect, it } from 'vitest';
import { resolveEntitlement, TRIAL_DURATION_MS } from './entitlement';

const NOW = Date.parse('2026-08-21T00:00:00Z');
const base = { stripeStatus: null, iapRecords: [], trialStartDate: null, now: NOW };
const future = new Date(NOW + 86_400_000).toISOString();
const past = new Date(NOW - 86_400_000).toISOString();

describe('resolveEntitlement — Stripe', () => {
  it.each(['active', 'trialing', 'past_due'])('entitles on %s', (status) => {
    expect(resolveEntitlement({ ...base, stripeStatus: status })).toEqual({
      allowed: true,
      reason: 'active_subscription',
    });
  });

  it('does not entitle on canceled', () => {
    const r = resolveEntitlement({ ...base, stripeStatus: 'canceled' });
    expect(r.allowed).toBe(false);
  });
});

describe('resolveEntitlement — IAP', () => {
  it.each(['active', 'in_grace_period', 'billing_retry'])('entitles on %s', (status) => {
    expect(
      resolveEntitlement({ ...base, iapRecords: [{ status, expires_at: future }] })
    ).toEqual({ allowed: true, reason: 'active_iap' });
  });

  it('does not entitle when expired in the past', () => {
    const r = resolveEntitlement({
      ...base,
      iapRecords: [{ status: 'active', expires_at: past }],
    });
    expect(r.allowed).toBe(false);
  });

  it('does not entitle on revoked even if the expiry is still future', () => {
    const r = resolveEntitlement({
      ...base,
      iapRecords: [{ status: 'revoked', expires_at: future }],
    });
    expect(r.allowed).toBe(false);
  });

  it('trusts status when the store gave no expiry', () => {
    expect(
      resolveEntitlement({ ...base, iapRecords: [{ status: 'active', expires_at: null }] })
    ).toEqual({ allowed: true, reason: 'active_iap' });
  });

  it('fails closed on an unparseable expiry rather than entitling', () => {
    const r = resolveEntitlement({
      ...base,
      iapRecords: [{ status: 'active', expires_at: 'not-a-date' }],
    });
    expect(r.allowed).toBe(false);
  });

  it('ignores sandbox purchases in production', () => {
    const r = resolveEntitlement({
      ...base,
      iapRecords: [{ status: 'active', expires_at: future, environment: 'sandbox' }],
    });
    expect(r.allowed).toBe(false);
  });

  it('honours sandbox purchases when explicitly allowed', () => {
    const r = resolveEntitlement({
      ...base,
      iapRecords: [{ status: 'active', expires_at: future, environment: 'sandbox' }],
      allowSandbox: true,
    });
    expect(r).toEqual({ allowed: true, reason: 'active_iap' });
  });

  it('entitles if any one of several records is live', () => {
    const r = resolveEntitlement({
      ...base,
      iapRecords: [
        { status: 'expired', expires_at: past },
        { status: 'active', expires_at: future },
      ],
    });
    expect(r).toEqual({ allowed: true, reason: 'active_iap' });
  });
});

describe('resolveEntitlement — trial', () => {
  it('entitles inside the 7-day window', () => {
    expect(
      resolveEntitlement({ ...base, trialStartDate: new Date(NOW - 1000).toISOString() })
    ).toEqual({ allowed: true, reason: 'trial' });
  });

  it('expires exactly at the boundary', () => {
    const r = resolveEntitlement({
      ...base,
      trialStartDate: new Date(NOW - TRIAL_DURATION_MS).toISOString(),
    });
    expect(r).toEqual({ allowed: false, reason: 'trial_expired' });
  });

  it('reports onboarding_incomplete when the trial never started', () => {
    expect(resolveEntitlement(base)).toEqual({
      allowed: false,
      reason: 'onboarding_incomplete',
    });
  });
});

describe('resolveEntitlement — precedence and routing', () => {
  it('prefers a paid subscription over an active trial', () => {
    const r = resolveEntitlement({
      ...base,
      stripeStatus: 'active',
      trialStartDate: new Date(NOW - 1000).toISOString(),
    });
    expect(r).toEqual({ allowed: true, reason: 'active_subscription' });
  });

  it('sends a lapsed IAP customer to billing, not pricing', () => {
    const r = resolveEntitlement({
      ...base,
      iapRecords: [{ status: 'expired', expires_at: past }],
      trialStartDate: new Date(NOW - TRIAL_DURATION_MS - 1).toISOString(),
    });
    expect(r).toEqual({ allowed: false, reason: 'no_subscription' });
  });

  it('sends a never-paid user to pricing', () => {
    const r = resolveEntitlement({
      ...base,
      trialStartDate: new Date(NOW - TRIAL_DURATION_MS - 1).toISOString(),
    });
    expect(r).toEqual({ allowed: false, reason: 'trial_expired' });
  });
});
