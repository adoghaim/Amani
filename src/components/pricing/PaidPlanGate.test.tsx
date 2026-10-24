/*
  BS2 (review F040): a paid plan hides the web purchase buttons on PricingPage
  and PremiumPaywall, so nobody starts a second subscription. The store cards
  are covered in IapPaywall.test.tsx; the server refusal (409) in
  supabase/functions/stripe-checkout/index.test.ts.
*/
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

const state = vi.hoisted(() => ({ source: 'none' as string }));

vi.mock('../../lib/supabase', () => ({ supabase: {} }));
vi.mock('../../lib/native', () => ({ isNative: () => false, openExternalUrl: vi.fn() }));
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));
vi.mock('../../hooks/useSubscription', async () => ({
  ...(await import('../../lib/subscriptionSource')),
  useSubscription: () => ({
    source: state.source,
    plan: state.source === 'none' || state.source === 'trial' ? 'free' : 'premium',
    loading: false,
    error: null,
    complimentary: { used: 0, total: 3, remaining: 3 },
  }),
}));

import { PricingPage } from '../../pages/PricingPage';
import { PremiumPaywall } from '../freemium/PremiumPaywall';

const html = (node: ReactNode) => renderToStaticMarkup(<StaticRouter location="/pricing">{node}</StaticRouter>);
const NOTICE = 'You already have an active plan.';
const surfaces: [string, () => ReactNode][] = [
  ['PricingPage', () => <PricingPage />],
  ['PremiumPaywall', () => <PremiumPaywall open onClose={vi.fn()} />],
];

beforeEach(() => { vi.stubGlobal('window', { location: { search: '', pathname: '/pricing' } }); });
afterEach(() => {
  state.source = 'none';
  vi.unstubAllGlobals();
});

describe.each(surfaces)('%s with a paid plan', (_name, surface) => {
  it.each(['stripe', 'ios', 'android'])('shows no Stripe plan card for a %s subscriber, and points to Billing', (source) => {
    state.source = source;
    const out = html(surface());
    expect(out).toContain(NOTICE);
    expect(out).toContain('Manage your plan');
    expect(out).not.toContain('$99.99');
    expect(out).not.toContain('$9.99');
    expect(out).not.toMatch(/<button[^>]*aria-describedby="plan-cta-note-/);
  });

  it.each(['none', 'trial', 'complimentary'])('still offers both plans for %s', (source) => {
    state.source = source;
    const out = html(surface());
    expect(out).not.toContain(NOTICE);
    expect(out).toContain('$99.99');
    expect(out).toContain('$9.99');
  });
});
