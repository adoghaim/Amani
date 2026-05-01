import React from 'react'

const RELOAD_KEY = 'amani:chunk-reload-attempted'

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
    try {
      const mod = await factory()
      sessionStorage.removeItem(RELOAD_KEY)
      return mod
    } catch (err) {
      const alreadyTried = sessionStorage.getItem(RELOAD_KEY) === '1'
      if (!import.meta.env.PROD || alreadyTried) throw err
      sessionStorage.setItem(RELOAD_KEY, '1')
      window.location.reload()
      throw err
    }
  })
}
