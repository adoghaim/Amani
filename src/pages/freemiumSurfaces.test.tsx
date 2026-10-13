/*
  Flag-on user-facing copy, checked on the rendered pages rather than in source:
  the flag-off strings still live beside the flag-on ones (they ship in 1.0.5),
  so a grep over the source cannot tell the two apart, but a render can.

  "trial" is banned in flag-on text. Provider status enums (Stripe's
  `trialing`) are data, never rendered text, so they cannot trip this. Privacy
  is deliberately not scanned: its data-disclosure sentence about the trial
  start date is out of scope for this PR (legal banners are separate work).
*/
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

type Plan = 'premium' | 'free' | undefined;
const state = vi.hoisted(() => ({
  auth: { user: null as { id: string } | null, userProfile: null as Record<string, unknown> | null, loading: false },
  sub: {} as Record<string, unknown>,
}));

vi.mock('../lib/supabase', () => ({ supabase: {} }));
vi.mock('../lib/native', () => ({ isNative: () => false, openExternalUrl: vi.fn() }));
vi.mock('../lib/iap', () => ({
  getIapOfferings: vi.fn(), initIap: vi.fn(), isIapConfigured: () => true, restoreIapPurchases: vi.fn(),
  syncIapEntitlement: vi.fn(), purchaseIapProduct: vi.fn(), storeSubscriptionsUrl: vi.fn(),
}));
vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ ...state.auth, signOut: vi.fn(), signInWithGoogle: vi.fn(), signInWithApple: vi.fn(), refreshUserProfile: vi.fn() }),
}));
vi.mock('../hooks/useSubscription', async () => ({
  ...(await import('../lib/subscriptionSource')),
  useSubscription: () => state.sub,
}));
vi.mock('../utils/subscription', () => ({ checkSubscriptionLive: vi.fn(async () => ({ allowed: true })) }));
vi.mock('../components/Layout', () => ({ Layout: ({ children }: { children: ReactNode }) => <>{children}</> }));

import { Landing } from './Landing';
import { SignupPage } from './SignupPage';
import { LoginPage } from './LoginPage';
import { PricingPage } from './PricingPage';
import { Terms } from './Terms';
import { Billing } from './Billing';
import { SuccessPage } from './SuccessPage';
import { SubscriptionStatus } from '../components/SubscriptionStatus';
import { IapPaywall } from '../components/pricing/IapPaywall';
import { PremiumPaywall } from '../components/freemium/PremiumPaywall';
import { FreemiumReportPanel } from '../components/freemium/FreemiumReportPanel';
import { parseInterpretationAccess } from '../lib/freemium/interpretationAccess';

