import { describe, expect, it, vi } from 'vitest';
import {
  ANON_ID_KEY,
  FIRST_TOUCH_KEY,
  FIRST_TOUCH_TTL_MS,
  PENDING_CODE_KEY,
  PENDING_CODE_TTL_MS,
  PENDING_SIGNUP_KEY,
  createFirstPartyEvents,
  goKey,
  landingPath,
  parseAttribution,
  type FirstPartyEventsDeps,
} from './firstPartyEvents';

/*
  PK-EXP5 client capture (item 11): first touch, expiry, malformed parameters,
  storage that throws, an RPC that is missing (the backend is not deployed
  until the owner's GO), and the flag off. Everything runs on injected fakes.
*/

const T0 = Date.parse('2026-10-13T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => { map.set(k, v); },
    removeItem: (k: string) => { map.delete(k); },
  };
}

function setup(opts: { flag?: boolean; storage?: FirstPartyEventsDeps['storage']; rpcError?: unknown; rpcRejects?: boolean;
  anonRejects?: boolean } = {}) {
  const store = memoryStorage();
  let now = T0;
  const rpc = vi.fn(async (_name: string, _args: Record<string, unknown>, _timeout: number) => {
    if (opts.rpcRejects) throw new Error('AbortError');
    return { error: opts.rpcError ?? null };
  });
  const invokeAnon = vi.fn(async (_body: Record<string, unknown>, _timeout: number) => {
    if (opts.anonRejects) throw new Error('FunctionsFetchError');
    return { data: { ok: true } };
  });
  let ids = 0;
  const deps: FirstPartyEventsDeps = {
    flagEnabled: async () => opts.flag ?? true,
    flagEnabledNow: () => opts.flag ?? true,
    storage: opts.storage ?? (() => store),
    rpc,
    invokeAnon,
    now: () => now,
    randomId: () => `deviceid${String(++ids).padStart(24, '0')}`,
    baseProps: () => ({ platform: 'web', app_version: '1.0.4' }),
  };
  return { events: createFirstPartyEvents(deps), store, rpc, invokeAnon, advance: (ms: number) => { now += ms; } };
}

const stored = (store: ReturnType<typeof memoryStorage>, key: string) => {
  const raw = store.map.get(key);
  return raw ? JSON.parse(raw) : null;
};

describe('URL parsing (D5.3: attacker-controlled strings)', () => {
  it('keeps utm_*, promo and ref that match [A-Za-z0-9._-]{1,64}', () => {
    expect(parseAttribution('?utm_source=tiktok&utm_medium=paid.social&utm_campaign=spring_25&utm_content=v-2&utm_term=x&promo=SPRING25&ref=dr.jane'))
      .toEqual({ utm_source: 'tiktok', utm_medium: 'paid.social', utm_campaign: 'spring_25', utm_content: 'v-2', utm_term: 'x',
        promo: 'SPRING25', ref: 'dr.jane' });
  });

  it('drops malformed, oversized and unknown parameters instead of storing them', () => {
    expect(parseAttribution(`?utm_source=${'x'.repeat(65)}&utm_medium=a%20b&utm_campaign=%3Cscript%3E&promo=&ref=caf%C3%A9&gclid=abc&fbclid=def`))
      .toEqual({});
    expect(parseAttribution('?utm_source=ignore+previous+instructions')).toEqual({});
  });

  it('reads a campaign key from /go/<key> only when it is a valid code', () => {
    expect(goKey('/go/creator.jane')).toBe('creator.jane');
    expect(goKey('/go/SPRING25/')).toBe('SPRING25');
    expect(goKey('/go/a%20b')).toBeNull();
    expect(goKey('/go/%E0%A4%A')).toBeNull();
    expect(goKey('/go/a/b')).toBeNull();
    expect(goKey('/signup')).toBeNull();
  });

  it('keeps a landing path only when it is a plain path', () => {
    expect(landingPath('/')).toBe('/');
    expect(landingPath('/go/spring')).toBe('/go/spring');
    expect(landingPath('/a b')).toBeNull();
    expect(landingPath('/' + 'a'.repeat(300))).toBeNull();
  });
});

