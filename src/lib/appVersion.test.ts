import { describe, expect, it, vi } from 'vitest';

// runtimeConfig's app instance imports the Supabase client; no network here.
vi.mock('./supabase', () => ({ supabase: { from: () => ({ select: async () => ({ data: [], error: null }) }) } }));
import { compareAppVersions, decideUpdate, NO_UPDATE, parseAppVersion, type AppVersion } from './appVersion';
import { APP_STORE_FALLBACK_URL, PLAY_PACKAGE_NAME, storeListingUrl, storeName } from './storeListing';
import { createRuntimeConfig, parseRuntimeConfig } from './runtimeConfig';

/*
  PK-MINVER-01: version comparison for the native update gate. Versions are
  compared numerically part by part (never as strings), a build number breaks a
  tie only when both sides have one, and anything malformed fails open.
*/

const v = (version: string, build?: string): AppVersion => {
  const parsed = parseAppVersion(version, build);
  if (!parsed) throw new Error(`test version did not parse: ${version}`);
  return parsed;
};

describe('parseAppVersion', () => {
  it('reads one, two or three numeric parts, padding the missing ones with 0', () => {
    expect(parseAppVersion('2')).toEqual({ parts: [2, 0, 0], build: null });
    expect(parseAppVersion('1.4')).toEqual({ parts: [1, 4, 0], build: null });
    expect(parseAppVersion('1.0.6')).toEqual({ parts: [1, 0, 6], build: null });
    expect(parseAppVersion('01.002.0003')).toEqual({ parts: [1, 2, 3], build: null });
  });

  it('reads a plain integer build number, from a string or a number', () => {
    expect(parseAppVersion('1.0.6', '8')?.build).toBe(8);
    expect(parseAppVersion('1.0.6', 12)?.build).toBe(12);
  });

  it('drops a malformed build but keeps the version', () => {
    for (const build of ['', '1.0.6.8', '8a', ' 8', '-1', 1.5, -3, null, undefined, {}]) {
      expect(parseAppVersion('1.0.6', build), String(build)).toEqual({ parts: [1, 0, 6], build: null });
    }
  });

  it('rejects malformed versions (null)', () => {
    for (const version of [
      '', ' ', 'v1.0.6', '1.0.6-beta', '1.0.6+8', '1.0.6.1', '1..6', '.1', '1.', '1.0.6 ', ' 1.0.6', '1,0,6',
      'latest', '١.٠.٦', '99999999999999999999', null, undefined, 106, ['1', '0', '6'], {},
    ]) {
      expect(parseAppVersion(version), JSON.stringify(version)).toBeNull();
    }
  });
});

describe('compareAppVersions', () => {
  it('compares each part numerically, not as text', () => {
    expect(compareAppVersions(v('1.0.10'), v('1.0.9'))).toBe(1);
    expect(compareAppVersions(v('1.0.9'), v('1.0.10'))).toBe(-1);
    expect(compareAppVersions(v('1.10'), v('1.9.9'))).toBe(1);
    expect(compareAppVersions(v('2.0.0'), v('10.0.0'))).toBe(-1);
    expect(compareAppVersions(v('1.0.6'), v('1.0.7'))).toBe(-1);
    expect(compareAppVersions(v('1.1.0'), v('1.0.99'))).toBe(1);
  });

  it('treats missing parts as 0', () => {
    expect(compareAppVersions(v('2'), v('2.0.0'))).toBe(0);
    expect(compareAppVersions(v('1.4'), v('1.4.0'))).toBe(0);
    expect(compareAppVersions(v('1.4'), v('1.4.1'))).toBe(-1);
  });

  it('a build number breaks a tie only when both sides have one', () => {
    expect(compareAppVersions(v('1.0.6', '8'), v('1.0.6', '9'))).toBe(-1);
    expect(compareAppVersions(v('1.0.6', '10'), v('1.0.6', '9'))).toBe(1);
    expect(compareAppVersions(v('1.0.6', '8'), v('1.0.6', '8'))).toBe(0);
    expect(compareAppVersions(v('1.0.6', '8'), v('1.0.6'))).toBe(0);
    expect(compareAppVersions(v('1.0.6'), v('1.0.6', '8'))).toBe(0);
  });

  it('the version always outranks the build', () => {
    expect(compareAppVersions(v('1.0.7', '1'), v('1.0.6', '99'))).toBe(1);
    expect(compareAppVersions(v('1.0.5', '99'), v('1.0.6', '1'))).toBe(-1);
  });
});

