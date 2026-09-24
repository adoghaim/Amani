import { describe, expect, it, vi } from 'vitest';
import { buildGenerationCostRow, generationSample, recordGenerationCosts } from './generation-cost';

const context = { userId: 'user', reportId: 'report', interpretationTier: 'free',
  planAtRequest: 'free', claimConsumed: false, deep: true };
const sample = generationSample('gpt-4o-mini', { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 }, 12.6);

describe('generation cost rows', () => {
  it('records provider usage and request plan independently from persisted tier', () => {
    expect(buildGenerationCostRow({ ...context, interpretationTier: 'plus', claimConsumed: true }, sample)).toEqual({
      user_id: 'user', report_id: 'report', interpretation_tier: 'plus', plan_at_request: 'free',
      claim_consumed: true, model: 'gpt-4o-mini', prompt_tokens: 100, completion_tokens: 20,
      total_tokens: 120, deep: true, duration_ms: 13,
    });
  });
  it('does not invent zero usage for a failed or malformed response', () => {
    expect(generationSample('model', undefined, 30)).toMatchObject({ promptTokens: null, completionTokens: null, totalTokens: null });
    expect(generationSample('model', { prompt_tokens: -1, completion_tokens: 1.5, total_tokens: Infinity }, -10))
      .toMatchObject({ promptTokens: null, completionTokens: null, totalTokens: null, durationMs: 0 });
  });
  it('accepts zero usage and bounds duration for a postgres integer', () => {
    expect(generationSample('model', { total_tokens: 0 }, 3e12)).toMatchObject({ totalTokens: 0, durationMs: 2147483647 });
  });
  it('logs a failed insert and still records the retry without failing generation', async () => {
    const insert = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(undefined);
    const log = vi.fn();
    await recordGenerationCosts({ ...context, claimConsumed: true }, [sample, sample], insert, log);
    expect(insert).toHaveBeenCalledTimes(2);
    expect(insert.mock.calls[0][0].claim_consumed).toBe(false);
    expect(insert.mock.calls[1][0].claim_consumed).toBe(true);
    expect(log).toHaveBeenCalledOnce();
  });
  it('no model call means no cost row; race losers never consume a claim', async () => {
    const insert = vi.fn();
    await recordGenerationCosts(context, [], insert, vi.fn());
    expect(insert).not.toHaveBeenCalled();
    await recordGenerationCosts(context, [sample], insert, vi.fn());
    expect(insert.mock.calls[0][0]).toMatchObject({ claim_consumed: false, interpretation_tier: 'free', deep: true });
  });
});
