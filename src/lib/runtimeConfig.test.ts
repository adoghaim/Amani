// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/*
  PK-CFG-01: the client's reading of app_public_config. The owner decisions
  under test: D5 (a missing flag reads as off), "fetch once at launch, cache in
  memory and localStorage, fail OPEN: no version gate, all features off", and
  D7.5 (freemium is not runtime config).
*/

const query = vi.hoisted(() => ({
  calls: [] as Array<[string, string]>,
  result: { data: null as unknown, error: null as unknown },
}));
vi.mock('./supabase', () => ({
  supabase: {
    from: (table: string) => ({
      select: async (columns: string) => {
        query.calls.push([table, columns]);
        return query.result;
      },
    }),
  },
}));

import {
  createRuntimeConfig,
  FAIL_OPEN_CONFIG,
  isFeatureEnabled,
  loadRuntimeConfig,
  minVersion,
  parseRuntimeConfig,
  RUNTIME_CONFIG_STORAGE_KEY,
  type RuntimeConfigSources,
} from './runtimeConfig';

const SEED = [
  { key: 'min_version_ios', value: null },
  { key: 'min_version_android', value: null },
  { key: 'features', value: {} },
];

function memoryStorage(initial: Record<string, string> = {}) {
  const items = new Map(Object.entries(initial));
  return {
    items,
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => { items.set(key, value); },
  };
}

function sources(fetchRows: RuntimeConfigSources['fetchRows'], storage: ReturnType<RuntimeConfigSources['storage']> = null) {
  const calls = { fetch: 0 };
  return {
    calls,
    sources: {
      fetchRows: () => { calls.fetch += 1; return fetchRows(); },
      storage: () => storage,
    } satisfies RuntimeConfigSources,
  };
}

const rows = (features: unknown, ios: unknown = null, android: unknown = null) => [
  { key: 'features', value: features },
  { key: 'min_version_ios', value: ios },
  { key: 'min_version_android', value: android },
];

async function loaded(serverRows: unknown) {
  const client = createRuntimeConfig(sources(async () => serverRows).sources);
  await client.load();
  return client;
}

describe('D5: a feature flag is on only when the owner set it to true', () => {
  it('a key missing from the features bundle reads as off', async () => {
    const client = await loaded(rows({ visit_summary: true }));
    expect(client.isFeatureEnabled('visit_summary')).toBe(true);
    expect(client.isFeatureEnabled('sample_report')).toBe(false);
  });

  it('the seeded empty bundle turns everything off', async () => {
    const client = await loaded(SEED);
    expect(client.isFeatureEnabled('visit_summary')).toBe(false);
    expect(client.current()).toEqual(FAIL_OPEN_CONFIG);
  });

  it('a missing features row turns everything off', async () => {
    const client = await loaded([{ key: 'min_version_ios', value: '1.0.7' }]);
    expect(client.isFeatureEnabled('visit_summary')).toBe(false);
    expect(client.minVersion('ios')).toBe('1.0.7');
  });

  it('only the boolean true turns a flag on', async () => {
    const client = await loaded(rows({ a: 'true', b: 1, c: null, d: {}, e: [true], f: false, g: true }));
    for (const name of ['a', 'b', 'c', 'd', 'e', 'f']) expect(client.isFeatureEnabled(name), name).toBe(false);
    expect(client.isFeatureEnabled('g')).toBe(true);
  });

  it.each([[[true]], ['on'], [null], [true], [42]])('a bundle that is not an object (%j) turns everything off', async (bundle) => {
    const client = await loaded(rows(bundle));
    expect(client.current().enabledFeatures).toEqual([]);
    expect(client.isFeatureEnabled('0')).toBe(false);
  });

  it('inherited names are never flags', async () => {
    const client = await loaded(rows({}));
    for (const name of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
      expect(client.isFeatureEnabled(name), name).toBe(false);
    }
  });

  it('before anything is read, every flag is off', () => {
    const client = createRuntimeConfig(sources(() => new Promise(() => {})).sources);
    expect(client.isFeatureEnabled('visit_summary')).toBe(false);
  });
});

