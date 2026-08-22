/**
 * Deep-link routing for iOS universal links and Android app links.
 *
 * The OS hands the app the full https:// URL that was tapped; this module
 * translates it into an in-app route. It is deliberately pure — no Capacitor
 * imports, no navigation — so the routing and rejection rules can be unit
 * tested without a native runtime.
 */

/**
 * Hosts whose links this app claims. Must stay in sync with the
 * `com.apple.developer.associated-domains` entitlement and the Android
 * intent filter — a host listed in one place but not the others either fails
 * to route or fails verification, both silently.
 */
export const DEEP_LINK_HOSTS: readonly string[] = [
  'amanibiometrics.com',
  'www.amanibiometrics.com',
];

/**
 * Paths the app handles. Must stay in sync with the `components` array in
 * `public/.well-known/apple-app-site-association`: a path claimed here but not
 * there never reaches the app, and a path claimed there but not here opens the
 * app and then dead-ends.
 */
export const DEEP_LINK_PATHS: readonly string[] = ['/reset-password', '/success'];

/**
 * Maps an incoming universal/app link to an in-app route.
 *
 * Returns null for anything this app does not claim, which the caller must
 * treat as "ignore" rather than "navigate anyway" — the OS can hand us a URL
 * from any source, so this doubles as the trust boundary that keeps an
 * attacker-supplied link from steering navigation.
 */
export function deepLinkTarget(rawUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }

  // https only — a custom scheme or http:// link is not something we verified.
  if (url.protocol !== 'https:') return null;
  if (!DEEP_LINK_HOSTS.includes(url.hostname.toLowerCase())) return null;

  const path = url.pathname.replace(/\/+$/, '') || '/';
  if (!DEEP_LINK_PATHS.includes(path)) return null;

  // Preserve BOTH query and hash. Supabase recovery links carry their tokens in
  // one or the other depending on the flow (`?code=` for PKCE, `#access_token=`
  // for the implicit flow), and Stripe appends `?session_id=`. Dropping either
  // lands the user on a tokenless screen that looks broken.
  return `${path}${url.search}${url.hash}`;
}
