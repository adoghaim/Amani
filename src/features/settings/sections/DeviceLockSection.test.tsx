// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { axeViolations } from '../../../components/axe.testkit';

/*
  PK-DEVICE-01 (D16, D25, R15): the lock toggle and re-lock time in Privacy &
  security. Plugins mocked through src/lib/native; the controller is real.
*/

const env = vi.hoisted(() => ({
  native: true,
  os: 'ios' as 'ios' | 'android',
  flag: true,
  biometrics: { available: true, kind: 'faceId', deviceSecure: true } as { available: boolean; kind: string | null; deviceSecure: boolean },
  results: [] as Array<{ ok: true } | { ok: false; reason: 'cancelled' | 'failed' | 'unavailable' }>,
  flagSecure: [] as boolean[],
  reasons: [] as string[],
}));
vi.mock('../../../lib/native', () => ({
  isNative: () => env.native,
  platform: () => (env.native ? env.os : 'web'),
  checkBiometrics: async () => env.biometrics,
  authenticateWithBiometrics: async (reason: string) => { env.reasons.push(reason); return env.results.shift() ?? { ok: true }; },
  setScreenshotsBlocked: async (blocked: boolean) => { env.flagSecure.push(blocked); return env.os === 'android'; },
}));
vi.mock('../../../lib/runtimeConfig', () => ({ loadRuntimeConfig: async () => {}, isFeatureEnabled: () => env.flag }));
vi.mock('../../../lib/supabase', () => ({ supabase: {} }));

let root: Root;
let app: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('__APP_RELEASE__', 'amani@1.0.7+abcdef0');
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.resetModules();
  localStorage.clear();
  Object.assign(env, { native: true, os: 'ios', flag: true, results: [], flagSecure: [], reasons: [] });
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

async function mount(settings?: Record<string, unknown>) {
  if (settings) localStorage.setItem('amani.device-lock.v1', JSON.stringify(settings));
  const { DeviceLockSection } = await import('./DeviceLockSection');
  await act(async () => root.render(<DeviceLockSection />));
  await act(async () => {});
}
const toggle = () => app.querySelector<HTMLButtonElement>('[role="switch"]');
const stored = () => JSON.parse(localStorage.getItem('amani.device-lock.v1') ?? '{}') as Record<string, unknown>;

