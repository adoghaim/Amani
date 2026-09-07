/*
  Page-scroll lock for overlays.

  Lives apart from `Modal` so the component file exports only a component —
  react-refresh cannot fast-refresh a module that mixes the two — and so the
  full-screen overlays in Reports and Tracker can take the same lock without
  duplicating the counting.
*/

import { useEffect } from 'react';

/*
  Locks are counted rather than boolean. Two overlays can legitimately be open
  at once (a confirm inside a sheet), and a naive lock would restore the page as
  soon as the inner one closed, dumping the user back to the top of the list.
*/
let lockCount = 0;
let restoreScrollY = 0;

function lockBodyScroll() {
  if (lockCount === 0) {
    restoreScrollY = window.scrollY;
    /*
      position:fixed rather than overflow:hidden. iOS ignores overflow:hidden on
      body for touch scrolling, and Capacitor ships a WebView on both platforms,
      so the stricter approach is the portable one. The negative top preserves
      the reading position, which overflow:hidden would also have done and
      position:fixed alone would not.
    */
    document.body.style.position = 'fixed';
    document.body.style.top = `-${restoreScrollY}px`;
    document.body.style.left = '0';
    document.body.style.right = '0';
    document.body.style.width = '100%';
  }
  lockCount += 1;
}

function unlockBodyScroll() {
  lockCount = Math.max(0, lockCount - 1);
  if (lockCount === 0) {
    document.body.style.position = '';
    document.body.style.top = '';
    document.body.style.left = '';
    document.body.style.right = '';
    document.body.style.width = '';
    window.scrollTo(0, restoreScrollY);
  }
}

/** Locks page scrolling for as long as the caller passes `active`. */
export function useBodyScrollLock(active: boolean) {
  useEffect(() => {
    if (!active) return;
    lockBodyScroll();
    return unlockBodyScroll;
  }, [active]);
}
