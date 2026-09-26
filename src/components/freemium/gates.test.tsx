import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { resolveDashboardEntitlementView } from '../../lib/dashboardEntitlement';
import { uploadRequiresSubscription } from '../../lib/freemium/gates';

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

describe('SubscriptionGate as a Premium gate (flag on)', () => {
  beforeEach(() => vi.stubEnv('VITE_FREEMIUM_ACTIVE', 'true'));

  it('Premium passes through', () => {
    subscription.current.plan = 'premium';
    expect(render(<SubscriptionGate><p>premium surface</p></SubscriptionGate>)).toContain('premium surface');
  });

  it('Free sees an in-place upgrade, not a redirect', () => {
    subscription.current.plan = 'free';
    const html = render(<SubscriptionGate><p>premium surface</p></SubscriptionGate>);
    expect(html).not.toContain('premium surface');
    expect(html).toContain('Premium feature');
    expect(html).toContain('Unlock Premium');
  });

  it('an entitlement read error is a retry, never a paywall', () => {
    subscription.current.error = new Error('offline');
    const html = render(<SubscriptionGate><p>premium surface</p></SubscriptionGate>);
    expect(html).toContain('Try again');
    expect(html).not.toContain('Unlock Premium');
    expect(html).not.toContain('premium surface');
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
