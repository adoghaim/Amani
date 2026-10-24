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
