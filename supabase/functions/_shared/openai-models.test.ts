import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  chatCompletionParams,
  DEFAULT_OPENAI_MODELS,
  isReasoningModel,
  OPENAI_MODEL_ENV,
  OPENAI_MODEL_SHUTDOWNS,
  REASONING_TOKEN_HEADROOM,
  resolveOpenAiModel,
  type OpenAiModelUse,
} from './openai-models.ts';
import { MODEL_PRICES, priceFor, UNKNOWN_MODEL_PRICE } from './ai-cost-ledger.ts';

const USES = Object.keys(DEFAULT_OPENAI_MODELS) as OpenAiModelUse[];

describe('default model ids (F128: none is switched without an eval and sign-off)', () => {
  it("keeps today's ids", () => {
    expect(DEFAULT_OPENAI_MODELS).toEqual({
      ocr: 'gpt-4o',
      extraction: 'gpt-4o-mini',
      interpretation: 'gpt-4o-mini',
      labInsights: 'gpt-5-mini',
    });
  });

  it.each(USES)('%s has a listed price, not the conservative unknown-model rate', use => {
    expect(priceFor(DEFAULT_OPENAI_MODELS[use])).not.toBe(UNKNOWN_MODEL_PRICE);
  });
});

describe('resolveOpenAiModel', () => {
  it.each(USES)('%s: the default when no secret is set', use => {
    expect(resolveOpenAiModel(use)).toBe(DEFAULT_OPENAI_MODELS[use]);
    expect(resolveOpenAiModel(use, () => undefined)).toBe(DEFAULT_OPENAI_MODELS[use]);
    expect(resolveOpenAiModel(use, () => '  ')).toBe(DEFAULT_OPENAI_MODELS[use]);
  });

  it.each(USES)('%s: the secret named for it wins, and only that one', use => {
    const env: Record<string, string> = { [OPENAI_MODEL_ENV[use]]: 'gpt-5.6-terra' };
    expect(resolveOpenAiModel(use, n => env[n])).toBe('gpt-5.6-terra');
    for (const other of USES.filter(u => u !== use)) {
      expect(resolveOpenAiModel(other, n => env[n])).toBe(DEFAULT_OPENAI_MODELS[other]);
    }
  });

  it('names a distinct documented secret per use', () => {
    expect(new Set(Object.values(OPENAI_MODEL_ENV)).size).toBe(USES.length);
  });

  it.each(['gpt-4o"; DROP', 'a b', '../x', 'x'.repeat(65), '-gpt', 'gpt\n5'])(
    'ignores a malformed override %j',
    bad => {
      expect(resolveOpenAiModel('ocr', () => bad)).toBe(DEFAULT_OPENAI_MODELS.ocr);
    },
  );
});

describe('isReasoningModel', () => {
  it.each(['gpt-5-mini', 'gpt-5', 'gpt-5-nano', 'gpt-5.6-terra', 'gpt-6-luna', 'o3', 'o4-mini', 'GPT-5-mini'])(
    '%s reasons', m => expect(isReasoningModel(m)).toBe(true));
  it.each(['gpt-4o', 'gpt-4o-mini', 'gpt-4o-2024-08-06', 'gpt-4.1', 'gpt-4'])(
    '%s is a chat model', m => expect(isReasoningModel(m)).toBe(false));
});

describe('chatCompletionParams: what each kind of model accepts (F131)', () => {
  it('gpt-5-mini: no temperature, max_completion_tokens with reasoning headroom, no max_tokens', () => {
    const params = chatCompletionParams('gpt-5-mini', { maxOutputTokens: 3000, temperature: 0.7 });
    expect(params).toEqual({ max_completion_tokens: 3000 + REASONING_TOKEN_HEADROOM });
    expect(params).not.toHaveProperty('temperature');
    expect(params).not.toHaveProperty('max_tokens');
  });

  it('chat models keep max_tokens and temperature exactly as the handlers sent them', () => {
    expect(chatCompletionParams('gpt-4o', { maxOutputTokens: 4000, temperature: 0.1 }))
      .toEqual({ max_tokens: 4000, temperature: 0.1 });
    expect(chatCompletionParams('gpt-4o-mini', { maxOutputTokens: 4000, temperature: 0.1 }))
      .toEqual({ max_tokens: 4000, temperature: 0.1 });
  });

  it('omits temperature for a chat model when none is asked for', () => {
    expect(chatCompletionParams('gpt-4o', { maxOutputTokens: 100 })).toEqual({ max_tokens: 100 });
  });

  it('follows an override: pointing a use at a reasoning model drops temperature with no handler change', () => {
    const model = resolveOpenAiModel('ocr', () => 'gpt-6-luna');
    expect(chatCompletionParams(model, { maxOutputTokens: 4000, temperature: 0.1 }))
      .not.toHaveProperty('temperature');
  });
});

describe('OPENAI_MODEL_SHUTDOWNS (RV-MM1 AC4)', () => {
  const FUNCTION_OF: Record<OpenAiModelUse, string> = {
    ocr: 'parse-lab-report-ocr', extraction: 'extract-biomarkers',
    interpretation: 'generate-interpretation', labInsights: 'lab-insights',
  };

  it("states OpenAI's announced dates and suggested replacements", () => {
    expect(OPENAI_MODEL_SHUTDOWNS).toEqual({
      'gpt-4o': { shutdown: '2027-01-14', replacement: 'gpt-6-luna' },
      'gpt-4o-mini': { shutdown: '2027-01-14', replacement: 'gpt-6-luna' },
      'gpt-5-mini': { shutdown: '2026-12-11', replacement: 'gpt-5.6-terra' },
    });
  });

  it.each(USES)('%s: its default id has an entry', use => {
    expect(OPENAI_MODEL_SHUTDOWNS[DEFAULT_OPENAI_MODELS[use]]).toBeDefined();
  });

  it.each(Object.entries(OPENAI_MODEL_SHUTDOWNS))(
    '%s: the replacement is a reasoning model with its own price row and a valid override id',
    (_model, { replacement }) => {
      expect(isReasoningModel(replacement)).toBe(true);
      expect(Object.keys(MODEL_PRICES)).toContain(replacement);
      expect(priceFor(replacement)).toBe(MODEL_PRICES[replacement]);
      expect(resolveOpenAiModel('ocr', () => replacement)).toBe(replacement);
    },
  );

  it('matches the table in docs/privacy/ai-processing.md section 1a', () => {
    const doc = readFileSync(new URL('../../../docs/privacy/ai-processing.md', import.meta.url), 'utf8');
    const section = doc.slice(doc.indexOf('## 1a.'), doc.indexOf('## 2.'));
    const rows = [...section.matchAll(/^\| `([a-z-]+)` \| `(\w+)` \| `([^`]+)` \| (\d{4}-\d{2}-\d{2}) \| `([^`]+)` \|$/gm)]
      .map(([, fn, use, model, shutdown, replacement]) => ({ fn, use, model, shutdown, replacement }));
    expect(rows).toEqual(USES.map(use => ({
      fn: FUNCTION_OF[use],
      use,
      model: DEFAULT_OPENAI_MODELS[use],
      ...OPENAI_MODEL_SHUTDOWNS[DEFAULT_OPENAI_MODELS[use]],
    })));
  });
});
