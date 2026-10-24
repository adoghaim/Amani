// RV-MM1 AC10, AC12: each failure mode is flagged, and BLOCKING is exactly the brief's list.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  callBlocking, callRecord, checkInsights, checkInterpretation, checkInterpretationAttempt, checkRows, expectedNumber,
  printedValues, verdictFor, type CallRecord,
} from './checks';
import type { EvalTarget } from './env';
import { cleanInsights, cleanInterpretation, perfectItems } from './fake-openai.testkit';
import { loadFixtures } from './fixtures';
import type { AttemptRecord } from './guard';
import type { ProducedInterpretation } from './handlers';

beforeEach(() => {
  vi.stubGlobal('fetch', () => { throw new Error('offline test: global fetch must not be called'); });
});
afterEach(() => vi.unstubAllGlobals());

const fixtures = loadFixtures();
const text = (id: string) => fixtures.texts.find(t => t.id === id)!;

const ok: AttemptRecord = { latencyMs: 1200, status: 200, timedOut: false, error: null };
const status = (code: number): AttemptRecord => ({ latencyMs: 300, status: code, timedOut: false, error: null });
const timedOut: AttemptRecord = { latencyMs: 18000, status: null, timedOut: true, error: 'AbortError' };

function answered(content: unknown, options: { finish?: string; model?: string; attempts?: AttemptRecord[]; body?: Record<string, unknown> } = {}): CallRecord {
  const model = options.model ?? 'gpt-4o-mini';
  return callRecord(
    { model, messages: [], max_tokens: 2200, temperature: 0.25, response_format: { type: 'json_object' }, store: false, ...options.body },
    18000,
    options.attempts ?? [ok],
    JSON.stringify({
      model: `${model}-2024-07-18`,
      choices: [{ message: { content: typeof content === 'string' ? content : JSON.stringify(content) }, finish_reason: options.finish ?? 'stop' }],
      usage: { prompt_tokens: 1000, completion_tokens: 500, completion_tokens_details: { reasoning_tokens: 120 } },
    }),
  );
}

const unanswered = (attempts: AttemptRecord[]): CallRecord =>
  callRecord({ model: 'gpt-6-luna', messages: [], max_completion_tokens: 6200 }, 18000, attempts, null);

function produced(over: Partial<ProducedInterpretation> = {}): ProducedInterpretation {
  const payload = { ...cleanInterpretation(), overall_interpretation: 'Vitamin D is below the lab\'s reference range at 24 ng/mL.' };
  return {
    shaped: { source: 'ai', tier: 'free', depth: 'deep', payload }, aiInterpretation: payload,
    interpretationJson: payload, basicProjection: { headline: payload.headline, disclaimer: payload.disclaimer },
    floorViolations: [], fallbackReason: null, modelFailure: null, ...over,
  };
}

describe('callRecord (AC10): what is recorded per call', () => {
  it('status, finish_reason, usage with reasoning tokens against the cap, reported model, estimated cost', () => {
    const call = answered(cleanInterpretation(), { model: 'gpt-6-luna', body: { max_tokens: undefined, temperature: undefined, max_completion_tokens: 6200 } });
    expect(call).toMatchObject({
      status: 200, finishReason: 'stop', cap: 6200, requestedModel: 'gpt-6-luna', reportedModel: 'gpt-6-luna-2024-07-18',
      usage: { promptTokens: 1000, completionTokens: 500, reasoningTokens: 120 },
    });
    // gpt-6-luna at 0.10 in / 0.50 out per 1M.
    expect(call.estCostUsd).toBe(0.00035);
    expect(call.content).toContain('Synthetic model headline');
  });

  it('a call that never got a response records its attempts and no answer', () => {
    const call = unanswered([timedOut, timedOut, timedOut]);
    expect(call).toMatchObject({ status: null, content: null, response: null, reportedModel: null, estCostUsd: 0 });
  });
});

