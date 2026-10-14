import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  ANON_EVENTS_GLOBAL_PER_DAY,
  ANON_EVENTS_PER_IP_PER_DAY,
  ANON_EVENT_SALT_SECRET_NAME,
  GLOBAL_BUCKET,
  clientIp,
  createAnonEventActions,
  createAppEventSink,
  dailySalt,
  handleAnonEvent,
  ipBucket,
  logServerEvent,
  revenueCatFunnelEvent,
  stripeFunnelEvent,
  TRUSTED_PROXY_HOPS,
  UNKNOWN_IP_KEY,
  utcDay,
  type AnonEventActions,
  type AppEventRow,
} from './app-events.ts';

/*
  PK-EXP5 server side, driven with fakes (the actions-port pattern): the
  pre-signup door log-anon-event (allow-list, IP-hash rotation, per-IP and
  global caps, no raw IP stored), server-side events that never block the main
  flow, and which webhook deliveries are funnel steps.
*/

const SECRET = 'test-secret-not-a-real-value';
const ANON = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6';
const NOW = new Date('2026-10-13T12:00:00Z');
const body = (value: unknown) => JSON.stringify(value);

function fakeActions(opts: { failCounter?: boolean; failInsert?: boolean } = {}) {
  const counters = new Map<string, number>();
  const rows: AppEventRow[] = [];
  const buckets: string[] = [];
  const actions: AnonEventActions = {
    async incrementCounter(bucket, day) {
      if (opts.failCounter) throw new Error('counter down');
      buckets.push(bucket);
      const key = `${bucket}|${day}`;
      const next = (counters.get(key) ?? 0) + 1;
      counters.set(key, next);
      return next;
    },
    async insertEvent(row) {
      if (opts.failInsert) throw new Error('insert failed');
      rows.push(row);
    },
  };
  return { actions, rows, buckets, counters };
}

const send = (fake: ReturnType<typeof fakeActions>, overrides: Partial<Parameters<typeof handleAnonEvent>[1]> = {}) =>
  handleAnonEvent(fake.actions, {
    bodyText: body({ event: 'landing_view', props: { platform: 'web', utm_source: 'tiktok' }, anon_id: ANON }),
    ip: '203.0.113.7', secret: SECRET, now: NOW, ...overrides,
  });

describe('log-anon-event: pre-signup events only (D5.3)', () => {
  it('records a valid landing_view with no user id, the device id and the props', async () => {
    const fake = fakeActions();
    expect(await send(fake)).toEqual({ status: 202, body: { ok: true } });
    expect(fake.rows).toEqual([{ event: 'landing_view', props: { platform: 'web', utm_source: 'tiktok' }, user_id: null, anon_id: ANON }]);
  });

  it('accepts signup_started too', async () => {
    const fake = fakeActions();
    expect((await send(fake, { bodyText: body({ event: 'signup_started', anon_id: ANON }) })).status).toBe(202);
    expect(fake.rows[0]).toMatchObject({ event: 'signup_started', props: {} });
  });

  it.each([
    ['a signed-in event', { event: 'signup_completed', anon_id: ANON }],
    ['a server event', { event: 'subscription_activated', anon_id: ANON }],
    ['an unknown event', { event: 'page_view', anon_id: ANON }],
    ['an unknown prop key', { event: 'landing_view', props: { email: 'x' }, anon_id: ANON }],
    ['a free-text prop value', { event: 'landing_view', props: { utm_campaign: 'spring sale!' }, anon_id: ANON }],
    ['a missing anon_id', { event: 'landing_view' }],
    ['a short anon_id', { event: 'landing_view', anon_id: 'abc' }],
    ['a malformed anon_id', { event: 'landing_view', anon_id: `${ANON}!` }],
    ['a user_id smuggled in', { event: 'landing_view', anon_id: ANON, user_id: '11111111-1111-4111-8111-111111111111' }],
  ])('refuses %s with 400, before counting or writing anything', async (_label, payload) => {
    const fake = fakeActions();
    expect((await send(fake, { bodyText: body(payload) })).status).toBe(400);
    expect(fake.buckets).toEqual([]);
    expect(fake.rows).toEqual([]);
  });

  it.each(['not json', '[]', 'null', '"x"'])('refuses the body %j with 400', async text => {
    const fake = fakeActions();
    expect((await send(fake, { bodyText: text })).status).toBe(400);
    expect(fake.rows).toEqual([]);
  });

  it('refuses an oversized body with 413', async () => {
    const fake = fakeActions();
    const big = body({ event: 'landing_view', anon_id: ANON, props: { utm_source: 'a' }, pad: 'x'.repeat(3000) });
    expect((await send(fake, { bodyText: big })).status).toBe(413);
    expect(fake.rows).toEqual([]);
  });

  it('fails closed with 503 and writes nothing when the salt secret is not set', async () => {
    const fake = fakeActions();
    expect(await send(fake, { secret: undefined })).toEqual({ status: 503, body: { ok: false, error: 'not configured' } });
    expect(fake.buckets).toEqual([]);
    expect(fake.rows).toEqual([]);
    expect(ANON_EVENT_SALT_SECRET_NAME).toBe('ANON_EVENT_IP_SALT_SECRET');
  });

  it('answers 503 when the counter or the insert fails', async () => {
    expect((await send(fakeActions({ failCounter: true }))).status).toBe(503);
    expect((await send(fakeActions({ failInsert: true }))).status).toBe(503);
  });
});

