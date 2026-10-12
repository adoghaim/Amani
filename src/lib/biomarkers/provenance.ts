/** Eligibility for a future provenance-aware presentation, not legacy scoring. */
export interface RangeProvenance {
  evidence_grade: 'A' | 'B' | 'C' | 'expert_opinion' | 'unsourced';
  review_status: 'SAFE' | 'NEEDS_CONTEXT' | 'DISPUTED' | 'UNKNOWN';
  source: string | null;
  source_date: string | null;
  reviewer: string | null;
  reviewed_at: string | null;
}

/*
  V2-03 amendment 4 (R2, the owner's trap). A SAFE review approves a range as a
  reference or decision interval. It does not, by itself, support calling a
  value inside it "optimal", nor calling movement toward it favourable: each of
  those is a stronger claim that needs evidence for that specific claim. The
  catalog records no claim-specific evidence for any band, so every band
  carries NO_CLAIM_EVIDENCE and nothing infers it from review status or prose.
*/
export interface ClaimEvidence {
  /** Evidence specifically supports an optimal target, not merely a reference or decision interval. */
  optimal_target: boolean;
  /** Evidence supports calling movement toward this band clinically favourable. */
  favourable_direction: boolean;
}

export const NO_CLAIM_EVIDENCE: ClaimEvidence = Object.freeze({ optimal_target: false, favourable_direction: false });

/** Fail closed: a reviewed range has SAFE status and complete provenance. */
export function isReviewedRange(range: RangeProvenance): boolean {
  return range.evidence_grade !== 'unsourced'
    && range.review_status === 'SAFE'
    && Boolean(range.source?.trim())
    && Boolean(range.source_date?.trim())
    && Boolean(range.reviewer?.trim())
    && Boolean(range.reviewed_at?.trim());
}

/** "Optimal" needs a reviewed range AND evidence for an optimal target. */
export function canDescribeAsOptimal(range: RangeProvenance, claims: ClaimEvidence): boolean {
  return isReviewedRange(range) && claims.optimal_target === true;
}

/** "Improved", or a success indicator, needs a reviewed range AND directional evidence. */
export function canClaimFavourableDirection(range: RangeProvenance, claims: ClaimEvidence): boolean {
  return isReviewedRange(range) && claims.favourable_direction === true;
}
