/** PK-DEVICE-01 is dormant until the native 1.0.7 release (Owner Ruling 10). */
export function isDeviceLockActive(
  native: boolean,
  release: string = typeof __APP_RELEASE__ === 'string' ? __APP_RELEASE__ : '',
): boolean {
  if (!native) return false;
  // Accept only the build's amani@major.minor.patch format, with its optional commit suffix.
  const match = /^amani@(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:\+[a-f0-9]{7})?$/.exec(release);
  if (!match) return false;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  if (![major, minor, patch].every(Number.isSafeInteger)) return false;
  return major > 1 || (major === 1 && (minor > 0 || (minor === 0 && patch >= 7)));
}
