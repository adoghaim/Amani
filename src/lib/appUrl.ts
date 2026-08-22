/**
 * The canonical public origin for links that have to survive leaving the app.
 *
 * Password-reset emails and Stripe redirects are handed to systems outside the
 * webview, which then hand a URL back. Inside a Capacitor webview
 * `window.location.origin` is the internal scheme origin (`https://localhost`),
 * which is unreachable from a mail client or from Stripe — so on native we must
 * emit the real public domain. That domain is also what universal/app links
 * verify against, so this and `deepLinks.ts` describe the same host.
 */

import { isNative } from './native';

/** Used on native when VITE_APP_URL is unset. Must be a host listed in
 *  DEEP_LINK_HOSTS, or the round trip opens a browser instead of the app. */
const FALLBACK_PUBLIC_ORIGIN = 'https://amanibiometrics.com';

export function publicOrigin(): string {
  const configured = import.meta.env.VITE_APP_URL?.trim();
  if (configured) return configured.replace(/\/+$/, '');
  if (isNative()) return FALLBACK_PUBLIC_ORIGIN;
  return window.location.origin;
}

/** Absolute public URL for an in-app path, e.g. publicUrl('/success'). */
export function publicUrl(path: string): string {
  return `${publicOrigin()}${path.startsWith('/') ? path : `/${path}`}`;
}
