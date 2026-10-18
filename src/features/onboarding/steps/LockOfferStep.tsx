import { useState } from 'react';
import { Fingerprint } from 'lucide-react';
import { Button } from '../../../components/Button';
import { CalmNotice } from '../../../components/CalmNotice';

/**
 * D15 (PK-DEVICE-01): the lock is offered once, as an onboarding step after
 * consent and the profile, with "Turn on" and "Not now". OnboardingFlow shows
 * it only on a phone with Face ID or a fingerprint set up, with the
 * features.biometric_lock flag on. The web has no step. Settings keeps the
 * toggle either way.
 */

interface LockOfferStepProps {
  /** "Face ID", "Touch ID" or "your fingerprint". */
  method: string;
  /** Asks for the scan once; resolves true when the lock is on. */
  onTurnOn: () => Promise<boolean>;
  onNotNow: () => void;
  /** After either answer. */
  onDone: () => void;
}

export function LockOfferStep({ method, onTurnOn, onNotNow, onDone }: LockOfferStepProps) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const turnOn = async () => {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    const on = await onTurnOn();
    setBusy(false);
    if (on) onDone();
    else setFailed(true);
  };

  return (
    <div className="flex flex-col items-center text-center">
      <div className="w-16 h-16 rounded-2xl bg-theme-surface-2 flex items-center justify-center mb-6">
        <Fingerprint aria-hidden="true" className="w-8 h-8 text-theme-primary" />
      </div>
      <h1 className="text-2xl sm:text-3xl text-theme-text mb-3">
        Lock Amani with {method}?
      </h1>
      <p className="text-base text-theme-muted-text leading-relaxed mb-8 max-w-sm">
        Amani will ask for {method} or your phone's passcode when you open it. You can change this any time in Settings.
      </p>

      {failed && (
        <CalmNotice
          className="mb-6 w-full text-left"
          title="The lock wasn't turned on."
          safe="Nothing has changed. You can try again, or turn it on later in Settings."
        />
      )}

      <Button variant="primary" size="lg" className="w-full mb-3" onClick={() => void turnOn()} loading={busy}>
        Turn on
      </Button>
      <button
        type="button"
        disabled={busy}
        onClick={() => { onNotNow(); onDone(); }}
        className="min-h-[44px] px-2 text-sm font-medium text-theme-muted-text hover:text-theme-text disabled:opacity-50 disabled:cursor-not-allowed"
      >
        Not now
      </button>
    </div>
  );
}
