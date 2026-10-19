// @vitest-environment jsdom
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/*
  PK-INT-01 (D3): native.ts is split into one module per plugin under
  src/lib/native/ and re-exports them. The public API is unchanged and every
  plugin call is still behind Capacitor.isNativePlatform(): on web no plugin
  module is even loaded.
*/

const env = vi.hoisted(() => ({
  native: false,
  os: 'ios' as 'ios' | 'android',
  loaded: [] as string[],
  calls: [] as unknown[][],
  keychain: new Map<string, string>(),
  biometry: { isAvailable: true, biometryType: 2, biometryTypes: [2], deviceIsSecure: true } as Record<string, unknown>,
  authError: null as null | { code: string },
}));
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => env.native, getPlatform: () => (env.native ? env.os : 'web') },
  registerPlugin: (name: string) => {
    env.loaded.push(`registerPlugin:${name}`);
    return { setSecure: async (options: unknown) => { env.calls.push([`${name}.setSecure`, options]); } };
  },
}));
// PK-DEVICE-01: the secure-storage and biometric plugins, mocked.
vi.mock('@aparajita/capacitor-secure-storage', () => {
  env.loaded.push('secure-storage');
  let prefix = '';
  return {
    KeychainAccess: { whenUnlockedThisDeviceOnly: 1 },
    SecureStorage: {
      setKeyPrefix: async (value: string) => { prefix = value; env.calls.push(['SecureStorage.setKeyPrefix', value]); },
      setSynchronize: async (value: boolean) => { env.calls.push(['SecureStorage.setSynchronize', value]); },
      setDefaultKeychainAccess: async (value: number) => { env.calls.push(['SecureStorage.setDefaultKeychainAccess', value]); },
      getItem: async (key: string) => env.keychain.get(prefix + key) ?? null,
      setItem: async (key: string, value: string) => { env.keychain.set(prefix + key, value); },
      removeItem: async (key: string) => { env.keychain.delete(prefix + key); },
      clear: async () => { for (const key of [...env.keychain.keys()]) if (key.startsWith(prefix)) env.keychain.delete(key); },
    },
  };
});
vi.mock('@aparajita/capacitor-biometric-auth', () => {
  env.loaded.push('biometric-auth');
  return {
    BiometryType: { none: 0, touchId: 1, faceId: 2, fingerprintAuthentication: 3, faceAuthentication: 4, irisAuthentication: 5 },
    BiometricAuth: {
      checkBiometry: async () => env.biometry,
      authenticate: async (options: unknown) => {
        env.calls.push(['BiometricAuth.authenticate', options]);
        if (env.authError) throw Object.assign(new Error('biometric'), env.authError);
      },
    },
  };
});
vi.mock('@capacitor/browser', () => {
  env.loaded.push('browser');
  return { Browser: { open: async (options: unknown) => { env.calls.push(['Browser.open', options]); } } };
});
vi.mock('@capacitor/camera', () => {
  env.loaded.push('camera');
  return {
    Camera: { getPhoto: async (options: unknown) => { env.calls.push(['Camera.getPhoto', options]); return { base64String: 'QUJD', format: 'png' }; } },
    CameraResultType: { Base64: 'base64' },
    CameraSource: { Prompt: 'PROMPT' },
  };
});
vi.mock('@capacitor/network', () => {
  env.loaded.push('network');
  return {
    Network: {
      getStatus: async () => { env.calls.push(['Network.getStatus']); return { connected: false, connectionType: 'cellular' }; },
      addListener: async (event: string, callback: (status: unknown) => void) => {
        env.calls.push(['Network.addListener', event]);
        callback({ connected: true, connectionType: 'wifi' });
        return { remove: () => env.calls.push(['Network.remove']) };
      },
    },
  };
});
vi.mock('@capacitor/app', () => {
  env.loaded.push('app');
  return {
    App: {
      getLaunchUrl: async () => { env.calls.push(['App.getLaunchUrl']); return { url: 'https://example.invalid/launch' }; },
      addListener: async (event: string, callback?: () => void) => {
        env.calls.push(['App.addListener', event]);
        if (event === 'pause' || event === 'resume') callback?.();
        return { remove: () => env.calls.push(['App.remove']) };
      },
    },
  };
});
import * as native from './native';

