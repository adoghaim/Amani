// Untrusted funnel and attribution strings (PK-EXP5, owner decision D5.3).
//
// utm_source, promo and ref values come from URLs anyone can craft, so they reach Jarvis as
// attacker-controlled DATA. They are re-validated here (the database already refuses anything
// outside [A-Za-z0-9._-]{1,64}, but Jarvis does not rely on that), and anything else is replaced
// by a placeholder. Valid values can contain no quote, backtick, angle bracket, space or newline,
// so a value can neither break out of a code span in the report nor read as a sentence of
// instructions in the prompt. The prompt also tells Claude to treat them as data
// (prompts/daily-report.md, "Trust boundaries").
//
// No dependencies; Node >= 18.

/** The D5.3 charset, the same as CODE_PATTERN in supabase/functions/_shared/app-events-policy.ts. */
export const CODE_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

/**
 * The event allow-list, a copy of APP_EVENTS in supabase/functions/_shared/app-events-policy.ts.
 * Node cannot import that TypeScript file here; jarvis/lib/untrusted.test.mjs fails when they differ.
 */
export const APP_EVENTS = Object.freeze([
  "landing_view", "signup_started", "signup_completed", "onboarding_completed",
  "upload_started", "report_parsed", "interpretation_generated", "report_viewed",
  "compare_viewed", "paywall_viewed", "checkout_started", "trial_started",
  "subscription_activated", "account_deleted",
]);

export const INVALID = "[invalid]";
export const NONE = "(none)";

/** A token as data: itself when it passes the charset, NONE when absent, INVALID otherwise. */
export function untrustedToken(value) {
  if (value === null || value === undefined || value === "") return NONE;
  return typeof value === "string" && CODE_PATTERN.test(value) ? value : INVALID;
}

/** A token rendered for markdown or a prompt: always inside a code span, never bare. */
export function quoteUntrusted(value) {
  return `\`${untrustedToken(value)}\``;
}

const count = (value) => {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * funnel_daily rows (day, event, utm_source, events, actors) as data Jarvis can cite: unknown
 * events and malformed sources become placeholders, counts become whole numbers.
 */
export function sanitizeFunnelRows(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => ({
    day: typeof row?.day === "string" && DAY.test(row.day) ? row.day : INVALID,
    event: APP_EVENTS.includes(row?.event) ? row.event : INVALID,
    utm_source: untrustedToken(row?.utm_source),
    events: count(row?.events),
    actors: count(row?.actors),
  }));
}

/** Totals per event, and per event and source, over the given rows. */
export function summarizeFunnel(rows) {
  const byEvent = {};
  const bySource = {};
  for (const row of rows) {
    byEvent[row.event] = (byEvent[row.event] ?? 0) + row.events;
    const key = `${row.event} | ${row.utm_source}`;
    bySource[key] = (bySource[key] ?? 0) + row.events;
  }
  return { events_by_event: byEvent, events_by_event_and_source: bySource };
}
