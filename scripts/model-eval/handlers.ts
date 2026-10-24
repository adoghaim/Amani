/**
 * The production code the model eval runs (RV-MM1 AC9). The four AI handlers
 * are Deno files Node cannot import, so each one's own prompt, request and
 * answer-parsing code is read from its source and evaluated with an injected
 * scope, the way supabase/functions/_shared/generation-pipeline.smoke.test.ts
 * runs generate-interpretation. Interpretation runs end to end through the
 * real produceInterpretation -> tryOpenAI -> callOpenAIOnce; the other three
 * take their messages from the handler and their limits, JSON mode, store
 * and timeout from HANDLER_LIMITS, which handlers.test.ts pins to the source
 * (with every fragment marker below), so a handler change turns that offline
 * test red instead of the eval drifting from what production sends.
 */
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import { z } from 'zod';
import * as outcome from '../../supabase/functions/_shared/generation-outcome';
import * as placement from '../../supabase/functions/_shared/lab-placement';
import * as shaping from '../../supabase/functions/_shared/response-shaping';
import * as authority from '../../supabase/functions/_shared/claim-authority';
import * as nutrients from '../../supabase/functions/_shared/nutrient-policy';
import { buildBasicProjection } from '../../supabase/functions/_shared/interpretation-visibility';
import { callModelUnlessPaused } from '../../supabase/functions/_shared/ai-pause';
import {
  buildTrendEvidence, compareStoredBiomarkers, formatTrendEvidencePrompt, isSignificantChange, topChanges,
} from '../../supabase/functions/_shared/trend-evidence';
import { redactLabText } from '../../supabase/functions/_shared/lab-text-redaction';
import { generationSample, type GenerationSample } from '../../supabase/functions/_shared/generation-cost';
import { censoredPlaceholder } from '../../supabase/functions/_shared/censored-value';
import {
  labInsightsPolicyPrompt, MAX_PROMPT_INTERVENTIONS, promptInterventionLabel,
} from '../../supabase/functions/_shared/lab-insights-policy';
import {
  chatCompletionParams, reasoningEffortParams, resolveOpenAiModel, type OpenAiModelUse,
} from '../../supabase/functions/_shared/openai-models';
import { panelAnalyte, panelReport, type InterpretationPanel } from './fixtures';
import { OPENAI_CHAT_COMPLETIONS } from './guard';

export type GetEnv = (name: string) => string | undefined;

export type FetchWithBackoff = (
  url: string,
  init: RequestInit,
  options?: { tries?: number; initialDelayMs?: number; attemptTimeoutMs?: number },
) => Promise<Response>;