const flush = () => new Promise(resolve => setTimeout(resolve, 0));
beforeEach(() => { vi.stubGlobal('__APP_RELEASE__', 'amani@1.0.7+abcdef0'); env.calls = []; env.os = 'ios'; env.authError = null; });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('src/lib/native.ts public API', () => {
  it('exports exactly what it exported before the split, plus PK-DEVICE-01\'s additions', () => {
    expect(Object.keys(native).sort()).toEqual([
      'captureLabPhoto', 'getNetworkStatus', 'isNative', 'onAppUrlOpen', 'onNetworkChange',
      'openExternalUrl', 'platform', 'secureStorage',
      // PK-MINVER-01 additions (src/lib/native/appUpdate.ts), on top of the pre-split API.
      'exitAppOnBackButton', 'getInstalledAppInfo', 'openStoreListing',
      // PK-DEVICE-01
      'INSTALL_MARKER_KEY', 'SECURE_STORAGE_PREFIX', 'authSessionStorage', 'authenticateWithBiometrics',
      'checkBiometrics', 'createAuthSessionStorage', 'onAppLifecycle', 'setScreenshotsBlocked',
    ].sort());
  });

  it('re-exports every runtime export of every module in src/lib/native/', async () => {
    const dir = join(process.cwd(), 'src/lib/native');
    for (const file of readdirSync(dir).filter(f => f.endsWith('.ts') && !f.endsWith('.test.ts'))) {
      const module = await import(`./native/${file.replace(/\.ts$/, '')}`) as Record<string, unknown>;
      for (const [name, value] of Object.entries(module)) expect(native[name as keyof typeof native], `${file}: ${name}`).toBe(value);
    }
  });

  it('nothing outside src/lib/native.ts imports the modules behind it', () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) && !path.includes('src/lib/native')) {
          if (/from\s+['"][^'"]*lib\/native\/|from\s+['"]\.\/native\//.test(readFileSync(path, 'utf8'))) offenders.push(path);
        }
      }
    };
    walk(join(process.cwd(), 'src'));
    expect(offenders).toEqual([]);
  });
});

describe('on web, every function stays off the native plugins', () => {
  beforeEach(() => { env.native = false; });
  afterEach(() => { expect(env.loaded).toEqual([]); });

  it('detects web', () => {
    expect(native.isNative()).toBe(false);
    expect(native.platform()).toBe('web');
  });

  it('openExternalUrl opens a new tab', async () => {
    const open = vi.fn();
    vi.stubGlobal('open', open);
    await native.openExternalUrl('https://example.invalid/terms');
    expect(open).toHaveBeenCalledWith('https://example.invalid/terms', '_blank', 'noopener,noreferrer');
  });

  it('captureLabPhoto reports the camera as unavailable', async () => {
    expect(await native.captureLabPhoto()).toEqual({ ok: false, cancelled: false, error: 'Camera not available on web' });
  });

  it('network status and changes come from the browser', async () => {
    expect(await native.getNetworkStatus()).toEqual({ connected: navigator.onLine, connectionType: 'unknown' });
    const seen: unknown[] = [];
    const stop = native.onNetworkChange(status => seen.push(status));
    window.dispatchEvent(new Event('offline'));
    window.dispatchEvent(new Event('online'));
    stop();
    window.dispatchEvent(new Event('offline'));
    expect(seen).toEqual([{ connected: false, connectionType: 'none' }, { connected: true, connectionType: 'unknown' }]);
  });

  it('onAppUrlOpen is a no-op', async () => {
    const callback = vi.fn();
    native.onAppUrlOpen(callback)();
    await flush();
    expect(callback).not.toHaveBeenCalled();
  });

  it('PK-DEVICE-01: no lock, no secure session storage, no screenshot flag, no lifecycle events', async () => {
    expect(await native.checkBiometrics()).toEqual({ available: false, kind: null, deviceSecure: false });
    expect(await native.authenticateWithBiometrics('Unlock Amani')).toEqual({ ok: false, reason: 'unavailable' });
    expect(await native.setScreenshotsBlocked(true)).toBe(false);
    expect(native.authSessionStorage()).toBeUndefined();
    const handler = vi.fn();
    native.onAppLifecycle({ onPause: handler, onResume: handler })();
    await flush();
    expect(handler).not.toHaveBeenCalled();
  });

  it('secureStorage stays on localStorage, and clear() leaves localStorage alone', async () => {
    await native.secureStorage.set('pk-int-01', 'value');
    expect(localStorage.getItem('pk-int-01')).toBe('value');
    expect(await native.secureStorage.get('pk-int-01')).toBe('value');
    await native.secureStorage.clear();
    expect(await native.secureStorage.get('pk-int-01')).toBe('value');
    await native.secureStorage.remove('pk-int-01');
    expect(await native.secureStorage.get('pk-int-01')).toBeNull();
  });

  it('no plugin module was loaded and no plugin was called', async () => {
    await flush();
    expect(env.loaded).toEqual([]);
    expect(env.calls).toEqual([]);
  });
});

