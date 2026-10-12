// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({
  markOnboardingComplete: vi.fn(async (_answers: Record<string, unknown>) => ({ error: null })),
  markOnboardingSkipped: vi.fn(async () => ({ error: null })),
}));
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ userProfile: { full_name: null }, ...auth }),
}));
import { OnboardingFlow } from './OnboardingFlow';
import { isUnder18AgeRange } from './contextOptions';

/*
  PK-FIX-01a, end to end through the real onboarding screens: the age question
  offers no under-18 option, and the answers onboarding saves can never carry one.
*/

let root: Root;
let app: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  app = document.createElement('div');
  document.body.append(app);
  root = createRoot(app);
});
afterEach(async () => {
  await act(async () => root.unmount());
  app.remove();
  vi.unstubAllGlobals();
  auth.markOnboardingComplete.mockClear();
});

const button = (text: string) =>
  Array.from(app.querySelectorAll('button')).find(b => b.textContent?.trim() === text)!;
const click = async (text: string) => {
  const target = button(text);
  expect(target, text).toBeTruthy();
  await act(async () => target.click());
};

it('onboarding offers no under-18 age and never saves one', async () => {
  await act(async () => root.render(<MemoryRouter><OnboardingFlow /></MemoryRouter>));
  await click('Get Started');
  await click('I Understand');
  await click('General lab results');
  await click('Continue');

  const label = Array.from(app.querySelectorAll('label')).find(l => l.textContent?.trim() === 'Age range')!;
  const select = label.parentElement!.querySelector('select')!;
  expect(Array.from(select.options).map(o => o.textContent)).not.toContain('Under 18');

  // Forcing the value has no effect: there is no such option to select.
  await act(async () => {
    select.value = 'Under 18';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect(select.value).toBe('');

  await click('Continue');
  await click('Upload Lab Report');
  expect(auth.markOnboardingComplete).toHaveBeenCalledTimes(1);
  const saved = auth.markOnboardingComplete.mock.calls[0]![0];
  expect(saved.age_range).toBeNull();
  expect(isUnder18AgeRange(saved.age_range as string | null)).toBe(false);
});
