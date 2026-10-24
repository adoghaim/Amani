/**
 * Google Analytics 4, privacy-safe and off by default.
 *
 * - Off unless VITE_GA4_ID is set at build time, and never on native builds.
 * - Consent Mode v2: everything denied by default; ad_storage, ad_user_data and
 *   ad_personalization are ALWAYS denied. analytics_storage is granted only
 *   after she accepts analytics on the cookie banner.
 * - gtag.js is not even fetched until consent is granted.
 * - Google signals and ad personalization are disabled.
 * - Only public marketing pages are measured (PUBLIC_ANALYTICS_PATHS). Auth,
 *   token/callback, checkout-return and every /app route are excluded, so no
 *   lab, report or account view is ever sent to Google.
 * - page_view is sent manually with a sanitized URL: no query string except
 *   utm_*, no fragment, ID-like path segments replaced with :id.
 * - No custom events. Do not add any that carry lab values, PII or health data.
 *
 * This is unrelated to the health-data consent ledger (features.consent_gate /
 * consent_current), which governs processing of lab data for signed-in users.
 */

export const ANALYTICS_CONSENT_KEY = 'amani.analytics_consent';
export const OPEN_ANALYTICS_CONSENT_EVENT = 'amani:analytics-consent-open';
/** Re-open the analytics banner (e.g. from a "Cookie settings" link). */
export function openAnalyticsConsent(): void {
  window.dispatchEvent(new Event(OPEN_ANALYTICS_CONSENT_EVENT));
}
export type AnalyticsChoice = 'granted' | 'denied';

/** Exact public paths that may be measured. Everything else is never sent. */
export const PUBLIC_ANALYTICS_PATHS: readonly string[] = ['/', '/pricing', '/privacy', '/terms', '/contact', '/delete-account'];

const GA4_ID_PATTERN = /^G-[A-Z0-9]{4,20}$/;

export function ga4MeasurementId(raw: string | undefined = import.meta.env.VITE_GA4_ID): string | null {
  const id = (raw ?? '').trim();
  return GA4_ID_PATTERN.test(id) ? id : null;
}

function normalizePath(pathname: string): string {
  const p = pathname.replace(/\/+$/, '');
  return p === '' ? '/' : p;
}

export function isMeasurablePath(pathname: string): boolean {
  return PUBLIC_ANALYTICS_PATHS.includes(normalizePath(pathname));
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NUMERIC = /^\d+$/;
const HEXISH = /^[0-9a-f]{12,}$/i;
// Long tokens: 16+ chars of base64url/JWT-ish alphabet containing a digit.
const TOKENISH = /^(?=.*\d)[A-Za-z0-9_\-.~=]{16,}$/;

export function sanitizePathSegment(segment: string): string {
  if (segment === '') return segment;
  let decoded = segment;
  try { decoded = decodeURIComponent(segment); } catch { /* keep raw */ }
  if (decoded.includes('@')) return ':id';
  if (UUID.test(decoded) || NUMERIC.test(decoded) || HEXISH.test(decoded) || TOKENISH.test(decoded)) return ':id';
  return segment;
}

export function sanitizePath(pathname: string): string {
  return normalizePath(pathname.split('/').map(sanitizePathSegment).join('/'));
}

/** Absolute URL with path IDs masked, fragment dropped and only utm_* kept. */
export function sanitizeUrl(href: string): { page_location: string; page_path: string } {
  const url = new URL(href);
  const page_path = sanitizePath(url.pathname);
  const kept = new URLSearchParams();
  url.searchParams.forEach((value, key) => {
    if (/^utm_[a-z_]+$/i.test(key) && !value.includes('@')) kept.append(key.toLowerCase(), value.slice(0, 100));
  });
  const qs = kept.toString();
  return { page_location: `${url.origin}${page_path}${qs ? `?${qs}` : ''}`, page_path };
}

/** URLs that carry auth material; never measured even if the path is public. */
export function looksLikeAuthUrl(href: string): boolean {
  const url = new URL(href);
  const blob = `${url.search}&${url.hash.replace(/^#/, '')}`.toLowerCase();
  return /(^|[?&])(access_token|refresh_token|id_token|token|token_hash|code|type|error_description|session_id|provider_token)=/.test(blob);
}

// ---- consent choice (localStorage) ----

export function readAnalyticsChoice(storage: Pick<Storage, 'getItem'> | undefined = safeStorage()): AnalyticsChoice | null {
  try {
    const v = storage?.getItem(ANALYTICS_CONSENT_KEY);
    return v === 'granted' || v === 'denied' ? v : null;
  } catch { return null; }
}

function safeStorage(): Storage | undefined {
  try { return typeof window !== 'undefined' ? window.localStorage : undefined; } catch { return undefined; }
}

// ---- gtag runtime ----

type Gtag = (...args: unknown[]) => void;
interface GaWindow { dataLayer?: unknown[]; gtag?: Gtag; [k: string]: unknown }

export interface Ga4Env {
  win: GaWindow;
  doc: Pick<Document, 'createElement' | 'head'>;
  measurementId: string | null;
  native: boolean;
}

let loadedFor: string | null = null;

/** Tests only. */
export function resetGa4ForTests(): void { loadedFor = null; }

/**
 * Called when the choice is known. Loads gtag only for 'granted'. On 'denied'
 * after a load, flips analytics_storage back to denied and disables the tag.
 * Returns whether gtag is (now) active.
 */
export function applyAnalyticsConsent(choice: AnalyticsChoice | null, env: Ga4Env): boolean {
  const { win, doc, measurementId, native } = env;
  if (!measurementId || native) return false;
  if (choice !== 'granted') {
    if (loadedFor) {
      win.gtag?.('consent', 'update', { analytics_storage: 'denied' });
      win[`ga-disable-${loadedFor}`] = true;
    }
    return false;
  }
  if (loadedFor === measurementId) {
    win[`ga-disable-${measurementId}`] = false;
    win.gtag?.('consent', 'update', { analytics_storage: 'granted' });
    return true;
  }
  win.dataLayer = win.dataLayer ?? [];
  // gtag must push the arguments object, as Google's snippet does.
  win.gtag = function gtag() { // eslint-disable-next-line prefer-rest-params
    (win.dataLayer as unknown[]).push(arguments);
  };
  win.gtag('consent', 'default', {
    ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied',
    analytics_storage: 'denied', functionality_storage: 'denied', personalization_storage: 'denied',
    security_storage: 'granted', wait_for_update: 500,
  });
  win.gtag('set', 'ads_data_redaction', true);
  win.gtag('consent', 'update', { analytics_storage: 'granted' });
  win.gtag('js', new Date());
  win.gtag('config', measurementId, {
    send_page_view: false,
    allow_google_signals: false,
    allow_ad_personalization_signals: false,
  });
  const script = doc.createElement('script');
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`;
  doc.head.appendChild(script);
  loadedFor = measurementId;
  return true;
}

/** Sends one sanitized page_view if active, consented, and the URL is measurable. */
export function trackPageView(href: string, title: string, env: Pick<Ga4Env, 'win' | 'measurementId'>, choice: AnalyticsChoice | null): boolean {
  if (!env.measurementId || loadedFor !== env.measurementId || choice !== 'granted') return false;
  const url = new URL(href);
  if (!isMeasurablePath(url.pathname) || looksLikeAuthUrl(href)) return false;
  const { page_location, page_path } = sanitizeUrl(href);
  env.win.gtag?.('event', 'page_view', { page_location, page_path, page_title: title.slice(0, 100), send_to: env.measurementId });
  return true;
}