/** What the evaluated handler code logs into; the eval keeps it out of stdout. */
export interface HandlerConsole {
  log(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
  info(...args: unknown[]): void;
  debug(...args: unknown[]): void;
}

export const HANDLERS = {
  ocr: 'parse-lab-report-ocr',
  extraction: 'extract-biomarkers',
  interpretation: 'generate-interpretation',
  labInsights: 'lab-insights',
} as const satisfies Record<OpenAiModelUse, string>;

/** Each handler's request numbers, exactly as its source passes them (pinned by handlers.test.ts). */
export const HANDLER_LIMITS: Readonly<Record<OpenAiModelUse, {
  maxOutputTokens: number; temperature: number; attemptTimeoutMs: number;
}>> = {
  ocr: { maxOutputTokens: 4000, temperature: 0.1, attemptTimeoutMs: 30000 },
  extraction: { maxOutputTokens: 4000, temperature: 0.1, attemptTimeoutMs: 25000 },
  interpretation: { maxOutputTokens: 2200, temperature: 0.25, attemptTimeoutMs: 18000 },
  labInsights: { maxOutputTokens: 3000, temperature: 0.7, attemptTimeoutMs: 18000 },
};

/** lab-insights' system message, copied from its request body (pinned). */
export const LAB_INSIGHTS_SYSTEM_MESSAGE =
  'You are a health education assistant. Provide educational insights only. Never diagnose or prescribe treatment.';

/** Start and end markers of every evaluated fragment (each pinned to occur once, in order). */
export const MARKERS = {
  interpretationModel: ['function classifyAnalyte(', '// ─── Context sanitization'],
  interpretationTrend: ['function trendEvidenceFor(', '/** Model call, shaping'],
  interpretationPipeline: ['async function produceInterpretation(', '// ─── Version store'],
  extractionMessages: [
    '    const systemPrompt = `You are a medical lab data extraction specialist. Extract EVERY lab test result from the report',
    '    const model = resolveOpenAiModel("extraction"',
  ],
  extractionRequest: ['    const model = resolveOpenAiModel("extraction"', '    if (!openaiResponse.ok) {'],
  extractionParse: ['    let rawItems: RawExtractedItem[];', '    const reportAnalytes: ReportAnalyte[] = rawItems'],
  ocrMessages: [
    '    const systemPrompt = `You are a medical lab data extraction specialist. Extract EVERY lab test result from the provided lab report images.',
    '    const model = resolveOpenAiModel("ocr"',
  ],
  ocrRequest: ['    const model = resolveOpenAiModel("ocr"', '    if (!openaiResponse.ok) {'],
  ocrParse: ['    let rawItems: RawExtractedItem[];', '    const reportAnalytes: ReportAnalyte[] = rawItems'],
  insightsPrompt: ['    const biomarkerChangesAll', '    const model = resolveOpenAiModel("labInsights"'],
  insightsRequest: ['    const model = resolveOpenAiModel("labInsights"', '    if (!openaiResponse.ok) {'],
} as const satisfies Record<string, readonly [string, string]>;

export type MarkerName = keyof typeof MARKERS;

/** The handler each fragment is cut from. */
export const MARKER_HANDLER: Readonly<Record<MarkerName, OpenAiModelUse>> = {
  interpretationModel: 'interpretation',
  interpretationTrend: 'interpretation',
  interpretationPipeline: 'interpretation',
  extractionMessages: 'extraction',
  extractionRequest: 'extraction',
  extractionParse: 'extraction',
  ocrMessages: 'ocr',
  ocrRequest: 'ocr',
  ocrParse: 'ocr',
  insightsPrompt: 'labInsights',
  insightsRequest: 'labInsights',
};

const FUNCTIONS = new URL('../../supabase/functions/', import.meta.url);
const files = new Map<string, string>();

/** A file under supabase/functions/, read once. */
export function functionsFile(path: string): string {
  let text = files.get(path);
  if (text === undefined) {
    text = readFileSync(new URL(path, FUNCTIONS), 'utf8');
    files.set(path, text);
  }
  return text;
}

export function handlerSource(use: OpenAiModelUse): string {
  return functionsFile(`${HANDLERS[use]}/index.ts`);
}

/** The source between a marker pair. Throws when either marker is missing. */
export function fragment(source: string, [start, end]: readonly [string, string]): string {
  const a = source.indexOf(start);
  const b = a < 0 ? -1 : source.indexOf(end, a + start.length);
  if (a < 0 || b < 0) throw new Error(`model eval: fragment marker not found: ${JSON.stringify(a < 0 ? start : end)}`);
  return source.slice(a, b);
}

export function markerFragment(name: MarkerName): string {
  return fragment(handlerSource(MARKER_HANDLER[name]), MARKERS[name]);
}

/** Transpile TypeScript statements and run them with `scope` as their only free names. */
export function evaluate(code: string, scope: Record<string, unknown>): unknown {
  const js = transformSync(code, { loader: 'ts', target: 'es2022' }).code;
  return new Function(...Object.keys(scope), js)(...Object.values(scope));
}

export interface ParseSchema {
  safeParse(value: unknown): { success: boolean; data?: unknown };
}

let interpretationSchemaValue: ParseSchema | null = null;

/** _shared/schemas/interpretation.ts, loaded as the smoke test loads it: its npm:zod import stripped, z injected. */
export function interpretationSchema(): ParseSchema {
  interpretationSchemaValue ??= evaluate(
    functionsFile('_shared/schemas/interpretation.ts').replace(/^import[^\n]+\n/, '')
      .replace('export const ', 'const ').replace('export type ', 'type ') + '\nreturn InterpretationSchema;',
    { z },
  ) as ParseSchema;
  return interpretationSchemaValue;
}

let contextSchemaValue: ParseSchema | null = null;

/** The report-context schema generate-interpretation sanitizes `lab_reports.context` with. */
export function sanitizeReportContext(raw: unknown): unknown {
  contextSchemaValue ??= evaluate(
    functionsFile('_shared/schemas/context.ts').replace(/^import[^\n]+\n/, '').replace(/^export /gm, '')
      + '\nreturn LabReportContextSchema;',
    { z },
  ) as ParseSchema;
  const result = contextSchemaValue.safeParse(raw);
  return result.success ? result.data : undefined;
}

/** _shared/fetchWithBackoff.ts itself, sending through `fetchImpl` instead of the global fetch. */
export function realFetchWithBackoff(fetchImpl: (input: unknown, init?: RequestInit) => Promise<Response>): FetchWithBackoff {
  return evaluate(
    functionsFile('_shared/fetchWithBackoff.ts').replace(/^export /gm, '') + '\nreturn fetchWithBackoff;',
    { fetch: fetchImpl },
  ) as FetchWithBackoff;
}

export interface ChatRequest {
  url: string;
  init: { method: 'POST'; headers: Record<string, string>; body: string };
  options: { attemptTimeoutMs: number };
}

/**
 * The request extract-biomarkers, parse-lab-report-ocr or lab-insights sends
 * for these messages: the model its secret selects, the limits that model
 * accepts, JSON mode, store: false, the effort secret, and its timeout.
 */
export function chatRequest(use: OpenAiModelUse, getEnv: GetEnv, messages: unknown[], apiKey: string): ChatRequest {
  const model = resolveOpenAiModel(use, getEnv);
  const { maxOutputTokens, temperature, attemptTimeoutMs } = HANDLER_LIMITS[use];
  return {
    url: OPENAI_CHAT_COMPLETIONS,
    init: {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages,
        ...chatCompletionParams(model, { maxOutputTokens, temperature }),
        response_format: { type: 'json_object' },
        store: false,
        ...reasoningEffortParams(use, model, getEnv),
      }),
    },
    options: { attemptTimeoutMs },
  };
}

