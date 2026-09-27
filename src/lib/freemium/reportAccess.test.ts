import { describe, expect, it, vi } from 'vitest';
import { accessRequestKey, applyAccessResult, createAccessRequester, freemiumCanRegenerate, generateFailureKind } from './reportAccess';
import { accessError, parseInterpretationAccess, type InterpretationAccessResult } from './interpretationAccess';

const body = (access: 'basic' | 'full', stored_depth: string | null = 'deep') =>
  parseInterpretationAccess({ access, interpretation: { headline: access }, stored_depth });
const deferred = () => {
  let resolve!: (result: InterpretationAccessResult) => void;
  const promise = new Promise<InterpretationAccessResult>(r => { resolve = r; });
  return { promise, resolve };
};

describe('ReportView access policy', () => {
  const input = { freemium: true, reportId: 'report', status: 'ready', nonce: 0 };
  it('does not read while off, missing identity/status, or processing', () => {
    for (const change of [{ freemium: false }, { reportId: undefined }, { status: undefined }, { status: 'processing' }]) {
      expect(accessRequestKey({ ...input, ...change })).toBeNull();
    }
  });
  it('keeps render/status identity stable and changes on refresh or navigation', () => {
    expect(accessRequestKey({ ...input })).toBe('report:0');
    expect(accessRequestKey({ ...input, status: 'error' })).toBe(accessRequestKey(input));
    expect(accessRequestKey({ ...input, nonce: 1 })).toBe('report:1');
    expect(accessRequestKey({ ...input, reportId: 'other' })).toBe('other:0');
  });
  it('deduplicates concurrent renders and StrictMode effect replay, including after resolution', async () => {
    const pending = deferred();
    const fetch = vi.fn(() => pending.promise);
    const requester = createAccessRequester(fetch);
    const onResult = vi.fn();
    expect(requester.request(null, 'report', onResult)).toBe(false);
    expect(requester.request('report:0', 'report', onResult)).toBe(true);
    expect(requester.request('report:0', 'report', onResult)).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith('report');
    pending.resolve(body('full'));
    await pending.promise;
    expect(onResult).toHaveBeenCalledTimes(1);
    expect(onResult).toHaveBeenCalledWith(body('full'));
    expect(requester.request('report:0', 'report', onResult)).toBe(false);
  });
  it.each(['report:1', 'other:0'])('drops superseded responses after refresh/navigation to %s', async key => {
    const old = deferred(); const fresh = deferred();
    const fetch = vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
    const requester = createAccessRequester(fetch); const onResult = vi.fn();
    requester.request('report:0', 'report', onResult);
    requester.request(key, key.slice(0, key.indexOf(':')), onResult);
    fresh.resolve(body('basic')); await fresh.promise;
    old.resolve(body('full')); await old.promise;
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(onResult).toHaveBeenCalledTimes(1);
    expect(onResult).toHaveBeenCalledWith(body('basic'));
  });
  it.each(['A first', 'B first'])('reuses pending A during A→B→A and delivers A exactly once (%s)', async order => {
    const a = deferred(); const b = deferred();
    const fetch = vi.fn().mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
    const requester = createAccessRequester(fetch);
    const originalA = vi.fn(); const resultB = vi.fn(); const activeA = vi.fn();
    expect(requester.request('A:0', 'A', originalA)).toBe(true);
    expect(requester.request('B:0', 'B', resultB)).toBe(true);
    expect(requester.request('A:0', 'A', activeA)).toBe(false);
    expect(requester.request('A:0', 'A', activeA)).toBe(false);
    expect(fetch.mock.calls).toEqual([['A'], ['B']]);
    if (order === 'B first') { b.resolve(body('basic')); await b.promise; }
    a.resolve(body('full')); await a.promise;
    if (order === 'A first') { b.resolve(body('basic')); await b.promise; }
    expect(originalA).not.toHaveBeenCalled();
    expect(resultB).not.toHaveBeenCalled();
    expect(activeA).toHaveBeenCalledTimes(1);
    expect(activeA).toHaveBeenCalledWith(body('full'));
    expect(requester.request('A:0', 'A', activeA)).toBe(false);
  });
  it.each(['basic', 'full'] as const)('keeps a prior %s body on an error', access => {
    const current = body(access); const error = accessError('network_error');
    expect(applyAccessResult(current, error)).toEqual({ state: current, inlineError: error });
    expect(applyAccessResult(null, error)).toEqual({ state: error, inlineError: null });
    expect(applyAccessResult(accessError('old'), error)).toEqual({ state: error, inlineError: null });
  });
  it.each(['basic', 'full'] as const)('%s replaces the old body and clears the inline error', access => {
    const next = body(access);
    expect(applyAccessResult(body(access === 'basic' ? 'full' : 'basic'), next))
      .toEqual({ state: next, inlineError: null });
  });
  it('regenerates based on stored depth or generation_needed, within the three-attempt cap', () => {
    for (const access of ['full', 'basic'] as const) {
      for (const depth of ['standard', 'unknown', null]) expect(freemiumCanRegenerate(body(access, depth), 0)).toBe(true);
      expect(freemiumCanRegenerate(body(access), 0)).toBe(false);
      expect(freemiumCanRegenerate(body(access, 'standard'), 3)).toBe(false);
    }
    const needed = parseInterpretationAccess({ access: 'generation_needed', stored_depth: 'deep' });
    expect(freemiumCanRegenerate(needed, 2)).toBe(true);
    expect(freemiumCanRegenerate(needed, 3)).toBe(false);
    expect(freemiumCanRegenerate(null, 0)).toBe(false);
    expect(freemiumCanRegenerate(accessError('failure'), 0)).toBe(false);
  });
  it.each([[402, 'premium_required'], [429, 'rate_limited'], [500, 'failed'], [400, 'failed'], [undefined, 'failed']] as const)('classifies generate status %s as %s', (status, expected) => expect(generateFailureKind(status)).toBe(expected));
});

it('clears a rejected key, delivers nothing, and re-fetches on retry', async () => {
  const fetch = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(body('full'));
  const requester = createAccessRequester(fetch);
  const onResult = vi.fn();
  expect(requester.request('A:0', 'A', onResult)).toBe(true);
  await Promise.resolve();
  expect(onResult).not.toHaveBeenCalled();
  expect(requester.request('A:0', 'A', onResult)).toBe(true);
  await Promise.resolve();
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(onResult).toHaveBeenCalledTimes(1);
  expect(onResult).toHaveBeenCalledWith(body('full'));
});

it('a stale rejection does not invalidate the newer active key', async () => {
  let reject!: (reason: Error) => void;
  const stale = new Promise<InterpretationAccessResult>((_, r) => { reject = r; });
  const fetch = vi.fn().mockReturnValueOnce(stale).mockResolvedValue(body('basic'));
  const requester = createAccessRequester(fetch);
  const onResult = vi.fn();
  requester.request('A:0', 'A', onResult);
  requester.request('B:0', 'B', onResult);
  reject(new Error('offline'));
  await Promise.resolve();
  expect(requester.request('B:0', 'B', onResult)).toBe(false);
  expect(requester.request('A:0', 'A', onResult)).toBe(true);
  await Promise.resolve();
  expect(fetch).toHaveBeenCalledTimes(3);
});