describe('log-anon-event: rate limit by hashed IP, plus a global daily cap', () => {
  it('never stores or counts the raw IP: the bucket is ip: + 64 hex of a salted hash', async () => {
    const fake = fakeActions();
    await send(fake);
    expect(fake.buckets).toHaveLength(2);
    expect(fake.buckets[0]).toMatch(/^ip:[0-9a-f]{64}$/);
    expect(fake.buckets[1]).toBe(GLOBAL_BUCKET);
    expect(JSON.stringify([...fake.counters.keys(), ...fake.rows])).not.toContain('203.0.113.7');
  });

  it('rotates the salt every UTC day, so one IP has an unlinkable key per day', async () => {
    const day1 = await ipBucket('203.0.113.7', SECRET, '2026-10-13');
    const sameDay = await ipBucket('203.0.113.7', SECRET, '2026-10-13');
    const day2 = await ipBucket('203.0.113.7', SECRET, '2026-10-14');
    const otherIp = await ipBucket('203.0.113.8', SECRET, '2026-10-13');
    const otherSecret = await ipBucket('203.0.113.7', 'another-secret', '2026-10-13');
    expect(sameDay).toBe(day1);
    expect(new Set([day1, day2, otherIp, otherSecret]).size).toBe(4);
    expect(await dailySalt(SECRET, '2026-10-13')).not.toBe(await dailySalt(SECRET, '2026-10-14'));
    // Without the secret a key cannot be recomputed from a guessed IP.
    expect(await ipBucket('203.0.113.7', 'a-guessed-secret', '2026-10-13')).not.toBe(day1);
    // An empty secret is "not configured" (503 above), never a weak key.
    expect((await send(fakeActions(), { secret: '' })).status).toBe(503);
  });

  it(`allows ${ANON_EVENTS_PER_IP_PER_DAY} events per IP per day, then 429 without writing`, async () => {
    const fake = fakeActions();
    for (let i = 0; i < ANON_EVENTS_PER_IP_PER_DAY; i++) expect((await send(fake)).status).toBe(202);
    expect(await send(fake)).toEqual({ status: 429, body: { ok: false, error: 'rate limited' } });
    expect(fake.rows).toHaveLength(ANON_EVENTS_PER_IP_PER_DAY);
    // Another IP is unaffected, and the next UTC day starts fresh.
    expect((await send(fake, { ip: '198.51.100.4' })).status).toBe(202);
    expect((await send(fake, { now: new Date('2026-10-14T00:00:01Z') })).status).toBe(202);
  });

  it('applies the global daily cap across every IP, and to requests with no IP at all', async () => {
    const fake = fakeActions();
    const limits = { perIp: 100, global: 3 };
    expect((await send(fake, { ip: '198.51.100.1', limits })).status).toBe(202);
    expect((await send(fake, { ip: '198.51.100.2', limits })).status).toBe(202);
    expect((await send(fake, { ip: null, limits })).status).toBe(202);
    expect(await send(fake, { ip: '198.51.100.3', limits })).toEqual({ status: 429, body: { ok: false, error: 'daily cap reached' } });
    expect(fake.rows).toHaveLength(3);
    expect(ANON_EVENTS_GLOBAL_PER_DAY).toBeGreaterThan(ANON_EVENTS_PER_IP_PER_DAY);
  });

  it('a request with no usable IP is counted in the shared unknown bucket AND the global cap, never global only', async () => {
    const fake = fakeActions();
    await send(fake, { ip: null });
    expect(fake.buckets).toEqual([await ipBucket(UNKNOWN_IP_KEY, SECRET, '2026-10-13'), GLOBAL_BUCKET]);
    expect(fake.buckets[0]).toMatch(/^ip:[0-9a-f]{64}$/);
  });

  it('a garbage x-forwarded-for cannot escape the per-IP limit', async () => {
    const fake = fakeActions();
    const limits = { perIp: 60, global: 20000 };
    const answers: number[] = [];
    for (let i = 0; i < 100; i++) {
      answers.push((await send(fake, { ip: clientIp(i % 2 ? 'x' : 'x, not-an-ip'), limits })).status);
    }
    expect(answers.filter(s => s === 202)).toHaveLength(60);
    expect(answers.slice(60).every(s => s === 429)).toBe(true);
    expect(fake.rows).toHaveLength(60);
  });

  it('a rotating forged first x-forwarded-for entry cannot escape the per-IP limit', async () => {
    const fake = fakeActions();
    const limits = { perIp: 60, global: 20000 };
    let accepted = 0;
    // The caller prepends a new fake address each time; the platform appends the real one.
    for (let i = 0; i < 100; i++) {
      const header = `198.51.100.${i % 250}, 203.0.113.7`;
      if ((await send(fake, { ip: clientIp(header), limits })).status === 202) accepted += 1;
    }
    expect(accepted).toBe(60);
  });

  it('reads the client IP from the right of x-forwarded-for (platform-appended), never the caller-controlled first entry', () => {
    expect(TRUSTED_PROXY_HOPS).toBe(0);
    expect(clientIp('203.0.113.7')).toBe('203.0.113.7');
    expect(clientIp('6.6.6.6, 203.0.113.7')).toBe('203.0.113.7');
    expect(clientIp('x, 198.51.100.9')).toBe('198.51.100.9');
    expect(clientIp('2001:db8::1')).toBe('2001:db8::1');
    expect(clientIp('6.6.6.6, 203.0.113.7, 10.0.0.1', 1)).toBe('203.0.113.7');
    expect(clientIp('203.0.113.7', 1)).toBeNull();
    expect(clientIp('198.51.100.9, x')).toBeNull();
    expect(clientIp(null)).toBeNull();
    expect(clientIp('')).toBeNull();
    expect(clientIp('evil; drop table')).toBeNull();
    expect(utcDay(NOW)).toBe('2026-10-13');
  });
});