describe('on native, each function reaches its plugin', () => {
  beforeEach(() => { env.native = true; });

  it('detects the platform', () => {
    expect(native.isNative()).toBe(true);
    expect(native.platform()).toBe('ios');
  });

  it('openExternalUrl uses the in-app browser', async () => {
    await native.openExternalUrl('https://example.invalid/terms');
    expect(env.calls).toEqual([['Browser.open', { url: 'https://example.invalid/terms', presentationStyle: 'popover' }]]);
  });

  it('captureLabPhoto returns a data URL from the camera', async () => {
    expect(await native.captureLabPhoto()).toEqual({ ok: true, base64: 'data:image/png;base64,QUJD' });
    expect(env.calls[0]).toEqual(['Camera.getPhoto', { resultType: 'base64', source: 'PROMPT', quality: 85, correctOrientation: true }]);
  });

  it('network status and changes come from the Network plugin', async () => {
    expect(await native.getNetworkStatus()).toEqual({ connected: false, connectionType: 'cellular' });
    const seen: unknown[] = [];
    const stop = native.onNetworkChange(status => seen.push(status));
    await flush();
    stop();
    expect(seen).toEqual([{ connected: true, connectionType: 'wifi' }]);
    expect(env.calls).toEqual([['Network.getStatus'], ['Network.addListener', 'networkStatusChange'], ['Network.remove']]);
  });

  it('onAppUrlOpen drains the launch URL, then listens', async () => {
    const urls: string[] = [];
    const stop = native.onAppUrlOpen(url => urls.push(url));
    await flush();
    stop();
    expect(urls).toEqual(['https://example.invalid/launch']);
    expect(env.calls).toEqual([['App.getLaunchUrl'], ['App.addListener', 'appUrlOpen'], ['App.remove']]);
  });
});

describe('secureStorage', () => {
  it('delegates to localStorage on the web', async () => {
    env.native = false;
    await native.secureStorage.set('pk-int-01', 'value');
    expect(await native.secureStorage.get('pk-int-01')).toBe('value');
    await native.secureStorage.remove('pk-int-01');
    expect(await native.secureStorage.get('pk-int-01')).toBeNull();
  });
});

