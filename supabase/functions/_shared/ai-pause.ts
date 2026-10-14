/**
 * The AI kill switch as the four AI functions apply it (PK-FIX-01b; owner
 * decisions R1, D5.1, D12; design decisions D7, DT9).
 *
 * The switch is `app_server_config.ai_kill_switch`, read through
 * runtime-config.ts (5-minute cache; a failed read keeps the last value; a
 * cold-start failure means AI ON). This module is what each function does
 * with the answer:
 *
 *   generate-interpretation  no model call; serves the existing
 *                            generateFallbackInterpretation through the same
 *                            path an OpenAI failure takes, and reports
 *                            `ai_paused: true`. No model output means
 *                            interpretationGenerated stays false, so
 *                            commitDeepAccess charges nothing (DT9).
 *   parse-lab-report-ocr     no model call; 200 with the calm paused body
 *                            below, which the client shows as a CalmNotice.
 *   extract-biomarkers       no model call; 200 with the paused body and no
 *                            items, so the local parse stands.
 *   lab-insights             no model call; 503 with the paused body.
 *
 * Pure: the read is the RuntimeConfigReader the function wires once per isolate.
 */

import type { RuntimeConfigReader } from "./runtime-config.ts";

export const AI_PAUSED_CODE = "ai_paused";

/** The calm line every paused response carries. No error branding, no blame, no detail. */
export const AI_PAUSED_MESSAGE = "Processing is paused right now. Please try again later.";

export interface AiPausedBody {
  paused: true;
  code: typeof AI_PAUSED_CODE;
  message: string;
}

export function aiPausedBody(): AiPausedBody {
  return { paused: true, code: AI_PAUSED_CODE, message: AI_PAUSED_MESSAGE };
}

/**
 * Whether the AI is paused right now. Never rejects: the reader absorbs read
 * failures under D5.1, and anything it might still throw counts as not paused
 * (AI ON), the same answer a cold-start failure gives.
 */
export async function isAiPaused(reader: Pick<RuntimeConfigReader, "isAiEnabled">): Promise<boolean> {
  // gstack-shortcut(dec-a6243129): server-only pause, upgrade when a production pause hits active users
  try {
    return !(await reader.isAiEnabled());
  } catch {
    return false;
  }
}

/**
 * Runs the model call only when it was wanted and the AI is not paused.
 * `result` is null whenever the model did not produce output, which is what
 * keeps a paused request from ever reaching a claim: the caller passes
 * `interpretationGenerated: result !== null` to commitDeepAccess (DT9).
 */
export async function callModelUnlessPaused<T>(input: {
  paused: boolean;
  wanted: boolean;
  call: () => Promise<T | null>;
}): Promise<{ result: T | null; modelCalled: boolean }> {
  if (input.paused || !input.wanted) return { result: null, modelCalled: false };
  return { result: await input.call(), modelCalled: true };
}
