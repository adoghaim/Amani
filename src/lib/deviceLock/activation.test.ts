// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const env = vi.hoisted(() => ({ native: true, deviceCall: vi.fn(), flag: vi.fn() }));
vi.mock('../native', () => ({
  isNative: () => env.native,
  checkBiometrics: env.deviceCall,
  authenticateWithBiometrics: env.deviceCall,
  setScreenshotsBlocked: env.deviceCall,
}));
vi.mock('../runtimeConfig', () => ({ loadRuntimeConfig: env.flag, isFeatureEnabled: () => true }));
beforeEach(() => { vi.resetModules(); vi.clearAllMocks(); localStorage.clear(); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it.each([
  [false, '1.0.7'], [false, '2.0.0'], [true, '1.0.6'], [true, '1.0.6.1'], [true, 'broken'],
] as const)('inactive native=%s release=%s never reads/writes lock settings or calls device APIs', async (native, version) => {
  env.native = native;
  vi.stubGlobal('__APP_RELEASE__', `amani@${version}+abcdef0`);
  const raw = '{"enabled":true,"relockAfter":"immediately"}';
  localStorage.setItem('amani.device-lock.v1', raw);
  const read = vi.spyOn(Storage.prototype, 'getItem');
  const write = vi.spyOn(Storage.prototype, 'setItem');
  const remove = vi.spyOn(Storage.prototype, 'removeItem');
  const { deviceLock } = await import('./index');
  await deviceLock.start();
  deviceLock.pause();
  deviceLock.resume();
  await deviceLock.unlock();
  expect(await deviceLock.turnOn()).toBe(false);
  await deviceLock.turnOff();
  expect(await deviceLock.confirmTurnOff()).toBe(false);
  deviceLock.setRelockAfter('5m');
  deviceLock.declineOffer();
  expect(await deviceLock.offerEligible()).toStrictEqual({ eligible: false, kind: null });
  expect(await deviceLock.availability()).toStrictEqual({ show: false, canTurnOn: false, kind: null });
  expect(deviceLock.getState().locked).toBe(false);
  expect(deviceLock.getState().settings.enabled).toBe(false);
  expect(read).not.toHaveBeenCalled();
  expect(write).not.toHaveBeenCalled();
  expect(remove).not.toHaveBeenCalled();
  expect(env.deviceCall).not.toHaveBeenCalled();
  expect(env.flag).not.toHaveBeenCalled();
  expect(localStorage.getItem('amani.device-lock.v1')).toBe(raw);
});