describe('PK-DEVICE-01 on native', () => {
  beforeEach(() => { env.native = true; localStorage.clear(); env.keychain.clear(); });

  it('secureStorage uses the Keychain plugin under Amani\'s prefix, device-only, never synced, and not localStorage', async () => {
    await native.secureStorage.set('session', 'token');
    expect(env.keychain.get('amani_session')).toBe('token');
    expect(localStorage.getItem('session')).toBeNull();
    expect(await native.secureStorage.get('session')).toBe('token');
    env.keychain.set('other-plugin_item', 'kept');
    await native.secureStorage.clear();
    expect([...env.keychain.entries()]).toEqual([['other-plugin_item', 'kept']]);
    expect(env.calls).toEqual(expect.arrayContaining([
      ['SecureStorage.setKeyPrefix', 'amani_'],
      ['SecureStorage.setSynchronize', false],
      ['SecureStorage.setDefaultKeychainAccess', 1],
    ]));
  });

  it('authSessionStorage is the Keychain-backed session store, one instance per launch', async () => {
    const storage = native.authSessionStorage();
    expect(storage).toBeDefined();
    expect(native.authSessionStorage()).toBe(storage);
    await storage!.setItem('sb-test-auth-token', '{"access_token":"synthetic"}');
    expect(env.keychain.get('amani_sb-test-auth-token')).toBe('{"access_token":"synthetic"}');
    expect(localStorage.getItem('sb-test-auth-token')).toBeNull();
  });

  it('checkBiometrics names Face ID, Touch ID or a fingerprint, and nothing else counts (D15)', async () => {
    env.biometry = { isAvailable: true, biometryType: 2, biometryTypes: [2], deviceIsSecure: true };
    expect(await native.checkBiometrics()).toEqual({ available: true, kind: 'faceId', deviceSecure: true });
    env.biometry = { isAvailable: true, biometryType: 1, biometryTypes: [1], deviceIsSecure: true };
    expect(await native.checkBiometrics()).toEqual({ available: true, kind: 'touchId', deviceSecure: true });
    env.biometry = { isAvailable: true, biometryType: 3, biometryTypes: [4, 3], deviceIsSecure: true };
    expect(await native.checkBiometrics()).toEqual({ available: true, kind: 'fingerprint', deviceSecure: true });
    // Android face unlock alone is not Face ID or a fingerprint.
    env.biometry = { isAvailable: true, biometryType: 4, biometryTypes: [4], deviceIsSecure: true };
    expect(await native.checkBiometrics()).toEqual({ available: false, kind: null, deviceSecure: true });
    env.biometry = { isAvailable: false, biometryType: 0, biometryTypes: [], deviceIsSecure: false };
    expect(await native.checkBiometrics()).toEqual({ available: false, kind: null, deviceSecure: false });
    env.biometry = { isAvailable: true, biometryType: 2, biometryTypes: [2], deviceIsSecure: true };
  });

  it('authenticateWithBiometrics always allows the passcode fallback, and maps errors without throwing', async () => {
    expect(await native.authenticateWithBiometrics('Unlock Amani')).toEqual({ ok: true });
    expect(env.calls[env.calls.length - 1]).toEqual(['BiometricAuth.authenticate', expect.objectContaining({ reason: 'Unlock Amani', allowDeviceCredential: true })]);
    env.authError = { code: 'userCancel' };
    expect(await native.authenticateWithBiometrics('x')).toEqual({ ok: false, reason: 'cancelled' });
    env.authError = { code: 'authenticationFailed' };
    expect(await native.authenticateWithBiometrics('x')).toEqual({ ok: false, reason: 'failed' });
    env.authError = { code: 'biometryLockout' };
    expect(await native.authenticateWithBiometrics('x')).toEqual({ ok: false, reason: 'failed' });
    env.authError = { code: 'passcodeNotSet' };
    expect(await native.authenticateWithBiometrics('x')).toEqual({ ok: false, reason: 'unavailable' });
  });

  it('setScreenshotsBlocked sets and clears FLAG_SECURE through the local AmaniPrivacy plugin on Android only (R15)', async () => {
    expect(await native.setScreenshotsBlocked(true)).toBe(false); // iOS: the splash covers it instead
    expect(env.calls).toEqual([]);
    env.os = 'android';
    expect(await native.setScreenshotsBlocked(true)).toBe(true);
    expect(await native.setScreenshotsBlocked(false)).toBe(true);
    expect(env.calls).toEqual([['AmaniPrivacy.setSecure', { secure: true }], ['AmaniPrivacy.setSecure', { secure: false }]]);
  });

  it('onAppLifecycle listens to pause and resume (not appStateChange), and unsubscribes', async () => {
    const seen: string[] = [];
    const stop = native.onAppLifecycle({ onPause: () => seen.push('pause'), onResume: () => seen.push('resume') });
    await flush();
    stop();
    expect(seen).toEqual(['pause', 'resume']);
    expect(env.calls).toEqual([['App.addListener', 'pause'], ['App.addListener', 'resume'], ['App.remove'], ['App.remove']]);
  });
});
