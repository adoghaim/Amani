import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { BiomarkerName, CyclePhase } from '../../types';
import { getAllEntries, getEntry } from '../biomarkers/dictionary';
import { buildInsightSummary, type BiggestChange } from '../insights/buildInsightSummary';
import { buildFocusAreas } from '../insights/buildFocusAreas';
import { YourTrajectoryCard, selectTrajectoryBullets } from '../../components/YourTrajectoryCard';
import { MENSTRUAL_PHASES } from './amaniContext';
import { bandLanguageByKey, compareReports, getBiggestChanges, type BiomarkerDelta } from './compareReports';
import { authorizeModelProse, describeMeasuredMovement, movementClaimsByKey } from './insightCopy';
import { scoreBiomarker } from './scoreBiomarker';
import * as edge from '../../../supabase/functions/_shared/clinical-movement-policy.generated';

/*
  RV-NZ1 (REPORT-2026-10-24 §2.2, R-NEARZERO). Below NEAR_ZERO_THRESHOLD the
  relative change is undefined (percentDelta null), so the deterministic
  magnitude calculation cannot size the change. It used to call every such
  change 'minor', and the page read "hs-CRP has not changed significantly: 0.3
  to 9 mg/L." Fail-closed default: an unequal pair is 'unassessed' and is stated
  by value with the existing non-minor texts (C0); its final wording is
  [Pending] (Q1). No threshold changes. Synthetic values only.
*/

const PRIOR_DATE = '2025-12-01';
type Case = [key: BiomarkerName, previous: number, current: number, unit: string];
// Fixture lab intervals (brief §6): hs-CRP –3 mg/L, TSH 0.45–4.5, bilirubin 0.2–1.2 mg/dL, ferritin 15–150 ng/mL.
const INTERVAL: Partial<Record<BiomarkerName, [number | null, number | null]>> = {
  hs_crp: [null, 3], tsh: [0.45, 4.5], bilirubin_total: [0.2, 1.2], ferritin: [15, 150],
};
const input = (key: BiomarkerName, value: number, unit: string, reportDate?: string) => {
  const [labRefMin, labRefMax] = INTERVAL[key] ?? [null, null];
  return { key, value, unit, labRefMin, labRefMax, reportDate };
};
const summaryFor = (cases: Case[]) => buildInsightSummary(
  cases.map(([key, , current, unit]) => input(key, current, unit)),
  cases.map(([key, previous, , unit]) => input(key, previous, unit, PRIOR_DATE)),
  null, PRIOR_DATE,
);
const deltaFor = ([key, previous, current, unit]: Case) => {
  const [d] = compareReports([{ key, value: previous, unit }], [{ key, value: current, unit }], null);
  return d!;
};
const bulletsFor = (summary: ReturnType<typeof summaryFor>) => selectTrajectoryBullets(
  summary.biggestChanges, summary.primaryFinding, bandLanguageByKey(summary.deltaMap.values())).map(b => b.text);
const FORMATS = ['values', 'direction', 'magnitude'] as const;
const NOT_CHANGED = /not changed significantly/i;
// clinicalLanguagePolicy.test.tsx:9, verbatim.
const FORBIDDEN = /worsen|deteriorat|improv|better|worse|healthier|less healthy|wrong direction|worth discussing|talk to your doctor|consider discussing|seek care|optimal|safe|reassur/i;
// Size or stability words: an unassessed change has no size to state.
const SIZE_OR_STABILITY = /signific|\bstable\b|stabil|\bminor\b|meaningful|notabl|unchanged|\bsame\b|steady|slight|dramatic/i;

const UNASSESSED: Case[] = [
  ['hs_crp', 0.3, 9, 'mg/L'],
  ['tsh', 0.2, 4.4, 'uIU/mL'],
  ['bilirubin_total', 0.3, 1.1, 'mg/dL'],
  ['tsh', 0.1, 0.35, 'mIU/L'],
  ['hs_crp', 0.3, 0.4, 'mg/L'],
];

