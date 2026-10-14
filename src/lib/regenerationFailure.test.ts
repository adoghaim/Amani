import { FunctionsFetchError, FunctionsHttpError, FunctionsRelayError } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import {
  LEGACY_HISTORY_PROTECTED, REGENERATION_COPY, REGENERATION_FAILED, REGENERATION_LIMIT_REACHED, REQUEST_ID_REQUIRED,
  classifyRegenerationFailure, regenerationFailureOf,
} from './regenerationFailure';
import { FREEMIUM_COPY } from './freemium/copy';

const httpError = (status: number, body: unknown) =>
  new FunctionsHttpError(new Response(body === undefined ? null : JSON.stringify(body), { status }));

describe('what a failed regeneration means', () => {
  it.each([
    [402, { error: 'subscription_required' }, 'premium_required'],
    [429, { error: 'Rate limit reached. Please try again tomorrow.' }, 'rate_limited'],
    [409, { error: 'legacy_history_protected' }, 'already_saved'],
    // A future name for the same refusal still reads as "nothing replaced".
    [409, { error: 'history_protected' }, 'already_saved'],
    [400, { error: 'request_id_required' }, 'unavailable'],
    // PK-REGEN-01: the server's limit refusal is calm, never a retry into the same refusal.
    [400, { error: 'regeneration_limit_reached' }, 'unavailable'],
    [503, { error: 'regeneration_failed', retryable: false }, 'unavailable'],
    [503, { error: 'regeneration_failed', retryable: true }, 'retryable'],
    [503, { code: 'entitlement_unavailable', retryable: true }, 'retryable'],
    [500, { error: 'Failed to save interpretation' }, 'retryable'],
    [500, { error: 'Internal server error' }, 'retryable'],
    [400, { error: 'Invalid request body' }, 'retryable'],
    [undefined, null, 'retryable'],
  ] as const)('%s %j → %s', (status, body, kind) => {
    expect(classifyRegenerationFailure(status, body)).toBe(kind);
  });

  it('names the server\'s codes (the executed-handler mapping is in regeneration-failure.handler.test.ts)', () => {
    expect([LEGACY_HISTORY_PROTECTED, REQUEST_ID_REQUIRED, REGENERATION_FAILED, REGENERATION_LIMIT_REACHED])
      .toEqual(['legacy_history_protected', 'request_id_required', 'regeneration_failed', 'regeneration_limit_reached']);
  });

  it('reads a supabase-js failure; a call with no answer is retryable', async () => {
    expect(await regenerationFailureOf(httpError(409, { error: 'legacy_history_protected' }))).toBe('already_saved');
    expect(await regenerationFailureOf(httpError(503, { error: 'regeneration_failed', retryable: false }))).toBe('unavailable');
    expect(await regenerationFailureOf(httpError(500, undefined))).toBe('retryable');
    expect(await regenerationFailureOf(new FunctionsFetchError(new Error('offline')))).toBe('retryable');
    expect(await regenerationFailureOf(new FunctionsRelayError(new Error('relay')))).toBe('retryable');
    expect(await regenerationFailureOf(new Error('thrown'))).toBe('retryable');
    expect(await regenerationFailureOf(null)).toBe('retryable');
  });

  it('leaves the body readable for the other readers, and copes when they read it first', async () => {
    const error = httpError(429, { error: 'Synthetic limit' });
    expect(await regenerationFailureOf(error)).toBe('rate_limited');
    expect(await (error.context as Response).json()).toEqual({ error: 'Synthetic limit' });
    const consumed = httpError(409, { error: 'legacy_history_protected' });
    await (consumed.context as Response).json();
    expect(await regenerationFailureOf(consumed)).toBe('already_saved');
  });
});

describe('what the notice says', () => {
  const all = Object.values(REGENERATION_COPY).flatMap(({ title, body }) => [title, body]);

  it('keeps the flag-on retryable wording, so both flag states say the same thing', () => {
    expect(REGENERATION_COPY.retryable).toEqual({
      title: FREEMIUM_COPY.report.regenerateErrorTitle, body: FREEMIUM_COPY.report.regenerateErrorBody });
  });

  it('every notice says the analysis on screen is intact', () => {
    expect(REGENERATION_COPY.retryable.body).toContain('unchanged');
    expect(REGENERATION_COPY.unavailable.body).toContain('unchanged');
    expect(REGENERATION_COPY.already_saved.body).toContain('Nothing was replaced');
  });

  it('is calm: no "error"/"failed" branding, no plan or trial wording, no clinical judgement', () => {
    for (const line of all) {
      expect(line).not.toMatch(/\berror\b|\bfail/i);
      expect(line).not.toMatch(/premium|free|trial|upgrade|subscri/i);
      // The page-wide clinical language guard's vocabulary (ReportView.language.test.tsx).
      expect(line).not.toMatch(/borderline|optimal|\bnormal\b|abnormal|worsen|improv|better|worse|healthy|reassur|concern|urgent|should|recommend|\brisk\b/i);
    }
  });
});
