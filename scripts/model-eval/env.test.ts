// RV-MM1 AC7, AC11: the model eval's refusals and targets. Pure: no request is possible here.
import { describe, expect, it } from 'vitest';
import { DEFAULT_OPENAI_MODELS } from '../../supabase/functions/_shared/openai-models';
import { readEvalConfig, targetEnv, USES, type EvalTarget } from './env';

const KEY = 'sk-eval-synthetic-not-a-key';

/** An environment that records every name the eval reads. */
function recording(values: Record<string, string | undefined>) {
  const read = new Set<string>();
  const env = new Proxy(values, {
    get(target, name) {
      if (typeof name === 'string') read.add(name);
      return target[name as string];
    },
  });
  return { env, read };
}

const ok = (values: Record<string, string | undefined>) => {
  const result = readEvalConfig(values);
  if (!result.ok) throw new Error(result.reason);
  return result.config;
};

describe('refusals (AC7): one line, nothing sent', () => {
  it.each(['true', '1', 'false', ''])('refuses whenever CI is set (CI=%j), key or not', ci => {
    for (const extra of [{}, { AMANI_EVAL_OPENAI_API_KEY: KEY }, { AMANI_EVAL_DRY_RUN: '1' }]) {
      const result = readEvalConfig({ CI: ci, ...extra });
      expect(result).toEqual({ ok: false, reason: expect.stringMatching(/^model eval refused: CI is set/) });
    }
  });

  it('refuses without an eval key unless it is a dry run', () => {
    expect(readEvalConfig({})).toEqual({ ok: false, reason: expect.stringContaining('AMANI_EVAL_OPENAI_API_KEY') });
    expect(readEvalConfig({ AMANI_EVAL_OPENAI_API_KEY: '   ' }).ok).toBe(false);
    expect(ok({ AMANI_EVAL_DRY_RUN: '1' })).toMatchObject({ dryRun: true, apiKey: null });
  });

  it('never falls back to OPENAI_API_KEY, and never reads it', () => {
    const { env, read } = recording({ OPENAI_API_KEY: KEY });
    expect(readEvalConfig(env).ok).toBe(false);
    expect(read.has('OPENAI_API_KEY')).toBe(false);
  });

  it('reads only CI and AMANI_EVAL_* names', () => {
    const { env, read } = recording({ AMANI_EVAL_OPENAI_API_KEY: KEY, OPENAI_API_KEY: 'x', HOME: '/home/x' });
    expect(readEvalConfig(env).ok).toBe(true);
    for (const name of read) expect(name).toMatch(/^(?:CI|AMANI_EVAL_[A-Z_]+)$/);
  });

  it('accepts only 1 for AMANI_EVAL_DRY_RUN, so "true" cannot turn into a real run', () => {
    expect(readEvalConfig({ AMANI_EVAL_DRY_RUN: 'true', AMANI_EVAL_OPENAI_API_KEY: KEY }))
      .toEqual({ ok: false, reason: 'model eval refused: AMANI_EVAL_DRY_RUN must be 1 or unset' });
  });

  it('a dry run holds no key even when one is set', () => {
    expect(ok({ AMANI_EVAL_DRY_RUN: '1', AMANI_EVAL_OPENAI_API_KEY: KEY }).apiKey).toBeNull();
  });

  it.each([
    ['AMANI_EVAL_REPEATS', '0'], ['AMANI_EVAL_REPEATS', '11'], ['AMANI_EVAL_REPEATS', '2.5'], ['AMANI_EVAL_REPEATS', 'three'],
    ['AMANI_EVAL_MAX_CALLS', '0'], ['AMANI_EVAL_MAX_CALLS', '-5'], ['AMANI_EVAL_MAX_CALLS', '10001'],
  ])('refuses %s=%j', (name, value) => {
    expect(readEvalConfig({ AMANI_EVAL_DRY_RUN: '1', [name]: value })).toEqual({ ok: false, reason: expect.stringContaining(name) });
  });

  it('defaults: 3 repeats, a cap of 200 calls, a new temp dir', () => {
    expect(ok({ AMANI_EVAL_DRY_RUN: '1' })).toMatchObject({ repeats: 3, maxCalls: 200, outDir: null });
    expect(ok({ AMANI_EVAL_DRY_RUN: '1', AMANI_EVAL_REPEATS: '1', AMANI_EVAL_MAX_CALLS: '40', AMANI_EVAL_OUT_DIR: ' /tmp/x ' }))
      .toMatchObject({ repeats: 1, maxCalls: 40, outDir: '/tmp/x' });
  });
});

describe('targets (AC11)', () => {
  it("default: each use's baseline, then OpenAI's suggested replacement", () => {
    expect(ok({ AMANI_EVAL_DRY_RUN: '1' }).targets).toEqual(USES.flatMap(use => [
      { use, role: 'baseline', model: DEFAULT_OPENAI_MODELS[use], effort: null },
      { use, role: 'candidate', model: use === 'labInsights' ? 'gpt-5.6-terra' : 'gpt-6-luna', effort: null },
    ]));
  });

  it('AMANI_EVAL_CANDIDATES names the uses and candidates to run, with an optional effort', () => {
    const targets = ok({ AMANI_EVAL_DRY_RUN: '1', AMANI_EVAL_CANDIDATES: 'labInsights=gpt-6-luna, interpretation=GPT-6-Luna@LOW,interpretation=gpt-6-luna@high' }).targets;
    expect(targets).toEqual([
      { use: 'interpretation', role: 'baseline', model: 'gpt-4o-mini', effort: null },
      { use: 'interpretation', role: 'candidate', model: 'gpt-6-luna', effort: 'low' },
      { use: 'interpretation', role: 'candidate', model: 'gpt-6-luna', effort: 'high' },
      { use: 'labInsights', role: 'baseline', model: 'gpt-5-mini', effort: null },
      { use: 'labInsights', role: 'candidate', model: 'gpt-6-luna', effort: null },
    ]);
  });

  it.each([
    ['nonsense', 'is not use=model'],
    ['labinsights=gpt-6-luna', 'unknown use'],
    ['ocr=gpt-4o"; DROP', 'is not use=model'],
    ['ocr=../gpt-6-luna', 'not a valid model id'],
    ['ocr=gpt-6-luna@extreme', 'the effort must be one of'],
    ['ocr=gpt-4o@low', 'needs a reasoning model'],
    ['ocr=gpt-6-luna,', 'entry 2'],
  ])('refuses AMANI_EVAL_CANDIDATES=%j without echoing it', (spec, why) => {
    const result = readEvalConfig({ AMANI_EVAL_DRY_RUN: '1', AMANI_EVAL_CANDIDATES: spec });
    expect(result.ok).toBe(false);
    const reason = (result as { reason: string }).reason;
    expect(reason).toContain(why);
    expect(reason).not.toContain('DROP');
    expect(reason.split('\n')).toHaveLength(1);
  });

  it('a target sets only its own use secrets; the baseline sets none', () => {
    const candidate: EvalTarget = { use: 'interpretation', role: 'candidate', model: 'gpt-6-luna', effort: 'low' };
    expect(targetEnv(candidate)).toEqual({ OPENAI_MODEL_INTERPRETATION: 'gpt-6-luna', OPENAI_REASONING_EFFORT_INTERPRETATION: 'low' });
    expect(targetEnv({ ...candidate, effort: null })).toEqual({ OPENAI_MODEL_INTERPRETATION: 'gpt-6-luna' });
    expect(targetEnv({ use: 'ocr', role: 'baseline', model: 'gpt-4o', effort: null })).toEqual({});
  });
});
