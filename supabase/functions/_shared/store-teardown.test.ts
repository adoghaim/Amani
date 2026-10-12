import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fetchWithBackoff } from './fetchWithBackoff.ts';
import {
  ANDROID_PACKAGE_NAME,
  ANDROID_PUBLISHER_API,
  ANDROID_PUBLISHER_SCOPE,
  GOOGLE_TOKEN_URL,
  PLAY_CANCELLATION_TYPE,
  PLAY_SERVICE_ACCOUNT_ENV,
  REVENUECAT_SECRET_ENV,
  REVENUECAT_SUBSCRIBERS_API,
  STORE_REQUEST_POLICY,
  StoreTeardownError,
  cancelPlaySubscriptions,
  createStoreTeardownActions,
  deleteRevenueCatSubscriber,
  isPlayOrderId,
  parsePlayServiceAccount,
  signServiceAccountAssertion,
  type HttpPort,
  type StoreRequestPolicy,
} from './store-teardown.ts';

// Synthetic values only. None of these is, or resembles, a real credential.
const USER = '3f1c2b9a-6d7e-4f80-9a1b-2c3d4e5f6a7b';
const RC_KEY = 'rc-secret-for-tests';
const ORDER = 'GPA.1234-5678-9012-34567';
const TOKEN = 'synthetic-purchase-token.AO-J1Oz-test';
const ACCESS = 'synthetic-access-token';
const NOW = Date.parse('2026-10-12T12:00:00.000Z');
const PLAY_APP = `${ANDROID_PUBLISHER_API}/${ANDROID_PACKAGE_NAME}`;

interface Call {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string | null;
}