describe('BLOCKING reasons every use shares (AC12)', () => {
  it.each([
    ['a 4xx', answered('{}', { attempts: [status(400)] }), ['http_400']],
    ['a 429 even when the retry answers', answered(cleanInterpretation(), { attempts: [status(429), ok] }), ['http_429']],
    ['an attempt timeout even when the retry answers', answered(cleanInterpretation(), { attempts: [timedOut, ok] }), ['attempt_timeout']],
    ['finish_reason length', answered(cleanInterpretation(), { finish: 'length' }), ['finish_length']],
    ['empty content', answered(''), ['empty_content']],
    ['a clean answer', answered(cleanInterpretation()), []],
    ['a 5xx the retries never got past (INCOMPLETE, not BLOCKING)', unanswered([status(503), status(503), status(503)]), []],
  ])('%s', (_label, call, reasons) => {
    expect(callBlocking(call)).toEqual(reasons);
  });
});

describe('interpretation attempts and the served payload (AC10)', () => {
  it('flags an answer that is not JSON, and one that fails InterpretationSchema', () => {
    expect(checkInterpretationAttempt('not JSON')).toMatchObject({ json: false, schemaOk: false, policyValid: null });
    expect(checkInterpretationAttempt(JSON.stringify({ headline: 'missing fields' }))).toMatchObject({ json: true, schemaOk: false });
    expect(checkInterpretationAttempt(JSON.stringify(cleanInterpretation()))).toMatchObject({ schemaOk: true, policyValid: true, sanitizedNull: null });
  });

  it('flags a nutrient-policy violation, and whether sanitizing would fail closed', () => {
    const nested = checkInterpretationAttempt(JSON.stringify({ ...cleanInterpretation(), overall_interpretation: 'Take 5000 IU of vitamin D daily.' }));
    expect(nested).toMatchObject({ schemaOk: true, policyValid: false, sanitizedNull: true });
    expect(nested.violations.length).toBeGreaterThan(0);
    const listed = checkInterpretationAttempt(JSON.stringify({ ...cleanInterpretation(), what_you_can_do_now: ['Take 5000 IU of vitamin D daily.'] }));
    expect(listed).toMatchObject({ policyValid: false, sanitizedNull: false });
  });

  it('a clean served payload with its floor intact is not BLOCKING', () => {
    expect(checkInterpretation([answered(cleanInterpretation())], produced()).blocking).toEqual([]);
  });

  it('BLOCKING when the served payload fails validateInterpretationOutput, full or Basic', () => {
    const unsafe = { ...produced().interpretationJson, what_to_do_next: ['Take 5000 IU of vitamin D daily.'] };
    expect(checkInterpretation([answered(cleanInterpretation())], produced({ interpretationJson: unsafe })).blocking).toEqual(['served_validator']);
    const unsafeBasic = { headline: 'Supplement with 65 mg iron twice daily.' };
    const check = checkInterpretation([answered(cleanInterpretation())], produced({ basicProjection: unsafeBasic }));
    expect(check.blocking).toEqual(['served_validator']);
    expect(check.servedViolations.length).toBeGreaterThan(0);
  });

  it('BLOCKING on a medical-floor violation', () => {
    expect(checkInterpretation([answered(cleanInterpretation())], produced({ floorViolations: [{ key: 'disclaimer', reason: 'missing' }] })).blocking)
      .toEqual(['floor_violation']);
  });

  it('a fallback after a rejected answer is flagged in the attempts, not BLOCKING', () => {
    const calls = [answered({ headline: 'missing fields' })];
    const check = checkInterpretation(calls, produced({ shaped: { ...produced().shaped, source: 'fallback' }, fallbackReason: 'model_failed', modelFailure: 'output_rejected' }));
    expect(check).toMatchObject({ source: 'fallback', modelFailure: 'output_rejected', blocking: [] });
    expect(check.attempts[0]).toMatchObject({ json: true, schemaOk: false });
  });
});

