/**
 * The optional Face ID / fingerprint lock (PK-DEVICE-01 P1(3); owner decisions
 * D15, D16, R15). Pure: every device call comes through `DeviceLockPorts`, so
 * Vitest drives it with fakes. The app's instance is in ./index.ts.
 *
 * Rules:
 *   - Off by default. Turning it on asks for Face ID or a fingerprint once, so
 *     a lock that cannot be opened is never switched on.
 *   - Offering it (the onboarding step, D15) and turning it on need the
 *     features.biometric_lock flag and a phone with Face ID or a fingerprint
 *     set up. A lock she already turned on stays in force whatever the flag
 *     says, and she can always turn it off: the flag never silently removes
 *     protection she chose. (Recorded as a [Pending] question for the owner.)
 *   - A cold start always locks (D16). After she leaves the app, it locks
 *     again when she comes back after her re-lock time: Immediately, 1 minute
 *     (the default), 5 or 15 minutes.
 *   - Never a lock-out. The system sheet falls back to the phone's passcode.
 *     If the phone no longer has any passcode or biometrics, nothing can
 *     prove it is her and nothing protects the phone either, so the lock turns
 *     itself off. And the lock screen always offers Sign out: signing back in
 *     with her email and password is the recovery path.
 *   - Android: FLAG_SECURE is set while the lock is on, and cleared when it is
 *     turned off (R15).
 *   - A fresh sign-in is not locked: the lock applies to a session she already
 *     had when the app started or when she came back to it. The cold-start
 *     lock is dropped only on a definite sign-out (DeviceLockGate), never
 *     because a session could not be read yet (review F000).
 *   - Leaving the app with the lock on covers it at once (`covered`), so the
 *     last page is never what shows on return; 'Immediately' locks outright
 *     at that moment (F002). A clock set back counts as time up (F005).
 *   - Turning it off from Settings asks for Face ID, a fingerprint or the
 *     passcode first, unless the phone has none of them left (F006).
 *
 * The settings are per phone, in localStorage, which the OS deletes with the
 * app. They are not health data and not a secret.
 */
import type { BiometricKind, BiometricStatus, BiometricUnlockResult } from '../native';

export type RelockAfter = 'immediately' | '1m' | '5m' | '15m';

export const RELOCK_OPTIONS: readonly { value: RelockAfter; label: string; ms: number }[] = [
  { value: 'immediately', label: 'Immediately', ms: 0 },
  { value: '1m', label: 'After 1 minute', ms: 60_000 },
  { value: '5m', label: 'After 5 minutes', ms: 5 * 60_000 },
  { value: '15m', label: 'After 15 minutes', ms: 15 * 60_000 },
];

/** D16: the default re-lock time. */
export const DEFAULT_RELOCK_AFTER: RelockAfter = '1m';

export const LOCK_SETTINGS_STORAGE_KEY = 'amani.device-lock.v1';

/** The runtime flag that offers the lock (D5: a missing key is off). */
export const BIOMETRIC_LOCK_FLAG = 'biometric_lock';

export interface LockSettings {
  enabled: boolean;
  relockAfter: RelockAfter;
  /** She answered the onboarding offer ("Turn on" or "Not now") on this phone. */
  offerAnswered: boolean;
}

export const DEFAULT_LOCK_SETTINGS: LockSettings = Object.freeze({
  enabled: false,
  relockAfter: DEFAULT_RELOCK_AFTER,
  offerAnswered: false,
});

export type UnlockProblem = 'failed' | 'cancelled' | 'unavailable';

export interface LockState {
  settings: LockSettings;
  /** The lock screen is showing (for a signed-in session). */
  locked: boolean;
  /** The system sheet is up. */
  unlocking: boolean;
  /** Why the last unlock did not open the app, for the calm notice. */
  problem: UnlockProblem | null;
  /**
   * She left the app with the lock on: the app is hidden behind an opaque
   * cover until she is back and the re-lock decision is made (F002).
   */
  covered: boolean;
}

export interface DeviceLockPorts {
  isNative(): boolean;
  /** features.biometric_lock, after this launch's runtime config read. */
  flagOn(): Promise<boolean>;
  checkBiometrics(): Promise<BiometricStatus>;
  authenticate(reason: string): Promise<BiometricUnlockResult>;
  setScreenshotsBlocked(blocked: boolean): Promise<unknown>;
  storage(): Pick<Storage, 'getItem' | 'setItem'> | null;
  now(): number;
}

export interface LockAvailability {
  /** Show the lock in Settings. */
  show: boolean;
  /** She can turn it on from here (flag on, Face ID or fingerprint set up). */
  canTurnOn: boolean;
  kind: BiometricKind | null;
}

