// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, useLocation, useNavigate, type Location, type NavigateFunction } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ResetPassword } from './ResetPassword';

// Synthetic values only. The tokens are opaque strings to the page.
const SESSION = { access_token: 'synthetic-access', refresh_token: 'synthetic-refresh', user: { id: 'synthetic' } };
const RECOVERY_HASH = '#access_token=synthetic-access&expires_in=3600&refresh_token=synthetic-refresh&token_type=bearer&type=recovery';

const auth = vi.hoisted(() => ({
  storageKey: 'sb-synthetic-auth-token',
  storage: { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() },
  getSession: vi.fn(),
  setSession: vi.fn(),
  verifyOtp: vi.fn(),
  exchangeCodeForSession: vi.fn(),
  updateUser: vi.fn(),
  signOut: vi.fn(),
}));
vi.mock('../lib/supabase', () => ({ supabase: { auth } }));
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ resetPassword: vi.fn() }) }));

let root: Root;
let container: HTMLDivElement;
let navigate: NavigateFunction;

function CaptureNavigate() {
  navigate = useNavigate();
  return null;
}

async function render(entry: string) {
  await act(async () => root.render(
    <MemoryRouter initialEntries={[entry]}>
      <CaptureNavigate />
      <ResetPassword />
    </MemoryRouter>,
  ));
}

const text = () => container.textContent ?? '';

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  auth.getSession.mockResolvedValue({ data: { session: null }, error: null });
  auth.setSession.mockResolvedValue({ data: { session: SESSION, user: SESSION.user }, error: null });
  auth.verifyOtp.mockResolvedValue({ data: { session: SESSION, user: SESSION.user }, error: null });
  auth.exchangeCodeForSession.mockResolvedValue({ data: { session: SESSION, user: SESSION.user }, error: null });
  auth.storage.getItem.mockReturnValue(null);
  container = document.createElement('div');
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

it('F063: a recovery link routed in client-side (native deep link) becomes a session and shows the new-password form', async () => {
  await render('/reset-password');
  expect(text()).toContain('Reset your password');

  await act(async () => navigate(`/reset-password${RECOVERY_HASH}`, { replace: true }));

  expect(auth.setSession).toHaveBeenCalledWith({ access_token: 'synthetic-access', refresh_token: 'synthetic-refresh' });
  expect(text()).toContain('Set new password');
});

it('F063: a recovery hash present at mount is turned into a session', async () => {
  await render(`/reset-password${RECOVERY_HASH}`);
  expect(auth.setSession).toHaveBeenCalledOnce();
  expect(text()).toContain('Set new password');
});

it('F063: a recovery hash whose tokens are rejected falls back to the request form', async () => {
  auth.setSession.mockResolvedValue({ data: { session: null, user: null }, error: { message: 'invalid' } });
  await render(`/reset-password${RECOVERY_HASH}`);
  expect(text()).toContain('Reset your password');
});

it('F063: a token_hash recovery link is verified with verifyOtp({ type: "recovery" })', async () => {
  await render('/reset-password?token_hash=synthetic-hash&type=recovery');
  expect(auth.verifyOtp).toHaveBeenCalledWith({ token_hash: 'synthetic-hash', type: 'recovery' });
  expect(text()).toContain('Set new password');
});

it('F063: a ?code= is not exchanged when this device holds no PKCE verifier', async () => {
  await render('/reset-password?code=synthetic-code');
  expect(auth.storage.getItem).toHaveBeenCalledWith('sb-synthetic-auth-token-code-verifier');
  expect(auth.exchangeCodeForSession).not.toHaveBeenCalled();
  expect(text()).toContain('Reset your password');
});

it('F063: a ?code= is exchanged when a PKCE verifier exists', async () => {
  auth.storage.getItem.mockResolvedValue('synthetic-verifier/PASSWORD_RECOVERY');
  await render('/reset-password?code=synthetic-code');
  expect(auth.exchangeCodeForSession).toHaveBeenCalledWith('synthetic-code');
  expect(text()).toContain('Set new password');
});

it('F063: with no link tokens an existing session still opens the form', async () => {
  auth.getSession.mockResolvedValue({ data: { session: SESSION }, error: null });
  await render('/reset-password');
  expect(auth.setSession).not.toHaveBeenCalled();
  expect(text()).toContain('Set new password');
});

it('F132: the new password must be at least 8 characters', async () => {
  auth.getSession.mockResolvedValue({ data: { session: SESSION }, error: null });
  await render('/reset-password');
  const inputs = Array.from(container.querySelectorAll<HTMLInputElement>('input[type="password"]'));
  expect(inputs).toHaveLength(2);
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => {
    for (const input of inputs) {
      setValue.call(input, 'seven77');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });
  await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(text()).toContain('Password must be at least 8 characters');
  expect(auth.updateUser).not.toHaveBeenCalled();
});

// RV-R7 (#166 verifier notes 1 and 2). Synthetic accounts only.
type SyntheticUser = { id: string; email: string };
const USER_A: SyntheticUser = { id: 'synthetic-user-a', email: 'a.synthetic@example.com' };
const USER_B: SyntheticUser = { id: 'synthetic-user-b', email: 'b.synthetic@example.com' };
const sessionOf = (user: SyntheticUser) => ({ access_token: 'synthetic-access', refresh_token: 'synthetic-refresh', user });

const LINKS = [
  ['a recovery hash', `/reset-password${RECOVERY_HASH}`],
  ['a token_hash link', '/reset-password?token_hash=synthetic-hash&type=recovery'],
  ['a ?code= link', '/reset-password?code=synthetic-code'],
] as const;

/**
 * This device's auth: signed in as `before` (or nobody); a link that works
 * signs `linkUser` in, and getSession reports whoever is signed in now.
 */
