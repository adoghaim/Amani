import { useEffect } from 'react';
import { FullScreenGate } from '../../components/FullScreenGate';
import { CalmNotice } from '../../components/CalmNotice';
import type { UnlockProblem } from '../../lib/deviceLock';

/**
 * The lock screen (PK-DEVICE-01; D15, D16, D24). It uses FullScreenGate and
 * says nothing about her: no name, no cycle day, no health value. Everything
 * on it is a fixed string.
 *
 * It asks for Face ID or a fingerprint as soon as it opens. The system sheet
 * falls back to the phone's passcode. "Sign out" is the recovery path that
 * never locks her out: she signs back in with her email and password.
 *
 * Back behaviour (D23): Android's back button closes the app while it is
 * locked (App.tsx, AndroidBackHandler). It never reveals the page underneath,
 * which is not in the document at all.
 */

const LOCK_HEADING = 'Amani is locked';
const LOCK_SENTENCE = "Unlock with Face ID, your fingerprint or your phone's passcode.";
const LOCK_WHAT_THIS_MEANS = [
  'You turned on the lock, so Amani asks before it opens. You can turn it off in Settings.',
  "If you can't unlock, sign out. You can sign back in with your email and password, and your reports stay in your account.",
];

const PROBLEM_TITLE: Record<UnlockProblem, string | null> = {
  cancelled: null,
  failed: "Amani didn't unlock.",
  unavailable: "Face ID or your fingerprint isn't available right now. Try your phone's passcode, or sign out.",
};

export interface LockScreenProps {
  unlocking: boolean;
  problem: UnlockProblem | null;
  onUnlock: () => void;
  onSignOut: () => void;
}

export function LockScreen({ unlocking, problem, onUnlock, onSignOut }: LockScreenProps) {
  // Ask straight away when the lock screen opens. The controller ignores a
  // second request while the sheet is up (StrictMode runs this twice in dev).
  useEffect(() => {
    onUnlock();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const title = problem ? PROBLEM_TITLE[problem] : null;

  return (
    <FullScreenGate
      heading={LOCK_HEADING}
      sentence={LOCK_SENTENCE}
      whatThisMeans={LOCK_WHAT_THIS_MEANS}
      notice={title ? <CalmNotice title={title} /> : undefined}
      primary={{ label: 'Unlock', onClick: onUnlock, busy: unlocking }}
      secondary={{ label: 'Sign out', onClick: onSignOut }}
    />
  );
}
