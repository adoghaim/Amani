import { describe, expect, it } from 'vitest';
import { createAuthSessionStorage, INSTALL_MARKER_KEY, type AuthStoragePorts } from './authStorage';

/*
  PK-DEVICE-01 P1(1) and A6: on native the Supabase session lives in secure
  storage. An existing localStorage session is migrated on first read, and the
  first launch after an install clears a Keychain session left from before an
  uninstall (today's sign-out-on-reinstall). Fakes only: no device, no plugin.
*/

const KEY = 'sb-synthetic-auth-token';
const SESSION = '{"access_token":"synthetic-access","refresh_token":"synthetic-refresh"}';

function fakes(options: { keychain?: Record<string, string>; local?: Record<string, string>; failSet?: boolean; failClear?: number } = {}) {
  const keychain = new Map(Object.entries(options.keychain ?? {}));
  const local = new Map(Object.entries(options.local ?? {}));
  const log: string[] = [];
  let clearFailures = options.failClear ?? 0;
  const ports: AuthStoragePorts = {
    secure: {
      get: async key => keychain.get(key) ?? null,
      set: async (key, value) => {
        if (options.failSet) throw new Error('keychain locked');
        log.push(`secure.set ${key}`);
        keychain.set(key, value);
      },
      remove: async key => { log.push(`secure.remove ${key}`); keychain.delete(key); },
      clear: async () => {
        if (clearFailures > 0) { clearFailures -= 1; throw new Error('keychain unavailable'); }
        log.push('secure.clear');
        keychain.clear();
      },
    },
    legacy: () => ({
      getItem: (key: string) => local.get(key) ?? null,
      setItem: (key: string, value: string) => { local.set(key, value); },
      removeItem: (key: string) => { log.push(`local.remove ${key}`); local.delete(key); },
    }),
  };
  return { ports, keychain, local, log };
}

describe('native session storage (PK-DEVICE-01)', () => {
  it('update from an older version: the localStorage session moves into secure storage and she stays signed in', async () => {
    const { ports, keychain, local, log } = fakes({ local: { [KEY]: SESSION } });
    const storage = createAuthSessionStorage(ports);
    expect(await storage.getItem(KEY)).toBe(SESSION);
    expect(keychain.get(KEY)).toBe(SESSION);
    expect(local.has(KEY)).toBe(false);
    // Copied before it is removed, and the first-launch clear ran before either.
    expect(log).toEqual(['secure.clear', `secure.set ${KEY}`, `local.remove ${KEY}`]);
    expect(local.get(INSTALL_MARKER_KEY)).toBe('1');
    // Later reads come from secure storage.
    expect(await storage.getItem(KEY)).toBe(SESSION);
  });

  it('reinstall (A6): a Keychain session left from before an uninstall is cleared, so she is signed out', async () => {
    // iOS keeps Keychain items through an uninstall; localStorage (and the marker) does not survive.
    const { ports, keychain, local } = fakes({ keychain: { [KEY]: SESSION } });
    const storage = createAuthSessionStorage(ports);
    expect(await storage.getItem(KEY)).toBeNull();
    expect(keychain.size).toBe(0);
    expect(local.get(INSTALL_MARKER_KEY)).toBe('1');
  });

  it('a normal launch (marker present) reads the secure session and clears nothing', async () => {
    const { ports, log } = fakes({ keychain: { [KEY]: SESSION }, local: { [INSTALL_MARKER_KEY]: '1' } });
    const storage = createAuthSessionStorage(ports);
    expect(await storage.getItem(KEY)).toBe(SESSION);
    expect(log).toEqual([]);
  });

  it('writes and removals go to secure storage; a removal also drops any localStorage copy', async () => {
    const { ports, keychain, local } = fakes({ local: { [INSTALL_MARKER_KEY]: '1' } });
    const storage = createAuthSessionStorage(ports);
    await storage.setItem(KEY, SESSION);
    expect(keychain.get(KEY)).toBe(SESSION);
    expect(local.has(KEY)).toBe(false);
    local.set(KEY, 'stale');
    await storage.removeItem(KEY);
    expect(keychain.has(KEY)).toBe(false);
    expect(local.has(KEY)).toBe(false);
  });

  it('a failed secure write keeps the localStorage session (never lost mid-migration)', async () => {
    const { ports, local } = fakes({ local: { [KEY]: SESSION, [INSTALL_MARKER_KEY]: '1' }, failSet: true });
    const storage = createAuthSessionStorage(ports);
    await expect(storage.getItem(KEY)).rejects.toThrow('keychain locked');
    expect(local.get(KEY)).toBe(SESSION);
  });

  it('a failed first-launch clear is retried, and the marker is written only after it succeeds', async () => {
    const { ports, keychain, local } = fakes({ keychain: { [KEY]: SESSION }, failClear: 1 });
    const storage = createAuthSessionStorage(ports);
    await expect(storage.getItem(KEY)).rejects.toThrow('keychain unavailable');
    expect(local.has(INSTALL_MARKER_KEY)).toBe(false);
    expect(await storage.getItem(KEY)).toBeNull();
    expect(keychain.size).toBe(0);
    expect(local.get(INSTALL_MARKER_KEY)).toBe('1');
  });

  it('the first-launch clear runs once per launch, however many reads race', async () => {
    const { ports, log } = fakes();
    const storage = createAuthSessionStorage(ports);
    await Promise.all([storage.getItem(KEY), storage.getItem(`${KEY}-code-verifier`), storage.setItem('other', 'x')]);
    expect(log.filter(entry => entry === 'secure.clear')).toHaveLength(1);
  });

  it('storage that throws on access (blocked site data) still works from secure storage', async () => {
    const { ports } = fakes({ keychain: { [KEY]: SESSION } });
    const storage = createAuthSessionStorage({ ...ports, legacy: () => { throw new Error('blocked'); } });
    // No marker can be read, so the first-launch clear runs: the safe direction (signed out).
    expect(await storage.getItem(KEY)).toBeNull();
    await storage.setItem(KEY, SESSION);
    expect(await storage.getItem(KEY)).toBe(SESSION);
  });
});
