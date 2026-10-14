// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { axeViolations } from '../../components/axe.testkit';
import type { ConsentType } from '../../lib/consent/consentPolicy';

/*
  PK-CONSENT-01: the launch consent gate in the app (D4, D5, D9, D13, D23,
  D24, D25). Flag off is today's behaviour and reads nothing; flag on shows the
  three steps before anything else, records each answer, and opens on the
  last. The ledger and the server checks are the harness case and consent.test.ts.
*/

const api = vi.hoisted(() => ({
  recordConsent: vi.fn(async (_type: string, _granted: boolean) => {}),
  eraseAccount: vi.fn(async () => {}),
  signOutLocally: vi.fn(async () => {}),
  readMissingConsents: vi.fn(async (_userId: string): Promise<string[]> => []),
}));
vi.mock('../../lib/consent/consentApi', () => api);
vi.mock('../../lib/supabase', () => ({ supabase: {} }));
const auth = vi.hoisted(() => ({
  user: { id: 'user-1' } as { id: string } | null,
  userProfile: { onboarding_completed: false, onboarding_skipped: false },
  signOut: vi.fn(async () => {}),
}));
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => auth }));

import { ConsentGate } from './ConsentGate';
import { AdultsOnlyExit } from './AdultsOnlyExit';
import { ConsentSettings } from './ConsentSettings';
import { ADULTS_ONLY_PATH } from './ConsentSteps';
import { setConsentStoreDepsForTests } from '../../lib/consent/consentStore';
import { CONSENT_STEPS, DECLINE_EXIT, SETTINGS_COPY, UNDER_18_CONFIRM, UNDER_18_EXIT } from './consentCopy';

let root: Root;
let app: HTMLDivElement;
let gateOn = true;
let missing: ConsentType[] = [];
let readFails = false;
const reads: string[] = [];

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  app = document.createElement('div');
  document.body.append(app);
  root = createRoot(app);
  gateOn = true;
  missing = ['age_18_plus', 'health_data', 'ai_processing'];
  readFails = false;
  reads.length = 0;
  auth.user = { id: 'user-1' };
  auth.userProfile = { onboarding_completed: false, onboarding_skipped: false };
  Object.values(api).forEach(fn => fn.mockReset());
  api.recordConsent.mockImplementation(async () => {});
  api.eraseAccount.mockImplementation(async () => {});
  api.signOutLocally.mockImplementation(async () => {});
  auth.signOut.mockReset();
  setConsentStoreDepsForTests({
    gateEnabledNow: () => gateOn,
    gateEnabledSettled: async () => gateOn,
    readMissing: async (userId) => {
      reads.push(userId);
      if (readFails) throw new Error('synthetic outage');
      return [...missing];
    },
  });
});
afterEach(async () => {
  await act(async () => root.unmount());
  app.remove();
  setConsentStoreDepsForTests(null);
  vi.unstubAllGlobals();
});

const render = async (node: ReactNode, path = '/app') => {
  await act(async () => root.render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/app" element={node} />
        <Route path="/app/settings" element={node} />
        <Route path={ADULTS_ONLY_PATH} element={<AdultsOnlyExit />} />
        <Route path="/" element={<p>Start page</p>} />
        <Route path="/privacy" element={<p>Privacy page</p>} />
      </Routes>
    </MemoryRouter>,
  ));
  await act(async () => {});
};
const gated = <ConsentGate><p>Dashboard content</p></ConsentGate>;
const heading = () => app.querySelector('h1')?.textContent;
const button = (text: string) => Array.from(app.querySelectorAll<HTMLButtonElement>('button')).find(b => b.textContent?.trim() === text);
const link = (text: string) => Array.from(app.querySelectorAll<HTMLAnchorElement>('a')).find(a => a.textContent?.trim() === text);
const checkbox = () => app.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
const click = async (el: HTMLElement | undefined) => {
  expect(el).toBeTruthy();
  await act(async () => el!.click());
  await act(async () => {});
};
const consentTo = async () => {
  await click(checkbox());
  await click(button('Continue'));
};

describe('flag off (features.consent_gate missing or false): today\'s behaviour', () => {
  it('renders the page and never reads consent', async () => {
    gateOn = false;
    await render(gated);
    expect(app.textContent).toContain('Dashboard content');
    expect(app.querySelector('h1')).toBeNull();
    expect(reads).toEqual([]);
    expect(api.recordConsent).not.toHaveBeenCalled();
  });

  it('Settings shows no consent block', async () => {
    gateOn = false;
    await render(<ConsentSettings />, '/app/settings');
    expect(app.innerHTML).toBe('');
  });
});

