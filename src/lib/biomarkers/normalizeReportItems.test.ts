import { describe, expect, it } from 'vitest';
import { normalizeReportItems, reportItemDisplayName } from './normalizeReportItems';
import { parseAllReportItemsWithDebug } from '../../utils/parser/pipeline';
import type { ReportItem } from '../../utils/parser/types';
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
});
