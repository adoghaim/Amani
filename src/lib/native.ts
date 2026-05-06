/**
 * Safe wrappers for Capacitor native APIs.
 *
 * Every function checks Capacitor.isNativePlatform() before calling plugin APIs
 * so the web build always works without any native runtime present.
 *
 * Import from this file, never import Capacitor plugins directly in components.
 */

import { Capacitor } from '@capacitor/core';

// ─── Platform detection ────────────────────────────────────────────────────

export const isNative = () => Capacitor.isNativePlatform();
export const platform = () => Capacitor.getPlatform(); // 'ios' | 'android' | 'web'

// ─── Browser: open external URLs in the in-app browser ────────────────────

/**
 * Opens a URL. On native, uses the Capacitor Browser plugin (SFSafariViewController
 * on iOS, Chrome Custom Tabs on Android). On web, falls back to window.open.
 */
export async function openExternalUrl(url: string): Promise<void> {
  if (isNative()) {
    const { Browser } = await import('@capacitor/browser');
    await Browser.open({ url, presentationStyle: 'popover' });
  } else {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}

// ─── Camera: capture a photo for lab report scanning ──────────────────────

export type CameraResult =
  | { ok: true; base64: string }
  | { ok: false; cancelled: boolean; error?: string };

/**
 * Prompts the user to take a photo or pick from the gallery.
 * Returns a base64-encoded JPEG string (without the data: prefix) on success.
 * Always returns a typed result — never throws.
 */
export async function captureLabPhoto(): Promise<CameraResult> {
  if (!isNative()) {
    return { ok: false, cancelled: false, error: 'Camera not available on web' };
  }

  try {
    const { Camera, CameraResultType, CameraSource } = await import('@capacitor/camera');
    const photo = await Camera.getPhoto({
      resultType: CameraResultType.Base64,
      source: CameraSource.Prompt,   // asks user: Camera or Photos
      quality: 85,
      correctOrientation: true,
      // No width/height constraint — we want full resolution for OCR accuracy
    });

    if (!photo.base64String) {
      return { ok: false, cancelled: false, error: 'No image data returned' };
    }

    // Prefix the base64 string so it can go straight into an <img src> or fetch body
    const mimeType = photo.format === 'png' ? 'image/png' : 'image/jpeg';
    return { ok: true, base64: `data:${mimeType};base64,${photo.base64String}` };
  } catch (err: unknown) {
    // User cancelled — Camera plugin throws with message containing 'cancel'
    const message = err instanceof Error ? err.message : undefined;
    const cancelled =
      typeof message === 'string' &&
      (message.toLowerCase().includes('cancel') ||
        message.toLowerCase().includes('dismiss'));
    return { ok: false, cancelled, error: message };
  }
}

// ─── Network: connectivity awareness ──────────────────────────────────────

export type NetworkStatus = { connected: boolean; connectionType: string };

/**
 * Returns the current network status.
 * Falls back to navigator.onLine on web.
 */
export async function getNetworkStatus(): Promise<NetworkStatus> {
  if (isNative()) {
    const { Network } = await import('@capacitor/network');
    const status = await Network.getStatus();
    return { connected: status.connected, connectionType: status.connectionType };
  }
  return { connected: navigator.onLine, connectionType: 'unknown' };
}

/**
 * Subscribes to network status changes.
 * Returns an unsubscribe function — call it on component unmount.
 */
export function onNetworkChange(
  callback: (status: NetworkStatus) => void
): () => void {
  if (isNative()) {
    let handle: { remove: () => void } | null = null;

    import('@capacitor/network').then(({ Network }) => {
      Network.addListener('networkStatusChange', (status) => {
        callback({ connected: status.connected, connectionType: status.connectionType });
      }).then((h) => {
        handle = h;
      });
    });

    return () => handle?.remove();
  }

  // Web fallback
  const onOnline  = () => callback({ connected: true,  connectionType: 'unknown' });
  const onOffline = () => callback({ connected: false, connectionType: 'none' });
  window.addEventListener('online',  onOnline);
  window.addEventListener('offline', onOffline);
  return () => {
    window.removeEventListener('online',  onOnline);
    window.removeEventListener('offline', onOffline);
  };
}

// ─── Secure storage stub ──────────────────────────────────────────────────

/**
 * Thin abstraction over storage that is ready to swap to a secure-storage
 * implementation (e.g. @ionic-enterprise/identity-vault) without touching
 * call sites.
 *
 * For Phase 4, this delegates to localStorage (same as Supabase's default).
 * A future phase can replace the implementation here to use the secure enclave.
 */
export const secureStorage = {
  async get(key: string): Promise<string | null> {
    return localStorage.getItem(key);
  },
  async set(key: string, value: string): Promise<void> {
    localStorage.setItem(key, value);
  },
  async remove(key: string): Promise<void> {
    localStorage.removeItem(key);
  },
};
