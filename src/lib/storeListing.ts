/**
 * Where "Update" sends her: Amani's own store listing (PK-MINVER-01, D8).
 *
 * Android: the Play listing for the package `com.amani.health`
 * (capacitor.config.ts appId, android/app/build.gradle applicationId).
 *
 * iOS: the App Store listing needs the app's numeric App Store id
 * (App Store Connect "Apple ID"). It is not recorded anywhere in the repository
 * ([Pending] for the owner). Until it is set below, the button opens the App
 * Store app itself, where Updates lists Amani. Set APP_STORE_ID before ever
 * setting min_version_ios (docs/runtime-config.md).
 */

export type StorePlatform = 'ios' | 'android';

export const PLAY_PACKAGE_NAME = 'com.amani.health';

/** The numeric App Store id, digits only. null until the owner supplies it. */
export const APP_STORE_ID: string | null = null;

/** Opens the App Store app (no listing) when APP_STORE_ID is not set. */
export const APP_STORE_FALLBACK_URL = 'itms-apps://apps.apple.com/';

export function storeListingUrl(platform: StorePlatform, appStoreId: string | null = APP_STORE_ID): string {
  if (platform === 'android') {
    return `https://play.google.com/store/apps/details?id=${PLAY_PACKAGE_NAME}`;
  }
  return appStoreId && /^[0-9]+$/.test(appStoreId)
    ? `https://apps.apple.com/app/id${appStoreId}`
    : APP_STORE_FALLBACK_URL;
}

/** The store's name as she knows it, for button labels and the offline line. */
export function storeName(platform: StorePlatform): string {
  return platform === 'ios' ? 'the App Store' : 'Google Play';
}