describe('first touch', () => {
  it('captures utm_*, promo, ref and the landing path, and sends landing_view on "/"', async () => {
    const { events, store, invokeAnon } = setup();
    await events.captureEntry({ pathname: '/', search: '?utm_source=tiktok&utm_campaign=spring&promo=SPRING25' });
    expect(stored(store, FIRST_TOUCH_KEY)).toEqual({
      params: { utm_source: 'tiktok', utm_campaign: 'spring', promo: 'SPRING25' }, landingPath: '/', at: T0 });
    expect(invokeAnon).toHaveBeenCalledOnce();
    const [body, timeout] = invokeAnon.mock.calls[0]!;
    expect(body).toEqual({ event: 'landing_view', anon_id: 'deviceid000000000000000000000001',
      props: { platform: 'web', app_version: '1.0.4', utm_source: 'tiktok', utm_campaign: 'spring', promo: 'SPRING25' } });
    expect(timeout).toBe(3000);
  });

  it('is FIRST touch: a later campaign does not overwrite it within 90 days', async () => {
    const { events, store, advance } = setup();
    await events.captureEntry({ pathname: '/', search: '?utm_source=tiktok' });
    advance(10 * DAY);
    await events.captureEntry({ pathname: '/', search: '?utm_source=instagram' });
    expect(stored(store, FIRST_TOUCH_KEY).params).toEqual({ utm_source: 'tiktok' });
    expect(events.readFirstTouch()?.params).toEqual({ utm_source: 'tiktok' });
  });

  it('expires after 90 days, and the next campaign becomes the first touch', async () => {
    const { events, store, advance } = setup();
    await events.captureEntry({ pathname: '/', search: '?utm_source=tiktok' });
    advance(FIRST_TOUCH_TTL_MS);
    expect(events.readFirstTouch()).toBeNull();
    expect(store.map.has(FIRST_TOUCH_KEY)).toBe(false);
    await events.captureEntry({ pathname: '/', search: '?utm_source=instagram' });
    expect(events.readFirstTouch()?.params).toEqual({ utm_source: 'instagram' });
  });

  it('a visit with no campaign parameters stores nothing', async () => {
    const { events, store } = setup();
    await events.captureEntry({ pathname: '/', search: '?utm_source=bad%20value' });
    expect(store.map.has(FIRST_TOUCH_KEY)).toBe(false);
  });

  it('ignores a tampered or malformed stored first touch', () => {
    const { events, store } = setup();
    store.map.set(FIRST_TOUCH_KEY, '{not json');
    expect(events.readFirstTouch()).toBeNull();
    store.map.set(FIRST_TOUCH_KEY, JSON.stringify({ params: { utm_source: 'a b', ref: 'ok', evil: 'x' }, landingPath: '/x y', at: T0 }));
    expect(events.readFirstTouch()).toEqual({ params: { ref: 'ok' }, landingPath: null, at: T0 });
    store.map.set(FIRST_TOUCH_KEY, JSON.stringify({ params: {}, at: T0 + DAY }));
    expect(events.readFirstTouch()).toBeNull();
  });

  it('counts one arrival once per launch, however often it is captured (StrictMode remounts)', async () => {
    const { events, invokeAnon } = setup();
    await Promise.all([
      events.captureEntry({ pathname: '/', search: '?utm_source=tiktok' }),
      events.captureEntry({ pathname: '/', search: '?utm_source=tiktok' }),
    ]);
    await events.captureEntry({ pathname: '/', search: '?utm_source=tiktok' });
    expect(invokeAnon).toHaveBeenCalledOnce();
  });

  it('only "/" sends landing_view', async () => {
    const { events, invokeAnon } = setup();
    await events.captureEntry({ pathname: '/pricing', search: '?utm_source=tiktok' });
    await events.captureEntry({ pathname: '/signup', search: '' });
    expect(invokeAnon).not.toHaveBeenCalled();
  });

  it('a campaign link /go/<key> becomes the first-touch ref and pre-fills the signup code', async () => {
    const { events } = setup();
    await events.captureEntry({ pathname: '/go/creator.jane', search: '?utm_source=youtube' });
    expect(events.readFirstTouch()).toEqual({ params: { utm_source: 'youtube', ref: 'creator.jane' }, landingPath: '/go/creator.jane', at: T0 });
    expect(events.pendingCode()).toBe('creator.jane');
  });

  it('promo= wins over ref= for the pre-fill, and a code already held is not replaced', async () => {
    const { events } = setup();
    await events.captureEntry({ pathname: '/', search: '?promo=SPRING25&ref=dr.jane' });
    expect(events.pendingCode()).toBe('SPRING25');
    await events.captureEntry({ pathname: '/', search: '?promo=OTHER' });
    expect(events.pendingCode()).toBe('SPRING25');
  });
});

