// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

/*
  PK-FIX-01a: earlier builds let users pick 'Under 18', and stored profiles are
  NOT migrated. Settings must keep rendering such a profile safely: show the
  stored answer as it is, write it back untouched on save, and never offer it
  as a new choice once it has been changed.
*/
const state = vi.hoisted(() => ({
  profile: {
    full_name: 'Synthetic Fixture',
    age_range: 'Under 18' as string | null,
    sex_at_birth: null,
    pregnancy_status: null,
    health_goals: [] as string[],
    symptoms: [] as string[],
    supplements: [] as string[],
    known_conditions: [] as string[],
  },
  updates: [] as { table: string; payload: Record<string, unknown> }[],
}));
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'user-1' }, userProfile: state.profile, refreshUserProfile: async () => {} }),
}));
vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (table: string) => ({
      update: (payload: Record<string, unknown>) => {
        state.updates.push({ table, payload });
        return { eq: async () => ({ error: null }) };
      },
    }),
  },
}));
import { PersonalContextCard } from './PersonalContextCard';
import { AGE_RANGES } from '../onboarding/contextOptions';

let root: Root;
let app: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  app = document.createElement('div');
  document.body.append(app);
  root = createRoot(app);
  state.updates.length = 0;
});
afterEach(async () => {
  await act(async () => root.unmount());
  app.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const click = async (text: string) => {
  const target = Array.from(app.querySelectorAll('button')).find(b => b.textContent?.trim() === text);
  expect(target, text).toBeTruthy();
  await act(async () => target!.click());
};
function ageSelect(): HTMLSelectElement {
  const label = Array.from(app.querySelectorAll('label')).find(l => l.textContent?.trim() === 'Age range')!;
  return label.parentElement!.querySelector('select')!;
}

it('a stored Under 18 answer renders as-is and is not migrated on save', async () => {
  await act(async () => root.render(<PersonalContextCard />));
  await click('Edit Context');

  const select = ageSelect();
  expect(select.value).toBe('Under 18');
  const options = Array.from(select.options);
  expect(options.filter(o => o.disabled).map(o => o.value)).toEqual(['Under 18']);
  expect(options.filter(o => !o.disabled && o.value !== '').map(o => o.value)).toEqual(AGE_RANGES);

  await click('Save changes');
  expect(state.updates).toHaveLength(1);
  expect(state.updates[0]!.table).toBe('users');
  expect(state.updates[0]!.payload.age_range).toBe('Under 18');
});

it('once changed, the under-18 answer is not offered again', async () => {
  await act(async () => root.render(<PersonalContextCard />));
  await click('Edit Context');

  const select = ageSelect();
  await act(async () => {
    select.value = '35–44';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect(select.value).toBe('35–44');
  expect(Array.from(select.options).map(o => o.value)).not.toContain('Under 18');

  await click('Save changes');
  expect(state.updates[state.updates.length - 1]!.payload.age_range).toBe('35–44');
});

it('an adult answer renders with no retired option at all', async () => {
  state.profile.age_range = '25–34';
  try {
    await act(async () => root.render(<PersonalContextCard />));
    await click('Edit Context');
    const select = ageSelect();
    expect(select.value).toBe('25–34');
    expect(Array.from(select.options).some(o => o.disabled)).toBe(false);
    expect(Array.from(select.options).map(o => o.value)).not.toContain('Under 18');
  } finally {
    state.profile.age_range = 'Under 18';
  }
});
