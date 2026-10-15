// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/*
  PK-MINVER-01: the native side of the update gate. Every call is behind
  Capacitor.isNativePlatform(): on web the App plugin is never loaded, the
  installed version is unknown (null) and nothing navigates.
*/

const env = vi.hoisted(() => ({
  native: false,
  platform: 'ios' as string,
  loaded: [] as string[],
  calls: [] as unknown[][],
  info: { id: 'com.amani.health', name: 'Amani', version: '1.0.6', build: '8' } as unknown,
  infoFails: false,
  backListener: null as null | (() => void),
}));
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => env.native, getPlatform: () => (env.native ? env.platform : 'web') },
}));
vi.mock('@capacitor/app', () => {
  env.loaded.push('app');
  return {
    App: {
      getInfo: async () => {
        env.calls.push(['App.getInfo']);
        if (env.infoFails) throw new Error('synthetic plugin failure');
        return env.info;
      },
      exitApp: async () => { env.calls.push(['App.exitApp']); },
      addListener: async (event: string, callback: () => void) => {
        env.calls.push(['App.addListener', event]);
        env.backListener = callback;
        return { remove: () => env.calls.push(['App.remove', event]) };
      },
    },
  };
});
import { exitAppOnBackButton, getInstalledAppInfo, openStoreListing } from '../native';

const flush = () => new Promise(resolve => setTimeout(resolve, 0));
let assign: ReturnType<typeof vi.fn>;
beforeEach(() => {
  env.calls = [];
  env.infoFails = false;
  env.platform = 'ios';
  env.backListener = null;
  env.info = { id: 'com.amani.health', name: 'Amani', version: '1.0.6', build: '8' };
  assign = vi.fn();
  vi.spyOn(window, 'location', 'get').mockReturnValue({ ...window.location, assign } as Location);
});
afterEach(() => { vi.restoreAllMocks(); });

describe('on web (never gated)', () => {
  beforeEach(() => { env.native = false; });

  it('the installed version is unknown, the store is never opened and back is never held', async () => {
    expect(await getInstalledAppInfo()).toBeNull();
    openStoreListing('https://play.google.com/store/apps/details?id=com.amani.health');
    exitAppOnBackButton()();
    await flush();
    expect(assign).not.toHaveBeenCalled();
    expect(env.loaded).toEqual([]);
    expect(env.calls).toEqual([]);
  });
});

describe('on native', () => {
  beforeEach(() => { env.native = true; });

  it('reads the version and build from App.getInfo, with the platform', async () => {
    expect(await getInstalledAppInfo()).toEqual({ platform: 'ios', version: '1.0.6', build: '8' });
    env.platform = 'android';
    env.info = { version: '1.0.4', build: '7' };
    expect(await getInstalledAppInfo()).toEqual({ platform: 'android', version: '1.0.4', build: '7' });
  });

  it('fails open (null) when the plugin throws or the platform is neither iOS nor Android', async () => {
    env.infoFails = true;
    expect(await getInstalledAppInfo()).toBeNull();
    env.infoFails = false;
    env.platform = 'electron';
    expect(await getInstalledAppInfo()).toBeNull();
  });

  it('opens the store listing by handing the navigation to the OS', () => {
    openStoreListing('https://play.google.com/store/apps/details?id=com.amani.health');
    expect(assign).toHaveBeenCalledWith('https://play.google.com/store/apps/details?id=com.amani.health');
  });

  it('on Android, holds the back button to close the app, and releases it', async () => {
    env.platform = 'android';
    const release = exitAppOnBackButton();
    await flush();
    env.backListener?.();
    await flush();
    release();
    expect(env.calls).toEqual([['App.addListener', 'backButton'], ['App.exitApp'], ['App.remove', 'backButton']]);
  });

  it('a release before the listener is attached still removes it', async () => {
    env.platform = 'android';
    exitAppOnBackButton()();
    await flush();
    expect(env.calls).toEqual([['App.addListener', 'backButton'], ['App.remove', 'backButton']]);
  });

  it('on iOS there is no back button to hold', async () => {
    exitAppOnBackButton()();
    await flush();
    expect(env.calls).toEqual([]);
  });
});
