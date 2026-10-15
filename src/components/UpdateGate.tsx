import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Info } from 'lucide-react';
import { FullScreenGate } from './FullScreenGate';
import { CalmNotice } from './CalmNotice';
import { Button } from './Button';
import {
  exitAppOnBackButton, getInstalledAppInfo, getNetworkStatus, isNative, onNetworkChange, openStoreListing,
  type InstalledAppInfo, type NetworkStatus,
} from '../lib/native';
import { latestVersion, loadRuntimeConfig, minVersion, type RuntimePlatform } from '../lib/runtimeConfig';
import { decideUpdate } from '../lib/appVersion';
import { storeListingUrl, storeName, type StorePlatform } from '../lib/storeListing';

/**
 * The native minimum-version gate (PK-MINVER-01; owner decisions EXP-8, R1,
 * D8, D23, D24).
 *
 * At native launch it compares the installed version (App.getInfo) with
 * min_version_<platform> and latest_version_<platform> from app_public_config:
 *
 * - below the minimum: the update block, a FullScreenGate rendered in place of
 *   the whole app, so nothing behind it is in the document or reachable.
 *   "Please update Amani", one sentence, one store button. Offline, it becomes
 *   "Connect to the internet to update" with Retry. Android's back button
 *   closes the app while the block is up (its defined back behaviour, D23).
 * - at or above the minimum with a newer version out: a dismissible banner
 *   above the app, announced politely. Dismissing it hides it for that
 *   version on this phone.
 * - otherwise: nothing.
 *
 * The web app is never gated: on web this renders its children and calls
 * nothing. It fails OPEN: until the launch read and App.getInfo have both
 * answered, and whenever either fails or returns something malformed, the
 * app renders normally (the runtime config is never read again this launch).
 *
 * Gate order at launch (D8 restated in the design review): this block first,
 * then the biometric lock when she has turned it on, then consent, then the
 * rest of onboarding. Mount the lock inside this gate, never above it.
 */

export interface UpdateGateDeps {
  isNative(): boolean;
  getInstalledAppInfo(): Promise<InstalledAppInfo | null>;
  loadRuntimeConfig(): Promise<void>;
  minVersion(platform: RuntimePlatform): string | null;
  latestVersion(platform: RuntimePlatform): string | null;
  getNetworkStatus(): Promise<NetworkStatus>;
  onNetworkChange(callback: (status: NetworkStatus) => void): () => void;
  openStoreListing(url: string): void;
  exitAppOnBackButton(): () => void;
  /** localStorage, or null. May throw on access. */
  storage(): Pick<Storage, 'getItem' | 'setItem'> | null;
}

export const UPDATE_BANNER_DISMISSED_KEY = 'amani.update-banner.dismissed';

const defaultDeps: UpdateGateDeps = {
  isNative,
  getInstalledAppInfo,
  loadRuntimeConfig,
  minVersion,
  latestVersion,
  getNetworkStatus,
  onNetworkChange,
  openStoreListing,
  exitAppOnBackButton,
  storage: () => (typeof window === 'undefined' ? null : window.localStorage),
};

type GateState =
  | { kind: 'clear' }
  | { kind: 'required'; platform: StorePlatform }
  | { kind: 'available'; platform: StorePlatform; latest: string };

const CLEAR: GateState = { kind: 'clear' };

function readDismissed(deps: UpdateGateDeps): string | null {
  try {
    return deps.storage()?.getItem(UPDATE_BANNER_DISMISSED_KEY) ?? null;
  } catch {
    return null;
  }
}

function rememberDismissed(deps: UpdateGateDeps, version: string) {
  try {
    deps.storage()?.setItem(UPDATE_BANNER_DISMISSED_KEY, version);
  } catch {
    // Storage blocked or full: the banner is still gone for this launch.
  }
}

