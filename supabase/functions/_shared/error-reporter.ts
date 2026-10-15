/**
 * Error reporting from edge functions to Sentry (PK-FIX-01b, owner decision
 * D5.1; engineering decisions R5/D8/D10).
 *
 * A minimal envelope sender instead of the Sentry SDK: one HTTP POST of one
 * event, built here so that what leaves is exactly what this file writes.
 *
 * What an event carries, and nothing else:
 *   - the error's type and its message through phi-scrub.ts (identifiers, lab
 *     values, quoted text and numbers removed; length capped);
 *   - fixed tags: the function name, and a caller-chosen `stage` label that
 *     must be a short machine identifier;
 *   - environment, release, platform, timestamp, event id.
 * No request body, headers, user, IP, stack locals or "extra" bag, ever.
 *
 * Rules (R5, D8, D10):
 *   - Never blocks or fails a request: every report resolves, whatever the DSN,
 *     the network or Sentry does. Failures go to `onError` (a console line).
 *   - The send itself is one try with a 3-second timeout (telemetry), through
 *     fetchWithBackoff in the Deno wiring (edge-observability.ts).
 *   - No DSN (the secret SENTRY_DSN unset, the state until the owner sets it):
 *     nothing is built or sent.
 *
 * Pure: the transport, clock and id source are the `ErrorReporterActions`
 * port, so Vitest drives every branch with fakes.
 */

import { errorType, scrubbedErrorMessage, scrubServerText } from "./phi-scrub.ts";

export const SENTRY_TELEMETRY_TIMEOUT_MS = 3000;
export const SENTRY_TELEMETRY_TRIES = 1;
const CLIENT = "amani-edge/1.0";

export interface SentryDsn {
  /** The public key, sent as sentry_key. */
  publicKey: string;
  /** https://host[:port][/path-prefix] */
  origin: string;
  projectId: string;
  /** The DSN as given, for the envelope header. */
  raw: string;
}

/** Parses `https://<key>@<host>[/<prefix>]/<projectId>`. Anything else is null: reporting stays off. */
export function parseSentryDsn(dsn: string | undefined | null): SentryDsn | null {
  if (typeof dsn !== "string" || dsn.trim() === "") return null;
  let url: URL;
  try {
    url = new URL(dsn.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (!url.username || url.password) return null;
  const segments = url.pathname.split("/").filter(Boolean);
  const projectId = segments.pop();
  if (!projectId || !/^\d+$/.test(projectId)) return null;
  const prefix = segments.length ? `/${segments.join("/")}` : "";
  return {
    publicKey: url.username,
    origin: `${url.protocol}//${url.host}${prefix}`,
    projectId,
    raw: dsn.trim(),
  };
}

/** Where an envelope is posted, and the auth header it needs. */
export function envelopeEndpoint(dsn: SentryDsn): { url: string; headers: Record<string, string> } {
  return {
    url: `${dsn.origin}/api/${dsn.projectId}/envelope/`,
    headers: {
      "Content-Type": "application/x-sentry-envelope",
      "X-Sentry-Auth": `Sentry sentry_version=7, sentry_key=${dsn.publicKey}, sentry_client=${CLIENT}`,
    },
  };
}

export type ReportLevel = "fatal" | "error" | "warning" | "info";

const TAG_VALUE = /^[a-z0-9][a-z0-9_.:-]{0,63}$/i;

/** Keeps only tags whose key and value are short machine identifiers. Free text never becomes a tag. */
export function safeTags(tags: Record<string, string | number | boolean | undefined> = {}): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(tags)) {
    if (value === undefined || !TAG_VALUE.test(key)) continue;
    const text = String(value);
    if (TAG_VALUE.test(text)) out[key] = text;
  }
  return out;
}

export interface ReportEventInput {
  eventId: string;
  timestampMs: number;
  level: ReportLevel;
  functionName: string;
  environment: string;
  release?: string;
  /** Already scrubbed; built by captureException / captureMessage below. */
  exception?: { type: string; value: string };
  message?: string;
  tags?: Record<string, string>;
}

