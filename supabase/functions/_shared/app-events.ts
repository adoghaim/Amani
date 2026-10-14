/**
 * First-party events, server side (PK-EXP5; owner decisions D5.3, D6.2, D8/D10).
 *
 * The policy lives here, behind injected ports, so Vitest drives it with fakes
 * (app-events.test.ts) and the Deno handlers stay thin wiring:
 *
 *   handleAnonEvent   the whole of log-anon-event: validate, rate-limit by a
 *                     hashed IP and a global daily cap, insert with the service
 *                     role. Pre-signup events only (landing_view,
 *                     signup_started), never a direct anon-callable RPC.
 *   logServerEvent    interpretation_generated, trial_started,
 *                     subscription_activated and account_deleted from edge
 *                     functions. Never throws and never waits longer than 3
 *                     seconds: a logging failure never blocks the main flow.
 *   stripeFunnelEvent / revenueCatFunnelEvent
 *                     which funnel event, if any, a webhook delivery means.
 *
 * The raw IP is never stored. The rate-limit key is
 *   HMAC-SHA256(dailySalt, ip), dailySalt = HMAC-SHA256(secret, "log-anon-event:" + UTC day)
 * where the secret is the function secret ANON_EVENT_IP_SALT_SECRET (name
 * only; the value is set by the owner). The salt rotates every UTC day, so a
 * key cannot be linked across days, and without the secret a key cannot be
 * tested against a guessed IP. Only the hex digest leaves this module.
 *
 * Plain TypeScript with WebCrypto (globalThis.crypto.subtle, present in Deno
 * and Node 20): no Deno or npm import.
 */

import {
  ANON_ID_PATTERN,
  checkProps,
  isAnonEvent,
  isServerEvent,
  type AppEventProps,
  type ServerEvent,
} from "./app-events-policy.ts";

/** Name of the function secret the daily salt is derived from. The value never appears in the repo. */
export const ANON_EVENT_SALT_SECRET_NAME = "ANON_EVENT_IP_SALT_SECRET";

/** Pre-signup events accepted from one hashed IP per UTC day. */
export const ANON_EVENTS_PER_IP_PER_DAY = 60;
/** Pre-signup events accepted from everyone together per UTC day. */
export const ANON_EVENTS_GLOBAL_PER_DAY = 20000;
/** Largest request body log-anon-event reads, in bytes. */
export const ANON_EVENT_MAX_BODY_BYTES = 2048;
/** D10: telemetry gets 3 seconds, one try, and its failure is swallowed. */
export const TELEMETRY_TIMEOUT_MS = 3000;

/** The counter bucket for everyone together (the global daily cap). */
export const GLOBAL_BUCKET = "global";

export interface AppEventRow {
  event: string;
  props: AppEventProps;
  user_id: string | null;
  anon_id: string | null;
}

/** The I/O log-anon-event needs, all with the service role. */
export interface AnonEventActions {
  /**
   * increment_anon_event_counter: atomically bump (bucket, day) and return the
   * count after the increment. Throws when the counter cannot be read.
   */
  incrementCounter(bucket: string, day: string): Promise<number>;
  /** INSERT one app_events row. Throws on failure. */
  insertEvent(row: AppEventRow): Promise<void>;
}

export interface AnonEventRequest {
  /** The raw request body text (already capped by the handler). */
  bodyText: string;
  /** The caller's IP from the platform header, or null when there is none. */
  ip: string | null;
  /** The salt secret's value, or undefined when it is not set. */
  secret: string | undefined;
  now?: Date;
  limits?: { perIp: number; global: number };
}

export interface AnonEventResponse {
  status: number;
  body: { ok: boolean; error?: string };
}

/** The UTC day of `now`, as YYYY-MM-DD. */
export function utcDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}

const encoder = new TextEncoder();

async function hmacHex(key: string, message: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey("raw", encoder.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(message)));
  return [...signature].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

/** The salt for one UTC day, derived from the function secret. */
export function dailySalt(secret: string, day: string): Promise<string> {
  return hmacHex(secret, `log-anon-event:${day}`);
}

/** The rate-limit bucket for an IP on a day: "ip:" + 64 hex. Never the IP itself. */
export async function ipBucket(ip: string, secret: string, day: string): Promise<string> {
  const salt = await dailySalt(secret, day);
  return `ip:${await hmacHex(salt, ip)}`;
}

