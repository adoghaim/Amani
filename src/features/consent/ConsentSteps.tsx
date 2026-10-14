import { useId, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { FullScreenGate } from '../../components/FullScreenGate';
import { CalmNotice } from '../../components/CalmNotice';
import { eraseAccount, recordConsent, signOutLocally } from '../../lib/consent/consentApi';
import { noteAnswers, resetConsent } from '../../lib/consent/consentStore';
import { CONSENT_TYPES, type ConsentType } from '../../lib/consent/consentPolicy';
import {
  CONSENT_STEPS, CONTINUE_LABEL, DECLINE_EXIT, NOTICES, PRIVACY_LINK_LABEL, UNDER_18_CONFIRM,
} from './consentCopy';

/** The public route that shows the under-18 exit, from local state only (D13). */
export const ADULTS_ONLY_PATH = '/adults-only';

type Screen =
  | { kind: 'step'; type: ConsentType }
  | { kind: 'declined'; type: ConsentType }
  | { kind: 'under18-confirm' };

export interface ConsentStepsProps {
  userId: string;
  /** The consent types she has not currently granted; the first is shown first. Never empty. */
  missing: readonly ConsentType[];
  /**
   * The account already holds her data (onboarding done or skipped): "I'm
   * under 18" then asks once before removing it. A just-created account is
   * removed straight away (D13).
   */
  accountHoldsData: boolean;
  onSignOut: () => Promise<void>;
}

/**
 * The three consent steps (D4) at the start of onboarding (D9), each on the
 * shared full-screen gate (D24): 18+, health data, AI processing. Each is one
 * plain sentence, an expandable "What this means", an unchecked checkbox with
 * a visible label and Continue, enabled only when it is checked. Steps she has
 * already granted are skipped; the dots still count three.
 *
 * Back behaviour (D23): the gate renders in place of every protected route, so
 * the browser or Android back button cannot step past it; a step she has
 * already answered stays answered, and the gate reopens at the first missing one.
 */
export function ConsentSteps({ userId, missing, accountHoldsData, onSignOut }: ConsentStepsProps) {
  const navigate = useNavigate();
  const checkboxId = useId();
  const [screen, setScreen] = useState<Screen>({ kind: 'step', type: missing[0] ?? 'age_18_plus' });
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<null | 'save' | 'remove'>(null);

  const show = (next: Screen) => {
    setChecked(false);
    setNotice(null);
    setScreen(next);
  };

  const removeAccount = async () => {
    setBusy(true);
    setNotice(null);
    try {
      await eraseAccount();
    } catch {
      setBusy(false);
      setNotice('remove');
      return;
    }
    // Leave the protected route first, so signing out does not bounce her to
    // the login screen; the exit renders from this navigation's state.
    navigate(ADULTS_ONLY_PATH, { replace: true, state: { accountRemoved: true } });
    resetConsent();
    await signOutLocally();
  };

  if (screen.kind === 'declined') {
    return (
      <FullScreenGate
        heading={DECLINE_EXIT.heading}
        sentence={DECLINE_EXIT.sentence}
        primary={{ label: DECLINE_EXIT.primary, onClick: () => show({ kind: 'step', type: screen.type }) }}
        secondary={{ label: DECLINE_EXIT.secondary, onClick: () => { void onSignOut(); } }}
      />
    );
  }

  if (screen.kind === 'under18-confirm') {
    return (
      <FullScreenGate
        heading={UNDER_18_CONFIRM.heading}
        sentence={UNDER_18_CONFIRM.sentence}
        notice={notice === 'remove' ? <CalmNotice title={NOTICES.removeFailed.title} safe={NOTICES.removeFailed.safe} /> : undefined}
        primary={{ label: notice === 'remove' ? NOTICES.removeFailed.action : UNDER_18_CONFIRM.primary, onClick: removeAccount, busy }}
        secondary={{ label: UNDER_18_CONFIRM.secondary, onClick: () => show({ kind: 'step', type: 'age_18_plus' }) }}
      />
    );
  }

  const copy = CONSENT_STEPS.find(step => step.type === screen.type)!;
  const index = CONSENT_TYPES.indexOf(screen.type);
  const isLast = index === CONSENT_TYPES.length - 1;

  const grant = async () => {
    setBusy(true);
    setNotice(null);
    try {
      await recordConsent(screen.type, true);
    } catch {
      setBusy(false);
      setNotice('save');
      return;
    }
    setBusy(false);
    // `missing` is the store's current list (the gate passes it), so it never
    // holds a step she has already granted.
    const still = missing.filter(type => type !== screen.type);
    const next = still.find(type => CONSENT_TYPES.indexOf(type) > index) ?? still[0];
    if (next) show({ kind: 'step', type: next });
    // With nothing left the gate sees no missing consent and opens.
    noteAnswers(userId, [screen.type], true);
  };

  const secondary = screen.type === 'age_18_plus'
    ? {
      label: copy.secondaryLabel,
      onClick: () => {
        if (busy) return;
        if (accountHoldsData) show({ kind: 'under18-confirm' });
        else void removeAccount();
      },
    }
    : { label: copy.secondaryLabel, onClick: () => show({ kind: 'declined', type: screen.type }) };

  const failure = notice === 'save' ? NOTICES.saveFailed : notice === 'remove' ? NOTICES.removeFailed : null;

  return (
    <FullScreenGate
      heading={copy.heading}
      sentence={copy.sentence}
      whatThisMeans={copy.whatThisMeans}
      progress={{ current: index + 1, total: CONSENT_TYPES.length }}
      notice={failure ? <CalmNotice title={failure.title} safe={failure.safe} /> : undefined}
      primary={{
        label: notice === 'save' ? NOTICES.saveFailed.action : CONTINUE_LABEL,
        onClick: grant,
        busy,
        disabled: !checked,
      }}
      secondary={secondary}
    >
      <div className="space-y-4">
        <label
          htmlFor={checkboxId}
          className="flex min-h-[44px] cursor-pointer items-start gap-3 text-base text-theme-text"
        >
          <input
            id={checkboxId}
            type="checkbox"
            checked={checked}
            onChange={event => setChecked(event.target.checked)}
            className="mt-0.5 h-6 w-6 shrink-0 rounded border-theme-border text-theme-primary focus-visible:ring-2 focus-visible:ring-theme-primary"
          />
          <span>{copy.checkboxLabel}</span>
        </label>
        {isLast && (
          <Link
            to="/privacy"
            className="-ml-2 inline-flex min-h-[44px] items-center rounded-lg px-2 text-sm font-medium text-theme-primary-dark underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-theme-primary"
          >
            {PRIVACY_LINK_LABEL}
          </Link>
        )}
      </div>
    </FullScreenGate>
  );
}
