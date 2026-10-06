/** Eligibility for a future provenance-aware presentation, not legacy scoring. */
export interface RangeProvenance {
  evidence_grade: 'A' | 'B' | 'C' | 'expert_opinion' | 'unsourced';
  review_status: 'SAFE' | 'NEEDS_CONTEXT' | 'DISPUTED' | 'UNKNOWN';
  source: string | null;
  source_date: string | null;
  reviewer: string | null;
  reviewed_at: string | null;
}

/** Fail closed: contextual, disputed and unreviewed bands need different copy. */
export function canDescribeAsOptimal(range: RangeProvenance): boolean {
  return range.evidence_grade !== 'unsourced'
    && range.review_status === 'SAFE'
    && Boolean(range.source?.trim())
    && Boolean(range.source_date?.trim())
    && Boolean(range.reviewer?.trim())
    && Boolean(range.reviewed_at?.trim());
}
