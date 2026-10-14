import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/*
  PK-CONSENT-01, client side: the consent store (flag off reads nothing; the
  flag is read only after the launch config read settles) and the calls to the
  ledger and to the existing account-deletion path.
*/

const sb = vi.hoisted(() => ({
  rpc: vi.fn(async (_name: string, _args: Record<string, unknown>) => ({ error: null as null | { message: string } })),
  rows: [] as unknown[],
  readError: null as null | { message: string },
  queries: [] as string[],
  signOut: vi.fn(async (_opts?: unknown) => ({ error: null })),
  session: { access_token: 'synthetic-token' } as null | { access_token: string },
}));
vi.mock('../supabase', () => ({
  supabase: {
    rpc: sb.rpc,
    from: (table: string) => {
      const query = {
        select: (columns: string) => { sb.queries.push(`${table}.select(${columns})`); return query; },
        eq: async (column: string, value: string) => {
          sb.queries.push(`${table}.eq(${column},${value})`);
          return { data: sb.rows, error: sb.readError };
        },
      };
      return query;
    },
    auth: { getSession: async () => ({ data: { session: sb.session } }), signOut: sb.signOut },
  },
}));
const native = vi.hoisted(() => ({ platform: 'ios' }));
vi.mock('../native', () => ({ platform: () => native.platform }));
const config = vi.hoisted(() => ({ on: false, loaded: Promise.resolve() as Promise<void>, enabledAtLoad: [] as boolean[] }));
vi.mock('../runtimeConfig', () => ({
  loadRuntimeConfig: () => config.loaded,
  isFeatureEnabled: (name: string) => name === 'consent_gate' && config.on,
}));

import { consentPlatform, eraseAccount, readMissingConsents, recordConsent, signOutLocally } from './consentApi';
import {
  CONFIG_WAIT_MS, consentState, loadConsent, noteAnswers, resetConsent, setConsentStoreDepsForTests,
} from './consentStore';

