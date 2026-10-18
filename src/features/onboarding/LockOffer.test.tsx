// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { axeViolations } from '../../components/axe.testkit';

/*
  PK-DEVICE-01, D15: the lock is offered once as an onboarding step after the
  profile ("Turn on" / "Not now"), only on a phone with Face ID or a
  fingerprint and with features.biometric_lock on. The web has no step.
*/

const env = vi.hoisted(() => ({
  native: true,
  flag: true,
  biometrics: { available: true, kind: 'faceId', deviceSecure: true } as { available: boolean; kind: string | null; deviceSecure: boolean },
  results: [] as Array<{ ok: true } | { ok: false; reason: 'cancelled' | 'failed' | 'unavailable' }>,
  authCalls: 0,
}));
vi.mock('../../lib/native', () => ({
  isNative: () => env.native,
  platform: () => (env.native ? 'ios' : 'web'),
  checkBiometrics: async () => env.biometrics,
  authenticateWithBiometrics: async () => { env.authCalls += 1; return env.results.shift() ?? { ok: true }; },
  setScreenshotsBlocked: async () => false,
}));
vi.mock('../../lib/runtimeConfig', () => ({ loadRuntimeConfig: async () => {}, isFeatureEnabled: () => env.flag }));
vi.mock('../../lib/firstPartyEventsClient', () => ({ firstPartyEvents: { track: vi.fn(async () => true) } }));
vi.mock('../../lib/supabase', () => ({ supabase: {} }));
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({
    userProfile: { full_name: null },
    markOnboardingComplete: async () => ({ error: null }),
    markOnboardingSkipped: async () => ({ error: null }),
  }),
}));

let root: Root;
let app: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('__APP_RELEASE__', 'amani@1.0.7+abcdef0');
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.resetModules();
  localStorage.clear();
  Object.assign(env, { native: true, flag: true, results: [], authCalls: 0 });
  env.biometrics = { available: true, kind: 'faceId', deviceSecure: true };
  app = document.createElement('div');
  document.body.append(app);
  root = createRoot(app);
});
afterEach(async () => {
  await act(async () => root.unmount());
  app.remove();
  vi.unstubAllGlobals();
});

const buttons = () => Array.from(app.querySelectorAll('button'));
const click = async (label: string) => {
  const target = buttons().find(b => b.textContent?.trim() === label);
  expect(target, label).toBeTruthy();
  await act(async () => target!.click());
  await act(async () => {});
};

/** Renders the flow and walks it to the step after the profile. */
async function walkPastProfile() {
  const { OnboardingFlow } = await import('./OnboardingFlow');
  await act(async () => root.render(<MemoryRouter><OnboardingFlow /></MemoryRouter>));
  await act(async () => {});
  await click('Get Started');
  await click('I Understand');
  // Pick any one health goal so Continue is enabled.
  const goal = buttons().find(b => !['Back', 'Continue'].includes(b.textContent?.trim() ?? ''))!;
  await act(async () => goal.click());
  await click('Continue');
  await click('Continue');
}
const heading = () => app.querySelector('h1')!.textContent;
const progress = () => app.textContent?.match(/Step \d of \d/)?.[0];
const stored = () => JSON.parse(localStorage.getItem('amani.device-lock.v1') ?? '{}') as Record<string, unknown>;

describe('the onboarding lock offer (D15)', () => {
  it('a phone with Face ID: the offer comes after the profile, then the upload step', async () => {
    await walkPastProfile();
    expect(heading()).toBe('Lock Amani with Face ID?');
    expect(progress()).toBe('Step 5 of 6');
    expect(buttons().map(b => b.textContent?.trim())).toEqual(['Turn on', 'Not now']);
    expect(await axeViolations(app)).toEqual([]);
    await click('Not now');
    expect(heading()).toBe('Upload your first lab report');
    expect(progress()).toBe('Step 6 of 6');
    expect(stored()).toMatchObject({ enabled: false, offerAnswered: true });
    expect(env.authCalls).toBe(0);
  });

  it('"Turn on" asks for Face ID once, turns the lock on, and moves on', async () => {
    await walkPastProfile();
    await click('Turn on');
    expect(env.authCalls).toBe(1);
    expect(stored()).toMatchObject({ enabled: true, offerAnswered: true, relockAfter: '1m' });
    expect(heading()).toBe('Upload your first lab report');
  });

  it('a cancelled scan keeps her on the step with a calm notice, and "Not now" still works', async () => {
    env.results = [{ ok: false, reason: 'cancelled' }];
    await walkPastProfile();
    await click('Turn on');
    expect(heading()).toBe('Lock Amani with Face ID?');
    expect(app.querySelector('[role="status"]')!.textContent).toContain("The lock wasn't turned on.");
    expect(await axeViolations(app)).toEqual([]);
    await click('Not now');
    expect(heading()).toBe('Upload your first lab report');
    expect(stored().enabled).toBe(false);
  });

  it('a fingerprint phone names the fingerprint', async () => {
    env.biometrics = { available: true, kind: 'fingerprint', deviceSecure: true };
    await walkPastProfile();
    expect(heading()).toBe('Lock Amani with your fingerprint?');
  });

  it.each([
    ['the web', () => { env.native = false; }],
    ['the flag off', () => { env.flag = false; }],
    ['no Face ID or fingerprint set up', () => { env.biometrics = { available: false, kind: null, deviceSecure: true }; }],
    ['already answered on this phone', () => { localStorage.setItem('amani.device-lock.v1', JSON.stringify({ offerAnswered: true })); }],
  ])('no step with %s: the profile is followed by the upload step, 5 steps in all', async (_name, arrange) => {
    arrange();
    await walkPastProfile();
    expect(heading()).toBe('Upload your first lab report');
    expect(progress()).toBe('Step 5 of 5');
  });
});

it('pre-1.0.7 native has the original five-step flow even with a stored lock and flag on', async () => {
  vi.stubGlobal('__APP_RELEASE__', 'amani@1.0.6+abcdef0');
  localStorage.setItem('amani.device-lock.v1', '{"enabled":true}');
  await walkPastProfile();
  expect(progress()).toBe('Step 5 of 5');
  expect(env.authCalls).toBe(0);
  expect(localStorage.getItem('amani.device-lock.v1')).toBe('{"enabled":true}');
});
