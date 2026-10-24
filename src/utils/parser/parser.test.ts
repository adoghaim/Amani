import { describe, expect, it } from 'vitest';
import { parseAllReportItems } from './pipeline';
import { detectReportSource } from './sourceDetection';
import { questFixture } from './__fixtures__/quest';
import { labcorpFixture } from './__fixtures__/labcorp';
import { honeFixture } from './__fixtures__/hone';
import { genericFixture } from './__fixtures__/generic';
import { edgeCasesFixture } from './__fixtures__/edgeCases';
import { questHormoneFixture } from './__fixtures__/questHormones';
import { labcorpHormoneFixture } from './__fixtures__/labcorpHormones';
import { awaitsHerCheck, awaitsHerConfirmation } from './reviewFlags';
import { isUnconfirmedReading } from '../../lib/biomarkers/confirmation';
import type { ReportItem } from './types';

// Snapshot regression harness for the parser pipeline.
// Each test pins current behavior of `parseAllReportItems` for a representative
// fixture. Snapshots are NOT a correctness check — a diff means parser
// behavior changed, which a reviewer must approve (or the test was the canary
// that caught the regression).

describe('parser pipeline (regression snapshots)', () => {
  it('Quest fixture: detects source and parses thyroid + iron + vitamin D panel', () => {
    expect(detectReportSource(questFixture)).toBe('quest');
    expect(parseAllReportItems(questFixture)).toMatchSnapshot();
  });

  it('LabCorp fixture: detects source and parses lipid + A1c panel via Ref. Interval format', () => {
    expect(detectReportSource(labcorpFixture)).toBe('labcorp');
    expect(parseAllReportItems(labcorpFixture)).toMatchSnapshot();
  });

  it('Hone fixture: detects source and parses cycle hormones via Optimal Range layout', () => {
    expect(detectReportSource(honeFixture)).toBe('hone');
    expect(parseAllReportItems(honeFixture)).toMatchSnapshot();
  });

  it('Generic fixture: falls back to unknown source and exercises extended-item heuristic', () => {
    expect(detectReportSource(genericFixture)).toBe('unknown');
    expect(parseAllReportItems(genericFixture)).toMatchSnapshot();
  });

  it('Edge cases: physiological bounds rejection, comparator value, and unmapped analyte', () => {
    expect(parseAllReportItems(edgeCasesFixture)).toMatchSnapshot();
  });

  // Synthetic hormone panels (PK-FIX-05). Their intervals are placeholders, not
  // clinical ranges (see the fixture headers). rangeBinding.test.ts asserts which
  // marker each interval belongs to; these snapshots pin the full output.
  it('Quest hormone fixture: phase intervals captured with labels, own-row intervals bound', () => {
    expect(detectReportSource(questHormoneFixture)).toBe('quest');
    expect(parseAllReportItems(questHormoneFixture)).toMatchSnapshot();
  });

  it('LabCorp hormone fixture: phase intervals captured, including one on the result row', () => {
    expect(detectReportSource(labcorpHormoneFixture)).toBe('labcorp');
    expect(parseAllReportItems(labcorpHormoneFixture)).toMatchSnapshot();
  });
});

