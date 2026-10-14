import { isNative, platform } from './platform';

// ─── App version and the store listing (PK-MINVER-01, D8) ─────────────────

export interface InstalledAppInfo {
  platform: 'ios' | 'android';
  /** The marketing version, for example "1.0.6". */
  version: string;
  /** The build number, for example "8". */
  build: string;
}

/**
 * The installed app's version and build, from App.getInfo(). Resolves null on
 * web (the web app is never gated), on a platform other than iOS or Android,
 * and whenever the plugin fails: the gate then fails open.
 */
export async function getInstalledAppInfo(): Promise<InstalledAppInfo | null> {
  if (!isNative()) return null;
  const current = platform();
  if (current !== 'ios' && current !== 'android') return null;
  try {
    const { App } = await import('@capacitor/app');
    const info = await App.getInfo();
    return { platform: current, version: String(info.version ?? ''), build: String(info.build ?? '') };
  } catch {
    return null;
  }
}

/**
 * Opens a store listing in the store app. Native only, and a no-op on web.
 *
 * It navigates the web view rather than using the in-app browser: Capacitor
 * hands a navigation to another host (and the itms-apps: scheme) to the OS,
 * which opens the App Store or Play Store app, where the in-app browser would
 * show the store's web page instead.
 */
export function openStoreListing(url: string): void {
  if (!isNative()) return;
  window.location.assign(url);
}

/**
 * While a full-screen gate that has no "back" holds the app (the update
 * block), the Android back button closes the app instead of navigating behind
 * it. Returns the function that releases the button. No-op on web and iOS.
 */
export function exitAppOnBackButton(): () => void {
  if (!isNative() || platform() !== 'android') return () => {};
  let handle: { remove: () => void } | null = null;
  let released = false;
  import('@capacitor/app').then(async ({ App }) => {
    const h = await App.addListener('backButton', () => { void App.exitApp(); });
    if (released) h.remove();
    else handle = h;
  }).catch(() => {});
  return () => {
    released = true;
    handle?.remove();
  };
}