describe('the held code (D17: 24 hours, through the OAuth redirect)', () => {
  it('holds a valid code and forgets it after 24 hours', () => {
    const { events, store, advance } = setup();
    expect(events.setPendingCode('SPRING25')).toBe(true);
    expect(stored(store, PENDING_CODE_KEY)).toEqual({ code: 'SPRING25', at: T0 });
    advance(PENDING_CODE_TTL_MS - 1);
    expect(events.pendingCode()).toBe('SPRING25');
    advance(1);
    expect(events.pendingCode()).toBeNull();
    expect(store.map.has(PENDING_CODE_KEY)).toBe(false);
  });

  it('refuses an invalid code and clears on empty', () => {
    const { events, store } = setup();
    expect(events.setPendingCode('bad code')).toBe(false);
    expect(events.setPendingCode('x'.repeat(65))).toBe(false);
    expect(store.map.has(PENDING_CODE_KEY)).toBe(false);
    events.setPendingCode('OK');
    events.setPendingCode('');
    expect(events.pendingCode()).toBeNull();
  });
});

describe('signup completion: attribution once, then signup_completed', () => {
  async function startedSignup(opts: Parameters<typeof setup>[0] = {}) {
    const s = setup(opts);
    await s.events.captureEntry({ pathname: '/', search: '?utm_source=tiktok&ref=dr.jane' });
    s.events.setPendingCode('SPRING25');
    s.events.markSignupStarted();
    return s;
  }

  it('markSignupStarted holds the signup and sends signup_started before signup', async () => {
    const { store, invokeAnon } = await startedSignup();
    expect(stored(store, PENDING_SIGNUP_KEY)).toEqual({ at: T0 });
    await vi.waitFor(() => expect(invokeAnon).toHaveBeenCalledTimes(2));
    expect(invokeAnon.mock.calls[1]![0]).toMatchObject({ event: 'signup_started', props: { utm_source: 'tiktok', ref: 'dr.jane' } });
  });

  it('saves first touch, the typed code and the landing path, then logs signup_completed', async () => {
    const { events, rpc, store } = await startedSignup();
    expect(await events.completeSignup({ id: 'u1', created_at: new Date(T0).toISOString() })).toBe(true);
    expect(rpc.mock.calls.map(c => c[0])).toEqual(['save_signup_attribution', 'log_app_event']);
    expect(rpc.mock.calls[0]![1]).toEqual({ p_attribution: { utm_source: 'tiktok', ref: 'dr.jane', code: 'SPRING25', landing_path: '/' } });
    expect(rpc.mock.calls[1]![1]).toEqual({ p_event: 'signup_completed', p_props: { platform: 'web', app_version: '1.0.4' } });
    expect(rpc.mock.calls.every(c => c[2] === 3000)).toBe(true);
    // The code was written, so it is no longer held; the marker is gone.
    expect(store.map.has(PENDING_CODE_KEY)).toBe(false);
    expect(store.map.has(PENDING_SIGNUP_KEY)).toBe(false);
  });

  it('runs once: a second SIGNED_IN does nothing', async () => {
    const { events, rpc } = await startedSignup();
    await events.completeSignup({ id: 'u1' });
    rpc.mockClear();
    expect(await events.completeSignup({ id: 'u1' })).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('a login with no signup started here, or an old account, is not a signup', async () => {
    const plain = setup();
    expect(await plain.events.completeSignup({ id: 'u1' })).toBe(false);
    expect(plain.rpc).not.toHaveBeenCalled();
    const old = await startedSignup();
    expect(await old.events.completeSignup({ id: 'u1', created_at: new Date(T0 - 30 * DAY).toISOString() })).toBe(false);
    expect(old.rpc).not.toHaveBeenCalled();
  });

  it('a signup started more than 24 hours ago is forgotten', async () => {
    const { events, rpc, advance } = await startedSignup();
    advance(DAY);
    expect(await events.completeSignup({ id: 'u1' })).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('RPC missing (not deployed): the error is swallowed, the code stays held, and nothing throws', async () => {
    const { events, rpc, store } = await startedSignup({ rpcError: { code: 'PGRST202', message: 'Could not find the function' } });
    await expect(events.completeSignup({ id: 'u1' })).resolves.toBe(true);
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(store.map.has(PENDING_CODE_KEY)).toBe(true);
  });

  it('an RPC that rejects or times out is swallowed too', async () => {
    const { events } = await startedSignup({ rpcRejects: true });
    await expect(events.completeSignup({ id: 'u1' })).resolves.toBe(true);
    await expect(events.track('report_viewed')).resolves.toBeUndefined();
  });
});

describe('track: signed-in events', () => {
  it('sends an allow-listed client event with the base props', async () => {
    const { events, rpc } = setup();
    await events.track('report_viewed', { report_index: 2 });
    expect(rpc).toHaveBeenCalledWith('log_app_event',
      { p_event: 'report_viewed', p_props: { platform: 'web', app_version: '1.0.4', report_index: 2 } }, 3000);
  });

  it('never sends a server event or bad props from the client', async () => {
    const { events, rpc } = setup();
    await events.track('subscription_activated' as never);
    await events.track('report_viewed', { tier: 'free text!' });
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe('the flag off (D6.2): nothing stored, nothing sent', () => {
  it('captureEntry, markSignupStarted, completeSignup, track and trackAnon are all no-ops', async () => {
    const { events, store, rpc, invokeAnon } = setup({ flag: false });
    store.map.set(PENDING_SIGNUP_KEY, JSON.stringify({ at: T0 }));
    await events.captureEntry({ pathname: '/go/creator', search: '?utm_source=tiktok&promo=SPRING25' });
    events.markSignupStarted();
    expect(await events.completeSignup({ id: 'u1' })).toBe(false);
    await events.track('report_viewed');
    await events.trackAnon('landing_view');
    expect(rpc).not.toHaveBeenCalled();
    expect(invokeAnon).not.toHaveBeenCalled();
    expect([...store.map.keys()]).toEqual([PENDING_SIGNUP_KEY]);
  });
});

describe('storage that throws or is missing (private mode, blocked site data)', () => {
  const throwing = () => ({
    getItem: () => { throw new Error('SecurityError'); },
    setItem: () => { throw new Error('QuotaExceededError'); },
    removeItem: () => { throw new Error('SecurityError'); },
  });

  it.each([
    ['throws on every call', () => throwing()],
    ['throws on access', () => { throw new Error('SecurityError'); }],
    ['is absent', () => null],
  ])('storage that %s never breaks capture, codes, signup or events', async (_label, storage) => {
    const { events, invokeAnon, rpc } = setup({ storage: storage as FirstPartyEventsDeps['storage'] });
    await expect(events.captureEntry({ pathname: '/', search: '?utm_source=tiktok' })).resolves.toBeUndefined();
    expect(events.readFirstTouch()).toBeNull();
    expect(events.setPendingCode('SPRING25')).toBe(false);
    expect(events.pendingCode()).toBeNull();
    expect(() => events.markSignupStarted()).not.toThrow();
    await expect(events.completeSignup({ id: 'u1' })).resolves.toBe(false);
    await events.track('report_viewed');
    // landing_view still goes, with a per-session id because none can be stored.
    expect(invokeAnon).toHaveBeenCalled();
    const ids = invokeAnon.mock.calls.map(c => (c[0] as { anon_id: string }).anon_id);
    expect(new Set(ids).size).toBe(1);
    expect(rpc).toHaveBeenCalledWith('log_app_event', expect.anything(), 3000);
  });

  it('log-anon-event unreachable is swallowed', async () => {
    const { events } = setup({ anonRejects: true });
    await expect(events.captureEntry({ pathname: '/', search: '' })).resolves.toBeUndefined();
    await expect(events.trackAnon('signup_started')).resolves.toBeUndefined();
  });

  it('keeps one device id across calls, and replaces a malformed stored one', async () => {
    const { events, store, invokeAnon } = setup();
    store.map.set(ANON_ID_KEY, JSON.stringify('short'));
    await events.trackAnon('landing_view');
    await events.trackAnon('signup_started');
    const ids = invokeAnon.mock.calls.map(c => (c[0] as { anon_id: string }).anon_id);
    expect(ids[0]).toBe(ids[1]);
    expect(ids[0]).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
    expect(stored(store, ANON_ID_KEY)).toBe(ids[0]);
  });
});
