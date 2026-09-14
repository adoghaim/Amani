import * as Sentry from '@sentry/react';
import { scrubBreadcrumb, scrubEvent } from './scrub';

/*
  The only place Sentry is configured.

  Deliberately inert when VITE_SENTRY_DSN is unset — the current production
  state, and the normal one for local dev and Netlify deploy previews. Without
  a DSN `Sentry.init` is never called, so no client is bound, no transport is
  created, and nothing is queued: Sentry's capture APIs are no-ops until a
  client exists. Call sites (ErrorBoundary, the unhandledrejection listener in
  main.tsx) therefore need no guard of their own.

  `vite.config.ts` builds with `sourcemap: 'hidden'` — maps emitted but not
  referenced from the bundle — so stack traces can be symbolicated by upload
  without publishing sources. `release` below is what ties a trace to a build.
  Do not change either without the other.
*/

/** True when a DSN is configured, i.e. when `initErrorMonitoring` will init. */
export function isErrorMonitoringConfigured(dsn: unknown): dsn is string {
  return typeof dsn === 'string' && dsn.trim().length > 0;
}

/**
 * Sentry options, split out so the privacy-relevant flags are readable in one
 * place and assertable in tests.
 */
export function buildSentryOptions(
  dsn: string,
  environment: string,
  release: string,
): Sentry.BrowserOptions {
  return {
    dsn,
    environment,
    /*
      Stamps every event with the build that produced it, so a minified frame
      resolves against the right uploaded source map. Without this, two
      deploys of the same code are indistinguishable and traces mis-map.
    */
    release,

    /*
      Errors only. No tracing, and deliberately no Session Replay: this app
      renders lab results on screen, so recording the DOM would ship PHI.
    */
    tracesSampleRate: 0,

    /*
      Keeps the SDK from attaching the user's IP address and other request
      details it would otherwise infer. It is the default in v10; set
      explicitly because it is a promise made in the privacy policy.
    */
    sendDefaultPii: false,

    /*
      Merged with the defaults; a same-named integration replaces the default.
      Console breadcrumbs are off because the app logs parsed lab-report text
      (see pdfExtractor), which must not leave the device. DOM breadcrumbs stay
      on — they are how you tell what the user was doing — but their attribute
      values are redacted in beforeBreadcrumb, because Sentry has no option for
      that. See scrub.ts.
    */
    integrations: [Sentry.breadcrumbsIntegration({ console: false })],

    /*
      Noise from code Amani did not ship and cannot fix. Browser extensions
      inject into the page and their throws surface as our errors.
    */
    denyUrls: [
      /^chrome:\/\//i,
      /^chrome-extension:\/\//i,
      /^moz-extension:\/\//i,
      /^safari-(?:web-)?extension:\/\//i,
      /extensions\//i,
    ],

    beforeSend(event) {
      scrubEvent(event);
      return event;
    },

    /*
      Breadcrumbs are scrubbed here as well as in beforeSend. beforeSend alone
      would be enough for what is attached to an event, but scrubbing on the
      way in means unscrubbed values never sit in the in-memory buffer either.
    */
    beforeBreadcrumb(breadcrumb) {
      return scrubBreadcrumb(breadcrumb) ? breadcrumb : null;
    },
  };
}

/**
 * Initialise error monitoring, or do nothing at all when no DSN is set.
 */
export function initErrorMonitoring(): void {
  const dsn = import.meta.env.VITE_SENTRY_DSN;
  if (!isErrorMonitoringConfigured(dsn)) return;

  Sentry.init(buildSentryOptions(dsn, import.meta.env.MODE, __APP_RELEASE__));
}
