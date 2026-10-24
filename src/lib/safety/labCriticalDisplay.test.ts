import { describe, expect, it } from 'vitest';
import { keyOf } from '../biomarkers/confirmation';
import { labCriticalDisplay, type CriticalDisplayAnalyte } from './labCriticalDisplay';
import {
  findLabCriticalFlags, LAB_CRITICAL_FLAG_RULE, type CriticalFlagAnalyte, type LabCriticalFinding,
} from './labCriticalFlags';

/*
  RV-CR1: the report page's notice, result rows and result cards read one
  findLabCriticalFlags result. This index only places each finding's printed
  token: on its row (by report_analytes id) and on its card (by the reading key
  confirmation.ts matches a biomarkers row to its analyte with). Synthetic
  rows; the intervals are placeholders, not clinical ranges.
*/
const REPORT = '00000000-0000-4000-a000-0000000c0151';

type Row = CriticalFlagAnalyte & CriticalDisplayAnalyte;
const row = (id: string, slug: string | null, value: number | null, snippet: string, over: Partial<Row> = {}): Row => ({
  id, lab_report_id: REPORT, canonical_slug: slug, raw_name: slug ?? 'unmapped result', display_name: null,
  raw_value_text: value == null ? null : String(value), value_numeric: value, unit: 'mmol/L', unit_original: 'mmol/L',
  source_snippet: snippet, ...over,
});
const finding = (analyteId: string, printed: string, marker: string): LabCriticalFinding =>
  Object.freeze({ ...LAB_CRITICAL_FLAG_RULE, analyteId, name: analyteId, marker, printed });
const entries = (map: ReadonlyMap<string, string>) => [...map.entries()];

