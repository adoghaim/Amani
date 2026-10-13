/**
 * App version comparison for the native minimum-version gate (PK-MINVER-01;
 * owner decisions EXP-8, R1, D8).
 *
 * Pure: no Capacitor, no DOM, no network. The update gate
 * (src/components/UpdateGate.tsx) asks `decideUpdate` what to show, given the
 * installed version from App.getInfo() and the runtime config's
 * min_version_<platform> / latest_version_<platform>.
 *
 * Versions are "MAJOR", "MAJOR.MINOR" or "MAJOR.MINOR.PATCH" of plain decimal
 * digits, the same shape app_public_config accepts; missing parts count as 0,
 * so "2" equals "2.0.0". A build number (Android versionCode, iOS
 * CFBundleVersion) is an optional tie-breaker: it decides only when both sides
 * carry one and the versions are equal. The runtime config holds versions only,
 * so today a build never decides a gate; the comparison is ready for it.
 *
 * Every malformed input fails OPEN: an installed version or a minimum that
 * cannot be read never blocks her, and a latest version that cannot be read
 * never shows the banner.
 */

export interface AppVersion {
  /** [major, minor, patch]. */
  readonly parts: readonly [number, number, number];
  /** The build number, or null when there is none or it is not a plain integer. */
  readonly build: number | null;
}

const VERSION = /^[0-9]+(?:\.[0-9]+){0,2}$/;
const BUILD = /^[0-9]+$/;

function toInteger(digits: string): number | null {
  const value = Number(digits);
  return Number.isSafeInteger(value) ? value : null;
}

/**
 * Reads a version and an optional build. Returns null for anything that is not
 * exactly the documented shape (a leading "v", a pre-release suffix, spaces, a
 * fourth part, an empty string, a non-string, digits too long to compare).
 * A malformed build is dropped (null), never fatal: the version still counts.
 */
export function parseAppVersion(version: unknown, build?: unknown): AppVersion | null {
  if (typeof version !== 'string' || !VERSION.test(version)) return null;
  const numbers = version.split('.').map(toInteger);
  if (numbers.some(part => part === null)) return null;
  const [major = 0, minor = 0, patch = 0] = numbers as number[];
  const buildNumber = typeof build === 'string' && BUILD.test(build)
    ? toInteger(build)
    : typeof build === 'number' && Number.isSafeInteger(build) && build >= 0
      ? build
      : null;
  return Object.freeze({ parts: Object.freeze([major, minor, patch] as const), build: buildNumber });
}

/** -1 when a is older than b, 1 when newer, 0 when they count as the same release. */
export function compareAppVersions(a: AppVersion, b: AppVersion): -1 | 0 | 1 {
  for (let index = 0; index < 3; index += 1) {
    const left = a.parts[index] ?? 0;
    const right = b.parts[index] ?? 0;
    if (left !== right) return left < right ? -1 : 1;
  }
  if (a.build !== null && b.build !== null && a.build !== b.build) return a.build < b.build ? -1 : 1;
  return 0;
}

export interface InstalledApp {
  /** App.getInfo().version: the marketing version, for example "1.0.6". */
  readonly version: string;
  /** App.getInfo().build: the build number, for example "8". */
  readonly build: string;
}

export type UpdateDecision =
  /** No gate and no banner. */
  | { readonly kind: 'none' }
  /** Below the minimum: the full-screen update block. */
  | { readonly kind: 'required' }
  /** At or above the minimum, and a newer version is out: the dismissible banner. */
  | { readonly kind: 'available'; readonly latest: string };

export const NO_UPDATE: UpdateDecision = Object.freeze({ kind: 'none' });

/**
 * What the update gate shows. The block wins over the banner; null or
 * malformed config, or an installed version that cannot be read, is 'none'.
 */
export function decideUpdate(input: {
  installed: InstalledApp | null;
  minVersion: string | null;
  latestVersion: string | null;
}): UpdateDecision {
  if (!input.installed) return NO_UPDATE;
  const installed = parseAppVersion(input.installed.version, input.installed.build);
  if (!installed) return NO_UPDATE;

  const minimum = parseAppVersion(input.minVersion);
  if (minimum && compareAppVersions(installed, minimum) < 0) return Object.freeze({ kind: 'required' });

  const latest = parseAppVersion(input.latestVersion);
  if (latest && input.latestVersion && compareAppVersions(installed, latest) < 0) {
    return Object.freeze({ kind: 'available', latest: input.latestVersion });
  }
  return NO_UPDATE;
}
