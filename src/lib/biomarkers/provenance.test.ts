import { describe, expect, it } from 'vitest';
import { canDescribeAsOptimal, type RangeProvenance } from './provenance';

// Synthetic policy fixture; not a citation or clinical review.
const reviewed: RangeProvenance = {
  evidence_grade: 'A', review_status: 'SAFE', source: 'test fixture',
  source_date: '2000-01-01', reviewer: 'test reviewer', reviewed_at: '2000-01-01',
};

describe('provenance presentation eligibility', () => {
  it('requires affirmative evidence and review', () => {
    expect(canDescribeAsOptimal(reviewed)).toBe(true);
    expect(canDescribeAsOptimal({ ...reviewed, evidence_grade: 'unsourced' })).toBe(false);
    for (const review_status of ['UNKNOWN', 'DISPUTED', 'NEEDS_CONTEXT'] as const) {
      expect(canDescribeAsOptimal({ ...reviewed, review_status })).toBe(false);
    }
    for (const field of ['source', 'source_date', 'reviewer', 'reviewed_at'] as const) {
      expect(canDescribeAsOptimal({ ...reviewed, [field]: null })).toBe(false);
      expect(canDescribeAsOptimal({ ...reviewed, [field]: ' ' })).toBe(false);
    }
  });
});
