import { describe, expect, it } from 'vitest';
import type { BiometricStatus, BiometricUnlockResult } from '../native';
import {
  createDeviceLock, DEFAULT_RELOCK_AFTER, LOCK_SETTINGS_STORAGE_KEY, lockMethodName, parseLockSettings,
  RELOCK_OPTIONS, type LockSettings,
} from './lockController';

/*
  PK-DEVICE-01 P1(3), D15, D16, R15: the optional Face ID / fingerprint lock,
  driven entirely through fakes (no device, no plugin).
*/

const FACE: BiometricStatus = { available: true, kind: 'faceId', deviceSecure: true };

function setup(options: {
  native?: boolean;
  flag?: boolean;
  biometrics?: BiometricStatus;
  stored?: Partial<LockSettings>;
  results?: BiometricUnlockResult[];
} = {}) {
  const local = new Map<string, string>();
  if (options.stored) local.set(LOCK_SETTINGS_STORAGE_KEY, JSON.stringify(options.stored));
  const results = [...(options.results ?? [])];
  const calls: string[] = [];
  const clock = { now: 1_000_000 };
  let biometrics = options.biometrics ?? FACE;
  const lock = createDeviceLock({
    isNative: () => options.native ?? true,
    flagOn: async () => options.flag ?? true,
    checkBiometrics: async () => biometrics,
    authenticate: async reason => {
      calls.push(`authenticate:${reason}`);
      return results.shift() ?? { ok: true };
    },
    setScreenshotsBlocked: async blocked => { calls.push(`FLAG_SECURE:${blocked}`); },
    storage: () => ({ getItem: key => local.get(key) ?? null, setItem: (key, value) => { local.set(key, value); } }),
    now: () => clock.now,
  });
  const stored = () => parseLockSettings(local.get(LOCK_SETTINGS_STORAGE_KEY));
  return { lock, calls, clock, stored, setBiometrics: (next: BiometricStatus) => { biometrics = next; } };
}

describe('settings', () => {
  it('off by default, re-lock after 1 minute by default (D16), offer not yet answered', () => {
    expect(parseLockSettings(null)).toEqual({ enabled: false, relockAfter: '1m', offerAnswered: false });
    expect(DEFAULT_RELOCK_AFTER).toBe('1m');
    const { lock } = setup();
    expect(lock.getState()).toEqual({ settings: { enabled: false, relockAfter: '1m', offerAnswered: false }, locked: false, unlocking: false, problem: null });
  });

  it('offers exactly Immediately, 1, 5 and 15 minutes (D16)', () => {
    expect(RELOCK_OPTIONS.map(option => [option.value, option.label, option.ms])).toEqual([
      ['immediately', 'Immediately', 0],
      ['1m', 'After 1 minute', 60_000],
      ['5m', 'After 5 minutes', 300_000],
      ['15m', 'After 15 minutes', 900_000],
    ]);
  });

  it('malformed stored settings read as off', () => {
    expect(parseLockSettings('{not json')).toEqual({ enabled: false, relockAfter: '1m', offerAnswered: false });
    expect(parseLockSettings('{"enabled":"yes","relockAfter":"2h"}')).toEqual({ enabled: false, relockAfter: '1m', offerAnswered: false });
    expect(parseLockSettings('null')).toEqual({ enabled: false, relockAfter: '1m', offerAnswered: false });
  });

  it('names the method', () => {
    expect(lockMethodName('faceId')).toBe('Face ID');
    expect(lockMethodName('touchId')).toBe('Touch ID');
    expect(lockMethodName('fingerprint')).toBe('your fingerprint');
  });
});

