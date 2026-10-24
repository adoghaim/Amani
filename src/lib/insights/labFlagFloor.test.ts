import { describe, expect, it } from 'vitest';
import type { BiomarkerName, CyclePhase } from '../../types';
import { buildInsightSummary } from './buildInsightSummary';
import { buildFocusAreas } from './buildFocusAreas';
import { buildHealthStory } from './buildHealthStory';
import { scoreBiomarker } from '../scoring/scoreBiomarker';
import { primaryFindingSentence } from '../scoring/insightCopy';

/*
  Owner ruling (2026-10-23): Ruling 7's lab-flag floor is a true floor
  (docs/factory/lab-flag-floor-decision.md, A1 first option). A lab-only result
  (outside her lab's printed range, not flagged by Amani) stays visible as a
  neutral lab fact, ranks after every Amani-flagged result, and takes the
  Primary finding slot only when nothing on the report is Amani-flagged. Values
  are synthetic.
*/

type Input = { key: BiomarkerName; value: number; unit: string; labRefMin: number | null; labRefMax: number | null };
const m = (key: BiomarkerName, value: number, unit: string, labRefMin: number | null, labRefMax: number | null): Input =>
  ({ key, value, unit, labRefMin, labRefMax });

function build(inputs: Input[], phase: CyclePhase | null = null) {
  const scored = inputs.map(b => scoreBiomarker(b.key, b.value, b.unit, b.labRefMin, b.labRefMax, phase));
  const summary = buildInsightSummary(inputs, null, phase);
  const areas = buildFocusAreas(summary, summary.watchSignals, scored);
  const sentence = summary.primaryFinding
    ? primaryFindingSentence(summary.primaryFinding, summary.bandLanguage?.get(summary.primaryFinding.key)) : null;
  return { scored, summary, areas, sentence };
}
const concernOf = (r: ReturnType<typeof build>, key: BiomarkerName) => r.scored.find(s => s.key === key)!.concern;
const last = <T,>(items: readonly T[]): T | undefined => items[items.length - 1];

const ferritin17 = m('ferritin', 17, 'ng/mL', 15, 150);
const hdl61 = m('hdl_cholesterol', 61, 'mg/dL', 40, 60);

