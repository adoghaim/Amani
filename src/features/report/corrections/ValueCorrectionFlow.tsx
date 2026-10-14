import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Modal } from '../../../components/Modal';
import { Button } from '../../../components/Button';
import { CalmNotice } from '../../../components/CalmNotice';
import {
  CONFIRM_CHECK_LABEL, CONFIRM_SAVE_LABEL, CORRECTION_TEXT_MAX, CORRECTION_UNIT_MAX, confirmationQuestion,
  correctedFlag, needsConfirmation, parseCorrectionInput, type CorrectionTarget,
} from '../../../lib/corrections/correctionInput';
import { supabaseCorrectionPort, type CorrectionPort } from '../../../lib/corrections/correctAnalyte';
import { originalDisplay, type ValueCorrectionMark } from '../../../lib/corrections/provenance';
import type { Biomarker, ReportAnalyte } from '../../../types';
import { CorrectionMark } from './CorrectionMark';

/*
  "A value is wrong" (PK-CORRECT-01; D20, Q1, R23). PK-HARM-01's chooser
  records the feedback row and, only while features.value_corrections is on,
  continues here (its `onContinueToCorrection`). While the flag is off this
  screen is never opened, so "A value is wrong" stores the feedback row only
  (A6).

    pick     the saved values; she picks the one that is wrong;
    enter    what her lab report says: the value and its unit, parsed like the
             upload (Q1). Non-numeric input is an inline error and her text is
             kept;
    confirm  R23: only when the new value is more than 10 times higher or
             lower than what Amani read. "Yes, save it" saves; "Let me check"
             goes back with her text kept. Nothing is blocked;
    saved    the correction is appended (correct_analyte); the page re-reads
             its values and refreshes the explanation (onCorrected).

  A failed save is a calm notice with Try again, and what she typed stays.
  The copy goes through the clinical reviewer with D20's other copy (D7.9).

  D23: each step's heading takes focus when it opens; every control is 44px;
  every field has a visible label with its error linked; status changes are
  announced politely; no animation.
*/

type Step = 'pick' | 'enter' | 'confirm' | 'saved';

export interface ValueCorrectionFlowProps {
  open: boolean;
  onClose: () => void;
  /** The report's saved values (report_analytes rows, marked when corrected). */
  values: readonly (ReportAnalyte & { correction?: ValueCorrectionMark })[];
  /** The report's biomarkers rows: a core value with one is scored, so it gets a recomputed flag. */
  biomarkers: readonly Biomarker[];
  /** The report's cycle phase, which the upload scored against. */
  cyclePhase: string | null | undefined;
  /** Called once a correction is saved, with its time when known: re-read the values and refresh the explanation. */
  onCorrected: (correctedAt: string | null) => void;
  /** Tests pass a fake; the app writes through correct_analyte. */
  port?: CorrectionPort;
}

function shownValue(row: ReportAnalyte): string {
  const value = row.raw_value_text ?? (row.value_numeric === null ? '' : String(row.value_numeric));
  return row.unit ? `${value} ${row.unit}` : value;
}

/** What Amani read: the lab's original reading, kept even after an earlier correction. */
function amaniRead(row: ReportAnalyte & { correction?: ValueCorrectionMark }): { value: number | null; display: string } {
  if (row.correction) return { value: row.correction.originalValue, display: originalDisplay(row.correction) };
  return { value: row.value_numeric, display: shownValue(row) };
}

