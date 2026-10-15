/**
 * The launch consent gate, server side (PK-CONSENT-01; owner decision D7.1,
 * design decisions D4, D5, D13; engineering decision D5 and finding 7).
 *
 * Uploads and AI processing need her CURRENT consent: her latest answer for
 * each of the three consent types is a grant at CURRENT_CONSENT_VERSION.
 *
 *   age_18_plus     "You're 18 or older"
 *   health_data     "Amani can process your health data" (separate from the
 *                   Terms, WA MHMDA style)
 *   ai_processing   "An AI service can read your lab values to write your
 *                   explanation" (Apple guideline 5.1.2(i); REQUIRED, D5)
 *
 * The gate is on only while features.consent_gate in app_public_config is the
 * boolean true: the same key the client reads (src/lib/runtimeConfig.ts) and
 * the lab_reports upload trigger reads (consent_gate_enabled() in
 * 20261015040000_consent_records.sql). Off, every check allows, exactly as
 * before this packet.
 *
 * Read policy:
 *   - The flag is cached for CONSENT_FLAG_TTL_MS, so a flip reaches every warm
 *     function within that time.
 *   - A flag read that fails because app_public_config does not exist yet
 *     (PGRST205 / 42P01: the owner has not pushed PK-CFG-01) reads as OFF: the
 *     owner cannot have switched on a flag in a table that is not there.
 *   - Any other failed flag read keeps the last value read; with none, the gate
 *     is ON (fail closed, the Error & Rescue Registry's "consent gate" row).
 *   - Her consent is never cached: a withdrawal stops the very next request.
 *     A failed consent read refuses the request (fail closed) with a retryable
 *     503, never a false "allowed".
 *   - Every read has a CONSENT_READ_TIMEOUT_MS budget (D8/D10: 10 s for
 *     business calls) and is aborted when it runs out.
 *
 * Pure: no Deno, no Supabase client, no clock. The reads and the clock are the
 * ConsentGateActions port (consent-gate-supabase.ts wires it); Vitest drives
 * every branch with fakes. Handlers stay thin:
 *
 *   const refusal = consentRefusal(await consentGateFor(admin).check(user.id));
 *   if (refusal) return json(refusal.body, refusal.status);
 *
 * CURRENT_CONSENT_VERSION must equal consent_required_version() in the
 * migration and the client's copy in src/lib/consent/consentPolicy.ts;
 * consent.test.ts fails when they differ.
 */

export const CONSENT_TYPES = ["age_18_plus", "health_data", "ai_processing"] as const;
export type ConsentType = typeof CONSENT_TYPES[number];

/** The copy version a grant must carry. DRAFT until the lawyer approves the copy (D7.1). */
export const CURRENT_CONSENT_VERSION = "draft-1";

/** features.<name> in app_public_config; a missing key is off (D5). */
export const CONSENT_GATE_FLAG = "consent_gate";

export const CONSENT_FLAG_TTL_MS = 5 * 60 * 1000;
export const CONSENT_READ_TIMEOUT_MS = 10 * 1000;

export const CONSENT_REQUIRED_CODE = "consent_required";
export const CONSENT_CHECK_UNAVAILABLE_CODE = "consent_check_unavailable";

/** Her latest answer for one consent type, as consent_current returns it. */
export interface ConsentAnswer {
  readonly consent_type: string;
  readonly version: string;
  readonly granted: boolean;
}

/**
 * The consent types she has not currently granted, in CONSENT_TYPES order.
 * `answers` is her latest answer per type (consent_current). A type with no
 * answer, a withdrawal, or a grant at another version counts as missing.
 * Throws when the reply is not a list, so a malformed read fails closed.
 */
export function missingConsents(answers: unknown): ConsentType[] {
  if (!Array.isArray(answers)) throw new Error("consent: expected a list of answers");
  const current = new Set<string>();
  for (const answer of answers as unknown[]) {
    if (typeof answer !== "object" || answer === null) continue;
    const { consent_type, version, granted } = answer as Partial<ConsentAnswer>;
    if (granted === true && version === CURRENT_CONSENT_VERSION && typeof consent_type === "string") {
      current.add(consent_type);
    }
  }
  return CONSENT_TYPES.filter((type) => !current.has(type));
}

export function hasCurrentConsent(answers: unknown): boolean {
  return missingConsents(answers).length === 0;
}

/** features.consent_gate from app_public_config rows: on only for the boolean true. */
export function consentGateFromConfig(rows: unknown): boolean {
  if (!Array.isArray(rows)) throw new Error("consent: expected app_public_config rows");
  for (const row of rows as unknown[]) {
    if (typeof row !== "object" || row === null) continue;
    const { key, value } = row as { key?: unknown; value?: unknown };
    if (key !== "features") continue;
    if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
    return (value as Record<string, unknown>)[CONSENT_GATE_FLAG] === true;
  }
  return false;
}

