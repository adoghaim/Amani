import { describe, expect, it, vi } from 'vitest';
import { isStripePurchaseConfirmed, waitForStripePurchase, type StripeSubscriptionRow } from './purchaseConfirmation';
import { isPremiumRequiredResponse } from './premiumRequired';

describe('isStripePurchaseConfirmed', () => {
  it.each([
    [{ subscription_id: 'sub_1', subscription_status: 'active' }, true],
    [{ subscription_id: 'sub_1', subscription_status: 'trialing' }, true],
    [{ subscription_id: 'sub_1', subscription_status: 'past_due' }, false],
    [{ subscription_id: 'sub_1', subscription_status: 'incomplete' }, false],
    [{ subscription_id: null, subscription_status: 'not_started' }, false],
    [{ subscription_id: '', subscription_status: 'active' }, false],
    [null, false],
  ])('%j -> %s', (row, expected) => {
    expect(isStripePurchaseConfirmed(row as StripeSubscriptionRow | null)).toBe(expected);
  });
});

describe('waitForStripePurchase (SuccessPage, flag on)', () => {
  const clock = () => {
    let t = 0;
    return { now: () => t, sleep: async (ms: number) => { t += ms; } };
  };

  it('confirms only once the subscription row exists — not on generic app access', async () => {
    const rows: (StripeSubscriptionRow | null)[] = [
      null,
      { subscription_id: null, subscription_status: 'not_started' },
      { subscription_id: 'sub_1', subscription_status: 'active' },
    ];
    const read = vi.fn(async () => rows.shift() ?? null);
    const outcome = await waitForStripePurchase({ read, isCancelled: () => false, ...clock(), intervalMs: 2000, timeoutMs: 45000 });
    expect(outcome).toBe('confirmed');
    expect(read).toHaveBeenCalledTimes(3);
  });

  it('treats read errors as not-yet and reports slow at the deadline', async () => {
    const read = vi.fn(async () => { throw new Error('offline'); });
    const outcome = await waitForStripePurchase({ read, isCancelled: () => false, ...clock(), intervalMs: 2000, timeoutMs: 6000 });
    expect(outcome).toBe('slow');
    expect(read).toHaveBeenCalledTimes(4);
  });

  it('stops when cancelled', async () => {
    let cancelled = false;
    const read = vi.fn(async () => { cancelled = true; return null; });
    const outcome = await waitForStripePurchase({ read, isCancelled: () => cancelled, ...clock(), intervalMs: 2000, timeoutMs: 45000 });
    expect(outcome).toBeNull();
  });
});

describe('isPremiumRequiredResponse (Tracker comparison, flag on)', () => {
  const response = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

  it('only 402 premium_required opens the paywall', async () => {
    expect(await isPremiumRequiredResponse(response(402, { code: 'premium_required' }))).toBe(true);
    expect(await isPremiumRequiredResponse(response(402, { error: 'subscription_required', reason: 'onboarding_incomplete' }))).toBe(false);
    expect(await isPremiumRequiredResponse(response(503, { code: 'premium_required' }))).toBe(false);
    expect(await isPremiumRequiredResponse(new Response('not json', { status: 402 }))).toBe(false);
  });

  it('leaves the body readable for handle402', async () => {
    const res = response(402, { error: 'subscription_required' });
    await isPremiumRequiredResponse(res);
    expect(await res.json()).toEqual({ error: 'subscription_required' });
  });
});
