import { Flag, RefreshCw, Sparkles, Trash2 } from 'lucide-react';
import { DELETE_REPORT_ACTION_ID } from './arrange';
import type { ReportHeaderAction } from './types';

export { arrangeReportHeader, reportHeaderProblems, DELETE_REPORT_ACTION_ID } from './arrange';
export type { ArrangedReportHeader, ArrangedReportHeaderAction } from './arrange';
export type { ReportHeaderAction, ReportHeaderContext, ResolvedReportHeaderAction } from './types';

/**
 * The report header's actions (D19; PK-INT-01 DT2), in order. ReportView
 * mounts exactly this list through ReportHeaderActions: one primary action
 * plus a labelled More menu, with Delete report last.
 *
 * Adding a header action: add one entry here, at its D19 place, resolving
 * from the context ReportView passes (./types.ts). Reserved places:
 *   - 'prepare-visit' (PK-VISIT-01), `primary` and `more`, straight after
 *     'generate-full-analysis': the primary when the full analysis is not
 *     on offer, otherwise first in More;
 *   - 'report-problem' (PK-HARM-01), `more`, straight before 'delete-report'.
 *
 * 'generate-full-analysis' and 'regenerate' are the one regeneration button the
 * header had, labelled by the stored tier; only its place changed. Its
 * behaviour and copy are PK-PL-A's (D19, D6.3).
 */
export const REPORT_HEADER_ACTIONS: readonly ReportHeaderAction[] = [
  {
    id: 'generate-full-analysis',
    primary: true,
    resolve: ({ regeneration }) => (regeneration.available && regeneration.upgrade ? {
      label: 'Generate full Amani analysis',
      icon: Sparkles,
      onSelect: regeneration.run,
      disabled: regeneration.busy,
      busy: regeneration.busy,
    } : null),
  },
  {
    id: 'regenerate',
    more: true,
    resolve: ({ regeneration }) => (regeneration.available && !regeneration.upgrade ? {
      label: `Regenerate (${regeneration.remaining} left)`,
      icon: RefreshCw,
      onSelect: regeneration.run,
      disabled: regeneration.busy,
      busy: regeneration.busy,
    } : null),
  },
  {
    // PK-HARM-01 (D20): behind features.interpretation_feedback, which ReportView reads.
    id: 'report-problem',
    more: true,
    resolve: ({ reportProblem }) => (reportProblem ? { label: 'Report a problem', icon: Flag, onSelect: reportProblem } : null),
  },
  {
    id: DELETE_REPORT_ACTION_ID,
    more: true,
    resolve: ({ deleteReport }) => ({ label: 'Delete report', icon: Trash2, onSelect: deleteReport, tone: 'danger' }),
  },
];
