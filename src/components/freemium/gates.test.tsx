import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { resolveDashboardEntitlementView } from '../../lib/dashboardEntitlement';
import { uploadRequiresSubscription } from '../../lib/freemium/gates';
import { paymentRequiredAction } from '../../lib/freemium/premiumRequired';

const subscription = vi.hoisted(() => ({
  current: { plan: undefined as 'premium' | 'free' | undefined, loading: false, error: null as Error | null, refetch: vi.fn() },
}));
const checkSubscriptionLive = vi.hoisted(() => vi.fn(async () => ({ allowed: true as const })));

vi.mock('../../lib/supabase', () => ({ supabase: {} }));
vi.mock('../../lib/native', () => ({ isNative: () => false, openExternalUrl: vi.fn() }));
vi.mock('../../hooks/useSubscription', () => ({ useSubscription: () => subscription.current }));
vi.mock('../../utils/subscription', () => ({ checkSubscriptionLive }));

import { UploadGate } from './UploadGate';
import { SubscriptionGate } from '../SubscriptionGate';

const render = (node: ReactNode) =>
  renderToStaticMarkup(<StaticRouter location="/app/new">{node}</StaticRouter>);

beforeEach(() => {
  subscription.current = { plan: undefined, loading: false, error: null, refetch: vi.fn() };
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('upload gate', () => {
  it('flag off: /app/new still needs a subscription (SubscriptionGate holds the children)', () => {
    vi.stubEnv('VITE_FREEMIUM_ACTIVE', '');
    expect(uploadRequiresSubscription()).toBe(true);
    expect(render(<UploadGate><p>upload form</p></UploadGate>)).not.toContain('upload form');
  });

  it('flag on: auth + onboarding only — the upload form renders with no entitlement check', () => {
    vi.stubEnv('VITE_FREEMIUM_ACTIVE', 'true');
    subscription.current.plan = 'free';
    expect(uploadRequiresSubscription()).toBe(false);
    expect(render(<UploadGate><p>upload form</p></UploadGate>)).toContain('upload form');
    expect(checkSubscriptionLive).not.toHaveBeenCalled();
  });
});

describe('Tracker comparison: 402 handling (paymentRequiredAction)', () => {
  const json402 = (body: unknown) => new Response(JSON.stringify(body), { status: 402 });

  it('flag on: premium_required opens the paywall; the pricing redirect is never consulted', async () => {
    const legacy = vi.fn(async () => '/pricing');
    expect(await paymentRequiredAction(json402({ code: 'premium_required' }), true, legacy)).toEqual({ kind: 'paywall' });
    expect(legacy).not.toHaveBeenCalled();
  });

  it('flag on: any other 402 keeps the legacy redirect', async () => {
    const legacy = vi.fn(async () => '/app/billing');
    expect(await paymentRequiredAction(json402({ code: 'subscription_required' }), true, legacy))
      .toEqual({ kind: 'redirect', to: '/app/billing' });
  });

  it('flag off: premium_required is a redirect, exactly as 1.0.5', async () => {
    const legacy = vi.fn(async () => '/pricing');
    expect(await paymentRequiredAction(json402({ code: 'premium_required' }), false, legacy))
      .toEqual({ kind: 'redirect', to: '/pricing' });
  });

  it('non-402 responses are left to the caller', async () => {
    const legacy = vi.fn(async () => '/pricing');
    expect(await paymentRequiredAction(new Response('{}', { status: 200 }), true, legacy)).toEqual({ kind: 'none' });
    expect(legacy).not.toHaveBeenCalled();
  });
});

describe('SubscriptionGate (no Premium variant)', () => {
  it('flag on it is still the legacy live check — it is not mounted on any flag-on route', () => {
    vi.stubEnv('VITE_FREEMIUM_ACTIVE', 'true');
    expect(render(<SubscriptionGate><p>surface</p></SubscriptionGate>)).not.toContain('surface');
  });
});

describe('Dashboard entitlement view', () => {
  const base = { subscriptionLoading: false, entitled: false, source: 'none' as const, trialDaysRemaining: 0 };

  it('flag on: uploads enabled, no trial notices, no dashboard upsell', () => {
    expect(resolveDashboardEntitlementView({ ...base, freemiumActive: true })).toEqual({
      canCreateReport: true, showTrialEndedNotice: false, showUpsell: false, showTrialCountdown: false,
    });
  });

  it('flag off: unchanged', () => {
    expect(resolveDashboardEntitlementView(base)).toEqual(resolveDashboardEntitlementView({ ...base, freemiumActive: false }));
    expect(resolveDashboardEntitlementView(base).showTrialEndedNotice).toBe(true);
  });
});
