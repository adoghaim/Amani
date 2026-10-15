// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  isAiPausedError,
  isAiPausedResponse,
  noteAiPaused,
  OCR_PAUSED_SAFE,
  OCR_PAUSED_TITLE,
  readAiPaused,
  REPORT_PAUSED_SAFE,
  REPORT_PAUSED_TITLE,
  subscribeAiPaused,
} from './aiPause';
import { OcrPausedNotice } from '../components/OcrPausedNotice';
import { AiPausedNotice } from '../features/report/notices/AiPausedNotice';
import { ReportNotices } from '../features/report/notices/ReportNotices';
import { axeViolations } from '../components/axe.testkit';
import type { LabReport } from '../types';

/*
  PK-FIX-01b (D12, D7, DT9): the app's side of the AI pause. The server
  reports it; the app shows a calm notice, never an error.
*/

let root: Root;
let app: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  sessionStorage.clear();
  app = document.createElement('div');
  document.body.append(app);
  root = createRoot(app);
});
afterEach(async () => {
  await act(async () => root.unmount());
  app.remove();
  vi.unstubAllGlobals();
});

// Rose, error and danger classes: Alert's, never the calm notice's.
const ALARM = /flag-low|flag-watch|danger|rose|red-|error/;
const status = () => app.querySelector<HTMLElement>('[role="status"]');
const lines = () => Array.from(status()?.querySelectorAll('p') ?? []).map(p => p.textContent);

describe('isAiPausedResponse', () => {
  it('recognises every paused answer the four functions give', () => {
    // parse-lab-report-ocr and extract-biomarkers (200)
    expect(isAiPausedResponse({ paused: true, code: 'ai_paused', message: 'x', items: [] })).toBe(true);
    // generate-interpretation (200, the basic explanation plus the flag)
    expect(isAiPausedResponse({ success: true, source: 'deterministic', ai_paused: true })).toBe(true);
    // lab-insights and a refused regeneration (503 body)
    expect(isAiPausedResponse({ code: 'ai_paused' })).toBe(true);
  });

  it('is false for every ordinary answer', () => {
    for (const body of [null, undefined, 'ai_paused', {}, { items: [] }, { success: true, source: 'ai' }, { paused: 'true' }, { ai_paused: 1 }]) {
      expect(isAiPausedResponse(body), JSON.stringify(body)).toBe(false);
    }
  });
});

describe('isAiPausedError', () => {
  const httpError = (status: number, body: unknown) =>
    new FunctionsHttpError(new Response(JSON.stringify(body), { status }));

  it('reads a 503 paused body without consuming it', async () => {
    const err = httpError(503, { error: 'regeneration_failed', retryable: true, ai_paused: true });
    expect(await isAiPausedError(err)).toBe(true);
    // The body is still readable by the next handler.
    expect(await (err.context as Response).json()).toMatchObject({ ai_paused: true });
  });

  it('is false for other failures and for non-HTTP errors', async () => {
    expect(await isAiPausedError(httpError(503, { error: 'regeneration_failed', retryable: true }))).toBe(false);
    expect(await isAiPausedError(httpError(429, { error: 'Rate limit reached.' }))).toBe(false);
    expect(await isAiPausedError(new FunctionsHttpError(new Response('not json', { status: 500 })))).toBe(false);
    expect(await isAiPausedError(new Error('network'))).toBe(false);
  });
});

describe('noteAiPaused / readAiPaused / subscribeAiPaused', () => {
  it('remembers the pause per report and tells an open report screen', () => {
    const seen: boolean[] = [];
    const unsubscribe = subscribeAiPaused('r1', paused => seen.push(paused));
    noteAiPaused('r1', true);
    noteAiPaused('r2', true);
    expect(readAiPaused('r1')).toBe(true);
    expect(readAiPaused('r2')).toBe(true);
    expect(readAiPaused('r3')).toBe(false);
    noteAiPaused('r1', false);
    expect(readAiPaused('r1')).toBe(false);
    expect(seen).toEqual([true, false]);
    unsubscribe();
    noteAiPaused('r1', true);
    expect(seen).toEqual([true, false]);
  });

  it('degrades to no notice when storage is unavailable', () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied'); });
    expect(() => noteAiPaused('r1', true)).not.toThrow();
    expect(readAiPaused('r1')).toBe(false);
    getItem.mockRestore();
    setItem.mockRestore();
  });
});

describe('the OCR paused message (upload screen)', () => {
  it('is a calm notice: what happened, what is safe, announced politely, no error branding, no axe violation', async () => {
    await act(async () => root.render(<OcrPausedNotice />));
    expect(status()!.getAttribute('aria-live')).toBe('polite');
    expect(lines()).toEqual([OCR_PAUSED_TITLE, OCR_PAUSED_SAFE]);
    expect(OCR_PAUSED_TITLE).toBe('Processing is paused right now. Please try again later.');
    expect(app.innerHTML).not.toMatch(ALARM);
    expect(app.querySelector('svg.lucide-alert-triangle, svg.lucide-triangle-alert')).toBeNull();
    expect(await axeViolations(app)).toEqual([]);
  });
});

describe('the report pause notice (DT9, notices slot)', () => {
  const report = { id: 'report-1' } as unknown as LabReport;
  const shown = { id: 'v1', generatedAt: '2026-10-13T00:00:00.000Z' };

  it('shows in the notices slot when the server reported a pause', async () => {
    await act(async () => root.render(<ReportNotices report={report} versions={{ shown, aiPaused: true }} />));
    expect(lines()).toEqual([REPORT_PAUSED_TITLE, REPORT_PAUSED_SAFE]);
    expect(status()!.getAttribute('aria-live')).toBe('polite');
    expect(app.innerHTML).not.toMatch(ALARM);
    expect(await axeViolations(app)).toEqual([]);
  });

  it('shows nothing when no pause was reported, or while no explanation is shown', async () => {
    await act(async () => root.render(<AiPausedNotice report={report} versions={{ shown }} />));
    expect(app.innerHTML).toBe('');
    await act(async () => root.render(<AiPausedNotice report={report} versions={{ shown, aiPaused: false }} />));
    expect(app.innerHTML).toBe('');
    await act(async () => root.render(<AiPausedNotice report={report} versions={{ shown: null, aiPaused: true }} />));
    expect(app.innerHTML).toBe('');
  });
});
