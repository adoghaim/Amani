import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AuthProvider } from './contexts/AuthContext';
import { initErrorMonitoring } from './lib/observability/initSentry';
import App from './App.tsx';
import './index.css';

/*
  Error monitoring. Configured entirely in src/lib/observability/ — including
  the PHI scrubbing that every outbound event passes through — and a complete
  no-op unless VITE_SENTRY_DSN is set, which it is not in production today.
*/
initErrorMonitoring();

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