beforeEach(() => {
  sb.rpc.mockClear();
  sb.rows = [];
  sb.readError = null;
  sb.queries = [];
  sb.session = { access_token: 'synthetic-token' };
  config.on = false;
  config.loaded = Promise.resolve();
  native.platform = 'ios';
  setConsentStoreDepsForTests(null);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('consent store', () => {
  it('flag off: state is off and her consent is never read', async () => {
    await loadConsent('user-1');
    expect(consentState()).toEqual({ status: 'off' });
    expect(sb.queries).toEqual([]);
  });

  it('flag on: reads consent_current for her and lists what is missing', async () => {
    config.on = true;
    sb.rows = [{ consent_type: 'age_18_plus', version: 'draft-1', granted: true }];
    await loadConsent('user-1');
    expect(consentState()).toEqual({ status: 'ready', userId: 'user-1', missing: ['health_data', 'ai_processing'] });
    expect(sb.queries).toEqual(['consent_current.select(consent_type,version,granted)', 'consent_current.eq(user_id,user-1)']);
    // Once per user: a second gate mount does not read again.
    await loadConsent('user-1');
    expect(sb.queries).toHaveLength(2);
  });

  it('flag on, read fails: error (the gate fails closed); a forced retry reads again', async () => {
    config.on = true;
    sb.readError = { message: 'synthetic outage' };
    await loadConsent('user-1');
    expect(consentState()).toEqual({ status: 'error', userId: 'user-1' });
    sb.readError = null;
    await loadConsent('user-1', true);
    expect(consentState()).toMatchObject({ status: 'ready', missing: ['age_18_plus', 'health_data', 'ai_processing'] });
  });

  it('flag off decides at once (no wait on the launch read), and a read that settles "on" closes the gate', async () => {
    let settle!: () => void;
    config.loaded = new Promise<void>(resolve => { settle = resolve; });
    const loading = loadConsent('user-1');
    // Today's timing: off straight away, from what runtimeConfig holds now.
    await Promise.resolve();
    expect(consentState()).toEqual({ status: 'off' });
    expect(sb.queries).toEqual([]);
    // This launch's read says the owner switched it on: the stale "off" does not outlive it.
    config.on = true;
    settle();
    await loading;
    expect(consentState()).toMatchObject({ status: 'ready', userId: 'user-1' });
    expect(sb.queries).toHaveLength(2);
  });

  it('a cached "on" that the launch read turns off opens the gate', async () => {
    config.on = true;
    let settle!: () => void;
    config.loaded = new Promise<void>(resolve => { settle = resolve; });
    const loading = loadConsent('user-1');
    await Promise.resolve();
    expect(consentState()).toMatchObject({ status: 'loading' });
    config.on = false;
    settle();
    await loading;
    expect(consentState()).toEqual({ status: 'off' });
  });

  it('a config read that never settles is waited for at most CONFIG_WAIT_MS, then the current answer stands', async () => {
    vi.useFakeTimers();
    config.loaded = new Promise<void>(() => {});
    const loading = loadConsent('user-1');
    await vi.advanceTimersByTimeAsync(CONFIG_WAIT_MS);
    await loading;
    expect(consentState()).toEqual({ status: 'off' });
  });

  it('noteAnswers follows grants and withdrawals; reset forgets', async () => {
    setConsentStoreDepsForTests({ gateEnabledNow: () => true, gateEnabledSettled: async () => true, readMissing: async () => ['age_18_plus', 'health_data', 'ai_processing'] });
    await loadConsent('user-1');
    noteAnswers('user-1', ['age_18_plus', 'ai_processing'], true);
    expect(consentState()).toMatchObject({ missing: ['health_data'] });
    noteAnswers('user-2', ['health_data'], true);
    expect(consentState()).toMatchObject({ missing: ['health_data'] });
    noteAnswers('user-1', ['ai_processing'], false);
    expect(consentState()).toMatchObject({ missing: ['health_data', 'ai_processing'] });
    resetConsent();
    expect(consentState()).toEqual({ status: 'idle' });
  });
});

describe('consent calls', () => {
  it('records through record_consent with the current version and the platform; the server stamps the time', async () => {
    await recordConsent('ai_processing', true);
    expect(sb.rpc).toHaveBeenCalledWith('record_consent',
      { p_consent_type: 'ai_processing', p_version: 'draft-1', p_granted: true, p_platform: 'ios' });
    native.platform = 'web';
    await recordConsent('health_data', false);
    expect(sb.rpc).toHaveBeenLastCalledWith('record_consent',
      { p_consent_type: 'health_data', p_version: 'draft-1', p_granted: false, p_platform: 'web' });
  });

  it('a failed record throws', async () => {
    sb.rpc.mockResolvedValueOnce({ error: { message: 'denied' } });
    await expect(recordConsent('age_18_plus', true)).rejects.toThrow('denied');
  });

  it('platform is ios, android or web', () => {
    for (const [name, expected] of [['ios', 'ios'], ['android', 'android'], ['web', 'web'], ['electron', 'web']]) {
      native.platform = name!;
      expect(consentPlatform()).toBe(expected);
    }
  });

  it('readMissingConsents throws on a read error', async () => {
    sb.readError = { message: 'boom' };
    await expect(readMissingConsents('u')).rejects.toThrow('boom');
  });

  it('erasure uses the existing delete-user-data path and treats any non-2xx as failure', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => ({ ok: true, status: 200, json: async (): Promise<unknown> => ({ success: true }) }));
    vi.stubGlobal('fetch', fetchMock);
    await eraseAccount();
    expect(fetchMock.mock.calls[0]![0]).toMatch(/\/functions\/v1\/delete-user-data$/);
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({
      method: 'POST', headers: { Authorization: 'Bearer synthetic-token' },
      body: JSON.stringify({ acknowledge_store_subscriptions: false }) });
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({ error: 'Auth deletion failed' }) });
    await expect(eraseAccount()).rejects.toThrow('Auth deletion failed');
    fetchMock.mockResolvedValueOnce({ ok: false, status: 409, json: async () => ({ code: 'store_subscription_acknowledgement_required' }) });
    await expect(eraseAccount()).rejects.toThrow();
    sb.session = null;
    await expect(eraseAccount()).rejects.toThrow();
  });

  it('signs out on this device only', async () => {
    await signOutLocally();
    expect(sb.signOut).toHaveBeenCalledWith({ scope: 'local' });
  });
});