export function ValueCorrectionFlow({
  open, onClose, values, biomarkers, cyclePhase, onCorrected, port = supabaseCorrectionPort,
}: ValueCorrectionFlowProps) {
  const [step, setStep] = useState<Step>('pick');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [unit, setUnit] = useState('');
  const [error, setError] = useState<{ field: 'value' | 'unit'; message: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const valueId = useId();
  const unitId = useId();
  const errorId = useId();

  const choices = useMemo(
    () => values.filter(row => row.value_numeric !== null || (row.raw_value_text ?? '').trim() !== ''),
    [values],
  );
  const selected = choices.find(row => row.id === selectedId) ?? null;

  // A fresh start every time it opens.
  useEffect(() => {
    if (!open) return;
    setStep('pick');
    setSelectedId(null);
    setText('');
    setUnit('');
    setError(null);
    setSaving(false);
    setFailed(false);
  }, [open]);

  useEffect(() => {
    if (open && step !== 'pick') headingRef.current?.focus();
  }, [open, step]);

  const pick = (row: ReportAnalyte) => {
    setSelectedId(row.id);
    setText('');
    setUnit(row.unit ?? '');
    setError(null);
    setFailed(false);
    setStep('enter');
  };

  const target = (row: ReportAnalyte): CorrectionTarget => ({
    rawName: row.raw_name, canonicalSlug: row.canonical_slug, isCore: row.is_core,
  });

  const save = async () => {
    if (!selected || saving) return;
    const parsed = parseCorrectionInput(text, unit, target(selected));
    if (!parsed.ok) {
      setError({ field: parsed.field, message: parsed.error });
      setStep('enter');
      return;
    }
    const hasBiomarkerRow = selected.is_core && !!selected.canonical_slug
      && biomarkers.some(b => b.name === selected.canonical_slug);
    setSaving(true);
    setFailed(false);
    const result = await port.correctAnalyte({
      reportAnalyteId: selected.id,
      value: parsed.value,
      rawText: parsed.rawText,
      unit: parsed.unit,
      flag: correctedFlag(target(selected), parsed.value, cyclePhase, hasBiomarkerRow),
    });
    setSaving(false);
    if (!result.ok) {
      setFailed(true);
      return;
    }
    setStep('saved');
    onCorrected(result.correctedAt);
  };

  const submit = () => {
    if (!selected) return;
    const parsed = parseCorrectionInput(text, unit, target(selected));
    if (!parsed.ok) {
      setError({ field: parsed.field, message: parsed.error });
      return;
    }
    setError(null);
    if (needsConfirmation(amaniRead(selected).value, parsed.value)) {
      setFailed(false);
      setStep('confirm');
      return;
    }
    void save();
  };

  const heading = (label: string) => (
    <h3 ref={headingRef} tabIndex={-1} className="text-base font-medium text-theme-text focus:outline-none">
      {label}
    </h3>
  );

  const failure = failed && (
    <CalmNotice
      title="We couldn't save your correction."
      safe="What you entered is still here. Your report is unchanged."
      action={{ label: 'Try again', onClick: () => void save(), busy: saving }}
    />
  );

  return (
    <Modal open={open} onClose={onClose} title="Correct a value">
      <div data-value-correction-step={step} className="space-y-4">
        {step === 'pick' && (
          <>
            {heading('Which value is wrong?')}
            {choices.length === 0 ? (
              <p className="text-sm text-theme-text-body">This report has no saved values to correct.</p>
            ) : (
              <ul aria-label="Saved values" className="space-y-2">
                {choices.map(row => (
                  <li key={row.id}>
                    <button
                      type="button"
                      onClick={() => pick(row)}
                      className="w-full min-h-[44px] rounded-lg border border-theme-border bg-theme-surface px-4 py-2 text-left text-sm text-theme-text hover:bg-theme-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-theme-primary motion-reduce:transition-none"
                    >
                      <span className="block font-medium">{row.display_name || row.raw_name}</span>
                      <span className={`block font-mono tabular-nums ${row.correction ? 'text-theme-pen' : 'text-theme-text-body'}`}>
                        {shownValue(row)}
                      </span>
                      {row.correction && <CorrectionMark mark={row.correction} />}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}

        {step === 'enter' && selected && (
          <>
            {heading(selected.display_name || selected.raw_name)}
            <p className="text-sm text-theme-text-body">
              Amani read <span className="font-mono tabular-nums text-theme-text">{amaniRead(selected).display}</span>.
              Enter what your lab report says.
            </p>
            <div className="space-y-1">
              <label htmlFor={valueId} className="block text-sm font-medium text-theme-text">Value on your report</label>
              <input
                id={valueId}
                type="text"
                inputMode="decimal"
                autoComplete="off"
                value={text}
                maxLength={CORRECTION_TEXT_MAX}
                onChange={event => { setText(event.target.value); setError(null); }}
                aria-invalid={error?.field === 'value' || undefined}
                aria-describedby={error?.field === 'value' ? errorId : undefined}
                className="block w-full min-h-[44px] rounded-lg border border-theme-border bg-theme-surface px-3 py-2 font-mono text-sm text-theme-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-theme-primary"
              />
            </div>
            <div className="space-y-1">
              <label htmlFor={unitId} className="block text-sm font-medium text-theme-text">Unit</label>
              <input
                id={unitId}
                type="text"
                autoComplete="off"
                value={unit}
                maxLength={CORRECTION_UNIT_MAX}
                onChange={event => { setUnit(event.target.value); setError(null); }}
                aria-invalid={error?.field === 'unit' || undefined}
                aria-describedby={error?.field === 'unit' ? errorId : undefined}
                className="block w-full min-h-[44px] rounded-lg border border-theme-border bg-theme-surface px-3 py-2 font-mono text-sm text-theme-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-theme-primary"
              />
            </div>
            {error && (
              <p id={errorId} role="alert" className="text-sm text-theme-text">{error.message}</p>
            )}
            {failure}
            <div className="flex flex-wrap gap-3">
              <Button variant="primary" onClick={submit} loading={saving}>Save</Button>
              <Button variant="outline" onClick={() => setStep('pick')} disabled={saving}>Back</Button>
            </div>
          </>
        )}

        {step === 'confirm' && selected && (
          <>
            {heading('Check this value')}
            <p className="text-sm text-theme-text-body">{confirmationQuestion(amaniRead(selected).display)}</p>
            <p className="text-sm text-theme-text-body">
              You entered <span className="font-mono tabular-nums text-theme-pen">{text.trim()}{unit.trim() ? ` ${unit.trim()}` : ''}</span>.
            </p>
            {failure}
            <div className="flex flex-wrap gap-3">
              <Button variant="primary" onClick={() => void save()} loading={saving}>{CONFIRM_SAVE_LABEL}</Button>
              <Button variant="outline" onClick={() => setStep('enter')} disabled={saving}>{CONFIRM_CHECK_LABEL}</Button>
            </div>
          </>
        )}

        {step === 'saved' && (
          <div role="status" aria-live="polite" className="space-y-4">
            {heading('Your correction is saved')}
            <p className="text-sm text-theme-text-body">
              Your value is marked as corrected, and the lab's original reading is kept.
            </p>
            <Button variant="primary" onClick={onClose}>Done</Button>
          </div>
        )}
      </div>
    </Modal>
  );
}