describe('turning the lock on and off', () => {
  it('turning on asks for one scan first, then saves it and sets FLAG_SECURE (R15)', async () => {
    const { lock, calls, stored } = setup();
    expect(await lock.turnOn()).toBe(true);
    expect(calls).toEqual(['authenticate:Turn on the lock for Amani', 'FLAG_SECURE:true']);
    expect(stored()).toEqual({ enabled: true, relockAfter: '1m', offerAnswered: true });
    // Turning it on does not lock the app she is using.
    expect(lock.getState().locked).toBe(false);
  });

  it('a failed or cancelled scan never turns it on, so a lock that cannot open is never set', async () => {
    const { lock, calls, stored } = setup({ results: [{ ok: false, reason: 'cancelled' }] });
    expect(await lock.turnOn()).toBe(false);
    expect(stored().enabled).toBe(false);
    expect(calls).toEqual(['authenticate:Turn on the lock for Amani']);
  });

  it('turning off clears FLAG_SECURE (R15) and unlocks', async () => {
    const { lock, calls, stored } = setup({ stored: { enabled: true } });
    await lock.turnOff();
    expect(stored().enabled).toBe(false);
    expect(lock.getState().locked).toBe(false);
    expect(calls).toEqual(['FLAG_SECURE:false']);
  });

  it('cannot be turned on with the flag off, or without Face ID or a fingerprint', async () => {
    expect(await setup({ flag: false }).lock.turnOn()).toBe(false);
    expect(await setup({ biometrics: { available: false, kind: null, deviceSecure: true } }).lock.turnOn()).toBe(false);
  });

  it('start() applies FLAG_SECURE to match the stored setting, on native only', async () => {
    const on = setup({ stored: { enabled: true } });
    await on.lock.start();
    expect(on.calls).toEqual(['FLAG_SECURE:true']);
    const off = setup();
    await off.lock.start();
    expect(off.calls).toEqual(['FLAG_SECURE:false']);
    const web = setup({ native: false, stored: { enabled: true } });
    await web.lock.start();
    expect(web.calls).toEqual([]);
  });

  it('the re-lock time is saved; an unknown value is ignored', () => {
    const { lock, stored } = setup();
    lock.setRelockAfter('5m');
    expect(stored().relockAfter).toBe('5m');
    lock.setRelockAfter('2h' as never);
    expect(stored().relockAfter).toBe('5m');
  });
});

describe('when it locks (D16)', () => {
  it('a cold start always locks when it is on, and never when it is off', () => {
    expect(setup({ stored: { enabled: true, relockAfter: '15m' } }).lock.getState().locked).toBe(true);
    expect(setup().lock.getState().locked).toBe(false);
  });

  it('the web never locks, whatever is stored', () => {
    expect(setup({ native: false, stored: { enabled: true } }).lock.getState().locked).toBe(false);
  });

  it('with nobody signed in, the cold-start lock is dropped, so a fresh sign-in is not locked', () => {
    const { lock } = setup({ stored: { enabled: true } });
    lock.noSession();
    expect(lock.getState().locked).toBe(false);
  });

  it.each([
    ['immediately', 0, true],
    ['1m', 59_999, false],
    ['1m', 60_000, true],
    ['5m', 299_000, false],
    ['5m', 300_000, true],
    ['15m', 899_000, false],
    ['15m', 900_000, true],
  ] as const)('re-lock %s: back after %i ms -> locked %s', async (relockAfter, away, expected) => {
    const { lock, clock } = setup({ stored: { enabled: true, relockAfter } });
    await lock.unlock();
    expect(lock.getState().locked).toBe(false);
    lock.pause();
    clock.now += away;
    lock.resume();
    expect(lock.getState().locked).toBe(expected);
  });

  it('never re-locks when the lock is off', () => {
    const { lock, clock } = setup();
    lock.pause();
    clock.now += 3_600_000;
    lock.resume();
    expect(lock.getState().locked).toBe(false);
  });

  it("Android's passcode screen pauses and resumes the app mid-unlock: that never re-locks it", async () => {
    let release: (result: BiometricUnlockResult) => void = () => {};
    const pending = new Promise<BiometricUnlockResult>(resolve => { release = resolve; });
    const { lock } = createSlowLock(pending);
    expect(lock.getState().locked).toBe(true);
    const unlocking = lock.unlock();
    lock.pause(); // the passcode activity opens
    release({ ok: true });
    await unlocking;
    lock.resume(); // MainActivity resumes after the result, with re-lock set to Immediately
    expect(lock.getState().locked).toBe(false);
  });
});

function createSlowLock(pending: Promise<BiometricUnlockResult>) {
  const local = new Map<string, string>([[LOCK_SETTINGS_STORAGE_KEY, JSON.stringify({ enabled: true, relockAfter: 'immediately' })]]);
  const clock = { now: 0 };
  const lock = createDeviceLock({
    isNative: () => true,
    flagOn: async () => true,
    checkBiometrics: async () => FACE,
    authenticate: () => pending,
    setScreenshotsBlocked: async () => {},
    storage: () => ({ getItem: key => local.get(key) ?? null, setItem: (key, value) => { local.set(key, value); } }),
    now: () => (clock.now += 1_000),
  });
  return { lock };
}

