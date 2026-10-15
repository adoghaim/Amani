import { Info } from 'lucide-react';
import { Button } from './Button';

/**
 * The calm notice (D7; DESIGN.md `calm-notice`): something did not go as
 * planned, and nothing of hers was lost. Three short lines:
 *
 *   1. what happened (`title`);
 *   2. what's safe (`safe`, "Your reports and results are saved." unless the
 *      caller has a more exact line, such as "Your current analysis is
 *      unchanged.");
 *   3. what to do next: at most one action, such as Try again.
 *
 * Theme surface, a hairline border and the Info icon in mauve. It never takes
 * the rose or error colours: `Alert` stays for genuine errors. It is announced
 * politely, so a screen reader hears it without being interrupted.
 *
 * Used by the kill-switch pause, failed regeneration and export (D7), and by
 * every notice in the report's notices slot (R22).
 */

export const CALM_NOTICE_SAFE_LINE = 'Your reports and results are saved.';

export interface CalmNoticeAction {
  label: string;
  onClick: () => void;
  /** The action is running: its button says so and cannot be pressed again. */
  busy?: boolean;
}

export interface CalmNoticeProps {
  /** What happened, in one line. */
  title: string;
  /** What's safe, in one line. */
  safe?: string;
  /** What to do next: one optional action. */
  action?: CalmNoticeAction;
  className?: string;
}

export function CalmNotice({ title, safe = CALM_NOTICE_SAFE_LINE, action, className = '' }: CalmNoticeProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={`flex items-start gap-3 rounded-lg border border-theme-border-subtle bg-theme-surface p-4 ${className}`}
    >
      <Info aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-theme-primary" />
      <div className="min-w-0 flex-1 break-words">
        <p className="text-sm font-medium text-theme-text">{title}</p>
        <p className="mt-1 text-sm text-theme-text-body">{safe}</p>
        {action && (
          <div className="mt-3">
            <Button variant="outline" size="sm" onClick={action.onClick} loading={action.busy}>
              {action.label}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
