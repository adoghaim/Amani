// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, useNavigate, type NavigateFunction } from 'react-router-dom';
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