describe('lab-insights (AC10)', () => {
  it('parses, counts violating strings before the policy, and marks her 502', () => {
    expect(checkInsights(answered(cleanInsights()))).toMatchObject({ parsed: true, violatingStrings: 0, policyRefused: false, blocking: [] });
    const dropped = checkInsights(answered({ ...cleanInsights(), next_steps_general: ['Take 5000 IU of vitamin D3 every morning'] }));
    expect(dropped).toMatchObject({ parsed: true, violatingStrings: 1, policyRefused: false });
    expect(checkInsights(answered({ ...cleanInsights(), summary: 'Start taking 500 mg of magnesium daily.' }))).toMatchObject({ policyRefused: true });
    expect(checkInsights(answered('not JSON'))).toMatchObject({ parsed: false });
  });
});

describe('extraction and OCR rows (AC10, AC12)', () => {
  const smoke = text('quest-smoke');

  it('a perfect answer finds every printed row with its value, text, unit and range', () => {
    const check = checkRows('extraction', answered({ items: perfectItems(smoke.rows) }), smoke.rows, [smoke.text]);
    expect(check).toMatchObject({ rows: 12, extra: 0, fabricated: [], blocking: [] });
    expect(check.expected.every(r => r.found && r.value && r.valueText && r.unit && r.range)).toBe(true);
  });

  it('accepts the shapes the handler accepts: items, biomarkers, and (extraction only) a bare array', () => {
    const items = perfectItems(smoke.rows);
    for (const content of [{ items }, { biomarkers: items }, items]) {
      expect(checkRows('extraction', answered(content), smoke.rows, [smoke.text]).rows).toBe(12);
    }
    expect(checkRows('ocr', answered({ biomarkers: items }), smoke.rows, [smoke.text], { cycle_day: null, cycle_phase: null }).rows).toBe(12);
    // parse-lab-report-ocr's own parse has no bare-array branch: zero rows, BLOCKING.
    expect(checkRows('ocr', answered(items), smoke.rows, [smoke.text], { cycle_day: null, cycle_phase: null }).blocking).toEqual(['zero_rows']);
  });

  it.each([
    ['no rows', { items: [] }],
    ['an unaccepted shape', { results: [{ raw_name: 'Ferritin', value_numeric: 18 }] }],
    ['rows without a numeric value', { items: [{ raw_name: 'Ferritin', value_numeric: 'eighteen' }] }],
  ])('BLOCKING when the answer parses to zero rows: %s', (_label, content) => {
    expect(checkRows('extraction', answered(content), smoke.rows, [smoke.text]).blocking).toEqual(['zero_rows']);
  });

  it('BLOCKING on a value neither printed nor a documented <X placeholder', () => {
    const items = perfectItems(smoke.rows).map(item => (item.raw_name === 'Ferritin' ? { ...item, value_numeric: 19 } : item));
    const check = checkRows('extraction', answered({ items }), smoke.rows, [smoke.text]);
    expect(check.fabricated).toEqual([19]);
    expect(check.blocking).toEqual(['fabricated_value']);
    expect(check.expected.find(r => r.name === 'Ferritin')).toMatchObject({ found: true, value: false });
  });

  it('a censored result stored as its documented placeholder (<150 as 75) is neither fabricated nor wrong', () => {
    const edge = text('edge-cases');
    expect(expectedNumber('<150')).toBe(75);
    expect(printedValues([edge.text])).toContain(75);
    const check = checkRows('extraction', answered({ items: perfectItems(edge.rows) }), edge.rows, [edge.text]);
    expect(check).toMatchObject({ fabricated: [], blocking: [] });
    expect(check.expected.find(r => r.name === 'Vitamin B12')).toMatchObject({ value: true, valueText: true });
  });

  it('scores a wrong unit, a borrowed interval and a missing row without blocking, and counts extra rows', () => {
    const hormones = text('quest-hormones');
    const items = perfectItems(hormones.rows)
      .map(item => (item.raw_name === 'PROLACTIN' ? { ...item, unit: 'ng/dL' } : item))
      .map(item => (item.raw_name === 'SHBG' ? { ...item, raw_reference_range: '33-333', normalized_reference_min: 33, normalized_reference_max: 333 } : item))
      .filter(item => item.raw_name !== 'TSH');
    items.push({ ...items[0]!, raw_name: 'Androstenedione, borrowed', value_numeric: 88 });
    const check = checkRows('extraction', answered({ items }), hormones.rows, [hormones.text]);
    expect(check.blocking).toEqual([]);
    expect(check.expected.find(r => r.name === 'PROLACTIN')).toMatchObject({ found: true, unit: false });
    expect(check.expected.find(r => r.name === 'SHBG')).toMatchObject({ found: true, range: false });
    expect(check.expected.find(r => r.name === 'TSH')).toMatchObject({ found: false });
    expect(check.expected.find(r => r.name === 'FSH')).toMatchObject({ found: true, range: null });
    expect(check.extra).toBe(1);
  });

  it('OCR: flags a missing source snippet, inferred cycle metadata, and accepts printed metadata', () => {
    const hormones = text('quest-hormones');
    const items = perfectItems(hormones.rows).map((item, i) => (i === 0 ? { ...item, source_snippet: '' } : item));
    const nothingPrinted = { cycle_day: null, cycle_phase: null };
    const inferred = checkRows('ocr', answered({ items, metadata: { cycle_day: null, cycle_phase: 'luteal' } }), hormones.rows, [hormones.text], nothingPrinted);
    expect(inferred.metadata).toEqual({ got: { cycle_day: null, cycle_phase: 'luteal' }, printed: nothingPrinted, ok: false, inferred: true });
    expect(inferred.expected[0]).toMatchObject({ found: true, snippet: false });
    expect(inferred.blocking).toEqual([]);
    const printed = checkRows('ocr', answered({ items, metadata: { cycle_day: 3, cycle_phase: null } }), hormones.rows, [hormones.text],
      { cycle_day: 3, cycle_phase: null });
    expect(printed.metadata).toMatchObject({ ok: true, inferred: false });
  });
});

