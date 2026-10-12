// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AGE_RANGES, RETIRED_UNDER_18_AGE_RANGE, isUnder18AgeRange } from '../contextOptions';
import { PersonalContextStep, type PersonalContextValue } from './PersonalContextStep';

/*
  PK-FIX-01a: the Terms require users to be 18 or over, so onboarding no longer
  offers an under-18 age, and an under-18 value that reaches this step (stored
  by an earlier build) stops setup with a kind message instead of being saved.
*/

const blank: PersonalContextValue = {
  full_name: null,
  symptoms: [],
  age_range: null,
  sex_at_birth: null,
  pregnancy_status: null,
  supplements: [],
  known_conditions: [],
};

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
});

const button = (text: string) =>
  Array.from(app.querySelectorAll('button')).find(b => b.textContent?.trim() === text)!;
function ageSelect(): HTMLSelectElement {
  const label = Array.from(app.querySelectorAll('label')).find(l => l.textContent?.trim() === 'Age range')!;
  return label.parentElement!.querySelector('select')!;
}
const optionTexts = (select: HTMLSelectElement) => Array.from(select.options).map(o => o.textContent);
const alertText = () =>
  Array.from(app.querySelectorAll('[role="alert"] p'))
    .map(p => (p.textContent ?? '').replace(/\s+/g, ' ').trim())
    .join(' ');

async function renderStep(age: string | null) {
  const onNext = vi.fn();
  await act(async () =>
    root.render(
      <PersonalContextStep value={{ ...blank, age_range: age }} onChange={() => {}} onNext={onNext} onBack={() => {}} />,
    ),
  );
  return onNext;
}

describe('the age picker offers adults only', () => {
  it('no age option is under 18', () => {
    expect(AGE_RANGES).not.toContain('Under 18');
    expect(AGE_RANGES.filter(isUnder18AgeRange)).toEqual([]);
    for (const age of AGE_RANGES) {
      expect(age, age).toMatch(/^(?:18–24|25–34|35–44|45–54|55–64|65\+|Prefer not to say)$/);
    }
  });

  it('the rendered onboarding picker lists exactly the adult options', async () => {
    await renderStep(null);
    expect(optionTexts(ageSelect())).toEqual(['Select age range', ...AGE_RANGES]);
    expect(optionTexts(ageSelect())).not.toContain('Under 18');
  });

  it('recognises the retired value, and nothing else, as under 18', () => {
    expect(RETIRED_UNDER_18_AGE_RANGE).toBe('Under 18');
    for (const value of ['Under 18', 'under 18', '  Under   18 ']) expect(isUnder18AgeRange(value), value).toBe(true);
    for (const value of [null, undefined, '', '18–24', '65+', 'Prefer not to say']) {
      expect(isUnder18AgeRange(value), String(value)).toBe(false);
    }
  });
});

describe('Under 18 cannot proceed', () => {
  it('a stored under-18 value blocks Continue with a kind, clear message', async () => {
    const onNext = await renderStep('Under 18');

    expect(alertText()).toBe(
      'Amani is for adults 18 and over Thank you for your interest. Amani is built for adults, '
        + 'so we can’t continue setting up an account for anyone under 18.',
    );
    const next = button('Continue');
    expect(next.disabled).toBe(true);
    expect(next.getAttribute('aria-describedby')).toBe(app.querySelector('[role="alert"]')!.id);

    await act(async () => next.click());
    expect(onNext).not.toHaveBeenCalled();
  });

  it('the stored value is shown as the current answer but cannot be picked again', async () => {
    await renderStep('Under 18');
    const select = ageSelect();
    expect(select.value).toBe('Under 18');
    const retired = Array.from(select.options).filter(o => o.value === 'Under 18');
    expect(retired).toHaveLength(1);
    expect(retired[0]!.disabled).toBe(true);
    // Every adult option stays available.
    expect(Array.from(select.options).filter(o => o.disabled).map(o => o.value)).toEqual(['Under 18']);
  });

  it('an under-18 age cannot be chosen from the picker at all', async () => {
    const onNext = vi.fn();
    const answers: (string | null)[] = [];
    function Harness() {
      const [value, setValue] = useState<PersonalContextValue>(blank);
      return (
        <PersonalContextStep
          value={value}
          onChange={next => { answers.push(next.age_range); setValue(next); }}
          onNext={onNext}
          onBack={() => {}}
        />
      );
    }
    await act(async () => root.render(<Harness />));
    const select = ageSelect();
    await act(async () => {
      select.value = 'Under 18';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    // There is no such option, so the browser selects nothing and nothing under 18 is stored.
    expect(select.value).toBe('');
    expect(answers.some(isUnder18AgeRange)).toBe(false);
    expect(app.querySelector('[role="alert"]')).toBeNull();
  });
});

describe('adults and people who skip the question continue as before', () => {
  it.each([null, '25–34', 'Prefer not to say'])('age %s: no message, Continue works', async age => {
    const onNext = await renderStep(age);
    expect(app.querySelector('[role="alert"]')).toBeNull();
    const next = button('Continue');
    expect(next.disabled).toBe(false);
    expect(next.hasAttribute('aria-describedby')).toBe(false);
    await act(async () => next.click());
    expect(onNext).toHaveBeenCalledTimes(1);
  });
});