/** extract-biomarkers' system and user messages for a report text, after its redaction step. */
export function extractionMessages(text: string): unknown[] {
  const labText = redactLabText(text).text;
  const { systemPrompt, userPrompt } = evaluate(
    markerFragment('extractionMessages') + '\nreturn { systemPrompt, userPrompt };', { labText },
  ) as { systemPrompt: string; userPrompt: string };
  return [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }];
}

/** parse-lab-report-ocr's messages for images that already passed ocrImagesRefusal. */
export function ocrMessages(base64Images: readonly string[]): unknown[] {
  const { systemPrompt, userMessagesContent } = evaluate(
    markerFragment('ocrMessages') + '\nreturn { systemPrompt, userMessagesContent };', { base64Images },
  ) as { systemPrompt: string; userMessagesContent: unknown[] };
  return [{ role: 'system', content: systemPrompt }, { role: 'user', content: userMessagesContent }];
}

export interface StoredBiomarkerRow {
  name: string;
  value: number;
  unit: string;
  raw_value_text: string | null;
}

export interface InsightsReport {
  report_date: string;
  estimated_cycle_phase: string | null;
  estimated_cycle_day: number | null;
}

export interface InsightsInput {
  currentReport: InsightsReport;
  previousReport: InsightsReport;
  current: readonly StoredBiomarkerRow[];
  previous: readonly StoredBiomarkerRow[];
  interventions: ReadonlyArray<{ title: string; category: string; start_date: string; end_date: string | null }>;
}

interface InterventionsQuery {
  select(...args: unknown[]): InterventionsQuery;
  lte(...args: unknown[]): InterventionsQuery;
  or(...args: unknown[]): Promise<{ data: unknown[] }>;
}

/** lab-insights' prompt for two reports' stored rows, with an in-memory client for its interventions read. */
export async function insightsPrompt(input: InsightsInput): Promise<string> {
  const query: InterventionsQuery = { select: () => query, lte: () => query, or: async () => ({ data: [...input.interventions] }) };
  const supabaseAuth = {
    from(table: string) {
      if (table !== 'interventions') throw new Error(`model eval: lab-insights read an unexpected table ${table}`);
      return query;
    },
  };
  return await (evaluate(`return (async () => {\n${markerFragment('insightsPrompt')}\nreturn prompt;\n})();`, {
    currentReport: input.currentReport, previousReport: input.previousReport,
    currentBiomarkers: input.current, previousBiomarkers: input.previous, supabaseAuth,
    compareStoredBiomarkers, isSignificantChange, topChanges, MAX_PROMPT_INTERVENTIONS, promptInterventionLabel,
    labInsightsPolicyPrompt,
  }) as Promise<string>);
}

