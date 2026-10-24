/**
 * What the model eval measures, and when a model is ineligible (RV-MM1 AC10,
 * AC12). It applies only deterministic guardrails (the interpretation schema,
 * the nutrient policy, the medical floor, lab-insights' policy) and extraction
 * fidelity against what the synthetic fixture prints. It grades no clinical
 * content: the quality of a candidate's prose is the clinical reviewer's.
 * Pure, so checks.test.ts drives every failure mode with fake answers.
 */
import { estimateCostUsd } from '../../supabase/functions/_shared/ai-cost-ledger';
import { censoredPlaceholder, censoredResult, isCensoredValue } from '../../supabase/functions/_shared/censored-value';
import { parseLabInsightsCompletion, type LabInsightsOutput } from '../../supabase/functions/_shared/lab-insights-output';
import { enforceLabInsightsPolicy } from '../../supabase/functions/_shared/lab-insights-policy';
import {
  findTextViolations, sanitizeViolations, validateInterpretationOutput,
} from '../../supabase/functions/_shared/nutrient-policy';
import type { EvalTarget } from './env';
import type { ExpectedRow, PrintedCycle } from './fixtures';
import type { AttemptRecord } from './guard';
import {
  interpretationSchema, numericRows, parseExtractionContent, parseOcrContent, type ProducedInterpretation, type RawItem,
} from './handlers';

/** One logical model call: the handler's request, its transport attempts and the answer it used. */
export interface CallRecord {
  requestBody: Record<string, unknown>;
  attemptTimeoutMs: number | null;
  attempts: AttemptRecord[];
  /** Status of the last attempt, the one the handler used; null if it threw. */
  status: number | null;
  finishReason: string | null;
  /** The synthetic answer's message content (written to the JSON, never printed). */
  content: string | null;
  usage: { promptTokens: number | null; completionTokens: number | null; reasoningTokens: number | null };
  /** The output limit sent: max_completion_tokens or max_tokens. */
  cap: number | null;
  requestedModel: string;
  reportedModel: string | null;
  estCostUsd: number;
  /** The parsed API response, or null. */
  response: unknown;
}

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

const tokenCount = (value: unknown): number | null =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;

export function callRecord(
  requestBody: Record<string, unknown>,
  attemptTimeoutMs: number | null,
  attempts: AttemptRecord[],
  responseText: string | null,
): CallRecord {
  let response: unknown = null;
  if (responseText !== null) {
    try {
      response = JSON.parse(responseText);
    } catch {
      response = null;
    }
  }
  const body = asRecord(response);
  const choice = asRecord(Array.isArray(body.choices) ? body.choices[0] : undefined);
  const message = asRecord(choice.message);
  const usage = asRecord(body.usage);
  const promptTokens = tokenCount(usage.prompt_tokens);
  const completionTokens = tokenCount(usage.completion_tokens);
  const requestedModel = String(requestBody.model);
  const reportedModel = typeof body.model === 'string' ? body.model : null;
  const cap = typeof requestBody.max_completion_tokens === 'number' ? requestBody.max_completion_tokens
    : typeof requestBody.max_tokens === 'number' ? requestBody.max_tokens : null;
  return {
    requestBody,
    attemptTimeoutMs,
    attempts,
    status: attempts.at(-1)?.status ?? null,
    finishReason: typeof choice.finish_reason === 'string' ? choice.finish_reason : null,
    content: typeof message.content === 'string' ? message.content : null,
    usage: { promptTokens, completionTokens, reasoningTokens: tokenCount(asRecord(usage.completion_tokens_details).reasoning_tokens) },
    cap,
    requestedModel,
    reportedModel,
    estCostUsd: estimateCostUsd(reportedModel ?? requestedModel, promptTokens, completionTokens),
    response,
  };
}

/** BLOCKING reasons any call can carry: a 4xx, a timed-out attempt, a truncated or empty answer. */
export function callBlocking(call: CallRecord): string[] {
  const reasons: string[] = [];
  for (const attempt of call.attempts) {
    if (attempt.status !== null && attempt.status >= 400 && attempt.status < 500) reasons.push(`http_${attempt.status}`);
    if (attempt.timedOut) reasons.push('attempt_timeout');
  }
  if (call.status === 200) {
    if (call.finishReason === 'length') reasons.push('finish_length');
    if (call.content === null || call.content.trim() === '') reasons.push('empty_content');
  }
  return reasons;
}

interface CaseBase {
  calls: CallRecord[];
  blocking: string[];
  /** Every call ended in a response (no exhausted retries, network error or timeout). */
  answered: boolean;
}

export interface InterpretationAttemptCheck {
  json: boolean;
  schemaOk: boolean;
  /** validateInterpretationOutput on the schema-parsed answer; null when it did not parse. */
  policyValid: boolean | null;
  violations: string[];
  /** For a violating answer: sanitizeViolations would fail closed (null). */
  sanitizedNull: boolean | null;
}