const IP_SHAPE = /^[0-9A-Fa-f:.]{2,45}$/;

/**
 * The client IP from the platform's forwarding header: the first entry of
 * x-forwarded-for. Anything that does not look like an IPv4 or IPv6 address
 * reads as no IP (the global cap still applies).
 */
export function clientIp(forwardedFor: string | null | undefined): string | null {
  const first = forwardedFor?.split(",")[0]?.trim() ?? "";
  return IP_SHAPE.test(first) ? first : null;
}

const reply = (status: number, error?: string): AnonEventResponse =>
  ({ status, body: error ? { ok: false, error } : { ok: true } });

/**
 * log-anon-event, all of it but the wiring. Answers:
 *   202 recorded; 400 not a valid pre-signup event; 413 body too large;
 *   429 over the per-IP or global daily cap; 503 not configured or the
 *   counter or insert failed. The client ignores every answer.
 */
export async function handleAnonEvent(actions: AnonEventActions, request: AnonEventRequest): Promise<AnonEventResponse> {
  const now = request.now ?? new Date();
  const limits = request.limits ?? { perIp: ANON_EVENTS_PER_IP_PER_DAY, global: ANON_EVENTS_GLOBAL_PER_DAY };

  if (encoder.encode(request.bodyText).length > ANON_EVENT_MAX_BODY_BYTES) return reply(413, "body too large");

  let body: unknown;
  try {
    body = JSON.parse(request.bodyText);
  } catch {
    return reply(400, "body is not JSON");
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) return reply(400, "body is not an object");
  const { event, props, anon_id: anonId, ...rest } = body as Record<string, unknown>;
  if (Object.keys(rest).length > 0) return reply(400, "unknown field");
  if (!isAnonEvent(event)) return reply(400, "event not allowed before signup");
  if (typeof anonId !== "string" || !ANON_ID_PATTERN.test(anonId)) return reply(400, "anon_id invalid");
  const checked = checkProps(props);
  if (!checked.ok) return reply(400, checked.reason);

  // Fail closed: without the secret there is no way to key the limit without a raw IP.
  if (!request.secret) return reply(503, "not configured");

  const day = utcDay(now);
  try {
    if (request.ip) {
      const perIp = await actions.incrementCounter(await ipBucket(request.ip, request.secret, day), day);
      if (perIp > limits.perIp) return reply(429, "rate limited");
    }
    const global = await actions.incrementCounter(GLOBAL_BUCKET, day);
    if (global > limits.global) return reply(429, "daily cap reached");
    await actions.insertEvent({ event, props: checked.props, user_id: null, anon_id: anonId });
  } catch {
    return reply(503, "unavailable");
  }
  return reply(202);
}

/** The I/O logServerEvent needs: one service-role INSERT. */
export interface ServerEventSink {
  insertEvent(row: AppEventRow): Promise<void>;
}

/** A PostgREST call as the handlers make it: resolves with { error }, never throws for a query error. */
type DbResult = PromiseLike<{ data?: unknown; error: { message: string } | null }>;

/**
 * The ports over the handler's SERVICE-ROLE Supabase client. The handler passes
 * the two queries as closures, e.g.
 *   createAppEventSink(row => supabase.from("app_events").insert(row))
 * so this module needs no Supabase import and works with any client version.
 * app_events grants INSERT to service_role only, and increment_anon_event_counter
 * is service_role only (20261015010000_first_party_events.sql).
 */
export function createAppEventSink(insert: (row: Record<string, unknown>) => DbResult): ServerEventSink {
  return {
    async insertEvent(row) {
      const { error } = await insert({ ...row });
      if (error) throw new Error(`app_events insert failed: ${error.message}`);
    },
  };
}

export function createAnonEventActions(
  insert: (row: Record<string, unknown>) => DbResult,
  rpc: (fn: string, args: Record<string, unknown>) => DbResult,
): AnonEventActions {
  const sink = createAppEventSink(insert);
  return {
    insertEvent: row => sink.insertEvent(row),
    async incrementCounter(bucket, day) {
      const { data, error } = await rpc("increment_anon_event_counter", { p_bucket: bucket, p_day: day });
      if (error) throw new Error(`anon event counter failed: ${error.message}`);
      if (typeof data !== "number") throw new Error("anon event counter returned no count");
      return data;
    },
  };
}

