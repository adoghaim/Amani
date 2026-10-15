import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { AI_FUNCTION_NAMES } from './ai-cost-ledger.ts';

/*
  PK-FIX-01b: the four AI functions are Deno handlers Vitest cannot import, so
  this reads their source and pins the wiring the pure modules rely on:
    - each records every model call to ai_call_costs through the ledger port,
      under its own function name;
    - each reads the kill switch through the shared runtime-config port and
      does not call the model while it is on;
    - each reports unexpected errors through the PHI-scrubbing reporter,
      without awaiting it (a report never blocks the response);
    - nobody hand-rolls a Sentry call or a second config read.
  The behaviour behind each port is proved in its own suite (ai-pause, ai-cost-ledger,
  error-reporter, phi-scrub, runtime-config).
*/

const source = (fn: string) => readFileSync(new URL(`../${fn}/index.ts`, import.meta.url), 'utf8');
const OPENAI = 'https://api.openai.com/v1/chat/completions';

describe.each(AI_FUNCTION_NAMES.map(fn => [fn]))('%s', fn => {
  const text = source(fn);

  it('wires the ledger, the reporter and the kill switch from the shared Deno wiring', () => {
    expect(text).toContain('from "../_shared/edge-ai-guards.ts"');
    expect(text).toContain(`edgeAiCostLedger("${fn}")`);
    expect(text).toContain(`edgeErrorReporter("${fn}")`);
    expect(text).toMatch(/aiPausedNow\(\)/);
  });

  it('records its model calls under its own function name, in the background', () => {
    const records = [...text.matchAll(/costLedger\.record\(\{\s*functionName: "([^"]+)"/g)].map(m => m[1]);
    expect(records.length).toBeGreaterThanOrEqual(1);
    for (const name of records) expect(name).toBe(fn);
    expect(text).toMatch(/inBackground\(costLedger\.record\(/);
  });

  it('reports errors without awaiting the report', () => {
    expect(text).toMatch(/inBackground\(reporter\.captureException\(/);
    expect(text).not.toMatch(/await\s+reporter\./);
  });

  it('never talks to Sentry or reads app_server_config directly', () => {
    expect(text).not.toMatch(/sentry\.io|@sentry\//i);
    expect(text).not.toContain('app_server_config');
  });

  it('decides the pause before any model call', () => {
    const pause = text.indexOf('aiPausedNow()');
    const call = text.indexOf(OPENAI);
    expect(pause).toBeGreaterThan(-1);
    expect(call).toBeGreaterThan(-1);
    if (fn === 'generate-interpretation') {
      // The model call lives in tryOpenAI; the handler decides the pause and
      // passes it in, and produceInterpretation skips the call through
      // callModelUnlessPaused.
      expect(text).toMatch(/const killSwitchOn = await aiPausedNow\(\);\s*const \{ shaped, aiInterpretation[^}]*\} = await produceInterpretation\(\{[\s\S]*?aiPaused: killSwitchOn,/);
      // The app is told only when the pause changed the answer.
      expect(text).toContain('const pauseApplied = input.aiPaused && wantsModel;');
      expect(text).toContain('aiPaused = pauseApplied;');
      expect(text).toMatch(/callModelUnlessPaused\(\{\s*paused: input\.aiPaused,/);
      expect(text).toMatch(/interpretationGenerated: aiInterpretation !== null/);
    } else {
      expect(pause).toBeLessThan(call);
      expect(text).toMatch(/if \(await aiPausedNow\(\)\) \{\s*(?:return new Response\(|\/\/)/);
      // Before the rate limit, so a paused attempt spends no quota.
      expect(pause).toBeLessThan(text.indexOf('await enforceRateLimit('));
    }
  });
});

describe('the paused answers', () => {
  it('OCR answers 200 with the calm paused body and no items', () => {
    expect(source('parse-lab-report-ocr')).toMatch(
      /if \(await aiPausedNow\(\)\) \{[\s\S]{0,400}\.\.\.aiPausedBody\(\), items: \[\][\s\S]{0,200}status: 200/,
    );
  });

  it('extract-biomarkers answers 200 with no items, so the local parse stands', () => {
    expect(source('extract-biomarkers')).toMatch(/if \(await aiPausedNow\(\)\) \{[\s\S]{0,400}\.\.\.aiPausedBody\(\), items: \[\][\s\S]{0,200}status: 200/);
  });

  it('lab-insights answers 503 with the paused body', () => {
    expect(source('lab-insights')).toMatch(/if \(await aiPausedNow\(\)\) \{[\s\S]{0,300}aiPausedBody\(\)[\s\S]{0,100}status: 503/);
  });

  it('generate-interpretation reports the pause on its answers', () => {
    const text = source('generate-interpretation');
    expect(text).toContain('const pausedFlag = () => (aiPaused ? { ai_paused: true } : {});');
    expect((text.match(/\.\.\.pausedFlag\(\)/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });
});
