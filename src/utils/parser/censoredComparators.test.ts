import { describe, expect, it } from 'vitest';
import { parseAllReportItems, parseAllReportItemsWithDebug } from './pipeline';
import { parseValueWithPrefix } from './valueExtraction';
import { decideAiRefinement } from './aiRefinementGate';
import { questSmokeFixture } from './__fixtures__/questSmoke';
import { isCensoredValue } from '../../../supabase/functions/_shared/censored-value';
import { computeAmaniStatus } from '../../lib/scoring/scoreBiomarker';
import { buildInsightSummary } from '../../lib/insights/buildInsightSummary';

/*
  Review F021, fix wave 5. A result printed as an inclusive limit ('<=8', '≤8',
  '>=1000', '> OR = 60') lost its comparator in the local parser, the default
  PDF path: value_text became '8', '1000' or '60', so isCensoredValue was false
  and every censored-value guard downstream was skipped. A Quest eGFR printed
  '> OR = 60' was flagged low and stated as a measured 60. The printed text is
  kept, and the number is the existing placeholder (censoredPlaceholder: half
  a lower limit, an upper limit as printed). Rows are synthetic.
*/

const QUEST_HEAD = 'Quest Diagnostics\nSYNTHETIC TEST REPORT - NOT A REAL PATIENT\n'
  + 'Test Name Result Flag Reference Range Units\nTSH 2.85 0.40-4.50 mIU/L\n';

function row(line: string) {
  const items = parseAllReportItems(QUEST_HEAD + line).filter(i => i.canonical_slug !== 'tsh');
  expect(parseAllReportItemsWithDebug(QUEST_HEAD + line).items.filter(i => i.canonical_slug !== 'tsh')).toEqual(items);
  expect(items).toHaveLength(1);
  return items[0]!;
}

describe('parseValueWithPrefix keeps an inclusive comparator (F021)', () => {
  it.each([
    ['<=8', 4, '<=8'],
    ['< =8', 4, '< =8'],
    ['≤8', 4, '≤8'],
    ['≤ 0.5', 0.25, '≤ 0.5'],
    ['< OR = 0.5', 0.25, '< OR = 0.5'],
    ['<OR=150', 75, '<OR=150'],
    ['>=1000', 1000, '>=1000'],
    ['≥60', 60, '≥60'],
    ['> OR = 60', 60, '> OR = 60'],
    ['> or = 60', 60, '> or = 60'],
  ])('%s keeps its printed text, with the placeholder %s', (text, value, rawValue) => {
    const parsed = parseValueWithPrefix(text);
    expect(parsed).toEqual({ value, rawValue });
    expect(isCensoredValue(parsed!.rawValue)).toBe(true);
  });

  it('leaves the strict and measured forms as they were', () => {
    expect(parseValueWithPrefix('<8')).toEqual({ value: 4, rawValue: '<8' });
    expect(parseValueWithPrefix('>1000')).toEqual({ value: 1000, rawValue: '>1000' });
    expect(parseValueWithPrefix('24')).toEqual({ value: 24, rawValue: '24' });
  });
});

describe('the local parser keeps an inclusive comparator on a result row (F021)', () => {
  it.each([
    ['Vitamin D, 25-OH, Total <=8 L 30-100 ng/mL', 'vitamin_d_25_oh', '<=8', 4],
    ['Vitamin D, 25-OH, Total ≤8 L 30-100 ng/mL', 'vitamin_d_25_oh', '≤8', 4],
    ['Vitamin D, 25-OH, Total < OR = 8 L 30-100 ng/mL', 'vitamin_d_25_oh', '< OR = 8', 4],
    ['Ferritin >=1000 H 16-154 ng/mL', 'ferritin', '>=1000', 1000],
    ['Ferritin ≥1000 H 16-154 ng/mL', 'ferritin', '≥1000', 1000],
    ['eGFR > OR = 60 > OR = 60 mL/min/1.73m2', 'egfr', '> OR = 60', 60],
    // The result printed on the line below the name.
    ['Vitamin D, 25-OH, Total\n<=8 L 30-100 ng/mL', 'vitamin_d_25_oh', '<=8', 4],
    ['eGFR\n> OR = 60 mL/min/1.73m2', 'egfr', '> OR = 60', 60],
  ])('%j', (line, slug, text, value) => {
    const item = row(line);
    expect(item).toMatchObject({ canonical_slug: slug, value_text: text, value_numeric: value });
    expect(isCensoredValue(item.value_text)).toBe(true);
  });

  it('still reads a measured result beside an inclusive reference limit', () => {
    expect(row('eGFR 61 > OR = 60 mL/min/1.73m2')).toMatchObject({ canonical_slug: 'egfr', value_text: '61', value_numeric: 61 });
    expect(row('HDL Cholesterol 61 > OR = 50 mg/dL')).toMatchObject({ canonical_slug: 'hdl_cholesterol', value_text: '61', value_numeric: 61 });
    expect(row('eGFR\n75 > OR = 60 mL/min/1.73m2')).toMatchObject({ canonical_slug: 'egfr', value_text: '75', value_numeric: 75 });
    // A phase interval printed on the result row is one of her intervals, not her result.
    expect(row('PROGESTERONE 8.2 ng/mL Follicular Phase <=1.1\n    Luteal Phase 2.2-22.2'))
      .toMatchObject({ canonical_slug: 'progesterone', value_text: '8.2', value_numeric: 8.2 });
    expect(row('ESTRADIOL 145 pg/mL Postmenopausal < OR = 31\n    Follicular Phase 21-121\n    Luteal Phase 51-251'))
      .toMatchObject({ canonical_slug: 'estradiol', value_text: '145', value_numeric: 145 });
  });

  it('a Quest eGFR "> OR = 60" uploaded as a PDF is neither flagged low nor stated as a measured 60', () => {
    const { items, debug, heuristics } = parseAllReportItemsWithDebug(
      `${questSmokeFixture}\neGFR > OR = 60 > OR = 60 mL/min/1.73m2`, 'synthetic-quest.pdf');
    // The default path: no OCR fallback and no AI refinement runs for this upload.
    expect(heuristics.isWeak).toBe(false);
    expect(decideAiRefinement({ items, heuristics, detectedSource: debug.detectedSource }).refine).toBe(false);

    const egfr = items.find(i => i.canonical_slug === 'egfr')!;
    expect(egfr).toMatchObject({ value_text: '> OR = 60', value_numeric: 60 });
    // NewReport saves the biomarkers row's flag from this status.
    expect(computeAmaniStatus('egfr', egfr.value_numeric, null, null, egfr.unit ?? '', egfr.value_text))
      .not.toMatch(/^out_of_range|^borderline/);

    const summary = buildInsightSummary([{
      key: 'egfr', value: egfr.value_numeric, unit: egfr.unit ?? '', valueText: egfr.value_text,
      labRefMin: egfr.normalized_reference_min, labRefMax: egfr.normalized_reference_max,
    }], null, null, null, null);
    expect(summary.primaryFinding?.key).not.toBe('egfr');
  });
});
