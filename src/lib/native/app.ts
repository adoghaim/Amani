import { isNative } from './platform';

// ─── Deep links: universal links (iOS) / app links (Android) ──────────────

/**
 * Subscribes to inbound universal/app links. The callback receives the raw
 * https:// URL the OS was asked to open; translate it with
 * `deepLinkTarget()` from `lib/deepLinks` before navigating.
 *
 * Also drains the launch URL, because a link that cold-starts the app can fire
 * before any listener is attached — without this, tapping a reset link with the
 * app closed silently does nothing.
 *
 * Returns an unsubscribe function — call it on component unmount.
 */
export function onAppUrlOpen(callback: (url: string) => void): () => void {
  if (!isNative()) return () => {};

  let handle: { remove: () => void } | null = null;
  let cancelled = false;

  import('@capacitor/app').then(async ({ App: CapApp }) => {
    if (cancelled) return;

    const launchUrl = await CapApp.getLaunchUrl();
    if (!cancelled && launchUrl?.url) callback(launchUrl.url);

    const h = await CapApp.addListener('appUrlOpen', ({ url }) => callback(url));
    if (cancelled) h.remove();
    else handle = h;
  });

  return () => {
    cancelled = true;
    handle?.remove();
  };
}