describe('minVersion(platform)', () => {
  it('the seeded nulls mean no version gate on either platform', async () => {
    const client = await loaded(SEED);
    expect(client.minVersion('ios')).toBeNull();
    expect(client.minVersion('android')).toBeNull();
  });

  it('answers each platform from its own key', async () => {
    const client = await loaded(rows({}, '1.0.7', '2.1'));
    expect(client.minVersion('ios')).toBe('1.0.7');
    expect(client.minVersion('android')).toBe('2.1');
  });

  it.each([['v1.0.7'], ['1.0.0.1'], ['1.0-beta'], [''], [107], [true], [{}], [['1.0.7']]])(
    'a malformed version (%j) reads as no gate', async (value) => {
      const client = await loaded(rows({}, value, value));
      expect(client.minVersion('ios')).toBeNull();
      expect(client.minVersion('android')).toBeNull();
    });

  it('a platform without a key (web) has no gate', async () => {
    const client = await loaded(rows({}, '1.0.7', '1.0.7'));
    expect(client.minVersion('web' as never)).toBeNull();
  });
});

describe('fail OPEN: no version gate, every feature off', () => {
  it.each([
    ['the read rejects', () => Promise.reject(new Error('offline'))],
    ['the read throws', () => { throw new Error('boom'); }],
    ['the reply is not a list of rows', async () => ({ message: 'relation does not exist' })],
    ['the reply is null', async () => null],
  ])('when %s', async (_label, fetchRows) => {
    const client = createRuntimeConfig(sources(fetchRows as RuntimeConfigSources['fetchRows']).sources);
    await expect(client.load()).resolves.toBeUndefined();
    expect(client.current()).toEqual(FAIL_OPEN_CONFIG);
    expect(client.minVersion('ios')).toBeNull();
    expect(client.isFeatureEnabled('visit_summary')).toBe(false);
  });

  it('a failed read replaces last launch\'s cached gate and flags instead of falling back to them', async () => {
    const storage = memoryStorage({ [RUNTIME_CONFIG_STORAGE_KEY]: JSON.stringify(rows({ visit_summary: true }, '9.0.0')) });
    let fail!: (reason: unknown) => void;
    const client = createRuntimeConfig(sources(() => new Promise((_, reject) => { fail = reject; }), storage).sources);
    const loading = client.load();
    // In flight: the head start from last launch.
    expect(client.minVersion('ios')).toBe('9.0.0');
    expect(client.isFeatureEnabled('visit_summary')).toBe(true);
    fail(new Error('offline'));
    await loading;
    expect(client.minVersion('ios')).toBeNull();
    expect(client.isFeatureEnabled('visit_summary')).toBe(false);
    // The cache is left for the next launch's head start; only a successful read rewrites it.
    expect(JSON.parse(storage.items.get(RUNTIME_CONFIG_STORAGE_KEY)!)).toEqual(rows({ visit_summary: true }, '9.0.0'));
  });
});

