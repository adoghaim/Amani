/*
  The open sheets, innermost last, so the Android back button can close the top
  one before it navigates (review F067). Without it, back on /app with a sheet
  open exited the app and discarded her entry, and on other routes it navigated
  away underneath the sheet.

  Pure module state with no React or Capacitor in it: `Modal` registers its
  close handler while it is open, and the app's back handler asks this first.
*/

const stack: Array<{ close: () => void }> = [];

/** Registers an open sheet. Returns the function that removes it. */
export function registerOverlay(close: () => void): () => void {
  const entry = { close };
  stack.push(entry);
  return () => {
    const index = stack.indexOf(entry);
    if (index !== -1) stack.splice(index, 1);
  };
}

/** Closes the top sheet. Returns false, doing nothing, when none is open. */
export function closeTopOverlay(): boolean {
  const top = stack[stack.length - 1];
  if (!top) return false;
  top.close();
  return true;
}
