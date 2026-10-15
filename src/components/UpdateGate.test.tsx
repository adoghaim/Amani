// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The default deps reach the Supabase client through runtimeConfig; these tests inject their own.
vi.mock('../lib/supabase', () => ({ supabase: { from: () => ({ select: async () => ({ data: [], error: null }) }) } }));

import { UPDATE_BANNER_DISMISSED_KEY, UpdateGate, type UpdateGateDeps } from './UpdateGate';
import type { NetworkStatus } from '../lib/native';
import { axeViolations } from './axe.testkit';

/*
  PK-MINVER-01 (EXP-8, R1, D8, D23, D24): the native minimum-version gate.
  Every native call and the runtime config are injected fakes, so these run
  with no Capacitor runtime and no network.
*/

interface Fake {
  deps: UpdateGateDeps;
  calls: string[];
  opened: string[];
  network: NetworkStatus;
  networkListeners: Array<(status: NetworkStatus) => void>;
  storage: Map<string, string>;
  backHeld: number;
}

function fake(options: {
  native?: boolean;
  platform?: 'ios' | 'android';
  installed?: { version: string; build: string } | null;
  min?: string | null;
  latest?: string | null;
  connected?: boolean;
  loadFails?: boolean;
  infoFails?: boolean;
  storageThrows?: boolean;
} = {}): Fake {
  const state: Fake = {
    calls: [], opened: [], networkListeners: [], storage: new Map(), backHeld: 0,
    network: { connected: options.connected ?? true, connectionType: 'wifi' },
    deps: undefined as unknown as UpdateGateDeps,
  };
  const platform = options.platform ?? 'ios';
  const installed = options.installed === undefined ? { version: '1.0.6', build: '8' } : options.installed;
  state.deps = {
    isNative: () => { state.calls.push('isNative'); return options.native ?? true; },
    getInstalledAppInfo: async () => {
      state.calls.push('getInstalledAppInfo');
      if (options.infoFails) throw new Error('synthetic plugin failure');
      return installed ? { platform, ...installed } : null;
    },
    loadRuntimeConfig: async () => {
      state.calls.push('loadRuntimeConfig');
      if (options.loadFails) throw new Error('synthetic read failure');
    },
    minVersion: p => { state.calls.push(`minVersion:${p}`); return options.min ?? null; },
    latestVersion: p => { state.calls.push(`latestVersion:${p}`); return options.latest ?? null; },
    getNetworkStatus: async () => { state.calls.push('getNetworkStatus'); return state.network; },
    onNetworkChange: callback => {
      state.networkListeners.push(callback);
      return () => { state.networkListeners = state.networkListeners.filter(l => l !== callback); };
    },
    openStoreListing: url => { state.opened.push(url); },
    exitAppOnBackButton: () => { state.backHeld += 1; return () => { state.backHeld -= 1; }; },
    storage: () => {
      if (options.storageThrows) throw new Error('storage blocked');
      return {
        getItem: (key: string) => state.storage.get(key) ?? null,
        setItem: (key: string, value: string) => { state.storage.set(key, value); },
      };
    },
  };
  return state;
}

let root: Root;
let app: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  app = document.createElement('div');
  document.body.append(app);
  root = createRoot(app);
});
afterEach(async () => {
  await act(async () => root.unmount());
  app.remove();
  vi.unstubAllGlobals();
});

const settle = async () => {
  for (let i = 0; i < 5; i += 1) await act(async () => { await Promise.resolve(); });
};
const render = async (deps: UpdateGateDeps, children: ReactNode = <p data-app="">The app</p>) => {
  await act(async () => root.render(<MemoryRouter><UpdateGate deps={deps}>{children}</UpdateGate></MemoryRouter>));
  await settle();
};
const appContent = () => app.querySelector('[data-app]');
const heading = () => app.querySelector('h1');
const button = (text: string) => Array.from(app.querySelectorAll('button')).find(b => b.textContent?.trim() === text);
const click = async (element: Element | undefined) => {
  if (!element) throw new Error('missing element');
  await act(async () => { (element as HTMLElement).click(); });
  await settle();
};

describe('the web app is never gated', () => {
  it('renders the app and calls nothing native and no config, whatever the config says', async () => {
    const state = fake({ native: false, min: '99.0.0', latest: '99.0.0' });
    await render(state.deps);
    expect(appContent()?.textContent).toBe('The app');
    expect(heading()).toBeNull();
    expect(app.querySelector('[data-update-banner]')).toBeNull();
    expect(state.calls).toEqual(['isNative']);
    expect(state.opened).toEqual([]);
    expect(state.backHeld).toBe(0);
  });
});

