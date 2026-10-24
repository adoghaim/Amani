/**
 * The AI cost ledger: one `public.ai_call_costs` row per model call, from all
 * four AI functions (PK-FIX-01b, owner decision D5.2).
 *
 * `interpretation_generation_costs` (V2) stays as it is: it holds
 * interpretation-only columns, and OCR runs before a report exists. This
 * ledger is the cross-function one the monthly budget check sums
 * (ai-budget.ts, migration 20261013050000_ai_cost_ledger.sql).
 *
 * Rules:
 *   - Telemetry: recording never fails or delays the user's request beyond its
 *     own insert. Every failure goes to `onError` and is absorbed.
 *   - Written with the service role only; the table has no client grants.
 *   - est_cost_usd is an ESTIMATE from the published per-token list prices
 *     below, for alerting, not billing. A model missing from the table is
 *     priced at the most expensive listed rate, so an unknown model can only
 *     over-estimate spend and alert early, never late. Unknown token counts
 *     are recorded as null and priced as zero.
 *
 * Pure: the insert is the `AiCostLedgerActions` port.
 */

export const AI_FUNCTION_NAMES = [
  "generate-interpretation",
  "parse-lab-report-ocr",
  "extract-biomarkers",
  "lab-insights",
] as const;

export type AiFunctionName = typeof AI_FUNCTION_NAMES[number];

export interface ModelPrice {
  /** US dollars per one million input (prompt) tokens. */
  inputPerMillion: number;
  /** US dollars per one million output (completion) tokens. */
  outputPerMillion: number;
}

/**
 * OpenAI standard list prices, USD per 1M tokens, for the models the four
 * functions call today. Matched by prefix against the model the API reports
 * (e.g. "gpt-4o-2024-08-06"), longest prefix first. The owner confirms or
 * updates these figures ([Pending] in the PK-FIX-01b PR).
 *
 * gpt-6-luna and gpt-5.6-terra are OpenAI's suggested replacements for the
 * three ids above (OPENAI_MODEL_SHUTDOWNS in openai-models.ts), priced ahead of
 * a swap so a switched use is estimated at its own rate rather than the unknown
 * one. Source: https://developers.openai.com/api/docs/pricing, standard tier,
 * read 2026-10-24. The owner confirms these too ([Pending]).
 */
export const MODEL_PRICES: Readonly<Record<string, ModelPrice>> = Object.freeze({
  "gpt-4o-mini": { inputPerMillion: 0.15, outputPerMillion: 0.6 },
  "gpt-4o": { inputPerMillion: 2.5, outputPerMillion: 10 },
  "gpt-5-mini": { inputPerMillion: 0.25, outputPerMillion: 2 },
  "gpt-6-luna": { inputPerMillion: 0.1, outputPerMillion: 0.5 },
  "gpt-5.6-terra": { inputPerMillion: 2, outputPerMillion: 12 },
});

/** The most expensive listed rate: what an unlisted model is priced at. */
export const UNKNOWN_MODEL_PRICE: ModelPrice = Object.freeze(
  Object.values(MODEL_PRICES).reduce((max, price) => ({
    inputPerMillion: Math.max(max.inputPerMillion, price.inputPerMillion),
    outputPerMillion: Math.max(max.outputPerMillion, price.outputPerMillion),
  }), { inputPerMillion: 0, outputPerMillion: 0 }),
);

export function priceFor(model: string): ModelPrice {
  const name = model.trim().toLowerCase();
  const match = Object.keys(MODEL_PRICES)
    .sort((a, b) => b.length - a.length)
    .find(prefix => name === prefix || name.startsWith(`${prefix}-`));
  return match ? MODEL_PRICES[match]! : UNKNOWN_MODEL_PRICE;
}

const MAX_TOKENS = 2147483647;

/** A token count from a usage object: a non-negative integer, else null. */
export function tokenCount(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= MAX_TOKENS ? value : null;
}

/** Estimated cost in USD, rounded to the column's 6 decimal places. */
export function estimateCostUsd(model: string, inputTokens: number | null, outputTokens: number | null): number {
  const price = priceFor(model);
  const cost = ((inputTokens ?? 0) * price.inputPerMillion + (outputTokens ?? 0) * price.outputPerMillion) / 1_000_000;
  return Math.round(cost * 1_000_000) / 1_000_000;
}

export interface AiCallCostRow {
  user_id: string | null;
  function_name: AiFunctionName;
  model: string;
  input_tokens: number | null;
  output_tokens: number | null;
  est_cost_usd: number;
}

export interface AiCallInput {
  functionName: AiFunctionName;
  /** The caller's user id, or null when there is none. */
  userId: string | null;
  /** The model the API reported, else the one requested. */
  model: string;
  /** The OpenAI `usage` object as returned (prompt_tokens, completion_tokens); anything else counts as unknown. */
  usage: unknown;
}

const MODEL_NAME = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/;

export function buildAiCallCostRow(input: AiCallInput): AiCallCostRow {
  const usage = input.usage && typeof input.usage === "object" ? input.usage as Record<string, unknown> : {};
  const inputTokens = tokenCount(usage.prompt_tokens ?? usage.input_tokens);
  const outputTokens = tokenCount(usage.completion_tokens ?? usage.output_tokens);
  const model = MODEL_NAME.test(input.model) ? input.model : "unknown";
  return {
    user_id: input.userId,
    function_name: input.functionName,
    model,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    est_cost_usd: estimateCostUsd(model, inputTokens, outputTokens),
  };
}

export interface AiCostLedgerActions {
  /** Insert one row into public.ai_call_costs with the service role. Throws on failure. */
  insert(row: AiCallCostRow): Promise<void>;
  /** Told about a failed insert. Absorbed. */
  onError?(error: unknown): void;
}

export interface AiCostLedger {
  /** Record one model call. Always resolves; never rejects. */
  record(input: AiCallInput): Promise<void>;
}

export function createAiCostLedger(actions: AiCostLedgerActions): AiCostLedger {
  return {
    async record(input) {
      try {
        if (!(AI_FUNCTION_NAMES as readonly string[]).includes(input.functionName)) {
          throw new Error(`ai cost ledger: unknown function ${String(input.functionName)}`);
        }
        await actions.insert(buildAiCallCostRow(input));
      } catch (error) {
        try {
          actions.onError?.(error);
        } catch {
          // A failing logger must not fail the request.
        }
      }
    },
  };
}
