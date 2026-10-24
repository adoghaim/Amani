import { describe, expect, it } from 'vitest';
import { normalizeReportItems, reportItemDisplayName, sameUnit } from './normalizeReportItems';
import { getEntry } from './dictionary';
import { parseAllReportItemsWithDebug } from '../../utils/parser/pipeline';
import { BIOMARKER_PATTERNS } from '../../utils/parser/patterns';
import type { ReportItem } from '../../utils/parser/types';
import type { BiomarkerName } from '../../types';
import { computeAmaniStatus } from '../scoring/scoreBiomarker';
import { questSmokeFixture } from '../../utils/parser/__fixtures__/questSmoke';
import { questFixture } from '../../utils/parser/__fixtures__/quest';
import { labcorpFixture } from '../../utils/parser/__fixtures__/labcorp';
import { genericFixture } from '../../utils/parser/__fixtures__/generic';
import { edgeCasesFixture } from '../../utils/parser/__fixtures__/edgeCases';
import { questHormoneFixture } from '../../utils/parser/__fixtures__/questHormones';
import { labcorpHormoneFixture } from '../../utils/parser/__fixtures__/labcorpHormones';

// The upload's confirm step names each marker with reportItemDisplayName; the
// report shows the display_name saved from normalizeReportItems. Synthetic fixtures.
const fixtures = [questSmokeFixture, questFixture, labcorpFixture, genericFixture, edgeCasesFixture, questHormoneFixture, labcorpHormoneFixture];

describe('reportItemDisplayName', () => {
  it('names the smoke-test markers the way the report does, never by slug', () => {
    const names = parseAllReportItemsWithDebug(questSmokeFixture).items.map(reportItemDisplayName);
    expect(names).toEqual([
      'Ferritin', 'Hemoglobin', 'TSH', 'Free T4', 'Vitamin D', 'HbA1c', 'Fasting Glucose',
      'Total Cholesterol', 'HDL', 'LDL', 'Triglycerides', 'Vitamin B12',
    ]);
  });

  it('is the display name normalizeReportItems saves for every parsed item, core or extended', () => {
    const items = fixtures.flatMap(text => parseAllReportItemsWithDebug(text).items);
    expect(items.some(i => !i.is_core_biomarker)).toBe(true);
    expect(items.map(reportItemDisplayName)).toEqual(normalizeReportItems(items).map(i => i._display_name));
  });

  it('keeps the printed label of an item the catalogue does not know', () => {
    const item = { raw_name: 'Holotranscobalamin', canonical_slug: null } as ReportItem;
    expect(reportItemDisplayName(item)).toBe('Holotranscobalamin');
  });
});