/** lab-insights' system and user messages: its prompt after its redaction step. */
export async function insightsMessages(input: InsightsInput): Promise<unknown[]> {
  return [
    { role: 'system', content: LAB_INSIGHTS_SYSTEM_MESSAGE },
    { role: 'user', content: redactLabText(await insightsPrompt(input)).text },
  ];
}

export type RawItem = Record<string, unknown>;

/** extract-biomarkers' own parse of the answer content: accepted shapes and its censored-value placeholder. */
export function parseExtractionContent(content: unknown): RawItem[] {
  return evaluate(markerFragment('extractionParse') + '\nreturn rawItems;', { content, censoredPlaceholder }) as RawItem[];
}

/** parse-lab-report-ocr's own parse: accepted shapes, its cycle-metadata validation and comparator fix-up. */
export function parseOcrContent(content: unknown): {
  rawItems: RawItem[]; cycleMetadata: { cycle_day: number | null; cycle_phase: string | null };
} {
  return evaluate(markerFragment('ocrParse') + '\nreturn { rawItems, cycleMetadata };', { content }) as {
    rawItems: RawItem[]; cycleMetadata: { cycle_day: number | null; cycle_phase: string | null };
  };
}

/** The handlers' next step keeps only rows with a numeric value (pinned). */
export function numericRows(rawItems: readonly RawItem[]): RawItem[] {
  return rawItems.filter(item => typeof item.value_numeric === 'number' && !isNaN(item.value_numeric));
}

export interface ProducedInterpretation {
  shaped: { source: string; tier: string; depth: string; payload: Record<string, unknown> };
  aiInterpretation: Record<string, unknown> | null;
  interpretationJson: Record<string, unknown>;
  basicProjection: Record<string, unknown>;
  floorViolations: unknown[];
  fallbackReason: string | null;
  modelFailure: string | null;
}

export interface InterpretationApi {
  buildPrimaryContext(analytes: unknown[], prior: unknown[], priorDate: string | null, pinned: string | null): Record<string, unknown> | null;
  trendEvidenceFor(ctx: Record<string, unknown>): unknown[];
  produceInterpretation(input: Record<string, unknown>): Promise<ProducedInterpretation>;
}

/**
 * produceInterpretation's input for a panel, built as generate-interpretation
 * builds it once its rows are fetched: the report context through the handler's
 * schema, its buildPrimaryContext, isOptimizationOnly (pinned by
 * handlers.test.ts), its trendEvidenceFor, then deep generation with the
 * activated policy and no profile block, as the smoke test runs it.
 */
export function interpretationInput(
  api: InterpretationApi,
  panel: InterpretationPanel,
  openaiApiKey: string,
  recordCost: (sample: GenerationSample) => void,
): Record<string, unknown> {
  const analytes = panel.analytes.map(panelAnalyte);
  const prior = panel.prior.map(panelAnalyte);
  const report = panelReport(panel);
  report.context = sanitizeReportContext(report.context);
  const primaryContext = api.buildPrimaryContext(analytes, prior, panel.priorDate, panel.pinned);
  const isOptimizationOnly = !!(panel.pinned && primaryContext && primaryContext.current_status === 'in_range');
  const ctx = { report, userContextBlock: null, analytes, priorAnalytes: prior, priorReportDate: panel.priorDate, primaryContext, isOptimizationOnly };
  return {
    ctx, reportId: String(report.id), trendEvidence: api.trendEvidenceFor(ctx), tier: 'free', generateDeep: true,
    policyActive: true, openaiApiKey, aiPaused: false, recordCost,
  };
}

/** generate-interpretation's own model, trend and pipeline code, with the eval's fetch, secrets and console. */
export function interpretationApi(scope: { fetchWithBackoff: FetchWithBackoff; getEnv: GetEnv; console: HandlerConsole }): InterpretationApi {
  return evaluate(
    markerFragment('interpretationModel') + markerFragment('interpretationTrend') + markerFragment('interpretationPipeline')
      + '\nreturn { buildPrimaryContext, trendEvidenceFor, produceInterpretation };',
    {
      ...outcome, ...placement, ...shaping, ...authority, ...nutrients, InterpretationSchema: interpretationSchema(),
      fetchWithBackoff: scope.fetchWithBackoff, redactLabText, formatTrendEvidencePrompt, buildBasicProjection,
      callModelUnlessPaused, buildTrendEvidence, generationSample,
      resolveOpenAiModel, chatCompletionParams, reasoningEffortParams,
      Deno: { env: { get: scope.getEnv } }, console: scope.console,
    },
  ) as InterpretationApi;
}
