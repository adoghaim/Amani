import type { ComponentType } from 'react';
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
   * PK-FIX-01b (DT9): the last generation request for this report, in this
   * session, answered that the AI is paused, so the explanation shown is the
   * basic one. Absent means no pause was reported.
   */
  aiPaused?: boolean;
}

/** What every report notice is given (R22): the report and its versions. */
export interface ReportNoticeProps {
  report: LabReport;
  versions: ReportVersions;
}

/** One entry in the ordered list the notices slot mounts (./index.ts). */
export interface ReportNotice {
  /** Stable, unique key. */
  id: string;
  /** Renders a CalmNotice when it applies, otherwise null. */
  Component: ComponentType<ReportNoticeProps>;
}
