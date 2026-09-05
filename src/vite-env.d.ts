/// <reference types="vite/client" />

/**
 * Build identifier (`amani@1.0.4+abc1234`), injected by `define` in
 * vite.config.ts and stamped onto Sentry events as the release.
 */
declare const __APP_RELEASE__: string;
