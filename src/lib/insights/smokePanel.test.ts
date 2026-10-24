import { describe, expect, it } from 'vitest';
import { buildInsightSummary } from './buildInsightSummary';
import { buildFocusAreas } from './buildFocusAreas';
import { buildHealthStory, type PrimaryContext } from './buildHealthStory';
import { scoreBiomarker } from '../scoring/scoreBiomarker';
import { primaryFindingSentence } from '../scoring/insightCopy';

const panel = [
  { key: 'ferritin' as const, value: 18, unit: 'ng/mL', labRefMin: 16, labRefMax: 154 },
  { key: 'tsh' as const, value: 2.85, unit: 'uIU/mL', labRefMin: 0.4, labRefMax: 4.5 },
  { key: 'vitamin_d_25_oh' as const, value: 24, unit: 'ng/mL', labRefMin: 30, labRefMax: 100 },
  { key: 'ldl_cholesterol' as const, value: 112, unit: 'mg/dL', labRefMin: null, labRefMax: 100 },
];

describe('synthetic October smoke panel: one primary, two distinct comparisons', () => {
  it.each([24, 25])('shows both lab findings and names Vitamin D at %s throughout the deterministic story', vitaminD => {
    const values = panel.map(b => b.key === 'vitamin_d_25_oh' ? { ...b, value: vitaminD } : b);
    const summary = buildInsightSummary(values, null);
    expect(summary.labFindings?.map(f => f.key)).toEqual(['vitamin_d_25_oh', 'ldl_cholesterol']);
    const primary = summary.primaryFinding!;
    expect(primary.key).toBe('vitamin_d_25_oh');
    expect(primaryFindingSentence(primary)).toBe(`Vitamin D is below your lab's reference range at ${vitaminD} ng/mL.`);
    const scored = values.map(b => scoreBiomarker(b.key, b.value, b.unit, b.labRefMin, b.labRefMax));
    const areas = buildFocusAreas(summary, summary.watchSignals, scored, null, 'nutrients');
    expect(areas[0]!.title).not.toMatch(/iron/i);
    expect(areas[0]!.isPrimaryAligned).toBe(true);
    for (const key of ['vitamin_d_25_oh', 'ldl_cholesterol']) {
      expect(areas.some(a => a.relatedMarkers.some(m => m.slug === key))).toBe(true);
    }
    const primaryContext: PrimaryContext = { primary_biomarker: primary.displayName, canonical_slug: primary.key,
      current_value: primary.value, previous_value: null, unit: primary.unit, current_status: 'low',
      trajectory: 'no_prior_data', percent_change: null, prior_report_date: null, supporting_biomarker: null };
    const story = buildHealthStory({ primaryContext, focusAreas: areas, primaryCategory: 'nutrients' });
    expect(story.sentences[0]!.text).toBe('Vitamin D is the primary finding shown above.');
    expect(story.sentences.map(s => s.text).join(' ')).not.toMatch(/mainly about iron/);
  });

  it('retains a lab-only withheld marker as primary without granting clinical authority', () => {
    const marker = { key: 'progesterone' as const, value: 30, unit: 'ng/mL', labRefMin: 0.2, labRefMax: 25 };
    const scored = scoreBiomarker(marker.key, marker.value, marker.unit, marker.labRefMin, marker.labRefMax, null);
    expect(scored.concern).toBe(0);
    const summary = buildInsightSummary([marker], null);
    expect(summary.primaryFinding?.key).toBe('progesterone');
    expect(summary.primaryFinding?.labLanguage?.authority.kind).toBe('patient_lab_interval');
    expect(primaryFindingSentence(summary.primaryFinding!)).toBe("Progesterone is above your lab's reference range at 30 ng/mL.");
    expect(buildFocusAreas(summary, [], [scored])).toHaveLength(1);
  });

  // Owner ruling 2026-10-23: Ruling 7 is a true floor. The lab-only TSH stays
  // visible as a neutral lab fact but ranks after the Amani-flagged ferritin.
  it('keeps a lab-only flag inside its Amani band visible, ranked after an Amani-flagged finding', () => {
    const values = [panel[0]!, { key: 'tsh' as const, value: 2, unit: 'uIU/mL', labRefMin: 0.4, labRefMax: 1.9 }];
    const scored = values.map(b => scoreBiomarker(b.key, b.value, b.unit, b.labRefMin, b.labRefMax));
    expect(scored.find(s => s.key === 'tsh')!.concern).toBe(0);
    expect(scored.find(s => s.key === 'ferritin')!.concern).toBeGreaterThan(0);
    const summary = buildInsightSummary(values, null);
    expect(summary.primaryFinding?.key).toBe('ferritin');
    const tsh = summary.topFindings.find(f => f.key === 'tsh')!;
    expect(tsh.labLanguage?.authority.kind).toBe('patient_lab_interval');
    const areas = buildFocusAreas(summary, [], scored, null, 'nutrients');
    expect(areas[0]!.relatedMarkers[0]!.slug).toBe('ferritin');
    const tshArea = areas[areas.length - 1]!;
    expect(tshArea.relatedMarkers[0]!.slug).toBe('tsh');
    expect(tshArea.whyItMatters).toBe("TSH is above your lab's reference range at 2 uIU/mL.");
    expect(tshArea.whyItMatters).not.toMatch(/outside.*Amani|elevated|optimal/i);
  });
});