describe('flag on: the three steps before anything else (D4, D9)', () => {
  it('step 1: one heading with focus, one sentence, What this means, an unchecked labelled box, Continue disabled until checked', async () => {
    await render(gated);
    expect(app.textContent).not.toContain('Dashboard content');
    expect(heading()).toBe("You're 18 or older");
    expect(document.activeElement).toBe(app.querySelector('h1'));
    expect(app.querySelector('.sr-only')?.textContent).toBe('Step 1 of 3');
    expect(app.querySelectorAll('[data-step]')).toHaveLength(3);
    const box = checkbox();
    expect(box.checked).toBe(false);
    expect(box.labels?.[0]?.textContent).toBe("I confirm I'm 18 or older");
    expect(button('Continue')!.disabled).toBe(true);
    await click(box);
    expect(button('Continue')!.disabled).toBe(false);
    await click(button('What this means'));
    expect(app.textContent).toContain(CONSENT_STEPS[0]!.whatThisMeans[0]);
    expect(await axeViolations(app)).toEqual([]);
  });

  it('records each answer as its own grant, in order, then opens on the last', async () => {
    await render(gated);
    await consentTo();
    expect(api.recordConsent).toHaveBeenLastCalledWith('age_18_plus', true);
    expect(heading()).toBe('Amani can process your health data');
    expect(document.activeElement).toBe(app.querySelector('h1'));
    expect(app.querySelector('.sr-only')?.textContent).toBe('Step 2 of 3');
    // Each step starts unchecked.
    expect(checkbox().checked).toBe(false);
    expect(await axeViolations(app)).toEqual([]);
    await consentTo();
    expect(api.recordConsent).toHaveBeenLastCalledWith('health_data', true);
    expect(heading()).toBe('An AI service can read your lab values to write your explanation');
    expect(app.querySelector('.sr-only')?.textContent).toBe('Step 3 of 3');
    // The last step links to Privacy.
    expect(link('Read how we handle your data in our Privacy Policy')?.getAttribute('href')).toBe('/privacy');
    expect(await axeViolations(app)).toEqual([]);
    await consentTo();
    expect(api.recordConsent.mock.calls).toEqual([['age_18_plus', true], ['health_data', true], ['ai_processing', true]]);
    expect(app.textContent).toContain('Dashboard content');
  });

  it('a returning user starts at her first missing consent, and current consent opens the gate', async () => {
    missing = ['ai_processing'];
    await render(gated);
    expect(heading()).toBe('An AI service can read your lab values to write your explanation');
    await consentTo();
    expect(app.textContent).toContain('Dashboard content');
    await act(async () => root.unmount());
    root = createRoot(app);
    missing = [];
    setConsentStoreDepsForTests({ gateEnabledNow: () => true, gateEnabledSettled: async () => true, readMissing: async () => [] });
    await render(gated);
    expect(app.textContent).toContain('Dashboard content');
  });

  it('a failed save shows the calm notice and stays on the step', async () => {
    api.recordConsent.mockRejectedValueOnce(new Error('offline'));
    await render(gated);
    await consentTo();
    expect(heading()).toBe("You're 18 or older");
    const notice = app.querySelector('[role="status"]')!;
    expect(notice.getAttribute('aria-live')).toBe('polite');
    expect(notice.textContent).toContain("We couldn't save your answer.");
    await click(button('Try again'));
    expect(heading()).toBe('Amani can process your health data');
  });

  it('when her consent cannot be read it fails closed, with Try again', async () => {
    readFails = true;
    await render(gated);
    expect(app.textContent).not.toContain('Dashboard content');
    expect(heading()).toBe("We couldn't check your consent");
    readFails = false;
    await click(button('Try again'));
    expect(heading()).toBe("You're 18 or older");
  });

  it('waits for her profile before showing a step, so "I\'m under 18" never guesses whether the account holds data', async () => {
    const profile = auth.userProfile;
    (auth as { userProfile: unknown }).userProfile = null;
    await render(gated);
    expect(app.querySelector('h1')).toBeNull();
    expect(button("I'm under 18")).toBeUndefined();
    expect(app.textContent).not.toContain('Dashboard content');
    auth.userProfile = profile;
  });

  it('Settings stays reachable without consent (withdrawal and deletion)', async () => {
    await render(<ConsentGate exempt><p>Settings content</p></ConsentGate>, '/app/settings');
    expect(app.textContent).toContain('Settings content');
  });
});