/*
  What the snapshots above only pin, asserted (review F098). The edge-case
  fixture's third row is an analyte with no catalog entry; it must come out
  unmapped, not as Vitamin B12 because its name ends in "cobalamin". And a
  result printed below a limit ("<150") is stored as half the limit by the
  shared convention, which no lab measured: it waits for her confirmation.
*/
describe('parser pipeline (semantic assertions)', () => {
  const lab = (row: string) => `Lab Report\n\n${row}\n`;

  it.each([
    'Holotranscobalamin           42        pmol/L    50-150',
    'Holotranscobalamin           80        pmol/L    50-150',
    'Holotranscobalamin 80 pmol/L 50-150',
    'Transcobalamin II            950       pmol/L    700-1500',
    'Holotranscobalamin           <10       pmol/L    50-150',
  ])('a *cobalamin analyte is never read as Vitamin B12: %s', row => {
    expect(parseAllReportItems(lab(row)).filter(i => i.canonical_slug === 'vitamin_b12')).toEqual([]);
  });

  it('the edge-case fixture keeps Holotranscobalamin as its own unmapped row beside Vitamin B12', () => {
    const items = parseAllReportItems(edgeCasesFixture);
    expect(items.find(i => i.raw_name === 'Holotranscobalamin')).toMatchObject({
      canonical_slug: null, normalization_status: 'unmapped', excluded_reason: 'no_canonical_match',
      value_numeric: 42, unit: 'pmol/L',
    });
    const b12 = items.filter(i => i.canonical_slug === 'vitamin_b12');
    expect(b12).toHaveLength(1);
    expect(b12[0]?.source_snippet).toMatch(/^Vitamin B12\s+<150/);
  });

  it.each([
    ['Vitamin B12                  2000      pg/mL     232-1245', 2000],
    ['Vitamin B12                  150       pg/mL     232-1245', 150],
    ['Vitamin B12 2000 H 200-1100 pg/mL', 2000],
  ])('a Holotranscobalamin row still ends the B12 block above it: %s', (b12, value) => {
    const items = parseAllReportItems(lab(`${b12}\nHolotranscobalamin           42        pmol/L    50-150`));
    expect(items.filter(i => i.canonical_slug === 'vitamin_b12').map(i => i.value_numeric)).toEqual([value]);
  });

  it.each([
    ['Cobalamin                    410       pg/mL     232-1245', 'vitamin_b12'],
    ['Cyanocobalamin               410       pg/mL     232-1245', 'vitamin_b12'],
    ['Vitamin B12, Serum           410       pg/mL     232-1245', 'vitamin_b12'],
    ['B12                          410       pg/mL     232-1245', 'vitamin_b12'],
  ])('a whole B12 name still reads as Vitamin B12: %s', (row, slug) => {
    expect(parseAllReportItems(lab(row)).find(i => i.canonical_slug === slug)).toMatchObject({ value_numeric: 410 });
  });

  const fixtures = {
    quest: questFixture, labcorp: labcorpFixture, hone: honeFixture, generic: genericFixture,
    edgeCases: edgeCasesFixture, questHormones: questHormoneFixture, labcorpHormones: labcorpHormoneFixture,
  };
  it.each(Object.entries(fixtures))('%s: every "<X" result needs her review or carries no number', (_, text) => {
    for (const item of parseAllReportItems(text).filter(i => /^\s*</.test(i.value_text ?? ''))) {
      expect(item.needs_review || item.value_numeric == null, item.source_snippet ?? item.raw_name).toBe(true);
    }
  });

  it.each([
    ['a core row', edgeCasesFixture, 'vitamin_b12'],
    ['an unmapped extended row', lab('Holotranscobalamin           <10       pmol/L    50-150'), null],
  ])('%s printed below a limit needs her review', (_, text, slug) => {
    const below = parseAllReportItems(text).filter(i => i.canonical_slug === slug && /^</.test(i.value_text ?? ''));
    expect(below).toHaveLength(1);
    expect(below[0]).toMatchObject({ needs_review: true });
  });
});

/*
  IA2 review, finding 3: the physiological bounds are written in the catalog's
  canonical unit. A value the lab printed in another unit is checked against
  none, so a correct SI result is never "likely a parse error". Nothing is
  converted. The canonical-unit rows are the control.
*/
describe('parser pipeline (physiological bounds and units)', () => {
  const lab = (row: string) => `Lab Report\n\n${row}\n`;

  it.each([
    ['Glucose                      5.2       mmol/L    3.9-5.5', 'fasting_glucose', 5.2],
    ['Hemoglobin                   135       g/L       120-160', 'hemoglobin', 135],
    ['Calcium                      2.4       mmol/L    2.2-2.6', 'calcium', 2.4],
  ])('an SI-unit value is no parse error: %s', (row, slug, value) => {
    const item = parseAllReportItems(lab(row)).find(i => i.canonical_slug === slug);
    expect(item).toMatchObject({ value_numeric: value });
    expect(item?.parse_error ?? null).toBeNull();
  });

  it.each([
    ['Glucose                      5.2       mg/dL     65-99', 'fasting_glucose'],
    ['Calcium                      2.4       mg/dL     8.6-10.4', 'calcium'],
  ])('control: the same number in the canonical unit is still a parse error: %s', (row, slug) => {
    const item = parseAllReportItems(lab(row)).find(i => i.canonical_slug === slug);
    expect(item?.parse_error).toMatch(/likely a parse error$/);
  });
});

