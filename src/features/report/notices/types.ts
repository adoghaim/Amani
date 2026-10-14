import type { ComponentType } from 'react';
import type { CalmNoticeAction } from '../../../components/CalmNotice';
import type { LabReport } from '../../../types';

/**
 * The explanation on screen, as far as ReportView knows it. Each field is
 * null when the read that produced the explanation did not return it.
 */
export interface ShownExplanation {
  /** The interpretation row the reader served: under V2, the selected version's id. */
  id: string | null;
  /** When it was written: under V2, the selected version's generated_at. */
  generatedAt: string | null;
}

/** The report's explanation versions (R22). Extend it here when a notice needs more. */
export interface ReportVersions {
  /** The explanation on screen, or null while none is shown. */
  shown: ShownExplanation | null;
  /**
   * PK-CORRECT-01 (R19): when she last corrected one of this report's values
   * (the corrected views' newest corrected_at), or null/absent when none is
   * corrected or features.value_corrections is off.
   */
  newestCorrectionAt?: string | null;
}

/** Page actions a notice may offer as its one CalmNotice action. Absent: not offered. */
export interface ReportNoticeActions {
  /** PK-CORRECT-01 (R19): ask for a new explanation version, written from the corrected values. */
  refreshExplanation?: CalmNoticeAction & {
    /** The last refresh failed; the notice says so and offers it again. */
    failed?: boolean;
  };
}

/** What every report notice is given (R22): the report and its versions. */
export interface ReportNoticeProps {
  report: LabReport;
  versions: ReportVersions;
  /** The page's actions a notice may offer. */
  actions?: ReportNoticeActions;
}

/** One entry in the ordered list the notices slot mounts (./index.ts). */
export interface ReportNotice {
  /** Stable, unique key. */
  id: string;
  /** Renders a CalmNotice when it applies, otherwise null. */
  Component: ComponentType<ReportNoticeProps>;
}