describe('RV-NZ1 §5.2 — a change from a near-zero prior is unassessed, never minor', () => {
  it.each(UNASSESSED)('%s %s -> %s %s is unassessed', (...c) => {
    const d = deltaFor(c);
    expect(d.percentDelta).toBeNull();
    expect(d.significance).toBe('unassessed');
  });

  it.each([
    [['tsh', 0.3, 0.3, 'mIU/L'], 'minor'],
    [['tsh', 6, 6.1, 'mIU/L'], 'minor'],
    [['hs_crp', 0.6, 9, 'mg/L'], 'significant'],
  ] as [Case, BiomarkerDelta['significance']][])('controls: %j stays %s', (c, significance) => {
    expect(deltaFor(c).significance).toBe(significance);
  });
});

describe('RV-NZ1 §5.3 — an unassessed delta is never stable_abnormal; the direction logic decides', () => {
  it.each([
    [['tsh', 0.2, 4.4, 'uIU/mL'], 'changed_still_low'],
    [['tsh', 0.3, 0.1, 'mIU/L'], 'worsening_still_low'],
    [['hs_crp', 0.3, 9, 'mg/L'], 'newly_abnormal'],
  ] as [Case, BiomarkerDelta['trajectoryStatus']][])('%j -> %s', (c, status) => {
    expect(deltaFor(c).trajectoryStatus).toBe(status);
  });

  it('both values inside the band stay a band placement that renders nothing', () => {
    const c: Case = ['hs_crp', 0.3, 0.4, 'mg/L'];
    const d = deltaFor(c);
    expect(d.trajectoryStatus).toBe('stable_normal');
    expect(getBiggestChanges([d])).toEqual([]);
    expect(bulletsFor(summaryFor([c]))).toEqual([]);
  });
});

/*
  The base computeSignificance at 03f9a85, frozen as the oracle for every prior
  at or above the threshold. A copy for comparison, not a source of the numbers.
*/
const BASE_MIN_ABSOLUTE_DELTA: Record<string, number> = {
  tsh: 0.3, free_t3: 0.2, free_t4: 0.1, hemoglobin_a1c: 0.2, hs_crp: 0.3, default: 0.5,
};
function baseSignificance(previous: number, current: number, key: string): BiomarkerDelta['significance'] {
  const absoluteDelta = Math.abs(current - previous);
  const percentDelta = Math.abs(previous) < 0.5 ? null : ((current - previous) / Math.abs(previous)) * 100;
  const minAbs = BASE_MIN_ABSOLUTE_DELTA[key] ?? BASE_MIN_ABSOLUTE_DELTA.default ?? 0.5;
  if (absoluteDelta < minAbs) return 'minor';
  if (percentDelta === null) return 'minor';
  const absPct = Math.abs(percentDelta);
  if (absPct >= 20) return 'significant';
  if (absPct >= 10) return 'moderate';
  return 'minor';
}

// trajectoryLanguage.test.tsx:26-30, extended with near-zero priors.
const valuesFor = (key: BiomarkerName) => {
  const e = getEntry(key)!;
  const points = [e.optimal.min, e.optimal.max, e.clinical.min, e.clinical.max].filter((v): v is number => v !== null);
  return [...new Set([0.01, 0.1, 0.2, 0.3, 0.45, ...points, ...points.map(v => v * 0.8), ...points.map(v => v * 1.2), ...points.map(v => v * 3)])];
};

describe('RV-NZ1 sweep — every analyte, phase and value pair in its catalog unit', () => {
  it('below the threshold an unequal pair is unassessed and never "not changed significantly"; above it nothing moves', () => {
    const failures: string[] = [];
    let nearZero = 0;
    let assessed = 0;
    for (const e of getAllEntries()) {
      const values = valuesFor(e.key);
      for (const phase of [null, ...MENSTRUAL_PHASES] as (CyclePhase | null)[]) {
        for (const previous of values) {
          for (const current of values) {
            const [d] = compareReports([{ key: e.key, value: previous, unit: e.defaultUnit }], [{ key: e.key, value: current, unit: e.defaultUnit }], phase);
            const where = `${e.key} ${phase} ${previous}->${current}`;
            if (!d) { failures.push(`${where}: no delta`); continue; }
            if (Math.abs(previous) >= 0.5) {
              assessed++;
              const expected = baseSignificance(previous, current, e.key);
              if (d.significance !== expected) failures.push(`${where}: ${d.significance}, base ${expected}`);
              continue;
            }
            if (previous === current) {
              if (d.significance !== 'minor') failures.push(`${where}: equal values are ${d.significance}`);
              continue;
            }
            nearZero++;
            if (d.significance !== 'unassessed') failures.push(`${where}: ${d.significance}`);
            if (d.trajectoryStatus === 'stable_abnormal') failures.push(`${where}: stable_abnormal`);
            for (const format of FORMATS) {
              const text = describeMeasuredMovement(d, format).text;
              if (NOT_CHANGED.test(text)) failures.push(`${where} ${format}: ${text}`);
            }
          }
        }
      }
    }
    expect(failures.slice(0, 20)).toEqual([]);
    expect(failures).toHaveLength(0);
    // Not vacuous: both halves of the rule are reached many times.
    expect(nearZero).toBeGreaterThan(1000);
    expect(assessed).toBeGreaterThan(10000);
  }, 120_000);
});

