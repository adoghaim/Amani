// RV-MM1 AC9: the eval's requests are the handlers' own. Drift pins on everything the
// eval copies, and request equality against each handler's own request code.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  chatCompletionParams, DEFAULT_OPENAI_MODELS, OPENAI_MODEL_SHUTDOWNS, reasoningEffortParams, resolveOpenAiModel,
  type OpenAiModelUse,
} from '../../supabase/functions/_shared/openai-models';
import { redactLabText } from '../../supabase/functions/_shared/lab-text-redaction';
import { targetEnv, type EvalTarget } from './env';
import { insightsInput, loadFixtures, pageText } from './fixtures';
import { OPENAI_CHAT_COMPLETIONS } from './guard';
import {
  chatRequest, evaluate, extractionMessages, fragment, handlerSource, HANDLER_LIMITS, insightsMessages, insightsPrompt,
  interpretationApi, interpretationInput, LAB_INSIGHTS_SYSTEM_MESSAGE, MARKER_HANDLER, markerFragment, MARKERS, ocrMessages,
  type HandlerConsole, type MarkerName,
} from './handlers';

beforeEach(() => {
  vi.stubGlobal('fetch', () => { throw new Error('offline test: global fetch must not be called'); });
});
afterEach(() => vi.unstubAllGlobals());

const KEY = 'sk-test-synthetic-not-a-key';
const quiet: HandlerConsole = { log() {}, warn() {}, error() {}, info() {}, debug() {} };
const fixtures = loadFixtures();

const targetsFor = (use: OpenAiModelUse): EvalTarget[] => [
  { use, role: 'baseline', model: DEFAULT_OPENAI_MODELS[use], effort: null },
  { use, role: 'candidate', model: OPENAI_MODEL_SHUTDOWNS[DEFAULT_OPENAI_MODELS[use]]!.replacement, effort: null },
  { use, role: 'candidate', model: 'gpt-6-luna', effort: 'low' },
];

describe('drift pins: each handler still carries what the eval copies', () => {
  it.each(Object.keys(MARKERS) as MarkerName[])('%s: its start marker occurs once and its end marker follows it', name => {
    const source = handlerSource(MARKER_HANDLER[name]);
    const [start, end] = MARKERS[name];
    expect(source.split(start)).toHaveLength(2);
    expect(source.indexOf(end, source.indexOf(start) + start.length)).toBeGreaterThan(source.indexOf(start));
  });

  it.each(['ocr', 'extraction', 'labInsights'] as const)("%s: the eval's limits, timeout, JSON mode and store: false", use => {
    const source = handlerSource(use);
    const { maxOutputTokens, temperature, attemptTimeoutMs } = HANDLER_LIMITS[use];
    expect(source).toContain(`...chatCompletionParams(model, { maxOutputTokens: ${maxOutputTokens}, temperature: ${temperature} }),`);
    expect(source).toContain(`      { attemptTimeoutMs: ${attemptTimeoutMs} },\n`);
    expect(source).toContain('          response_format: { type: "json_object" },\n          store: false,\n');
    expect(source).toContain(`"${OPENAI_CHAT_COMPLETIONS}"`);
  });

  it("generate-interpretation: the eval's limits, timeout, JSON mode and store: false inside callOpenAIOnce", () => {
    const callOnce = fragment(handlerSource('interpretation'), ['async function callOpenAIOnce(', '// ─── Context sanitization']);
    const { maxOutputTokens, temperature, attemptTimeoutMs } = HANDLER_LIMITS.interpretation;
    expect(callOnce).toContain(`...chatCompletionParams(requestedModel, { maxOutputTokens: ${maxOutputTokens}, temperature: ${temperature} }),`);
    expect(callOnce).toContain(`      { attemptTimeoutMs: ${attemptTimeoutMs} },\n`);
    expect(callOnce).toContain('          response_format: { type: "json_object" },\n          store: false,\n');
  });

  it("lab-insights: the system message the eval copies", () => {
    expect(handlerSource('labInsights')).toContain(`              content: ${JSON.stringify(LAB_INSIGHTS_SYSTEM_MESSAGE)},\n`);
  });

  it("the two steps the eval restates are still the handlers' own", () => {
    expect(handlerSource('interpretation')).toContain(
      '  const isOptimizationOnly = !!(\n    pinnedSlug &&\n    primaryContext &&\n    primaryContext.current_status === "in_range"\n  );');
    for (const use of ['extraction', 'ocr'] as const) {
      expect(markerFragment(use === 'ocr' ? 'ocrParse' : 'extractionParse')).not.toContain('.filter(');
      expect(handlerSource(use)).toContain(
        "    const reportAnalytes: ReportAnalyte[] = rawItems\n      .filter(item => typeof item.value_numeric === 'number' && !isNaN(item.value_numeric))\n");
    }
  });
});