const RELOCK_VALUES = new Set<string>(RELOCK_OPTIONS.map(option => option.value));

/** Reads stored settings; anything malformed reads as the default (off). */
export function parseLockSettings(raw: string | null | undefined): LockSettings {
  if (!raw) return { ...DEFAULT_LOCK_SETTINGS };
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (typeof value !== 'object' || value === null) return { ...DEFAULT_LOCK_SETTINGS };
    return {
      enabled: value.enabled === true,
      relockAfter: typeof value.relockAfter === 'string' && RELOCK_VALUES.has(value.relockAfter)
        ? value.relockAfter as RelockAfter
        : DEFAULT_RELOCK_AFTER,
      offerAnswered: value.offerAnswered === true,
    };
  } catch {
    return { ...DEFAULT_LOCK_SETTINGS };
  }
}

export function relockDelayMs(relockAfter: RelockAfter): number {
  return RELOCK_OPTIONS.find(option => option.value === relockAfter)?.ms ?? 60_000;
}

/** How the lock names itself on this phone. */
export function lockMethodName(kind: BiometricKind | null): string {
  if (kind === 'faceId') return 'Face ID';
  if (kind === 'touchId') return 'Touch ID';
  // F007: Android cannot say which of its sensors she enrolled.
  if (kind === 'biometric') return 'biometric unlock';
  return 'your fingerprint';
}

export const UNLOCK_REASON = 'Unlock Amani';
export const TURN_ON_REASON = 'Turn on the lock for Amani';
export const TURN_OFF_REASON = 'Turn off the lock for Amani';

export interface DeviceLockController {
  getState(): LockState;
  subscribe(listener: () => void): () => void;
  /** Once per launch: applies FLAG_SECURE to match the stored setting. */
  start(): Promise<void>;
  /** Nobody is signed in: drop the cold-start lock, so a fresh sign-in is not locked. */
  noSession(): void;
  pause(): void;
  resume(): void;
  unlock(): Promise<void>;
  /** Turns the lock on after one successful scan. True when it is on. */
  turnOn(): Promise<boolean>;
  turnOff(): Promise<void>;
  /**
   * Settings: turns the lock off after one successful Face ID, fingerprint or
   * passcode check (F006). If the phone has none of those left, it turns off
   * without one, so she is never stuck with it. True when it is off.
   */
  confirmTurnOff(): Promise<boolean>;
  setRelockAfter(value: RelockAfter): void;
  /** "Not now" on the onboarding offer. */
  declineOffer(): void;
  /** The onboarding step shows (D15). */
  offerEligible(): Promise<{ eligible: boolean; kind: BiometricKind | null }>;
  availability(): Promise<LockAvailability>;
}

/** Her time away while the turn-off check is up (#163 note 1). */
interface TurnOffAway {
  /** She left during the check and is not back yet. */
  pausedAt: number | null;
  /** A time away during the check reached the re-lock time. */
  timeUp: boolean;
}

