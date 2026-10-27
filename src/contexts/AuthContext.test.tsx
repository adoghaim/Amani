// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { AuthProvider, useAuth } from './AuthContext';

const state = vi.hoisted(() => ({
  profile: { id: 'synthetic', full_name: null as string | null, trial_start_date: '2026-10-17T00:00:00Z', onboarding_completed: false },
  updates: [] as Record<string, unknown>[],
  // How the next profile reads answer: the row, no row yet, or a failed request.
  read: 'row' as 'row' | 'none' | 'failed',
}));
vi.mock('../lib/supabase', () => ({ supabase: {
  auth: {
    getSession: async () => ({ data: { session: { user: { id: 'synthetic' } } } }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
  },
  from: (table: string) => {
    expect(table).toBe('users');
    return {
      // postgrest-js resolves a failed fetch as { data: null, error }; it does not throw.
      select: () => ({ eq: () => ({ maybeSingle: async () => (state.read === 'failed'
        ? { data: null, error: { message: 'TypeError: Failed to fetch', details: '', hint: '', code: '' } }
        : { data: state.read === 'row' ? { ...state.profile } : null, error: null }) }) }),
      update: (payload: Record<string, unknown>) => ({ eq: async (key: string, id: string) => {
        expect([key, id]).toEqual(['id', 'synthetic']);
        state.updates.push(payload);
        Object.assign(state.profile, payload);
        return { error: null };
      } }),
    };
  },
} }));

it('onboarding saves answers to the trigger-created profile and refreshes it without inserting', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  let auth: ReturnType<typeof useAuth> | undefined;
  function Probe() { auth = useAuth(); return null; }
  const root = createRoot(document.createElement('div'));
  try {
    await act(async () => root.render(<AuthProvider><Probe /></AuthProvider>));
    await act(async () => {
      expect(await auth!.markOnboardingComplete({ full_name: 'Synthetic Fixture', health_goals: [], symptoms: [],
        age_range: null, sex_at_birth: null, pregnancy_status: null, supplements: [], known_conditions: [] })).toEqual({ error: null });
    });
    expect(state.updates).toHaveLength(1);
    expect(state.updates[0]).toMatchObject({ full_name: 'Synthetic Fixture', onboarding_completed: true });
    expect(auth!.userProfile).toMatchObject({ full_name: 'Synthetic Fixture', onboarding_completed: true });
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});

async function withProvider(run: (auth: () => ReturnType<typeof useAuth>) => Promise<void>) {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  let auth: ReturnType<typeof useAuth> | undefined;
  function Probe() { auth = useAuth(); return null; }
  const root = createRoot(document.createElement('div'));
  try {
    await act(async () => root.render(<AuthProvider><Probe /></AuthProvider>));
    await run(() => auth!);
  } finally {
    await act(async () => root.unmount());
    state.read = 'row';
    vi.unstubAllGlobals();
  }
}

// Review F065: a failed read left userProfile null and nothing else, so the
// route gates could not tell it from a profile still on its way.
it('reports a profile read that failed, until a later read succeeds', async () => {
  state.read = 'failed';
  await withProvider(async auth => {
    expect(auth().loading).toBe(false);
    expect(auth().userProfile).toBeNull();
    expect(auth().profileLoadFailed).toBe(true);
    state.read = 'row';
    await act(async () => { await auth().refreshUserProfile(); });
    expect(auth().profileLoadFailed).toBe(false);
    expect(auth().userProfile).toMatchObject({ id: 'synthetic' });
  });
});

it('a profile that is not there yet is not a failed read', async () => {
  state.read = 'none';
  await withProvider(async auth => {
    expect(auth().userProfile).toBeNull();
    expect(auth().profileLoadFailed).toBe(false);
  });
});
