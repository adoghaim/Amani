/** One logical model call, including a policy retry as a separate call. Transport
 * retries inside fetchWithBackoff share a sample; unknown usage stays null. */
export interface GenerationSample {
  model: string;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  durationMs: number;
}

export interface GenerationCostContext {
  userId: string;
  reportId: string;
  interpretationTier: string;
  planAtRequest: string;
  claimConsumed: boolean;
  deep: boolean;
}

function tokenCount(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 2147483647
    ? value : null;
}

export function generationSample(model: string, usage: unknown, durationMs: number): GenerationSample {
  const values = usage && typeof usage === "object" ? usage as Record<string, unknown> : {};
  return {
    model,
    promptTokens: tokenCount(values.prompt_tokens),
    completionTokens: tokenCount(values.completion_tokens),
    totalTokens: tokenCount(values.total_tokens),
    durationMs: Number.isFinite(durationMs) ? Math.min(2147483647, Math.max(0, Math.round(durationMs))) : 0,
  };
}

export function buildGenerationCostRow(context: GenerationCostContext, sample: GenerationSample) {
  return {
    user_id: context.userId,
    report_id: context.reportId,
    interpretation_tier: context.interpretationTier,
    plan_at_request: context.planAtRequest,
    claim_consumed: context.claimConsumed,
    model: sample.model,
    prompt_tokens: sample.promptTokens,
    completion_tokens: sample.completionTokens,
    total_tokens: sample.totalTokens,
    deep: context.deep,
    duration_ms: sample.durationMs,
  };
}

/** Record every sample even if an earlier insert failed. A request consumes at
 * most one claim: attribute it to the final call, never to a discarded retry. */
export async function recordGenerationCosts(
  context: GenerationCostContext,
  samples: readonly GenerationSample[],
  insert: (row: ReturnType<typeof buildGenerationCostRow>) => Promise<void>,
  log: (error: unknown) => void,
): Promise<void> {
  for (const [index, sample] of samples.entries()) {
    try {
      await insert(buildGenerationCostRow({
        ...context, claimConsumed: context.claimConsumed && index === samples.length - 1,
      }, sample));
    } catch (error) {
      log(error);
    }
  }
}
