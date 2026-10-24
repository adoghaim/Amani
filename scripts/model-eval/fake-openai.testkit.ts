/**
 * Offline fakes for the model eval's tests (RV-MM1): an OpenAI stand-in that
 * answers each use from the committed fixtures, and a renderer that encodes a
 * page's text into its "image" so the stand-in can read it back. Synthetic
 * only; nothing here touches the network.
 */
import { censoredResult } from '../../supabase/functions/_shared/censored-value';
import { isReasoningModel } from '../../supabase/functions/_shared/openai-models';
import { expectedNumber } from './checks';
import type { ExpectedRow, Fixtures, RenderMode } from './fixtures';
import { LAB_INSIGHTS_SYSTEM_MESSAGE } from './handlers';
import type { Renderer } from './render';

/** Present in every fake answer: proves answers reach the JSON and never stdout. */
export const ANSWER_MARKER = 'SYNTHETIC-ANSWER-MARKER-5d1c';

export type Use = 'ocr' | 'extraction' | 'interpretation' | 'labInsights';

/** The model rows a perfect answer gives for printed rows, in the extraction prompt's field names. */
export function perfectItems(rows: readonly ExpectedRow[]): Array<Record<string, unknown>> {
  return rows.map(row => {
    const interval = row.range ? /^(\d+(?:\.\d+)?)\s*[-–]\s*(\d+(?:\.\d+)?)$/.exec(row.range) : null;
    const limit = row.range && !interval ? censoredResult(row.range) : null;
    return {
      raw_name: row.name,
      canonical_slug: null,
      value_numeric: expectedNumber(row.value),
      value_text: row.value,
      unit: row.unit,
      raw_reference_range: row.range,
      normalized_reference_min: interval ? Number(interval[1]) : null,
      normalized_reference_max: interval ? Number(interval[2]) : null,
      reference_operator: limit ? limit.comparator : null,
      reference_operator_value: limit ? limit.threshold : null,
      confidence_score: 'high',
      source_snippet: `${row.name} ${row.value}`,
    };
  });
}

/** A clean interpretation answer (the smoke test's synthetic model body). */
export const cleanInterpretation = () => ({
  headline: `Synthetic model headline ${ANSWER_MARKER}`,
  primary_concern: { title: 'Vitamin D', summary: 'Synthetic summary', why_it_matters: 'Synthetic context' },
  key_findings: [], pattern_signals: [], what_you_can_do_now: [], what_to_do_next: [],
  overall_interpretation: 'The panel is mainly about iron markers.', questions_for_doctor: [],
  cycle_context: {}, disclaimer: 'Educational use only.',
});

/** A clean lab-insights answer (the policy suite's clean output). */
export const cleanInsights = () => ({
  summary: `Two markers moved since your last draw. ${ANSWER_MARKER}`,
  notable_changes: [{ biomarker: 'TSH', change: 'increased from 2.1 to 3.4 mIU/L', possible_factors: ['Sleep may have changed'] }],
  questions_to_ask: ['Should we retest in a few months?'],
  next_steps_general: ['Consider discussing the trend with your provider'],
});

export function completion(model: string, content: unknown, extra: { finish_reason?: string } = {}): Response {
  return new Response(JSON.stringify({
    id: 'chatcmpl-synthetic',
    model: `${model}-2026-01-01`,
    choices: [{ index: 0, message: { role: 'assistant', content: typeof content === 'string' ? content : JSON.stringify(content) },
      finish_reason: extra.finish_reason ?? 'stop' }],
    usage: { prompt_tokens: 1200, completion_tokens: 300, total_tokens: 1500,
      completion_tokens_details: { reasoning_tokens: isReasoningModel(model) ? 256 : 0 } },
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}

export function requestUse(body: Record<string, unknown>): Use {
  const messages = body.messages as Array<{ content: unknown }>;
  const system = String(messages[0]?.content ?? '');
  if (system.startsWith("You are Amani's clinical interpretation engine")) return 'interpretation';
  if (system === LAB_INSIGHTS_SYSTEM_MESSAGE) return 'labInsights';
  if (system.includes('from the provided lab report images')) return 'ocr';
  return 'extraction';
}

/** The fixture text a prompt or page carries: the one whose every row name it prints. */
function rowsIn(fixtures: Fixtures, text: string): ExpectedRow[] {
  const matches = fixtures.texts.filter(t => t.rows.every(row => text.includes(row.name)));
  if (matches.length !== 1) throw new Error(`fake OpenAI: ${matches.length} fixture texts match`);
  return matches[0]!.rows;
}

/** The page texts the fake renderer encoded into an OCR request's images. */
export function pagesOf(body: Record<string, unknown>): string[] {
  const messages = body.messages as Array<{ content: unknown }>;
  return (messages[1]!.content as Array<{ type: string; image_url?: { url: string } }>)
    .filter(part => part.type === 'image_url')
    .map(part => Buffer.from(part.image_url!.url.slice(part.image_url!.url.indexOf(',') + 1), 'base64').toString('utf8'));
}

/** What a model that reads every fixture perfectly answers. */
export function perfectContent(fixtures: Fixtures, body: Record<string, unknown>): unknown {
  const use = requestUse(body);
  if (use === 'interpretation') return cleanInterpretation();
  if (use === 'labInsights') return cleanInsights();
  if (use === 'ocr') {
    const pages = pagesOf(body);
    const day = /^Cycle Day (\d+)$/m.exec(pages.join('\n'))?.[1];
    return { items: pages.flatMap(page => perfectItems(rowsIn(fixtures, page))),
      metadata: { cycle_day: day ? Number(day) : null, cycle_phase: null } };
  }
  const user = String((body.messages as Array<{ content: unknown }>)[1]!.content);
  return { items: perfectItems(rowsIn(fixtures, user)) };
}

export interface FakeCall {
  url: string;
  authorization: string | null;
  body: Record<string, unknown>;
}

/** An OpenAI stand-in: `answer` may return a Response for a request, else the perfect answer is sent. */
export function fakeOpenAi(fixtures: Fixtures, answer?: (body: Record<string, unknown>, use: Use, n: number) => Response | null) {
  const calls: FakeCall[] = [];
  const transport = async (url: string, init: RequestInit): Promise<Response> => {
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    calls.push({ url, authorization: new Headers(init.headers).get('authorization'), body });
    return answer?.(body, requestUse(body), calls.length) ?? completion(String(body.model), perfectContent(fixtures, body));
  };
  return { transport, calls };
}

/** Encodes the page text as the image's bytes, so the stand-in can read it back. */
export function fakeRenderer(): Renderer & { rendered: Array<{ text: string; mode: RenderMode }> } {
  const rendered: Array<{ text: string; mode: RenderMode }> = [];
  return {
    rendered,
    async render(text, mode) {
      rendered.push({ text, mode });
      return `data:image/${mode === 'png' ? 'png' : 'jpeg'};base64,${Buffer.from(text, 'utf8').toString('base64')}`;
    },
    async close() {},
  };
}
