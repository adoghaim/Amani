import { describe, expect, it } from 'vitest';
import { createDeviceLock, LOCK_SETTINGS_STORAGE_KEY } from './lockController';
import { exposePrivacyCoverReady, PRIVACY_COVER_READY } from './privacyCover';

/* Review F002 (iOS): the function AppDelegate awaits before removing its cover. */

function setup() {
  const local = new Map([[LOCK_SETTINGS_STORAGE_KEY, JSON.stringify({ enabled: true, relockAfter: '1m' })]]);
  const clock = { now: 1_000_000 };
  const lock = createDeviceLock({
    isNative: () => true,
    flagOn: async () => true,
    checkBiometrics: async () => ({ available: true, kind: 'faceId', deviceSecure: true }),
    authenticate: async () => ({ ok: true }),
    setScreenshotsBlocked: async () => {},
    storage: () => ({ getItem: key => local.get(key) ?? null, setItem: (key, value) => { local.set(key, value); } }),
    now: () => clock.now,
  });
  const frames: Array<() => void> = [];
  const target: Record<string, unknown> = {};
  const stop = exposePrivacyCoverReady(target, lock, callback => { frames.push(callback); });
  const ready = () => (target[PRIVACY_COVER_READY] as () => Promise<true>)();
  const drawFrame = () => { frames.shift()?.(); };
  return { lock, clock, target, stop, ready, frames, drawFrame };
}

async function isSettled(promise: Promise<unknown>) {
  let done = false;
  void promise.then(() => { done = true; });
  await Promise.resolve();
  await Promise.resolve();
  return done;
}

describe('exposePrivacyCoverReady', () => {
  it('while covered, resolves only after resume has decided and two frames are drawn', async () => {
    const { lock, clock, ready, frames, drawFrame } = setup();
    await lock.unlock();
    lock.pause();
    const waiting = ready();
    expect(frames).toHaveLength(0);
    expect(await isSettled(waiting)).toBe(false);
    clock.now += 60_000;
    lock.resume();
    expect(lock.getState()).toMatchObject({ covered: false, locked: true });
    drawFrame();
    expect(await isSettled(waiting)).toBe(false);
    drawFrame();
    expect(await waiting).toBe(true);
  });

  it('not covered: resolves after two frames', async () => {
    const { ready, drawFrame } = setup();
    const waiting = ready();
    drawFrame();
    drawFrame();
    expect(await waiting).toBe(true);
  });

  it('removing it deletes the function', () => {
    const { target, stop } = setup();
    expect(typeof target[PRIVACY_COVER_READY]).toBe('function');
    stop();
    expect(target[PRIVACY_COVER_READY]).toBeUndefined();
  });
});
