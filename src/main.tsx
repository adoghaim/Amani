import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import * as Sentry from '@sentry/react';
import { AuthProvider } from './contexts/AuthContext';
import App from './App.tsx';
import './index.css';

/**
 * Drop the query string and fragment from a URL.
 *
 * Supabase runs with `detectSessionInUrl`, so auth callbacks land with an
 * `access_token` in the hash and PKCE `code` in the query. Those must never
 * reach a third-party error sink. Report IDs in the path are kept — they are
 * what makes a report reproducible.
 */
function stripUrlSecrets(url: string): string {
  const cut = url.search(/[?#]/);
  return cut === -1 ? url : url.slice(0, cut);
}

/*
  Error monitoring.

  Deliberately inert when VITE_SENTRY_DSN is unset — the normal state for local
  dev and Netlify deploy previews. Sentry's capture APIs are no-ops until
  `init()` binds a client, so call sites (ErrorBoundary, the listener below)
  need no guard of their own and nothing breaks or spams without a DSN.

  Note: `vite.config.ts` already builds with `sourcemap: 'hidden'`, which emits
  maps without referencing them from the bundle — exactly what Sentry wants.
  Do not change it.
*/
const sentryDsn = import.meta.env.VITE_SENTRY_DSN;
if (sentryDsn) {
  Sentry.init({
    dsn: sentryDsn,
    environment: import.meta.env.MODE,
    // Errors only. No tracing, and deliberately no Session Replay: this app
    // renders lab results on screen, so recording the DOM would ship PHI.
    tracesSampleRate: 0,
    sendDefaultPii: false,
    // Merged with the defaults; a same-named integration replaces the default
    // one. Console breadcrumbs are off because the app logs parsed lab-report
    // text (see pdfExtractor), which must not leave the device.
    integrations: [Sentry.breadcrumbsIntegration({ console: false })],
    beforeSend(event) {
      if (event.request?.url) {
        event.request.url = stripUrlSecrets(event.request.url);
      }
      for (const crumb of event.breadcrumbs ?? []) {
        const data = crumb.data;
        if (!data) continue;
        if (typeof data.url === 'string') data.url = stripUrlSecrets(data.url);
        if (typeof data.to === 'string') data.to = stripUrlSecrets(data.to);
        if (typeof data.from === 'string') data.from = stripUrlSecrets(data.from);
      }
      return event;
    },
  });
}

/*
  A React error boundary only catches render-phase errors. Amani's whole
  pipeline — upload, parse, score, interpret — is async, so a rejected promise
  that nobody awaits would otherwise vanish without a trace, and on Capacitor
  "without a trace" means a device log nobody reads.

  Sentry's `globalHandlersIntegration` (on by default) reports these to Sentry
  once a DSN is configured; this listener guarantees a console signal in the
  builds where Sentry is intentionally off.
*/
window.addEventListener('unhandledrejection', (event) => {
  console.error('[unhandledrejection]', event.reason);
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </StrictMode>
);