function fakeHttp(respond: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  // What each request asked fetchWithBackoff for, in the same order as `calls`.
  const policies: Array<Readonly<StoreRequestPolicy>> = [];
  const http: HttpPort = async (url, init, policy) => {
    const call: Call = {
      method: init.method ?? 'GET',
      url,
      headers: Object.fromEntries(new Headers(init.headers).entries()),
      body: typeof init.body === 'string' ? init.body : null,
    };
    calls.push(call);
    policies.push(policy);
    return respond(call);
  };
  return { http, calls, policies };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const status = (code: number) => new Response(null, { status: code });
const networkDown = () => {
  throw new TypeError('fetch failed');
};

type Step = 'token' | 'order' | 'state' | 'cancel';

function stepOf(call: Call): Step {
  if (call.url === GOOGLE_TOKEN_URL) return 'token';
  if (call.url.startsWith(`${PLAY_APP}/orders/`)) return 'order';
  if (call.url.endsWith(':cancel')) return 'cancel';
  if (call.url.startsWith(`${PLAY_APP}/purchases/subscriptionsv2/tokens/`)) return 'state';
  throw new Error(`unexpected request ${call.method} ${call.url}`);
}

/** Google, answering every step successfully unless a step is overridden. */
function google(overrides: Partial<Record<Step, (call: Call) => Response>> = {}, state = 'SUBSCRIPTION_STATE_ACTIVE') {
  return fakeHttp((call) => {
    const step = stepOf(call);
    const override = overrides[step];
    if (override) return override(call);
    switch (step) {
      case 'token':
        return json({ access_token: ACCESS, expires_in: 3599, token_type: 'Bearer' });
      case 'order':
        return json({ orderId: ORDER, purchaseToken: TOKEN, state: 'PROCESSED' });
      case 'state':
        return json({ subscriptionState: state });
      case 'cancel':
        return json({});
    }
  });
}

const play = (storeSubscriptionId = ORDER) => [{ productId: 'amani_premium:monthly', storeSubscriptionId }];

let serviceAccountJson: string;
let privateKeyBody: string;
let publicKey: CryptoKey;

beforeAll(async () => {
  const pair = (await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair;
  publicKey = pair.publicKey;
  privateKeyBody = Buffer.from(await crypto.subtle.exportKey('pkcs8', pair.privateKey)).toString('base64');
  const pem = `-----BEGIN PRIVATE KEY-----\n${privateKeyBody.match(/.{1,64}/g)!.join('\n')}\n-----END PRIVATE KEY-----\n`;
  serviceAccountJson = JSON.stringify({
    type: 'service_account',
    project_id: 'synthetic-project',
    private_key_id: 'synthetic',
    private_key: pem,
    client_email: 'deletion@synthetic-project.iam.gserviceaccount.com',
    // Must be ignored: the assertion only ever goes to GOOGLE_TOKEN_URL.
    token_uri: 'https://example.invalid/token',
  });
});

const deps = (http: HttpPort) => ({ http, now: () => NOW });

async function decodeAndVerify(jwt: string) {
  const [header, claims, signature] = jwt.split('.');
  const valid = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    publicKey,
    Buffer.from(signature!, 'base64url'),
    new TextEncoder().encode(`${header}.${claims}`),
  );
  return {
    valid,
    header: JSON.parse(Buffer.from(header!, 'base64url').toString('utf8')),
    claims: JSON.parse(Buffer.from(claims!, 'base64url').toString('utf8')),
  };
}

// ─── RevenueCat ───────────────────────────────────────────────────────────

describe('deleteRevenueCatSubscriber', () => {
  it.each([undefined, '', '   '])('is off, and sends nothing, while the secret is %j', async (secret) => {
    const { http, calls } = fakeHttp(() => json({}));
    await expect(deleteRevenueCatSubscriber(http, secret, USER)).resolves.toBe('disabled');
    expect(calls).toHaveLength(0);
  });

  it('sends DELETE /v1/subscribers/{app user id} with the secret key', async () => {
    const { http, calls } = fakeHttp(() => json({ app_user_id: USER, deleted: true }));

    await expect(deleteRevenueCatSubscriber(http, RC_KEY, USER)).resolves.toBe('deleted');

    expect(calls).toEqual([
      {
        method: 'DELETE',
        url: `${REVENUECAT_SUBSCRIBERS_API}/${USER}`,
        headers: { accept: 'application/json', authorization: `Bearer ${RC_KEY}` },
        body: null,
      },
    ]);
    expect(REVENUECAT_SUBSCRIBERS_API).toBe('https://api.revenuecat.com/v1/subscribers');
  });

  it('treats 404 as already deleted, so a retried deletion finishes', async () => {
    const { http } = fakeHttp(() => json({ code: 7259, message: 'Subscriber not found' }, 404));
    await expect(deleteRevenueCatSubscriber(http, RC_KEY, USER)).resolves.toBe('already_gone');
  });

  it('rejects when the request never completes (network failure)', async () => {
    const { http } = fakeHttp(networkDown);
    const error = await deleteRevenueCatSubscriber(http, RC_KEY, USER).catch((e) => e);

    expect(error).toBeInstanceOf(StoreTeardownError);
    expect(error.message).toBe(
      'RevenueCat customer deletion failed: the request did not complete. ' +
        'Account deletion is incomplete; please try again later.',
    );
    expect(error.message).not.toContain(RC_KEY);
  });

  it.each([400, 401, 403, 429, 500, 503])('rejects on HTTP %i rather than reporting success', async (code) => {
    const { http } = fakeHttp(() => status(code));
    await expect(deleteRevenueCatSubscriber(http, RC_KEY, USER)).rejects.toThrow(
      `RevenueCat customer deletion failed (HTTP ${code}).`,
    );
  });

  it('encodes the app user id as one path segment', async () => {
    const { http, calls } = fakeHttp(() => status(200));
    await deleteRevenueCatSubscriber(http, RC_KEY, 'a/b?c');
    expect(calls[0]!.url).toBe(`${REVENUECAT_SUBSCRIBERS_API}/a%2Fb%3Fc`);
  });

  it('refuses an empty app user id instead of deleting whatever that addresses', async () => {
    const { http, calls } = fakeHttp(() => status(200));
    await expect(deleteRevenueCatSubscriber(http, RC_KEY, '')).rejects.toBeInstanceOf(StoreTeardownError);
    expect(calls).toHaveLength(0);
  });
});

// ─── Google Play ──────────────────────────────────────────────────────────

describe('cancelPlaySubscriptions — switched off', () => {
  it.each([undefined, '', '  '])('is off, and sends nothing, while the secret is %j', async (secret) => {
    const { http, calls } = google();
    await expect(cancelPlaySubscriptions(deps(http), secret, play())).resolves.toEqual({
      kind: 'disabled',
      uncancelled: 1,
    });
    expect(calls).toHaveLength(0);
  });

  it('sends nothing when there is nothing to cancel, even when configured', async () => {
    const { http, calls } = google();
    await expect(cancelPlaySubscriptions(deps(http), serviceAccountJson, [])).resolves.toEqual({
      kind: 'processed',
      results: [],
    });
    expect(calls).toHaveLength(0);
  });

  it.each([
    ['not JSON', 'not json'],
    ['a file path', '/secrets/play-service-account.json'],
    ['JSON that is not a key', JSON.stringify({ hello: 'world' })],
    ['a non-service-account key', JSON.stringify({ type: 'authorized_user', client_email: 'x@y', private_key: 'k' })],
  ])('fails closed when the secret is set but is %s', async (_label, secret) => {
    const { http, calls } = google();
    await expect(cancelPlaySubscriptions(deps(http), secret, play())).rejects.toBeInstanceOf(StoreTeardownError);
    expect(calls).toHaveLength(0);
  });

  it('fails closed when the private key cannot be read', async () => {
    const broken = JSON.stringify({ ...JSON.parse(serviceAccountJson), private_key: '-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----' });
    const { http, calls } = google();
    await expect(cancelPlaySubscriptions(deps(http), broken, play())).rejects.toThrow(
      `the private key in ${PLAY_SERVICE_ACCOUNT_ENV} could not be read`,
    );
    expect(calls).toHaveLength(0);
  });
});

describe('cancelPlaySubscriptions — enabled', () => {
  it('authorizes as the service account, resolves the order, checks Google, then stops payments', async () => {
    const { http, calls } = google();

    await expect(cancelPlaySubscriptions(deps(http), serviceAccountJson, play())).resolves.toEqual({
      kind: 'processed',
      results: ['cancelled'],
    });

    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      `POST ${GOOGLE_TOKEN_URL}`,
      `GET ${PLAY_APP}/orders/${ORDER}`,
      `GET ${PLAY_APP}/purchases/subscriptionsv2/tokens/${TOKEN}`,
      `POST ${PLAY_APP}/purchases/subscriptionsv2/tokens/${TOKEN}:cancel`,
    ]);

    // The token exchange: Google's JWT-bearer grant, signed by the key in the secret.
    const exchange = new URLSearchParams(calls[0]!.body!);
    expect(calls[0]!.headers['content-type']).toBe('application/x-www-form-urlencoded');
    expect(exchange.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer');
    const assertion = await decodeAndVerify(exchange.get('assertion')!);
    expect(assertion.valid).toBe(true);
    expect(assertion.header).toEqual({ alg: 'RS256', typ: 'JWT' });
    expect(assertion.claims).toEqual({
      iss: 'deletion@synthetic-project.iam.gserviceaccount.com',
      scope: ANDROID_PUBLISHER_SCOPE,
      aud: GOOGLE_TOKEN_URL,
      iat: NOW / 1000,
      exp: NOW / 1000 + 3600,
    });

    // Every Play API call carries the access token, never the key.
    for (const call of calls.slice(1)) {
      expect(call.headers.authorization).toBe(`Bearer ${ACCESS}`);
    }
    expect(JSON.parse(calls[3]!.body!)).toEqual({
      cancellationContext: { cancellationType: 'DEVELOPER_REQUESTED_STOP_PAYMENTS' },
    });
    expect(PLAY_CANCELLATION_TYPE).toBe('DEVELOPER_REQUESTED_STOP_PAYMENTS');
  });

  it('uses a stored purchase token directly, without an order lookup', async () => {
    const { http, calls } = google();
    await cancelPlaySubscriptions(deps(http), serviceAccountJson, play(TOKEN));
    expect(calls.map(stepOf)).toEqual(['token', 'state', 'cancel']);
  });

  it.each(['SUBSCRIPTION_STATE_CANCELED', 'SUBSCRIPTION_STATE_EXPIRED', 'SUBSCRIPTION_STATE_PENDING_PURCHASE_CANCELED'])(
    'leaves a subscription in %s alone — nothing left to bill, and what makes a retry safe',
    async (state) => {
      const { http, calls } = google({}, state);
      await expect(cancelPlaySubscriptions(deps(http), serviceAccountJson, play())).resolves.toEqual({
        kind: 'processed',
        results: ['not_billing'],
      });
      expect(calls.map(stepOf)).not.toContain('cancel');
    },
  );

  it.each([
    'SUBSCRIPTION_STATE_ACTIVE',
    'SUBSCRIPTION_STATE_IN_GRACE_PERIOD',
    'SUBSCRIPTION_STATE_ON_HOLD',
    'SUBSCRIPTION_STATE_PAUSED',
    'SUBSCRIPTION_STATE_PENDING',
    'SUBSCRIPTION_STATE_UNSPECIFIED',
    'SUBSCRIPTION_STATE_NOT_INVENTED_YET',
  ])('sends a cancel in %s — any state that can still bill, or that it cannot read', async (state) => {
    const { http, calls } = google({}, state);
    await expect(cancelPlaySubscriptions(deps(http), serviceAccountJson, play())).resolves.toEqual({
      kind: 'processed',
      results: ['cancelled'],
    });
    expect(calls.map(stepOf).at(-1)).toBe('cancel');
  });

  it('sends a cancel when Google answers without a state at all', async () => {
    const { http, calls } = google({ state: () => json({ kind: 'androidpublisher#subscriptionPurchaseV2' }) });
    await cancelPlaySubscriptions(deps(http), serviceAccountJson, play());
    expect(calls.map(stepOf).at(-1)).toBe('cancel');
  });

  it.each<[string, Step, number]>([
    ['the order lookup', 'order', 404],
    ['the subscription lookup', 'state', 404],
    ['the subscription lookup (expired long ago)', 'state', 410],
    ['the cancel', 'cancel', 404],
    ['the cancel (expired long ago)', 'cancel', 410],
  ])('is idempotent when %s answers %i — Google has nothing left to bill', async (_label, step, code) => {
    const { http, calls } = google({ [step]: () => status(code) });
    await expect(cancelPlaySubscriptions(deps(http), serviceAccountJson, play())).resolves.toEqual({
      kind: 'processed',
      results: ['not_found'],
    });
    expect(calls.map(stepOf).at(-1)).toBe(step);
  });

  it.each<[Step, string]>([
    ['token', 'Google Play authorization'],
    ['order', 'Google Play order lookup'],
    ['state', 'Google Play subscription lookup'],
    ['cancel', 'Google Play cancellation'],
  ])('rejects when the %s request never completes (network failure)', async (step, name) => {
    const { http } = google({ [step]: networkDown });
    await expect(cancelPlaySubscriptions(deps(http), serviceAccountJson, play())).rejects.toThrow(
      `${name} failed: the request did not complete. Account deletion is incomplete; please try again later.`,
    );
  });

  it.each<[Step, number, string]>([
    ['token', 400, 'Google Play authorization failed (HTTP 400).'],
    ['token', 401, 'Google Play authorization failed (HTTP 401).'],
    ['order', 403, 'Google Play order lookup failed (HTTP 403).'],
    ['order', 500, 'Google Play order lookup failed (HTTP 500).'],
    ['state', 401, 'Google Play subscription lookup failed (HTTP 401).'],
    ['state', 503, 'Google Play subscription lookup failed (HTTP 503).'],
    ['cancel', 400, 'Google Play cancellation failed (HTTP 400).'],
    ['cancel', 429, 'Google Play cancellation failed (HTTP 429).'],
    ['cancel', 500, 'Google Play cancellation failed (HTTP 500).'],
  ])('rejects when %s answers HTTP %i', async (step, code, message) => {
    const { http } = google({ [step]: () => status(code) });
    await expect(cancelPlaySubscriptions(deps(http), serviceAccountJson, play())).rejects.toThrow(message);
  });

  it('a refused authorization sends no Play API request', async () => {
    const { http, calls } = google({ token: () => json({ error: 'invalid_grant' }, 400) });
    await expect(cancelPlaySubscriptions(deps(http), serviceAccountJson, play())).rejects.toBeInstanceOf(
      StoreTeardownError,
    );
    expect(calls.map(stepOf)).toEqual(['token']);
  });

  it('fails closed on a 200 that is missing what the next step needs', async () => {
    const noToken = google({ token: () => json({ token_type: 'Bearer' }) });
    await expect(cancelPlaySubscriptions(deps(noToken.http), serviceAccountJson, play())).rejects.toThrow(
      'Google Play authorization returned no access token.',
    );

    const noPurchase = google({ order: () => json({ orderId: ORDER }) });
    await expect(cancelPlaySubscriptions(deps(noPurchase.http), serviceAccountJson, play())).rejects.toThrow(
      'Google Play order lookup returned no purchase token.',
    );
    expect(noPurchase.calls.map(stepOf)).toEqual(['token', 'order']);
  });

  it('works through several subscriptions in order with one authorization', async () => {
    const tokens: Record<string, string> = {
      'GPA.1111-1111-1111-11111': 'token-a',
      'GPA.2222-2222-2222-22222': 'token-b',
    };
    const states: Record<string, string> = {
      'token-a': 'SUBSCRIPTION_STATE_ACTIVE',
      'token-b': 'SUBSCRIPTION_STATE_CANCELED',
    };
    const { http, calls } = google({
      order: (call) => json({ purchaseToken: tokens[call.url.split('/').at(-1)!] }),
      state: (call) => json({ subscriptionState: states[call.url.split('/').at(-1)!] }),
    });

    const outcome = await cancelPlaySubscriptions(deps(http), serviceAccountJson, [
      { productId: 'amani_premium:monthly', storeSubscriptionId: 'GPA.1111-1111-1111-11111' },
      { productId: 'amani_premium:yearly', storeSubscriptionId: 'GPA.2222-2222-2222-22222' },
    ]);

    expect(outcome).toEqual({ kind: 'processed', results: ['cancelled', 'not_billing'] });
    expect(calls.map(stepOf)).toEqual(['token', 'order', 'state', 'cancel', 'order', 'state']);
  });

  it('cancels a purchase once when two rows lead to it', async () => {
    const { http, calls } = google();
    const outcome = await cancelPlaySubscriptions(deps(http), serviceAccountJson, [
      { productId: 'amani_premium:monthly', storeSubscriptionId: ORDER },
      { productId: 'amani_premium:monthly', storeSubscriptionId: `${ORDER}..0` },
    ]);
    expect(outcome).toEqual({ kind: 'processed', results: ['cancelled'] });
    expect(calls.map(stepOf).filter((s) => s === 'cancel')).toHaveLength(1);
  });

  it('stops at the first failure — later subscriptions are not attempted', async () => {
    const { http, calls } = google({ cancel: () => status(500) });
    await expect(
      cancelPlaySubscriptions(deps(http), serviceAccountJson, [
        { productId: 'amani_premium:monthly', storeSubscriptionId: TOKEN },
        { productId: 'amani_premium:yearly', storeSubscriptionId: 'another-token' },
      ]),
    ).rejects.toThrow('Google Play cancellation failed (HTTP 500).');
    expect(calls.some((c) => c.url.includes('another-token'))).toBe(false);
  });

  it('rejects a Play subscription with no store id instead of skipping it', async () => {
    const { http } = google();
    await expect(cancelPlaySubscriptions(deps(http), serviceAccountJson, play(''))).rejects.toThrow(
      'A Google Play subscription has no store id to cancel it by.',
    );
  });

  it('never puts a credential, token or order id into an error message', async () => {
    const failures: Array<Partial<Record<Step, (call: Call) => Response>>> = [
      { token: networkDown }, { token: () => status(401) },
      { order: networkDown }, { order: () => status(500) },
      { state: networkDown }, { state: () => status(503) },
      { cancel: networkDown }, { cancel: () => status(400) },
    ];
    for (const overrides of failures) {
      const { http } = google(overrides);
      const error = await cancelPlaySubscriptions(deps(http), serviceAccountJson, play()).catch((e) => e);
      expect(error).toBeInstanceOf(StoreTeardownError);
      for (const secret of [ACCESS, TOKEN, ORDER, privateKeyBody.slice(0, 40), 'deletion@synthetic-project']) {
        expect(error.message).not.toContain(secret);
      }
    }
  });
});

