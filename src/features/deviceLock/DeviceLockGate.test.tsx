// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { axeViolations } from '../../components/axe.testkit';

/*
  PK-DEVICE-01 (D15, D16, D24): the lock screen in place of the app. Native
  plugins are mocked through src/lib/native; the controller is the real one.
*/

const env = vi.hoisted(() => ({
  native: true,
  results: [] as Array<{ ok: true } | { ok: false; reason: 'cancelled' | 'failed' | 'unavailable' }>,
  authCalls: 0,
  lifecycle: null as null | { onPause: () => void; onResume: () => void },
  signOuts: [] as unknown[],
  signOut: null as null | (() => Promise<{ error: unknown }>),
  auth: { user: { id: 'user-1' } as { id: string } | null, loading: false },
}));
vi.mock('../../lib/native', () => ({
  isNative: () => env.native,
  platform: () => (env.native ? 'ios' : 'web'),
  checkBiometrics: async () => ({ available: true, kind: 'faceId', deviceSecure: true }),
  authenticateWithBiometrics: async () => { env.authCalls += 1; return env.results.shift() ?? { ok: true }; },
  setScreenshotsBlocked: async () => true,
  onAppLifecycle: (handlers: { onPause: () => void; onResume: () => void }) => { env.lifecycle = handlers; return () => { env.lifecycle = null; }; },
}));
vi.mock('../../lib/runtimeConfig', () => ({ loadRuntimeConfig: async () => {}, isFeatureEnabled: () => true }));
vi.mock('../../lib/supabase', () => ({
  supabase: { auth: { signOut: async (options: unknown) => { env.signOuts.push(options); if (env.signOut) return env.signOut(); return { error: null }; } } },
}));
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => env.auth }));

let root: Root;
let app: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('__APP_RELEASE__', 'amani@1.0.7+abcdef0');
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.resetModules();
  localStorage.clear();
  env.native = true;
  env.results = [];
  env.authCalls = 0;
  env.signOuts = [];
  env.signOut = null;
  env.auth = { user: { id: 'user-1' }, loading: false };
  app = document.createElement('div');
  document.body.append(app);
  root = createRoot(app);
});
afterEach(async () => {
  await act(async () => root.unmount());
  app.remove();
  vi.unstubAllGlobals();
});

async function mount(settings: Record<string, unknown> | null, child: ReactNode = <p>Cycle day 14. Ferritin 12 ng/mL.</p>) {
  if (settings) localStorage.setItem('amani.device-lock.v1', JSON.stringify(settings));
  const { DeviceLockGate } = await import('./DeviceLockGate');
  const lockModule = await import('../../lib/deviceLock');
  await act(async () => root.render(<MemoryRouter><DeviceLockGate>{child}</DeviceLockGate></MemoryRouter>));
  await act(async () => {});
  return lockModule.deviceLock;
}
const text = () => app.textContent ?? '';
const button = (label: string) => Array.from(app.querySelectorAll('button')).find(b => b.textContent?.trim() === label);

