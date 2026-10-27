/**
 * Why a generation served the deterministic interpretation, and why a
 * regeneration appended nothing (2026-10-17 production smoke).
 *
 * That smoke saw "HTTP 200, source fallback" on a first generation and
 * "HTTP 503 regeneration_failed" on its regeneration. Every cause below answers
 * those same two bodies, and nothing else told them apart. Each cause now
 * travels with a stable code:
 *
 *   200, source "fallback"   -> fallback_reason
 *   503 regeneration_failed  -> reason
 *
 *   introductory_access_exhausted  Free, introductory access used up, and
 *                                  FREEMIUM_POST_LIMIT_GENERATION is set and not
 *                                  "always" (get-interpretation's own token for it)
 *   report_unavailable             the report row could not be read
 *   no_analytes                    the report holds no parsed values to interpret
 *   ai_not_configured              OPENAI_API_KEY is not set
 *   ai_paused                      the owner's kill switch (app_server_config.ai_kill_switch)
 *   model_failed                   the model was called and produced nothing usable;
 *                                  `model_failure` says how
 *   floor_violation                503 only: the model's body failed the medical floor
 *   introductory_limit_reached     503 only: the last introductory credit went to
 *                                  another request at commit
 *
 * Additive only: `error`, `retryable`, `ai_paused` and every status code are
 * unchanged, so a shipped client (src/lib/regenerationFailure.ts, aiPause.ts)
 * reads each answer exactly as before. Every code is a fixed string: no
 * upstream message, body, identifier or value travels in them. What the model
 * wrote is never described beyond `output_rejected`, so a rejected answer gives
 * a caller no finer signal than the source already did.
 *
 * Pure — no Deno, no network, no clock.
 */

export const FALLBACK_REASONS = Object.freeze([
  "introductory_access_exhausted",
  "report_unavailable",
  "no_analytes",
  "ai_not_configured",
  "ai_paused",
  "model_failed",
] as const);
export type FallbackReason = typeof FALLBACK_REASONS[number];

export type RegenerationFailureReason = FallbackReason | "floor_violation" | "introductory_limit_reached";

/**
 * How a model call that ran produced nothing usable:
 *   timeout          every attempt ran past fetchWithBackoff's per-attempt timeout
 *   network_error    the request never got an answer
 *   http_<status>    OpenAI answered non-2xx, after the retries for 429 and 5xx
 *   truncated        the answer stopped at max_tokens (finish_reason "length")
 *   output_rejected  the answer was empty, not JSON, failed InterpretationSchema,
 *                    or failed the nutrient policy twice and sanitizing failed closed
 */
export type ModelFailure = "timeout" | "network_error" | `http_${number}` | "truncated" | "output_rejected";

/** A non-2xx answer as a fixed code; anything that is not an HTTP status reads as a network failure. */
export function httpModelFailure(status: number): ModelFailure {
  return Number.isInteger(status) && status >= 100 && status <= 599 ? `http_${status}` : "network_error";
}

/**
 * A thrown request as a fixed code. fetchWithBackoff aborts an attempt that runs
 * past its timeout, which rejects with AbortError (TimeoutError when an
 * AbortSignal.timeout fired). Everything else thrown before an answer is a
 * network failure; content that fails to parse is the caller's output_rejected.
 */
export function thrownModelFailure(error: unknown): ModelFailure {
  const name = error && typeof error === "object" && "name" in error ? (error as { name?: unknown }).name : null;
  return name === "AbortError" || name === "TimeoutError" ? "timeout" : "network_error";
}

/**
 * Why this request's interpretation is the deterministic one, or null when it is
 * the model's deep work. The same steps as produceInterpretation: the model is
 * wanted only for a deep decision with a report, values and a key
 * (shouldRequestDeepInterpretation), and called only while the kill switch is
 * off (callModelUnlessPaused); the source is "ai" only when deep generation was
 * decided and the model produced output (shapeInterpretation). So the pause is
 * named only when it is what changed the answer, exactly as `ai_paused` is.
 */
export function fallbackReasonOf(facts: {
  /** decideDeepGeneration's answer. */
  deepGeneration: boolean;
  hasReport: boolean;
  hasAnalytes: boolean;
  hasApiKey: boolean;
  aiPaused: boolean;
  /** The model returned a usable (schema-valid, policy-clean) interpretation. */
  modelProduced: boolean;
}): FallbackReason | null {
  if (!facts.deepGeneration) return "introductory_access_exhausted";
  if (!facts.hasReport) return "report_unavailable";
  if (!facts.hasAnalytes) return "no_analytes";
  if (!facts.hasApiKey) return "ai_not_configured";
  if (facts.aiPaused) return "ai_paused";
  if (!facts.modelProduced) return "model_failed";
  return null;
}

/**
 * Why a regeneration was not versioned (isVersionable said no): the fallback's
 * reason when the body is the deterministic one, else the medical floor refused
 * the model's body.
 */
export function regenerationRefusalReason(fallbackReason: FallbackReason | null): RegenerationFailureReason {
  return fallbackReason ?? "floor_violation";
}

/** The fields a generation answer carries; none for the model's own deep work. */
export function fallbackDiagnostics(
  reason: FallbackReason | null,
  modelFailure: ModelFailure | null,
): { fallback_reason?: FallbackReason; model_failure?: ModelFailure } {
  if (!reason) return {};
  return reason === "model_failed" && modelFailure
    ? { fallback_reason: reason, model_failure: modelFailure }
    : { fallback_reason: reason };
}

/** The same, for a refused regeneration's 503 body. */
export function refusalDiagnostics(
  reason: RegenerationFailureReason,
  modelFailure: ModelFailure | null,
): { reason: RegenerationFailureReason; model_failure?: ModelFailure } {
  return reason === "model_failed" && modelFailure ? { reason, model_failure: modelFailure } : { reason };
}
