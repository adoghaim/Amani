import { useSyncExternalStore } from 'react';
import {
  authenticateWithBiometrics, checkBiometrics, isNative, setScreenshotsBlocked,
} from '../native';
import { isFeatureEnabled, loadRuntimeConfig } from '../runtimeConfig';
import { BIOMETRIC_LOCK_FLAG, createDeviceLock, type LockState } from './lockController';

import { isDeviceLockActive } from './release';

export * from './lockController';

/** The app's one device lock, wired to the phone (PK-DEVICE-01). */
export const deviceLock = createDeviceLock({
  isNative: () => isDeviceLockActive(isNative()),
  async flagOn() {
    await loadRuntimeConfig();
    return isFeatureEnabled(BIOMETRIC_LOCK_FLAG);
  },
  checkBiometrics,
  authenticate: authenticateWithBiometrics,
  setScreenshotsBlocked,
  storage: () => (typeof window === 'undefined' ? null : window.localStorage),
  now: () => Date.now(),
});

/** The lock's state, re-rendering on every change. */
export function useDeviceLock(): LockState {
  return useSyncExternalStore(deviceLock.subscribe, deviceLock.getState, deviceLock.getState);
}