/*
  IA2 review wave 2, finding 1: the bounds are known only in the catalog's
  canonical unit. A value printed in another spelling or unit that falls
  outside them cannot be checked, so it is not accepted silently: it waits for
  her confirmation (needs_review, low confidence) and stays out of her primary
  finding and trends until she gives it. It is no parse error, so a correct SI
  value still saves. Nothing is converted and no bound changes.
*/
describe('parser pipeline (a value in another unit outside the bounds waits for her)', () => {
  const lab = (row: string) => `Lab Report\n\n${row}\n`;
  // The row as NewReport saves it to report_analytes, before she reviews it.
  const asSaved = (i: ReportItem) => ({
    lab_report_id: 'r', canonical_slug: i.canonical_slug, value_numeric: i.value_numeric, raw_value_text: i.value_text,
    confidence_score: i.confidence_score, needs_review: i.needs_review && i.reviewed_by_user !== true, reviewed_by_user: i.reviewed_by_user ?? false,
  });

  it.each([
    ['Glucose                      5.2       mmol/L    3.9-5.5', 'fasting_glucose', 5.2],
  ])('held for her confirmation, out of her primary finding, Save not blocked: %s', (row, slug, value) => {
    const item = parseAllReportItems(lab(row)).find(i => i.canonical_slug === slug);
    expect(item).toMatchObject({ value_numeric: value, needs_review: true, confidence_score: 'low' });
    expect(item?.parse_error ?? null).toBeNull();
    expect(awaitsHerConfirmation(item!)).toBe(false);
    expect(awaitsHerCheck(item!)).toBe(true);
    expect(isUnconfirmedReading(asSaved(item!))).toBe(true);
  });

  // RV-PX2 C1: a unit the catalog records as an owner-approved 1:1 equivalent
  // (review-2) is checked as the catalog unit, so these are the same
  // Save-blocking parse error as their catalog-unit twins, not a hold.
  it.each([
    ['Potassium                    45        mmol/L    3.5-5.1', 'potassium', 'Value 45 exceeds physiological maximum 10'],
    ['TSH                          900       uIU/mL    0.40-4.50', 'tsh', 'Value 900 exceeds physiological maximum 200'],
    ['ALT                          0.2       IU/L      7-35', 'alt', 'Value 0.2 is below physiological minimum 1'],
    ['Sodium                       14        mmol/L    136-145', 'sodium', 'Value 14 is below physiological minimum 100'],
  ])('in an approved equivalent unit, the Save-blocking parse error: %s', (row, slug, error) => {
    const item = parseAllReportItems(lab(row)).find(i => i.canonical_slug === slug);
    expect(item).toMatchObject({ needs_review: true, confidence_score: 'low', parse_status: 'parse_error' });
    expect(item?.parse_error).toMatch(new RegExp(`^${error.replace(/\./g, '\\.')} for .+ — likely a parse error$`));
    expect(awaitsHerConfirmation(item!)).toBe(true);
    expect(awaitsHerCheck(item!)).toBe(false);
    expect(isUnconfirmedReading(asSaved(item!))).toBe(true);
  });

  it('control: the same potassium in the canonical unit is still the Save-blocking parse error', () => {
    const item = parseAllReportItems(lab('Potassium                    45        mEq/L     3.5-5.1')).find(i => i.canonical_slug === 'potassium');
    expect(item?.parse_error).toMatch(/^Value 45 exceeds physiological maximum 10 for .+ — likely a parse error$/);
    expect(awaitsHerConfirmation(item!)).toBe(true);
    expect(awaitsHerCheck(item!)).toBe(false);
  });

  it.each([
    ['Potassium                    4.1       mmol/L    3.5-5.1', 'potassium'],
    ['TSH                          2.1       uIU/mL    0.40-4.50', 'tsh'],
  ])('control: a value in another unit inside the bounds is not held: %s', (row, slug) => {
    const item = parseAllReportItems(lab(row)).find(i => i.canonical_slug === slug);
    expect(item).toMatchObject({ needs_review: false, parse_error: null });
    expect(awaitsHerCheck(item!)).toBe(false);
  });
});
