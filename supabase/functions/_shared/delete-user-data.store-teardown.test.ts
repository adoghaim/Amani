import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import { errorMessage } from './errors.ts';
import { fetchWithBackoff as realFetchWithBackoff } from './fetchWithBackoff.ts';
import { deleteUserAccount, StoreSubscriptionAcknowledgementRequiredError } from './account-deletion.ts';
import {
  ANDROID_PUBLISHER_API,
  GOOGLE_TOKEN_URL,
  PLAY_SERVICE_ACCOUNT_ENV,
  REVENUECAT_SECRET_ENV,
  REVENUECAT_SUBSCRIBERS_API,
  createStoreTeardownActions,
} from './store-teardown.ts';

/**
 * Runs delete-user-data's real Deno.serve callback (the entitlement-response.test.ts
 * technique): the handler body is transpiled from source and handed a fake Deno, a
 * fake Supabase client and a fake fetchWithBackoff, while the deletion policy and the
 * store teardown are the real modules. Database operations and outbound requests go
 * into one log, so ordering across the two is visible, and the HTTP status is the
 * one the client actually receives. The timeout tests at the end hand it the real
 * fetchWithBackoff instead, over a stubbed network and a fake clock.
 */

const source = readFileSync(new URL('../delete-user-data/index.ts', import.meta.url), 'utf8');

// Synthetic values only.
const USER = '3f1c2b9a-6d7e-4f80-9a1b-2c3d4e5f6a7b';
const RC_KEY = 'rc-secret-for-tests';
const ORDER = 'GPA.1234-5678-9012-34567';
const TOKEN = 'synthetic-purchase-token.AO-J1Oz-test';

type Row = Record<string, unknown>;
type Responder = (url: string, init: RequestInit) => Response;
/** A reply on the stubbed network: an answer, or no answer until the attempt is aborted. */
type Reply = Response | 'hang';
/** Answers one attempt; `attempt` counts from 0 per destination (see `label`). */
type Network = (url: string, attempt: number) => Reply;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const status = (code: number) => new Response(null, { status: code });

const playRow = (overrides: Row = {}): Row => ({
  platform: 'android',
  product_id: 'amani_premium:monthly',
  store_subscription_id: ORDER,
  status: 'active',
  expires_at: '2026-11-12T00:00:00.000Z',
  environment: 'production',
  ...overrides,
});
const appleRow = (): Row => playRow({ platform: 'ios', product_id: 'com.amani.health.premium.monthly', store_subscription_id: '2000000000000001' });

function label(url: string): string {
  if (url.startsWith(REVENUECAT_SUBSCRIBERS_API)) return 'revenuecat';
  if (url === GOOGLE_TOKEN_URL) return 'google:token';
  if (url.startsWith(ANDROID_PUBLISHER_API) && url.includes('/orders/')) return 'google:order';
  if (url.startsWith(ANDROID_PUBLISHER_API) && url.endsWith(':cancel')) return 'google:cancel';
  if (url.startsWith(ANDROID_PUBLISHER_API)) return 'google:state';
  throw new Error(`unexpected request to ${url}`);
}