/** A read error meaning "app_public_config is not deployed": PostgREST PGRST205, or Postgres 42P01. */
export function isMissingRelationError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const code = (error as { code?: unknown }).code;
  return code === "PGRST205" || code === "42P01";
}

export interface ConsentGateActions {
  /**
   * Every app_public_config row (`key`, `value`). MUST throw on any failure,
   * with the PostgREST error (its `code`) as the thrown value or its cause.
   */
  readPublicConfig(signal: AbortSignal): Promise<unknown>;
  /** Her latest answer per type (consent_current, by user_id). MUST throw on any failure. */
  readCurrentConsents(userId: string, signal: AbortSignal): Promise<unknown>;
  /** Milliseconds since the epoch. */
  now(): number;
  /** Told about every failed read; the policy above absorbs the failure. */
  onError?(error: unknown): void;
}

export type ConsentCheck =
  | { readonly allowed: true; readonly gate: "off" | "on" }
  | { readonly allowed: false; readonly reason: typeof CONSENT_REQUIRED_CODE; readonly missing: readonly ConsentType[] }
  | { readonly allowed: false; readonly reason: typeof CONSENT_CHECK_UNAVAILABLE_CODE };

export interface ConsentGate {
  /** Whether the gate is on, under the flag read policy. Never rejects. */
  isGateOn(): Promise<boolean>;
  /** May this user upload or have her labs processed by AI? Never rejects. */
  check(userId: string): Promise<ConsentCheck>;
}

export interface ConsentGateOptions {
  flagTtlMs?: number;
  readTimeoutMs?: number;
}

async function withTimeout<T>(read: (signal: AbortSignal) => Promise<T>, timeoutMs: number): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`consent read timed out after ${timeoutMs} ms`));
    }, timeoutMs);
  });
  try {
    return await Promise.race([read(controller.signal), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export function createConsentGate(actions: ConsentGateActions, options: ConsentGateOptions = {}): ConsentGate {
  const flagTtlMs = options.flagTtlMs ?? CONSENT_FLAG_TTL_MS;
  const readTimeoutMs = options.readTimeoutMs ?? CONSENT_READ_TIMEOUT_MS;

  let cachedFlag: boolean | null = null;
  let flagReadAt = -Infinity;

  const report = (error: unknown) => {
    try {
      actions.onError?.(error);
    } catch {
      // A failing reporter must not turn a handled read failure into an outage.
    }
  };

  async function isGateOn(): Promise<boolean> {
    if (cachedFlag !== null && actions.now() - flagReadAt < flagTtlMs) return cachedFlag;
    try {
      const on = consentGateFromConfig(await withTimeout(actions.readPublicConfig, readTimeoutMs));
      cachedFlag = on;
      flagReadAt = actions.now();
      return on;
    } catch (error) {
      report(error);
      const cause = (error as { cause?: unknown } | null)?.cause;
      if (isMissingRelationError(error) || isMissingRelationError(cause)) {
        cachedFlag = false;
        flagReadAt = actions.now();
        return false;
      }
      return cachedFlag ?? true;
    }
  }

  return {
    isGateOn,
    async check(userId) {
      if (!(await isGateOn())) return { allowed: true, gate: "off" };
      try {
        const answers = await withTimeout((signal) => actions.readCurrentConsents(userId, signal), readTimeoutMs);
        const missing = missingConsents(answers);
        return missing.length === 0
          ? { allowed: true, gate: "on" }
          : { allowed: false, reason: CONSENT_REQUIRED_CODE, missing };
      } catch (error) {
        report(error);
        return { allowed: false, reason: CONSENT_CHECK_UNAVAILABLE_CODE };
      }
    },
  };
}

/**
 * The response a handler sends when the check refuses, or null to go on.
 * 403 consent_required (not retryable: the client shows the consent steps);
 * 503 consent_check_unavailable (retryable: nothing was processed).
 */
export function consentRefusal(check: ConsentCheck): { status: number; body: Record<string, unknown> } | null {
  if (check.allowed) return null;
  if (check.reason === CONSENT_REQUIRED_CODE) {
    return {
      status: 403,
      body: {
        error: "Your consent is needed before Amani can read or explain lab reports.",
        code: CONSENT_REQUIRED_CODE,
        missing: [...check.missing],
        retry: false,
      },
    };
  }
  return {
    status: 503,
    body: {
      error: "We couldn't check your consent just now. Nothing was processed. Please try again.",
      code: CONSENT_CHECK_UNAVAILABLE_CODE,
      retry: true,
    },
  };
}
