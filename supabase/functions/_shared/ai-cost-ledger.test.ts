import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  AI_FUNCTION_NAMES,
  buildAiCallCostRow,
  createAiCostLedger,
  estimateCostUsd,
  MODEL_PRICES,
  priceFor,
  UNKNOWN_MODEL_PRICE,
  type AiCallCostRow,
  type AiFunctionName,
} from './ai-cost-ledger.ts';

/*
  PK-FIX-01b: the ai_call_costs row each of the four AI functions writes
  through the ledger port, and its cost estimate.
*/

describe('priceFor', () => {
  it('matches the model the API reports to its family, longest prefix first', () => {
    expect(priceFor('gpt-4o-mini-2024-07-18')).toBe(MODEL_PRICES['gpt-4o-mini']);
    expect(priceFor('gpt-4o-mini')).toBe(MODEL_PRICES['gpt-4o-mini']);
    expect(priceFor('gpt-4o-2024-08-06')).toBe(MODEL_PRICES['gpt-4o']);
    expect(priceFor('GPT-4o')).toBe(MODEL_PRICES['gpt-4o']);
    expect(priceFor('gpt-5-mini-2025-08-07')).toBe(MODEL_PRICES['gpt-5-mini']);
  });

  it('prices an unlisted model at the most expensive listed rate, so it can only alert early', () => {
    expect(priceFor('gpt-9-ultra')).toBe(UNKNOWN_MODEL_PRICE);
    expect(priceFor('gpt-4oops')).toBe(UNKNOWN_MODEL_PRICE);
    for (const price of Object.values(MODEL_PRICES)) {
      expect(UNKNOWN_MODEL_PRICE.inputPerMillion).toBeGreaterThanOrEqual(price.inputPerMillion);
      expect(UNKNOWN_MODEL_PRICE.outputPerMillion).toBeGreaterThanOrEqual(price.outputPerMillion);
    }
  });

  it('prices every model the four functions request today', () => {
    const requested = new Set<string>();
    for (const fn of AI_FUNCTION_NAMES) {
      const source = readFileSync(new URL(`../${fn}/index.ts`, import.meta.url), 'utf8');
      for (const m of source.matchAll(/model:\s*"([^"]+)"/g)) requested.add(m[1]!);
    }
    expect(requested.size).toBeGreaterThanOrEqual(3);
    for (const model of requested) expect(priceFor(model), model).not.toBe(UNKNOWN_MODEL_PRICE);
  });
});

describe('estimateCostUsd', () => {
  it('is tokens times the per-million list price, to six decimals', () => {
    // gpt-4o: 2.50 in, 10.00 out per 1M.
    expect(estimateCostUsd('gpt-4o', 2000, 1000)).toBe(0.015);
    // gpt-4o-mini: 0.15 in, 0.60 out per 1M.
    expect(estimateCostUsd('gpt-4o-mini', 1000, 500)).toBe(0.00045);
    expect(estimateCostUsd('gpt-4o-mini', 1, 1)).toBe(0.000001);
  });

  it('counts unknown token counts as zero', () => {
    expect(estimateCostUsd('gpt-4o', null, null)).toBe(0);
    expect(estimateCostUsd('gpt-4o', null, 1000)).toBe(0.01);
  });
});

describe('buildAiCallCostRow', () => {
  it('maps an OpenAI usage object to the ledger columns', () => {
    expect(buildAiCallCostRow({
      functionName: 'parse-lab-report-ocr',
      userId: 'u1',
      model: 'gpt-4o-2024-08-06',
      usage: { prompt_tokens: 2000, completion_tokens: 1000, total_tokens: 3000 },
    })).toEqual({
      user_id: 'u1', function_name: 'parse-lab-report-ocr', model: 'gpt-4o-2024-08-06',
      input_tokens: 2000, output_tokens: 1000, est_cost_usd: 0.015,
    });
  });

  it('records unknown usage as null tokens, never a guess', () => {
    for (const usage of [undefined, null, 'x', {}, { prompt_tokens: -1, completion_tokens: 1.5 }, { prompt_tokens: '12' }]) {
      const row = buildAiCallCostRow({ functionName: 'lab-insights', userId: null, model: 'gpt-5-mini', usage });
      expect(row.input_tokens, JSON.stringify(usage)).toBeNull();
      expect(row.output_tokens, JSON.stringify(usage)).toBeNull();
      expect(row.est_cost_usd).toBe(0);
    }
  });

  it('never stores a model name the column would refuse', () => {
    expect(buildAiCallCostRow({ functionName: 'lab-insights', userId: null, model: 'gpt 4o; drop', usage: {} }).model).toBe('unknown');
    expect(buildAiCallCostRow({ functionName: 'lab-insights', userId: null, model: '', usage: {} }).model).toBe('unknown');
  });
});

describe('createAiCostLedger', () => {
  it('inserts exactly one row per recorded call', async () => {
    const rows: AiCallCostRow[] = [];
    const ledger = createAiCostLedger({ insert: async row => { rows.push(row); } });
    await ledger.record({ functionName: 'extract-biomarkers', userId: 'u1', model: 'gpt-4o-mini', usage: { prompt_tokens: 10, completion_tokens: 5 } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ function_name: 'extract-biomarkers', user_id: 'u1', input_tokens: 10, output_tokens: 5 });
  });

  it('is telemetry: a failed insert is logged and absorbed, never thrown into the request', async () => {
    const onError = vi.fn();
    const ledger = createAiCostLedger({ insert: async () => { throw new Error('db down'); }, onError });
    await expect(ledger.record({ functionName: 'lab-insights', userId: null, model: 'gpt-5-mini', usage: {} })).resolves.toBeUndefined();
    expect(onError).toHaveBeenCalledTimes(1);
    const silent = createAiCostLedger({ insert: async () => { throw new Error('db down'); }, onError: () => { throw new Error('log down'); } });
    await expect(silent.record({ functionName: 'lab-insights', userId: null, model: 'gpt-5-mini', usage: {} })).resolves.toBeUndefined();
  });

  it('refuses a function name outside the four, without inserting', async () => {
    const insert = vi.fn();
    const onError = vi.fn();
    await createAiCostLedger({ insert, onError })
      .record({ functionName: 'get-interpretation' as AiFunctionName, userId: null, model: 'gpt-4o', usage: {} });
    expect(insert).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('names the same four functions the migration CHECK allows', () => {
    const sql = readFileSync(new URL('../../migrations/20261013050000_ai_cost_ledger.sql', import.meta.url), 'utf8');
    const check = /function_name IN\s*\(([^)]*)\)/.exec(sql)?.[1] ?? '';
    expect([...check.matchAll(/'([^']+)'/g)].map(m => m[1]).sort()).toEqual([...AI_FUNCTION_NAMES].sort());
  });
});