describe('labCriticalDisplay: each finding\'s printed token, on its row and on its card', () => {
  it('maps findings to analyte ids (rows) and to reading keys (cards), the token as printed, never the marker', () => {
    const rows = [
      row('k', 'potassium', 6.8, 'Potassium 6.8 mmol/L Critical 3.5-5.3'),
      row('na', 'sodium', 118, 'Sodium 118 Alert 135-146 mmol/L'),
      row('ua', 'uric_acid', 8.1, 'Uric Acid 8.1 H 2.5-7.0 mg/dL', { unit: 'mg/dL', unit_original: 'mg/dL' }),
    ];
    const display = labCriticalDisplay(rows, [finding('k', 'Critical', 'CRITICAL'), finding('na', 'Alert', 'ALERT')]);
    expect(entries(display.rows)).toEqual([['k', 'Critical'], ['na', 'Alert']]);
    expect(entries(display.cards)).toEqual([[keyOf(REPORT, 'potassium', 6.8), 'Critical'], [keyOf(REPORT, 'sodium', 118), 'Alert']]);
  });

  it('reads no line itself: no finding, no token, whatever the line says', () => {
    const rows = [row('k', 'potassium', 6.8, 'Potassium 6.8 mmol/L Critical 3.5-5.3'), row('hh', 'potassium', 6.9, 'Potassium 6.9 HH')];
    const display = labCriticalDisplay(rows, []);
    expect(display.rows.size).toBe(0);
    expect(display.cards.size).toBe(0);
  });

  it('from the real recognizer: every position it reads reaches the row and the card, as printed', () => {
    const rows = [
      row('after-value', 'potassium', 6.8, 'Potassium 6.8 Critical mmol/L 3.5-5.2'),
      row('after-unit', 'ionized_calcium', 1.85, 'Ionized Calcium 1.85 mmol/L HH 1.12-1.32'),
      row('glued', 'sodium', 118, 'Sodium 118(Panic) mmol/L 135-146'),
      row('later', 'ca_125', 125, 'CA 125 125 HH* 0.0-35.0 U/mL', { unit: 'U/mL', unit_original: 'U/mL' }),
      row('ordinary', 'ferritin', 18, 'Ferritin 18 L 16-154 ng/mL', { unit: 'ng/mL', unit_original: 'ng/mL' }),
    ];
    const display = labCriticalDisplay(rows, findLabCriticalFlags(rows));
    expect(entries(display.rows)).toEqual([['after-value', 'Critical'], ['after-unit', 'HH'], ['glued', '(Panic)'], ['later', 'HH*']]);
    expect(entries(display.cards)).toEqual([
      [keyOf(REPORT, 'potassium', 6.8), 'Critical'], [keyOf(REPORT, 'ionized_calcium', 1.85), 'HH'],
      [keyOf(REPORT, 'sodium', 118), '(Panic)'], [keyOf(REPORT, 'ca_125', 125), 'HH*'],
    ]);
  });

  it('when two rows share a reading key, the first in row order wins the card', () => {
    const rows = [row('first', 'potassium', 6.8, 'Potassium 6.8 HH'), row('second', 'potassium', 6.8, 'Potassium 6.8 (HH)')];
    // In whatever order the findings arrive.
    for (const findings of [
      [finding('first', 'HH', 'HH'), finding('second', '(HH)', 'HH')],
      [finding('second', '(HH)', 'HH'), finding('first', 'HH', 'HH')],
    ]) {
      const display = labCriticalDisplay(rows, findings);
      expect(entries(display.cards)).toEqual([[keyOf(REPORT, 'potassium', 6.8), 'HH']]);
      expect(entries(display.rows)).toEqual([['first', 'HH'], ['second', '(HH)']]);
    }
    // A duplicate with no marker does not hide the one that has it.
    const display = labCriticalDisplay([row('plain', 'potassium', 6.8, 'Potassium 6.8'), rows[1]!], [finding('second', '(HH)', 'HH')]);
    expect(entries(display.cards)).toEqual([[keyOf(REPORT, 'potassium', 6.8), '(HH)']]);
  });

  it('a row with no slug or no value maps to a row only', () => {
    const rows = [
      row('unmapped', null, 450, 'Glucose, Plasma 450 Panic mg/dL 65-99'),
      row('censored', 'platelets', null, 'Platelets <10 CRIT x10E3/uL 150-450', { raw_value_text: '<10', unit: 'x10E3/uL', unit_original: 'x10E3/uL' }),
    ];
    const display = labCriticalDisplay(rows, findLabCriticalFlags(rows));
    expect(entries(display.rows)).toEqual([['unmapped', 'Panic'], ['censored', 'CRIT']]);
    expect(display.cards.size).toBe(0);
  });

  it('is deterministic, and leaves its frozen input unchanged', () => {
    const rows = Object.freeze([
      row('k', 'potassium', 6.8, 'Potassium 6.8 mmol/L Critical 3.5-5.3'),
      row('dup', 'potassium', 6.8, 'Potassium 6.8 LL'),
      row('lac', null, 6.1, 'Lactate 6.1 (Panic) mmol/L 0.5-2.2'),
    ].map(r => Object.freeze(r)));
    const findings = Object.freeze(findLabCriticalFlags(rows));
    const before = JSON.stringify([rows, findings]);
    const first = labCriticalDisplay(rows, findings);
    expect(entries(first.rows)).toEqual([['k', 'Critical'], ['dup', 'LL'], ['lac', '(Panic)']]);
    expect(entries(first.cards)).toEqual([[keyOf(REPORT, 'potassium', 6.8), 'Critical']]);
    for (let i = 0; i < 20; i++) {
      // Interleaved calls on other input leave no state behind.
      labCriticalDisplay([row(`x${i}`, 'sodium', i, `Sodium ${i} Alert`)], [finding(`x${i}`, 'Alert', 'ALERT')]);
      const again = labCriticalDisplay(rows, findings);
      expect(again.rows).not.toBe(first.rows);
      expect(entries(again.rows)).toEqual(entries(first.rows));
      expect(entries(again.cards)).toEqual(entries(first.cards));
    }
    expect(JSON.stringify([rows, findings])).toBe(before);
  });
});