/** Google and RevenueCat both answering success unless overridden. */
function stores(overrides: Partial<Record<string, Responder>> = {}): Responder {
  return (url, init) => {
    const which = label(url);
    const override = overrides[which];
    if (override) return override(url, init);
    switch (which) {
      case 'revenuecat':
        return json({ app_user_id: USER, deleted: true });
      case 'google:token':
        return json({ access_token: 'synthetic-access-token' });
      case 'google:order':
        return json({ purchaseToken: TOKEN });
      case 'google:state':
        return json({ subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE' });
      default:
        return json({});
    }
  };
}

/** `stores()` on the stubbed network, with per-destination overrides that may hang. */
function storesNetwork(overrides: Partial<Record<string, (attempt: number) => Reply>> = {}): Network {
  const answer = stores();
  return (url, attempt) => {
    const override = overrides[label(url)];
    return override ? override(attempt) : answer(url, {});
  };
}

function runHandler(world: {
  env?: Record<string, string>;
  iapRows?: Row[];
  respond?: Responder;
  /** When set, the handler gets the real fetchWithBackoff, and this answers each attempt. */
  network?: Network;
}) {
  const env: Record<string, string> = {
    SUPABASE_URL: 'https://project.invalid',
    SUPABASE_ANON_KEY: 'anon',
    SUPABASE_SERVICE_ROLE_KEY: 'service',
    ...world.env,
  };
  const iapRows = world.iapRows ?? [];
  const respond = world.respond ?? stores();
  const log: string[] = [];
  // `options` is what the handler asked fetchWithBackoff for (fake helper only).
  const requests: Array<{ url: string; init: RequestInit; options?: unknown }> = [];

  const from = (table: string) => {
    let op = `select:${table}`;
    let columns = '';
    const result = () => {
      if (op === 'select:iap_subscriptions') {
        // Only the selected columns come back, as from PostgREST, so a handler
        // that stopped selecting store_subscription_id would be caught here.
        const wanted = columns.split(',').map((c) => c.trim());
        return { data: iapRows.map((row) => Object.fromEntries(wanted.map((c) => [c, row[c]]))), error: null };
      }
      if (op === 'select:lab_reports') return { data: [], error: null };
      return { data: null, error: null };
    };
    const query: Record<string, unknown> = {};
    query.select = (value: string) => {
      columns = value;
      return query;
    };
    query.delete = () => {
      op = `delete:${table}`;
      return query;
    };
    query.update = () => {
      op = `update:${table}`;
      return query;
    };
    query.eq = () => query;
    query.in = () => query;
    query.maybeSingle = async () => {
      log.push(op);
      return result();
    };
    query.then = (done: (v: unknown) => unknown, fail: (e: unknown) => unknown) => {
      log.push(op);
      return Promise.resolve(result()).then(done, fail);
    };
    return query;
  };
  const database = {
    from,
    rpc: async (name: string) => {
      log.push(`rpc:${name}`);
      return { error: null };
    },
    storage: {
      from: () => ({
        list: async () => {
          log.push('storage:list');
          return { data: [], error: null };
        },
        remove: async () => ({ error: null }),
      }),
    },
    auth: {
      admin: {
        deleteUser: async () => {
          log.push('auth:deleteUser');
          return { error: null };
        },
      },
    },
  };
  const createClient = (_url: string, key: string) =>
    key === 'anon'
      ? { auth: { getUser: async () => ({ data: { user: { id: USER } }, error: null }) } }
      : database;
  const fakeFetchWithBackoff = async (url: string, init: RequestInit, options?: unknown) => {
    log.push(`http:${label(url)}`);
    requests.push({ url, init, options });
    return respond(url, init);
  };
  if (world.network) {
    // Every attempt the real helper makes is logged, so retries show up as repeats.
    const answer = world.network;
    const attempts = new Map<string, number>();
    vi.stubGlobal('fetch', (input: string | URL, init: RequestInit = {}) => {
      const url = String(input);
      const attempt = attempts.get(label(url)) ?? 0;
      attempts.set(label(url), attempt + 1);
      log.push(`http:${label(url)}`);
      requests.push({ url, init });
      const reply = answer(url, attempt);
      if (reply !== 'hang') return Promise.resolve(reply);
      const signal = init.signal as AbortSignal;
      return new Promise<Response>((_, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    });
  }
  const fetchWithBackoff = world.network ? realFetchWithBackoff : fakeFetchWithBackoff;
  class Stripe {
    constructor() {
      throw new Error('Stripe is not configured in these tests');
    }
  }

  let handler: ((req: Request) => Promise<Response>) | undefined;
  const Deno = {
    serve: (h: (req: Request) => Promise<Response>) => {
      handler = h;
    },
    env: { get: (name: string) => env[name] },
  };

  const start = source.indexOf('const corsHeaders');
  expect(start).toBeGreaterThan(0);
  const { code } = transformSync(source.slice(start), { loader: 'ts', target: 'es2022' });
  new Function(
    'Deno', 'createClient', 'Stripe', 'errorMessage', 'fetchWithBackoff',
    'deleteUserAccount', 'StoreSubscriptionAcknowledgementRequiredError', 'createStoreTeardownActions',
    code,
  )(
    Deno, createClient, Stripe, errorMessage, fetchWithBackoff,
    deleteUserAccount, StoreSubscriptionAcknowledgementRequiredError, createStoreTeardownActions,
  );
  expect(handler).toBeTypeOf('function');

  const call = async (acknowledge: boolean) => {
    const response = await handler!(
      new Request('https://project.invalid/functions/v1/delete-user-data', {
        method: 'POST',
        headers: { Authorization: 'Bearer synthetic-user-jwt', 'Content-Type': 'application/json' },
        body: JSON.stringify({ acknowledge_store_subscriptions: acknowledge }),
      }),
    );
    return { status: response.status, body: await response.json() };
  };
  return { call, log, requests };
}

let serviceAccountJson: string;

beforeAll(async () => {
  const pair = (await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair;
  const body = Buffer.from(await crypto.subtle.exportKey('pkcs8', pair.privateKey)).toString('base64');
  serviceAccountJson = JSON.stringify({
    type: 'service_account',
    client_email: 'deletion@synthetic-project.iam.gserviceaccount.com',
    private_key: `-----BEGIN PRIVATE KEY-----\n${body}\n-----END PRIVATE KEY-----\n`,
  });
});

beforeEach(() => {
  for (const level of ['info', 'warn', 'error'] as const) vi.spyOn(console, level).mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

const bothEnabled = () => ({ [REVENUECAT_SECRET_ENV]: RC_KEY, [PLAY_SERVICE_ACCOUNT_ENV]: serviceAccountJson });
const outbound = (log: string[]) => log.filter((entry) => entry.startsWith('http:'));

describe('delete-user-data handler — store teardown, executed from source', () => {
  it('with neither store secret set: deletes the account and makes no outbound request', async () => {
    const { call, log } = runHandler({});

    await expect(call(false)).resolves.toEqual({ status: 200, body: { success: true } });
    expect(outbound(log)).toEqual([]);
    expect(log.at(-1)).toBe('auth:deleteUser');
  });

  it('deletes the RevenueCat customer after the data, immediately before the auth identity', async () => {
    const { call, log, requests } = runHandler({ env: { [REVENUECAT_SECRET_ENV]: RC_KEY } });

    await expect(call(false)).resolves.toEqual({ status: 200, body: { success: true } });

    expect(log.slice(-3)).toEqual(['delete:users', 'http:revenuecat', 'auth:deleteUser']);
    expect(requests).toHaveLength(1);
    expect(requests[0]!.url).toBe(`${REVENUECAT_SUBSCRIBERS_API}/${USER}`);
    expect(requests[0]!.init.method).toBe('DELETE');
    expect(new Headers(requests[0]!.init.headers).get('authorization')).toBe(`Bearer ${RC_KEY}`);
  });

  it('a RevenueCat 404 is already-deleted: the account deletion completes', async () => {
    const { call, log } = runHandler({
      env: { [REVENUECAT_SECRET_ENV]: RC_KEY },
      respond: stores({ revenuecat: () => status(404) }),
    });

    await expect(call(false)).resolves.toEqual({ status: 200, body: { success: true } });
    expect(log.at(-1)).toBe('auth:deleteUser');
  });

  it.each<[string, Responder]>([
    ['the request never completes', () => { throw new TypeError('fetch failed'); }],
    ['RevenueCat answers 500', () => status(500)],
    ['RevenueCat answers 401', () => status(401)],
  ])('answers 500 with retry, and keeps the auth identity, when %s', async (_label, revenuecat) => {
    const { call, log } = runHandler({
      env: { [REVENUECAT_SECRET_ENV]: RC_KEY },
      respond: stores({ revenuecat }),
    });

    const { status: code, body } = await call(false);

    expect(code).toBe(500);
    expect(body.retry).toBe(true);
    expect(body.success).toBeUndefined();
    expect(body.error).toMatch(/^RevenueCat customer deletion failed.*Account deletion is incomplete; please try again later\.$/);
    expect(body.error).not.toContain(RC_KEY);
    expect(log).not.toContain('auth:deleteUser');
  });

  it('with Play enabled and the subscription acknowledged: stops Play billing before any data is touched', async () => {
    const { call, log, requests } = runHandler({ env: bothEnabled(), iapRows: [playRow()] });

    await expect(call(true)).resolves.toEqual({ status: 200, body: { success: true } });

    expect(log.slice(0, 5)).toEqual([
      'select:iap_subscriptions',
      'http:google:token',
      'http:google:order',
      'http:google:state',
      'http:google:cancel',
    ]);
    const firstDataTouch = log.findIndex((e) => e === 'storage:list' || e.startsWith('delete:'));
    expect(firstDataTouch).toBeGreaterThan(log.indexOf('http:google:cancel'));
    expect(log.slice(-2)).toEqual(['http:revenuecat', 'auth:deleteUser']);

    // The handler hands the row's store id through: the order lookup names it.
    expect(requests.find((r) => label(r.url) === 'google:order')!.url).toBe(
      `${ANDROID_PUBLISHER_API}/com.amani.health/orders/${ORDER}`,
    );
  });

  it.each<[string, Partial<Record<string, Responder>>]>([
    ['the cancel answers 503', { 'google:cancel': () => status(503) }],
    ['the order lookup answers 403', { 'google:order': () => status(403) }],
    ['authorization is refused', { 'google:token': () => status(401) }],
    ['the cancel request never completes', { 'google:cancel': () => { throw new TypeError('fetch failed'); } }],
  ])('answers 500 and deletes nothing when %s', async (_label, overrides) => {
    const { call, log } = runHandler({ env: bothEnabled(), iapRows: [playRow()], respond: stores(overrides) });

    const { status: code, body } = await call(true);

    expect(code).toBe(500);
    expect(body.retry).toBe(true);
    expect(body.error).toMatch(/^Google Play .*Account deletion is incomplete; please try again later\.$/);
    expect(log).not.toContain('storage:list');
    expect(log.some((e) => e.startsWith('delete:'))).toBe(false);
    expect(log).not.toContain('http:revenuecat');
    expect(log).not.toContain('auth:deleteUser');
  });

  it('a Play subscription Google already cancelled is left alone and the deletion completes (retry path)', async () => {
    const { call, log } = runHandler({
      env: bothEnabled(),
      iapRows: [playRow()],
      respond: stores({ 'google:state': () => json({ subscriptionState: 'SUBSCRIPTION_STATE_CANCELED' }) }),
    });

    await expect(call(true)).resolves.toEqual({ status: 200, body: { success: true } });
    expect(log).not.toContain('http:google:cancel');
    expect(log.at(-1)).toBe('auth:deleteUser');
  });

  it('an unacknowledged live store subscription still answers 409, and nothing is torn down', async () => {
    const { call, log } = runHandler({ env: bothEnabled(), iapRows: [playRow(), appleRow()] });

    const { status: code, body } = await call(false);

    expect(code).toBe(409);
    expect(body.code).toBe('store_subscription_acknowledgement_required');
    expect(body.retry).toBe(false);
    expect(body.store_subscriptions).toEqual([
      { platform: 'android', product_id: 'amani_premium:monthly', expires_at: '2026-11-12T00:00:00.000Z' },
      { platform: 'ios', product_id: 'com.amani.health.premium.monthly', expires_at: '2026-11-12T00:00:00.000Z' },
    ]);
    // The store ids stay server-side.
    expect(JSON.stringify(body)).not.toContain(ORDER);
    expect(log).toEqual(['select:iap_subscriptions']);
  });

  it('an acknowledged App Store subscription gets no Google request; the RevenueCat customer still goes', async () => {
    const { call, log } = runHandler({ env: bothEnabled(), iapRows: [appleRow()] });

    await expect(call(true)).resolves.toEqual({ status: 200, body: { success: true } });
    expect(outbound(log)).toEqual(['http:revenuecat']);
  });

  it('with Play off, an acknowledged Play subscription is left to the user, as before this packet', async () => {
    const { call, log } = runHandler({ env: { [REVENUECAT_SECRET_ENV]: RC_KEY }, iapRows: [playRow()] });

    await expect(call(true)).resolves.toEqual({ status: 200, body: { success: true } });
    expect(outbound(log)).toEqual(['http:revenuecat']);
  });
});

describe('delete-user-data handler — what reaches fetchWithBackoff (engineering review D9/D10)', () => {
  it('every store request asks for 10 s per attempt and 3 tries, the RevenueCat DELETE and the Play cancel included', async () => {
    const { call, requests } = runHandler({ env: bothEnabled(), iapRows: [playRow()] });

    await expect(call(true)).resolves.toEqual({ status: 200, body: { success: true } });

    expect(requests.map((r) => label(r.url))).toEqual([
      'google:token',
      'google:order',
      'google:state',
      'google:cancel',
      'revenuecat',
    ]);
    for (const request of requests) {
      expect(request.options).toEqual({ attemptTimeoutMs: 10_000, tries: 3, initialDelayMs: 250 });
    }
  });

  it('the Play cancel asks Google to stop payments (DEVELOPER_REQUESTED_STOP_PAYMENTS)', async () => {
    const { call, requests } = runHandler({ env: bothEnabled(), iapRows: [playRow()] });

    await expect(call(true)).resolves.toEqual({ status: 200, body: { success: true } });

    const cancel = requests.find((r) => label(r.url) === 'google:cancel')!;
    expect(cancel.url).toBe(
      `${ANDROID_PUBLISHER_API}/com.amani.health/purchases/subscriptionsv2/tokens/${TOKEN}:cancel`,
    );
    expect(cancel.init.method).toBe('POST');
    expect(new Headers(cancel.init.headers).get('content-type')).toBe('application/json');
    expect(JSON.parse(cancel.init.body as string)).toEqual({
      cancellationContext: { cancellationType: 'DEVELOPER_REQUESTED_STOP_PAYMENTS' },
    });
  });
});

/**
 * Runs the fake clock until `promise` settles. Every step is also a real
 * macrotask, so work no timer drives (Web Crypto signing) finishes too.
 */
async function settle<T>(promise: Promise<T>): Promise<T> {
  let settled = false;
  promise.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );
  for (let step = 0; !settled && step < 2_000; step++) await vi.advanceTimersByTimeAsync(500);
  if (!settled) throw new Error('still pending after 1,000 s of fake time');
  return promise;
}

describe('delete-user-data handler — timeouts through the real fetchWithBackoff (engineering review D8)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('a RevenueCat DELETE that times out on every attempt answers 500 with retry, and the auth identity stays', async () => {
    const { call, log } = runHandler({
      env: { [REVENUECAT_SECRET_ENV]: RC_KEY },
      network: storesNetwork({ revenuecat: () => 'hang' }),
    });

    await expect(settle(call(false))).resolves.toEqual({
      status: 500,
      body: {
        error:
          'RevenueCat customer deletion failed: the request did not complete. ' +
          'Account deletion is incomplete; please try again later.',
        retry: true,
      },
    });
    expect(outbound(log)).toEqual(['http:revenuecat', 'http:revenuecat', 'http:revenuecat']);
    expect(log).not.toContain('auth:deleteUser');
  });

  it('a Play cancel that times out on every attempt answers 500, and nothing is deleted', async () => {
    const { call, log } = runHandler({
      env: bothEnabled(),
      iapRows: [playRow()],
      network: storesNetwork({ 'google:cancel': () => 'hang' }),
    });

    await expect(settle(call(true))).resolves.toEqual({
      status: 500,
      body: {
        error:
          'Google Play cancellation failed: the request did not complete. ' +
          'Account deletion is incomplete; please try again later.',
        retry: true,
      },
    });
    expect(outbound(log)).toEqual([
      'http:google:token',
      'http:google:order',
      'http:google:state',
      'http:google:cancel',
      'http:google:cancel',
      'http:google:cancel',
    ]);
    expect(log).not.toContain('storage:list');
    expect(log.some((e) => e.startsWith('delete:'))).toBe(false);
    expect(log).not.toContain('auth:deleteUser');
  });

  it('a RevenueCat DELETE that timed out once and then finds the customer gone completes the deletion', async () => {
    const { call, log } = runHandler({
      env: { [REVENUECAT_SECRET_ENV]: RC_KEY },
      network: storesNetwork({ revenuecat: (attempt) => (attempt === 0 ? 'hang' : status(404)) }),
    });

    await expect(settle(call(false))).resolves.toEqual({ status: 200, body: { success: true } });
    expect(outbound(log)).toEqual(['http:revenuecat', 'http:revenuecat']);
    expect(log.at(-1)).toBe('auth:deleteUser');
  });

  it('a RevenueCat 404 is answered once, not retried, and the deletion completes', async () => {
    const { call, log } = runHandler({
      env: { [REVENUECAT_SECRET_ENV]: RC_KEY },
      network: storesNetwork({ revenuecat: () => status(404) }),
    });

    await expect(settle(call(false))).resolves.toEqual({ status: 200, body: { success: true } });
    expect(outbound(log)).toEqual(['http:revenuecat']);
    expect(log.at(-1)).toBe('auth:deleteUser');
  });

  it('with the Play secret unset, no request reaches Google; the acknowledged Play subscription is left to the user', async () => {
    const { call, log } = runHandler({
      env: { [REVENUECAT_SECRET_ENV]: RC_KEY },
      iapRows: [playRow()],
      network: storesNetwork(),
    });

    await expect(settle(call(true))).resolves.toEqual({ status: 200, body: { success: true } });
    expect(outbound(log)).toEqual(['http:revenuecat']);
  });

  it('with neither store secret set, nothing reaches the network at all', async () => {
    const { call, log } = runHandler({ iapRows: [playRow()], network: storesNetwork() });

    await expect(settle(call(true))).resolves.toEqual({ status: 200, body: { success: true } });
    expect(outbound(log)).toEqual([]);
    expect(log.at(-1)).toBe('auth:deleteUser');
  });
});
