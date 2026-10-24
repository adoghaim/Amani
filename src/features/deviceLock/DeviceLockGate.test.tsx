// @vitest-environment jsdom
import { act, useState, type ReactNode } from 'react';
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
  // What supabase.auth.getSession() resolves to, or throws; null: the session matches env.auth.
  session: null as null | { data: { session: unknown }; error: unknown },
  sessionThrows: false,
  authListener: null as null | ((event: string) => void),
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
  supabase: {
    auth: {
      signOut: async (options: unknown) => { env.signOuts.push(options); if (env.signOut) return env.signOut(); return { error: null }; },
      getSession: async () => {
        if (env.sessionThrows) throw new Error('synthetic storage failure');
        return env.session ?? { data: { session: env.auth.user ? { user: env.auth.user } : null }, error: null };
      },
      onAuthStateChange: (listener: (event: string) => void) => {
        env.authListener = listener;
        return { data: { subscription: { unsubscribe: () => { env.authListener = null; } } } };
      },
    },
  },
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
  env.session = null;
  env.sessionThrows = false;
  env.authListener = null;
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

/** Stands in for NewReport: a photo she has added lives only in component state. */
function Draft() {
  const [photo, setPhoto] = useState<string | null>(null);
  return (
    <div>
      <p>Ferritin 12 ng/mL</p>
      <button type="button" onClick={() => setPhoto('lab-photo.jpg')}>Add photo</button>
      {photo && <p>Draft: {photo}</p>}
    </div>
  );
}

const appLayer = () => app.querySelector<HTMLElement>('[data-device-lock-app]');
const cover = () => app.querySelector<HTMLElement>('[data-device-lock-cover]');

async function goAway(now: { mockReturnValue: (value: number) => unknown }, from: number, away: number) {
  await act(async () => env.lifecycle!.onPause());
  now.mockReturnValue(from + away);
  await act(async () => env.lifecycle!.onResume());
}

describe('review F000: the cold-start lock is dropped only on a definite sign-out', () => {
  it('offline cold start: no user while the stored session cannot be refreshed, then the same session comes back -> still locked', async () => {
    env.auth = { user: null, loading: false };
    env.session = { data: { session: null }, error: Object.assign(new Error('synthetic fetch failure'), { name: 'AuthRetryableFetchError' }) };
    const lock = await mount({ enabled: true, relockAfter: '1m' });
    expect(app.querySelector('h1')).toBeNull();
    // TOKEN_REFRESHED / SIGNED_IN for the same user once the network is back.
    env.results = [{ ok: false, reason: 'cancelled' }];
    env.auth = { user: { id: 'user-1' }, loading: false };
    env.session = null;
    await mount(null);
    expect(lock.getState().locked).toBe(true);
    expect(app.querySelector('h1')!.textContent).toBe('Amani is locked');
    expect(text()).not.toContain('Ferritin');
  });

  it('reading the session throws: still locked when the user comes back', async () => {
    env.auth = { user: null, loading: false };
    env.sessionThrows = true;
    const lock = await mount({ enabled: true });
    env.results = [{ ok: false, reason: 'cancelled' }];
    env.auth = { user: { id: 'user-1' }, loading: false };
    env.sessionThrows = false;
    await mount(null);
    expect(lock.getState().locked).toBe(true);
    expect(app.querySelector('h1')!.textContent).toBe('Amani is locked');
  });

  it('SIGNED_OUT drops the lock, so the next sign-in with her email and password is not locked', async () => {
    env.auth = { user: null, loading: false };
    env.session = { data: { session: null }, error: new Error('synthetic fetch failure') };
    const lock = await mount({ enabled: true });
    expect(lock.getState().locked).toBe(true);
    await act(async () => env.authListener!('SIGNED_OUT'));
    expect(lock.getState().locked).toBe(false);
    env.auth = { user: { id: 'user-2' }, loading: false };
    env.session = null;
    await mount(null);
    expect(text()).toContain('Ferritin');
    expect(env.authCalls).toBe(0);
  });

  it('no stored session and no error: the lock is dropped and a later sign-in is not locked', async () => {
    env.auth = { user: null, loading: false };
    const lock = await mount({ enabled: true });
    expect(lock.getState().locked).toBe(false);
    env.auth = { user: { id: 'user-2' }, loading: false };
    await mount(null);
    expect(text()).toContain('Ferritin');
    expect(env.authCalls).toBe(0);
  });
});