describe('service-account credentials', () => {
  it('parses the key file and accepts a key pasted with escaped newlines', async () => {
    const escaped = JSON.stringify({
      ...JSON.parse(serviceAccountJson),
      private_key: JSON.parse(serviceAccountJson).private_key.replace(/\n/g, '\\n'),
    });
    const account = parsePlayServiceAccount(escaped)!;
    expect(account.clientEmail).toBe('deletion@synthetic-project.iam.gserviceaccount.com');
    const assertion = await decodeAndVerify(await signServiceAccountAssertion(account, NOW));
    expect(assertion.valid).toBe(true);
  });

  it('treats an unset secret as off, not as an error', () => {
    expect(parsePlayServiceAccount(undefined)).toBeNull();
    expect(parsePlayServiceAccount('')).toBeNull();
  });
});

describe('Play identifiers and configuration', () => {
  it.each([
    [ORDER, true],
    [`${ORDER}..3`, true],
    [TOKEN, false],
    ['2000000000000001', false],
  ])('isPlayOrderId(%j) is %s', (id, expected) => {
    expect(isPlayOrderId(id)).toBe(expected);
  });

  it("cancels against the app's own package — the Capacitor appId and the Android applicationId", () => {
    const capacitor = readFileSync(new URL('../../../capacitor.config.ts', import.meta.url), 'utf8');
    const gradle = readFileSync(new URL('../../../android/app/build.gradle', import.meta.url), 'utf8');
    expect(capacitor.match(/appId:\s*'([^']+)'/)?.[1]).toBe(ANDROID_PACKAGE_NAME);
    expect(gradle.match(/applicationId\s+"([^"]+)"/)?.[1]).toBe(ANDROID_PACKAGE_NAME);
  });
});

