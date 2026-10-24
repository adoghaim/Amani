// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/*
  E2E-REDIRECT-RACE (review F117). The login redirect target and the
  protected-route return path must come from the router's location, not from
  window.location: the router commits a navigation inside a transition, so
  while the next screen's code is still loading, window.location already holds
  the new URL and the screen on show still belongs to the old one.

  The MemoryRouter cases make the two locations differ on purpose. The App case
  reproduces the race itself: a signed-in visitor on /login?redirect=… is sent
  on, the target screen is still loading, and an auth update re-renders the
  routes in the meantime.
*/

type AuthState = {
  user: { id: string } | null;
  userProfile: Record<string, unknown> | null;
  loading: boolean;
  profileLoadFailed: boolean;
  refreshUserProfile: () => Promise<void>;
};
const auth = vi.hoisted(() => {
  const signedOut = (): AuthState => ({
    user: null,
    userProfile: null,
    loading: false,
    profileLoadFailed: false,
    refreshUserProfile: async () => {},
  });
  let state = signedOut();
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    set: (patch: Partial<AuthState>) => { state = { ...state, ...patch }; listeners.forEach(l => l()); },
    reset: () => { state = signedOut(); },
  };
});
// The billing screen's code stays "in flight" until the App case releases it.
const billingChunk = vi.hoisted(() => {
  let release: () => void = () => {};
  const ready = new Promise<void>(resolve => { release = resolve; });
  return { ready, release: () => release() };
});

vi.mock('./contexts/AuthContext', async () => {
  const { useSyncExternalStore } = await import('react');
  return { useAuth: () => useSyncExternalStore(auth.subscribe, auth.get) };
});
vi.mock('./lib/native', () => ({
  isNative: () => false,
  onAppUrlOpen: () => () => {},
  onNetworkChange: () => () => {},
  onAppLifecycle: () => () => {},
}));
vi.mock('./components/UpdateGate', () => ({ UpdateGate: ({ children }: { children: ReactNode }) => <>{children}</> }));
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
vi.mock('./pages/Dashboard', () => ({ Dashboard: () => <h1>Dashboard page</h1> }));
vi.mock('./pages/Reports', () => ({ Reports: () => <h1>Reports page</h1> }));
vi.mock('./pages/Settings', () => ({ Settings: () => <h1>Settings page</h1> }));
vi.mock('./pages/NotFound', () => ({ NotFound: () => <h1>NotFound page</h1> }));
vi.mock('./pages/Billing', async () => {
  await billingChunk.ready;
  return { Billing: () => <h1>Billing page</h1> };
});

import App, { AppRoutes } from './App';

const ONBOARDED = { id: 'user-1', onboarding_completed: true, onboarding_skipped: false };
const signIn = () => auth.set({ user: { id: 'user-1' }, userProfile: { ...ONBOARDED } });

let root: Root;
let app: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  auth.reset();
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
const heading = () => app.querySelector('h1')?.textContent ?? null;

function Where() {
  const location = useLocation();
  return <output data-testid="where">{location.pathname + location.search}</output>;
}
const where = () => app.querySelector('[data-testid="where"]')?.textContent ?? null;

/** The routes under a router whose location is `start`, while window.location says `windowUrl`. */
async function openRoutesAt(start: string, windowUrl = '/elsewhere?redirect=%2Fapp%2Fsettings') {
  window.history.replaceState(null, '', windowUrl);
  await act(async () => root.render(
    <MemoryRouter key={start} initialEntries={[start]}>
      <AppRoutes />
      <Where />
    </MemoryRouter>,
  ));
  await settle();
}

describe('login and signup send a signed-in visitor to the router-aware redirect target', () => {
  it('signing in on /login?redirect=%2Fapp%2Freports lands on /app/reports', async () => {
    await openRoutesAt('/login?redirect=%2Fapp%2Freports');
    expect(heading()).toBe('Login page');
    await act(async () => signIn());
    await settle();
    expect(where()).toBe('/app/reports');
    expect(heading()).toBe('Reports page');
  });

  it('a visitor already signed in at /signup?redirect=%2Fapp%2Freports lands on /app/reports', async () => {
    signIn();
    await openRoutesAt('/signup?redirect=%2Fapp%2Freports');
    expect(where()).toBe('/app/reports');
    expect(heading()).toBe('Reports page');
  });

  it('with no redirect parameter she lands on the default target, /app', async () => {
    await openRoutesAt('/login');
    await act(async () => signIn());
    await settle();
    expect(where()).toBe('/app');
    expect(heading()).toBe('Dashboard page');
  });

  it('an unsafe redirect is still clamped to /app by safeRedirectTarget', async () => {
    for (const unsafe of ['%2F%2Fevil.com', 'https%3A%2F%2Fevil.com', '%2F%5Cevil.com', '%2F%40evil.com']) {
      auth.reset();
      await openRoutesAt(`/login?redirect=${unsafe}`, '/');
      expect(where(), unsafe).toBe(`/login?redirect=${unsafe}`);
      await act(async () => signIn());
      await settle();
      expect(where(), unsafe).toBe('/app');
    }
  });
});

describe('a protected route sends a signed-out visitor to login with the router-aware return path', () => {
  it('/app/reports goes to /login?redirect=%2Fapp%2Freports', async () => {
    await openRoutesAt('/app/reports');
    expect(where()).toBe('/login?redirect=%2Fapp%2Freports');
    expect(heading()).toBe('Login page');
  });

  it('keeps the query string in the return path', async () => {
    await openRoutesAt('/app/reports?tab=all');
    expect(where()).toBe('/login?redirect=%2Fapp%2Freports%3Ftab%3Dall');
  });
});

describe('the redirect race in the real App (BrowserRouter)', () => {
  it('an auth update while the target screen is still loading does not divert her to /app', async () => {
    window.history.replaceState(null, '', '/login?redirect=%2Fapp%2Fbilling');
    await act(async () => root.render(<App />));
    await settle();
    expect(heading()).toBe('Login page');

    await act(async () => signIn());
    await settle();
    // The navigation is under way: window.location already says /app/billing,
    // while the billing screen's code is still loading.
    expect(window.location.pathname).toBe('/app/billing');

    // Her profile arrives (a fresh object), re-rendering the routes meanwhile.
    await act(async () => auth.set({ userProfile: { ...ONBOARDED } }));
    await settle();

    billingChunk.release();
    await settle();
    expect(window.location.pathname).toBe('/app/billing');
    expect(heading()).toBe('Billing page');
  });
});