describe('RV-NZ1 §5.4 — kernel: C0 texts for unassessed, the assessed tiers byte-identical', () => {
  const unassessed = (previousValue: number, currentValue: number, unit: string) =>
    ({ displayName: 'TSH', previousValue, currentValue, unit, significance: 'unassessed' as const });

  it.each([
    [0.2, 4.4, 'uIU/mL', 'values', 'TSH increased from 0.2 to 4.4 uIU/mL.'],
    [0.2, 4.4, 'uIU/mL', 'direction', 'TSH has risen from 0.2 to 4.4 uIU/mL.'],
    [0.2, 4.4, 'uIU/mL', 'magnitude', 'TSH has changed since your prior report.'],
    [0.3, 0.1, 'mIU/L', 'values', 'TSH decreased from 0.3 to 0.1 mIU/L.'],
    [0.3, 0.1, 'mIU/L', 'direction', 'TSH has dropped from 0.3 to 0.1 mIU/L.'],
    [0.3, 0.1, 'mIU/L', 'magnitude', 'TSH has changed since your prior report.'],
  ] as const)('C0: TSH %s -> %s %s, %s format: %s', (previous, current, unit, format, text) => {
    const fact = unassessed(previous, current, unit);
    const language = describeMeasuredMovement(fact, format);
    expect(language.text).toBe(text);
    expect(language).toMatchObject({ category: 'factual_observation', cue: 'neutral',
      authority: { kind: 'lab_data', subject: 'TSH', previous, current, unit } });
    expect(language.claim.fact.significance).toBe('unassessed');
    expect(language.text).not.toMatch(FORBIDDEN);
    expect(language.text).not.toMatch(SIZE_OR_STABILITY);
    // The Edge copy issues the same claim and the same words.
    expect(edge.describeMeasuredMovement(fact, format).text).toBe(text);
  });

  // The bytes at 03f9a85, for every assessed tier, format and pair.
  const NOT_SIGNIFICANT = (a: number, b: number) => `TSH has not changed significantly: ${a} to ${b} uIU/mL.`;
  const CHANGED = 'TSH has changed since your prior report.';
  const ASSESSED_BYTES: Record<'minor' | 'moderate', Record<typeof FORMATS[number], string[]>> = {
    minor: {
      values: [NOT_SIGNIFICANT(6, 9), NOT_SIGNIFICANT(9, 6), NOT_SIGNIFICANT(6, 6.1), NOT_SIGNIFICANT(6, 6)],
      direction: ['TSH has risen from 6 to 9 uIU/mL.', 'TSH has dropped from 9 to 6 uIU/mL.', 'TSH has risen from 6 to 6.1 uIU/mL.', NOT_SIGNIFICANT(6, 6)],
      magnitude: ['TSH has not changed significantly.', 'TSH has not changed significantly.', 'TSH has not changed significantly.', 'TSH has not changed significantly.'],
    },
    moderate: {
      values: ['TSH increased from 6 to 9 uIU/mL.', 'TSH decreased from 9 to 6 uIU/mL.', 'TSH increased from 6 to 6.1 uIU/mL.', 'TSH remained at 6 uIU/mL.'],
      direction: ['TSH has risen from 6 to 9 uIU/mL.', 'TSH has dropped from 9 to 6 uIU/mL.', 'TSH has risen from 6 to 6.1 uIU/mL.', 'TSH remained at 6 uIU/mL.'],
      magnitude: [CHANGED, CHANGED, CHANGED, 'TSH has the same measured value as before.'],
    },
  };
  const BYTES = { ...ASSESSED_BYTES, significant: ASSESSED_BYTES.moderate };
  const PAIRS = [[6, 9], [9, 6], [6, 6.1], [6, 6]] as const;

  it.each(['minor', 'moderate', 'significant'] as const)('%s: every format and pair is byte-identical, client and Edge', significance => {
    for (const format of FORMATS) {
      PAIRS.forEach(([previousValue, currentValue], i) => {
        const fact = { displayName: 'TSH', previousValue, currentValue, unit: 'uIU/mL', significance };
        const expected = BYTES[significance][format][i];
        expect(describeMeasuredMovement(fact, format).text, `${format} ${previousValue}->${currentValue}`).toBe(expected);
        expect(edge.describeMeasuredMovement(fact, format).text, `edge ${format} ${previousValue}->${currentValue}`).toBe(expected);
      });
    }
  });
});