export interface InterpretationCheck extends CaseBase {
  use: 'interpretation';
  attempts: InterpretationAttemptCheck[];
  source: string;
  fallbackReason: string | null;
  modelFailure: string | null;
  floorViolations: unknown[];
  /** validateInterpretationOutput on what is served: the full payload and the Basic projection. */
  servedViolations: string[];
}

export interface InsightsCheck extends CaseBase {
  use: 'labInsights';
  parsed: boolean;
  strings: number;
  /** Strings with a nutrient-policy violation before the policy ran. */
  violatingStrings: number;
  /** enforceLabInsightsPolicy refused the answer: her 502. */
  policyRefused: boolean;
}

export interface RowCheck {
  name: string;
  found: boolean;
  value: boolean;
  valueText: boolean;
  unit: boolean;
  /** Null when the printed range is a list of phase intervals (not scored). */
  range: boolean | null;
  /** OCR only: the row carries a source snippet. */
  snippet?: boolean;
}

export interface RowsCheck extends CaseBase {
  use: 'extraction' | 'ocr';
  /** Rows the handler keeps (numeric value) after its own parse. */
  rows: number;
  expected: RowCheck[];
  extra: number;
  /** value_numeric neither printed on the fixture nor a documented <X placeholder. */
  fabricated: number[];
  /** OCR only: the cycle metadata the handler keeps, against what the page prints. */
  metadata?: { got: PrintedCycle; printed: PrintedCycle; ok: boolean; inferred: boolean };
}

export type CaseCheck = InterpretationCheck | InsightsCheck | RowsCheck;

export function checkInterpretationAttempt(content: string | null): InterpretationAttemptCheck {
  const none = { schemaOk: false, policyValid: null, violations: [], sanitizedNull: null };
  if (content === null || content.trim() === '') return { json: false, ...none };
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return { json: false, ...none };
  }
  const schema = interpretationSchema().safeParse(parsed);
  if (!schema.success) return { json: true, ...none };
  const data = asRecord(schema.data);
  const policy = validateInterpretationOutput(data);
  return {
    json: true,
    schemaOk: true,
    policyValid: policy.valid,
    violations: policy.violations,
    sanitizedNull: policy.valid ? null : sanitizeViolations(data) === null,
  };
}

export function checkInterpretation(calls: CallRecord[], produced: ProducedInterpretation): InterpretationCheck {
  const servedViolations = [
    ...validateInterpretationOutput(produced.interpretationJson).violations,
    ...validateInterpretationOutput(produced.basicProjection).violations,
  ];
  const blocking = calls.flatMap(callBlocking);
  if (produced.floorViolations.length > 0) blocking.push('floor_violation');
  if (servedViolations.length > 0) blocking.push('served_validator');
  return {
    use: 'interpretation',
    calls,
    blocking,
    answered: calls.every(call => call.status !== null && call.status < 500),
    attempts: calls.map(call => checkInterpretationAttempt(call.status === 200 ? call.content : null)),
    source: produced.shaped.source,
    fallbackReason: produced.fallbackReason,
    modelFailure: produced.modelFailure,
    floorViolations: produced.floorViolations,
    servedViolations,
  };
}

function insightStrings(insights: LabInsightsOutput): string[] {
  return [
    insights.summary,
    ...insights.notable_changes.flatMap(change => [change.biomarker, change.change, ...change.possible_factors]),
    ...insights.questions_to_ask,
    ...insights.next_steps_general,
  ];
}

export function checkInsights(call: CallRecord): InsightsCheck {
  const parsed = call.status === 200 ? parseLabInsightsCompletion(call.response) : null;
  const strings = parsed ? insightStrings(parsed) : [];
  return {
    use: 'labInsights',
    calls: [call],
    blocking: callBlocking(call),
    answered: call.status !== null && call.status < 500,
    parsed: parsed !== null,
    strings: strings.length,
    violatingStrings: strings.filter(text => findTextViolations(text).length > 0).length,
    policyRefused: parsed !== null && enforceLabInsightsPolicy(parsed) === null,
  };
}

const normalizeName = (name: string): string => name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const near = (got: unknown, want: number): boolean =>
  typeof got === 'number' && Math.abs(got - want) <= 1e-9 * Math.max(1, Math.abs(want));

/** The value a row should store: the printed number, or for a censored result the documented placeholder. */
export function expectedNumber(printed: string): number {
  return isCensoredValue(printed) ? censoredPlaceholder(printed)! : Number(printed);
}

