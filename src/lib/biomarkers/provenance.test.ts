import { describe, expect, it } from 'vitest';
import {
  canClaimFavourableDirection, canDescribeAsOptimal, isReviewedRange, NO_CLAIM_EVIDENCE,
  type ClaimEvidence, type RangeProvenance,
} from './provenance';

// Synthetic policy fixture; not a citation or clinical review.
const reviewed: RangeProvenance = {
  evidence_grade: 'A', review_status: 'SAFE', source: 'test fixture',
  source_date: '2000-01-01', reviewer: 'test reviewer', reviewed_at: '2000-01-01',
};
const allClaims: ClaimEvidence = { optimal_target: true, favourable_direction: true };

describe('provenance presentation eligibility', () => {
  it('a reviewed range requires affirmative evidence and review', () => {
    expect(isReviewedRange(reviewed)).toBe(true);
    expect(isReviewedRange({ ...reviewed, evidence_grade: 'unsourced' })).toBe(false);
    for (const review_status of ['UNKNOWN', 'DISPUTED', 'NEEDS_CONTEXT'] as const) {
      expect(isReviewedRange({ ...reviewed, review_status })).toBe(false);
    }
    for (const field of ['source', 'source_date', 'reviewer', 'reviewed_at'] as const) {
      expect(isReviewedRange({ ...reviewed, [field]: null })).toBe(false);
      expect(isReviewedRange({ ...reviewed, [field]: ' ' })).toBe(false);
    }
  });

  // Amendment 4 R2: replaces the pre-amendment assertion that a SAFE, sourced
  // range alone could be called "optimal". Stronger: every review-side
  // failure still blocks the word, and so does missing claim evidence.
  it('SAFE alone never authorizes "optimal"; it needs optimal-target evidence too', () => {
    expect(canDescribeAsOptimal(reviewed, NO_CLAIM_EVIDENCE)).toBe(false);
    expect(canDescribeAsOptimal(reviewed, { ...NO_CLAIM_EVIDENCE, favourable_direction: true })).toBe(false);
    expect(canDescribeAsOptimal(reviewed, { ...NO_CLAIM_EVIDENCE, optimal_target: true })).toBe(true);
    for (const review_status of ['UNKNOWN', 'DISPUTED', 'NEEDS_CONTEXT'] as const) {
      expect(canDescribeAsOptimal({ ...reviewed, review_status }, allClaims)).toBe(false);
    }
    expect(canDescribeAsOptimal({ ...reviewed, evidence_grade: 'unsourced' }, allClaims)).toBe(false);
    for (const field of ['source', 'source_date', 'reviewer', 'reviewed_at'] as const) {
      expect(canDescribeAsOptimal({ ...reviewed, [field]: null }, allClaims)).toBe(false);
    }
  });

  it('SAFE alone never authorizes a favourable direction; it needs directional evidence too', () => {
    expect(canClaimFavourableDirection(reviewed, NO_CLAIM_EVIDENCE)).toBe(false);
    expect(canClaimFavourableDirection(reviewed, { ...NO_CLAIM_EVIDENCE, optimal_target: true })).toBe(false);
    expect(canClaimFavourableDirection(reviewed, { ...NO_CLAIM_EVIDENCE, favourable_direction: true })).toBe(true);
    for (const review_status of ['UNKNOWN', 'DISPUTED', 'NEEDS_CONTEXT'] as const) {
      expect(canClaimFavourableDirection({ ...reviewed, review_status }, allClaims)).toBe(false);
    }
  });

  it('NO_CLAIM_EVIDENCE cannot be mutated into evidence', () => {
    expect(Object.isFrozen(NO_CLAIM_EVIDENCE)).toBe(true);
  });
});