describe('verdicts (AC12): BLOCKING, else ELIGIBLE with its metrics', () => {
  const target: EvalTarget = { use: 'extraction', role: 'candidate', model: 'gpt-6-luna', effort: null };
  const smoke = text('quest-smoke');
  const good = () => checkRows('extraction', answered({ items: perfectItems(smoke.rows) }), smoke.rows, [smoke.text]);

  it('ELIGIBLE with every metric when nothing blocks', () => {
    const verdict = verdictFor(target, [good(), good()]);
    expect(verdict).toMatchObject({ verdict: 'ELIGIBLE', blocking: {}, unanswered: 0 });
    expect(verdict.metrics).toMatchObject({ cases: 2, calls: 2, responses: 2, retries: 0, latencyP50Ms: 1200, reasoningMax: 120, cap: 2200 });
    expect(verdict.metrics.quality).toBe('rows 24/24 value 24/24 text 24/24 unit 24/24 range 24/24 extra 0 fabricated 0');
  });

  it('BLOCKING with each reason counted, whatever else passed', () => {
    const truncated = checkRows('extraction', answered({ items: perfectItems(smoke.rows) }, { finish: 'length' }), smoke.rows, [smoke.text]);
    const verdict = verdictFor(target, [good(), truncated, truncated]);
    expect(verdict).toMatchObject({ verdict: 'BLOCKING', blocking: { finish_length: 2 } });
  });

  it('INCOMPLETE when a call got no response after the retries; SKIPPED when told so', () => {
    const lost = checkRows('extraction', unanswered([status(503), status(503), status(503)]), smoke.rows, [smoke.text]);
    expect(verdictFor(target, [good(), lost])).toMatchObject({ verdict: 'INCOMPLETE', unanswered: 1 });
    expect(verdictFor({ ...target, use: 'ocr' }, [], true).verdict).toBe('SKIPPED');
  });

  it('carries no model text in its metrics', () => {
    const verdict = verdictFor({ ...target, use: 'labInsights' }, [checkInsights(answered(cleanInsights()))]);
    expect(JSON.stringify(verdict.metrics)).not.toContain('SYNTHETIC-ANSWER-MARKER');
  });
});