export function UpdateGate({ children, deps = defaultDeps }: { children: ReactNode; deps?: UpdateGateDeps }) {
  const [state, setState] = useState<GateState>(CLEAR);

  useEffect(() => {
    if (!deps.isNative()) return;
    let cancelled = false;
    (async () => {
      try {
        const [installed] = await Promise.all([deps.getInstalledAppInfo(), deps.loadRuntimeConfig()]);
        if (cancelled || !installed) return;
        const decision = decideUpdate({
          installed,
          minVersion: deps.minVersion(installed.platform),
          latestVersion: deps.latestVersion(installed.platform),
        });
        if (decision.kind === 'required') setState({ kind: 'required', platform: installed.platform });
        else if (decision.kind === 'available' && readDismissed(deps) !== decision.latest) {
          setState({ kind: 'available', platform: installed.platform, latest: decision.latest });
        }
      } catch {
        // Fail open: the app stays as it is.
      }
    })();
    return () => { cancelled = true; };
  }, [deps]);

  if (state.kind === 'required') return <UpdateBlock platform={state.platform} deps={deps} />;

  if (state.kind === 'available') {
    const dismiss = () => {
      rememberDismissed(deps, state.latest);
      setState(CLEAR);
    };
    return (
      <>
        <UpdateBanner
          platform={state.platform}
          onUpdate={() => deps.openStoreListing(storeListingUrl(state.platform))}
          onDismiss={dismiss}
        />
        {children}
      </>
    );
  }

  return <>{children}</>;
}

/** The full-screen update block (D8 on D24), and its offline state. */
export function UpdateBlock({ platform, deps = defaultDeps }: { platform: StorePlatform; deps?: UpdateGateDeps }) {
  // null: not known yet; the block shows its store button meanwhile.
  const [online, setOnline] = useState<boolean | null>(null);
  const [stillOffline, setStillOffline] = useState(false);
  const store = storeName(platform);

  useEffect(() => {
    let cancelled = false;
    deps.getNetworkStatus()
      .then(status => { if (!cancelled) setOnline(status.connected); })
      .catch(() => {});
    const unsubscribe = deps.onNetworkChange(status => {
      setOnline(status.connected);
      if (status.connected) setStillOffline(false);
    });
    const releaseBack = deps.exitAppOnBackButton();
    return () => {
      cancelled = true;
      unsubscribe();
      releaseBack();
    };
  }, [deps]);

  const check = useCallback(async (): Promise<boolean> => {
    try {
      const { connected } = await deps.getNetworkStatus();
      setOnline(connected);
      return connected;
    } catch {
      // Status unknown: let the store button try.
      setOnline(null);
      return true;
    }
  }, [deps]);

  if (online === false) {
    return (
      <FullScreenGate
        heading="Connect to the internet to update"
        sentence={`Amani needs a connection to open ${store}.`}
        notice={stillOffline ? <CalmNotice title="Still no connection." /> : undefined}
        primary={{
          label: 'Retry',
          onClick: () => {
            void check().then(connected => setStillOffline(!connected));
          },
        }}
      />
    );
  }

  return (
    <FullScreenGate
      heading="Please update Amani"
      sentence={`This version of Amani is no longer supported, and the latest one is ready in ${store}.`}
      primary={{
        label: platform === 'ios' ? 'Update in the App Store' : 'Update on Google Play',
        onClick: () => {
          void check().then(connected => {
            if (connected) deps.openStoreListing(storeListingUrl(platform));
          });
        },
      }}
    />
  );
}

/** The dismissible soft banner (D8): a newer version is out, not required. */
export function UpdateBanner({ platform, onUpdate, onDismiss }: {
  platform: StorePlatform;
  onUpdate: () => void;
  onDismiss: () => void;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      data-update-banner=""
      className="border-b border-theme-info-border bg-theme-info-bg text-theme-text safe-top safe-left safe-right"
    >
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2 sm:px-6">
        <p className="flex min-w-0 flex-1 basis-56 items-start gap-2 text-sm">
          <Info aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-theme-info" />
          <span>A new version of Amani is available in {storeName(platform)}.</span>
        </p>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={onUpdate}>Update</Button>
          <button
            type="button"
            onClick={onDismiss}
            className="inline-flex min-h-[44px] items-center rounded-lg px-2 text-sm font-medium text-theme-text underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-theme-primary"
          >
            Not now
          </button>
        </div>
      </div>
    </div>
  );
}
