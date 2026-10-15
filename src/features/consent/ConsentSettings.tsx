import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle2, CircleSlash } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { Button } from '../../components/Button';
import { CalmNotice } from '../../components/CalmNotice';
import { recordConsent } from '../../lib/consent/consentApi';
import { noteAnswers, useConsent } from '../../lib/consent/consentStore';
import { CONSENT_TYPES, WITHDRAWN_TYPES } from '../../lib/consent/consentPolicy';
import { SETTINGS_COPY } from './consentCopy';

/** Moves focus to Settings' "Delete my data" (D25: Your data, last). */
function goToDeleteMyData() {
  const section = document.querySelector<HTMLElement>('[data-settings-section="your-data"]');
  section?.scrollIntoView({ block: 'start' });
  section?.querySelector<HTMLElement>('button')?.focus();
}

/**
 * Consent status and withdrawal, in Settings > Privacy & security (D25),
 * inside the existing privacy card. Renders nothing while features.consent_gate
 * is off, so Settings is exactly as before.
 *
 * Withdrawal appends a withdrawal of health-data and AI-processing consent to
 * her ledger. The server stops processing at once (the edge functions and the
 * upload trigger check every request); this explains that first, then offers
 * deletion. Her reports stay until she deletes them.
 */
export function ConsentSettings() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const state = useConsent(user?.id);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [justWithdrew, setJustWithdrew] = useState(false);

  if (!user || state.status !== 'ready') return null;
  const missing = new Set(state.missing);
  const allGiven = missing.size === 0;

  const withdraw = async () => {
    setBusy(true);
    setFailed(false);
    try {
      for (const type of WITHDRAWN_TYPES) {
        await recordConsent(type, false);
        noteAnswers(user.id, [type], false);
      }
    } catch {
      setBusy(false);
      setFailed(true);
      return;
    }
    setBusy(false);
    setConfirming(false);
    setJustWithdrew(true);
  };

  return (
    <div className="mt-5 border-t border-theme-border pt-5">
      <h3 className="text-base font-semibold text-theme-neutral-900">{SETTINGS_COPY.heading}</h3>
      <p className="mt-1 text-sm text-theme-neutral-600" aria-live="polite">
        {justWithdrew ? SETTINGS_COPY.withdrawn : allGiven ? SETTINGS_COPY.given : SETTINGS_COPY.notGiven}
      </p>
      <ul className="mt-3 space-y-2">
        {CONSENT_TYPES.map(type => {
          const given = !missing.has(type);
          const Icon = given ? CheckCircle2 : CircleSlash;
          return (
            <li key={type} className="flex flex-wrap items-center gap-x-2 text-sm text-theme-text">
              <span>{SETTINGS_COPY.labels[type]}</span>
              <span className="inline-flex items-center gap-1 font-medium">
                {given ? SETTINGS_COPY.statusGiven : SETTINGS_COPY.statusNotGiven}
                <Icon aria-hidden="true" className="h-4 w-4" />
              </span>
            </li>
          );
        })}
      </ul>

      {failed && (
        <CalmNotice
          className="mt-4"
          title={SETTINGS_COPY.withdrawFailed.title}
          safe={SETTINGS_COPY.withdrawFailed.safe}
          action={{ label: SETTINGS_COPY.withdrawFailed.action, onClick: () => { void withdraw(); }, busy }}
        />
      )}

      <div className="mt-4 flex flex-col items-start gap-3">
        {allGiven && !confirming && (
          <Button variant="outline" onClick={() => setConfirming(true)}>{SETTINGS_COPY.withdraw}</Button>
        )}
        {allGiven && confirming && (
          <div className="space-y-3">
            {SETTINGS_COPY.withdrawExplain.map(line => (
              <p key={line} className="text-sm text-theme-text-body">{line}</p>
            ))}
            <div className="flex flex-wrap gap-3">
              <Button variant="outline" onClick={withdraw} loading={busy}>{SETTINGS_COPY.withdrawConfirm}</Button>
              <Button variant="ghost" onClick={() => setConfirming(false)} disabled={busy}>{SETTINGS_COPY.withdrawCancel}</Button>
            </div>
          </div>
        )}
        {!allGiven && (
          <div className="flex flex-wrap gap-3">
            <Button variant="outline" onClick={goToDeleteMyData}>{SETTINGS_COPY.deleteOffer}</Button>
            <Button variant="ghost" onClick={() => navigate('/app')}>{SETTINGS_COPY.giveAgain}</Button>
          </div>
        )}
      </div>
    </div>
  );
}
