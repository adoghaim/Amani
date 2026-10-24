import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import { z } from 'zod';
import * as outcome from './generation-outcome';
import * as placement from './lab-placement';
import * as shaping from './response-shaping';
import * as authority from './claim-authority';
import * as nutrients from './nutrient-policy';
import { buildBasicProjection } from './interpretation-visibility';
import { callModelUnlessPaused } from './ai-pause';
import { formatTrendEvidencePrompt } from './trend-evidence';
import { redactLabText } from './lab-text-redaction';
import { chatCompletionParams, REASONING_TOKEN_HEADROOM, resolveOpenAiModel } from './openai-models';
import { generationSample, type GenerationSample } from './generation-cost';

// Execute the actual handler's model and shaping functions, as the existing
// handler suites do. All network I/O is replaced; no Deno isolate or credentials.
const source = readFileSync(new URL('../generate-interpretation/index.ts', import.meta.url), 'utf8');
function fragment(start: string, end: string) {
  const a = source.indexOf(start);
  const b = source.indexOf(end, a);
  expect(a).toBeGreaterThan(0);
  expect(b).toBeGreaterThan(a);
  return source.slice(a, b);
}
function evaluate(code: string, values: Record<string, unknown>) {
  return new Function(...Object.keys(values), transformSync(code, { loader: 'ts', target: 'es2022' }).code)(...Object.values(values));
}
const schemaSource = readFileSync(new URL('./schemas/interpretation.ts', import.meta.url), 'utf8');
const InterpretationSchema = evaluate(schemaSource.replace(/^import[^\n]+\n/, '').replace('export const ', 'const ').replace('export type ', 'type ')
  + '\nreturn InterpretationSchema;', { z });

const marker = (slug: string, name: string, value: number, min: number | null, max: number | null) => ({
  id: slug, canonical_slug: slug, raw_name: name, value_numeric: value, raw_value_text: String(value),
  unit: slug === 'tsh' ? 'uIU/mL' : slug === 'ldl_cholesterol' ? 'mg/dL' : 'ng/mL',
  normalized_min: min, normalized_max: max, normalized_operator: null, normalized_operator_value: null,
  raw_reference_range: `${min ?? ''}-${max ?? ''}`, is_core: true,
});
const panel = [marker('ferritin', 'Ferritin', 18, 16, 154), marker('tsh', 'TSH', 2.85, 0.4, 4.5),
  marker('vitamin_d_25_oh', 'Vitamin D', 24, 30, 100),
  { ...marker('ldl_cholesterol', 'LDL', 112, null, null), raw_reference_range: '<100',
    normalized_operator: '<', normalized_operator_value: 100 }];
const modelBody = () => ({
  headline: 'Synthetic model headline', primary_concern: { title: 'Vitamin D', summary: 'Synthetic summary', why_it_matters: 'Synthetic context' },
  key_findings: [], pattern_signals: [], what_you_can_do_now: [], what_to_do_next: [],
  overall_interpretation: 'The panel is mainly about iron markers.', questions_for_doctor: [],
  cycle_context: {}, disclaimer: 'Educational use only.',
});
const answer = (body: unknown = modelBody(), finish_reason = 'stop') => new Response(JSON.stringify({
  choices: [{ message: { content: typeof body === 'string' ? body : JSON.stringify(body) }, finish_reason }],
}), { status: 200 });

