import { registerPlugin } from '@capacitor/core';
import { isNative, platform } from './platform';

// ─── Screenshot blocking while the lock is on (R15) ───────────────────────

/**
 * The app's own local plugin, `AmaniPrivacy`, registered in Android's
 * MainActivity (android/app/src/main/java/com/amani/health/PrivacyPlugin.java).
 * It sets or clears FLAG_SECURE, which hides Amani in the app switcher and
 * blocks screenshots, screen recording and screen sharing.
 *
 * R15 (owner, 2026-10-12): FLAG_SECURE is on, on every Android version, only
 * while the biometric lock is on. Every user on Android 13+ is hidden in the
 * app switcher anyway (setRecentsScreenshotEnabled(false) in MainActivity), and
 * iOS shows the splash when the app resigns active (AppDelegate). Neither of
 * those needs a call from here. Lock-off users on Android 7-12 keep a preview:
 * the accepted gap.
 */
interface AmaniPrivacyPlugin {
  setSecure(options: { secure: boolean }): Promise<void>;
}

let plugin: AmaniPrivacyPlugin | null = null;

/**
 * Android: blocks or allows screenshots (FLAG_SECURE). iOS and the web: a
 * no-op. Never throws; returns whether the setting reached the phone.
 */
export async function setScreenshotsBlocked(blocked: boolean): Promise<boolean> {
  if (!isNative() || platform() !== 'android') return false;
  try {
    plugin ??= registerPlugin<AmaniPrivacyPlugin>('AmaniPrivacy');
    await plugin.setSecure({ secure: blocked });
    return true;
  } catch {
    return false;
  }
}
