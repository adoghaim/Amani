import { CalmNotice } from '../../../components/CalmNotice';
import { isExplanationStale, REFRESH_EXPLANATION_LABEL, STALE_EXPLANATION_TEXT } from '../../../lib/corrections/provenance';
import type { ReportNoticeProps } from './types';

/**
 * R19 (PK-CORRECT-01): when her newest correction is later than the time the
 * explanation on screen was written, the explanation is marked, and kept
 * readable, with one Refresh explanation action. The refresh asks for a new
 * version through V2's versioned writer; it never rewrites one in place.
 *
 * Renders nothing when no explanation is on screen, when nothing is corrected
 * (always the case while features.value_corrections is off, since the page
 * then reads the raw tables) or when the explanation is newer than the
 * correction. The copy goes through the clinical reviewer (D7.9).
 */
export function StaleExplanationNotice({ versions, actions }: ReportNoticeProps) {
  if (!versions.shown) return null;
  if (!isExplanationStale(versions.newestCorrectionAt ?? null, versions.shown.generatedAt)) return null;
  const refresh = actions?.refreshExplanation;
  return (
    <div data-stale-explanation>
      <CalmNotice
        title={STALE_EXPLANATION_TEXT}
        safe={refresh?.failed
          ? "We couldn't refresh it just now. Your corrected value is saved."
          : 'Your corrected value is saved.'}
        action={refresh ? { label: REFRESH_EXPLANATION_LABEL, onClick: refresh.onClick, busy: refresh.busy } : undefined}
      />
    </div>
  );
}
