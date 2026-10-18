import { useEffect, type ReactNode } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { deviceLock, useDeviceLock } from '../../lib/deviceLock';
import { isDeviceLockActive } from '../../lib/deviceLock/release';
import { isNative, onAppLifecycle } from '../../lib/native';
import { supabase } from '../../lib/supabase';
import { LockScreen } from './LockScreen';

/**
 * Puts the lock screen in place of the whole app while the lock is closed and
 * someone is signed in (PK-DEVICE-01). Gate order at launch (design review):
 * the update block, then this lock, then consent and onboarding.
 *
 * The web never locks: the controller is native-only, and the lifecycle
 * subscription is a no-op there.
 */
export function DeviceLockGate({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const lock = useDeviceLock();

  useEffect(() => {
    if (!isDeviceLockActive(isNative())) return;
    void deviceLock.start();
    return onAppLifecycle({
      onPause: () => deviceLock.pause(),
      onResume: () => deviceLock.resume(),
    });
  }, []);

  // Nobody signed in once auth has loaded: a fresh sign-in is not locked.
  useEffect(() => {
    if (!loading && !user) deviceLock.noSession();
  }, [loading, user]);

  if (user && lock.locked) {
    return (
      <LockScreen
        unlocking={lock.unlocking}
        problem={lock.problem}
        onUnlock={() => void deviceLock.unlock()}
        onSignOut={() => {
          // Local sign-out: it works offline and never depends on the server.
          void supabase.auth.signOut({ scope: 'local' }).finally(() => deviceLock.noSession());
        }}
      />
    );
  }

  return <>{children}</>;
}
