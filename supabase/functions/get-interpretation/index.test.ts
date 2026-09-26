import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import { describe, expect, it, vi } from 'vitest';
import { enforceRateLimit, isRateLimitExceeded } from '../_shared/rate-limit';

// Run the actual Deno callback with injected transports, as the generation
// handler tests do; no npm:/jsr: imports or network required.
const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
const { code } = transformSync(source.slice(source.indexOf('const headers =')), { loader: 'ts', target: 'es2022' });
const request = () => new Request('https://example.invalid/get-interpretation', {
  method: 'POST', headers: { Authorization: 'Bearer test' },
  body: JSON.stringify({ reportId: '09100000-0000-4000-8000-000000000031' }),
});
function harness(options: { authThrows?: boolean; count?: number | null } = {}) {
  let handler!: (req: Request) => Promise<Response>;
  const read = vi.fn(async () => ({ status: 200, body: { access: 'basic' } }));
  const increment = vi.fn(async () => ({ data: options.count === undefined ? 1 : options.count, error: null }));
  const getUser = vi.fn(async () => {
    if (options.authThrows) throw new Error('transport unavailable');
    return { data: { user: { id: 'verified-user' } }, error: null };
  });
  const values = {
    Deno: { env: { get: () => 'test' }, serve: (fn: typeof handler) => { handler = fn; } },
    createClient: () => ({ auth: { getUser }, rpc: increment }),
    enforceRateLimit, isRateLimitExceeded,
    readInterpretation: read,
  };
  new Function(...Object.keys(values), code)(...Object.values(values));
  return { handler, read, increment };
}
describe('get-interpretation HTTP boundary', () => {
  it('returns a retryable CORS response when auth transport throws', async () => {
    const { handler, read, increment } = harness({ authThrows: true });
    const response = await handler(request());
    expect(response.status).toBe(503);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(await response.json()).toEqual({ access: 'error', code: 'entitlement_unavailable', retryable: true });
    expect(read).not.toHaveBeenCalled();
    expect(increment).not.toHaveBeenCalled();
  });
  it.each([30, 31])('uses the sibling atomic daily limit at count %s', async count => {
    const { handler, read, increment } = harness({ count });
    const response = await handler(request());
    expect(response.status).toBe(count === 30 ? 200 : 429);
    expect(increment).toHaveBeenCalledWith('increment_rate_limit', expect.objectContaining({ p_user_id: 'verified-user', p_endpoint: 'get-interpretation', p_window_start: expect.any(String) }));
    expect(read).toHaveBeenCalledTimes(count === 30 ? 1 : 0);
    if (count === 31) expect(await response.json()).toEqual({ code: 'rate_limit_exceeded' });
  });
  it('maps an unavailable rate counter to retryable 503 with CORS', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const { handler, read } = harness({ count: null });
      const response = await handler(request());
      expect(response.status).toBe(503);
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
      expect(await response.json()).toMatchObject({ code: 'entitlement_unavailable', retryable: true });
      expect(read).not.toHaveBeenCalled();
    } finally { log.mockRestore(); }
  });
});