describe('fetch once at launch, cache in memory and localStorage', () => {
  it('reads the table once, however many callers ask', async () => {
    const { calls, sources: s } = sources(async () => rows({ visit_summary: true }));
    const client = createRuntimeConfig(s);
    const first = client.load();
    expect(client.load()).toBe(first);
    await first;
    await client.load();
    for (let i = 0; i < 5; i++) client.isFeatureEnabled('visit_summary');
    client.minVersion('ios');
    expect(calls.fetch).toBe(1);
  });

  it('the getters never read the table themselves', () => {
    const { calls, sources: s } = sources(async () => SEED);
    const client = createRuntimeConfig(s);
    client.isFeatureEnabled('visit_summary');
    client.minVersion('android');
    expect(calls.fetch).toBe(0);
  });

  it('a successful read is remembered for the next launch, which starts from it', async () => {
    const storage = memoryStorage();
    await createRuntimeConfig(sources(async () => rows({ visit_summary: true, off_flag: false }, '1.0.7'), storage).sources).load();
    expect(JSON.parse(storage.items.get(RUNTIME_CONFIG_STORAGE_KEY)!)).toEqual(rows({ visit_summary: true }, '1.0.7'));

    const nextLaunch = createRuntimeConfig(sources(() => new Promise(() => {}), storage).sources);
    void nextLaunch.load();
    expect(nextLaunch.isFeatureEnabled('visit_summary')).toBe(true);
    expect(nextLaunch.minVersion('ios')).toBe('1.0.7');
  });

  it('a fresh read wins over the cached copy', async () => {
    const storage = memoryStorage({ [RUNTIME_CONFIG_STORAGE_KEY]: JSON.stringify(rows({ visit_summary: true }, '9.0.0')) });
    const client = createRuntimeConfig(sources(async () => SEED, storage).sources);
    await client.load();
    expect(client.current()).toEqual(FAIL_OPEN_CONFIG);
    expect(JSON.parse(storage.items.get(RUNTIME_CONFIG_STORAGE_KEY)!)).toEqual(rows({}));
  });

  it.each([
    ['not JSON', '{oops'],
    ['not rows', JSON.stringify({ features: { visit_summary: true } })],
    ['tampered values', JSON.stringify(rows({ visit_summary: 'yes' }, '1.0.7; drop table'))],
  ])('a cached copy that is %s is ignored', (_label, raw) => {
    const storage = memoryStorage({ [RUNTIME_CONFIG_STORAGE_KEY]: raw });
    const client = createRuntimeConfig(sources(() => new Promise(() => {}), storage).sources);
    void client.load();
    expect(client.current()).toEqual(FAIL_OPEN_CONFIG);
  });

  it('storage that throws, or no storage at all, never breaks the read', async () => {
    const throwing = {
      getItem: () => { throw new DOMException('denied', 'SecurityError'); },
      setItem: () => { throw new DOMException('full', 'QuotaExceededError'); },
    };
    const guarded = createRuntimeConfig(sources(async () => rows({ visit_summary: true }), throwing).sources);
    await guarded.load();
    expect(guarded.isFeatureEnabled('visit_summary')).toBe(true);

    const accessorThrows = createRuntimeConfig({ fetchRows: async () => rows({ visit_summary: true }), storage: () => { throw new Error('blocked'); } });
    await accessorThrows.load();
    expect(accessorThrows.isFeatureEnabled('visit_summary')).toBe(true);

    const none = createRuntimeConfig(sources(async () => rows({}, '1.0.7')).sources);
    await none.load();
    expect(none.minVersion('ios')).toBe('1.0.7');
  });
});

describe('D7.5: freemium is not runtime config', () => {
  it('a freemium row changes nothing the client reads', () => {
    expect(parseRuntimeConfig([...SEED, { key: 'freemium_active', value: true }, { key: 'FREEMIUM_ACTIVE', value: true }]))
      .toEqual(FAIL_OPEN_CONFIG);
  });
});

describe('the app instance', () => {
  beforeEach(() => {
    window.localStorage.clear();
    query.calls.length = 0;
  });
  afterEach(() => {
    query.result = { data: null, error: null };
  });

  it('reads key and value from app_public_config once, and answers from it', async () => {
    query.result = { data: rows({ visit_summary: true }, '1.0.7', null), error: null };
    await Promise.all([loadRuntimeConfig(), loadRuntimeConfig()]);
    await loadRuntimeConfig();
    expect(query.calls).toEqual([['app_public_config', 'key,value']]);
    expect(isFeatureEnabled('visit_summary')).toBe(true);
    expect(isFeatureEnabled('sample_report')).toBe(false);
    expect(minVersion('ios')).toBe('1.0.7');
    expect(minVersion('android')).toBeNull();
    expect(JSON.parse(window.localStorage.getItem(RUNTIME_CONFIG_STORAGE_KEY)!)).toEqual(rows({ visit_summary: true }, '1.0.7'));
  });
});

describe('the app instance when the table is not deployed', () => {
  it('fails open on a PostgREST error', async () => {
    vi.resetModules();
    query.calls.length = 0;
    query.result = { data: null, error: { code: 'PGRST205', message: 'Could not find the table' } };
    const fresh = await import('./runtimeConfig');
    await expect(fresh.loadRuntimeConfig()).resolves.toBeUndefined();
    expect(query.calls).toEqual([['app_public_config', 'key,value']]);
    expect(fresh.isFeatureEnabled('visit_summary')).toBe(false);
    expect(fresh.minVersion('ios')).toBeNull();
    expect(fresh.minVersion('android')).toBeNull();
  });
});
