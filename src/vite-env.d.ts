/// <reference types="vite/client" />

/**
 * Build identifier (`amani@1.0.4+abc1234`), injected by `define` in
 * vite.config.ts and stamped onto Sentry events as the release.
 */
declare const __APP_RELEASE__: string;

interface ImportMetaEnv {
  /** GA4 measurement ID (e.g. G-XXXX). Unset = analytics off. */
  readonly VITE_GA4_ID?: string
}

/** URL of the file after it was lowered to the build target; see `loweredUrlAsset` in vite.config.ts. */
declare module '*?lowered-url' {
  const src: string;
  export default src;
}