describe('review F001: a re-lock keeps what she was doing', () => {
  it('a photo added before a re-lock is still there after unlocking', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    await mount({ enabled: true, relockAfter: '1m' }, <Draft />);
    await act(async () => button('Add photo')!.click());
    expect(text()).toContain('Draft: lab-photo.jpg');
    env.results = [{ ok: false, reason: 'cancelled' }];
    await goAway(now, 1_000_000, 60_000);
    expect(app.querySelector('h1')!.textContent).toBe('Amani is locked');
    await act(async () => button('Unlock')!.click());
    expect(app.querySelector('h1')).toBeNull();
    expect(text()).toContain('Draft: lab-photo.jpg');
    now.mockRestore();
  });

  it("'Immediately' and an Android camera round trip: the photo survives", async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    await mount({ enabled: true, relockAfter: 'immediately' }, <Draft />);
    await act(async () => env.lifecycle!.onPause()); // the camera activity opens
    await act(async () => button('Add photo')!.click()); // the photo arrives
    now.mockReturnValue(1_000_000 + 5_000);
    await act(async () => env.lifecycle!.onResume());
    await act(async () => {});
    expect(app.querySelector('h1')).toBeNull();
    expect(text()).toContain('Draft: lab-photo.jpg');
    now.mockRestore();
  });

  it('while re-locked, the app underneath is invisible and inert, and so is any dialog outside the app', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    await mount({ enabled: true, relockAfter: '1m' });
    const dialog = document.createElement('div');
    dialog.textContent = 'Delete this report?';
    document.body.append(dialog);
    env.results = [{ ok: false, reason: 'cancelled' }];
    await goAway(now, 1_000_000, 60_000);
    expect(app.querySelector('h1')!.textContent).toBe('Amani is locked');
    expect(appLayer()!.style.visibility).toBe('hidden');
    expect(appLayer()!.hasAttribute('inert')).toBe(true);
    expect(appLayer()!.getAttribute('aria-hidden')).toBe('true');
    expect(dialog.hasAttribute('inert')).toBe(true);
    expect(dialog.getAttribute('aria-hidden')).toBe('true');
    expect(cover()!.className).toContain('bg-theme-background');
    expect(cover()!.className).toContain('fixed inset-0');
    // The lock screen itself is not hidden.
    expect(app.querySelector('h1')!.closest('[inert]')).toBeNull();
    expect(await axeViolations(cover()!)).toEqual([]);
    env.results = [{ ok: true }];
    await act(async () => button('Unlock')!.click());
    expect(appLayer()!.style.visibility).toBe('');
    expect(appLayer()!.hasAttribute('inert')).toBe(false);
    expect(dialog.hasAttribute('inert')).toBe(false);
    expect(dialog.hasAttribute('aria-hidden')).toBe(false);
    dialog.remove();
    now.mockRestore();
  });

  it('a dialog outside the app is invisible under the lock, including one that opens while locked', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    await mount({ enabled: true, relockAfter: '1m' });
    const before = document.createElement('div');
    before.textContent = 'Delete this report?';
    document.body.append(before);
    env.results = [{ ok: false, reason: 'cancelled' }];
    await goAway(now, 1_000_000, 60_000);
    expect(before.style.visibility).toBe('hidden');
    // An upload finishes under the lock and its dialog opens.
    const later = document.createElement('div');
    later.textContent = 'Your report is ready';
    await act(async () => { document.body.append(later); });
    expect(later.hasAttribute('inert')).toBe(true);
    expect(later.getAttribute('aria-hidden')).toBe('true');
    expect(later.style.visibility).toBe('hidden');
    env.results = [{ ok: true }];
    await act(async () => button('Unlock')!.click());
    for (const element of [before, later]) {
      expect(element.hasAttribute('inert')).toBe(false);
      expect(element.hasAttribute('aria-hidden')).toBe(false);
      expect(element.style.visibility).toBe('');
      element.remove();
    }
    now.mockRestore();
  });
});

