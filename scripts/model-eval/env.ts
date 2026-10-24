/**
 * The model eval's configuration (RV-MM1 AC7, AC11). It reads only CI and the
 * AMANI_EVAL_* names below, never OPENAI_API_KEY, and refuses with one line
 * rather than guessing. Refusing, it has sent nothing. Values are never
 * echoed back, so a key pasted into the wrong variable cannot reach a log.
 *
 *   AMANI_EVAL_OPENAI_API_KEY  the owner's eval-only key (a real run)
 *   AMANI_EVAL_DRY_RUN=1       no key, no network: build and write every request
 *   AMANI_EVAL_CANDIDATES      use=model[@effort],... (default: each default id's
 *                              replacement from OPENAI_MODEL_SHUTDOWNS)
 *   AMANI_EVAL_REPEATS         calls per case and model (default 3)
 *   AMANI_EVAL_MAX_CALLS       request cap for the run (default 200)
 *   AMANI_EVAL_OUT_DIR         where the full JSON goes (default: a new OS temp dir)
 */
import {
  DEFAULT_OPENAI_MODELS,
  isReasoningModel,
  OPENAI_MODEL_ENV,
  OPENAI_MODEL_SHUTDOWNS,
  OPENAI_REASONING_EFFORT_ENV,
  REASONING_EFFORTS,
  resolveOpenAiModel,
  type OpenAiModelUse,
  type ReasoningEffort,
} from '../../supabase/functions/_shared/openai-models';

export const USES = Object.keys(DEFAULT_OPENAI_MODELS) as OpenAiModelUse[];

export interface EvalTarget {
  use: OpenAiModelUse;
  /** The baseline is today's default; a candidate is sent through the use's secret. */
  role: 'baseline' | 'candidate';
  model: string;
  /** Sent through the use's OPENAI_REASONING_EFFORT_* secret; null leaves the model's default. */
  effort: ReasoningEffort | null;
}

export interface EvalConfig {
  dryRun: boolean;
  /** Null in a dry run. Never printed or written. */
  apiKey: string | null;
  targets: EvalTarget[];
  repeats: number;
  maxCalls: number;
  /** AMANI_EVAL_OUT_DIR as given, or null for a new OS temp dir. */
  outDir: string | null;
}

export type ConfigResult = { ok: true; config: EvalConfig } | { ok: false; reason: string };

export const DEFAULT_REPEATS = 3;
export const MAX_REPEATS = 10;
export const DEFAULT_MAX_CALLS = 200;
export const MAX_MAX_CALLS = 10_000;

const refuse = (why: string): ConfigResult => ({ ok: false, reason: `model eval refused: ${why}` });

export function readEvalConfig(env: Readonly<Record<string, string | undefined>>): ConfigResult {
  if (env.CI !== undefined) return refuse('CI is set; this eval is owner-run and never runs in CI');

  const dry = env.AMANI_EVAL_DRY_RUN;
  if (dry !== undefined && dry !== '' && dry !== '1') return refuse('AMANI_EVAL_DRY_RUN must be 1 or unset');
  const dryRun = dry === '1';
  const apiKey = env.AMANI_EVAL_OPENAI_API_KEY?.trim() || null;
  if (!dryRun && !apiKey) {
    return refuse('AMANI_EVAL_OPENAI_API_KEY (an eval-only key) is not set; set it, or AMANI_EVAL_DRY_RUN=1 for a dry run');
  }

  const repeats = wholeNumber(env.AMANI_EVAL_REPEATS, DEFAULT_REPEATS, MAX_REPEATS);
  if (repeats === null) return refuse(`AMANI_EVAL_REPEATS must be a whole number from 1 to ${MAX_REPEATS}`);
  const maxCalls = wholeNumber(env.AMANI_EVAL_MAX_CALLS, DEFAULT_MAX_CALLS, MAX_MAX_CALLS);
  if (maxCalls === null) return refuse(`AMANI_EVAL_MAX_CALLS must be a whole number from 1 to ${MAX_MAX_CALLS}`);

  const targets = parseTargets(env.AMANI_EVAL_CANDIDATES);
  if (typeof targets === 'string') return refuse(targets);

  return {
    ok: true,
    config: { dryRun, apiKey: dryRun ? null : apiKey, targets, repeats, maxCalls, outDir: env.AMANI_EVAL_OUT_DIR?.trim() || null },
  };
}

function wholeNumber(value: string | undefined, fallback: number, max: number): number | null {
  if (value === undefined || value.trim() === '') return fallback;
  if (!/^\d+$/.test(value.trim())) return null;
  const n = Number(value.trim());
  return n >= 1 && n <= max ? n : null;
}

type Candidate = Omit<EvalTarget, 'role'>;

/** Each use with a candidate: its baseline first, then its candidates in the order given. */
function parseTargets(spec: string | undefined): EvalTarget[] | string {
  const candidates: Candidate[] = [];
  if (spec === undefined || spec.trim() === '') {
    for (const use of USES) {
      const shutdown = OPENAI_MODEL_SHUTDOWNS[DEFAULT_OPENAI_MODELS[use]];
      if (!shutdown) return `no replacement is listed for ${DEFAULT_OPENAI_MODELS[use]}; name a candidate in AMANI_EVAL_CANDIDATES`;
      candidates.push({ use, model: shutdown.replacement, effort: null });
    }
  } else {
    const entries = spec.split(',');
    for (const [index, raw] of entries.entries()) {
      const entry = raw.trim();
      const where = `AMANI_EVAL_CANDIDATES entry ${index + 1}`;
      const match = /^(\w+)=([^@\s]+)(?:@([^@\s]+))?$/.exec(entry);
      if (!match) return `${where} is not use=model or use=model@effort`;
      const [, useName, modelName, effortName] = match;
      const use = USES.find(u => u === useName);
      if (!use) return `${where} names an unknown use (one of ${USES.join(', ')})`;
      const model = modelName!.toLowerCase();
      // The id must pass the same pattern the handlers apply to their secrets.
      if (resolveOpenAiModel(use, () => model) !== model) return `${where} is not a valid model id`;
      let effort: ReasoningEffort | null = null;
      if (effortName !== undefined) {
        effort = REASONING_EFFORTS.find(listed => listed === effortName.toLowerCase()) ?? null;
        if (!effort) return `${where}: the effort must be one of ${REASONING_EFFORTS.join(', ')}`;
        if (!isReasoningModel(model)) return `${where}: an effort needs a reasoning model; a chat model never receives it`;
      }
      if (!candidates.some(c => c.use === use && c.model === model && c.effort === effort)) {
        candidates.push({ use, model, effort });
      }
    }
  }
  return USES.flatMap(use => {
    const mine = candidates.filter(c => c.use === use);
    if (mine.length === 0) return [];
    return [
      { use, role: 'baseline' as const, model: DEFAULT_OPENAI_MODELS[use], effort: null },
      ...mine.map(c => ({ ...c, role: 'candidate' as const })),
    ];
  });
}

/** The function secrets a target sets: none for the baseline, the use's model (and effort) secret otherwise. */
export function targetEnv(target: EvalTarget): Record<string, string> {
  if (target.role === 'baseline') return {};
  return {
    [OPENAI_MODEL_ENV[target.use]]: target.model,
    ...(target.effort ? { [OPENAI_REASONING_EFFORT_ENV[target.use]]: target.effort } : {}),
  };
}

export function targetLabel(target: EvalTarget): string {
  return target.effort ? `${target.model}@${target.effort}` : target.model;
}
