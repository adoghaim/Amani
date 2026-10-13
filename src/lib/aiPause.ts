import { FunctionsHttpError } from '@supabase/supabase-js';

/*
  The AI pause as the app sees it (PK-FIX-01b; owner decision D12, design
  decisions D7 and DT9).

  The pause is server-only (D12): there is no public flag, so the app learns of
  it only from a function's answer.
    - parse-lab-report-ocr and extract-biomarkers answer 200 with
      { paused: true, code: 'ai_paused', message, items: [] };
    - generate-interpretation answers as usual, with the basic explanation, plus
      ai_paused: true (also on a 503 regeneration refusal);
    - lab-insights answers 503 with { code: 'ai_paused' }.
  Every one of them is shown as a CalmNotice, never as an error.

  The upload screen fires generate-interpretation and moves on to the report
  before the answer lands, so it notes the pause per report in sessionStorage,
  the same way it notes a rate limit, and the report screen reads it back.
*/

export const AI_PAUSED_CODE = 'ai_paused';

/** The OCR pause notice (upload screen). */
export const OCR_PAUSED_TITLE = 'Processing is paused right now. Please try again later.';
export const OCR_PAUSED_SAFE = 'Your existing reports are unchanged. You can still enter these results by hand.';

/** The report notice: the explanation shown is the basic one because the AI is paused. */
export const REPORT_PAUSED_TITLE = 'Detailed analysis is paused right now. Please try again later.';
export const REPORT_PAUSED_SAFE = 'Your reports and results are saved. The explanation below is the basic one.';

/** True when a function's JSON answer reports the AI pause. */
export function isAiPausedResponse(body: unknown): boolean {
  if (typeof body !== 'object' || body === null) return false;
  const b = body as Record<string, unknown>;
  return b.paused === true || b.ai_paused === true || b.code === AI_PAUSED_CODE;
}

/** True when a failed invoke's body reports the AI pause (a 503 from lab-insights or a regeneration). */
export async function isAiPausedError(err: unknown): Promise<boolean> {
  if (!(err instanceof FunctionsHttpError)) return false;
  const response = err.context as Response | undefined;
  if (!response || typeof response.clone !== 'function') return false;
  try {
    return isAiPausedResponse(await response.clone().json());
  } catch {
    return false;
  }
}

const key = (reportId: string) => `aiPaused:${reportId}`;
const EVENT = 'amani:ai-paused';

/**
 * Remember, for this tab, whether the last generation for this report reported
 * the pause, and tell an open report screen (the answer can land after the
 * upload screen has already moved on to it).
 */
export function noteAiPaused(reportId: string, paused: boolean): void {
  try {
    if (paused) sessionStorage.setItem(key(reportId), '1');
    else sessionStorage.removeItem(key(reportId));
  } catch {
    // Storage unavailable (private mode): the notice degrades to the event below.
  }
  try {
    window.dispatchEvent(new CustomEvent(EVENT, { detail: { reportId, paused } }));
  } catch {
    // No window (tests without a DOM): nothing is listening.
  }
}

/** Calls `onChange` whenever noteAiPaused is called for this report. Returns the unsubscribe. */
export function subscribeAiPaused(reportId: string, onChange: (paused: boolean) => void): () => void {
  const listener = (event: Event) => {
    const detail = (event as CustomEvent<{ reportId?: unknown; paused?: unknown }>).detail;
    if (detail?.reportId === reportId) onChange(detail.paused === true);
  };
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}

export function readAiPaused(reportId: string): boolean {
  try {
    return sessionStorage.getItem(key(reportId)) === '1';
  } catch {
    return false;
  }
}
