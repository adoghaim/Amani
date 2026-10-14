import { isNative } from './platform';
import { secureStorage } from './secureStorage';

// ─── Supabase auth session storage on native (PK-DEVICE-01 P1(1), A6) ─────

/**
 * Where the Supabase client keeps the signed-in session.
 *
 * Web: `undefined`, so supabase-js keeps its default, localStorage. Nothing
 * changes for the web app.
 *
 * Native: the Keychain (iOS) or Keystore (Android), through `secureStorage`.
 * Two things happen once per launch, before the first read:
 *
 *   1. Reinstall (A6). The first launch after an install finds no install
 *      marker in localStorage, which the OS deletes with the app. It then
 *      clears Amani's secure-storage items, because the iOS Keychain survives
 *      an uninstall. That keeps today's behaviour: a reinstall signs her out.
 *      The marker is written only after the clear succeeds.
 *   2. Migration. A session written to localStorage by an older version of the
 *      app is copied into secure storage on first read, then removed from
 *      localStorage. She stays signed in through the update. The localStorage
 *      copy is removed only after the secure write succeeded.
 *
 * An update from a version without the marker also runs step 1, which is
 * harmless: older versions never wrote to secure storage.
 */

/** Set in localStorage once the first-launch clear has run. */
export const INSTALL_MARKER_KEY = 'amani.install-marker.v1';

/** The storage shape supabase-js accepts for `auth.storage`. */
export interface AuthSessionStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export interface AuthStoragePorts {
  secure: {
    get(key: string): Promise<string | null>;
    set(key: string, value: string): Promise<void>;
    remove(key: string): Promise<void>;
    clear(): Promise<void>;
  };
  /** The old home of the session (localStorage), or null where there is none. */
  legacy(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null;
}

/** The native session storage, with its ports injected so tests need no device. */
export function createAuthSessionStorage(ports: AuthStoragePorts): AuthSessionStorage {
  let ready: Promise<void> | null = null;

  function legacy() {
    try {
      return ports.legacy();
    } catch {
      return null;
    }
  }

  function prepare(): Promise<void> {
    if (!ready) {
      ready = (async () => {
        const store = legacy();
        let marked = false;
        try {
          marked = store?.getItem(INSTALL_MARKER_KEY) != null;
        } catch {
          marked = false;
        }
        if (marked) return;
        await ports.secure.clear();
        try {
          store?.setItem(INSTALL_MARKER_KEY, '1');
        } catch {
          // Storage blocked: the clear runs again next launch, which only signs her out again.
        }
      })();
      // If the clear failed, try again on the next call instead of reading a stale session.
      ready.catch(() => { ready = null; });
    }
    return ready;
  }

  return {
    async getItem(key) {
      await prepare();
      const stored = await ports.secure.get(key);
      if (stored !== null) return stored;
      const store = legacy();
      let old: string | null = null;
      try {
        old = store?.getItem(key) ?? null;
      } catch {
        old = null;
      }
      if (old === null) return null;
      await ports.secure.set(key, old);
      try {
        store?.removeItem(key);
      } catch {
        // Left behind only if storage refuses; the secure copy is the one read from now on.
      }
      return old;
    },
    async setItem(key, value) {
      await prepare();
      await ports.secure.set(key, value);
    },
    async removeItem(key) {
      await prepare();
      await ports.secure.remove(key);
      try {
        legacy()?.removeItem(key);
      } catch {
        // Nothing to remove, or storage refuses.
      }
    },
  };
}

let nativeSessionStorage: AuthSessionStorage | null = null;

/**
 * The `auth.storage` to give the Supabase client: secure storage on native,
 * `undefined` (supabase-js's localStorage default) on the web.
 */
export function authSessionStorage(): AuthSessionStorage | undefined {
  if (!isNative()) return undefined;
  if (!nativeSessionStorage) {
    nativeSessionStorage = createAuthSessionStorage({
      secure: secureStorage,
      legacy: () => (typeof window === 'undefined' ? null : window.localStorage),
    });
  }
  return nativeSessionStorage;
}
