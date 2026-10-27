import { isNative } from './platform';

// ─── Biometrics: Face ID / Touch ID / fingerprint, with passcode fallback ──

/**
 * What the phone can unlock Amani with. Only Face ID and fingerprints count (D15).
 * 'biometric': an Android phone with a fingerprint sensor and another sensor
 * (face or iris), where Android cannot say which one she enrolled (F007).
 */
export type BiometricKind = 'faceId' | 'touchId' | 'fingerprint' | 'biometric';

export interface BiometricStatus {
  /** Face ID or a fingerprint is set up and usable. */
  available: boolean;
  kind: BiometricKind | null;
  /** The phone has a passcode, PIN or pattern. */
  deviceSecure: boolean;
}

export type BiometricUnlockResult =
  | { ok: true }
  | { ok: false; reason: 'cancelled' | 'failed' | 'unavailable' };

const NONE: BiometricStatus = { available: false, kind: null, deviceSecure: false };

/**
 * Whether the phone has Face ID or a fingerprint set up. The web, and any
 * error, reads as unavailable. Never throws.
 *
 * F007: only strong (Class 3) biometrics count, so Android's weak face unlock
 * never opens Amani. Android lists sensor hardware, not what is enrolled, so a
 * phone with a fingerprint sensor and a face or iris sensor gets the generic
 * name rather than "fingerprint".
 */
export async function checkBiometrics(): Promise<BiometricStatus> {
  if (!isNative()) return NONE;
  try {
    const { BiometricAuth, BiometryType } = await import('@aparajita/capacitor-biometric-auth');
    const result = await BiometricAuth.checkBiometry();
    const types = result.biometryTypes?.length ? result.biometryTypes : [result.biometryType];
    const otherSensor = types.includes(BiometryType.faceAuthentication) || types.includes(BiometryType.irisAuthentication);
    const kind: BiometricKind | null = types.includes(BiometryType.faceId)
      ? 'faceId'
      : types.includes(BiometryType.touchId)
        ? 'touchId'
        : types.includes(BiometryType.fingerprintAuthentication)
          ? (otherSensor ? 'biometric' : 'fingerprint')
          : null;
    return { available: result.strongBiometryIsAvailable === true && kind !== null, kind, deviceSecure: result.deviceIsSecure };
  } catch {
    return NONE;
  }
}

/**
 * Asks the system for Face ID or a fingerprint, with the phone's passcode as
 * the fallback (`allowDeviceCredential`), so a failed scan never strands her.
 * Never throws.
 */
export async function authenticateWithBiometrics(reason: string): Promise<BiometricUnlockResult> {
  if (!isNative()) return { ok: false, reason: 'unavailable' };
  try {
    const { AndroidBiometryStrength, BiometricAuth } = await import('@aparajita/capacitor-biometric-auth');
    await BiometricAuth.authenticate({
      reason,
      cancelTitle: 'Cancel',
      allowDeviceCredential: true,
      iosFallbackTitle: 'Use passcode',
      androidTitle: 'Unlock Amani',
      androidConfirmationRequired: false,
      // F007: strong (Class 3) biometrics only; the passcode stays the fallback.
      androidBiometryStrength: AndroidBiometryStrength.strong,
    });
    return { ok: true };
  } catch (error: unknown) {
    const code = typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined;
    if (code === 'userCancel' || code === 'appCancel' || code === 'systemCancel') return { ok: false, reason: 'cancelled' };
    if (code === 'biometryNotAvailable' || code === 'biometryNotEnrolled' || code === 'passcodeNotSet' || code === 'noDeviceCredential') {
      return { ok: false, reason: 'unavailable' };
    }
    return { ok: false, reason: 'failed' };
  }
}
