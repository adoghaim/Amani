import { isNative } from './platform';

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
