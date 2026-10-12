// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/*
  PK-INT-01 (D3): Settings is one ordered list of section components. The
  split from the single Settings.tsx was proven DOM-identical against main in
  the PK-INT-01 PR; these tests keep the page equal to its list and pin the
  delete flow that moved into DeleteAccountSection.
*/

const state = vi.hoisted(() => ({
  fetchResponses: [] as Array<{ status: number; body: Record<string, unknown> }>,
  fetchBodies: [] as unknown[],
  opened: [] as string[],
}));
// Stable objects: the reminders section re-reads preferences when `user` changes identity.
const auth = vi.hoisted(() => ({
  user: { id: 'user-1', email: 'synthetic@example.invalid' },
  userProfile: { created_at: '2026-01-01T00:00:00.000Z', subscription_status: 'active' },
}));
vi.mock('../../../contexts/AuthContext', () => ({ useAuth: () => auth }));
vi.mock('../../../components/Layout', () => ({ Layout: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock('../PersonalContextCard', () => ({ PersonalContextCard: () => <div data-testid="personal-context" /> }));
vi.mock('../../../lib/native', () => ({ openExternalUrl: vi.fn(async (url: string) => { state.opened.push(url); }) }));
vi.mock('../../../lib/iap', () => ({ storeSubscriptionsUrl: (platform: string, product: string) => `store:${platform}:${product}` }));
vi.mock('../../../lib/supabase', () => ({
  supabase: {
    from: () => {
      const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: null, error: null }) };
      return query;
    },
    auth: { getSession: async () => ({ data: { session: { access_token: 'synthetic-token' } } }), signOut: async () => {} },
  },
}));
import { Settings } from '../../../pages/Settings';
import { SETTINGS_SECTIONS } from './index';
import type { SettingsSectionProps } from './types';
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
  state.fetchResponses = [];
  state.fetchBodies = [];
  state.opened = [];
});
afterEach(async () => {
  await act(async () => root.unmount());
  app.remove();
  vi.unstubAllGlobals();
});

async function render(node: ReactNode, target: Root = root) {
  await act(async () => target.render(<MemoryRouter>{node}</MemoryRouter>));
  // Let the preferences read settle.
  await act(async () => {});
}
const props = auth as unknown as SettingsSectionProps;
const button = (text: string) => Array.from(app.querySelectorAll('button')).find(b => b.textContent?.trim() === text);
const click = async (text: string) => {
  const target = button(text);
  expect(target, text).toBeTruthy();
  await act(async () => target!.click());
  await act(async () => {});
};

describe('Settings sections (PK-INT-01)', () => {
  it('lists the sections in page order, each once', () => {
    expect(SETTINGS_SECTIONS.map(s => s.id)).toEqual(['account', 'personal-context', 'reminders', 'privacy', 'delete-account']);
    expect(new Set(SETTINGS_SECTIONS.map(s => s.Component)).size).toBe(SETTINGS_SECTIONS.length);
  });

  it('the page is exactly its section list: each child is that section rendered on its own', async () => {
    await render(<Settings />);
    const list = app.querySelector('.space-y-6')!;
    const children = Array.from(list.children).map(child => child.outerHTML);
    expect(children).toHaveLength(SETTINGS_SECTIONS.length);
    for (const [index, { id, Component }] of SETTINGS_SECTIONS.entries()) {
      const holder = document.createElement('div');
      const alone = createRoot(holder);
      await render(<Component {...props} />, alone);
      expect(children[index], id).toBe(holder.innerHTML);
      await act(async () => alone.unmount());
    }
    expect(Array.from(list.querySelectorAll('h2')).map(h => h.textContent?.trim()))
      .toEqual(['Account information', 'Reminder preferences', 'Data Privacy & Security', 'Delete my data']);
  });

  it('shows the loading state, and no section, until the profile is loaded', async () => {
    const profile = auth.userProfile;
    (auth as { userProfile: unknown }).userProfile = null;
    try {
      await render(<Settings />);
      expect(app.textContent).toBe('Loading...');
    } finally {
      auth.userProfile = profile;
    }
  });
});

describe('DeleteAccountSection: the delete flow that moved out of Settings.tsx', () => {
  it('stops on a live store subscription, links to the store, and sends the acknowledgement only on the second press', async () => {
    state.fetchResponses.push({
      status: 409,
      body: {
        code: 'store_subscription_acknowledgement_required',
        store_subscriptions: [{ platform: 'ios', product_id: 'com.example.monthly', expires_at: null }],
      },
    });
    await render(<DeleteAccountSection />);
    await click('Delete My Data');
    expect(button('Yes, Delete My Data')!.disabled).toBe(true);
    const input = app.querySelector('input[type="text"]') as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'DELETE');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await click('Yes, Delete My Data');
    expect(state.fetchBodies).toEqual([{ acknowledge_store_subscriptions: false }]);
    expect(app.textContent).toContain('Your subscription will keep billing');
    expect(app.textContent).toContain('This account has an active subscription billed by Apple.');
    await click('Manage in the App Store');
    expect(state.opened).toEqual(['store:ios:com.example.monthly']);
    state.fetchResponses.push({ status: 500, body: { error: 'Report erasure failed: synthetic', retry: true } });
    await click('Delete anyway — I’ll cancel my subscription myself');
    expect(state.fetchBodies).toEqual([{ acknowledge_store_subscriptions: false }, { acknowledge_store_subscriptions: true }]);
    // A failed deletion is surfaced, never reported as success.
    expect(app.textContent).toContain('Report erasure failed: synthetic');
  });
});
