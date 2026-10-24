/*
  F047 (review 2026-10-23). With freemium off, Settings printed
  `users.subscription_status` and Billing branched on it. That column defaults
  to 'trial', is clamped to 'trial' by the privileged-columns triggers and is
  never written, so every paying subscriber read "Trial" in Settings and every
  lapsed customer read "Free Trial, 0 days" on Billing. Both now follow
  `useSubscription().source`. Every profile below carries the real production
  value of that column ('trial') so a regression to reading it goes red.
*/
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

const state = vi.hoisted(() => ({
  auth: {} as Record<string, unknown>,
  sub: {} as Record<string, unknown>,
}));

vi.mock('../lib/supabase', () => ({ supabase: {} }));
vi.mock('../lib/native', () => ({ isNative: () => false, openExternalUrl: vi.fn() }));
vi.mock('../lib/iap', () => ({
  initIap: vi.fn(), restoreIapPurchases: vi.fn(), syncIapEntitlement: vi.fn(), storeSubscriptionsUrl: vi.fn(),
}));
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => state.auth }));
vi.mock('../hooks/useSubscription', async () => ({
  ...(await import('../lib/subscriptionSource')),
  useSubscription: () => state.sub,
}));
vi.mock('../components/Layout', () => ({ Layout: ({ children }: { children: ReactNode }) => <>{children}</> }));

import { Billing } from './Billing';
import { AccountSection } from '../features/settings/sections/AccountSection';
import type { SettingsSectionProps } from '../features/settings/sections/types';

const text = (node: ReactNode) =>
  renderToStaticMarkup(<StaticRouter location="/">{node}</StaticRouter>)
    .replace(/<[^>]*>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');

function setUp(source: string, extra: Record<string, unknown> = {}, trialStart: string | null = '2026-01-01') {
  const profile = { id: 'u1', created_at: '2026-01-01T00:00:00Z', subscription_status: 'trial', trial_start_date: trialStart };
  state.auth = { user: { id: 'u1', email: 'a@example.invalid' }, userProfile: profile, loading: false };
  state.sub = {
    source, loading: false, error: null, entitled: ['stripe', 'ios', 'android', 'complimentary', 'trial'].includes(source),
    plan: undefined, complimentary: { used: 0, total: 3, remaining: 3 }, subscription: null, activeIap: null,
    refetch: vi.fn(),
    isActive: () => ['stripe', 'ios', 'android', 'complimentary'].includes(source),
    ...extra,
  };
  return { settings: () => text(<AccountSection {...(state.auth as unknown as SettingsSectionProps)} />), billing: () => text(<Billing />) };
}

beforeEach(() => { vi.stubEnv('VITE_FREEMIUM_ACTIVE', 'false'); });
afterEach(() => { vi.unstubAllEnvs(); });

describe('F047 flag off: labels follow the resolved entitlement, never users.subscription_status', () => {
  it.each(['stripe', 'ios', 'android'])('%s subscriber: Settings and Billing say Active, never Trial', source => {
    const { settings, billing } = setUp(source);
    expect(settings()).toContain('Subscription Status: Active subscription');
    expect(settings()).not.toMatch(/trial/i);
    expect(billing()).toContain('Active subscription');
    expect(billing()).not.toMatch(/Free Trial|Days Remaining|Your trial is active/);
  });

  it('complimentary access is labelled as such, not as a trial', () => {
    const { settings, billing } = setUp('complimentary');
    expect(settings()).toContain('Complimentary access');
    expect(settings()).not.toMatch(/trial/i);
    expect(billing()).toContain('Complimentary access');
  });

  it('a live trial still shows the trial on both surfaces', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date('2026-01-03T00:00:00Z'));
      const { settings, billing } = setUp('trial');
      expect(settings()).toContain('Free trial');
      expect(billing()).toContain('Status: Free Trial');
      expect(billing()).toContain('Days Remaining: 5 days');
      expect(billing()).toContain('Your trial is active');
    } finally {
      vi.useRealTimers();
    }
  });

  it('a lapsed or expired user (source none) is Expired on Billing, not "Free Trial, 0 days"', () => {
    const { settings, billing } = setUp('none');
    const page = billing();
    expect(page).toContain('Status: Expired');
    expect(page).toContain('Reactivate your subscription');
    expect(page).not.toMatch(/Free Trial|Days Remaining|Your trial is active/);
    expect(settings()).toContain('Subscription Status: Trial expired');
  });

  it('an account that never started its trial is not called expired', () => {
    const { settings, billing } = setUp('none', {}, null);
    expect(settings()).toContain('No active subscription');
    expect(billing()).toContain('Status: No active subscription');
    expect(billing()).not.toContain('Expired');
  });

  it('a failed read is a retry, never a lapsed label or a Subscribe offer', () => {
    const { settings, billing } = setUp('none', { error: new Error('x') });
    for (const out of [settings(), billing()]) {
      expect(out).toContain("We couldn't load your plan.");
      expect(out).not.toMatch(/Expired|Free Trial|Trial expired|Subscribe Now/);
    }
  });

  it('a failed read does not hide an entitlement that did resolve', () => {
    const { billing } = setUp('stripe', { error: new Error('x') });
    expect(billing()).toContain('Active subscription');
  });

  it('Settings shows Loading while the entitlement resolves', () => {
    const { settings } = setUp('none', { loading: true });
    expect(settings()).toContain('Loading...');
  });
});
