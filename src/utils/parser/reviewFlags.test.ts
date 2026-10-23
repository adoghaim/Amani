import { describe, expect, it } from 'vitest';
import { awaitsHerConfirmation, withReviewFlags } from './reviewFlags';
import type { ReportItem } from './types';

// Rows as extract-biomarkers or OCR return them: no parse_error field. Synthetic values.
const modelRow = (over: Partial<ReportItem> = {}): ReportItem => ({
  raw_name: 'TSH', canonical_slug: 'tsh', category: 'thyroid', value_numeric: 0.0008, value_text: '0.0008', unit: 'mIU/L',
  raw_reference_range: '0.40-4.50', normalized_reference_min: 0.4, normalized_reference_max: 4.5,
  reference_operator: null, reference_operator_value: null, confidence_score: 'high', is_core_biomarker: true,
  needs_review: false, source_snippet: null, ...over,
});

describe('withReviewFlags: the parser\'s review rules on every row of the confirm step (F022, F098)', () => {
  it('a model row outside physiological bounds gets the parser\'s parse error and needs her review', () => {
    expect(withReviewFlags(modelRow())).toMatchObject({
      parse_error: 'Value 0.0008 is below physiological minimum 0.001 for TSH — likely a parse error',
      needs_review: true,
    });
  });

  it('a model row printed below a limit needs her review; its number is unchanged', () => {
    const row = withReviewFlags(modelRow({ canonical_slug: 'vitamin_b12', value_numeric: 75, value_text: '<150', unit: 'pg/mL' }));
    expect(row).toMatchObject({ needs_review: true, parse_error: null, value_numeric: 75 });
  });

  it('a cleanly read row is unchanged', () => {
    const clean = modelRow({ value_numeric: 2.1, value_text: '2.1' });
    expect(withReviewFlags(clean)).toEqual({ ...clean, parse_error: null });
  });

  it('keeps the parser\'s own verdict and flag', () => {
    expect(withReviewFlags(modelRow({ parse_error: 'kept as the parser wrote it', needs_review: true }))).toMatchObject({
      parse_error: 'kept as the parser wrote it', needs_review: true,
    });
    expect(withReviewFlags(modelRow({ value_numeric: 2.1, value_text: '2.1', needs_review: true })).needs_review).toBe(true);
  });

  it.each([
    ['a qualitative result', { value_numeric: 0, value_text: 'Negative' }],
    ['a row with no catalog slug', { canonical_slug: null }],
    ['a slug with no physiological bounds', { canonical_slug: 'estradiol', value_numeric: 0.0008 }],
  ])('checks no bounds for %s', (_, over) => {
    expect(withReviewFlags(modelRow(over)).parse_error).toBeNull();
  });
});

describe('awaitsHerConfirmation: what keeps "Save and analyze" closed', () => {
  it('a parse-error row she has not confirmed, corrected or removed', () => {
    expect(awaitsHerConfirmation(withReviewFlags(modelRow()))).toBe(true);
  });

  it('not once she marks it correct or types her value', () => {
    expect(awaitsHerConfirmation({ ...withReviewFlags(modelRow()), reviewed_by_user: true })).toBe(false);
  });

  it('not for a row flagged for another reason', () => {
    expect(awaitsHerConfirmation(withReviewFlags(modelRow({ value_numeric: 75, value_text: '<150', canonical_slug: 'vitamin_b12' })))).toBe(false);
  });
});
