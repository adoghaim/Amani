// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/*
  F137 (review 2026-10-23, owner ruling D7.7): nothing delivers a reminder, so the
  Reminders section stays hidden until features.local_reminders is switched on,
  and "Saved" appears only after supabase-js answers without an { error }.
*/

const state = vi.hoisted(() => ({
  flags: new Set<string>(),
  reads: 0,
  writeResult: { data: null as unknown, error: null as unknown },
  writes: [] as string[],
}));
const auth = vi.hoisted(() => ({
  user: { id: 'user-1', email: 'synthetic@example.invalid' },
  userProfile: { created_at: '2026-01-01T00:00:00.000Z', subscription_status: 'active' },
}));
vi.mock('../../../contexts/AuthContext', () => ({ useAuth: () => auth }));
vi.mock('../../../components/Layout', () => ({ Layout: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock('../PersonalContextCard', () => ({ PersonalContextCard: () => null }));
vi.mock('../../../lib/native', () => ({
  openExternalUrl: vi.fn(),
  isNative: () => false,
  platform: () => 'web',
  checkBiometrics: async () => ({ available: false, kind: null, deviceSecure: false }),
  authenticateWithBiometrics: async () => ({ ok: false, reason: 'unavailable' }),
  setScreenshotsBlocked: async () => false,
}));
vi.mock('../../../lib/iap', () => ({ storeSubscriptionsUrl: vi.fn() }));
vi.mock('../../../lib/runtimeConfig', () => ({
  isFeatureEnabled: (name: string) => state.flags.has(name),
  loadRuntimeConfig: async () => {},
}));
vi.mock('../../../lib/supabase', () => ({
  supabase: {
    from: () => {
      const query: Record<string, unknown> = {
        select: () => query,
        eq: () => query,
        maybeSingle: async () => {
          state.reads += 1;
          return { data: null, error: null };
        },
        single: async () => state.writeResult,
        update: () => {
          state.writes.push('update');
          return { eq: async () => state.writeResult };
        },
        insert: () => {
          state.writes.push('insert');
          return query;
        },
      };
      return query;
    },
  },
}));
import { Settings } from '../../../pages/Settings';
import { RemindersSection } from './RemindersSection';
import type { SettingsSectionProps } from './types';

let root: Root;
let app: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  state.flags = new Set();
  state.reads = 0;
  state.writes = [];
  state.writeResult = { data: null, error: null };
  app = document.createElement('div');
  document.body.append(app);
  root = createRoot(app);
});
afterEach(async () => {
  await act(async () => root.unmount());
  app.remove();
  vi.unstubAllGlobals();
});

const props = auth as unknown as SettingsSectionProps;
const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
async function render(node: ReactNode) {
  await act(async () => root.render(<MemoryRouter>{node}</MemoryRouter>));
  await act(async () => {});
}
const save = async () => {
  const button = Array.from(app.querySelectorAll('button')).find(b => norm(b.textContent) === 'Save preferences');
  expect(button).toBeTruthy();
  await act(async () => button!.click());
  await act(async () => {});
};

describe('F137: reminders are hidden until features.local_reminders is on', () => {
  it('renders nothing, and reads nothing, while the flag is off (missing key)', async () => {
    await render(<RemindersSection {...props} />);
    expect(app.innerHTML).toBe('');
    expect(state.reads).toBe(0);
  });

  it('the Settings page shows no Reminders content and hides the empty region while the flag is off', async () => {
    await render(<Settings />);
    expect(norm(app.textContent)).not.toMatch(/Reminder|Get notified|Save preferences/);
    const region = app.querySelector('[data-settings-section="reminders"]')!;
    expect(region.childElementCount).toBe(0);
    expect(region.className).toContain('empty:hidden');
    // The other D25 sections are still there.
    const shown = Array.from(app.querySelectorAll('[data-settings-section]'))
      .filter(s => s.childElementCount > 0)
      .map(s => s.getAttribute('data-settings-section'));
    expect(shown).toEqual(['account', 'privacy-security', 'your-data']);
  });

  it('shows the card once the flag is on', async () => {
    state.flags.add('local_reminders');
    await render(<RemindersSection {...props} />);
    expect(norm(app.textContent)).toContain('Reminder preferences');
    expect(state.reads).toBe(1);
  });
});

describe('F137: "Saved" only after the save succeeded', () => {
  beforeEach(() => { state.flags.add('local_reminders'); });

  it('first save (insert) with an error says it could not save, and never "Saved"', async () => {
    state.writeResult = { data: null, error: { message: 'permission denied for table notification_preferences' } };
    await render(<RemindersSection {...props} />);
    await save();
    expect(state.writes).toEqual(['insert']);
    expect(norm(app.textContent)).not.toContain('Saved');
    expect(app.querySelector('[role="alert"]')?.textContent).toContain('couldn’t save your preferences');
  });

  it('a successful save (insert) says Saved and no failure', async () => {
    state.writeResult = { data: { id: 'row-1', user_id: 'user-1' }, error: null };
    await render(<RemindersSection {...props} />);
    await save();
    expect(norm(app.textContent)).toContain('Saved');
    expect(app.querySelector('[role="alert"]')).toBeNull();
  });

  it('a later save (update) that returns an error does not say Saved, and a retry that succeeds clears the failure', async () => {
    state.writeResult = { data: { id: 'row-1', user_id: 'user-1' }, error: null };
    await render(<RemindersSection {...props} />);
    await save();
    expect(state.writes).toEqual(['insert']);
    state.writeResult = { data: null, error: { message: 'network' } };
    await save();
    expect(state.writes).toEqual(['insert', 'update']);
    expect(app.querySelector('[role="alert"]')).not.toBeNull();
    expect(norm(app.textContent)).not.toContain('Saved');
    state.writeResult = { data: null, error: null };
    await save();
    expect(state.writes).toEqual(['insert', 'update', 'update']);
    expect(app.querySelector('[role="alert"]')).toBeNull();
    expect(norm(app.textContent)).toContain('Saved');
  });
});