describe('DeviceLockGate', () => {
  it('lock off: the app shows, and nothing asks for Face ID', async () => {
    await mount(null);
    expect(text()).toContain('Ferritin');
    expect(env.authCalls).toBe(0);
  });

  it('cold start with the lock on: the lock screen replaces the app and asks straight away', async () => {
    env.results = [{ ok: false, reason: 'cancelled' }];
    await mount({ enabled: true, relockAfter: '15m' });
    expect(app.querySelector('h1')!.textContent).toBe('Amani is locked');
    expect(env.authCalls).toBe(1);
    // The page underneath is not in the document at all.
    expect(text()).not.toContain('Ferritin');
  });

  it('never shows a cycle day, a health value or her name', async () => {
    env.results = [{ ok: false, reason: 'failed' }];
    await mount({ enabled: true });
    expect(text()).not.toMatch(/cycle|day \d|ng\/mL|ferritin|user-1|\d/i);
  });

  it('a successful scan opens the app', async () => {
    await mount({ enabled: true });
    expect(text()).toContain('Ferritin');
    expect(app.querySelector('h1')).toBeNull();
  });

  it('a failed scan stays locked with a calm notice; Unlock tries again', async () => {
    env.results = [{ ok: false, reason: 'failed' }];
    await mount({ enabled: true });
    const notice = app.querySelector('[role="status"]')!;
    expect(notice.getAttribute('aria-live')).toBe('polite');
    expect(notice.textContent).toContain("Amani didn't unlock.");
    await act(async () => button('Unlock')!.click());
    expect(env.authCalls).toBe(2);
    expect(text()).toContain('Ferritin');
  });

  it('Sign out uses local scope and releases the lock after authentication confirms sign-out', async () => {
    env.results = [{ ok: false, reason: 'failed' }];
    const lock = await mount({ enabled: true });
    await act(async () => button('Sign out')!.click());
    expect(env.signOuts).toEqual([{ scope: 'local' }]);
    // Model the AuthContext update delivered by SIGNED_OUT.
    env.auth = { user: null, loading: false };
    await mount(null);
    expect(lock.getState().locked).toBe(false);
  });

  it.each(['rejected', 'returned-error'] as const)('Sign out %s preserves the authenticated lock without exposing errors', async mode => {
    env.results = [{ ok: false, reason: 'failed' }];
    env.signOut = async () => {
      if (mode === 'rejected') throw new Error('synthetic secret storage failure');
      return { error: new Error('synthetic secret storage failure') };
    };
    const lock = await mount({ enabled: true });
    await act(async () => button('Sign out')!.click());
    expect(env.auth.user).not.toBeNull();
    expect(lock.getState().locked).toBe(true);
    expect(text()).not.toContain('Ferritin');
    expect(text()).not.toContain('synthetic secret');
    expect(text()).toContain("Amani couldn't sign out. Try again.");
  });

  it('pending sign-out and successful completion cannot unlock before the auth event', async () => {
    env.results = [{ ok: false, reason: 'failed' }];
    let finish!: (value: { error: null }) => void;
    env.signOut = () => new Promise(resolve => { finish = resolve; });
    const lock = await mount({ enabled: true });
    await act(async () => button('Sign out')!.click());
    expect(lock.getState().locked).toBe(true);
    expect(text()).not.toContain('Ferritin');
    await act(async () => finish({ error: null }));
    expect(lock.getState().locked).toBe(true);
    expect(text()).not.toContain('Ferritin');
    env.auth = { user: null, loading: false };
    await mount(null);
    expect(lock.getState().locked).toBe(false);
  });

  it('nobody signed in: no lock screen, and a later sign-in is not locked', async () => {
    env.auth = { user: null, loading: false };
    const lock = await mount({ enabled: true });
    expect(app.querySelector('h1')).toBeNull();
    expect(lock.getState().locked).toBe(false);
    expect(env.authCalls).toBe(0);
  });

  it('re-locks when she comes back after her re-lock time (D16)', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    await mount({ enabled: true, relockAfter: '1m' });
    expect(text()).toContain('Ferritin');
    env.results = [{ ok: false, reason: 'cancelled' }];
    await act(async () => env.lifecycle!.onPause());
    now.mockReturnValue(1_000_000 + 30_000);
    await act(async () => env.lifecycle!.onResume());
    expect(text()).toContain('Ferritin');
    await act(async () => env.lifecycle!.onPause());
    now.mockReturnValue(1_000_000 + 30_000 + 60_000);
    await act(async () => env.lifecycle!.onResume());
    expect(app.querySelector('h1')!.textContent).toBe('Amani is locked');
    now.mockRestore();
  });

  it('the web never locks', async () => {
    env.native = false;
    await mount({ enabled: true });
    expect(text()).toContain('Ferritin');
    expect(env.authCalls).toBe(0);
  });

  it('focus moves to the heading, and the lock screen passes axe (D23)', async () => {
    env.results = [{ ok: false, reason: 'failed' }];
    await mount({ enabled: true });
    expect(document.activeElement).toBe(app.querySelector('h1'));
    expect(await axeViolations(app)).toEqual([]);
  });
});

it('pre-1.0.7 native ignores a stored lock without registering lifecycle callbacks', async () => {
  vi.stubGlobal('__APP_RELEASE__', 'amani@1.0.6+abcdef0');
  env.lifecycle = null;
  const lock = await mount({ enabled: true, relockAfter: 'immediately' });
  expect(app.textContent).not.toContain('Amani is locked');
  expect(env.lifecycle).toBeNull();
  expect(env.authCalls).toBe(0);
  expect(lock).toBeDefined();
});