/** Runs a handler's own request code (its resolveOpenAiModel line to its response check) and returns what it sends. */
async function handlerRequest(use: 'ocr' | 'extraction' | 'labInsights', env: Record<string, string>, scope: Record<string, unknown>) {
  const marker = ({ ocr: 'ocrRequest', extraction: 'extractionRequest', labInsights: 'insightsRequest' } as const)[use];
  const sent: unknown[][] = [];
  await (evaluate(`return (async () => {\n${markerFragment(marker)}\n})();`, {
    ...scope, Deno: { env: { get: (name: string) => env[name] } }, openaiApiKey: KEY, redactLabText,
    resolveOpenAiModel, chatCompletionParams, reasoningEffortParams,
    fetchWithBackoff: async (...args: unknown[]) => { sent.push(args); return new Response('{}'); },
  }) as Promise<void>);
  expect(sent).toHaveLength(1);
  return sent[0];
}

const asSent = (request: ReturnType<typeof chatRequest>) => [request.url, request.init, request.options];

describe('request equality: the eval sends exactly what each handler would', () => {
  it.each(targetsFor('extraction'))('extraction, $role $model $effort', async target => {
    for (const text of fixtures.texts) {
      const env = targetEnv(target);
      const messages = extractionMessages(text.text) as Array<{ content: string }>;
      const ours = chatRequest('extraction', name => env[name], messages, KEY);
      const theirs = await handlerRequest('extraction', env, { systemPrompt: messages[0]!.content, userPrompt: messages[1]!.content });
      expect(theirs).toEqual(asSent(ours));
      expect(JSON.parse(ours.init.body)).toMatchObject({ model: target.model, store: false });
    }
  });

  it.each(targetsFor('ocr'))('ocr, $role $model $effort', async target => {
    const env = targetEnv(target);
    const images = ['data:image/png;base64,iVBORw0KGgo=', 'data:image/jpeg;base64,/9j/4AAQ'];
    const messages = ocrMessages(images) as Array<{ content: unknown }>;
    const ours = chatRequest('ocr', name => env[name], messages, KEY);
    const theirs = await handlerRequest('ocr', env, { systemPrompt: messages[0]!.content, userMessagesContent: messages[1]!.content });
    expect(theirs).toEqual(asSent(ours));
    expect((messages[1]!.content as unknown[]).slice(1)).toEqual(images.map(url => ({ type: 'image_url', image_url: { url } })));
  });

  it.each(targetsFor('labInsights'))('lab-insights, $role $model $effort', async target => {
    for (const pair of fixtures.pairs) {
      const env = targetEnv(target);
      const input = insightsInput(pair);
      const ours = chatRequest('labInsights', name => env[name], await insightsMessages(input), KEY);
      const theirs = await handlerRequest('labInsights', env, { prompt: await insightsPrompt(input) });
      expect(theirs).toEqual(asSent(ours));
    }
  });

  it.each(targetsFor('interpretation'))('interpretation through callOpenAIOnce, $role $model $effort', async target => {
    const env = targetEnv(target);
    const sent: Array<[string, RequestInit, { attemptTimeoutMs?: number }]> = [];
    const api = interpretationApi({
      fetchWithBackoff: async (url, init, options) => { sent.push([url, init, options ?? {}]); return new Response('{}', { status: 400 }); },
      getEnv: name => env[name], console: quiet,
    });
    for (const panel of fixtures.panels) {
      sent.length = 0;
      await api.produceInterpretation(interpretationInput(api, panel, KEY, () => {}));
      expect(sent).toHaveLength(1);
      const [url, init, options] = sent[0]!;
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      expect(url).toBe(OPENAI_CHAT_COMPLETIONS);
      expect(init.method).toBe('POST');
      expect(options).toEqual({ attemptTimeoutMs: HANDLER_LIMITS.interpretation.attemptTimeoutMs });
      const { maxOutputTokens, temperature } = HANDLER_LIMITS.interpretation;
      expect(body).toEqual({
        model: target.model,
        messages: body.messages,
        ...chatCompletionParams(target.model, { maxOutputTokens, temperature }),
        response_format: { type: 'json_object' },
        store: false,
        ...reasoningEffortParams('interpretation', target.model, name => env[name]),
      });
      expect(Object.keys(body)).toEqual(Object.keys({
        model: 0, messages: 0, ...chatCompletionParams(target.model, { maxOutputTokens, temperature }), response_format: 0, store: 0,
        ...(target.effort ? { reasoning_effort: 0 } : {}),
      }));
    }
  });

  it('a printed cycle-day page differs from its lab text only by the authored layout line', () => {
    const ocrCase = fixtures.ocr.find(c => c.printedCycle.cycle_day !== null)!;
    const page = ocrCase.pages[0]!;
    const text = fixtures.texts.find(t => t.id === page.text)!.text;
    expect(pageText(page, fixtures.texts).split('\n').filter(line => !text.split('\n').includes(line))).toEqual([page.insertLine!.line]);
  });
});
