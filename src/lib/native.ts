/**
 * Safe wrappers for Capacitor native APIs.
 *
 * Every function checks Capacitor.isNativePlatform() before calling plugin APIs
 * so the web build always works without any native runtime present.
 *
 * Import from this file, never import Capacitor plugins directly in components.
 *
 * The implementations live in ./native/, one module per plugin (PK-INT-01,
 * owner decision D3). Add native code there, guard it with isNative() from
 * ./native/platform, and re-export it here; this file stays the only import
 * path for the rest of the app.
 */

export { isNative, platform } from './native/platform';
export { openExternalUrl } from './native/browser';
export { captureLabPhoto, type CameraResult } from './native/camera';
export { getNetworkStatus, onNetworkChange, type NetworkStatus } from './native/network';
export { onAppUrlOpen } from './native/app';
export { secureStorage } from './native/secureStorage';
