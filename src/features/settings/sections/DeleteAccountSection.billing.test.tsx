// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/*
  F045 (review 2026-10-23). What the deletion warning says about billing must
  match what delete-user-data does:
  - a live Stripe subscription is cancelled immediately with no proration or
    refund (stripe.subscriptions.cancel, statuses active/trialing/past_due/unpaid);
  - a Google Play subscription is cancelled server-side only once the Play
    credential is configured, and the 409 may say so (`play_cancellation_enabled`).
    Servers that do not send the field keep the existing "does not cancel it".
*/

const state = vi.hoisted(() => ({
  subscriptionStatus: null as string | null,
  fetchResponses: [] as Array<{ status: number; body: Record<string, unknown> }>,
  fetchBodies: [] as unknown[],
}));
vi.mock('../../../hooks/useSubscription', () => ({
  useSubscription: () => ({
    subscription: state.subscriptionStatus === null ? null : { subscription_status: state.subscriptionStatus },
  }),
}));
vi.mock('../../../lib/native', () => ({ openExternalUrl: vi.fn() }));
vi.mock('../../../lib/iap', () => ({ storeSubscriptionsUrl: () => 'store:url' }));
vi.mock('../../../lib/supabase', () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: { access_token: 'synthetic-token' } } }), signOut: async () => {} },
  },
}));
import { DeleteAccountSection } from './DeleteAccountSection';

let root: Root;
let app: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: { body: string }) => {
    state.fetchBodies.push(JSON.parse(init.body));
    const next = state.fetchResponses.shift() ?? { status: 200, body: { success: true } };
    return { ok: next.status < 300, status: next.status, json: async () => next.body };
  }));
  app = document.createElement('div');
  document.body.append(app);
  root = createRoot(app);
  state.subscriptionStatus = null;
  state.fetchResponses = [];
  state.fetchBodies = [];
});
afterEach(async () => {
  await act(async () => root.unmount());
  app.remove();
  vi.unstubAllGlobals();
});

const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
async function render(node: ReactNode) {
  await act(async () => root.render(<MemoryRouter>{node}</MemoryRouter>));
}
const button = (text: string) => Array.from(app.querySelectorAll('button')).find(b => b.textContent?.trim() === text);
const click = async (text: string) => {
  const target = button(text);
  expect(target, text).toBeTruthy();
  await act(async () => target!.click());
  await act(async () => {});
};
async function openConfirm() {
  await render(<DeleteAccountSection />);
  await click('Delete My Data');
}
async function typeDeleteAndPress(label: string) {
  const input = app.querySelector('input[type="text"]') as HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'DELETE');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await click(label);
}

describe('F045: the deletion warning states what happens to a live Stripe subscription', () => {
  it.each(['active', 'trialing', 'past_due', 'unpaid'])('%s: says it is cancelled immediately and the rest of the period is not refunded', async status => {
    state.subscriptionStatus = status;
    await openConfirm();
    const page = norm(app.textContent);
    expect(page).toContain('Cancel your web subscription immediately');
    expect(page).toContain('is not refunded');
  });

  it.each([null, 'canceled', 'incomplete_expired', 'not_started'])('%s: no cancellation line, because there is nothing to cancel', async status => {
    state.subscriptionStatus = status;
    await openConfirm();
    expect(norm(app.textContent)).not.toMatch(/cancel your web subscription|not refunded/i);
  });
});

describe('F045: the Android warning follows what the server says it does', () => {
  const play = { platform: 'android', product_id: 'monthly', expires_at: null };

  it('says deletion does not cancel it when the server does not say otherwise (every deployed server today)', async () => {
    state.fetchResponses.push({ status: 409, body: { code: 'store_subscription_acknowledgement_required', store_subscriptions: [play] } });
    await openConfirm();
    await typeDeleteAndPress('Yes, Delete My Data');
    const page = norm(app.textContent);
    expect(page).toContain('Your subscription will keep billing');
    expect(page).toContain('Deleting your account does not cancel it.');
    expect(page).not.toContain('will cancel it right away');
    expect(button('Delete anyway — I’ll cancel my subscription myself')).toBeTruthy();
  });

  it('says deletion cancels it, irreversibly, when the 409 reports Play cancellation enabled', async () => {
    state.fetchResponses.push({
      status: 409,
      body: { code: 'store_subscription_acknowledgement_required', play_cancellation_enabled: true, store_subscriptions: [play] },
    });
    await openConfirm();
    await typeDeleteAndPress('Yes, Delete My Data');
    const page = norm(app.textContent);
    expect(page).toContain('Your subscription will be cancelled');
    expect(page).toContain('Deleting your account will cancel it right away.');
    expect(page).toContain('cannot be restored');
    expect(page).not.toContain('does not cancel it');
    expect(page).not.toContain('keep billing');
    await click('Delete and cancel my subscription');
    expect(state.fetchBodies).toEqual([{ acknowledge_store_subscriptions: false }, { acknowledge_store_subscriptions: true }]);
  });

  it('an App Store subscription still keeps billing even when Play cancellation is enabled', async () => {
    state.fetchResponses.push({
      status: 409,
      body: {
        code: 'store_subscription_acknowledgement_required',
        play_cancellation_enabled: true,
        store_subscriptions: [{ platform: 'ios', product_id: 'monthly', expires_at: null }],
      },
    });
    await openConfirm();
    await typeDeleteAndPress('Yes, Delete My Data');
    const page = norm(app.textContent);
    expect(page).toContain('Your subscription will keep billing');
    expect(page).toContain('billed by Apple');
    expect(page).not.toContain('will cancel it right away');
  });
});