function device(before: SyntheticUser | null, linkUser: SyntheticUser) {
  let current = before;
  auth.getSession.mockImplementation(async () => ({ data: { session: current && sessionOf(current) }, error: null }));
  const signInFromLink = async () => {
    current = linkUser;
    return { data: { session: sessionOf(linkUser), user: linkUser }, error: null };
  };
  auth.setSession.mockImplementation(signInFromLink);
  auth.verifyOtp.mockImplementation(signInFromLink);
  auth.exchangeCodeForSession.mockImplementation(signInFromLink);
  auth.signOut.mockImplementation(async () => {
    current = null;
    return { error: null };
  });
  auth.storage.getItem.mockResolvedValue('synthetic-verifier/PASSWORD_RECOVERY');
}

let location: Location;

function ProbeLocation() {
  location = useLocation();
  return null;
}

/** As render(), with earlier history entries before the last one and a probe of the router location. */
async function renderHistory(entries: string[]) {
  await act(async () => root.render(
    <MemoryRouter initialEntries={entries} initialIndex={entries.length - 1}>
      <CaptureNavigate />
      <ProbeLocation />
      <ResetPassword />
    </MemoryRouter>,
  ));
}

const href = () => `${location.pathname}${location.search}${location.hash}`;
const passwordInputs = () => container.querySelectorAll('input[type="password"]');
const button = (label: string) => Array.from(container.querySelectorAll('button')).find(b => b.textContent === label)!;
const SWITCH_PROMPT = 'This link resets the password for b.synthetic@example.com. You were signed in as a.synthetic@example.com.';

it.each(LINKS)('#166 note 1: %s names the account whose password it resets', async (_shape, entry) => {
  device(null, USER_B);
  await renderHistory([entry]);
  expect(text()).toContain('Set a new password for b.synthetic@example.com');
  expect(passwordInputs()).toHaveLength(2);
});

it('#166 note 1: with no link, an existing session names its own account', async () => {
  device(USER_B, USER_B);
  await renderHistory(['/reset-password']);
  expect(auth.setSession).not.toHaveBeenCalled();
  expect(text()).toContain('Set a new password for b.synthetic@example.com');
  expect(passwordInputs()).toHaveLength(2);
});

it.each(LINKS)('#166 note 1: signed in as A, %s for B asks before switching accounts', async (_shape, entry) => {
  device(USER_A, USER_B);
  await renderHistory([entry]);
  expect(text()).toContain(SWITCH_PROMPT);
  expect(passwordInputs()).toHaveLength(0);
});

it('#166 note 1: Cancel on the switch prompt signs out and opens /login', async () => {
  device(USER_A, USER_B);
  await renderHistory([`/reset-password${RECOVERY_HASH}`]);
  expect(text()).toContain(SWITCH_PROMPT);
  await act(async () => button('Cancel').click());
  expect(auth.signOut).toHaveBeenCalledOnce();
  expect(location.pathname).toBe('/login');
});

it('#166 note 1: Continue on the switch prompt opens the form for the account the link is for', async () => {
  device(USER_A, USER_B);
  await renderHistory([`/reset-password${RECOVERY_HASH}`]);
  expect(text()).toContain(SWITCH_PROMPT);
  await act(async () => button('Continue').click());
  expect(text()).toContain('Set a new password for b.synthetic@example.com');
  expect(text()).not.toContain('You were signed in as');
  expect(passwordInputs()).toHaveLength(2);
  expect(auth.signOut).not.toHaveBeenCalled();
});

it.each(LINKS)('#166 note 1: %s for the account already signed in opens the form without asking', async (_shape, entry) => {
  device(USER_A, USER_A);
  await renderHistory([entry]);
  expect(text()).not.toContain('You were signed in as');
  expect(passwordInputs()).toHaveLength(2);
});

it("#166 note 1: signed in as A, a link whose tokens are rejected shows the request form, not a prompt or A's form", async () => {
  device(USER_A, USER_B);
  auth.setSession.mockResolvedValue({ data: { session: null, user: null }, error: { message: 'invalid' } });
  await renderHistory([`/reset-password${RECOVERY_HASH}`]);
  expect(text()).toContain('Reset your password');
  expect(text()).not.toContain('You were signed in as');
  expect(passwordInputs()).toHaveLength(0);
});

it('#166 note 2: once a link is a session its tokens leave the router location and the history entry, and the form stays', async () => {
  device(null, USER_B);
  const added: string[] = [];
  const observer = new MutationObserver(records => {
    for (const record of records) for (const node of Array.from(record.addedNodes)) added.push(node.textContent ?? '');
  });
  observer.observe(container, { childList: true, subtree: true, characterData: true });
  await renderHistory(['/login', `/reset-password${RECOVERY_HASH}`]);
  observer.disconnect();

  expect(href()).toBe('/reset-password');
  expect(passwordInputs()).toHaveLength(2);
  // No flash of "Verifying reset link..." or of the request form once the form showed.
  const formShown = added.findIndex(nodeText => nodeText.includes('Update password'));
  expect(formShown).toBeGreaterThanOrEqual(0);
  expect(added.slice(formShown).filter(nodeText => /Verifying reset link|Reset your password/.test(nodeText))).toEqual([]);

  // Back goes to the page before the link: no history entry holds the tokens.
  await act(async () => navigate(-1));
  expect(href()).toBe('/login');
});

it.each(LINKS)('#166 note 2: %s leaves no tokens in the location, and the switch prompt stays', async (_shape, entry) => {
  device(USER_A, USER_B);
  await renderHistory([entry]);
  expect(href()).toBe('/reset-password');
  expect(text()).toContain(SWITCH_PROMPT);
});
