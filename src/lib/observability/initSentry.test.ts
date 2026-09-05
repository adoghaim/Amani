import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScrubbableBreadcrumb, ScrubbableEvent } from './scrub';

/*
  The Sentry SDK is replaced wholesale. Two reasons: the assertion that matters
  most here is "init is never called without a DSN", which needs a spy; and the
  vitest environment is `node`, so the real browser package has no business
  being loaded.
*/
const { initSpy, breadcrumbsIntegrationSpy } = vi.hoisted(() => ({
  initSpy: vi.fn(),
  breadcrumbsIntegrationSpy: vi.fn(() => ({ name: 'Breadcrumbs' })),
}));

vi.mock('@sentry/react', () => ({
  init: initSpy,
  breadcrumbsIntegration: breadcrumbsIntegrationSpy,
}));

const {
  buildSentryOptions,
  initErrorMonitoring,
  isErrorMonitoringConfigured,
} = await import('./initSentry');

const REPORT_ID = '3f9a1c2e-7b4d-4e8a-9f01-2c5d6e7a8b90';

beforeEach(() => {
  vi.stubGlobal('__APP_RELEASE__', 'amani@1.0.4+abc1234');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  initSpy.mockClear();
});

describe('isErrorMonitoringConfigured', () => {
  it('treats an absent, empty or whitespace DSN as unconfigured', () => {
    expect(isErrorMonitoringConfigured(undefined)).toBe(false);
    expect(isErrorMonitoringConfigured('')).toBe(false);
    expect(isErrorMonitoringConfigured('   ')).toBe(false);
  });

  it('treats a non-empty DSN as configured', () => {
    expect(isErrorMonitoringConfigured('https://k@o.ingest.sentry.io/1')).toBe(true);
  });
});

/*
  The current production state: VITE_SENTRY_DSN is unset. This must stay a
  genuine no-op — Sentry.init is never reached, so no client is bound, no
  transport is created, and the capture APIs stay inert no-ops.
*/
describe('initErrorMonitoring without a DSN', () => {
  it('does not initialise and does not throw', () => {
    vi.stubEnv('VITE_SENTRY_DSN', '');

    expect(() => initErrorMonitoring()).not.toThrow();
    expect(initSpy).not.toHaveBeenCalled();
  });

  it('does not initialise when the DSN is whitespace only', () => {
    vi.stubEnv('VITE_SENTRY_DSN', '  ');

    initErrorMonitoring();
    expect(initSpy).not.toHaveBeenCalled();
  });
});

describe('initErrorMonitoring with a DSN', () => {
  it('initialises exactly once, stamped with the release', () => {
    vi.stubEnv('VITE_SENTRY_DSN', 'https://key@o0.ingest.sentry.io/1');

    initErrorMonitoring();

    expect(initSpy).toHaveBeenCalledTimes(1);
    expect(initSpy.mock.calls[0]?.[0]).toMatchObject({
      dsn: 'https://key@o0.ingest.sentry.io/1',
      release: 'amani@1.0.4+abc1234',
    });
  });
});

describe('buildSentryOptions', () => {
  const options = () =>
    buildSentryOptions('https://key@o0.ingest.sentry.io/1', 'production', 'amani@1.0.4');

  it('disables tracing, PII and replay', () => {
    const built = options();

    expect(built.tracesSampleRate).toBe(0);
    expect(built.sendDefaultPii).toBe(false);
    /* Session Replay would record lab results rendered on screen. */
    expect(JSON.stringify(built.integrations)).not.toContain('Replay');
  });

  it('turns console breadcrumbs off', () => {
    options();
    expect(breadcrumbsIntegrationSpy).toHaveBeenCalledWith({ console: false });
  });

  it('denies browser-extension noise', () => {
    const denyUrls = options().denyUrls ?? [];
    const matches = (url: string) =>
      denyUrls.some((rule) => rule instanceof RegExp && rule.test(url));

    expect(matches('chrome-extension://abcdef/inject.js')).toBe(true);
    expect(matches('moz-extension://abcdef/inject.js')).toBe(true);
    expect(matches('https://amanibiometrics.com/assets/index-DkH2xY9a.js')).toBe(false);
  });

  /* Proves the scrubber is actually wired to the hooks, not merely exported. */
  it('routes events through the scrubber', () => {
    const beforeSend = options().beforeSend as unknown as (
      event: ScrubbableEvent,
    ) => ScrubbableEvent | null;

    const result = beforeSend({
      message: `report ${REPORT_ID} for jane@example.com`,
      user: { email: 'jane@example.com' },
    });

    expect(result?.message).toBe('report [id] for [email]');
    expect(result?.user).toBeUndefined();
  });

  it('routes breadcrumbs through the scrubber', () => {
    const beforeBreadcrumb = options().beforeBreadcrumb as unknown as (
      crumb: ScrubbableBreadcrumb,
    ) => ScrubbableBreadcrumb | null;

    expect(
      beforeBreadcrumb({ category: 'console', message: 'Ferritin 12 ng/mL' }),
    ).toBeNull();

    expect(
      beforeBreadcrumb({
        category: 'ui.click',
        message: 'svg[aria-label="Cycle day 21 of 28, luteal phase"]',
      })?.message,
    ).toBe('svg[aria-label]');
  });
});
