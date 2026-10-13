/**
 * Runtime config, client side (PK-CFG-01; owner decisions R1, D5, D6.2, D7.5).
 *
 * The app reads `public.app_public_config` once per launch (`loadRuntimeConfig`,
 * called from main.tsx) and answers every later question from memory:
 *
 *   isFeatureEnabled(name)  true only when the owner has set features.<name> to
 *                           true. A missing key, a missing bundle or any
 *                           non-boolean value reads as OFF (D5).
 *   minVersion(platform)    the minimum supported app version for 'ios' or
 *                           'android', or null for no version gate.
 *
 * Failing OPEN: when the read fails (offline, an error, the table not deployed
 * yet, a malformed reply) there is no version gate and every feature is off.
 * The copy kept in localStorage is a head start for the next launch only: the
 * getters answer from it while that launch's read is in flight, and a failed
 * read replaces it with the fail-open state rather than falling back to it.
 * Every storage access is guarded, because storage can be unavailable or throw
 * (private mode, blocked site data).
 *
 * D6.2: client code that needs a backend which is not deployed yet ships behind
 * an off-by-default flag read here, so it stays off, silently, until the owner
 * deploys and switches it on. Freemium is not here (D7.5): it stays the
 * build-time VITE_FREEMIUM_ACTIVE (src/lib/tier.ts).
 *
 * The owner's SQL for flags and versions: docs/runtime-config.md.
 */
import { supabase } from './supabase';

export type RuntimePlatform = 'ios' | 'android';

export interface PublicRuntimeConfig {
  /** Minimum supported version per platform; null means no gate. */
  readonly minVersion: Readonly<Record<RuntimePlatform, string | null>>;
  /** Names of the flags switched on. Anything absent is off. */
  readonly enabledFeatures: readonly string[];
}

/** One row of app_public_config as PostgREST returns it. */
export interface RuntimeConfigRow {
  readonly key: string;
  readonly value: unknown;
}

/** Where the config comes from; injected so tests need no network or DOM. */
export interface RuntimeConfigSources {
  /** Every app_public_config row. Throws (or rejects) when the read fails. */
  fetchRows(): Promise<unknown>;
  /** localStorage, or null where there is none. May throw on access. */
  storage(): Pick<Storage, 'getItem' | 'setItem'> | null;
}

/** The state when nothing could be read: no version gate, every flag off. */
export const FAIL_OPEN_CONFIG: PublicRuntimeConfig = Object.freeze({
  minVersion: Object.freeze({ ios: null, android: null }),
  enabledFeatures: Object.freeze([]) as readonly string[],
});

export const RUNTIME_CONFIG_STORAGE_KEY = 'amani.runtime-config.v1';

const VERSION = /^[0-9]+(\.[0-9]+){0,2}$/;

function versionOrNull(value: unknown): string | null {
  return typeof value === 'string' && VERSION.test(value) ? value : null;
}

/**
 * The client's reading of app_public_config rows. Unknown keys and malformed
 * rows are ignored; a malformed value reads as its fail-open default.
 */
export function parseRuntimeConfig(rows: unknown): PublicRuntimeConfig {
  if (!Array.isArray(rows)) throw new Error('runtime config: expected an array of rows');
  let features: unknown = undefined;
  let ios: unknown = undefined;
  let android: unknown = undefined;
  for (const row of rows as unknown[]) {
    if (typeof row !== 'object' || row === null) continue;
    const { key, value } = row as { key?: unknown; value?: unknown };
    if (key === 'features') features = value;
    else if (key === 'min_version_ios') ios = value;
    else if (key === 'min_version_android') android = value;
  }
  const enabledFeatures = typeof features === 'object' && features !== null && !Array.isArray(features)
    ? Object.entries(features as Record<string, unknown>)
      .filter(([, on]) => on === true)
      .map(([name]) => name)
      .sort()
    : [];
  return Object.freeze({
    minVersion: Object.freeze({ ios: versionOrNull(ios), android: versionOrNull(android) }),
    enabledFeatures: Object.freeze(enabledFeatures),
  });
}

/** The config as stored for the next launch: rows, so they are re-read through parseRuntimeConfig. */
function toRows(config: PublicRuntimeConfig): RuntimeConfigRow[] {
  return [
    { key: 'features', value: Object.fromEntries(config.enabledFeatures.map(name => [name, true])) },
    { key: 'min_version_ios', value: config.minVersion.ios },
    { key: 'min_version_android', value: config.minVersion.android },
  ];
}

export interface RuntimeConfigClient {
  /**
   * The one read per launch. Every call returns the same promise, so the table
   * is read at most once however many callers ask. Never rejects: a failed read
   * leaves the fail-open state in force.
   */
  load(): Promise<void>;
  isFeatureEnabled(name: string): boolean;
  minVersion(platform: RuntimePlatform): string | null;
  /** The config the getters answer from right now. */
  current(): PublicRuntimeConfig;
}

export function createRuntimeConfig(sources: RuntimeConfigSources): RuntimeConfigClient {
  let config: PublicRuntimeConfig = FAIL_OPEN_CONFIG;
  let cacheRead = false;
  let loading: Promise<void> | null = null;

  // Last launch's copy, read once and only as a head start.
  function readCacheOnce() {
    if (cacheRead) return;
    cacheRead = true;
    try {
      const raw = sources.storage()?.getItem(RUNTIME_CONFIG_STORAGE_KEY);
      if (raw) config = parseRuntimeConfig(JSON.parse(raw));
    } catch {
      config = FAIL_OPEN_CONFIG;
    }
  }

  function remember(next: PublicRuntimeConfig) {
    try {
      sources.storage()?.setItem(RUNTIME_CONFIG_STORAGE_KEY, JSON.stringify(toRows(next)));
    } catch {
      // Storage full, blocked or absent: the in-memory copy still serves this launch.
    }
  }

  return {
    load() {
      if (loading) return loading;
      readCacheOnce();
      loading = (async () => {
        try {
          const fresh = parseRuntimeConfig(await sources.fetchRows());
          config = fresh;
          remember(fresh);
        } catch {
          config = FAIL_OPEN_CONFIG;
        }
      })();
      return loading;
    },
    isFeatureEnabled(name) {
      readCacheOnce();
      return config.enabledFeatures.includes(name);
    },
    minVersion(platform) {
      readCacheOnce();
      return config.minVersion[platform] ?? null;
    },
    current() {
      readCacheOnce();
      return config;
    },
  };
}

/** The app's instance: app_public_config through the Supabase client, cached in localStorage. */
export const runtimeConfig = createRuntimeConfig({
  async fetchRows() {
    const { data, error } = await supabase.from('app_public_config').select('key,value');
    if (error) throw error;
    return data;
  },
  storage() {
    return typeof window === 'undefined' ? null : window.localStorage;
  },
});

/** Reads app_public_config once for this launch. Never rejects. */
export function loadRuntimeConfig(): Promise<void> {
  return runtimeConfig.load();
}

/** True only when features.<name> is true. A missing key reads as off (D5). */
export function isFeatureEnabled(name: string): boolean {
  return runtimeConfig.isFeatureEnabled(name);
}

/** Minimum supported app version for the platform, or null for no version gate. */
export function minVersion(platform: RuntimePlatform): string | null {
  return runtimeConfig.minVersion(platform);
}
