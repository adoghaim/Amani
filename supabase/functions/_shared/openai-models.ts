/**
 * Every OpenAI model id the edge functions call, and the request rules each
 * kind of model needs (review F128, F131).
 *
 * ## Why one module
 *
 * The model ids were string literals in four handlers, and each handler also
 * hard-coded the request parameters of the model it happened to call. That made
 * a model swap a four-file edit and, worse, an easy way to break a request:
 * `lab-insights` moved to `gpt-5-mini` (b5db3d5) and kept `temperature: 0.7`,
 * which OpenAI's reasoning models reject. Here the id and the parameter rules
 * live together, so changing the id changes the rules with it.
 *
 * ## Request rules
 *
 * - Chat models (gpt-4o, gpt-4o-mini): `max_tokens` and `temperature`, as the
 *   handlers sent them before.
 * - Reasoning models (gpt-5*, gpt-6*, o-series): no `temperature`; the output
 *   limit is `max_completion_tokens`, and it also covers the model's hidden
 *   reasoning tokens, so it carries REASONING_TOKEN_HEADROOM on top of the
 *   visible output the caller asks for. Without the headroom a tight limit is
 *   spent on reasoning and the visible answer comes back empty.
 *
 * ## Overrides
 *
 * An id can be replaced without a deploy of code by setting a function secret
 * (names below). Not setting one keeps the default. An override is used only
 * when it looks like a model id, so a typo cannot inject anything into the
 * request. Replacing a model needs an eval and owner sign-off (F128): this
 * module makes the swap a secret change, not a decision.
 *
 *   OPENAI_MODEL_OCR              parse-lab-report-ocr  (vision)
 *   OPENAI_MODEL_EXTRACTION       extract-biomarkers
 *   OPENAI_MODEL_INTERPRETATION   generate-interpretation (wiring is a handoff)
 *   OPENAI_MODEL_LAB_INSIGHTS     lab-insights
 *
 * ## Reasoning effort
 *
 * A reasoning model's effort is set per use the same way, by
 * OPENAI_REASONING_EFFORT_OCR, _EXTRACTION, _INTERPRETATION or _LAB_INSIGHTS
 * holding one of REASONING_EFFORTS. Unset (the default) or invalid, no
 * `reasoning_effort` is sent and the model's own default applies; a chat model
 * never gets the field. Choosing an effort is the owner's, after the eval.
 *
 * Pure: no Deno, no network, so Vitest drives it directly.
 */

export type OpenAiModelUse = "ocr" | "extraction" | "interpretation" | "labInsights";

/** Today's ids. Shutdown dates are in docs/privacy/ai-processing.md. */
export const DEFAULT_OPENAI_MODELS: Readonly<Record<OpenAiModelUse, string>> = Object.freeze({
  ocr: "gpt-4o",
  extraction: "gpt-4o-mini",
  interpretation: "gpt-4o-mini",
  labInsights: "gpt-5-mini",
});

export interface OpenAiModelShutdown {
  /** The day OpenAI stops serving the id (YYYY-MM-DD). */
  shutdown: string;
  /** OpenAI's suggested replacement. Not switched to: a switch needs the eval and owner sign-off. */
  replacement: string;
}

/**
 * OpenAI's shutdown date and suggested replacement for every default id, from
 * https://developers.openai.com/api/docs/deprecations (read 2026-10-24). The
 * handlers send the bare ids; nothing there says those are repointed, so they
 * are treated as shutting down with their snapshots. Section 1a of
 * docs/privacy/ai-processing.md states the same table (a test keeps them equal).
 */
export const OPENAI_MODEL_SHUTDOWNS: Readonly<Record<string, OpenAiModelShutdown>> = Object.freeze({
  "gpt-4o": Object.freeze({ shutdown: "2027-01-14", replacement: "gpt-6-luna" }),
  "gpt-4o-mini": Object.freeze({ shutdown: "2027-01-14", replacement: "gpt-6-luna" }),
  "gpt-5-mini": Object.freeze({ shutdown: "2026-12-11", replacement: "gpt-5.6-terra" }),
});

/** The function secret that overrides each use. */
export const OPENAI_MODEL_ENV: Readonly<Record<OpenAiModelUse, string>> = Object.freeze({
  ocr: "OPENAI_MODEL_OCR",
  extraction: "OPENAI_MODEL_EXTRACTION",
  interpretation: "OPENAI_MODEL_INTERPRETATION",
  labInsights: "OPENAI_MODEL_LAB_INSIGHTS",
});

const MODEL_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/;

/** The model id for a use: the secret when it is set and well formed, else the default. */
export function resolveOpenAiModel(
  use: OpenAiModelUse,
  getEnv: (name: string) => string | undefined = () => undefined,
): string {
  const override = getEnv(OPENAI_MODEL_ENV[use])?.trim().toLowerCase();
  return override && MODEL_ID.test(override) ? override : DEFAULT_OPENAI_MODELS[use];
}

/** gpt-5*, gpt-6* and the o-series reason before they answer and reject sampling parameters. */
export function isReasoningModel(model: string): boolean {
  return /^(?:gpt-[5-9](?:[.-]|$)|o\d)/i.test(model.trim());
}

/** Tokens a reasoning model may spend thinking, on top of the visible output. */
export const REASONING_TOKEN_HEADROOM = 4000;

export interface ChatLimits {
  /** Visible output tokens the caller needs. */
  maxOutputTokens: number;
  /** Sampling temperature for chat models. Never sent to a reasoning model. */
  temperature?: number;
}

/** The model-dependent fields of a chat completion request body. */
export function chatCompletionParams(model: string, limits: ChatLimits): Record<string, number> {
  if (isReasoningModel(model)) {
    return { max_completion_tokens: limits.maxOutputTokens + REASONING_TOKEN_HEADROOM };
  }
  return limits.temperature === undefined
    ? { max_tokens: limits.maxOutputTokens }
    : { max_tokens: limits.maxOutputTokens, temperature: limits.temperature };
}

/** The function secret that sets each use's reasoning effort. */
export const OPENAI_REASONING_EFFORT_ENV: Readonly<Record<OpenAiModelUse, string>> = Object.freeze({
  ocr: "OPENAI_REASONING_EFFORT_OCR",
  extraction: "OPENAI_REASONING_EFFORT_EXTRACTION",
  interpretation: "OPENAI_REASONING_EFFORT_INTERPRETATION",
  labInsights: "OPENAI_REASONING_EFFORT_LAB_INSIGHTS",
});

/** The `reasoning_effort` values Chat Completions documents; a given model may accept fewer. */
export const REASONING_EFFORTS = ["none", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

export type ReasoningEffort = typeof REASONING_EFFORTS[number];

/** `{ reasoning_effort }` when the use's secret holds a listed value and the model reasons, else `{}`. */
export function reasoningEffortParams(
  use: OpenAiModelUse,
  model: string,
  getEnv: (name: string) => string | undefined = () => undefined,
): { reasoning_effort?: ReasoningEffort } {
  if (!isReasoningModel(model)) return {};
  const value = getEnv(OPENAI_REASONING_EFFORT_ENV[use])?.trim().toLowerCase();
  const effort = REASONING_EFFORTS.find(listed => listed === value);
  return effort ? { reasoning_effort: effort } : {};
}