type Produced = {
  shaped: { source: string; payload: Record<string, unknown> };
  fallbackReason: outcome.FallbackReason | null;
  modelFailure: outcome.ModelFailure | null;
  floorViolations: unknown[];
  interpretationJson: Record<string, unknown>;
};
// The function secrets callOpenAIOnce reads through Deno.env (RV-MM1). Empty unless a test sets one.
const modelEnv: Record<string, string> = {};
function harness() {
  const fetch = vi.fn(async (_url: string, _init: RequestInit) => answer());
  const api = evaluate(fragment('function classifyAnalyte(', '// ─── Context sanitization')
    + fragment('async function produceInterpretation(', '// ─── Version store')
    + '\nreturn { buildPrimaryContext, generateFallbackInterpretation, produceInterpretation };', {
    ...outcome, ...placement, ...shaping, ...authority, ...nutrients, InterpretationSchema,
    fetchWithBackoff: fetch, redactLabText, formatTrendEvidencePrompt, buildBasicProjection, callModelUnlessPaused,
    resolveOpenAiModel, chatCompletionParams, generationSample, Deno: { env: { get: (name: string) => modelEnv[name] } },
  }) as {
    buildPrimaryContext: (analytes: typeof panel, prior: typeof panel, date: string | null, pinned: string) => Record<string, unknown>;
    generateFallbackInterpretation: (report: unknown, analytes: typeof panel, primary: unknown) => Record<string, unknown>;
    produceInterpretation: (input: Record<string, unknown>) => Promise<Produced>;
  };
  const primary = api.buildPrimaryContext(panel, [], null, 'vitamin_d_25_oh');
  const report = { id: 'synthetic', report_date: '2026-10-17', estimated_cycle_phase: 'unknown', estimated_cycle_day: null };
  return { api, fetch, report, primary, run: (overrides: Record<string, unknown> = {}) => api.produceInterpretation({
    ctx: { report, analytes: panel, primaryContext: primary, userContextBlock: null, isOptimizationOnly: false },
    reportId: 'synthetic', trendEvidence: [], tier: 'free', generateDeep: true, policyActive: true,
    openaiApiKey: 'synthetic-key-not-a-credential', aiPaused: false, ...overrides,
  }) };
}
afterEach(() => vi.restoreAllMocks());

// Do not print synthetic model bodies either: match the handler suites' log isolation.
function silence() {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
}

describe('October smoke: the real model/fallback pipeline', () => {
  it('pins Vitamin D in the prompt and persisted narrative; both paths use the printed lab ranges', async () => {
    silence();
    const h = harness();
    const generated = await h.run();
    expect(generated.shaped.source).toBe('ai');
    expect(generated.fallbackReason).toBeNull();
    expect(generated.floorViolations).toEqual([]);
    const expected = "Vitamin D is below the lab's reference range at 24 ng/mL. LDL is also above the lab's reference range at 112 mg/dL.";
    expect(generated.interpretationJson.overall_interpretation).toBe(expected);
    expect(h.api.generateFallbackInterpretation(h.report, panel, h.primary).overall_interpretation).toBe(expected);
    const prompt = JSON.parse(h.fetch.mock.calls[0]![1].body as string).messages[1].content;
    expect(prompt).toContain('Ferritin [ferritin]: 18 ng/mL (ref: 16-154) (within lab range)');
    expect(prompt).toContain('TSH [tsh]: 2.85 uIU/mL (ref: 0.4-4.5) (within lab range)');
    expect(prompt).toContain('Vitamin D [vitamin_d_25_oh]: 24 ng/mL (ref: 30-100) ← BELOW LAB RANGE');
    expect(prompt).toContain('"primary_biomarker": "Vitamin D"');
    expect(prompt).not.toContain('Ferritin remains low at 18');
  });

  it.each([
    ['ai_not_configured', { openaiApiKey: undefined }],
    ['ai_paused', { aiPaused: true }],
    ['introductory_access_exhausted', { generateDeep: false }],
  ] as const)('%s: no model call, deterministic body, floor intact', async (reason, override) => {
    silence();
    const h = harness();
    const produced = await h.run(override);
    expect(h.fetch).not.toHaveBeenCalled();
    expect(produced.shaped.source).toBe('fallback');
    expect(produced.fallbackReason).toBe(reason);
    expect(produced.floorViolations).toEqual([]);
  });

  it.each([401, 404, 429, 500])('non-2xx %s exposes only the status code', async status => {
    silence();
    const h = harness();
    h.fetch.mockResolvedValue(new Response('upstream body must not escape', { status }));
    const produced = await h.run();
    expect(produced.fallbackReason).toBe('model_failed');
    expect(produced.modelFailure).toBe(`http_${status}`);
    expect(produced.floorViolations).toEqual([]);
  });

  it.each([
    ['truncated', () => answer(modelBody(), 'length')],
    ['output_rejected', () => answer('not JSON')],
    ['output_rejected', () => answer({ headline: 'missing fields' })],
    ['output_rejected', () => answer({ ...modelBody(), overall_interpretation: 'Take 5000 IU of vitamin D daily.' })],
  ] as const)('%s: rejects unusable output, including both unsafe attempts', async (failure, response) => {
    silence();
    const h = harness();
    h.fetch.mockImplementation(async () => response());
    const produced = await h.run();
    expect(produced.shaped.source).toBe('fallback');
    expect(produced.modelFailure).toBe(failure);
    expect(produced.floorViolations).toEqual([]);
    if (h.fetch.mock.calls.length === 2) expect(failure).toBe('output_rejected');
  });

  it.each(['AbortError', 'TypeError'])('%s: distinguishes timeout from network failure', async name => {
    silence();
    const h = harness();
    h.fetch.mockRejectedValue(Object.assign(new Error('synthetic failure'), { name }));
    expect((await h.run()).modelFailure).toBe(name === 'AbortError' ? 'timeout' : 'network_error');
  });

  it('uses exact bounds even within the server claim classifier margin, with no invented prior change', () => {
    const h = harness();
    const values = [marker('tsh', 'TSH', 4.51, 0.4, 4.5)];
    const primary = h.api.buildPrimaryContext(values, [], null, 'tsh');
    const fallback = h.api.generateFallbackInterpretation(h.report, values, primary);
    expect(fallback.overall_interpretation).toBe("TSH is above the lab's reference range at 4.51 uIU/mL.");
    expect(JSON.stringify(fallback)).not.toMatch(/borderline|near the edge|remains|improved|worsened/);
  });
});

