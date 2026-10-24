import type { DeviceLockController } from './lockController';

/**
 * Review F002 (iOS): AppDelegate keeps the launch-screen cover up after a
 * return from the background until this function, which it calls on the page
 * with callAsyncJavaScript, resolves. It resolves once the lock has decided
 * (the JS cover is gone: either the lock screen or the app is showing) and two
 * frames have been drawn, so the last page she saw is never what shows first.
 * AppDelegate removes its cover anyway after a short fallback delay, so a
 * missing or stuck page can never keep the splash up.
 */
export const PRIVACY_COVER_READY = 'amaniPrivacyCoverReady';

type Frame = (callback: () => void) => void;

const nextFrame: Frame = callback => {
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => callback());
  else setTimeout(callback, 16);
};

/** Defines `window.amaniPrivacyCoverReady`. Returns a function that removes it. */
export function exposePrivacyCoverReady(
  target: object,
  lock: Pick<DeviceLockController, 'getState' | 'subscribe'>,
  frame: Frame = nextFrame,
): () => void {
  const slot = target as Record<string, unknown>;
  const ready = () => new Promise<true>(resolve => {
    const drawn = () => frame(() => frame(() => resolve(true)));
    if (!lock.getState().covered) {
      drawn();
      return;
    }
    const stop = lock.subscribe(() => {
      if (lock.getState().covered) return;
      stop();
      drawn();
    });
  });
  slot[PRIVACY_COVER_READY] = ready;
  return () => {
    if (slot[PRIVACY_COVER_READY] === ready) delete slot[PRIVACY_COVER_READY];
  };
}