describe('fails open', () => {
  for (const [label, options] of [
    ['the runtime config read fails', { loadFails: true, min: '99.0.0' }],
    ['App.getInfo fails', { infoFails: true, min: '99.0.0' }],
    ['the installed version is unknown', { installed: null, min: '99.0.0' }],
    ['the installed version is malformed', { installed: { version: '1.0.6-beta', build: '8' }, min: '99.0.0' }],
    ['no minimum is set (the seed)', { min: null, latest: null }],
    ['the minimum is malformed', { min: 'two' }],
  ] as const) {
    it(`when ${label}: the app renders, with no block and no banner`, async () => {
      const state = fake(options);
      await render(state.deps);
      expect(appContent()?.textContent).toBe('The app');
      expect(heading()).toBeNull();
      expect(app.querySelector('[data-update-banner]')).toBeNull();
    });
  }

  it('renders the app while the launch read is still in flight', async () => {
    const state = fake({ min: '99.0.0' });
    let finish: () => void = () => {};
    state.deps.loadRuntimeConfig = () => new Promise<void>(resolve => { finish = resolve; });
    await render(state.deps);
    expect(appContent()).not.toBeNull();
    await act(async () => finish());
    await settle();
    expect(appContent()).toBeNull();
    expect(heading()?.textContent).toBe('Please update Amani');
  });
});

describe('below the minimum: the update block (D8 on FullScreenGate)', () => {
  it('replaces the whole app: heading, one sentence, one store button, focus on the heading', async () => {
    const state = fake({ min: '1.0.7' });
    await render(state.deps);
    expect(appContent()).toBeNull();
    expect(app.querySelectorAll('main')).toHaveLength(1);
    expect(heading()?.textContent).toBe('Please update Amani');
    expect(document.activeElement).toBe(heading());
    expect(app.querySelector('main p')?.textContent)
      .toBe('This version of Amani is no longer supported, and the latest one is ready in the App Store.');
    expect(Array.from(app.querySelectorAll('button, a')).map(el => el.textContent?.trim())).toEqual(['Update in the App Store']);
    expect(state.calls).toContain('minVersion:ios');
  });

  it('the store button opens the store listing (iOS, while the App Store id is [Pending])', async () => {
    const state = fake({ min: '1.0.7' });
    await render(state.deps);
    await click(button('Update in the App Store'));
    expect(state.opened).toEqual(['itms-apps://apps.apple.com/']);
  });

  it('Android: the Play listing for com.amani.health, and back closes the app while the block is up', async () => {
    const state = fake({ platform: 'android', installed: { version: '1.0.4', build: '7' }, min: '1.0.5' });
    await render(state.deps);
    expect(state.calls).toContain('minVersion:android');
    expect(state.backHeld).toBe(1);
    await click(button('Update on Google Play'));
    expect(state.opened).toEqual(['https://play.google.com/store/apps/details?id=com.amani.health']);
    await act(async () => root.unmount());
    expect(state.backHeld).toBe(0);
    root = createRoot(app);
  });

  it('the block wins over the banner', async () => {
    const state = fake({ min: '1.0.7', latest: '1.0.8' });
    await render(state.deps);
    expect(heading()?.textContent).toBe('Please update Amani');
    expect(app.querySelector('[data-update-banner]')).toBeNull();
  });

  it('is clean under axe (D23) and every control has a 44px target', async () => {
    const state = fake({ min: '1.0.7' });
    await render(state.deps);
    expect(await axeViolations(app)).toEqual([]);
    for (const control of app.querySelectorAll('button')) expect(control.className).toMatch(/min-h-\[44px\]/);
  });
});