describe('RV-NZ1 §5.6 — the surfaces state the values, never "not changed significantly"', () => {
  it('a. trajectory bullets: TSH 0.2 -> 4.4 uIU/mL and hs-CRP 0.3 -> 9 mg/L', () => {
    const tsh = summaryFor([['tsh', 0.2, 4.4, 'uIU/mL']]);
    expect(bulletsFor(tsh)).toEqual(["TSH changed from 0.2 to 4.4 uIU/mL. Amani's comparison band for this result has not yet completed clinical review."]);
    const hsCrp = summaryFor([['hs_crp', 0.3, 9, 'mg/L']]);
    expect(bulletsFor(hsCrp)).toEqual(["hs-CRP has changed since your prior report. Your result falls outside Amani's current comparison band. This band has not yet completed clinical review."]);
    // The rendered card says the same, with no size or stability word.
    for (const summary of [tsh, hsCrp]) {
      const html = renderToStaticMarkup(<YourTrajectoryCard changes={summary.biggestChanges} primaryFinding={summary.primaryFinding}
        reportCount={2} bandLanguage={bandLanguageByKey(summary.deltaMap.values())} />);
      const text = html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'");
      expect(text).toContain('Your trajectory');
      expect(text).not.toMatch(NOT_CHANGED);
      expect(text).not.toMatch(/unchanged|\bstable\b/i);
    }
  });

  it('b. focus area: hs-CRP 0.3 -> 9 mg/L', () => {
    const summary = summaryFor([['hs_crp', 0.3, 9, 'mg/L']]);
    const areas = buildFocusAreas(summary, summary.watchSignals, [scoreBiomarker('hs_crp', 9, 'mg/L', null, 3, null, null, null)]);
    expect(areas.map(a => a.whyItMatters)).toEqual([
      "hs-CRP is above your lab's reference range at 9 mg/L. hs-CRP has changed since your prior report. hs-CRP is outside Amani's current comparison band. This band has not yet completed clinical review.",
    ]);
  });

  it('c. questions: the change is asked about by value, after every assessed change, and its lab-interval question gives way', () => {
    expect(summaryFor([['tsh', 0.2, 4.4, 'uIU/mL']]).questionsForDoctor.map(q => q.text)).toEqual([
      'My TSH changed from 0.2 to 4.4 uIU/mL. What could explain this change, and is it clinically meaningful?',
      'Is there anything about my routine or history that matters for reading these results?',
    ]);
    const both = summaryFor([['tsh', 0.2, 9, 'mIU/L'], ['ferritin', 25, 20, 'ng/mL']]);
    expect(both.deltaMap.get('ferritin')?.significance).toBe('significant');
    expect(both.deltaMap.get('tsh')?.significance).toBe('unassessed');
    const questions = both.questionsForDoctor;
    expect(questions.map(q => q.text)).toEqual([
      'My ferritin changed from 25 to 20 ng/mL. What could explain this change, and is it clinically meaningful?',
      'My TSH changed from 0.2 to 9 mIU/L. What could explain this change, and is it clinically meaningful?',
      'Is there anything about my routine or history that matters for reading these results?',
    ]);
    expect(questions[1]!.authority.premises).toEqual([{ kind: 'measured_change', subject: 'TSH', previous: 0.2, current: 9, unit: 'mIU/L' }]);
    // TSH 9 is above her lab interval, but its change question took its place.
    expect(questions.map(q => q.text).join(' ')).not.toMatch(/My TSH is 9/);
  });

  it('f. the primary movement: no sentence for a changed_* status; TSH 0.3 -> 0.1 is stated as its decrease', () => {
    const changed = summaryFor([['tsh', 0.2, 4.4, 'uIU/mL']]);
    expect(changed.primaryFinding?.key).toBe('tsh');
    expect(changed.deltaMap.get('tsh')?.trajectoryStatus).toBe('changed_still_low');
    const down = summaryFor([['tsh', 0.3, 0.1, 'mIU/L']]);
    expect(down.primaryFinding?.key).toBe('tsh');
    const change = down.biggestChanges.find(c => c.key === 'tsh')!;
    expect(change.trajectoryStatus).toBe('worsening_still_low');
    // ReportView's headline and primary observation state this change in the values format.
    expect(describeMeasuredMovement(change).text).toBe('TSH decreased from 0.3 to 0.1 mIU/L.');
  });

  it.each(UNASSESSED)('g. %s %s -> %s %s: the model may not say "not changed significantly"', (...c) => {
    const [, previous, current, unit] = c;
    const summary = summaryFor([c]);
    const claims = [...movementClaimsByKey(summary.deltaMap).values()];
    expect(claims.map(claim => claim.fact.significance)).toEqual(['unassessed']);
    const name = claims[0]!.fact.displayName;
    expect(authorizeModelProse('interpretation.summary_bullets',
      [`${name} has not changed significantly.`, `${name} has not changed significantly: ${previous} to ${current} ${unit}.`], claims)).toEqual([]);
    // Positive control: the claim still authorizes its own factual phrase.
    const own = describeMeasuredMovement(claims[0]!.fact).text;
    expect(authorizeModelProse('interpretation.summary_bullets', own, claims).map(p => p.language.text)).toEqual([own]);
  });
});

