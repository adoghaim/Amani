// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/*
  PK-INT-01 (D3, D25): Settings is the five D25 sections, each an ordered list
  of section components. The split from the single Settings.tsx was proven
  DOM-identical against main in the PK-INT-01 PR; these tests keep the page
  equal to its list, pin the D25 order, and pin the delete flow that moved into
  DeleteAccountSection.
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
vi.mock('../../../lib/native', () => ({
  openExternalUrl: vi.fn(async (url: string) => { state.opened.push(url); }),
  // PK-DEVICE-01's lock section: this page renders as the web, where it shows nothing.
  isNative: () => false,
  platform: () => 'web',
  checkBiometrics: async () => ({ available: false, kind: null, deviceSecure: false }),
  authenticateWithBiometrics: async () => ({ ok: false, reason: 'unavailable' }),
  setScreenshotsBlocked: async () => false,
}));
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
import { SETTINGS_SECTIONS, settingsOrderProblems } from './index';
import type { SettingsSection, SettingsSectionProps } from './types';
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
  it('pins the D25 order: five sections, each component once, Delete my data last', () => {
    expect(SETTINGS_SECTIONS.map(s => ({ section: s.id, title: s.title, entries: s.entries.map(e => e.id) }))).toMatchInlineSnapshot(`
      [
        {
          "entries": [
            "account-information",
          ],
          "section": "account",
          "title": "Account",
        },
        {
          "entries": [
            "personal-context",
          ],
          "section": "health-profile",
          "title": "Health profile",
        },
        {
          "entries": [
            "reminder-preferences",
          ],
          "section": "reminders",
          "title": "Reminders",
        },
        {
          "entries": [
            "data-privacy",
            "device-lock",
          ],
          "section": "privacy-security",
          "title": "Privacy & security",
        },
        {
          "entries": [
            "delete-my-data",
          ],
          "section": "your-data",
          "title": "Your data",
        },
      ]
    `);
    const components = SETTINGS_SECTIONS.flatMap(s => s.entries.map(e => e.Component));
    expect(new Set(components).size).toBe(components.length);
    expect(settingsOrderProblems(SETTINGS_SECTIONS)).toEqual([]);
  });

  it('the page is exactly its sections, in order: each component is that component rendered on its own', async () => {
    await render(<Settings />);
    const list = app.querySelector('.space-y-6')!;
    const sections = Array.from(list.children);
    expect(sections.map(s => [s.tagName, s.getAttribute('aria-label'), s.getAttribute('data-settings-section')])).toEqual(
      SETTINGS_SECTIONS.map(s => ['SECTION', s.title, s.id]),
    );
    for (const [index, { id, entries }] of SETTINGS_SECTIONS.entries()) {
      const children = Array.from(sections[index]!.children).map(child => child.outerHTML);
      const empty: string[] = [];
      let position = 0;
      for (const entry of entries) {
        const holder = document.createElement('div');
        const alone = createRoot(holder);
        await render(<entry.Component {...props} />, alone);
        if (entry.id === 'device-lock' && id === 'privacy-security') {
          expect(holder.innerHTML, entry.id).toBe('');
        } else {
          expect(holder.innerHTML, entry.id).not.toBe('');
          expect(children[position], entry.id).toBe(holder.innerHTML);
          position += 1;
        }
        if (holder.innerHTML === '') empty.push(entry.id);
        await act(async () => alone.unmount());
      }
      expect(empty, id).toEqual(id === 'privacy-security' ? ['device-lock'] : []);
      expect(children, id).toHaveLength(entries.length - empty.length);
    }
    // The cards and their headings are unchanged, in the same order.
    expect(Array.from(list.querySelectorAll('h2')).map(h => h.textContent?.trim()))
      .toEqual(['Account information', 'Reminder preferences', 'Data Privacy & Security', 'Delete my data']);
    expect(list.querySelector('[data-testid="personal-context"]')!.closest('section')!.getAttribute('aria-label')).toBe('Health profile');
    // Delete my data is the last thing on the page.
    const headings = Array.from(app.querySelectorAll('h1, h2, h3'));
    expect(headings[headings.length - 1]!.closest('section')!.getAttribute('data-settings-section')).toBe('your-data');
  });

  it('the order check fails on every way the D25 order can break', () => {
    const entry = (id: string) => ({ id, Component: DeleteAccountSection });
    const sections = (): SettingsSection[] => SETTINGS_SECTIONS.map(s => ({ ...s, entries: [...s.entries] }));
    const swapped = sections();
    [swapped[1], swapped[2]] = [swapped[2]!, swapped[1]!];
    expect(settingsOrderProblems(swapped).join('\n')).toMatch(/D25 is account, health-profile, reminders, privacy-security, your-data/);
    expect(settingsOrderProblems(sections().slice(0, 4)).join('\n')).toMatch(/D25 is/);
    const afterDelete = sections();
    afterDelete[4] = { ...afterDelete[4]!, entries: [...afterDelete[4]!.entries, entry('download-my-data')] };
    expect(settingsOrderProblems(afterDelete)).toEqual(['delete-my-data must be the last entry, in Your data']);
    const downloadFirst = sections();
    downloadFirst[4] = { ...downloadFirst[4]!, entries: [entry('download-my-data'), ...downloadFirst[4]!.entries] };
    expect(settingsOrderProblems(downloadFirst)).toEqual([]);
    const moved = sections();
    moved[3] = { ...moved[3]!, entries: [...moved[3]!.entries, entry('delete-my-data')] };
    moved[4] = { ...moved[4]!, entries: [entry('download-my-data')] };
    expect(settingsOrderProblems(moved)).toEqual(['delete-my-data must be the last entry, in Your data']);
    const twice = sections();
    twice[2] = { ...twice[2]!, entries: [...twice[2]!.entries, entry('account-information')] };
    expect(settingsOrderProblems(twice)).toEqual(['account-information is listed twice']);
    const empty = sections();
    empty[1] = { ...empty[1]!, entries: [] };
    expect(settingsOrderProblems(empty)).toEqual(['health-profile has no entries']);
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
