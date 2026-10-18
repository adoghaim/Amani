// @vitest-environment jsdom
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

it.each([null, { message: 'Signup unavailable' }])('signup refreshes the trigger-created profile without a duplicate insert; error=%j', async error => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  mocks.signup.mockResolvedValue({ data: { user: { id: 'synthetic' } }, error });
  // The old INSERT would conflict with the trigger-created profile.
  mocks.from.mockReturnValue({ insert: async () => ({ error: { code: '23505' } }) });
  const container = document.createElement('div');
  const root = createRoot(container);
  try {
    await act(async () => root.render(<MemoryRouter><SignupForm onSuccess={mocks.success} /></MemoryRouter>));
    await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(mocks.signup).toHaveBeenCalledOnce();
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.refresh).toHaveBeenCalledTimes(error ? 0 : 1);
    expect(mocks.success).toHaveBeenCalledTimes(error ? 0 : 1);
    if (error) expect(container.textContent).toContain(error.message);
  } finally { await act(async () => root.unmount()); }
});
