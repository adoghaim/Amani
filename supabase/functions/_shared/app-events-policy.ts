/**
 * First-party events and signup attribution: the allow-lists (PK-EXP5, EXP-5;
 * owner decisions D5.3, D6.1, D6.2, D17, D29, R12).
 *
 * THE single source of truth for which events and which prop keys exist. Read
 * by:
 *   - the edge functions (log-anon-event, and the server-side events in
 *     stripe-webhook, iap-webhook, generate-interpretation, delete-user-data)
 *     through app-events.ts;
 *   - the client (src/lib/events/firstPartyEvents.ts), which imports this file;
 *   - the migration 20261015010000_first_party_events.sql, whose SQL functions
 *     app_events_allowed_events(), app_events_client_events(),
 *     app_events_anon_events() and app_events_allowed_prop_keys() carry the
 *     same lists. SQL cannot import TypeScript, so app-events-policy.test.ts
 *     parses those functions out of the migration and fails when the two differ.
 *
 * Plain TypeScript: no Deno, npm or DOM import, so Vitest, Deno and Vite can
 * all load it.
 *
 * Privacy (src/pages/Privacy.tsx): no third-party tracker, no fingerprinting,
 * and never a health value, lab data or free text. Every prop value is a short
 * token from a strict charset, or a small whole number (report_index), so free
 * text cannot get in.
 */

/** Every event the ledger accepts (the SQL CHECK). */
export const APP_EVENTS = [
  "landing_view",
  "signup_started",
  "signup_completed",
  "onboarding_completed",
  "upload_started",
  "report_parsed",
  "interpretation_generated",
  "report_viewed",
  "compare_viewed",
  "paywall_viewed",
  "checkout_started",
  "trial_started",
  "subscription_activated",
  "account_deleted",
] as const;

export type AppEvent = typeof APP_EVENTS[number];

/** Pre-signup events: only these reach log-anon-event (D5.3). */
export const ANON_EVENTS = ["landing_view", "signup_started"] as const satisfies readonly AppEvent[];

/**
 * Written by edge functions with the service role, never by a client: a
 * signed-in user must not be able to claim a trial or a subscription.
 */
export const SERVER_EVENTS = [
  "interpretation_generated",
  "trial_started",
  "subscription_activated",
  "account_deleted",
] as const satisfies readonly AppEvent[];

/** What a signed-in client may log through log_app_event: the rest. */
export const CLIENT_EVENTS = [
  "signup_completed",
  "onboarding_completed",
  "upload_started",
  "report_parsed",
  "report_viewed",
  "compare_viewed",
  "paywall_viewed",
  "checkout_started",
] as const satisfies readonly AppEvent[];

export type AnonEvent = typeof ANON_EVENTS[number];
export type ServerEvent = typeof SERVER_EVENTS[number];
export type ClientEvent = typeof CLIENT_EVENTS[number];

/** Every prop key the ledger accepts. Anything else is rejected, not stripped. */
export const APP_EVENT_PROP_KEYS = [
  "platform",
  "app_version",
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
  "promo",
  "ref",
  "report_index",
  "tier",
] as const;

export type AppEventPropKey = typeof APP_EVENT_PROP_KEYS[number];
export type AppEventProps = Partial<Record<AppEventPropKey, string | number>>;

/** First-touch URL parameters the client captures (utm_* plus promo and ref). */
export const ATTRIBUTION_PARAMS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
  "promo",
  "ref",
] as const;

export type AttributionParam = typeof ATTRIBUTION_PARAMS[number];

/**
 * Every attribution, UTM, code and token prop value (D5.3): attacker-controlled,
 * so a strict charset and at most 64 characters, rejected otherwise.
 */
export const CODE_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;
export const CODE_MAX_LENGTH = 64;

/** The per-device random id for pre-signup events: 16 to 64 of [A-Za-z0-9_-]. */
export const ANON_ID_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;

/** report_index: the how-many-th report, a whole number 0..10000. Never a value from it. */
export const REPORT_INDEX_MAX = 10000;

/** props, serialised as JSON text, may not exceed this many bytes (the SQL CHECK too). */
export const PROPS_MAX_BYTES = 1024;

/** landing_path: a path only (no query, no fragment), at most 256 characters. */
export const LANDING_PATH_PATTERN = /^\/[A-Za-z0-9._~\/-]{0,255}$/;

export function isCode(value: unknown): value is string {
  return typeof value === "string" && CODE_PATTERN.test(value);
}

export function isAppEvent(value: unknown): value is AppEvent {
  return typeof value === "string" && (APP_EVENTS as readonly string[]).includes(value);
}

export function isAnonEvent(value: unknown): value is AnonEvent {
  return typeof value === "string" && (ANON_EVENTS as readonly string[]).includes(value);
}

export function isClientEvent(value: unknown): value is ClientEvent {
  return typeof value === "string" && (CLIENT_EVENTS as readonly string[]).includes(value);
}

export function isServerEvent(value: unknown): value is ServerEvent {
  return typeof value === "string" && (SERVER_EVENTS as readonly string[]).includes(value);
}

export type PropsCheck =
  | { ok: true; props: AppEventProps }
  | { ok: false; reason: string };

/**
 * The props rule, the same one the SQL function app_event_props_valid applies:
 * an object (or nothing), only allow-listed keys, each value a CODE_PATTERN
 * string, except report_index, a whole number 0..REPORT_INDEX_MAX; at most
 * PROPS_MAX_BYTES as JSON. Rejects; never strips, so a caller's bug is loud in
 * tests rather than silently dropping data.
 */
export function checkProps(props: unknown): PropsCheck {
  if (props === undefined || props === null) return { ok: true, props: {} };
  if (typeof props !== "object" || Array.isArray(props)) return { ok: false, reason: "props must be an object" };
  const out: AppEventProps = {};
  for (const [key, value] of Object.entries(props as Record<string, unknown>)) {
    if (!(APP_EVENT_PROP_KEYS as readonly string[]).includes(key)) {
      return { ok: false, reason: `prop key not allowed: ${key.slice(0, 40)}` };
    }
    if (key === "report_index") {
      if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > REPORT_INDEX_MAX) {
        return { ok: false, reason: "report_index must be a whole number 0..10000" };
      }
    } else if (!isCode(value)) {
      return { ok: false, reason: `prop ${key} must match [A-Za-z0-9._-]{1,64}` };
    }
    out[key as AppEventPropKey] = value as string | number;
  }
  if (new TextEncoder().encode(JSON.stringify(out)).length > PROPS_MAX_BYTES) {
    return { ok: false, reason: "props too large" };
  }
  return { ok: true, props: out };
}
