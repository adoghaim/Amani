// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { axeViolations } from './components/axe.testkit';

/*
  The real App routing (BrowserRouter, ProtectedRoute, OnboardingGate, every
  boundary) with each page replaced by a stub, so a case can make one screen
  fail. Review F072: a screen that fails to render must have a way out, and
  leaving it must clear the error. Review F065: a profile that cannot be read
  must offer Try again instead of an endless spinner.
*/

const auth = vi.hoisted(() => ({
  user: { id: 'user-1' } as { id: string } | null,
  userProfile: null as Record<string, unknown> | null,
  loading: false,
  profileLoadFailed: false,
  refreshUserProfile: vi.fn(async () => {}),
}));
const fixture = vi.hoisted(() => ({ broken: new Set<string>() }));
const native = vi.hoisted(() => ({
  network: [] as ((status: { connected: boolean; connectionType: string }) => void)[],
  resume: [] as (() => void)[],
}));

vi.mock('./contexts/AuthContext', () => ({ useAuth: () => auth }));
vi.mock('./lib/native', () => ({
  isNative: () => false,
  onAppUrlOpen: () => () => {},
  onNetworkChange: (callback: (typeof native.network)[number]) => {
    native.network.push(callback);
    return () => { native.network = native.network.filter(c => c !== callback); };
  },
  onAppLifecycle: (handlers: { onResume: () => void }) => {
    native.resume.push(handlers.onResume);
    return () => { native.resume = native.resume.filter(c => c !== handlers.onResume); };
  },
}));
vi.mock('./components/UpdateGate', () => ({ UpdateGate: ({ children }: { children: ReactNode }) => {
  if (fixture.broken.has('UpdateGate')) throw new Error('synthetic failure outside any screen');
  return <>{children}</>;
} }));
vi.mock('./features/deviceLock/DeviceLockGate', () => ({ DeviceLockGate: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock('./lib/deviceLock', () => ({ deviceLock: { getState: () => ({ locked: false }) } }));
vi.mock('./features/consent/ConsentGate', () => ({ ConsentGate: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock('./features/consent/AdultsOnlyExit', () => ({ AdultsOnlyExit: () => null }));
vi.mock('./features/consent/ConsentSteps', () => ({ ADULTS_ONLY_PATH: '/adults-only' }));
vi.mock('./components/freemium/UploadGate', () => ({ UploadGate: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock('./components/FirstPartyEventsLifecycle', () => ({ FirstPartyEventsLifecycle: () => null, CampaignLinkRedirect: () => null }));
vi.mock('./pages/Landing', () => ({ Landing: () => <h1>Landing page</h1> }));
vi.mock('./pages/LoginPage', () => ({ LoginPage: () => <h1>Login page</h1> }));
vi.mock('./pages/SignupPage', () => ({ SignupPage: () => <h1>Signup page</h1> }));
function stub(name: string) {
  return function Page() {
    if (fixture.broken.has(name)) throw new Error(`synthetic ${name} render failure`);
    return <h1>{name} page</h1>;
  };
}
vi.mock('./pages/Dashboard', () => ({ Dashboard: stub('Dashboard') }));
vi.mock('./pages/Reports', () => ({ Reports: stub('Reports') }));
vi.mock('./pages/ReportView', () => ({ ReportView: stub('Report') }));
vi.mock('./pages/NotFound', () => ({ NotFound: stub('NotFound') }));
// A screen whose code cannot be fetched (offline, or a stale deploy).
vi.mock('./pages/Tracker', () => { throw new TypeError('Failed to fetch dynamically imported module'); });

import App from './App';
import { pageReload } from './lib/lazyWithRetry';

const ONBOARDED = { id: 'user-1', onboarding_completed: true, onboarding_skipped: false };

let root: Root;
let app: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  // The boundaries log what they catch; keep the run readable.
  vi.spyOn(console, 'error').mockImplementation(() => {});
  auth.user = { id: 'user-1' };
  auth.userProfile = { ...ONBOARDED };
  auth.loading = false;
  auth.profileLoadFailed = false;
  auth.refreshUserProfile.mockReset();
  auth.refreshUserProfile.mockImplementation(async () => {});
  fixture.broken.clear();
  native.network = [];
  native.resume = [];
  app = document.createElement('div');
  document.body.append(app);
  root = createRoot(app);
});
afterEach(async () => {
  await act(async () => root.unmount());
  app.remove();
  window.history.replaceState(null, '', '/');
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function settle() {
  for (let i = 0; i < 8; i++) await act(async () => { await new Promise(r => setTimeout(r, 0)); });
}
/** Opens the app at the last path; the earlier ones are history to go back to. */
async function openAt(...paths: string[]) {
  window.history.replaceState(null, '', paths[0]);
  for (const path of paths.slice(1)) window.history.pushState(null, '', path);
  await act(async () => root.render(<App />));
  await settle();
}
const heading = () => app.querySelector('h1')?.textContent ?? null;
const control = (label: string) => Array.from(app.querySelectorAll<HTMLElement>('button, a'))
  .find(el => el.textContent?.trim() === label) ?? null;
async function press(label: string) {
  const el = control(label);
  expect(el, label).not.toBeNull();
  await act(async () => { el!.click(); });
  await settle();
}

describe('a screen that fails to render (F072)', () => {
  it('shows the calm recovery screen with Try again and Go to dashboard, laid out like every gate', async () => {
    fixture.broken.add('Report');
    await openAt('/app', '/app/reports/r1');
    expect(heading()).toBe("We couldn't show this screen");
    expect(control('Try again')?.tagName).toBe('BUTTON');
    expect(control('Go to dashboard')).not.toBeNull();
    expect(app.querySelector('[role="status"]')?.textContent).toContain('Your reports and results are saved.');
    // DESIGN.md: never a centred screen; the 44px primary button.
    const main = app.querySelector('main')!;
    expect(`${main.className} ${(main.parentElement as HTMLElement).className}`).not.toMatch(/justify-center|items-center|text-center/);
    expect(control('Try again')!.className).toContain('min-h-[44px]');
    expect(app.textContent).not.toContain('Reload');
    expect(await axeViolations(app)).toEqual([]);
  });

  it('leaving the screen clears the error: Android back is navigate(-1)', async () => {
    fixture.broken.add('Report');
    await openAt('/app', '/app/reports/r1');
    expect(heading()).not.toBe('Report page');
    await act(async () => { window.history.back(); });
    await settle();
    expect(window.location.pathname).toBe('/app');
    expect(heading()).toBe('Dashboard page');
  });

  it('Go to dashboard opens the dashboard', async () => {
    fixture.broken.add('Report');
    await openAt('/app/reports/r1');
    await press('Go to dashboard');
    expect(window.location.pathname).toBe('/app');
    expect(heading()).toBe('Dashboard page');
  });

  it('Try again renders the screen again, which works once the cause has gone', async () => {
    fixture.broken.add('Report');
    await openAt('/app/reports/r1');
    await press('Try again');
    expect(heading()).toBe("We couldn't show this screen");
    fixture.broken.delete('Report');
    await press('Try again');
    expect(heading()).toBe('Report page');
    expect(window.location.pathname).toBe('/app/reports/r1');
  });

  it('on the dashboard itself, Go to dashboard tries it again', async () => {
    fixture.broken.add('Dashboard');
    await openAt('/app');
    expect(heading()).toBe("We couldn't show this screen");
    fixture.broken.delete('Dashboard');
    await press('Go to dashboard');
    expect(heading()).toBe('Dashboard page');
  });

  it("a screen whose code could not be fetched: Try again reloads, since React keeps a failed import's error", async () => {
    const reload = vi.spyOn(pageReload, 'reload').mockImplementation(() => {});
    await openAt('/app/tracker');
    expect(heading()).toBe("We couldn't show this screen");
    await press('Try again');
    expect(reload).toHaveBeenCalledOnce();
  });

  it('a failure outside any screen still offers Try again and the dashboard', async () => {
    fixture.broken.add('UpdateGate');
    await openAt('/app/reports/r1');
    expect(heading()).toBe("We couldn't show this screen");
    expect(control('Go to dashboard')?.getAttribute('href')).toBe('/app');
    fixture.broken.delete('UpdateGate');
    await press('Try again');
    expect(heading()).toBe('Report page');
  });
});

describe('a profile that could not be read (F065)', () => {
  it('shows a retry gate instead of an endless spinner', async () => {
    auth.userProfile = null;
    auth.profileLoadFailed = true;
    await openAt('/app');
    expect(heading()).toBe("We couldn't reach Amani");
    expect(app.textContent).toContain('Your reports are safe.');
    expect(app.querySelector('[aria-label="Loading"], .animate-spin')).toBeNull();
    expect(await axeViolations(app)).toEqual([]);
    await press('Try again');
    expect(auth.refreshUserProfile).toHaveBeenCalledOnce();
  });

  it('Try again shows that it is trying and cannot be pressed twice', async () => {
    auth.userProfile = null;
    auth.profileLoadFailed = true;
    let finish: () => void = () => {};
    auth.refreshUserProfile.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
    await openAt('/app');
    await press('Try again');
    expect((control('Try again') as HTMLButtonElement).disabled).toBe(true);
    await act(async () => { control('Try again')!.click(); });
    expect(auth.refreshUserProfile).toHaveBeenCalledOnce();
    await act(async () => { finish(); });
    await settle();
    expect((control('Try again') as HTMLButtonElement).disabled).toBe(false);
  });

  it('tries again by itself when the connection comes back and when she returns to the app', async () => {
    auth.userProfile = null;
    auth.profileLoadFailed = true;
    await openAt('/app');
    for (const listener of native.network) listener({ connected: false, connectionType: 'none' });
    await settle();
    expect(auth.refreshUserProfile).not.toHaveBeenCalled();
    for (const listener of native.network) listener({ connected: true, connectionType: 'wifi' });
    await settle();
    expect(auth.refreshUserProfile).toHaveBeenCalledTimes(1);
    for (const listener of native.resume) listener();
    await settle();
    expect(auth.refreshUserProfile).toHaveBeenCalledTimes(2);
  });

  it('a connection coming back while a read is under way does not start a second one', async () => {
    auth.userProfile = null;
    auth.profileLoadFailed = true;
    let finish: () => void = () => {};
    auth.refreshUserProfile.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
    await openAt('/app');
    for (const listener of native.network) listener({ connected: true, connectionType: 'wifi' });
    for (const listener of native.network) listener({ connected: true, connectionType: 'wifi' });
    for (const listener of native.resume) listener();
    await settle();
    expect(auth.refreshUserProfile).toHaveBeenCalledOnce();
    await act(async () => { finish(); });
    await settle();
    for (const listener of native.resume) listener();
    await settle();
    expect(auth.refreshUserProfile).toHaveBeenCalledTimes(2);
  });

  it('opens the screen once the read succeeds, and stops listening', async () => {
    auth.userProfile = null;
    auth.profileLoadFailed = true;
    auth.refreshUserProfile.mockImplementation(async () => {
      auth.userProfile = { ...ONBOARDED };
      auth.profileLoadFailed = false;
    });
    await openAt('/app');
    await press('Try again');
    await act(async () => root.render(<App />));
    await settle();
    expect(heading()).toBe('Dashboard page');
    expect(native.network).toEqual([]);
    expect(native.resume).toEqual([]);
  });

  it('while the profile is still loading it waits, as before', async () => {
    auth.userProfile = null;
    auth.profileLoadFailed = false;
    await openAt('/app');
    expect(app.querySelector('[role="status"]')?.textContent).toBe('Loading');
    expect(heading()).toBeNull();
  });
});
