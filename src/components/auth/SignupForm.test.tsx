// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { SignupForm } from './SignupForm';

const mocks = vi.hoisted(() => ({
  signup: vi.fn(), from: vi.fn(), refresh: vi.fn(), success: vi.fn(),
}));
vi.mock('../../lib/supabase', () => ({ supabase: { auth: { signUp: mocks.signup, getUser: async () => ({ data: { user: { id: 'synthetic', email: 'test@example.invalid' } } }) }, from: mocks.from } }));
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ refreshUserProfile: mocks.refresh }) }));
vi.mock('../../lib/native', () => ({ isNative: () => false }));
vi.mock('../../hooks/useFirstPartyEventsEnabled', () => ({ useFirstPartyEventsEnabled: () => false }));
afterEach(() => { vi.clearAllMocks(); vi.unstubAllGlobals(); });

const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
async function fill(container: HTMLElement, email: string, password: string) {
  const inputs = Array.from(container.querySelectorAll<HTMLInputElement>('form input'));
  const values = [email, password, password];
  await act(async () => inputs.forEach((input, i) => {
    setValue.call(input, values[i]);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }));
}
async function submit(container: HTMLElement) {
  await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
}

it.each([null, { message: 'Signup unavailable' }])('signup refreshes the trigger-created profile without a duplicate insert; error=%j', async error => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  // With Confirm email off, signUp returns the new session alongside the user.
  mocks.signup.mockResolvedValue({ data: { user: { id: 'synthetic' }, session: error ? null : { access_token: 'synthetic' } }, error });
  // The old INSERT would conflict with the trigger-created profile.
  mocks.from.mockReturnValue({ insert: async () => ({ error: { code: '23505' } }) });
  const container = document.createElement('div');
  const root = createRoot(container);
  try {
    await act(async () => root.render(<MemoryRouter><SignupForm onSuccess={mocks.success} /></MemoryRouter>));
    await fill(container, 'test@example.invalid', 'synthetic-password');
    await submit(container);
    expect(mocks.signup).toHaveBeenCalledOnce();
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.refresh).toHaveBeenCalledTimes(error ? 0 : 1);
    expect(mocks.success).toHaveBeenCalledTimes(error ? 0 : 1);
    if (error) expect(container.textContent).toContain(error.message);
  } finally { await act(async () => root.unmount()); }
});

it('F132: with Confirm email on (session null) signup shows a check-your-inbox screen instead of continuing', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  mocks.signup.mockResolvedValue({ data: { user: { id: 'synthetic' }, session: null }, error: null });
  const container = document.createElement('div');
  const root = createRoot(container);
  try {
    await act(async () => root.render(<MemoryRouter><SignupForm onSuccess={mocks.success} /></MemoryRouter>));
    await fill(container, 'test@example.invalid', 'synthetic-password');
    await submit(container);
    expect(mocks.signup).toHaveBeenCalledOnce();
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(mocks.success).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Check your inbox');
    expect(container.textContent).toContain('test@example.invalid');
    expect(container.querySelector('form')).toBeNull();
    expect(container.querySelector('a[href="/login"]')).not.toBeNull();
  } finally { await act(async () => root.unmount()); }
});

it('F132: a password shorter than 8 characters is rejected before signUp', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const container = document.createElement('div');
  const root = createRoot(container);
  try {
    await act(async () => root.render(<MemoryRouter><SignupForm onSuccess={mocks.success} /></MemoryRouter>));
    expect(Array.from(container.querySelectorAll('input[type="password"]')).map(i => i.getAttribute('minlength'))).toEqual(['8', '8']);
    await fill(container, 'test@example.invalid', 'seven77');
    await submit(container);
    expect(mocks.signup).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Password must be at least 8 characters');
  } finally { await act(async () => root.unmount()); }
});

it('F132: the local Supabase auth config enforces the same 8-character minimum', () => {
  const config = readFileSync('supabase/config.toml', 'utf8');
  expect(config).toMatch(/^\[auth\]\nminimum_password_length = 8$/m);
});
