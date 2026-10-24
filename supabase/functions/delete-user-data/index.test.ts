import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as accountDeletion from '../_shared/account-deletion';
import * as accountDeletionStorage from '../_shared/account-deletion-storage';
import * as phiScrub from '../_shared/phi-scrub';
import { PLAY_SERVICE_ACCOUNT_ENV, playCancellationConfigured, StoreTeardownError } from '../_shared/store-teardown';

/*
  BS1 (review F029, F038, F036, F033 sites): runs the real Deno callback of
  delete-user-data with injected Supabase, Storage and Stripe fakes (the
  get-interpretation/index.test.ts technique) and the real shared deletion
  policy, so what is pinned is what the deployed handler does: every Stripe
  customer the account ever had is deleted, every stored file is removed before
  the auth identity goes, and a failure answers a fixed body.
*/
const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
const { code } = transformSync(source.slice(source.indexOf('const corsHeaders =')), { loader: 'ts', target: 'es2022' });

const USER_ID = '0b5e0000-0000-4000-8000-000000000002';
const EMAIL = 'leaver@example.test';

interface State {
  /** stripe_customers.customer_id (what stripe-checkout writes). */
  current?: string | null;
  /** users.stripe_customer_id (what the old portal wrote). */
  legacy?: string | null;
  /** Live Stripe subscriptions per customer. */
  subs?: Record<string, Array<{ id: string; status: string }>>;
  iap?: Array<Record<string, unknown>>;
  /** Object names under `${USER_ID}/` in lab-files. */
  files?: string[];
  /** Paths remove() silently keeps (a storage backend that drops part of a batch). */
  sticky?: string[];
  readError?: 'stripe_customers' | 'users';
  authDeleteError?: string;
  /** Server secrets by name; a name not listed reads 'test'. */
  env?: Record<string, string | undefined>;
}

function harness(state: State = {}) {
  let handler!: (req: Request) => Promise<Response>;
  const log: string[] = [];
  const files = new Set((state.files ?? []).map((name) => `${USER_ID}/${name}`));
  const listCalls: Array<{ prefix: string; limit?: number; offset?: number }> = [];
  const removeBatches: number[] = [];

  const from = (table: string) => {
    const filters: Record<string, unknown> = {};
    let op = 'select';
    const answer = () => {
      if (op !== 'select') { log.push(`${op}:${table}`); return { data: null, error: null }; }
      const lookup = (table === 'stripe_customers' && 'user_id' in filters) || (table === 'users' && 'id' in filters);
      if (lookup && state.readError === table) return { data: null, error: { message: `read failed for ${EMAIL}` } };
      if (table === 'stripe_customers' && 'user_id' in filters) {
        return { data: state.current ? { customer_id: state.current } : null, error: null };
      }
      if (table === 'users' && 'id' in filters) {
        return { data: { stripe_customer_id: state.legacy ?? null }, error: null };
      }
      if (table === 'iap_subscriptions' && 'user_id' in filters) return { data: state.iap ?? [], error: null };
      return { data: [], error: null, status: 200 };
    };
    const chain: Record<string, unknown> = {
      select: () => chain,
      limit: () => chain,
      in: () => chain,
      eq: (column: string, value: unknown) => { filters[column] = value; return chain; },
      is: (column: string, value: unknown) => { filters[column] = value; return chain; },
      delete: () => { op = 'delete'; return chain; },
      update: () => { op = 'update'; return chain; },
      insert: () => { op = 'insert'; return chain; },
      maybeSingle: async () => answer(),
      then: (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) => Promise.resolve(answer()).then(ok, ko),
    };
    return chain;
  };

  const storage = {
    from: (bucket: string) => {
      expect(bucket).toBe('lab-files');
      return {
        list: async (prefix: string, opts: { limit?: number; offset?: number } = {}) => {
          listCalls.push({ prefix, ...opts });
          // One level, as Storage lists: a folder is one entry with a null id, before the objects.
          const under = [...files].filter((p) => p.startsWith(`${prefix}/`)).map((p) => p.slice(prefix.length + 1));
          const folders = [...new Set(under.filter((n) => n.includes('/')).map((n) => n.split('/')[0]!))].sort();
          const names = under.filter((n) => !n.includes('/')).sort();
          const entries = [...folders.map((name) => ({ name, id: null })), ...names.map((name) => ({ name, id: name }))];
          const offset = opts.offset ?? 0;
          const limit = opts.limit ?? 100;
          return { data: entries.slice(offset, offset + limit), error: null };
        },
        remove: async (paths: string[]) => {
          removeBatches.push(paths.length);
          for (const p of paths) if (!state.sticky?.includes(p)) files.delete(p);
          log.push(`storage:remove:${paths.length}`);
          return { data: [], error: null };
        },
      };
    },
  };

  const client = {
    auth: {
      getUser: async () => ({ data: { user: { id: USER_ID, email: EMAIL } }, error: null }),
      admin: {
        deleteUser: async (id: string) => {
          log.push('auth:delete');
          return { error: state.authDeleteError ? { message: state.authDeleteError } : null, data: { id } };
        },
      },
    },
    from,
    rpc: async (name: string) => { log.push(`rpc:${name}`); return { data: null, error: null }; },
    storage,
  };

  const stripe = {
    subscriptions: {
      list: vi.fn(async ({ customer }: { customer: string }) => ({ data: state.subs?.[customer] ?? [] })),
      cancel: vi.fn(async (id: string) => { log.push(`stripe:cancel:${id}`); return { id }; }),
    },
    customers: { del: vi.fn(async (id: string) => { log.push(`stripe:del:${id}`); return { id, deleted: true }; }) },
  };
  function Stripe() { return stripe; }

  const values: Record<string, unknown> = {
    ...accountDeletion,
    ...accountDeletionStorage,
    ...phiScrub,
    StoreTeardownError,
    PLAY_SERVICE_ACCOUNT_ENV,
    playCancellationConfigured,
    Deno: {
      env: { get: (name: string) => (state.env && name in state.env ? state.env[name] : 'test') },
      serve: (fn: typeof handler) => { handler = fn; },
    },
    createClient: () => client,
    Stripe,
    fetchWithBackoff: async () => { throw new Error('no network in tests'); },
    createStoreTeardownActions: () => ({
      cancelPlaySubscriptions: async () => { log.push('play:cancel'); },
      deleteRevenueCatSubscriber: async () => { log.push('revenuecat:delete'); },
    }),
    createAppEventSink: () => async () => {},
    logServerEvent: async () => {},
  };
  new Function(...Object.keys(values), code)(...Object.values(values));
  return { handler, log, files, listCalls, removeBatches, stripe };
}

