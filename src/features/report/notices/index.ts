import type { ReportNotice } from './types';

export type { ReportNotice, ReportNoticeProps, ReportVersions, ShownExplanation } from './types';
export { shownExplanationOf, UNIDENTIFIED_EXPLANATION } from './versions';

/**
 * The report's notices slot (R22), top to bottom. ReportView mounts exactly
 * this list above the explanation through ReportNotices; each entry is given
 * the report and its versions and renders a CalmNotice or nothing.
 *
 * Adding a notice: write a component in this directory that takes
 * ReportNoticeProps and returns a CalmNotice (src/components/CalmNotice) or
 * null, then add one entry here where it belongs. Planned entries:
 *   - R19's stale marker, "This explanation was written before you corrected
 *     a value" (PK-CORRECT-01);
 *   - DT9's pause notice (PK-FIX-01b);
 *   - #105's calm regeneration-failure notices, which move here when #105
 *     rebases (SC6), with PK-PL-A's behaviour and copy unchanged.
 */
export const REPORT_NOTICES: readonly ReportNotice[] = [];