/*
  §5.5: ranks are not claims. Where a rank is needed an unassessed change ranks
  as a minor one, and the filters decide whether it shows.
*/
describe('RV-NZ1 §5.5 — an unassessed change ranks as minor', () => {
  const delta = (key: BiomarkerName, significance: BiomarkerDelta['significance']) => ({
    ...deltaFor(['hs_crp', 0.3, 9, 'mg/L']), key, significance,
  });

  it('biggest changes: below a moderate crossing, level with a minor one', () => {
    const unassessed = delta('hs_crp', 'unassessed');
    expect(unassessed.boundaryCrossing).not.toBeNull();
    expect(getBiggestChanges([unassessed, delta('ferritin', 'moderate')]).map(d => d.key)).toEqual(['ferritin', 'hs_crp']);
    expect(getBiggestChanges([unassessed, delta('ferritin', 'minor')]).map(d => d.key)).toEqual(['hs_crp', 'ferritin']);
    expect(getBiggestChanges([delta('ferritin', 'minor'), unassessed]).map(d => d.key)).toEqual(['ferritin', 'hs_crp']);
  });

  it('trajectory bullets of one kind: below a moderate change, level with a minor one', () => {
    const change = (key: BiggestChange['key'], significance: BiggestChange['significance']): BiggestChange => ({
      key, displayName: key, previousValue: 0.2, currentValue: 9, unit: 'u', percentDelta: null,
      trendDirection: 'up', significance, boundaryCrossing: null, trajectoryStatus: 'changed_still_low',
      distanceToNormalImprovement: null, fact: '', priorReportDate: PRIOR_DATE, priorIsOlderThanImmediatePrior: false,
    });
    const keys = (changes: BiggestChange[]) => selectTrajectoryBullets(changes, null).map(b => b.key);
    expect(keys([change('tsh', 'unassessed'), change('ferritin', 'moderate')])).toEqual(['ferritin', 'tsh']);
    expect(keys([change('tsh', 'unassessed'), change('ferritin', 'minor')])).toEqual(['tsh', 'ferritin']);
    expect(keys([change('ferritin', 'minor'), change('tsh', 'unassessed')])).toEqual(['ferritin', 'tsh']);
  });
});