const request = (body: unknown = {}) => new Request('https://example.invalid/functions/v1/delete-user-data', {
  method: 'POST',
  headers: { Authorization: 'Bearer test', 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

afterEach(() => { vi.restoreAllMocks(); });

describe('delete-user-data deletes every Stripe customer the account has (F029, F038)', () => {
  it('cancels and deletes both the checkout customer and the legacy portal-created customer', async () => {
    const { handler, log, stripe } = harness({
      current: 'cus_checkout',
      legacy: 'cus_portal_orphan',
      subs: { cus_checkout: [{ id: 'sub_live', status: 'active' }, { id: 'sub_old', status: 'canceled' }] },
    });

    const response = await handler(request());

    expect(response.status).toBe(200);
    expect(stripe.customers.del.mock.calls.map((c) => c[0]).sort()).toEqual(['cus_checkout', 'cus_portal_orphan']);
    expect(stripe.subscriptions.list.mock.calls.map((c) => c[0].customer).sort()).toEqual(['cus_checkout', 'cus_portal_orphan']);
    expect(log).toContain('stripe:cancel:sub_live');
    expect(log).not.toContain('stripe:cancel:sub_old');
    // Both customers are gone at Stripe before any local pointer to either is
    // removed, so a failure part-way leaves a retry able to find the rest.
    const lastStripeDelete = Math.max(log.indexOf('stripe:del:cus_checkout'), log.indexOf('stripe:del:cus_portal_orphan'));
    expect(lastStripeDelete).toBeLessThan(log.indexOf('delete:stripe_customers'));
    expect(lastStripeDelete).toBeLessThan(log.indexOf('update:users'));
    expect(log.at(-1)).toBe('auth:delete');
  });

  it('deletes a customer recorded in both places once', async () => {
    const { handler, stripe } = harness({ current: 'cus_same', legacy: 'cus_same' });

    expect((await handler(request())).status).toBe(200);
    expect(stripe.customers.del.mock.calls.map((c) => c[0])).toEqual(['cus_same']);
  });

  it('deletes a legacy-only customer', async () => {
    const { handler, stripe } = harness({ current: null, legacy: 'cus_legacy_only' });

    expect((await handler(request())).status).toBe(200);
    expect(stripe.customers.del.mock.calls.map((c) => c[0])).toEqual(['cus_legacy_only']);
  });

  it.each(['stripe_customers', 'users'] as const)(
    'refuses, deleting nothing, when the %s customer lookup fails instead of assuming no customer',
    async (table) => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const { handler, log, stripe } = harness({ current: 'cus_checkout', legacy: 'cus_portal_orphan', readError: table, files: ['1.pdf'] });

      const response = await handler(request());

      expect(response.status).toBe(500);
      expect(stripe.customers.del).not.toHaveBeenCalled();
      expect(log.filter((e) => e.startsWith('storage:') || e.startsWith('delete:') || e === 'auth:delete')).toEqual([]);
    },
  );

  it('keeps the store-subscription gate: a live App Store subscription is a 409 and nothing is touched', async () => {
    const { handler, log, stripe } = harness({
      current: 'cus_checkout',
      iap: [{ platform: 'ios', product_id: 'p', store_subscription_id: 's', status: 'active', expires_at: null, environment: 'production' }],
    });

    const response = await handler(request());

    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe(accountDeletion.STORE_SUBSCRIPTION_ACK_CODE);
    expect(stripe.customers.del).not.toHaveBeenCalled();
    expect(log).toEqual([]);
  });
});

describe('delete-user-data 409 says whether the deletion cancels Google Play (RV-R3 AC1, F045 server half)', () => {
  const playRow = {
    platform: 'android', product_id: 'monthly', store_subscription_id: 'GPA.0000-0000-0000-00000',
    status: 'active', expires_at: null, environment: 'production',
  };
  // Synthetic: parses as a service-account key file; it is not a usable key.
  const parseableKey = JSON.stringify({
    type: 'service_account',
    client_email: 'deletion@synthetic-project.iam.gserviceaccount.com',
    private_key: '-----BEGIN PRIVATE KEY-----\nc3ludGhldGlj\n-----END PRIVATE KEY-----\n',
  });

  it.each([
    ['a Play credential that parses', true, parseableKey],
    ['the Play credential unset', false, undefined],
    ['a Play credential that is not JSON', false, 'not json'],
    ['a Play credential that is not a service-account key', false, JSON.stringify({ type: 'authorized_user' })],
  ])('%s: play_cancellation_enabled is %s, the rest of the body is unchanged, nothing is touched', async (_label, enabled, credential) => {
    const { handler, log, stripe } = harness({ current: 'cus_checkout', iap: [playRow], env: { [PLAY_SERVICE_ACCOUNT_ENV]: credential } });

    const response = await handler(request());

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: 'This account has an active subscription billed by Google. Deleting the account does not cancel it — ' +
        'you must cancel it in your store account settings or you will continue to be charged.',
      code: accountDeletion.STORE_SUBSCRIPTION_ACK_CODE,
      retry: false,
      store_subscriptions: [{ platform: 'android', product_id: 'monthly', expires_at: null }],
      play_cancellation_enabled: enabled,
    });
    expect(stripe.customers.del).not.toHaveBeenCalled();
    expect(log).toEqual([]);
  });
});