describe('server-side events never block the main flow (D10)', () => {
  it('writes the event with the user id and the props', async () => {
    const rows: AppEventRow[] = [];
    const ok = await logServerEvent({ insertEvent: async row => { rows.push(row); } },
      { event: 'interpretation_generated', userId: 'u1', props: { tier: 'free' } });
    expect(ok).toBe(true);
    expect(rows).toEqual([{ event: 'interpretation_generated', props: { tier: 'free' }, user_id: 'u1', anon_id: null }]);
  });

  it('account_deleted is written with no user id', async () => {
    const rows: AppEventRow[] = [];
    await logServerEvent({ insertEvent: async row => { rows.push(row); } }, { event: 'account_deleted', userId: null });
    expect(rows[0]).toMatchObject({ event: 'account_deleted', user_id: null });
  });

  it('a failing insert resolves false and never throws', async () => {
    const warn = vi.fn();
    await expect(logServerEvent({ insertEvent: async () => { throw new Error('relation "app_events" does not exist'); } },
      { event: 'trial_started', userId: 'u1' }, { warn })).resolves.toBe(false);
    expect(warn).toHaveBeenCalledOnce();
  });

  it('gives up after the timeout (3 seconds by default) instead of holding the webhook', async () => {
    const warn = vi.fn();
    const started = Date.now();
    const ok = await logServerEvent({ insertEvent: () => new Promise(() => {}) },
      { event: 'subscription_activated', userId: 'u1' }, { timeoutMs: 30, warn });
    expect(ok).toBe(false);
    expect(Date.now() - started).toBeLessThan(1000);
    expect(warn.mock.calls[0]![0]).toContain('telemetry timeout');
  });

  it('resolves the user lazily, and skips the event when there is no user or the lookup fails', async () => {
    const rows: AppEventRow[] = [];
    const sink = { insertEvent: async (row: AppEventRow) => { rows.push(row); } };
    const warn = vi.fn();
    expect(await logServerEvent(sink, { event: 'trial_started', resolveUserId: async () => 'u9' }, { warn })).toBe(true);
    expect(await logServerEvent(sink, { event: 'trial_started', resolveUserId: async () => null }, { warn })).toBe(false);
    expect(await logServerEvent(sink, { event: 'trial_started', resolveUserId: async () => { throw new Error('down'); } }, { warn }))
      .toBe(false);
    expect(rows).toEqual([{ event: 'trial_started', props: {}, user_id: 'u9', anon_id: null }]);
  });

  it('refuses a client or unknown event, or bad props, without writing', async () => {
    const insertEvent = vi.fn();
    const warn = vi.fn();
    expect(await logServerEvent({ insertEvent }, { event: 'report_viewed' as never, userId: 'u' }, { warn })).toBe(false);
    expect(await logServerEvent({ insertEvent }, { event: 'trial_started', userId: 'u', props: { tier: 'a b' } }, { warn })).toBe(false);
    expect(insertEvent).not.toHaveBeenCalled();
  });
});