describe('decideUpdate', () => {
  const installed = { version: '1.0.6', build: '8' };

  it('blocks below the minimum', () => {
    expect(decideUpdate({ installed, minVersion: '1.0.7', latestVersion: null })).toEqual({ kind: 'required' });
    expect(decideUpdate({ installed, minVersion: '2', latestVersion: null })).toEqual({ kind: 'required' });
    expect(decideUpdate({ installed: { version: '1.0.9', build: '20' }, minVersion: '1.0.10', latestVersion: null }))
      .toEqual({ kind: 'required' });
  });

  it('does not block at or above the minimum', () => {
    expect(decideUpdate({ installed, minVersion: '1.0.6', latestVersion: null })).toEqual(NO_UPDATE);
    expect(decideUpdate({ installed, minVersion: '1.0', latestVersion: null })).toEqual(NO_UPDATE);
    expect(decideUpdate({ installed, minVersion: '1.0.5', latestVersion: null })).toEqual(NO_UPDATE);
  });

  it('offers the banner when a newer version is out and not required', () => {
    expect(decideUpdate({ installed, minVersion: null, latestVersion: '1.0.7' })).toEqual({ kind: 'available', latest: '1.0.7' });
    expect(decideUpdate({ installed, minVersion: '1.0.6', latestVersion: '1.1' })).toEqual({ kind: 'available', latest: '1.1' });
  });

  it('no banner when she is already on the latest, or ahead of it', () => {
    expect(decideUpdate({ installed, minVersion: null, latestVersion: '1.0.6' })).toEqual(NO_UPDATE);
    expect(decideUpdate({ installed, minVersion: null, latestVersion: '1.0.5' })).toEqual(NO_UPDATE);
  });

  it('the block wins over the banner', () => {
    expect(decideUpdate({ installed, minVersion: '1.0.7', latestVersion: '1.0.8' })).toEqual({ kind: 'required' });
  });

  it('fails open: no installed version, an unreadable installed version, or null config', () => {
    expect(decideUpdate({ installed: null, minVersion: '99', latestVersion: '99' })).toEqual(NO_UPDATE);
    for (const version of ['', 'unknown', '1.0.6-beta', 'v1.0.6']) {
      expect(decideUpdate({ installed: { version, build: '8' }, minVersion: '99', latestVersion: '99' }), version).toEqual(NO_UPDATE);
    }
    expect(decideUpdate({ installed, minVersion: null, latestVersion: null })).toEqual(NO_UPDATE);
  });

  it('fails open on a malformed minimum or latest', () => {
    for (const bad of ['', 'two', '1.0.7-rc1', '1.0.7.1', ' 1.0.7']) {
      expect(decideUpdate({ installed, minVersion: bad, latestVersion: null }), bad).toEqual(NO_UPDATE);
      expect(decideUpdate({ installed, minVersion: null, latestVersion: bad }), bad).toEqual(NO_UPDATE);
    }
  });

  it('with the runtime config client, a failed read means no gate even after a cached minimum', async () => {
    const cache = new Map<string, string>();
    const storage = { getItem: (key: string) => cache.get(key) ?? null, setItem: (key: string, value: string) => { cache.set(key, value); } };
    const first = createRuntimeConfig({ fetchRows: async () => [{ key: 'min_version_ios', value: '9.0.0' }], storage: () => storage });
    await first.load();
    expect(decideUpdate({ installed, minVersion: first.minVersion('ios'), latestVersion: first.latestVersion('ios') })).toEqual({ kind: 'required' });

    const offline = createRuntimeConfig({ fetchRows: async () => { throw new Error('offline'); }, storage: () => storage });
    await offline.load();
    expect(decideUpdate({ installed, minVersion: offline.minVersion('ios'), latestVersion: offline.latestVersion('ios') })).toEqual(NO_UPDATE);
  });

  it('reads the per-platform keys from app_public_config rows', () => {
    const config = parseRuntimeConfig([
      { key: 'min_version_ios', value: '1.0.7' },
      { key: 'min_version_android', value: null },
      { key: 'latest_version_android', value: '1.0.8' },
    ]);
    expect(decideUpdate({ installed, minVersion: config.minVersion.ios, latestVersion: config.latestVersion.ios })).toEqual({ kind: 'required' });
    expect(decideUpdate({ installed, minVersion: config.minVersion.android, latestVersion: config.latestVersion.android }))
      .toEqual({ kind: 'available', latest: '1.0.8' });
  });
});

describe('storeListingUrl', () => {
  it('Android opens the Play listing for the app package', () => {
    expect(PLAY_PACKAGE_NAME).toBe('com.amani.health');
    expect(storeListingUrl('android')).toBe('https://play.google.com/store/apps/details?id=com.amani.health');
  });

  it('iOS opens the App Store listing once the numeric id is known', () => {
    expect(storeListingUrl('ios', '1234567890')).toBe('https://apps.apple.com/app/id1234567890');
  });

  it('iOS opens the App Store app while the id is unknown or not digits ([Pending] for the owner)', () => {
    expect(storeListingUrl('ios')).toBe(APP_STORE_FALLBACK_URL);
    expect(storeListingUrl('ios', null)).toBe(APP_STORE_FALLBACK_URL);
    expect(storeListingUrl('ios', 'id123')).toBe(APP_STORE_FALLBACK_URL);
  });

  it('names the store', () => {
    expect(storeName('ios')).toBe('the App Store');
    expect(storeName('android')).toBe('Google Play');
  });
});
