import type { LucideIcon } from 'lucide-react';
import type { NavigateFunction } from 'react-router-dom';
import type { LabReport } from '../../../types';

/**
 * What ReportView gives every header action (D19). It holds the page's own
 * state and handlers for the actions the header already had, so an action
 * here never re-implements them: PK-PL-A's regeneration rule, copy count and
 * request keying stay in ReportView.
 */
export interface ReportHeaderContext {
  report: LabReport;
  navigate: NavigateFunction;
  regeneration: {
    /** ReportView offers a regeneration of this report now. */
    available: boolean;
    /** The stored interpretation was written at the Free tier, so the offer is the full analysis. */
    upgrade: boolean;
    /** Regenerations left, as ReportView counts them. */
    remaining: number;
    /** A regeneration is running. */
    busy: boolean;
    run: () => void;
  };
  /** Deletes the report, behind its confirmation. */
  deleteReport: () => void;
}

/** One action as the header shows it, as the primary button or a More item. */
export interface ResolvedReportHeaderAction {
  label: string;
  icon: LucideIcon;
  onSelect: () => void;
  disabled?: boolean;
  /** The action is running: its icon turns. */
  busy?: boolean;
  tone?: 'danger';
}

/** One entry in the ordered list the header mounts (./index.ts). */
export interface ReportHeaderAction {
  /** Stable, unique key. */
  id: string;
  /** Can be the header's one primary action. The first available candidate, in list order, is. */
  primary?: boolean;
  /** Listed in More, in list order, whenever it is available and not the primary. */
  more?: boolean;
  /** The action for this report now, or null when it does not apply. */
  resolve: (context: ReportHeaderContext) => ResolvedReportHeaderAction | null;
}