describe('declining AI processing (D5): a calm exit, her account stays', () => {
  it('No thanks -> the exit; Go back returns to the step; Sign out signs out', async () => {
    missing = ['ai_processing'];
    await render(gated);
    await click(button('No thanks'));
    expect(heading()).toBe(DECLINE_EXIT.heading);
    expect(app.textContent).toContain('You can come back any time.');
    expect(document.activeElement).toBe(app.querySelector('h1'));
    expect(api.recordConsent).not.toHaveBeenCalled();
    expect(api.eraseAccount).not.toHaveBeenCalled();
    expect(await axeViolations(app)).toEqual([]);
    await click(button('Go back'));
    expect(heading()).toBe('An AI service can read your lab values to write your explanation');
    await click(button('No thanks'));
    await click(button('Sign out'));
    expect(auth.signOut).toHaveBeenCalledOnce();
  });
});

describe("I'm under 18 (D13)", () => {
  it('a just-created account is erased through delete-user-data, signed out, and shown the exit from local state', async () => {
    await render(gated);
    await click(button("I'm under 18"));
    expect(api.eraseAccount).toHaveBeenCalledOnce();
    expect(api.signOutLocally).toHaveBeenCalledOnce();
    expect(heading()).toBe(UNDER_18_EXIT.heading);
    expect(app.textContent).toContain("We've removed your account.");
    expect(document.activeElement).toBe(app.querySelector('h1'));
    expect(api.recordConsent).not.toHaveBeenCalled();
    expect(await axeViolations(app)).toEqual([]);
    await click(button('Done'));
    expect(app.textContent).toContain('Start page');
  });

  it('erasure fails: she stays signed in, on step 1, with a calm notice', async () => {
    api.eraseAccount.mockRejectedValueOnce(new Error('500'));
    await render(gated);
    await click(button("I'm under 18"));
    expect(api.signOutLocally).not.toHaveBeenCalled();
    expect(heading()).toBe("You're 18 or older");
    expect(app.querySelector('[role="status"]')?.textContent).toContain("We couldn't remove your account just now.");
  });

  it('an account that already holds data asks once before removing it', async () => {
    auth.userProfile = { onboarding_completed: true, onboarding_skipped: false };
    await render(gated);
    await click(button("I'm under 18"));
    expect(api.eraseAccount).not.toHaveBeenCalled();
    expect(heading()).toBe(UNDER_18_CONFIRM.heading);
    await click(button(UNDER_18_CONFIRM.secondary));
    expect(heading()).toBe("You're 18 or older");
    await click(button("I'm under 18"));
    await click(button(UNDER_18_CONFIRM.primary));
    expect(api.eraseAccount).toHaveBeenCalledOnce();
    expect(heading()).toBe(UNDER_18_EXIT.heading);
  });

  it('a direct visit to the exit (no local state) claims nothing', async () => {
    await render(gated, ADULTS_ONLY_PATH);
    expect(app.textContent).toContain('Start page');
  });
});

describe('withdrawal in Settings > Privacy & security (D25)', () => {
  it('shows the status as a word with an icon, explains the effect, withdraws processing and offers deletion', async () => {
    missing = [];
    const yourData = document.createElement('section');
    yourData.setAttribute('data-settings-section', 'your-data');
    const deleteButton = document.createElement('button');
    deleteButton.textContent = 'Delete My Data';
    yourData.append(deleteButton);
    yourData.scrollIntoView = vi.fn();
    document.body.append(yourData);

    await render(<ConsentSettings />, '/app/settings');
    expect(app.textContent).toContain(SETTINGS_COPY.given);
    expect(Array.from(app.querySelectorAll('li')).map(li => li.textContent)).toEqual([
      "You're 18 or olderGiven", 'Amani can process your health dataGiven', 'An AI service can read your lab valuesGiven']);
    await click(button('Withdraw consent'));
    for (const line of SETTINGS_COPY.withdrawExplain) expect(app.textContent).toContain(line);
    expect(api.recordConsent).not.toHaveBeenCalled();
    await click(button('Withdraw my consent'));
    expect(api.recordConsent.mock.calls).toEqual([['health_data', false], ['ai_processing', false]]);
    expect(app.textContent).toContain(SETTINGS_COPY.withdrawn);
    expect(Array.from(app.querySelectorAll('li')).map(li => li.textContent?.endsWith('Not given'))).toEqual([false, true, true]);
    expect(await axeViolations(app)).toEqual([]);
    await click(button('Delete my data'));
    expect(yourData.scrollIntoView).toHaveBeenCalled();
    expect(document.activeElement).toBe(deleteButton);
    yourData.remove();
  });

  it('a failed withdrawal says so and changes nothing it did not record', async () => {
    missing = [];
    api.recordConsent.mockRejectedValueOnce(new Error('offline'));
    await render(<ConsentSettings />, '/app/settings');
    await click(button('Withdraw consent'));
    await click(button('Withdraw my consent'));
    expect(app.querySelector('[role="status"]')?.textContent).toContain("We couldn't record your withdrawal.");
    expect(app.textContent).not.toContain(SETTINGS_COPY.withdrawn);
  });
});
