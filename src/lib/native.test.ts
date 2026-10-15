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

const env = vi.hoisted(() => ({ native: false, loaded: [] as string[], calls: [] as unknown[][] }));
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => env.native, getPlatform: () => (env.native ? 'ios' : 'web') },
}));
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
      addListener: async (event: string) => {
        env.calls.push(['App.addListener', event]);
        return { remove: () => env.calls.push(['App.remove']) };
      },
    },
  };
});
import * as native from './native';

const flush = () => new Promise(resolve => setTimeout(resolve, 0));
beforeEach(() => { env.calls = []; });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('src/lib/native.ts public API', () => {
  it('exports exactly what it exported before the split', () => {
    expect(Object.keys(native).sort()).toEqual([
      'captureLabPhoto', 'getNetworkStatus', 'isNative', 'onAppUrlOpen', 'onNetworkChange',
      'openExternalUrl', 'platform', 'secureStorage',
    ]);
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
  it('delegates to localStorage', async () => {
    await native.secureStorage.set('pk-int-01', 'value');
    expect(await native.secureStorage.get('pk-int-01')).toBe('value');
    await native.secureStorage.remove('pk-int-01');
    expect(await native.secureStorage.get('pk-int-01')).toBeNull();
  });
});
