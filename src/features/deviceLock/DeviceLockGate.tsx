import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { deviceLock, useDeviceLock } from '../../lib/deviceLock';
import { exposePrivacyCoverReady } from '../../lib/deviceLock/privacyCover';
import { isDeviceLockActive } from '../../lib/deviceLock/release';
import { isNative, onAppLifecycle } from '../../lib/native';
import { supabase } from '../../lib/supabase';
import { LockScreen } from './LockScreen';

/**
 * Puts the lock screen in front of the whole app while the lock is closed and
 * someone is signed in (PK-DEVICE-01). Gate order at launch (design review):
 * the update block, then this lock, then consent and onboarding.
 *
 * A cold start shows the lock screen in place of the app: nothing underneath
 * is in the document. Once she has opened the app, a re-lock (or the cover
 * drawn as soon as she leaves, review F002) goes over the still-mounted app,
 * which is made invisible and inert, so a photo or file she was adding is not
 * thrown away (review F001).
 *
 * The web never locks: the controller is native-only, and the lifecycle
 * subscription is a no-op there.
 */
export function DeviceLockGate({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const lock = useDeviceLock();
  const [active] = useState(() => isDeviceLockActive(isNative()));
  const signingOut = useRef(false);
  const [signOutFailed, setSignOutFailed] = useState(false);
  // The signed-in user the app has been shown to, unlocked, in this launch.
  const [openedFor, setOpenedFor] = useState<string | null>(null);
  const appRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  const userId = user?.id ?? null;
  if (userId === null ? openedFor !== null : !lock.locked && openedFor !== userId) setOpenedFor(userId);
  const opened = userId !== null && openedFor === userId;
  const hidden = active && opened && (lock.locked || lock.covered);

  async function signOut() {
    if (signingOut.current) return;
    signingOut.current = true;
    setSignOutFailed(false);
    try {
      // Local scope still attempts server revocation. Storage removal or that
      // request can fail; only AuthContext confirming no user may open the gate.
      const { error } = await supabase.auth.signOut({ scope: 'local' });
      // F009: a failed revocation still removes the local session. Only say it
      // failed while a session is really still there.
      if (error && await sessionRemains()) setSignOutFailed(true);
    } catch {
      setSignOutFailed(true);
    } finally {
      signingOut.current = false;
    }
  }

  useEffect(() => {
    if (!active) return;
    void deviceLock.start();
    const stopCover = exposePrivacyCoverReady(window, deviceLock);
    // F000: a definite sign-out drops the cold-start lock, so the next
    // sign-in with her email and password is not locked.
    const { data: { subscription } } = supabase.auth.onAuthStateChange(event => {
      if (event === 'SIGNED_OUT') deviceLock.noSession();
    });
    const stopLifecycle = onAppLifecycle({
      onPause: () => deviceLock.pause(),
      onResume: () => deviceLock.resume(),
    });
    return () => { stopCover(); subscription.unsubscribe(); stopLifecycle(); };
  }, [active]);

  // F000: no user once auth has loaded is not proof that nobody is signed in.
  // An offline cold start reads no session yet keeps it stored, and the same
  // session comes back on the next token refresh. Drop the cold-start lock
  // only when auth reads no session and reports no error.
  useEffect(() => {
    if (!active || loading || user) return;
    let live = true;
    void definitelySignedOut().then(none => { if (live && none) deviceLock.noSession(); });
    return () => { live = false; };
  }, [active, loading, user]);

  // F009: a message about a sign-out never outlives that session.
  useEffect(() => {
    if (!user) setSignOutFailed(false);
  }, [user]);

  // Portals (dialogs) live outside this tree: keep them inert and out of the
  // accessibility tree too while the app is hidden.
  useLayoutEffect(() => {
    if (!hidden) return;
    const restore: Array<() => void> = [];
    const overlay = overlayRef.current;
    for (const element of Array.from(document.body.children)) {
      if (overlay && element.contains(overlay)) continue;
      restore.push(hideElement(element));
    }
    if (appRef.current) restore.push(hideElement(appRef.current));
    return () => { for (const undo of restore) undo(); };
  }, [hidden]);

  const lockScreen = (
    <LockScreen
      unlocking={lock.unlocking}
      problem={lock.problem}
      signOutFailed={signOutFailed}
      onUnlock={() => void deviceLock.unlock()}
      onSignOut={() => { void signOut(); }}
    />
  );

  if (!active) return <>{children}</>;

  // Cold start, or a session the app was never opened for: nothing underneath.
  if (user && lock.locked && !opened) return lockScreen;

  return (
    <>
      <div ref={appRef} data-device-lock-app="" style={hidden ? { display: 'contents', visibility: 'hidden' } : { display: 'contents' }}>
        {children}
      </div>
      {hidden && (
        <div ref={overlayRef} data-device-lock-cover="" className="fixed inset-0 z-[70] overflow-y-auto bg-theme-background">
          {lock.locked ? lockScreen : null}
        </div>
      )}
    </>
  );
}

function hideElement(element: Element): () => void {
  const inert = element.hasAttribute('inert');
  const ariaHidden = element.getAttribute('aria-hidden');
  element.setAttribute('inert', '');
  element.setAttribute('aria-hidden', 'true');
  return () => {
    if (!inert) element.removeAttribute('inert');
    if (ariaHidden === null) element.removeAttribute('aria-hidden');
    else element.setAttribute('aria-hidden', ariaHidden);
  };
}

async function sessionRemains(): Promise<boolean> {
  try {
    const { data } = await supabase.auth.getSession();
    return data.session !== null;
  } catch {
    return true;
  }
}

async function definitelySignedOut(): Promise<boolean> {
  try {
    const { data, error } = await supabase.auth.getSession();
    return !error && !data.session;
  } catch {
    return false;
  }
}
