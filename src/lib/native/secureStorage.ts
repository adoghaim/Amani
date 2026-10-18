import { isNative } from './platform';

// ─── Secure storage: Keychain (iOS) / Keystore (Android) ──────────────────

/**
 * Key-value storage for secrets (PK-DEVICE-01).
 *
 * On native it is the Keychain on iOS and Keystore-encrypted preferences on
 * Android, through @aparajita/capacitor-secure-storage. Every key Amani writes
 * carries its own prefix, so `clear()` removes Amani's items and nothing else.
 * iOS items are readable only while the phone is unlocked, never sync to iCloud
 * and never move to another device in a backup (`whenUnlockedThisDeviceOnly`).
 *
 * On the web it is localStorage, as before: the web build keeps its current
 * storage.
 */

/** Amani's prefix for every secure-storage key. */
export const SECURE_STORAGE_PREFIX = 'amani_';

type Plugin = typeof import('@aparajita/capacitor-secure-storage')['SecureStorage'];

/*
  The plugin travels inside an object. A Capacitor plugin proxy answers every
  property, `then` included, so resolving a promise with the proxy itself (returning it from an async
  function included) makes
  `await` call `SecureStorage.then()`, which rejects as not implemented.
*/
let configured: Promise<{ store: Plugin }> | null = null;

function configure(): Promise<{ store: Plugin }> {
  if (!configured) {
    configured = (async () => {
      const { SecureStorage, KeychainAccess } = await import('@aparajita/capacitor-secure-storage');
      await SecureStorage.setKeyPrefix(SECURE_STORAGE_PREFIX);
      await SecureStorage.setSynchronize(false);
      await SecureStorage.setDefaultKeychainAccess(KeychainAccess.whenUnlockedThisDeviceOnly);
      return { store: SecureStorage };
    })();
    // A failed set-up is retried on the next call rather than cached.
    configured.catch(() => { configured = null; });
  }
  return configured;
}

export const secureStorage = {
  async get(key: string): Promise<string | null> {
    if (isNative()) return (await configure()).store.getItem(key);
    return localStorage.getItem(key);
  },
  async set(key: string, value: string): Promise<void> {
    if (isNative()) return (await configure()).store.setItem(key, value);
    localStorage.setItem(key, value);
  },
  async remove(key: string): Promise<void> {
    if (isNative()) return (await configure()).store.removeItem(key);
    localStorage.removeItem(key);
  },
  /** Native: removes every Amani secure-storage item. Web: a no-op (it never touches the rest of localStorage). */
  async clear(): Promise<void> {
    if (isNative()) await (await configure()).store.clear();
  },
};