describe('which webhook deliveries are funnel steps', () => {
  it.each([
    [{ type: 'customer.subscription.created', data: { object: { status: 'trialing' } } }, 'trial_started'],
    [{ type: 'customer.subscription.created', data: { object: { status: 'active' } } }, 'subscription_activated'],
    [{ type: 'customer.subscription.created', data: { object: { status: 'incomplete' } } }, null],
    [{ type: 'customer.subscription.updated', data: { object: { status: 'active' }, previous_attributes: { status: 'trialing' } } }, 'subscription_activated'],
    [{ type: 'customer.subscription.updated', data: { object: { status: 'active' }, previous_attributes: { status: 'incomplete' } } }, 'subscription_activated'],
    [{ type: 'customer.subscription.updated', data: { object: { status: 'active' }, previous_attributes: { cancel_at_period_end: true } } }, null],
    [{ type: 'customer.subscription.updated', data: { object: { status: 'past_due' }, previous_attributes: { status: 'active' } } }, null],
    [{ type: 'invoice.paid', data: { object: { status: 'paid' } } }, null],
    [{ type: 'checkout.session.completed', data: { object: { status: 'complete' } } }, null],
  ])('Stripe %j -> %s', (event, expected) => {
    expect(stripeFunnelEvent(event)).toBe(expected);
  });

  it.each([
    [{ event: { type: 'INITIAL_PURCHASE', period_type: 'TRIAL', environment: 'PRODUCTION' } }, 'trial_started'],
    [{ event: { type: 'INITIAL_PURCHASE', period_type: 'NORMAL', environment: 'PRODUCTION' } }, 'subscription_activated'],
    [{ event: { type: 'RENEWAL', is_trial_conversion: true } }, 'subscription_activated'],
    [{ event: { type: 'RENEWAL', is_trial_conversion: false } }, null],
    [{ event: { type: 'CANCELLATION' } }, null],
    [{ event: { type: 'INITIAL_PURCHASE', period_type: 'TRIAL', environment: 'SANDBOX' } }, null],
    [{}, null],
    [null, null],
  ])('RevenueCat %j -> %s', (delivery, expected) => {
    expect(revenueCatFunnelEvent(delivery)).toBe(expected);
  });
});

