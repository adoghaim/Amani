// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { AuthProvider, useAuth } from './AuthContext';

const state = vi.hoisted(() => ({
  profile: { id: 'synthetic', full_name: null as string | null, trial_start_date: '2026-10-17T00:00:00Z', onboarding_completed: false },
  updates: [] as Record<string, unknown>[],
  upserts: [] as { payload: Record<string, unknown>; options: unknown }[],
}));
vi.mock('../lib/supabase', () => ({ supabase: {
  auth: {
    getSession: async () => ({ data: { session: { user: { id: 'synthetic' } } } }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    signUp: async () => ({ data: { user: { id: 'synthetic', email: 'synthetic@example.invalid' } }, error: null }),
  },
  from: (table: string) => {
    expect(table).toBe('users');
    return {
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { ...state.profile }, error: null }) }) }),
      update: (payload: Record<string, unknown>) => ({ eq: async (key: string, id: string) => {
        expect([key, id]).toEqual(['id', 'synthetic']);
        state.updates.push(payload);
        Object.assign(state.profile, payload);
        return { error: null };
      } }),
      upsert: async (payload: Record<string, unknown>, options: unknown) => {
        state.upserts.push({ payload, options });
        return { error: null };
      },
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

// Review F025: the database records consent only through record_consent(); a
// signup fallback row must not claim it (has_consented stays the column default).
it('signUp creates the fallback profile without claiming consent', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  let auth: ReturnType<typeof useAuth> | undefined;
  function Probe() { auth = useAuth(); return null; }
  const root = createRoot(document.createElement('div'));
  try {
    await act(async () => root.render(<AuthProvider><Probe /></AuthProvider>));
    await act(async () => { await auth!.signUp('synthetic@example.invalid', 'synthetic-password'); });
    expect(state.upserts).toEqual([{
      payload: { id: 'synthetic', email: 'synthetic@example.invalid' },
      options: { onConflict: 'id', ignoreDuplicates: true },
    }]);
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});