describe('offline: "Connect to the internet to update" with Retry', () => {
  it('shows the offline state when there is no connection, and returns to the block when it comes back', async () => {
    const state = fake({ min: '1.0.7', connected: false });
    await render(state.deps);
    expect(heading()?.textContent).toBe('Connect to the internet to update');
    expect(document.activeElement).toBe(heading());
    expect(app.querySelector('main p')?.textContent).toBe('Amani needs a connection to open the App Store.');
    expect(Array.from(app.querySelectorAll('button, a')).map(el => el.textContent?.trim())).toEqual(['Retry']);
    expect(appContent()).toBeNull();
    expect(await axeViolations(app)).toEqual([]);

    // Retry while still offline: a polite calm notice, and still no way past.
    await click(button('Retry'));
    const notice = app.querySelector('[role="status"]');
    expect(notice?.getAttribute('aria-live')).toBe('polite');
    expect(notice?.textContent).toContain('Still no connection.');
    expect(state.opened).toEqual([]);

    // Retry once the connection is back: the block, focus on its heading.
    state.network = { connected: true, connectionType: 'wifi' };
    await click(button('Retry'));
    expect(heading()?.textContent).toBe('Please update Amani');
    expect(document.activeElement).toBe(heading());
  });

  it('follows connectivity changes while the block is up', async () => {
    const state = fake({ min: '1.0.7' });
    await render(state.deps);
    expect(heading()?.textContent).toBe('Please update Amani');
    await act(async () => state.networkListeners.forEach(l => l({ connected: false, connectionType: 'none' })));
    expect(heading()?.textContent).toBe('Connect to the internet to update');
    await act(async () => state.networkListeners.forEach(l => l({ connected: true, connectionType: 'wifi' })));
    expect(heading()?.textContent).toBe('Please update Amani');
  });

  it('pressing the store button offline shows the offline state instead of opening the store', async () => {
    const state = fake({ min: '1.0.7' });
    await render(state.deps);
    state.network = { connected: false, connectionType: 'none' };
    await click(button('Update in the App Store'));
    expect(state.opened).toEqual([]);
    expect(heading()?.textContent).toBe('Connect to the internet to update');
  });
});

describe('a newer version, not required: the dismissible banner (D8)', () => {
  it('shows above the app, politely announced, with Update and Not now', async () => {
    const state = fake({ min: '1.0.6', latest: '1.0.7' });
    await render(state.deps);
    expect(appContent()?.textContent).toBe('The app');
    const banner = app.querySelector('[data-update-banner]')!;
    expect(banner.getAttribute('role')).toBe('status');
    expect(banner.getAttribute('aria-live')).toBe('polite');
    expect(banner.textContent).toContain('A new version of Amani is available in the App Store.');
    expect(banner.compareDocumentPosition(appContent()!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // It never takes focus from the app.
    expect(document.activeElement).toBe(document.body);
    expect(await axeViolations(app)).toEqual([]);
    for (const control of banner.querySelectorAll('button')) expect(control.className).toMatch(/min-h-\[44px\]/);
    // Mauve is never text on a tint (DESIGN.md): the banner's text is ink.
    expect(banner.innerHTML).not.toMatch(/text-theme-primary/);

    await click(button('Update'));
    expect(state.opened).toEqual(['itms-apps://apps.apple.com/']);
    expect(app.querySelector('[data-update-banner]')).not.toBeNull();
  });

  it('Not now hides it and remembers that version on this phone; a newer one shows again', async () => {
    const state = fake({ min: null, latest: '1.0.7' });
    await render(state.deps);
    await click(button('Not now'));
    expect(app.querySelector('[data-update-banner]')).toBeNull();
    expect(appContent()?.textContent).toBe('The app');
    expect(state.storage.get(UPDATE_BANNER_DISMISSED_KEY)).toBe('1.0.7');

    await act(async () => root.unmount());
    root = createRoot(app);
    await render(state.deps);
    expect(app.querySelector('[data-update-banner]')).toBeNull();

    const newer = fake({ min: null, latest: '1.0.8' });
    newer.storage.set(UPDATE_BANNER_DISMISSED_KEY, '1.0.7');
    await act(async () => root.unmount());
    root = createRoot(app);
    await render(newer.deps);
    expect(app.querySelector('[data-update-banner]')).not.toBeNull();
  });

  it('storage that throws still lets her dismiss it for this launch', async () => {
    const state = fake({ min: null, latest: '1.0.7', storageThrows: true });
    await render(state.deps);
    expect(app.querySelector('[data-update-banner]')).not.toBeNull();
    await click(button('Not now'));
    expect(app.querySelector('[data-update-banner]')).toBeNull();
  });

  it('no banner when she is on the latest version', async () => {
    const state = fake({ min: null, latest: '1.0.6' });
    await render(state.deps);
    expect(app.querySelector('[data-update-banner]')).toBeNull();
  });
});