// ─── Handler wiring ───────────────────────────────────────────────────────

describe('createStoreTeardownActions', () => {
  const setup = (env: Record<string, string>, respond: (call: Call) => Response) => {
    const { http, calls } = fakeHttp(respond);
    const read = vi.fn((name: string) => env[name]);
    const log = vi.fn();
    const actions = createStoreTeardownActions({ env: read, http, now: () => NOW, log });
    return { actions, calls, read, log };
  };

  it('reads exactly the documented secret names', async () => {
    expect(REVENUECAT_SECRET_ENV).toBe('REVENUECAT_SECRET_API_KEY');
    expect(PLAY_SERVICE_ACCOUNT_ENV).toBe('GOOGLE_PLAY_SUBSCRIPTIONS_SERVICE_ACCOUNT_JSON');

    const { actions, read } = setup({}, () => status(200));
    await actions.cancelPlaySubscriptions(USER, play());
    await actions.deleteRevenueCatSubscriber(USER);

    expect(read.mock.calls.map(([name]) => name)).toEqual([
      'GOOGLE_PLAY_SUBSCRIPTIONS_SERVICE_ACCOUNT_JSON',
      'REVENUECAT_SECRET_API_KEY',
    ]);
  });

  it('with neither secret set: no request at all, both steps resolve, and the log says what was skipped', async () => {
    const { actions, calls, log } = setup({}, () => status(200));

    await expect(actions.cancelPlaySubscriptions(USER, play())).resolves.toBeUndefined();
    await expect(actions.deleteRevenueCatSubscriber(USER)).resolves.toBeUndefined();

    expect(calls).toHaveLength(0);
    expect(log.mock.calls).toEqual([
      ['info', `Play server-side cancellation is off (${PLAY_SERVICE_ACCOUNT_ENV} not set); 1 subscription(s) rely on the user's acknowledgement.`],
      ['warn', `RevenueCat customer not deleted: ${REVENUECAT_SECRET_ENV} is not set.`],
    ]);
  });

  it('passes failures through to the deletion flow — never a quiet success', async () => {
    const { actions } = setup(
      { [REVENUECAT_SECRET_ENV]: RC_KEY, [PLAY_SERVICE_ACCOUNT_ENV]: serviceAccountJson },
      (call) => (call.url === GOOGLE_TOKEN_URL ? json({ access_token: ACCESS }) : status(503)),
    );

    await expect(actions.cancelPlaySubscriptions(USER, play())).rejects.toBeInstanceOf(StoreTeardownError);
    await expect(actions.deleteRevenueCatSubscriber(USER)).rejects.toBeInstanceOf(StoreTeardownError);
  });

  it('logs outcomes without ids, tokens or secrets', async () => {
    const { actions, log } = setup(
      { [REVENUECAT_SECRET_ENV]: RC_KEY, [PLAY_SERVICE_ACCOUNT_ENV]: serviceAccountJson },
      (call) => {
        if (call.url.startsWith(REVENUECAT_SUBSCRIBERS_API)) return status(404);
        switch (stepOf(call)) {
          case 'token':
            return json({ access_token: ACCESS });
          case 'order':
            return json({ purchaseToken: TOKEN });
          case 'state':
            return json({ subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE' });
          case 'cancel':
            return json({});
        }
      },
    );

    await actions.cancelPlaySubscriptions(USER, play());
    await actions.deleteRevenueCatSubscriber(USER);

    expect(log.mock.calls).toEqual([
      ['info', 'Play subscriptions: 1 cancelled, 0 already not billing, 0 unknown to Google.'],
      ['info', 'RevenueCat customer already gone.'],
    ]);
    const logged = JSON.stringify(log.mock.calls);
    for (const secret of [USER, RC_KEY, ACCESS, TOKEN, ORDER]) expect(logged).not.toContain(secret);
  });
});

// ─── Timeouts and retries (engineering review D8/D10) ─────────────────────

/** What the review fixed for every store request: a business call that is safe to repeat. */
const D10_POLICY = { attemptTimeoutMs: 10_000, tries: 3, initialDelayMs: 250 };
const STOP_PAYMENTS = { cancellationContext: { cancellationType: 'DEVELOPER_REQUESTED_STOP_PAYMENTS' } };

describe('request policy (engineering review D10)', () => {
  it('is 10 s per attempt and 3 tries, and cannot be changed at run time', () => {
    expect(STORE_REQUEST_POLICY).toEqual(D10_POLICY);
    expect(Object.isFrozen(STORE_REQUEST_POLICY)).toBe(true);
  });

  it('the RevenueCat DELETE asks fetchWithBackoff for it', async () => {
    const { http, calls, policies } = fakeHttp(() => json({ app_user_id: USER, deleted: true }));
    await deleteRevenueCatSubscriber(http, RC_KEY, USER);
    expect(calls.map((c) => c.method)).toEqual(['DELETE']);
    expect(policies).toEqual([D10_POLICY]);
  });

  it('every Google request asks fetchWithBackoff for it, the cancel included', async () => {
    const { http, calls, policies } = google();
    await cancelPlaySubscriptions(deps(http), serviceAccountJson, play());
    expect(calls.map(stepOf)).toEqual(['token', 'order', 'state', 'cancel']);
    expect(policies).toEqual([D10_POLICY, D10_POLICY, D10_POLICY, D10_POLICY]);
  });
});

interface Attempt {
  url: string;
  method: string;
  body: string | null;
  signal: AbortSignal;
  /** Fake-clock time the attempt went out. */
  at: number;
}

/**
 * The network under the real fetchWithBackoff. `answer` replies to each
 * attempt, or 'hang' leaves it unanswered until fetchWithBackoff's own timer
 * aborts it.
 */
function network(answer: (attempt: Attempt, index: number) => Response | 'hang') {
  const attempts: Attempt[] = [];
  vi.stubGlobal('fetch', (input: string | URL, init: RequestInit = {}) => {
    const attempt: Attempt = {
      url: String(input),
      method: init.method ?? 'GET',
      body: typeof init.body === 'string' ? init.body : null,
      signal: init.signal as AbortSignal,
      at: Date.now(),
    };
    attempts.push(attempt);
    const reply = answer(attempt, attempts.length - 1);
    if (reply !== 'hang') return Promise.resolve(reply);
    return new Promise<Response>((_, reject) => {
      attempt.signal.addEventListener('abort', () => reject(attempt.signal.reason), { once: true });
    });
  });
  return attempts;
}

const stepOfAttempt = (attempt: Attempt) =>
  stepOf({ method: attempt.method, url: attempt.url, headers: {}, body: attempt.body });
const isCancel = (attempt: Attempt) => stepOfAttempt(attempt) === 'cancel';

/** Google answering every step in time, unless a step is told to hang or answer otherwise. */
function googleNetwork(overrides: Partial<Record<Step, () => Response | 'hang'>> = {}) {
  return network((attempt) => {
    const step = stepOfAttempt(attempt);
    const override = overrides[step];
    if (override) return override();
    switch (step) {
      case 'token':
        return json({ access_token: ACCESS });
      case 'order':
        return json({ purchaseToken: TOKEN });
      case 'state':
        return json({ subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE' });
      case 'cancel':
        // Google's reference: "If successful, the response body is empty."
        return status(200);
    }
  });
}

/**
 * Runs the fake clock until `promise` settles. Every step is also a real
 * macrotask, so work no timer drives (Web Crypto signing) finishes too.
 */
async function settle<T>(promise: Promise<T>): Promise<{ value?: T; error?: unknown }> {
  let outcome: { value?: T; error?: unknown } | undefined;
  promise.then(
    (value) => {
      outcome = { value };
    },
    (error: unknown) => {
      outcome = { error };
    },
  );
  for (let step = 0; !outcome && step < 2_000; step++) await vi.advanceTimersByTimeAsync(500);
  if (!outcome) throw new Error('still pending after 1,000 s of fake time');
  return outcome;
}

const realHttp = { http: fetchWithBackoff, now: () => NOW };

describe('through the real fetchWithBackoff: timeouts and retries (engineering review D8/D10)', () => {
  let t0: number;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    t0 = Date.now();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('RevenueCat: each attempt gets the full 10 s before it is aborted', async () => {
    const attempts = network(() => 'hang');
    const result = deleteRevenueCatSubscriber(fetchWithBackoff, RC_KEY, USER).catch((error: unknown) => error);

    await vi.advanceTimersByTimeAsync(9_999);
    expect(attempts).toHaveLength(1);
    expect(attempts[0]!.signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(attempts[0]!.signal.aborted).toBe(true);

    await vi.runAllTimersAsync();
    expect(await result).toBeInstanceOf(StoreTeardownError);
  });

  it('RevenueCat: every attempt times out, so after 3 attempts the step fails; it never reports "deleted"', async () => {
    const attempts = network(() => 'hang');

    const { value, error } = await settle(deleteRevenueCatSubscriber(fetchWithBackoff, RC_KEY, USER));

    expect(value).toBeUndefined();
    // Aborted at 10 s each, with 250 ms and then 500 ms of backoff in between.
    expect(attempts.map((a) => a.at - t0)).toEqual([0, 10_250, 20_750]);
    expect(attempts.every((a) => a.method === 'DELETE' && a.signal.aborted)).toBe(true);
    expect(error).toBeInstanceOf(StoreTeardownError);
    expect((error as Error).message).toBe(
      'RevenueCat customer deletion failed: the request did not complete. ' +
        'Account deletion is incomplete; please try again later.',
    );
    expect(((error as Error).cause as Error).name).toBe('AbortError');
  });

  it('RevenueCat: a retry that finds the customer gone (the timed-out DELETE had landed) is already-deleted success', async () => {
    const attempts = network((_attempt, index) => (index === 0 ? 'hang' : status(404)));

    const { value, error } = await settle(deleteRevenueCatSubscriber(fetchWithBackoff, RC_KEY, USER));

    expect(error).toBeUndefined();
    expect(value).toBe('already_gone');
    expect(attempts.map((a) => a.at - t0)).toEqual([0, 10_250]);
  });

  it('RevenueCat: a 404 is answered once, not retried, and is already-deleted success', async () => {
    const attempts = network(() => json({ code: 7259, message: 'Subscriber not found' }, 404));

    const { value } = await settle(deleteRevenueCatSubscriber(fetchWithBackoff, RC_KEY, USER));

    expect(value).toBe('already_gone');
    expect(attempts).toHaveLength(1);
  });

  it('RevenueCat: a 5xx is retried, and a third 5xx still fails the step', async () => {
    const attempts = network(() => status(503));

    const { error } = await settle(deleteRevenueCatSubscriber(fetchWithBackoff, RC_KEY, USER));

    expect(attempts).toHaveLength(3);
    expect(error).toBeInstanceOf(StoreTeardownError);
    expect((error as Error).message).toBe(
      'RevenueCat customer deletion failed (HTTP 503). Account deletion is incomplete; please try again later.',
    );
  });

  it('Play: the cancel times out on every attempt; all 3 ask Google to stop payments, then the step fails', async () => {
    const attempts = googleNetwork({ cancel: () => 'hang' });

    const { value, error } = await settle(cancelPlaySubscriptions(realHttp, serviceAccountJson, play()));

    expect(value).toBeUndefined();
    const cancels = attempts.filter(isCancel);
    expect(cancels.map((a) => a.at - cancels[0]!.at)).toEqual([0, 10_250, 20_750]);
    for (const cancel of cancels) {
      expect(cancel.method).toBe('POST');
      expect(cancel.url).toBe(`${PLAY_APP}/purchases/subscriptionsv2/tokens/${TOKEN}:cancel`);
      expect(JSON.parse(cancel.body!)).toEqual(STOP_PAYMENTS);
      expect(cancel.signal.aborted).toBe(true);
    }
    expect(error).toBeInstanceOf(StoreTeardownError);
    expect((error as Error).message).toBe(
      'Google Play cancellation failed: the request did not complete. ' +
        'Account deletion is incomplete; please try again later.',
    );
  });

  it.each<Step>(['token', 'order', 'state'])(
    'Play: a %s request that times out on every attempt fails the step, and no cancel is sent',
    async (step) => {
      const attempts = googleNetwork({ [step]: () => 'hang' });

      const { error } = await settle(cancelPlaySubscriptions(realHttp, serviceAccountJson, play()));

      expect(error).toBeInstanceOf(StoreTeardownError);
      expect(attempts.filter((a) => stepOfAttempt(a) === step)).toHaveLength(3);
      expect(attempts.some(isCancel)).toBe(false);
    },
  );

  it('Play: a cancel answered 503 is retried with the same stop-payments body, and an accepted retry completes it', async () => {
    let cancels = 0;
    const attempts = googleNetwork({ cancel: () => (++cancels === 1 ? status(503) : status(200)) });

    const { value } = await settle(cancelPlaySubscriptions(realHttp, serviceAccountJson, play()));

    expect(value).toEqual({ kind: 'processed', results: ['cancelled'] });
    const sent = attempts.filter(isCancel);
    expect(sent).toHaveLength(2);
    for (const cancel of sent) expect(JSON.parse(cancel.body!)).toEqual(STOP_PAYMENTS);
  });

  it('Play: a 404 from the cancel is answered once, not retried, and is success', async () => {
    const attempts = googleNetwork({ cancel: () => status(404) });

    const { value } = await settle(cancelPlaySubscriptions(realHttp, serviceAccountJson, play()));

    expect(value).toEqual({ kind: 'processed', results: ['not_found'] });
    expect(attempts.filter(isCancel)).toHaveLength(1);
  });

  it('Play: with its secret unset, nothing reaches the network', async () => {
    const attempts = googleNetwork();

    const { value } = await settle(cancelPlaySubscriptions(realHttp, undefined, play()));

    expect(value).toEqual({ kind: 'disabled', uncancelled: 1 });
    expect(attempts).toHaveLength(0);
  });
});