// RV-MM1 AC1: callOpenAIOnce takes its model id and limits from _shared/openai-models.ts.
describe('interpretation model wiring: one secret drives both attempts', () => {
  afterEach(() => { for (const name of Object.keys(modelEnv)) delete modelEnv[name]; });
  const sentBodies = (h: ReturnType<typeof harness>) =>
    h.fetch.mock.calls.map(([, init]) => JSON.parse(init.body as string) as Record<string, unknown>);
  // A violating first answer forces the stricter retry, as in the output_rejected case above.
  const violating = () => answer({ ...modelBody(), overall_interpretation: 'Take 5000 IU of vitamin D daily.' });

  it("no secret: today's body, gpt-4o-mini with max_tokens 2200, temperature 0.25, JSON mode, not stored", async () => {
    silence();
    const h = harness();
    await h.run();
    const bodies = sentBodies(h);
    expect(bodies).toHaveLength(1);
    expect(Object.keys(bodies[0]!)).toEqual(['model', 'messages', 'max_tokens', 'temperature', 'response_format', 'store']);
    expect(bodies[0]).toMatchObject({ model: 'gpt-4o-mini', max_tokens: 2200, temperature: 0.25,
      response_format: { type: 'json_object' }, store: false });
  });

  it('OPENAI_MODEL_INTERPRETATION=gpt-6-luna: both attempts send it, with max_completion_tokens and no temperature', async () => {
    silence();
    modelEnv.OPENAI_MODEL_INTERPRETATION = 'gpt-6-luna';
    const h = harness();
    h.fetch.mockImplementationOnce(async () => violating());
    const produced = await h.run();
    const bodies = sentBodies(h);
    expect(bodies).toHaveLength(2);
    for (const body of bodies) {
      expect(Object.keys(body)).toEqual(['model', 'messages', 'max_completion_tokens', 'response_format', 'store']);
      expect(body).toMatchObject({ model: 'gpt-6-luna', max_completion_tokens: 2200 + REASONING_TOKEN_HEADROOM,
        response_format: { type: 'json_object' }, store: false });
    }
    expect(produced.shaped.source).toBe('ai');
  });

  it.each(['gpt-4o"; DROP', 'gpt 6', '../gpt-6-luna'])('a malformed secret %j keeps the default body', async bad => {
    silence();
    modelEnv.OPENAI_MODEL_INTERPRETATION = bad;
    const h = harness();
    await h.run();
    expect(sentBodies(h)[0]).toMatchObject({ model: 'gpt-4o-mini', max_tokens: 2200, temperature: 0.25 });
  });

  it('records the model the API reports, else the one requested', async () => {
    silence();
    modelEnv.OPENAI_MODEL_INTERPRETATION = 'gpt-6-luna';
    const h = harness();
    h.fetch.mockImplementationOnce(async () => violating())
      .mockImplementationOnce(async () => new Response(JSON.stringify({ model: 'gpt-6-luna-2026-11-01',
        choices: [{ message: { content: JSON.stringify(modelBody()) }, finish_reason: 'stop' }] }), { status: 200 }));
    const samples: GenerationSample[] = [];
    await h.run({ recordCost: (sample: GenerationSample) => samples.push(sample) });
    expect(samples.map(s => s.model)).toEqual(['gpt-6-luna', 'gpt-6-luna-2026-11-01']);
  });
});
