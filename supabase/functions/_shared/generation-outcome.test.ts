import { describe, expect, it } from 'vitest';
import {
  fallbackDiagnostics, fallbackReasonOf, FALLBACK_REASONS, httpModelFailure, refusalDiagnostics,
  regenerationRefusalReason, thrownModelFailure,
} from './generation-outcome.ts';
import { callModelUnlessPaused } from './ai-pause.ts';
import { shapeInterpretation, shouldRequestDeepInterpretation } from './response-shaping.ts';
import { regenerationAvailability } from './regeneration-availability.ts';

/*
  2026-10-17 production smoke: a first generation answered "200, source
  fallback" and its regeneration "503 regeneration_failed", and every cause
  answers those same bodies. These tests pin one stable code per cause, and
  prove the decision is produceInterpretation's own steps
  (shouldRequestDeepInterpretation, callModelUnlessPaused, shapeInterpretation)
  rather than a copy that could drift from them.
*/

const HEALTHY = {
  deepGeneration: true, hasReport: true, hasAnalytes: true, hasApiKey: true, aiPaused: false, modelProduced: true,
};

describe('fallbackReasonOf: one stable code per cause', () => {
  it('is null for the model\'s own deep work', () => {
    expect(fallbackReasonOf(HEALTHY)).toBeNull();
  });

  it.each([
    ['introductory_access_exhausted', { deepGeneration: false }],
    ['report_unavailable', { hasReport: false }],
    ['no_analytes', { hasAnalytes: false }],
    ['ai_not_configured', { hasApiKey: false }],
    ['ai_paused', { aiPaused: true }],
    ['model_failed', { modelProduced: false }],
  ] as const)('%s', (reason, fault) => {
    expect(fallbackReasonOf({ ...HEALTHY, ...fault })).toBe(reason);
  });

  it('names the pause only when the pause is what changed the answer, as ai_paused does', () => {
    expect(fallbackReasonOf({ ...HEALTHY, aiPaused: true, hasAnalytes: false })).toBe('no_analytes');
    expect(fallbackReasonOf({ ...HEALTHY, aiPaused: true, hasApiKey: false })).toBe('ai_not_configured');
    expect(fallbackReasonOf({ ...HEALTHY, aiPaused: true, deepGeneration: false })).toBe('introductory_access_exhausted');
  });

  it('agrees with the pipeline it describes, on every combination of facts', async () => {
    const bools = [true, false];
    const reached = new Set<string | null>();
    for (const deepGeneration of bools) for (const hasReport of bools) for (const hasAnalytes of bools)
      for (const hasApiKey of bools) for (const aiPaused of bools) for (const modelAnswers of bools) {
        const label = JSON.stringify({ deepGeneration, hasReport, hasAnalytes, hasApiKey, aiPaused, modelAnswers });
        // produceInterpretation, step by step.
        const wanted = shouldRequestDeepInterpretation(deepGeneration, hasApiKey, hasAnalytes) && hasReport;
        const { result, modelCalled } = await callModelUnlessPaused({
          paused: aiPaused, wanted, call: async () => (modelAnswers ? { headline: 'synthetic' } : null),
        });
        const shaped = shapeInterpretation({
          tier: 'plus', deepAccessGranted: deepGeneration, aiInterpretation: result,
          deterministicInterpretation: () => ({ headline: 'deterministic' }),
        });
        const pauseApplied = aiPaused && wanted;
        const reason = fallbackReasonOf({
          deepGeneration, hasReport, hasAnalytes, hasApiKey, aiPaused, modelProduced: result !== null,
        });
        reached.add(reason);
        expect(reason === null, label).toBe(shaped.source === 'ai');
        expect(reason === 'ai_paused', label).toBe(pauseApplied);
        if (reason === 'model_failed') expect(modelCalled, label).toBe(true);
        else expect(modelCalled && result === null, label).toBe(false);
      }
    // Non-vacuous: every code and the model's own work are reached.
    expect(reached).toEqual(new Set([null, ...FALLBACK_REASONS]));
  });

  it('uses get-interpretation\'s token for the one refusal it can predict', () => {
    // A Free viewer whose introductory access is used up, with post-limit generation on demand.
    expect(regenerationAvailability({ premium: false, hasClaim: false, claimsUsed: 3, postLimitGeneration: 'on_demand' }))
      .toEqual({ available: false, reason: 'introductory_access_exhausted' });
    expect(fallbackReasonOf({ ...HEALTHY, deepGeneration: false })).toBe('introductory_access_exhausted');
  });

  it('every code is a short fixed token', () => {
    for (const reason of [...FALLBACK_REASONS, 'floor_violation', 'introductory_limit_reached']) {
      expect(reason).toMatch(/^[a-z_]{1,40}$/);
    }
  });
});

describe('model failure codes', () => {
  it('an HTTP answer keeps only its status', () => {
    expect(httpModelFailure(401)).toBe('http_401');
    expect(httpModelFailure(404)).toBe('http_404');
    expect(httpModelFailure(429)).toBe('http_429');
    expect(httpModelFailure(0)).toBe('network_error');
    expect(httpModelFailure(Number.NaN)).toBe('network_error');
  });

  it('a timed-out attempt, and anything else thrown before an answer', () => {
    expect(thrownModelFailure(Object.assign(new Error('aborted'), { name: 'AbortError' }))).toBe('timeout');
    expect(thrownModelFailure(new DOMException('The operation was aborted.', 'AbortError'))).toBe('timeout');
    expect(thrownModelFailure(Object.assign(new Error('timed out'), { name: 'TimeoutError' }))).toBe('timeout');
    expect(thrownModelFailure(new TypeError('fetch failed'))).toBe('network_error');
    expect(thrownModelFailure('not an error')).toBe('network_error');
    expect(thrownModelFailure(null)).toBe('network_error');
  });
});

describe('response fields', () => {
  it('the model\'s deep work carries none', () => {
    expect(fallbackDiagnostics(null, null)).toEqual({});
    expect(fallbackDiagnostics(null, 'timeout')).toEqual({});
  });

  it('a fallback carries its reason, and model_failure only for a failed model call', () => {
    expect(fallbackDiagnostics('ai_paused', null)).toEqual({ fallback_reason: 'ai_paused' });
    expect(fallbackDiagnostics('model_failed', 'timeout')).toEqual({ fallback_reason: 'model_failed', model_failure: 'timeout' });
    expect(fallbackDiagnostics('model_failed', null)).toEqual({ fallback_reason: 'model_failed' });
    expect(fallbackDiagnostics('no_analytes', 'timeout')).toEqual({ fallback_reason: 'no_analytes' });
  });

  it('a refused regeneration is the fallback\'s reason, else the floor', () => {
    expect(regenerationRefusalReason('model_failed')).toBe('model_failed');
    expect(regenerationRefusalReason(null)).toBe('floor_violation');
    expect(refusalDiagnostics('model_failed', 'http_429')).toEqual({ reason: 'model_failed', model_failure: 'http_429' });
    expect(refusalDiagnostics('floor_violation', 'http_429')).toEqual({ reason: 'floor_violation' });
    expect(refusalDiagnostics('introductory_limit_reached', null)).toEqual({ reason: 'introductory_limit_reached' });
  });
});
