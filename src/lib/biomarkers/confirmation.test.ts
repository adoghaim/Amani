import { describe, expect, it } from 'vitest';
import { isUnconfirmedReading, unconfirmedReadingKeys, isUnconfirmedBiomarker, withoutUnconfirmed } from './confirmation';

// Synthetic rows only.
const analyte = (over: Record<string, unknown> = {}) => ({
  lab_report_id: 'r1', canonical_slug: 'tsh', value_numeric: 0.0008, raw_value_text: '0.0008',
  confidence_score: 'low', needs_review: true, reviewed_by_user: false, ...over,
});

describe('isUnconfirmedReading (F022)', () => {
  it('a value read with low confidence that she has not confirmed', () => {
    expect(isUnconfirmedReading(analyte())).toBe(true);
  });

  it('a result printed below a limit, read with high confidence, that she has not confirmed', () => {
    expect(isUnconfirmedReading(analyte({ canonical_slug: 'vitamin_b12', value_numeric: 75, raw_value_text: '<150', confidence_score: 'high' }))).toBe(true);
  });

  it.each([
    ['she marked it correct', { needs_review: false, reviewed_by_user: true, confidence_score: 'high' }],
    ['she corrected the value', { needs_review: false, reviewed_by_user: true }],
    ['she confirmed it but the flag was kept', { reviewed_by_user: true }],
    ['it was never flagged', { needs_review: false }],
    // PK-FIX-05: several printed intervals; the value itself was read cleanly.
    ['its lab printed several intervals', { canonical_slug: 'progesterone', value_numeric: 8.2, raw_value_text: '8.2', confidence_score: 'medium' }],
    ['the review columns are absent', { needs_review: undefined, reviewed_by_user: undefined }],
  ])('not when %s', (_, over) => {
    expect(isUnconfirmedReading(analyte(over))).toBe(false);
  });
});

describe('matching a scored value to its report_analytes row', () => {
  const keys = unconfirmedReadingKeys([
    analyte(),
    analyte({ lab_report_id: 'r2', canonical_slug: 'ferritin', value_numeric: 8, raw_value_text: '8', confidence_score: 'high' }),
  ]);

  it('by report, name and value', () => {
    expect(isUnconfirmedBiomarker({ lab_report_id: 'r1', name: 'tsh', value: 0.0008 }, keys)).toBe(true);
    expect(isUnconfirmedBiomarker({ lab_report_id: 'r2', name: 'tsh', value: 0.0008 }, keys)).toBe(false);
    expect(isUnconfirmedBiomarker({ lab_report_id: 'r1', name: 'tsh', value: 0.8 }, keys)).toBe(false);
    expect(isUnconfirmedBiomarker({ lab_report_id: 'r1', name: 'free_t4', value: 0.0008 }, keys)).toBe(false);
  });

  it('a confirmed or cleanly read row marks nothing', () => {
    expect(isUnconfirmedBiomarker({ lab_report_id: 'r2', name: 'ferritin', value: 8 }, keys)).toBe(false);
  });

  it('withoutUnconfirmed drops only the unconfirmed values, in order', () => {
    const rows = [
      { id: 'a', lab_report_id: 'r1', name: 'ferritin', value: 8 },
      { id: 'b', lab_report_id: 'r1', name: 'tsh', value: 0.0008 },
      { id: 'c', lab_report_id: 'r2', name: 'tsh', value: 0.0008 },
    ];
    expect(withoutUnconfirmed(rows, [analyte()]).map(r => r.id)).toEqual(['a', 'c']);
    expect(withoutUnconfirmed(rows, [])).toEqual(rows);
  });
});
