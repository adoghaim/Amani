import { useEffect, useId, useState } from 'react';
import { Fingerprint } from 'lucide-react';
import { Card } from '../../../components/Card';
import { CalmNotice } from '../../../components/CalmNotice';
import {
  deviceLock, lockMethodName, RELOCK_OPTIONS, useDeviceLock,
  type LockAvailability, type RelockAfter,
} from '../../../lib/deviceLock';
import { isDeviceLockActive } from '../../../lib/deviceLock/release';
import { isNative, platform } from '../../../lib/native';

/**
 * Privacy & security: the Face ID / fingerprint lock and its re-lock time
 * (PK-DEVICE-01; D15, D16, D25, R15). Phones only; the web renders nothing.
 *
 * It shows when the lock is on (so she can always turn it off), or when she
 * can turn it on: the features.biometric_lock flag is on and the phone has
 * Face ID or a fingerprint set up. Next to the toggle it says that screenshots
 * are blocked on Android while the lock is on (R15).
 */

const SCREENSHOT_NOTE = 'While the lock is on, screenshots of Amani are blocked on Android.';

export function DeviceLockSection() {
  const lock = useDeviceLock();
  const [availability, setAvailability] = useState<LockAvailability | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const toggleId = useId();
  const relockId = useId();
  const noteId = useId();

  useEffect(() => {
    let live = true;
    void deviceLock.availability().then(result => { if (live) setAvailability(result); });
    return () => { live = false; };
  }, []);

  if (!isNative() || !isDeviceLockActive(isNative())) return null;
  if (!availability || !(availability.show || lock.settings.enabled)) return null;

  const enabled = lock.settings.enabled;
  const method = lockMethodName(availability.kind);
  const isAndroid = platform() === 'android';

  const toggle = async () => {
    if (busy) return;
    setBusy(true);
    setProblem(null);
    try {
      if (enabled) {
        // Review F006: turning it off asks for Face ID, a fingerprint or the
        // passcode first (never a lock-out: a phone with none of them left
        // turns it off without asking).
        if (await deviceLock.confirmTurnOff()) {
          setStatus('The lock is off.');
        } else {
          setStatus('');
          setProblem("The lock wasn't turned off.");
        }
      } else if (await deviceLock.turnOn()) {
        setStatus('The lock is on.');
      } else {
        setStatus('');
        setProblem("The lock wasn't turned on.");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <div className="flex items-start gap-4">
        <div className="w-10 h-10 bg-theme-surface-2 rounded-full flex items-center justify-center flex-shrink-0">
          <Fingerprint aria-hidden="true" className="w-5 h-5 text-theme-primary" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-lg text-theme-neutral-900 mb-1">App lock</h2>
          <p className="text-sm text-theme-neutral-600 leading-relaxed">
            Amani asks for {method} or your phone's passcode when you open it.
          </p>

          <div className="mt-4 flex min-h-[44px] items-center justify-between gap-4">
            <label htmlFor={toggleId} className="text-sm font-medium text-theme-text">
              Lock Amani with {method}
            </label>
            <button
              id={toggleId}
              type="button"
              role="switch"
              aria-checked={enabled}
              aria-describedby={isAndroid ? noteId : undefined}
              disabled={busy || (!enabled && !availability.canTurnOn)}
              onClick={() => void toggle()}
              className={`relative inline-flex h-11 w-16 shrink-0 items-center rounded-full border-2 border-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-theme-primary disabled:opacity-50 ${
                enabled ? 'bg-theme-primary' : 'bg-theme-border'
              }`}
            >
              <span
                aria-hidden="true"
                className={`inline-block h-7 w-7 rounded-full bg-white shadow ${enabled ? 'translate-x-7' : 'translate-x-1'}`}
              />
            </button>
          </div>

          {isAndroid && (
            <p id={noteId} className="mt-2 text-sm text-theme-text-body">{SCREENSHOT_NOTE}</p>
          )}

          {enabled && (
            <div className="mt-4">
              <label htmlFor={relockId} className="block text-sm font-medium text-theme-text mb-1">
                Lock again when you leave Amani
              </label>
              <select
                id={relockId}
                value={lock.settings.relockAfter}
                onChange={event => deviceLock.setRelockAfter(event.target.value as RelockAfter)}
                className="min-h-[44px] w-full rounded-xl border border-theme-border bg-theme-surface px-3 text-base text-theme-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-theme-primary"
              >
                {RELOCK_OPTIONS.map(option => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
              <p className="mt-2 text-sm text-theme-text-body">
                Amani always locks when it starts, and hides its screen in the app switcher as soon as you leave.
              </p>
            </div>
          )}

          <p role="status" aria-live="polite" className="sr-only">{status}</p>
          {problem && (
            <CalmNotice
              className="mt-4"
              title={problem}
              safe="Nothing has changed. You can try again any time."
            />
          )}
        </div>
      </div>
    </Card>
  );
}