export interface ServerEventInput {
  event: ServerEvent;
  /** The user the event is about, or null (account_deleted is logged after the account is gone). */
  userId?: string | null;
  /** Looked up only when userId is undefined. No user found, or a failed lookup, means the event is not logged. */
  resolveUserId?: () => Promise<string | null>;
  props?: AppEventProps;
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("telemetry timeout")), ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Logs one server-side event. Never throws, never takes longer than
 * `timeoutMs` (3 seconds by default), one try. Resolves true when the row was
 * written. An invalid event or props, a failed user lookup, a failed insert
 * and a timeout all resolve false and are logged as a warning only.
 */
export async function logServerEvent(
  sink: ServerEventSink,
  input: ServerEventInput,
  options: { timeoutMs?: number; warn?: (message: string) => void } = {},
): Promise<boolean> {
  const warn = options.warn ?? ((message: string) => console.warn(message));
  try {
    if (!isServerEvent(input.event)) {
      warn(`[app-events] not a server event: ${String(input.event).slice(0, 40)}`);
      return false;
    }
    const checked = checkProps(input.props);
    if (!checked.ok) {
      warn(`[app-events] ${input.event}: ${checked.reason}`);
      return false;
    }
    await withTimeout((async () => {
      const userId = input.userId !== undefined ? input.userId : await input.resolveUserId?.() ?? null;
      if (input.userId === undefined && input.resolveUserId && userId === null) {
        throw new Error("no user for this event");
      }
      await sink.insertEvent({ event: input.event, props: checked.props, user_id: userId, anon_id: null });
    })(), options.timeoutMs ?? TELEMETRY_TIMEOUT_MS);
    return true;
  } catch (error) {
    warn(`[app-events] ${input.event} not logged: ${error instanceof Error ? error.message : "unknown error"}`);
    return false;
  }
}

/** The fields of a Stripe event this reads: type, data.object.status, data.previous_attributes.status. */
export interface StripeEventLike {
  type: string;
  data?: unknown;
}

const statusOf = (value: unknown): unknown =>
  typeof value === "object" && value !== null ? (value as { status?: unknown }).status : undefined;

/**
 * The funnel event a Stripe webhook delivery means, or null:
 *   customer.subscription.created, status trialing      -> trial_started
 *   customer.subscription.created, status active        -> subscription_activated
 *   customer.subscription.updated, status becomes active
 *     from trialing, incomplete or incomplete_expired  -> subscription_activated
 * A renewal or any other update is not a funnel step.
 */
export function stripeFunnelEvent(event: StripeEventLike): ServerEvent | null {
  const data = typeof event.data === "object" && event.data !== null
    ? event.data as { object?: unknown; previous_attributes?: unknown }
    : {};
  const status = statusOf(data.object);
  if (event.type === "customer.subscription.created") {
    if (status === "trialing") return "trial_started";
    if (status === "active") return "subscription_activated";
    return null;
  }
  if (event.type === "customer.subscription.updated" && status === "active") {
    const before = statusOf(data.previous_attributes);
    if (before === "trialing" || before === "incomplete" || before === "incomplete_expired") {
      return "subscription_activated";
    }
  }
  return null;
}

/**
 * The funnel event a RevenueCat webhook body means, or null:
 *   INITIAL_PURCHASE with period_type TRIAL                -> trial_started
 *   INITIAL_PURCHASE with any other period_type            -> subscription_activated
 *   RENEWAL with is_trial_conversion true                  -> subscription_activated
 * Sandbox deliveries are not counted.
 */
export function revenueCatFunnelEvent(body: unknown): ServerEvent | null {
  if (typeof body !== "object" || body === null) return null;
  const event = (body as { event?: unknown }).event;
  if (typeof event !== "object" || event === null) return null;
  const { type, period_type: periodType, is_trial_conversion: trialConversion, environment } =
    event as Record<string, unknown>;
  if (typeof environment === "string" && environment.toUpperCase() === "SANDBOX") return null;
  const kind = typeof type === "string" ? type.toUpperCase() : "";
  if (kind === "INITIAL_PURCHASE") {
    return typeof periodType === "string" && periodType.toUpperCase() === "TRIAL" ? "trial_started" : "subscription_activated";
  }
  if (kind === "RENEWAL" && trialConversion === true) return "subscription_activated";
  return null;
}
