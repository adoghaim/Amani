import { describe, expect, it, vi } from 'vitest';
import {
  basicInterpretationText,
  fetchInterpretationAccess,
  parseInterpretationAccess,
  previewText,
  type InvokeFn,
} from './interpretationAccess';

const complimentary = { used: 1, total: 3, remaining: 2 };
const locked = { patterns: 2, cross_report: 1, lifestyle: 0 };

/** Shaped like supabase-js's FunctionsHttpError: the Response is on `context`. */
function httpError(status: number, body: unknown) {
  return { name: 'FunctionsHttpError', context: new Response(JSON.stringify(body), { status }) };
}

describe('parseInterpretationAccess', () => {
  it('full: keeps the body, drops any upsell material', () => {
    const result = parseInterpretationAccess({
      access: 'full', interpretation: { headline: 'H' }, preview: { kind: 'trend', content: 'x' },
      locked, plan: 'free', complimentary, stored_depth: 'deep',
    });
    expect(result).toMatchObject({ access: 'full', interpretation: { headline: 'H' }, preview: null,
      locked: { patterns: 0, cross_report: 0, lifestyle: 0 }, plan: 'free', complimentary });
  });

  it('basic: keeps the preview and locked counts', () => {
    const result = parseInterpretationAccess({
      access: 'basic', interpretation: { headline: 'H', basic_interpretation: 'B' },
      preview: { kind: 'cross_marker', content: { title: 'T', explanation: 'E' }, source_path: '/x' },
      locked, plan: 'free', complimentary, stored_depth: 'standard',
    });
    expect(result.access).toBe('basic');
    expect(result.preview).toEqual({ kind: 'cross_marker', content: { title: 'T', explanation: 'E' } });
    expect(result.locked).toEqual(locked);
  });

  it('generation_needed may arrive with or without a body', () => {
    expect(parseInterpretationAccess({ access: 'generation_needed', interpretation: null, plan: 'free' }))
      .toMatchObject({ access: 'generation_needed', interpretation: null });
    expect(parseInterpretationAccess({ access: 'generation_needed', interpretation: { headline: 'H' }, plan: 'premium' }))
      .toMatchObject({ access: 'generation_needed', interpretation: { headline: 'H' } });
  });

  it('error keeps the server code and retryable flag', () => {
    expect(parseInterpretationAccess({ access: 'error', code: 'entitlement_unavailable', retryable: true }))
      .toMatchObject({ access: 'error', code: 'entitlement_unavailable', retryable: true, interpretation: null });
  });

  it.each([
    ['null', null],
    ['unknown access', { access: 'plus', interpretation: { headline: 'H' } }],
    ['basic without a body', { access: 'basic', interpretation: null }],
    ['full with a non-object body', { access: 'full', interpretation: 'text' }],
  ])('fails closed to error, never to Basic: %s', (_name, raw) => {
    const result = parseInterpretationAccess(raw);
    expect(result.access).toBe('error');
    expect(result.interpretation).toBeNull();
    expect(result.preview).toBeNull();
  });

  it('ignores malformed locked counts and complimentary figures', () => {
    const result = parseInterpretationAccess({ access: 'basic', interpretation: {},
      locked: { patterns: -2, cross_report: '3', lifestyle: 1.5 }, complimentary: { used: 'x' } });
    expect(result.locked).toEqual({ patterns: 0, cross_report: 0, lifestyle: 0 });
    expect(result.complimentary).toBeNull();
  });
});

describe('fetchInterpretationAccess', () => {
  it('makes exactly one get-interpretation call with the report id', async () => {
    const invoke = vi.fn<InvokeFn>(async () => ({ data: { access: 'full', interpretation: { headline: 'H' } }, error: null }));
    const result = await fetchInterpretationAccess(invoke, 'r1');
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith('get-interpretation', { body: { reportId: 'r1' } });
    expect(result.access).toBe('full');
  });

  it('503 entitlement_unavailable is a retryable error', async () => {
    const invoke: InvokeFn = async () => ({ data: null,
      error: httpError(503, { access: 'error', code: 'entitlement_unavailable', retryable: true }) });
    expect(await fetchInterpretationAccess(invoke, 'r1'))
      .toMatchObject({ access: 'error', code: 'entitlement_unavailable', retryable: true });
  });

  it('429 is a non-retryable rate-limit error, not a paywall', async () => {
    const invoke: InvokeFn = async () => ({ data: null, error: httpError(429, { code: 'rate_limit_exceeded' }) });
    expect(await fetchInterpretationAccess(invoke, 'r1'))
      .toMatchObject({ access: 'error', code: 'rate_limit_exceeded', retryable: false });
  });

  it('404 without an access body keeps its code', async () => {
    const invoke: InvokeFn = async () => ({ data: null, error: httpError(404, { code: 'report_not_found' }) });
    expect(await fetchInterpretationAccess(invoke, 'r1')).toMatchObject({ access: 'error', code: 'report_not_found' });
  });

  it('network failures and thrown invokes become retryable errors', async () => {
    expect(await fetchInterpretationAccess(async () => ({ data: null, error: new Error('offline') }), 'r1'))
      .toMatchObject({ access: 'error', code: 'network_error', retryable: true });
    expect(await fetchInterpretationAccess(async () => { throw new Error('boom'); }, 'r1'))
      .toMatchObject({ access: 'error', code: 'network_error', retryable: true });
  });
});

describe('render helpers', () => {
  it('shows the Basic interpretation only when it adds to the headline', () => {
    expect(basicInterpretationText({ headline: 'Same', basic_interpretation: 'Same' })).toBeNull();
    expect(basicInterpretationText({ headline: 'H', basic_interpretation: 'More' })).toBe('More');
    expect(basicInterpretationText(null)).toBeNull();
  });

  it('reads previews from string or object content', () => {
    expect(previewText({ kind: 'lifestyle', content: ' Walk daily ' })).toEqual({ title: null, body: 'Walk daily' });
    expect(previewText({ kind: 'cross_marker', content: { title: 'T', explanation: 'E' } })).toEqual({ title: 'T', body: 'E' });
    expect(previewText({ kind: 'cross_marker', content: { title: 'Only title' } })).toEqual({ title: null, body: 'Only title' });
    expect(previewText({ kind: 'trend', content: { value: 3 } })).toBeNull();
  });
});

describe('PK-PL-A: the server\'s regeneration availability', () => {
  const stored = { access: 'basic', interpretation: { headline: 'H' }, stored_depth: 'standard', plan: 'free' };

  it('reads the server\'s answer', () => {
    expect(parseInterpretationAccess({ ...stored, regeneration: { available: false, reason: 'introductory_access_exhausted' } })
      .regeneration).toEqual({ available: false, reason: 'introductory_access_exhausted' });
    expect(parseInterpretationAccess({ ...stored, regeneration: { available: true, reason: null } })
      .regeneration).toEqual({ available: true, reason: null });
  });

  it('no answer, or a malformed one, is null: the stored-state rule decides alone, as before', () => {
    expect(parseInterpretationAccess(stored).regeneration).toBeNull();
    for (const regeneration of [null, 'unavailable', { available: 'false' }, { reason: 'x' }, []]) {
      expect(parseInterpretationAccess({ ...stored, regeneration }).regeneration).toBeNull();
    }
    expect(parseInterpretationAccess({ access: 'error', code: 'entitlement_unavailable', regeneration: { available: false } })
      .regeneration).toBeNull();
  });
});