describe('Ruling 7 lab-flag floor: lab-only results never outrank Amani-flagged ones', () => {
  it('an Amani-flagged ferritin inside its lab range stays primary over a lab-only HDL', () => {
    const r = build([ferritin17, hdl61]);
    expect(concernOf(r, 'ferritin')).toBe(2);
    expect(concernOf(r, 'hdl_cholesterol')).toBe(0);
    expect(r.summary.primaryFinding?.key).toBe('ferritin');
    expect(r.summary.primaryFinding?.labPlacement).toBeUndefined();
    expect(r.sentence).toBe("Ferritin is below the Amani band at 17 ng/mL. Amani's context bands are still under review.");
    // Still visible as a neutral lab fact, after the Amani-flagged result.
    expect(r.summary.labFindings?.map(f => f.key)).toEqual(['hdl_cholesterol']);
    expect(r.summary.topFindings.map(f => f.key)).toEqual(['hdl_cholesterol']);
    expect(r.areas.map(a => a.relatedMarkers[0]!.slug)).toEqual(['ferritin', 'hdl_cholesterol']);
    expect(r.areas[0]!.isPrimaryAligned).toBe(true);
    expect(r.areas[1]!.whyItMatters).toBe("HDL is above your lab's reference range at 61 mg/dL.");
  });

  it('the same holds whatever order the rows arrive in, and for TSH with a lab-only HDL', () => {
    expect(build([hdl61, ferritin17]).summary.primaryFinding?.key).toBe('ferritin');
    const r = build([m('hdl_cholesterol', 62, 'mg/dL', 40, 60), m('tsh', 4.2, 'uIU/mL', 0.45, 4.5)]);
    expect(concernOf(r, 'tsh')).toBe(2);
    expect(r.summary.primaryFinding?.key).toBe('tsh');
    expect(r.areas[0]!.relatedMarkers[0]!.slug).toBe('tsh');
    expect(last(r.areas)!.relatedMarkers[0]!.slug).toBe('hdl_cholesterol');
  });

  it('a borderline Amani result keeps a lab-only result out of the Primary slot and ahead of it in top findings', () => {
    const r = build([hdl61, m('tsh', 2.7, 'uIU/mL', 0.45, 4.5)]);
    expect(concernOf(r, 'tsh')).toBe(1);
    expect(r.summary.primaryFinding).toBeNull();
    expect(r.summary.topFindings.map(f => f.key)).toEqual(['tsh', 'hdl_cholesterol']);
    expect(r.areas.map(a => a.relatedMarkers[0]!.slug)).toEqual(['tsh', 'hdl_cholesterol']);
  });

  it('a lab flag on a borderline result lifts neither its top-finding rank nor its focus area above out-of-band ones', () => {
    const ldl112 = m('ldl_cholesterol', 112, 'mg/dL', null, 100);
    const r = build([ferritin17, m('hemoglobin_a1c', 6, '%', null, null), ldl112]);
    expect(concernOf(r, 'ldl_cholesterol')).toBe(1);
    expect(r.summary.labFindings?.map(f => f.key)).toEqual(['ldl_cholesterol']);
    expect(r.summary.primaryFinding?.key).not.toBe('ldl_cholesterol');
    expect(last(r.summary.topFindings)?.key).toBe('ldl_cholesterol');
    expect(last(r.summary.topFindings)?.labPlacement).toBe('above');
    expect(r.areas).toHaveLength(3);
    expect(last(r.areas)!.relatedMarkers.map(marker => marker.slug)).toEqual(['ldl_cholesterol']);
    expect(last(r.areas)!.whyItMatters).toMatch(/^LDL is above your lab's reference range at 112 mg\/dL\. /);
  });

  it('a lab flag on an Amani-flagged result changes its wording, not its rank (luteal progesterone stays primary over LH)', () => {
    const r = build([
      m('progesterone', 2, 'ng/mL', 0.2, 25), m('tsh', 2, 'uIU/mL', 0.45, 4.5), m('estradiol', 120, 'pg/mL', null, null),
      m('lh', 30, 'mIU/mL', 2.4, 12.6), m('fsh', 6, 'mIU/mL', 3.5, 12.5),
    ], 'luteal');
    expect(r.summary.primaryFinding?.key).toBe('progesterone');
    expect(r.sentence).toBe('Progesterone was measured at 2 ng/mL. Interpretation unavailable pending clinical review.');
    const lh = r.summary.topFindings.find(f => f.key === 'lh')!;
    expect(primaryFindingSentence(lh)).toBe("LH is above your lab's reference range at 30 mIU/mL.");
  });

  it('a marker Amani withholds for a missing cycle phase never lets its lab flag outrank an Amani-flagged result', () => {
    const progesterone = m('progesterone', 30, 'ng/mL', 0.2, 25);
    const r = build([progesterone, ferritin17]);
    expect(concernOf(r, 'progesterone')).toBe(0);
    expect(r.summary.primaryFinding?.key).toBe('ferritin');
    expect(r.summary.topFindings.map(f => f.key)).toEqual(['progesterone']);
    // Alone, nothing is Amani-flagged, so the lab-only result may take the slot.
    expect(build([progesterone]).summary.primaryFinding?.key).toBe('progesterone');
  });
});

describe('Ruling 7 lab-flag floor: tied lab-only results are ordered deterministically', () => {
  const hdl95 = m('hdl_cholesterol', 95, 'mg/dL', 40, 60);
  const tsh2 = m('tsh', 2, 'uIU/mL', 0.4, 1.9);

  it('the primary and lab-finding order do not depend on row order (catalog order, then slug)', () => {
    const forward = build([hdl95, tsh2]);
    const reverse = build([tsh2, hdl95]);
    expect(concernOf(forward, 'hdl_cholesterol')).toBe(0);
    expect(concernOf(forward, 'tsh')).toBe(0);
    for (const r of [forward, reverse]) {
      expect(r.summary.primaryFinding?.key).toBe('tsh');
      expect(r.summary.labFindings?.map(f => f.key)).toEqual(['tsh', 'hdl_cholesterol']);
      expect(r.areas.map(a => a.relatedMarkers[0]!.slug)).toEqual(['tsh', 'hdl_cholesterol']);
    }
  });
});

describe('health story keeps a lab-only focus area\'s display name as printed', () => {
  it('names HDL, not "hdl", among the other areas', () => {
    const r = build([
      m('vitamin_d_25_oh', 24, 'ng/mL', 30, 100), m('hdl_cholesterol', 62, 'mg/dL', 40, 60), m('tsh', 4.6, 'uIU/mL', 0.45, 4.5),
      m('sodium', 146, 'mmol/L', 136, 145), m('mchc', 36.1, 'g/dL', 32, 36),
    ]);
    const story = buildHealthStory({ primaryContext: null, focusAreas: r.areas });
    const others = story.sentences.find(s => s.kind === 'others')!.text;
    expect(others).toMatch(/, and HDL\.$/);
    expect(others).toContain('thyroid function');
    expect(others).not.toContain('hdl');
  });
});
