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

// ─── Lifecycle: leaving and returning to the app ──────────────────────────

export interface AppLifecycleHandlers {
  /** She left the app (it went to the background). */
  onPause: () => void;
  /** She came back to it. */
  onResume: () => void;
}

/**
 * Subscribes to the app going to the background and coming back (the
 * Capacitor `pause` and `resume` events). These are not `appStateChange`: on
 * iOS that also fires for the Face ID sheet and Control Center, which would
 * re-lock the app in the middle of unlocking it. A no-op on the web.
 *
 * Returns an unsubscribe function.
 */
export function onAppLifecycle(handlers: AppLifecycleHandlers): () => void {
  if (!isNative()) return () => {};

  const handles: { remove: () => void }[] = [];
  let cancelled = false;

  import('@capacitor/app').then(async ({ App: CapApp }) => {
    if (cancelled) return;
    const paused = await CapApp.addListener('pause', () => handlers.onPause());
    if (cancelled) { paused.remove(); return; }
    handles.push(paused);
    const resumed = await CapApp.addListener('resume', () => handlers.onResume());
    if (cancelled) resumed.remove();
    else handles.push(resumed);
  });

  return () => {
    cancelled = true;
    for (const h of handles.splice(0)) h.remove();
  };
}

// ─── Hardware back button (Android) ───────────────────────────────────────

export interface BackButtonEvent {
  /** Whether the web view has history to go back to. */
  canGoBack: boolean;
  /** Closes the app. Only call it once nothing else should take the press. */
  exitApp: () => void;
}

/**
 * Subscribes to the Android hardware back button (Capacitor `backButton`).
 * While a listener is attached the button no longer navigates or exits by
 * itself, so the handler owns every press. A no-op on the web.
 *
 * Releasing before the plugin has loaded (the screen changed, or React's
 * StrictMode ran the effect twice) still removes the listener, which the
 * `cancelled` flag guarantees: otherwise a stale listener stays live and one
 * press runs two handlers.
 *
 * Returns an unsubscribe function.
 */
export function onBackButton(handler: (event: BackButtonEvent) => void): () => void {
  if (!isNative()) return () => {};

  let handle: { remove: () => void } | null = null;
  let cancelled = false;

  import('@capacitor/app').then(async ({ App: CapApp }) => {
    if (cancelled) return;
    const h = await CapApp.addListener('backButton', ({ canGoBack }) => {
      handler({ canGoBack, exitApp: () => { void CapApp.exitApp(); } });
    });
    if (cancelled) h.remove();
    else handle = h;
  }).catch(() => {});

  return () => {
    cancelled = true;
    handle?.remove();
  };
}