describe('unlocking, and never a lock-out', () => {
  it('a successful scan (or the passcode fallback) unlocks', async () => {
    const { lock, calls } = setup({ stored: { enabled: true } });
    await lock.unlock();
    expect(lock.getState()).toMatchObject({ locked: false, unlocking: false, problem: null });
    expect(calls).toEqual(['authenticate:Unlock Amani']);
  });

  it('a failed scan stays locked and says so; trying again works', async () => {
    const { lock } = setup({ stored: { enabled: true }, results: [{ ok: false, reason: 'failed' }] });
    await lock.unlock();
    expect(lock.getState()).toMatchObject({ locked: true, unlocking: false, problem: 'failed' });
    await lock.unlock();
    expect(lock.getState()).toMatchObject({ locked: false, problem: null });
  });

  it('a second unlock while the sheet is up is ignored (one system sheet at a time)', async () => {
    const { lock, calls } = setup({ stored: { enabled: true } });
    await Promise.all([lock.unlock(), lock.unlock()]);
    expect(calls).toEqual(['authenticate:Unlock Amani']);
  });

  it('if the phone no longer has any passcode or biometrics, the lock turns itself off rather than locking her out', async () => {
    const { lock, calls, stored, setBiometrics } = setup({ stored: { enabled: true }, results: [{ ok: false, reason: 'unavailable' }] });
    setBiometrics({ available: false, kind: null, deviceSecure: false });
    await lock.unlock();
    expect(lock.getState().locked).toBe(false);
    expect(stored().enabled).toBe(false);
    expect(calls).toContain('FLAG_SECURE:false');
  });

  it('biometrics unavailable but the phone still has a passcode: stays locked (the passcode or Sign out opens it)', async () => {
    const { lock, setBiometrics } = setup({ stored: { enabled: true }, results: [{ ok: false, reason: 'unavailable' }] });
    setBiometrics({ available: false, kind: null, deviceSecure: true });
    await lock.unlock();
    expect(lock.getState()).toMatchObject({ locked: true, problem: 'unavailable' });
  });

  it('with the flag switched off, a lock she turned on stays in force and can still be turned off', async () => {
    const { lock } = setup({ flag: false, stored: { enabled: true } });
    expect(lock.getState().locked).toBe(true);
    expect(await lock.availability()).toEqual({ show: true, canTurnOn: false, kind: 'faceId' });
    await lock.turnOff();
    expect(lock.getState().settings.enabled).toBe(false);
    expect(await lock.availability()).toEqual({ show: false, canTurnOn: false, kind: 'faceId' });
  });
});

describe('the onboarding offer (D15)', () => {
  it('shows on a phone with Face ID or a fingerprint, with the flag on', async () => {
    expect(await setup().lock.offerEligible()).toEqual({ eligible: true, kind: 'faceId' });
    expect(await setup({ biometrics: { available: true, kind: 'fingerprint', deviceSecure: true } }).lock.offerEligible())
      .toEqual({ eligible: true, kind: 'fingerprint' });
  });

  it('never on the web, with the flag off, without biometrics, once answered, or when already on', async () => {
    expect((await setup({ native: false }).lock.offerEligible()).eligible).toBe(false);
    expect((await setup({ flag: false }).lock.offerEligible()).eligible).toBe(false);
    expect((await setup({ biometrics: { available: false, kind: null, deviceSecure: true } }).lock.offerEligible()).eligible).toBe(false);
    expect((await setup({ stored: { offerAnswered: true } }).lock.offerEligible()).eligible).toBe(false);
    expect((await setup({ stored: { enabled: true } }).lock.offerEligible()).eligible).toBe(false);
  });

  it('"Not now" is remembered on this phone and leaves the lock off', async () => {
    const { lock, stored } = setup();
    lock.declineOffer();
    expect(stored()).toEqual({ enabled: false, relockAfter: '1m', offerAnswered: true });
    expect((await lock.offerEligible()).eligible).toBe(false);
  });

  it('Settings: hidden on the web; shown when she can turn it on', async () => {
    expect(await setup({ native: false }).lock.availability()).toEqual({ show: false, canTurnOn: false, kind: null });
    expect(await setup().lock.availability()).toEqual({ show: true, canTurnOn: true, kind: 'faceId' });
    expect(await setup({ flag: false }).lock.availability()).toEqual({ show: false, canTurnOn: false, kind: 'faceId' });
  });
});

describe('subscribers', () => {
  it('hear every change, and stop hearing after unsubscribing', async () => {
    const { lock } = setup({ stored: { enabled: true } });
    let heard = 0;
    const stop = lock.subscribe(() => { heard += 1; });
    await lock.unlock();
    expect(heard).toBeGreaterThan(0);
    const before = heard;
    stop();
    lock.setRelockAfter('5m');
    expect(heard).toBe(before);
  });
});
