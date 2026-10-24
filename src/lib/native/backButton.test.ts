// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

/*
  Review F067. The Android back listener lived in App.tsx and stored its handle
  only after addListener resolved, with no cancel guard and no catch: cleaning
  up first (a route change, StrictMode's second effect run) left the listener
  live, so one press ran two handlers and navigated back twice. onNetworkChange
  had the same leak. Both go through the `cancelled` pattern app.ts uses.
*/

const env = vi.hoisted(() => ({
  native: true,
  calls: [] as string[],
  /** Listeners in the order they were attached, by event. */
  listeners: [] as { event: string; callback: (payload: Record<string, unknown>) => void; removed: boolean }[],
  /** Holds addListener open until released, to model a release mid-attach. */
  gate: null as null | Promise<void>,
  addFails: false,
}));
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => env.native, getPlatform: () => 'android' },
}));
function addListener(plugin: string) {
  return async (event: string, callback: (payload: Record<string, unknown>) => void) => {
    env.calls.push(`${plugin}.addListener ${event}`);
    if (env.gate) await env.gate;
    if (env.addFails) throw new Error('synthetic plugin failure');
    const entry = { event, callback, removed: false };
    env.listeners.push(entry);
    return { remove: () => { entry.removed = true; env.calls.push(`${plugin}.remove ${event}`); } };
  };
}
vi.mock('@capacitor/app', () => ({
  App: { addListener: addListener('App'), exitApp: async () => { env.calls.push('App.exitApp'); } },
}));
vi.mock('@capacitor/network', () => ({ Network: { addListener: addListener('Network'), getStatus: async () => ({}) } }));
import { onBackButton, onNetworkChange } from '../native';

// The first dynamic import of a mocked module takes more than one macrotask.
const flush = async () => { for (let i = 0; i < 10; i++) await new Promise(resolve => setTimeout(resolve, 0)); };
const live = (event: string) => env.listeners.filter(l => l.event === event && !l.removed);
beforeEach(() => {
  env.native = true;
  env.calls = [];
  env.listeners = [];
  env.gate = null;
  env.addFails = false;
});

describe('onBackButton', () => {
  it('is a no-op on the web: the plugin is never touched', async () => {
    env.native = false;
    const stop = onBackButton(() => {});
    await flush();
    stop();
    expect(env.calls).toEqual([]);
  });

  it('hands the handler canGoBack and an exitApp that closes the app', async () => {
    const handler = vi.fn();
    onBackButton(handler);
    await flush();
    live('backButton')[0]!.callback({ canGoBack: true });
    expect(handler).toHaveBeenCalledOnce();
    const event = handler.mock.calls[0]![0] as { canGoBack: boolean; exitApp: () => void };
    expect(event.canGoBack).toBe(true);
    expect(env.calls).not.toContain('App.exitApp');
    event.exitApp();
    expect(env.calls).toContain('App.exitApp');
  });

  it('removes the listener on release', async () => {
    const stop = onBackButton(() => {});
    await flush();
    expect(live('backButton')).toHaveLength(1);
    stop();
    expect(live('backButton')).toHaveLength(0);
  });

  it('a release before the plugin finished attaching still removes the listener', async () => {
    let open!: () => void;
    env.gate = new Promise<void>(resolve => { open = resolve; });
    const stop = onBackButton(() => {});
    await flush();
    stop();
    open();
    await flush();
    expect(env.listeners).toHaveLength(1);
    expect(live('backButton')).toHaveLength(0);
  });

  it('a release before the module loaded never attaches at all', async () => {
    onBackButton(() => {})();
    await flush();
    expect(env.calls).toEqual([]);
  });

  it('mount, cleanup, mount (StrictMode\'s double run) leaves exactly one live listener', async () => {
    // Warm the mocked module first: two imports racing before it is cached is a harness artifact.
    onBackButton(() => {})();
    await flush();
    let open!: () => void;
    env.gate = new Promise<void>(resolve => { open = resolve; });
    const first = onBackButton(() => {});
    await flush();
    first();
    onBackButton(() => {});
    await flush();
    open();
    await flush();
    expect(env.listeners).toHaveLength(2);
    expect(live('backButton')).toHaveLength(1);
  });

  it('a plugin failure is swallowed, not an unhandled rejection', async () => {
    env.addFails = true;
    const stop = onBackButton(() => {});
    await flush();
    expect(() => stop()).not.toThrow();
  });
});

describe('onNetworkChange (native)', () => {
  it('forwards a status change and removes the listener on release', async () => {
    const callback = vi.fn();
    const stop = onNetworkChange(callback);
    await flush();
    live('networkStatusChange')[0]!.callback({ connected: false, connectionType: 'none' });
    expect(callback).toHaveBeenCalledWith({ connected: false, connectionType: 'none' });
    stop();
    expect(live('networkStatusChange')).toHaveLength(0);
  });

  it('a release before the plugin finished attaching still removes the listener', async () => {
    let open!: () => void;
    env.gate = new Promise<void>(resolve => { open = resolve; });
    const stop = onNetworkChange(() => {});
    await flush();
    stop();
    open();
    await flush();
    expect(env.listeners).toHaveLength(1);
    expect(live('networkStatusChange')).toHaveLength(0);
  });

  it('a plugin failure is swallowed, not an unhandled rejection', async () => {
    env.addFails = true;
    const stop = onNetworkChange(() => {});
    await flush();
    expect(() => stop()).not.toThrow();
  });
});
