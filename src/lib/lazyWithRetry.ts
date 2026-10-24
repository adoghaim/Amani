import React from 'react'

const RELOAD_KEY = 'amani:chunk-reload-attempted'

/** The page reload, as a property so tests can watch it. */
export const pageReload = { reload: () => window.location.reload() }

const chunkLoadErrors = new WeakSet<object>()

/**
 * The error is a lazy route's code failing to load. React.lazy keeps that
 * rejection for the rest of the page's life, so only a reload can try again.
 */
export function isChunkLoadError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && chunkLoadErrors.has(error)
}

// Session storage can throw on any access (site data blocked). Without the
// flag we cannot know the reload already happened, so we never reload: one
// that could repeat forever is worse than the error screen.
function claimReload(): boolean {
  try {
    if (sessionStorage.getItem(RELOAD_KEY) === '1') return false
    sessionStorage.setItem(RELOAD_KEY, '1')
    return true
  } catch {
    return false
  }
}

// Wrap React.lazy so a single chunk-load failure (e.g. user has the old
// bundle and a deploy just shipped new chunk hashes) triggers one
// page reload instead of a permanent stuck-Suspense state. The
// session-storage flag prevents an infinite reload loop if the failure
// is real. In dev we never reload — surface the error so it's visible.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazyWithRetry<T extends React.ComponentType<any>>(
  factory: () => Promise<{ default: T }>,
): React.LazyExoticComponent<T> {
  return React.lazy(async () => {
    let mod: { default: T }
    try {
      mod = await factory()
    } catch (err) {
      if (typeof err === 'object' && err !== null) chunkLoadErrors.add(err)
      if (import.meta.env.PROD && claimReload()) pageReload.reload()
      throw err
    }
    try {
      sessionStorage.removeItem(RELOAD_KEY)
    } catch {
      // Storage blocked: there is no flag to clear.
    }
    return mod
  })
}