/** The Sentry event payload. Every field is listed here; nothing is spread in. */
export function buildEvent(input: ReportEventInput): Record<string, unknown> {
  const event: Record<string, unknown> = {
    event_id: input.eventId,
    timestamp: input.timestampMs / 1000,
    platform: "javascript",
    level: input.level,
    logger: input.functionName,
    server_name: "supabase-edge",
    environment: input.environment,
    tags: { function: input.functionName, ...(input.tags ?? {}) },
  };
  if (input.release) event.release = input.release;
  if (input.exception) event.exception = { values: [input.exception] };
  if (input.message !== undefined) event.message = { formatted: input.message };
  return event;
}

/** Envelope: header line, item header line, item payload line. */
export function buildEnvelope(dsn: SentryDsn, event: Record<string, unknown>, sentAtMs: number): string {
  const payload = JSON.stringify(event);
  return [
    JSON.stringify({ event_id: event.event_id, sent_at: new Date(sentAtMs).toISOString(), dsn: dsn.raw }),
    JSON.stringify({ type: "event", content_type: "application/json", length: new TextEncoder().encode(payload).length }),
    payload,
  ].join("\n");
}

export interface ErrorReporterActions {
  /** SENTRY_DSN, or undefined while the owner has not set it. */
  dsn: string | undefined;
  environment: string;
  release?: string;
  /** One POST; may throw or reject. Bounded by the wiring (3 s, one try). */
  send(url: string, headers: Record<string, string>, body: string): Promise<void>;
  now(): number;
  /** 32 lowercase hex characters. */
  newEventId(): string;
  /** Told about a failed send. Absorbed: reporting never fails a request. */
  onError?(error: unknown): void;
}

export interface ReportContext {
  /** A short machine label for where it failed, e.g. "openai_call". */
  stage?: string;
  tags?: Record<string, string | number | boolean | undefined>;
}

export interface ErrorReporter {
  /** True when a usable DSN is configured. */
  readonly enabled: boolean;
  /** Report an error. Never rejects; resolves true when Sentry accepted it. */
  captureException(error: unknown, context?: ReportContext): Promise<boolean>;
  /** Report a fixed message (e.g. a budget alert). Never rejects; resolves true when Sentry accepted it. The text is scrubbed too. */
  captureMessage(message: string, level?: ReportLevel, context?: ReportContext): Promise<boolean>;
}

export function createErrorReporter(functionName: string, actions: ErrorReporterActions): ErrorReporter {
  const dsn = parseSentryDsn(actions.dsn);

  async function send(
    input: Omit<ReportEventInput, "eventId" | "timestampMs" | "functionName" | "environment" | "release">,
  ): Promise<boolean> {
    if (!dsn) return false;
    try {
      const now = actions.now();
      const event = buildEvent({
        ...input,
        eventId: actions.newEventId(),
        timestampMs: now,
        functionName,
        environment: actions.environment,
        release: actions.release,
      });
      const { url, headers } = envelopeEndpoint(dsn);
      await actions.send(url, headers, buildEnvelope(dsn, event, now));
      return true;
    } catch (error) {
      try {
        actions.onError?.(error);
      } catch {
        // A failing logger must not turn a swallowed telemetry failure into an outage.
      }
      return false;
    }
  }

  const tagsOf = (context?: ReportContext) => safeTags({ ...(context?.tags ?? {}), stage: context?.stage });

  return {
    enabled: dsn !== null,
    captureException(error, context) {
      return send({
        level: "error",
        exception: { type: errorType(error), value: scrubbedErrorMessage(error) },
        tags: tagsOf(context),
      });
    },
    captureMessage(message, level = "info", context) {
      return send({ level, message: scrubServerText(message), tags: tagsOf(context) });
    },
  };
}
