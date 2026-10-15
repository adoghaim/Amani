import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown } from 'lucide-react';
import { AmaniLogo } from './AmaniLogo';
import { Button } from './Button';

/**
 * The one branded full-screen layout (D24; DESIGN.md `full-screen-gate`).
 *
 * Every takeover screen uses it: the update block (D8), the lock screen
 * (D15/D16), the consent steps (D4), the under-18 exit (D13) and the AI-consent
 * exit (D5). Later packets build those screens; this is only the layout.
 *
 * Top to bottom, left-aligned in the top third of the native splash ground
 * (`background`): the Amani logo, progress dots where steps apply, one heading
 * (focus moves to it when the gate opens, D23), one sentence, an optional
 * "What this means", the step's own control if it has one, a calm notice if its
 * action failed, one primary button and at most one quiet secondary link.
 *
 * It never shows a cycle day or any health value, the lock screen especially:
 * everything it renders is a string its caller wrote for the gate. Render it in
 * place of the page, not on top of it. It brings its own `main` landmark, and
 * content behind a gate must not be in the document at all.
 *
 * Each gate defines its own back behaviour (D23) where it is mounted.
 */

export interface GatePrimaryAction {
  label: string;
  onClick: () => void;
  /** The action is running: the button says so and cannot be pressed again. */
  busy?: boolean;
  /** For example, a consent step's Continue until its box is checked (D4). */
  disabled?: boolean;
}

/** The quiet secondary link: an in-app action, an app route or a web address. */
export type GateSecondaryLink =
  | { label: string; onClick: () => void }
  | { label: string; to: string }
  | { label: string; href: string };

export interface FullScreenGateProps {
  /** One heading. Focus moves to it on open, and again when it changes (the next step). */
  heading: string;
  /** One sentence under the heading. */
  sentence: string;
  /** "What this means": short paragraphs behind a disclosure, closed by default. */
  whatThisMeans?: string | readonly string[];
  /** Progress dots where steps apply: step `current` (counting from 1) of `total`. */
  progress?: { current: number; total: number };
  /** The step's own control, if it has one (consent's checkbox, D4). Never a cycle day or a health value. */
  children?: ReactNode;
  /** A calm notice when the step's action failed (D7). */
  notice?: ReactNode;
  primary: GatePrimaryAction;
  /** At most one quiet secondary link, for example "I'm under 18" or Retry. */
  secondary?: GateSecondaryLink;
}

const QUIET_LINK =
  '-ml-2 inline-flex min-h-[44px] items-center rounded-lg px-2 text-sm font-medium text-theme-primary-dark ' +
  'underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-theme-primary';

function SecondaryLink({ link }: { link: GateSecondaryLink }) {
  if ('to' in link) return <Link to={link.to} className={QUIET_LINK}>{link.label}</Link>;
  if ('href' in link) return <a href={link.href} className={QUIET_LINK}>{link.label}</a>;
  return <button type="button" onClick={link.onClick} className={QUIET_LINK}>{link.label}</button>;
}

function ProgressDots({ current, total, id }: { current: number; total: number; id: string }) {
  return (
    <div className="mt-8">
      <p id={id} className="sr-only">Step {current} of {total}</p>
      <ol aria-hidden="true" className="flex items-center gap-2">
        {Array.from({ length: total }, (_, index) => {
          const step = index + 1;
          const shape = step === current
            ? 'w-6 bg-theme-primary'
            : step < current
              ? 'w-2 bg-theme-primary'
              : 'w-2 border border-theme-muted-text-3';
          return <li key={step} data-step={step} className={`h-2 rounded-full ${shape}`} />;
        })}
      </ol>
    </div>
  );
}

export function FullScreenGate({
  heading, sentence, whatThisMeans, progress, children, notice, primary, secondary,
}: FullScreenGateProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [explained, setExplained] = useState(false);
  const stepId = useId();
  const explanationId = useId();

  // D23: focus moves to the heading when the gate opens, and when the next
  // step replaces this one. A new step starts with its explanation closed.
  useEffect(() => {
    setExplained(false);
    headingRef.current?.focus();
  }, [heading]);

  const paragraphs = whatThisMeans === undefined ? [] : typeof whatThisMeans === 'string' ? [whatThisMeans] : whatThisMeans;

  return (
    <div className="min-h-[100dvh] bg-theme-background text-theme-text safe-top safe-bottom safe-left safe-right">
      <main className="mx-auto flex w-full max-w-md flex-col px-4 pb-12 pt-14 sm:px-6">
        <AmaniLogo />

        {progress && <ProgressDots current={progress.current} total={progress.total} id={stepId} />}

        <h1
          ref={headingRef}
          tabIndex={-1}
          aria-describedby={progress ? stepId : undefined}
          className={`${progress ? 'mt-6' : 'mt-8'} text-3xl leading-tight focus:outline-none`}
        >
          {heading}
        </h1>
        <p className="mt-3 text-base text-theme-text-body">{sentence}</p>

        {paragraphs.length > 0 && (
          <div className="mt-4">
            <button
              type="button"
              aria-expanded={explained}
              aria-controls={explanationId}
              onClick={() => setExplained(open => !open)}
              className={QUIET_LINK}
            >
              What this means
              <ChevronDown aria-hidden="true" className={`ml-1.5 h-4 w-4 ${explained ? 'rotate-180' : ''}`} />
            </button>
            <div id={explanationId} hidden={!explained} className="mt-1 space-y-2 text-sm text-theme-text-body">
              {paragraphs.map((paragraph, index) => <p key={index}>{paragraph}</p>)}
            </div>
          </div>
        )}

        {children && <div className="mt-6">{children}</div>}
        {notice && <div className="mt-6">{notice}</div>}

        <div className="mt-8 flex flex-col items-start gap-2">
          <Button
            className="w-full sm:w-auto"
            onClick={primary.onClick}
            loading={primary.busy}
            disabled={primary.disabled}
          >
            {primary.label}
          </Button>
          {secondary && <SecondaryLink link={secondary} />}
        </div>
      </main>
    </div>
  );
}
