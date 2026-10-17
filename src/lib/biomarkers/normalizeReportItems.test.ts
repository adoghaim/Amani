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
