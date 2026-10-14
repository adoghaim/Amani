import { useEffect, useId, useRef, useState } from 'react';
import { Modal } from '../../../components/Modal';
import { Button } from '../../../components/Button';
import { CalmNotice } from '../../../components/CalmNotice';
import {
  IDENTIFIER_WARNING, PROBLEM_CATEGORIES, PROBLEM_TEXT_MAX, submitProblemReport, supabaseProblemReportPort, WORRIED_HELP_LINES,
  type ProblemCategory, type ProblemReportPort,
} from './problemReport';

/*
  "Report a problem" (PK-HARM-01; D20). Opened from the report header's More
  menu (D19). Steps:

    choose   the chooser, in D20's order;
    help     "Something here worried me" only: where to get help first;
    details  optional text, capped at 1,000 characters, with a warning not to
             include anything that identifies her; then Send;
    sent     thanks. Every category writes its interpretation_feedback row.

  "A value is wrong" continues into PK-CORRECT-01's correction screen when
  features.value_corrections is on and that packet supplies
  `onContinueToCorrection`; until then it records the row only.

  The help copy and the worried-path wording are pending the clinical
  reviewer (D7.9); see docs/ops/adverse-event-triage.md.

  D23: each step's heading takes focus when the step opens; every control is
  44px; the field has a visible label and its hint and count are linked; a
  failed send is a calm notice, announced politely, and her text is kept.
*/

type Step = 'choose' | 'help' | 'details' | 'sent';

export interface ReportProblemFlowProps {
  open: boolean;
  onClose: () => void;
  reportId: string;
  /** The explanation on screen, when known (the interpretations view's id). */
  interpretationId: string | null;
  /** Tests pass a fake; the app writes through Supabase. */
  port?: ProblemReportPort;
  /**
   * PK-CORRECT-01: after "A value is wrong" is recorded, continue into the
   * correction screen. Supplied only while features.value_corrections is on.
   */
  onContinueToCorrection?: () => void;
}

export function ReportProblemFlow({
  open, onClose, reportId, interpretationId, port = supabaseProblemReportPort, onContinueToCorrection,
}: ReportProblemFlowProps) {
  const [step, setStep] = useState<Step>('choose');
  const [category, setCategory] = useState<ProblemCategory | null>(null);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const fieldId = useId();
  const hintId = useId();
  const countId = useId();

  // A fresh start every time it opens.
  useEffect(() => {
    if (!open) return;
    setStep('choose');
    setCategory(null);
    setText('');
    setSending(false);
    setFailed(false);
  }, [open]);

  // Focus moves to the step's heading when a later step opens. The first
  // step leaves focus where the shared Modal puts it.
  useEffect(() => {
    if (open && step !== 'choose') headingRef.current?.focus();
  }, [open, step]);

  const choose = (next: ProblemCategory) => {
    setCategory(next);
    setFailed(false);
    setStep(next === 'worried' ? 'help' : 'details');
  };

  const send = async () => {
    if (!category || sending) return;
    setSending(true);
    setFailed(false);
    const result = await submitProblemReport(port, { reportId, interpretationId, category, text });
    setSending(false);
    if (!result.ok) {
      setFailed(true);
      return;
    }
    if (category === 'value_wrong' && onContinueToCorrection) {
      onClose();
      onContinueToCorrection();
      return;
    }
    setStep('sent');
  };

  const heading = (label: string) => (
    <h3 ref={headingRef} tabIndex={-1} className="text-base font-medium text-theme-text focus:outline-none">
      {label}
    </h3>
  );

  const over = text.trim().length > PROBLEM_TEXT_MAX;

  return (
    <Modal open={open} onClose={onClose} title="Report a problem">
      <div data-report-problem-step={step} className="space-y-4">
        {step === 'choose' && (
          <>
            {heading('What kind of problem?')}
            <ul aria-label="What kind of problem?" className="space-y-2">
              {PROBLEM_CATEGORIES.map(option => (
                <li key={option.id}>
                  <button
                    type="button"
                    onClick={() => choose(option.id)}
                    className="w-full min-h-[44px] rounded-lg border border-theme-border bg-theme-surface px-4 py-2 text-left text-sm text-theme-text hover:bg-theme-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-theme-primary motion-reduce:transition-none"
                  >
                    {option.label}
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}

        {step === 'help' && (
          <>
            {heading('Where to get help')}
            {WORRIED_HELP_LINES.map(line => (
              <p key={line} className="text-sm text-theme-text-body">{line}</p>
            ))}
            <p className="text-sm text-theme-text-body">
              You can also tell us what happened. A member of the Amani team will read it.
            </p>
            <div className="flex flex-wrap gap-3">
              <Button variant="primary" onClick={() => setStep('details')}>Tell us what happened</Button>
              <Button variant="outline" onClick={() => void send()} loading={sending}>Send without a note</Button>
            </div>
            {failed && (
              <CalmNotice
                title="We couldn't send your report."
                safe="Nothing you chose has been lost."
                action={{ label: 'Try again', onClick: () => void send(), busy: sending }}
              />
            )}
          </>
        )}

        {step === 'details' && category && (
          <>
            {heading(PROBLEM_CATEGORIES.find(option => option.id === category)!.label)}
            <div className="space-y-1">
              <label htmlFor={fieldId} className="block text-sm font-medium text-theme-text">
                Tell us more (optional)
              </label>
              <textarea
                id={fieldId}
                value={text}
                onChange={event => setText(event.target.value)}
                maxLength={PROBLEM_TEXT_MAX}
                rows={5}
                aria-describedby={`${hintId} ${countId}`}
                aria-invalid={over || undefined}
                className="block w-full rounded-lg border border-theme-border bg-theme-surface px-3 py-2 text-sm text-theme-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-theme-primary"
              />
              <p id={hintId} className="text-sm text-theme-text-body">{IDENTIFIER_WARNING}</p>
              <p id={countId} className="text-xs text-theme-muted-text">
                {text.trim().length.toLocaleString('en-US')} of {PROBLEM_TEXT_MAX.toLocaleString('en-US')} characters
              </p>
            </div>
            {failed && (
              <CalmNotice
                title="We couldn't send your report."
                safe="What you wrote is still here."
                action={{ label: 'Try again', onClick: () => void send(), busy: sending }}
              />
            )}
            <div className="flex flex-wrap gap-3">
              <Button variant="primary" onClick={() => void send()} loading={sending} disabled={over}>Send</Button>
              <Button variant="outline" onClick={() => setStep(category === 'worried' ? 'help' : 'choose')} disabled={sending}>
                Back
              </Button>
            </div>
          </>
        )}

        {step === 'sent' && (
          <div role="status" aria-live="polite" className="space-y-4">
            {heading('Thank you')}
            <p className="text-sm text-theme-text-body">Your report has been sent to the Amani team.</p>
            {category === 'worried' && (
              <p className="text-sm text-theme-text-body">{WORRIED_HELP_LINES[1]}</p>
            )}
            <Button variant="primary" onClick={onClose}>Done</Button>
          </div>
        )}
      </div>
    </Modal>
  );
}
