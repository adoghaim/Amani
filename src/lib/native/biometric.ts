import { isNative } from './platform';

// ─── Biometrics: Face ID / Touch ID / fingerprint, with passcode fallback ──

/** What the phone can unlock Amani with. Only Face ID and fingerprints count (D15). */
export type BiometricKind = 'faceId' | 'touchId' | 'fingerprint';

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
 */
export async function checkBiometrics(): Promise<BiometricStatus> {
  if (!isNative()) return NONE;
  try {
    const { BiometricAuth, BiometryType } = await import('@aparajita/capacitor-biometric-auth');
    const result = await BiometricAuth.checkBiometry();
    const types = result.biometryTypes?.length ? result.biometryTypes : [result.biometryType];
    const kind: BiometricKind | null = types.includes(BiometryType.faceId)
      ? 'faceId'
      : types.includes(BiometryType.touchId)
        ? 'touchId'
        : types.includes(BiometryType.fingerprintAuthentication)
          ? 'fingerprint'
          : null;
    return { available: result.isAvailable && kind !== null, kind, deviceSecure: result.deviceIsSecure };
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
    const { BiometricAuth } = await import('@aparajita/capacitor-biometric-auth');
    await BiometricAuth.authenticate({
      reason,
      cancelTitle: 'Cancel',
      allowDeviceCredential: true,
      iosFallbackTitle: 'Use passcode',
      androidTitle: 'Unlock Amani',
      androidConfirmationRequired: false,
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