/** Every number printed on the texts, plus the documented placeholder (half the limit) of each printed `<X`. */
export function printedValues(texts: readonly string[]): number[] {
  const values: number[] = [];
  for (const text of texts) {
    for (const m of text.matchAll(/\d+(?:\.\d+)?|\.\d+/g)) values.push(Number(m[0]));
    for (const m of text.matchAll(/(?:<|≤)\s*(?:=|or\s*=)?\s*(?:\d+(?:\.\d+)?|\.\d+)/gi)) {
      const placeholder = censoredPlaceholder(m[0]);
      if (placeholder !== null) values.push(placeholder);
    }
  }
  return values;
}

const fieldNumber = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const fieldText = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

function rangeMatches(item: RawItem, row: ExpectedRow): boolean {
  const min = fieldNumber(item.normalized_reference_min);
  const max = fieldNumber(item.normalized_reference_max);
  const operator = fieldText(item.reference_operator);
  if (row.range === null) {
    return fieldText(item.raw_reference_range) === '' && min === null && max === null && operator === '';
  }
  const interval = /^(\d+(?:\.\d+)?)\s*[-–]\s*(\d+(?:\.\d+)?)$/.exec(row.range);
  if (interval) return near(min, Number(interval[1])) && near(max, Number(interval[2]));
  const limit = censoredResult(row.range);
  if (!limit) return false;
  const direction = operator.startsWith('<') || operator.startsWith('≤') ? '<'
    : operator.startsWith('>') || operator.startsWith('≥') ? '>' : '';
  return direction === limit.comparator[0] && near(item.reference_operator_value, limit.threshold);
}

function valueTextMatches(item: RawItem, row: ExpectedRow): boolean {
  const text = fieldText(item.value_text).replace(/\s+/g, '');
  if (isCensoredValue(row.value)) return text === row.value.replace(/\s+/g, '');
  return text === '' || parseFloat(text) === Number(row.value);
}

export function checkRows(
  use: 'extraction' | 'ocr',
  call: CallRecord,
  expected: readonly ExpectedRow[],
  printedTexts: readonly string[],
  printedCycle?: PrintedCycle,
): RowsCheck {
  const answeredWithContent = call.status === 200 && call.content !== null && call.content.trim() !== '';
  const parsed = !answeredWithContent ? { rawItems: [] as RawItem[], cycleMetadata: null }
    : use === 'ocr' ? parseOcrContent(call.content) : { rawItems: parseExtractionContent(call.content), cycleMetadata: null };
  const rows = numericRows(parsed.rawItems);
  const unmatched = [...rows];
  const checks = expected.map((row): RowCheck => {
    const sameName = unmatched.filter(item => normalizeName(String(item.raw_name ?? item.name ?? '')) === normalizeName(row.name));
    const item = sameName.find(candidate => near(candidate.value_numeric, expectedNumber(row.value))) ?? sameName[0];
    const snippet = use === 'ocr' ? { snippet: item !== undefined && fieldText(item.source_snippet) !== '' } : {};
    if (!item) return { name: row.name, found: false, value: false, valueText: false, unit: false, range: row.phases ? null : false, ...snippet };
    unmatched.splice(unmatched.indexOf(item), 1);
    return {
      name: row.name,
      found: true,
      value: near(item.value_numeric, expectedNumber(row.value)),
      valueText: valueTextMatches(item, row),
      unit: fieldText(item.unit) === (row.unit ?? ''),
      range: row.phases ? null : rangeMatches(item, row),
      ...snippet,
    };
  });
  const allowed = printedValues(printedTexts);
  const fabricated = rows.map(item => item.value_numeric as number).filter(value => !allowed.some(printed => near(value, printed)));
  const blocking = callBlocking(call);
  if (answeredWithContent && rows.length === 0) blocking.push('zero_rows');
  if (fabricated.length > 0) blocking.push('fabricated_value');
  const result: RowsCheck = {
    use, calls: [call], blocking, answered: call.status !== null && call.status < 500,
    rows: rows.length, expected: checks, extra: unmatched.length, fabricated,
  };
  if (use === 'ocr' && printedCycle) {
    const got = parsed.cycleMetadata ?? { cycle_day: null, cycle_phase: null };
    result.metadata = {
      got,
      printed: printedCycle,
      ok: answeredWithContent && got.cycle_day === printedCycle.cycle_day && got.cycle_phase === printedCycle.cycle_phase,
      inferred: (printedCycle.cycle_day === null && got.cycle_day !== null) || (printedCycle.cycle_phase === null && got.cycle_phase !== null),
    };
  }
  return result;
}

export type Verdict = 'BLOCKING' | 'INCOMPLETE' | 'ELIGIBLE' | 'SKIPPED';

export interface TargetVerdict {
  target: EvalTarget;
  verdict: Verdict;
  /** BLOCKING reason -> occurrences. */
  blocking: Record<string, number>;
  /** Calls that ended without a response after the handler's retries. */
  unanswered: number;
  metrics: TargetMetrics;
}