const text = (node: ReactNode) =>
  renderToStaticMarkup(<StaticRouter location="/">{node}</StaticRouter>)
    .replace(/<[^>]*>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');

function subscription(plan: Plan, extra: Record<string, unknown> = {}) {
  const source = extra.source ?? (plan === 'premium' ? 'stripe' : 'none');
  state.sub = {
    plan, source, loading: false, error: null, entitled: plan === 'premium',
    complimentary: { used: 1, total: 3, remaining: 2 },
    subscription: null, activeIap: null, refetch: vi.fn(),
    isActive: () => ['stripe', 'ios', 'android', 'complimentary'].includes(source as string),
    ...extra,
  };
}

const signedIn = () => {
  state.auth = { user: { id: 'u1' }, userProfile: { id: 'u1', subscription_status: 'trial', trial_start_date: '2026-09-20' }, loading: false };
};

beforeEach(() => {
  vi.stubGlobal('window', { location: { search: '', pathname: '/' } });
  state.auth = { user: null, userProfile: null, loading: false };
  subscription(undefined);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const noop = () => {};
const panel = (raw: unknown) => (
  <FreemiumReportPanel state={parseInterpretationAccess(raw)} generating={false} plan="free" complimentaryUsed={3}
    onRetry={noop} onGenerate={noop} onOpenPaywall={noop} />
);

const surfaces: [string, () => ReactNode][] = [
  ['Landing', () => <Landing />],
  ['SignupPage', () => <SignupPage />],
  ['LoginPage', () => <LoginPage />],
  ['PricingPage signed out', () => <PricingPage />],
  ['PricingPage Free', () => { signedIn(); subscription('free'); return <PricingPage />; }],
  ['PricingPage Premium', () => { signedIn(); subscription('premium'); return <PricingPage />; }],
  ['Terms', () => <Terms />],
  ['IapPaywall', () => { signedIn(); return <IapPaywall onEntitled={noop} />; }],
  ['PremiumPaywall', () => <PremiumPaywall open onClose={noop} />],
  ['SuccessPage', () => <SuccessPage />],
  ['SubscriptionStatus Free', () => { signedIn(); subscription('free'); return <SubscriptionStatus />; }],
  ['SubscriptionStatus Premium', () => { signedIn(); subscription('premium', { source: 'ios' }); return <SubscriptionStatus />; }],
  ['SubscriptionStatus complimentary', () => { signedIn(); subscription('premium', { source: 'complimentary' }); return <SubscriptionStatus />; }],
  ['Billing Free', () => { signedIn(); subscription('free'); return <Billing />; }],
  ['Billing Premium', () => { signedIn(); subscription('premium'); return <Billing />; }],
  ['Billing complimentary', () => { signedIn(); subscription('premium', { source: 'complimentary' }); return <Billing />; }],
  ['Billing read error', () => { signedIn(); subscription(undefined, { error: new Error('x') }); return <Billing />; }],
  ['Report basic', () => panel({ access: 'basic', interpretation: { headline: 'H' }, locked: { patterns: 2, cross_report: 1, lifestyle: 1 } })],
  ['Report full', () => panel({ access: 'full', interpretation: { headline: 'H' },
    complimentary: { used: 1, total: 3, remaining: 2 } })],
  ['Report error', () => panel({ access: 'error', code: 'entitlement_unavailable' })],
  ['Report generation_needed', () => panel({ access: 'generation_needed', interpretation: null })],
];

describe('flag on: no "trial" wording on any user-facing surface', () => {
  beforeEach(() => vi.stubEnv('VITE_FREEMIUM_ACTIVE', 'true'));

  it.each(surfaces)('%s', (_name, surface) => {
    const out = text(surface());
    expect(out.trim().length).toBeGreaterThan(0);
    expect(out).not.toMatch(/trial/i);
  });
});

describe('flag on: plan presentation', () => {
  beforeEach(() => vi.stubEnv('VITE_FREEMIUM_ACTIVE', 'true'));

  it('Free shows "Plan: Free" with complimentary remaining; no countdown or expiry', () => {
    signedIn(); subscription('free');
    const status = text(<SubscriptionStatus />);
    expect(status).toContain('Plan: Free');
    expect(status).toContain('2 complimentary Premium analyses remaining');
    const billing = text(<Billing />);
    expect(billing).toContain('Plan: Free');
    expect(billing).toContain('Premium Analysis 1 of 3 included');
    expect(billing).toContain('Upgrade to Premium');
    expect(billing).not.toMatch(/Days Remaining|Ends|Expired|remaining in your/i);
  });

  it('Premium shows "Plan: Premium" with its source', () => {
    signedIn(); subscription('premium', { source: 'android' });
    expect(text(<SubscriptionStatus />)).toContain('Plan: Premium · Billed through Google Play');
    subscription('premium', { source: 'stripe' });
    expect(text(<Billing />)).toContain('Plan: Premium');
  });

  it('a complimentary grant reads "Complimentary access", with nothing to manage', () => {
    signedIn(); subscription('premium', { source: 'complimentary' });
    expect(text(<SubscriptionStatus />)).toContain('Complimentary access');
    const billing = text(<Billing />);
    expect(billing).toContain('Complimentary access');
    expect(billing).not.toContain('Manage via Stripe');
  });

  it('a failed plan read is a retry on Billing, never Free and never an upgrade offer', () => {
    signedIn(); subscription(undefined, { error: new Error('offline') });
    const billing = text(<Billing />);
    expect(billing).toContain("We couldn't load your plan.");
    expect(billing).not.toMatch(/Plan: Free|Upgrade to Premium/);
    expect(text(<SubscriptionStatus />).trim()).toBe('');
  });

  it('PricingPage is account-aware', () => {
    expect(text(<PricingPage />)).toContain('Every Amani account includes 3 complimentary Premium analyses.');
    signedIn(); subscription('free', { complimentary: { used: 3, total: 3, remaining: 0 } });
    expect(text(<PricingPage />)).toContain("You've used your 3 complimentary Premium analyses.");
    subscription('premium');
    expect(text(<PricingPage />)).toContain('Premium is active on your account.');
  });

  it('SuccessPage waits on the purchase, not on app access', () => {
    expect(text(<SuccessPage />)).toContain('Confirming your purchase');
  });
});

describe('flag off: the 1.0.5 copy is untouched', () => {
  beforeEach(() => vi.stubEnv('VITE_FREEMIUM_ACTIVE', ''));

  it.each([
    ['Landing', () => <Landing />, ['Start your free 7-day trial', 'Seven days free first', 'No card to start.']],
    ['SignupPage', () => <SignupPage />, ['Start your trial', 'Seven days free, no card to start']],
    ['LoginPage', () => <LoginPage />, ['Start a free trial']],
    ['PricingPage', () => <PricingPage />, ['Both plans include everything. Seven days free first']],
    ['Terms', () => <Terms />, ['Subscriptions, trial, and renewal', 'Free trial:', 'Any unused portion of a free trial is forfeited']],
    ['IapPaywall', () => { signedIn(); return <IapPaywall onEntitled={noop} />; },
      ['Any unused portion of a free trial is forfeited when a subscription is purchased.']],
    ['SuccessPage', () => <SuccessPage />, ['Confirming your subscription']],
  ] as [string, () => ReactNode, string[]][])('%s', (_name, surface, expected) => {
    const out = text(surface());
    for (const s of expected) expect(out).toContain(s);
  });

  it('Billing and SubscriptionStatus keep the trial presentation', () => {
    signedIn();
    subscription(undefined, { source: 'trial', entitled: true });
    const billing = text(<Billing />);
    expect(billing).toContain('Free Trial');
    expect(billing).not.toContain('Plan: Free');
    expect(text(<SubscriptionStatus />)).not.toContain('Plan:');
  });

  // PK-FIX-02 (campaign 03-emails d): on the last trial day Billing read "Days Remaining: 1 days".
  it('Billing counts the remaining trial days with the right plural', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      signedIn(); // trial_start_date 2026-09-20
      subscription(undefined, { source: 'trial', entitled: true });
      vi.setSystemTime(new Date('2026-09-26T12:00:00Z'));
      const lastDay = text(<Billing />);
      expect(lastDay).toMatch(/Days Remaining: 1 day(?!s)/);
      expect(lastDay).toContain('You have 1 day remaining in your free trial.');
      expect(lastDay).not.toMatch(/\b1 days\b/);
      vi.setSystemTime(new Date('2026-09-25T12:00:00Z'));
      const twoDays = text(<Billing />);
      expect(twoDays).toContain('Days Remaining: 2 days');
      expect(twoDays).toContain('You have 2 days remaining in your free trial.');
    } finally {
      vi.useRealTimers();
    }
  });
});

// PK-FIX-02 (campaign fix e): only four markers are cycle-dependent, so "Every
// result read against your cycle" overstated; the bullet says what the cycle
// context does, with the flag on and off.
describe('signup bullets say what the cycle context does', () => {
  it.each(['true', ''])('VITE_FREEMIUM_ACTIVE=%j', flag => {
    vi.stubEnv('VITE_FREEMIUM_ACTIVE', flag);
    const out = text(<SignupPage />);
    expect(out).toContain('The cycle day of your test, when you add the day your last period started');
    expect(out).not.toMatch(/every result read against your cycle/i);
  });
});


describe('Landing pricing anchors', () => {
  it.each(['true', ''])('shows only real prices with freemium=%s', flag => {
    vi.stubEnv('VITE_FREEMIUM_ACTIVE', flag);
    const html = renderToStaticMarkup(<StaticRouter location="/"><Landing /></StaticRouter>);
    expect(html).toContain('$9.99');
    expect(html).toContain('$99.99');
    expect(html).toContain('Best value');
    expect(html).not.toMatch(/line-through|Save \$20|\$19\.99|\$199\.99/);
  });
});