describe('DeviceLockSection', () => {
  it('off by default: a labelled switch, no re-lock choice yet', async () => {
    await mount();
    expect(toggle()!.getAttribute('aria-checked')).toBe('false');
    const label = app.querySelector(`label[for="${toggle()!.id}"]`)!;
    expect(label.textContent).toBe('Lock Amani with Face ID');
    expect(app.querySelector('select')).toBeNull();
  });

  it('turning it on asks for Face ID once, then offers the re-lock time with 1 minute selected (D16)', async () => {
    await mount();
    await act(async () => toggle()!.click());
    await act(async () => {});
    expect(toggle()!.getAttribute('aria-checked')).toBe('true');
    expect(stored().enabled).toBe(true);
    const select = app.querySelector('select')!;
    expect(select.value).toBe('1m');
    expect(Array.from(select.options).map(o => o.textContent)).toEqual(['Immediately', 'After 1 minute', 'After 5 minutes', 'After 15 minutes']);
    expect(app.querySelector(`label[for="${select.id}"]`)!.textContent).toBe('Lock again when you leave Amani');
    expect(app.querySelector('.sr-only[role="status"]')!.textContent).toBe('The lock is on.');
  });

  it('changing the re-lock time saves it', async () => {
    await mount({ enabled: true });
    const select = app.querySelector('select')!;
    await act(async () => {
      select.value = '5m';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(stored().relockAfter).toBe('5m');
    expect(select.value).toBe('5m');
  });

  it('a cancelled scan leaves it off with a calm notice', async () => {
    env.results = [{ ok: false, reason: 'cancelled' }];
    await mount();
    await act(async () => toggle()!.click());
    await act(async () => {});
    expect(toggle()!.getAttribute('aria-checked')).toBe('false');
    expect(app.textContent).toContain("The lock wasn't turned on.");
  });

  it('Android: says next to the toggle that screenshots are blocked while the lock is on, and sets/clears FLAG_SECURE (R15)', async () => {
    env.os = 'android';
    env.biometrics = { available: true, kind: 'fingerprint', deviceSecure: true };
    await mount();
    const note = document.getElementById(toggle()!.getAttribute('aria-describedby')!)!;
    expect(note.textContent).toBe('While the lock is on, screenshots of Amani are blocked on Android.');
    expect(app.querySelector(`label[for="${toggle()!.id}"]`)!.textContent).toBe('Lock Amani with your fingerprint');
    await act(async () => toggle()!.click());
    await act(async () => {});
    await act(async () => toggle()!.click());
    await act(async () => {});
    expect(env.flagSecure).toEqual([true, false]);
  });

  it('iOS: no Android screenshot note', async () => {
    await mount();
    expect(app.textContent).not.toContain('screenshots');
  });

  it('hidden on the web, with the flag off (unless already on), or without Face ID or a fingerprint', async () => {
    env.native = false;
    await mount();
    expect(app.innerHTML).toBe('');
  });

  it.each([false, true])('stored enabled setting is hidden when inactive (native=%s)', async native => {
    env.native = native;
    if (native) vi.stubGlobal('__APP_RELEASE__', 'amani@1.0.6+abcdef0');
    await mount({ enabled: true, relockAfter: 'immediately' });
    expect(app.innerHTML).toBe('');
    expect(stored()).toEqual({ enabled: true, relockAfter: 'immediately' });
    expect(env.flagSecure).toEqual([]);
  });

  it('flag off but the lock is on: still shown, so she can always turn it off', async () => {
    env.flag = false;
    await mount({ enabled: true });
    expect(toggle()!.getAttribute('aria-checked')).toBe('true');
    await act(async () => toggle()!.click());
    await act(async () => {});
    expect(stored().enabled).toBe(false);
  });

  it('flag off and the lock off: nothing to show', async () => {
    env.flag = false;
    await mount();
    expect(app.innerHTML).toBe('');
  });

  it('no Face ID or fingerprint set up: nothing to show', async () => {
    env.biometrics = { available: false, kind: null, deviceSecure: true };
    await mount();
    expect(app.innerHTML).toBe('');
  });

  it('44px touch targets, and passes axe off and on (D23)', async () => {
    env.os = 'android';
    await mount();
    expect(toggle()!.className).toContain('h-11');
    expect(await axeViolations(app)).toEqual([]);
    await act(async () => toggle()!.click());
    await act(async () => {});
    expect(app.querySelector('select')!.className).toContain('min-h-[44px]');
    expect(await axeViolations(app)).toEqual([]);
  });
});

describe('review F006: turning the lock off asks for Face ID, a fingerprint or the passcode first', () => {
  it('a successful check turns it off', async () => {
    await mount({ enabled: true });
    await act(async () => toggle()!.click());
    await act(async () => {});
    expect(env.reasons).toEqual(['Turn off the lock for Amani']);
    expect(toggle()!.getAttribute('aria-checked')).toBe('false');
    expect(stored().enabled).toBe(false);
    expect(app.querySelector('.sr-only[role="status"]')!.textContent).toBe('The lock is off.');
  });

  it.each(['cancelled', 'failed'] as const)('a %s check leaves it on with a calm notice', async reason => {
    env.results = [{ ok: false, reason }];
    await mount({ enabled: true });
    await act(async () => toggle()!.click());
    await act(async () => {});
    expect(toggle()!.getAttribute('aria-checked')).toBe('true');
    expect(stored().enabled).toBe(true);
    expect(app.textContent).toContain("The lock wasn't turned off.");
    expect(app.textContent).toContain('Nothing has changed.');
    expect(env.flagSecure).toEqual([]);
  });

  it('a phone with no passcode or biometrics left turns it off without one', async () => {
    env.results = [{ ok: false, reason: 'unavailable' }];
    await mount({ enabled: true });
    env.biometrics = { available: false, kind: null, deviceSecure: false };
    await act(async () => toggle()!.click());
    await act(async () => {});
    expect(stored().enabled).toBe(false);
    expect(toggle()!.getAttribute('aria-checked')).toBe('false');
  });
});

it('review F007: an Android phone that cannot say which sensor is enrolled gets generic wording', async () => {
  env.os = 'android';
  env.biometrics = { available: true, kind: 'biometric', deviceSecure: true };
  await mount();
  expect(app.querySelector(`label[for="${toggle()!.id}"]`)!.textContent).toBe('Lock Amani with biometric unlock');
  expect(app.textContent).not.toContain('fingerprint');
});