export function createDeviceLock(ports: DeviceLockPorts): DeviceLockController {
  const listeners = new Set<() => void>();

  function readSettings(): LockSettings {
    if (!ports.isNative()) return { ...DEFAULT_LOCK_SETTINGS };
    try {
      return parseLockSettings(ports.storage()?.getItem(LOCK_SETTINGS_STORAGE_KEY));
    } catch {
      return { ...DEFAULT_LOCK_SETTINGS };
    }
  }

  const initial = readSettings();
  // D16: a cold start always locks.
  let state: LockState = { settings: initial, locked: ports.isNative() && initial.enabled, unlocking: false, problem: null, covered: false };
  let pausedAt: number | null = null;
  // An unlock asked for while the app is in the background waits for her return.
  let unlockOnResume = false;
  // The system sheet is up. Android's passcode screen is its own activity, so
  // it pauses and resumes the app: those events must not re-lock it.
  let authInFlight = false;
  // The turn-off check is up: her time away is recorded, not dropped, so a
  // check that fails or is cancelled still re-locks when it should (#163 note 1).
  let turnOffAway: TurnOffAway | null = null;

  // F005: a clock set back (negative time away) counts as time up.
  function timeUp(away: number): boolean {
    return away < 0 || away >= relockDelayMs(state.settings.relockAfter);
  }

  async function authenticate(reason: string): Promise<BiometricUnlockResult> {
    authInFlight = true;
    try {
      return await ports.authenticate(reason);
    } finally {
      authInFlight = false;
      pausedAt = null;
    }
  }

  function set(next: Partial<LockState>) {
    state = { ...state, ...next };
    for (const listener of listeners) listener();
  }

  function saveSettings(settings: LockSettings) {
    if (!ports.isNative()) return;
    try {
      ports.storage()?.setItem(LOCK_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
    } catch {
      // Storage blocked: the setting holds for this launch only.
    }
    set({ settings });
  }

  async function availability(): Promise<LockAvailability> {
    if (!ports.isNative()) return { show: false, canTurnOn: false, kind: null };
    const [flag, biometrics] = await Promise.all([ports.flagOn(), ports.checkBiometrics()]);
    const canTurnOn = flag && biometrics.available;
    return { show: state.settings.enabled || canTurnOn, canTurnOn, kind: biometrics.kind };
  }

  async function turnOff() {
    if (!ports.isNative()) return;
    saveSettings({ ...state.settings, enabled: false });
    set({ locked: false, problem: null, covered: false });
    await ports.setScreenshotsBlocked(false);
  }

  /** Nothing left on the phone can prove it is her (no biometrics, no passcode). */
  async function nothingCanProveIt(): Promise<boolean> {
    const biometrics = await ports.checkBiometrics();
    return !biometrics.deviceSecure && !biometrics.available;
  }

  async function unlock() {
    if (!state.locked || state.unlocking) return;
    if (pausedAt !== null) {
      // The lock screen opened while she is away ('Immediately'): ask on return.
      unlockOnResume = true;
      return;
    }
    set({ unlocking: true, problem: null });
    const result = await authenticate(UNLOCK_REASON);
    if (result.ok) {
      set({ locked: false, unlocking: false, problem: null });
      return;
    }
    if (result.reason === 'unavailable' && await nothingCanProveIt()) {
      // Never a lock-out.
      set({ unlocking: false });
      await turnOff();
      return;
    }
    set({ unlocking: false, problem: result.reason });
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    async start() {
      if (!ports.isNative()) return;
      await ports.setScreenshotsBlocked(state.settings.enabled);
    },
    noSession() {
      if (state.locked) set({ locked: false, problem: null });
    },
    pause() {
      if (!ports.isNative()) return;
      if (turnOffAway) {
        turnOffAway.pausedAt = ports.now();
        return;
      }
      if (authInFlight) return;
      pausedAt = ports.now();
      if (!state.settings.enabled) return;
      // F002: cover the app now, not on return; 'Immediately' locks now.
      if (relockDelayMs(state.settings.relockAfter) === 0 && !state.locked) set({ covered: true, locked: true, problem: null });
      else set({ covered: true });
    },
    resume() {
      if (!ports.isNative()) return;
      if (turnOffAway) {
        if (turnOffAway.pausedAt !== null && timeUp(ports.now() - turnOffAway.pausedAt)) turnOffAway.timeUp = true;
        turnOffAway.pausedAt = null;
        return;
      }
      if (authInFlight) return;
      const left = pausedAt;
      pausedAt = null;
      const ask = unlockOnResume;
      unlockOnResume = false;
      if (!state.settings.enabled || left === null) {
        if (state.covered) set({ covered: false });
        return;
      }
      const expired = timeUp(ports.now() - left);
      set(expired ? { covered: false, locked: true, problem: null } : { covered: false });
      if (ask && state.locked) void unlock();
    },
    unlock,
    async turnOn() {
      const { canTurnOn } = await availability();
      if (!canTurnOn) return false;
      const result = await authenticate(TURN_ON_REASON);
      if (!result.ok) return false;
      saveSettings({ ...state.settings, enabled: true, offerAnswered: true });
      await ports.setScreenshotsBlocked(true);
      return true;
    },
    turnOff,
    async confirmTurnOff() {
      if (!ports.isNative()) return false;
      if (!state.settings.enabled) return true;
      const away: TurnOffAway = { pausedAt: null, timeUp: false };
      turnOffAway = away;
      let proven: boolean;
      try {
        const result = await authenticate(TURN_OFF_REASON);
        proven = result.ok || (result.reason === 'unavailable' && await nothingCanProveIt());
      } finally {
        turnOffAway = null;
      }
      if (!proven) {
        // Still on: her time away during the check counts as resume() counts it.
        if (state.settings.enabled) {
          if (away.timeUp) set({ covered: false, locked: true, problem: null });
          else if (away.pausedAt !== null) pausedAt = away.pausedAt;
        }
        return false;
      }
      await turnOff();
      return true;
    },
    setRelockAfter(value) {
      if (!RELOCK_VALUES.has(value)) return;
      saveSettings({ ...state.settings, relockAfter: value });
    },
    declineOffer() {
      saveSettings({ ...state.settings, offerAnswered: true });
    },
    async offerEligible() {
      if (!ports.isNative() || state.settings.enabled || state.settings.offerAnswered) return { eligible: false, kind: null };
      const { canTurnOn, kind } = await availability();
      return { eligible: canTurnOn, kind };
    },
    availability,
  };
}