describe('the ports over the service-role client', () => {
  it('createAppEventSink inserts the row and turns a PostgREST error into a throw', async () => {
    const insert = vi.fn(async (_row: Record<string, unknown>) => ({ error: null }));
    await createAppEventSink(insert).insertEvent({ event: 'trial_started', props: {}, user_id: 'u1', anon_id: null });
    expect(insert).toHaveBeenCalledWith({ event: 'trial_started', props: {}, user_id: 'u1', anon_id: null });
    await expect(createAppEventSink(async () => ({ error: { message: 'permission denied' } }))
      .insertEvent({ event: 'trial_started', props: {}, user_id: 'u1', anon_id: null })).rejects.toThrow('app_events insert failed: permission denied');
  });

  it('createAnonEventActions calls increment_anon_event_counter and insists on a number', async () => {
    const rpc = vi.fn(async (_fn: string, _args: Record<string, unknown>) => ({ data: 7 as unknown, error: null }));
    const actions = createAnonEventActions(async () => ({ error: null }), rpc);
    expect(await actions.incrementCounter('global', '2026-10-13')).toBe(7);
    expect(rpc).toHaveBeenCalledWith('increment_anon_event_counter', { p_bucket: 'global', p_day: '2026-10-13' });
    rpc.mockResolvedValueOnce({ data: null, error: null });
    await expect(actions.incrementCounter('global', '2026-10-13')).rejects.toThrow('no count');
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'function does not exist' } as never });
    await expect(actions.incrementCounter('global', '2026-10-13')).rejects.toThrow('function does not exist');
  });
});

describe('the Deno handlers stay thin and wire the shared module', () => {
  const read = (name: string) => readFileSync(new URL(`../${name}/index.ts`, import.meta.url), 'utf8');

  it('log-anon-event hands everything to handleAnonEvent and never touches the IP itself', () => {
    const src = read('log-anon-event');
    expect(src).toContain('handleAnonEvent(actions, {');
    expect(src).toContain('ip: clientIp(req.headers.get("x-forwarded-for"))');
    expect(src).toContain('secret: Deno.env.get(ANON_EVENT_SALT_SECRET_NAME)');
    expect(src).not.toMatch(/console\.(log|info|warn|error)/);
    expect(src.split('\n').length).toBeLessThan(60);
  });

  it('log-anon-event is listed with verify_jwt = false, and checked by docs/check-functions.sh', () => {
    const config = readFileSync(new URL('../../config.toml', import.meta.url), 'utf8');
    expect(config).toMatch(/\[functions\.log-anon-event\]\nverify_jwt = false/);
    const check = readFileSync(new URL('../../../docs/check-functions.sh', import.meta.url), 'utf8');
    expect(check).toContain('supabase/functions/*/index.ts');
    expect(check).not.toContain('log-anon-event');
    expect(check).not.toContain('app-events');
  });

  it.each([
    ['generate-interpretation', 'event: "interpretation_generated"'],
    ['stripe-webhook', 'const funnelEvent = stripeFunnelEvent(event);'],
    ['iap-webhook', 'const funnelEvent = revenueCatFunnelEvent(body);'],
    ['delete-user-data', 'event: "account_deleted", userId: null'],
  ])('%s logs its funnel step through logServerEvent after the main work', (name, marker) => {
    const src = read(name);
    expect(src).toContain(marker);
    expect(src).toMatch(/await logServerEvent\(/);
  });

  it('delete-user-data logs account_deleted only after deleteUserAccount succeeded', () => {
    const src = read('delete-user-data');
    expect(src.indexOf('account_deleted')).toBeGreaterThan(src.indexOf('await deleteUserAccount(actions'));
  });
});