describe('review F002: covered as soon as she leaves', () => {
  it('lock on: an opaque cover on pause; a return within the re-lock time shows the app again', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    await mount({ enabled: true, relockAfter: '1m' });
    await act(async () => env.lifecycle!.onPause());
    expect(cover()).not.toBeNull();
    expect(appLayer()!.style.visibility).toBe('hidden');
    expect(appLayer()!.hasAttribute('inert')).toBe(true);
    now.mockReturnValue(1_000_000 + 30_000);
    await act(async () => env.lifecycle!.onResume());
    expect(cover()).toBeNull();
    expect(appLayer()!.style.visibility).toBe('');
    expect(text()).toContain('Ferritin');
    now.mockRestore();
  });

  it("'Immediately': the lock screen is up before she is back, and asks only once she returns", async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    await mount({ enabled: true, relockAfter: 'immediately' });
    const asked = env.authCalls;
    await act(async () => env.lifecycle!.onPause());
    expect(app.querySelector('h1')!.textContent).toBe('Amani is locked');
    expect(env.authCalls).toBe(asked);
    env.results = [{ ok: false, reason: 'cancelled' }];
    await act(async () => env.lifecycle!.onResume());
    await act(async () => {});
    expect(env.authCalls).toBe(asked + 1);
    expect(app.querySelector('h1')!.textContent).toBe('Amani is locked');
    now.mockRestore();
  });

  it('lock off: no cover', async () => {
    await mount(null);
    await act(async () => env.lifecycle!.onPause());
    expect(cover()).toBeNull();
    expect(text()).toContain('Ferritin');
  });

  it('defines the function iOS waits on before removing its cover, and removes it on unmount', async () => {
    await mount({ enabled: true });
    expect(typeof (window as unknown as Record<string, unknown>).amaniPrivacyCoverReady).toBe('function');
    await act(async () => root.unmount());
    expect((window as unknown as Record<string, unknown>).amaniPrivacyCoverReady).toBeUndefined();
    root = createRoot(app);
  });
});

describe('review F009: no stale sign-out message', () => {
  it('a sign-out whose revocation failed but whose local session is gone says nothing, then or after the next sign-in', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    env.results = [{ ok: false, reason: 'failed' }];
    env.signOut = async () => {
      // auth-js removes the local session and fires SIGNED_OUT, then returns the revocation error.
      env.auth = { user: null, loading: false };
      return { error: new Error('synthetic network failure') };
    };
    await mount({ enabled: true, relockAfter: '1m' });
    await act(async () => button('Sign out')!.click());
    expect(text()).not.toContain("couldn't sign out");
    await act(async () => env.authListener!('SIGNED_OUT'));
    await mount(null);
    // She signs in again (a fresh sign-in is not locked), then the app re-locks.
    env.signOut = null;
    env.auth = { user: { id: 'user-2' }, loading: false };
    await mount(null);
    expect(text()).toContain('Ferritin');
    env.results = [{ ok: false, reason: 'cancelled' }];
    await goAway(now, 1_000_000, 61_000);
    expect(app.querySelector('h1')!.textContent).toBe('Amani is locked');
    expect(text()).not.toContain("couldn't sign out");
    now.mockRestore();
  });

  it('a failure message from a session that was still there is cleared once she is signed out', async () => {
    env.results = [{ ok: false, reason: 'failed' }];
    env.signOut = async () => ({ error: new Error('synthetic storage failure') });
    await mount({ enabled: true });
    await act(async () => button('Sign out')!.click());
    expect(text()).toContain("Amani couldn't sign out. Try again.");
    env.signOut = null;
    env.auth = { user: null, loading: false };
    await act(async () => env.authListener!('SIGNED_OUT'));
    await mount(null);
    env.auth = { user: { id: 'user-1' }, loading: false };
    const lock = await mount(null);
    expect(lock.getState().locked).toBe(false);
    env.results = [{ ok: false, reason: 'cancelled' }];
    const now = vi.spyOn(Date, 'now').mockReturnValue(5_000_000);
    await goAway(now, 5_000_000, 60_000);
    expect(app.querySelector('h1')!.textContent).toBe('Amani is locked');
    expect(text()).not.toContain("couldn't sign out");
    now.mockRestore();
  });
});