// Review F011: the catalog approves no unit conversions, so an item in any unit
// but its analyte's catalog unit is kept, with the lab's own interval, outside
// the scored (core) set. Synthetic values only.
describe('normalizeReportItems — unit sanity', () => {
  const item = (slug: string, value: number, unit: string | null) =>
    ({ raw_name: slug, canonical_slug: slug, value_numeric: value, value_text: null, unit, is_core_biomarker: true } as ReportItem);

  it.each([
    ['ldl_cholesterol', 4.9, 'mmol/L'],
    ['fasting_glucose', 5.2, 'mmol/L'],
    ['creatinine', 80, 'µmol/L'],
    ['tsh', 2, 'uIU/mL'],
    ['ldl_cholesterol', 160, null],
  ] as const)('%s %s in %j is partial and not core', (slug, value, unit) => {
    const [n] = normalizeReportItems([item(slug, value, unit)]);
    expect(n).toMatchObject({ canonical_slug: slug, value_numeric: value, normalization_status: 'partial', is_core_biomarker: false });
  });

  it.each([
    ['ldl_cholesterol', 'mg/dL', 'mg/dL'],
    ['ldl_cholesterol', 'MG/DL', 'mg/dL'],
    ['serum_iron', 'mcg/dL', 'mcg/dL'],
    ['fasting_insulin', 'µIU/mL', 'µIU/mL'],
  ])('%s in %j is the catalog unit spelled differently: mapped and core, saved as %j', (slug, unit, saved) => {
    const [n] = normalizeReportItems([item(slug, 1, unit)]);
    expect(n).toMatchObject({ normalization_status: 'mapped', is_core_biomarker: true, _normalized_unit: saved });
  });

  it.each(['µmol/L', 'umol/L'])('the real parser on an SI panel (creatinine in %s) leaves none of its SI markers core', creatinineUnit => {
    const text = [
      'Test Result Units Reference Interval',
      'LDL Cholesterol 4.9 mmol/L 0.0-3.0',
      'Total Cholesterol 7.1 mmol/L 0.0-5.2',
      'Glucose 5.2 mmol/L 3.9-5.5',
      `Creatinine 80 ${creatinineUnit} 45-90`,
      'Hemoglobin A1c 45 mmol/mol 20-42',
      'Vitamin B12 300 pmol/L 150-600',
      'Ferritin 40 ng/mL 13-150',
    ].join('\n');
    const items = normalizeReportItems(parseAllReportItemsWithDebug(text).items);
    const bySlug = new Map(items.map(i => [i.canonical_slug, i]));
    for (const slug of ['ldl_cholesterol', 'total_cholesterol', 'fasting_glucose', 'creatinine', 'hemoglobin_a1c', 'vitamin_b12']) {
      expect(bySlug.get(slug), slug).toMatchObject({ is_core_biomarker: false, normalization_status: 'partial' });
    }
    expect(bySlug.get('creatinine')?._normalized_unit).toBe('umol/L');
    expect(bySlug.get('hemoglobin_a1c')?._normalized_unit).toBe('mmol/mol');
    expect(bySlug.get('ferritin')).toMatchObject({ is_core_biomarker: true, normalization_status: 'mapped' });
  });

  // Review fix wave 1: the parser's own spellings of a catalog unit ("ratio",
  // x10E3/uL, x10E6/uL, mm/h) are that unit, so these rows stay core and banded.
  it('the real parser on CBC, ratio and ESR rows keeps every one core and scored', () => {
    const text = [
      'Test Result Units Reference Interval',
      'WBC 6.0 x10E3/uL 3.4-10.8',
      'RBC 4.50 x10E6/uL 3.77-5.28',
      'Platelets 250 x10E3/uL 150-450',
      'WBC 6.0 Thousand/uL 3.8-10.8',
      'Cholesterol/HDL Ratio 3.5 0.0-4.4',
      'A/G Ratio 1.5 1.2-2.2',
      'BUN/Creatinine Ratio 15 9-23',
      'Sed Rate by Westergren 10 mm/h 0-32',
    ].join('\n');
    const items = normalizeReportItems(parseAllReportItemsWithDebug(text).items);
    const slugs = ['wbc', 'rbc', 'platelets', 'chol_hdl_ratio', 'albumin_globulin_ratio', 'bun_creatinine_ratio', 'esr'];
    expect(new Set(items.map(i => i.canonical_slug))).toEqual(new Set(slugs));
    for (const i of items) {
      expect(i, i.canonical_slug ?? i.raw_name).toMatchObject({ is_core_biomarker: true, normalization_status: 'mapped' });
      expect(computeAmaniStatus(i.canonical_slug as BiomarkerName, i.value_numeric!, null, null, i.unit), i.canonical_slug!)
        .not.toBe('unknown');
    }
  });

  // Review fix wave 2: LabCorp prints eGFR's unit as "mL/min/1.73" (no m²), and
  // m² may be printed as a superscript, after a space or as m^2. Each is
  // mL/min/1.73m2, the catalog unit; the parser read all of them as mL/min.
  it.each(['mL/min/1.73', 'ml/min/1.73', 'mL/min/1.73m2', 'mL/min/1.73m²', 'mL/min/1.73 m2', 'mL/min/1.73 m²', 'mL/min/1.73m^2'])(
    'the real parser on "eGFR 95 %s" keeps eGFR core and scored', unit => {
      const text = ['Test Result Units Reference Interval', `eGFR 95 ${unit} >59`, 'Ferritin 50 ng/mL 15-150'].join('\n');
      const egfr = normalizeReportItems(parseAllReportItemsWithDebug(text).items).find(i => i.canonical_slug === 'egfr');
      expect(egfr).toMatchObject({ value_numeric: 95, is_core_biomarker: true, normalization_status: 'mapped' });
      expect(computeAmaniStatus('egfr', 95, null, null, egfr?.unit)).not.toBe('unknown');
    },
  );

  // Negative controls: mL/min (a clearance, not per 1.73 m²) is another unit.
  it.each(['mL/min', 'mL/min/1.7'])('the real parser on "eGFR 95 %s" leaves eGFR partial and not core', unit => {
    const text = ['Test Result Units Reference Interval', `eGFR 95 ${unit} >59`].join('\n');
    const egfr = normalizeReportItems(parseAllReportItemsWithDebug(text).items).find(i => i.canonical_slug === 'egfr');
    expect(egfr).toMatchObject({ value_numeric: 95, is_core_biomarker: false, normalization_status: 'partial' });
    expect(computeAmaniStatus('egfr', 95, null, null, egfr?.unit)).toBe('unknown');
  });

  // Every parsed marker the parser stamps with its default unit (no unit
  // printed) must be scorable in that unit. The only exceptions are the listed
  // factor-1 pairs, which are different units the catalog has not joined.
  it('the parser\'s default unit for every marker is its catalog unit, except unjoined factor-1 pairs', () => {
    const AWAITING_SIGN_OFF = new Set(['sodium', 'potassium', 'chloride', 'co2']); // mmol/L vs mEq/L
    const mismatched = BIOMARKER_PATTERNS
      .filter(p => !sameUnit(p.commonUnits[0] ?? null, getEntry(p.canonical as BiomarkerName)?.defaultUnit))
      .map(p => p.canonical);
    expect(mismatched.filter(slug => !AWAITING_SIGN_OFF.has(slug))).toEqual([]);
    expect(new Set(mismatched)).toEqual(AWAITING_SIGN_OFF);
  });
});