describe('delete-user-data removes every stored file before the auth identity (F036)', () => {
  const many = (n: number) => Array.from({ length: n }, (_, i) => `${String(i).padStart(5, '0')}.pdf`);

  it('pages past the first 1,000 objects and removes all of them', async () => {
    const { handler, files, listCalls, log } = harness({ files: many(2345) });

    const response = await handler(request());

    expect(response.status).toBe(200);
    expect(files.size).toBe(0);
    expect(listCalls.map((c) => c.offset ?? 0)).toEqual([0, 1000, 2000, 0]);
    expect(listCalls.every((c) => c.prefix === USER_ID)).toBe(true);
    expect(log.indexOf('auth:delete')).toBeGreaterThan(log.lastIndexOf('storage:remove:345'));
  });

  it('refuses to delete the auth user while any object remains under the prefix', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { handler, log } = harness({ files: many(3), sticky: [`${USER_ID}/00001.pdf`] });

    const response = await handler(request());

    expect(response.status).toBe(500);
    expect(log).not.toContain('auth:delete');
    expect(log.some((e) => e.startsWith('delete:'))).toBe(false);
  });

  it('removes an object inside a folder too, so a nested upload no longer refuses every retry (RV-R3 AC2)', async () => {
    const { handler, files, listCalls, log } = harness({ files: ['a.pdf', 'x/y.pdf'] });

    const response = await handler(request());

    expect(response.status).toBe(200);
    expect(files.size).toBe(0);
    expect(listCalls.map((c) => c.prefix)).toEqual([USER_ID, `${USER_ID}/x`, USER_ID]);
    expect(log.indexOf('auth:delete')).toBeGreaterThan(log.lastIndexOf('storage:remove:2'));
    expect(log.at(-1)).toBe('auth:delete');
  });

  it('still refuses to delete the auth user while an object inside a folder remains (RV-R3 AC2)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { handler, log } = harness({ files: ['a.pdf', 'x/y.pdf'], sticky: [`${USER_ID}/x/y.pdf`] });

    const response = await handler(request());

    expect(response.status).toBe(500);
    expect((await response.json()).code).toBe('account_deletion_failed');
    expect(log).not.toContain('auth:delete');
    expect(log.some((e) => e.startsWith('delete:'))).toBe(false);
  });
});

describe('delete-user-data failure body is fixed; detail goes to a scrubbed log (F033 site)', () => {
  it('answers 500 with a fixed retryable body and logs no identifier', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { handler } = harness({ authDeleteError: `User ${EMAIL} (${USER_ID}) could not be deleted` });

    const response = await handler(request());

    expect(response.status).toBe(500);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(await response.json()).toEqual({
      error: 'Failed to delete account. Please try again.',
      code: 'account_deletion_failed',
      retry: true,
    });
    const logged = JSON.stringify(log.mock.calls);
    expect(log).toHaveBeenCalled();
    expect(logged).not.toContain(EMAIL);
    expect(logged).not.toContain(USER_ID);
  });
});