export interface TargetMetrics {
  cases: number;
  calls: number;
  responses: number;
  retries: number;
  latencyP50Ms: number | null;
  latencyP95Ms: number | null;
  reasoningMax: number | null;
  cap: number | null;
  estCostUsd: number;
  /** Use-specific counts, compact, no model text. */
  quality: string;
}

function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return Math.round(sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)]!);
}

const count = <T>(items: readonly T[], test: (item: T) => boolean): number => items.filter(test).length;

function quality(checks: readonly CaseCheck[]): string {
  const interp = checks.filter((c): c is InterpretationCheck => c.use === 'interpretation');
  const insights = checks.filter((c): c is InsightsCheck => c.use === 'labInsights');
  const rows = checks.filter((c): c is RowsCheck => c.use === 'extraction' || c.use === 'ocr');
  if (interp.length > 0) {
    const first = interp.map(c => c.attempts[0]).filter((a): a is InterpretationAttemptCheck => a !== undefined);
    return [
      `ai ${count(interp, c => c.source === 'ai')}/${interp.length}`,
      `schema-fail ${count(interp.flatMap(c => c.attempts), a => a.json && !a.schemaOk)}`,
      `policy-fail1 ${count(first, a => a.policyValid === false)}`,
      `retried ${count(interp, c => c.calls.length > 1)}`,
      `sanitize-null ${count(interp, c => c.attempts[1]?.sanitizedNull === true)}`,
      `floor ${count(interp, c => c.floorViolations.length > 0)}`,
      `served-policy ${count(interp, c => c.servedViolations.length > 0)}`,
    ].join(' ');
  }
  if (insights.length > 0) {
    return [
      `parsed ${count(insights, c => c.parsed)}/${insights.length}`,
      `violating-strings ${insights.reduce((n, c) => n + c.violatingStrings, 0)}`,
      `502 ${count(insights, c => !c.parsed || c.policyRefused)}`,
    ].join(' ');
  }
  const expected = rows.flatMap(c => c.expected);
  const found = expected.filter(r => r.found);
  const scored = found.filter(r => r.range !== null);
  const parts = [
    `rows ${found.length}/${expected.length}`,
    `value ${count(found, r => r.value)}/${found.length}`,
    `text ${count(found, r => r.valueText)}/${found.length}`,
    `unit ${count(found, r => r.unit)}/${found.length}`,
    `range ${count(scored, r => r.range === true)}/${scored.length}`,
    `extra ${rows.reduce((n, c) => n + c.extra, 0)}`,
    `fabricated ${rows.reduce((n, c) => n + c.fabricated.length, 0)}`,
  ];
  const ocr = rows.filter(c => c.metadata);
  if (ocr.length > 0) {
    parts.push(`snippet ${count(found, r => r.snippet === true)}/${found.length}`);
    parts.push(`metadata ${count(ocr, c => c.metadata!.ok)}/${ocr.length}`, `inferred ${count(ocr, c => c.metadata!.inferred)}`);
  }
  return parts.join(' ');
}

export function verdictFor(target: EvalTarget, checks: readonly CaseCheck[], skipped = false): TargetVerdict {
  const calls = checks.flatMap(c => c.calls);
  const attempts = calls.flatMap(c => c.attempts);
  const blocking: Record<string, number> = {};
  for (const reason of checks.flatMap(c => c.blocking)) blocking[reason] = (blocking[reason] ?? 0) + 1;
  const unanswered = count(calls, c => c.status === null || c.status >= 500);
  const reasoning = calls.map(c => c.usage.reasoningTokens).filter((n): n is number => n !== null);
  const metrics: TargetMetrics = {
    cases: checks.length,
    calls: calls.length,
    responses: count(calls, c => c.status === 200),
    retries: attempts.length - calls.length,
    latencyP50Ms: percentile(attempts.map(a => a.latencyMs), 50),
    latencyP95Ms: percentile(attempts.map(a => a.latencyMs), 95),
    reasoningMax: reasoning.length > 0 ? Math.max(...reasoning) : null,
    cap: calls.map(c => c.cap).find((n): n is number => n !== null) ?? null,
    estCostUsd: Math.round(calls.reduce((sum, c) => sum + c.estCostUsd, 0) * 1_000_000) / 1_000_000,
    quality: checks.length > 0 ? quality(checks) : '',
  };
  const verdict: Verdict = skipped ? 'SKIPPED'
    : Object.keys(blocking).length > 0 ? 'BLOCKING'
    : unanswered > 0 || checks.length === 0 ? 'INCOMPLETE'
    : 'ELIGIBLE';
  return { target, verdict, blocking, unanswered, metrics };
}
