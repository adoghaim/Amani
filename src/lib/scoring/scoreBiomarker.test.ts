import { describe, expect, it } from 'vitest';
import {
  computeAmaniStatus,
  computeLabStatus,
  scoreBiomarker,
  statusToConcern,
} from './scoreBiomarker';
import { assessAmaniContext, contextFromReport } from './amaniContext';
import type { AmaniStatus, BiomarkerName, CyclePhase, LabStatus } from '../../types';

const ALL_PHASES: CyclePhase[] = [
  'menstrual',
  'follicular',
  'ovulatory',
  'luteal',
  'pregnancy_t1',
  'pregnancy_t2',
  'pregnancy_t3',
  'unknown',
];

// ─── computeAmaniStatus: boundaries on a phase-independent marker ─────────────
// ferritin — optimal 30–150, clinical 13–150, importance critical.
// The borderline buffer is 15% of the optimal bound.

describe('computeAmaniStatus — ferritin boundaries (optimal 30–150, clinical 13–150)', () => {
  const cases: Array<[number, AmaniStatus, string]> = [
    [30, 'optimal', 'exactly at the optimal minimum'],
    [150, 'optimal', 'exactly at the optimal maximum'],
    [90, 'optimal', 'mid-range'],
    [29, 'borderline_low', 'one step below the optimal minimum'],
    [25.5, 'borderline_low', 'exactly at the borderline floor (30 × 0.85)'],
    [25.4, 'out_of_range_low', 'one step below the borderline floor'],
    [13, 'out_of_range_low', 'exactly at the clinical minimum'],
    [12, 'out_of_range_low', 'below the clinical minimum'],
    [151, 'out_of_range_high', 'one step above the optimal maximum'],
  ];

  it.each(cases)('%d → %s (%s)', (value, expected) => {
    expect(computeAmaniStatus('ferritin', value)).toBe(expected);
  });

  // ferritin's clinical max equals its optimal max, so there is no room between
  // them: the borderline_high band is unreachable for this marker by design.
  it('cannot produce borderline_high because clinical max === optimal max', () => {
    expect(computeAmaniStatus('ferritin', 150.1)).toBe('out_of_range_high');
    expect(computeAmaniStatus('ferritin', 170)).toBe('out_of_range_high');
  });
});

describe('computeAmaniStatus — TSH boundaries (optimal 1.0–2.5, clinical 0.4–4.0)', () => {
  const cases: Array<[number, AmaniStatus, string]> = [
    [1.0, 'optimal', 'exactly at the optimal minimum'],
    [2.5, 'optimal', 'exactly at the optimal maximum'],
    [2.6, 'borderline_high', 'inside the 15% buffer above optimal'],
    [2.875, 'borderline_high', 'exactly at the borderline ceiling (2.5 × 1.15)'],
    [2.9, 'out_of_range_high', 'past the buffer but still inside the clinical range'],
    [4.5, 'out_of_range_high', 'past the clinical maximum'],
    [0.9, 'borderline_low', 'inside the 15% buffer below optimal'],
    [0.85, 'borderline_low', 'exactly at the borderline floor (1.0 × 0.85)'],
    [0.8, 'out_of_range_low', 'past the buffer but still inside the clinical range'],
    [0.3, 'out_of_range_low', 'below the clinical minimum'],
  ];

  it.each(cases)('%d → %s (%s)', (value, expected) => {
    expect(computeAmaniStatus('tsh', value)).toBe(expected);
  });
});

describe('computeAmaniStatus — higherIsBetter markers', () => {
  it('treats any HDL above the optimal maximum as optimal', () => {
    expect(computeAmaniStatus('hdl_cholesterol', 90)).toBe('optimal');
    expect(computeAmaniStatus('hdl_cholesterol', 95)).toBe('optimal');
    // Documents that higherIsBetter short-circuits before the clinical max
    // (100) is consulted at all.
    expect(computeAmaniStatus('hdl_cholesterol', 250)).toBe('optimal');
  });

  it('still flags HDL below the optimal minimum', () => {
    expect(computeAmaniStatus('hdl_cholesterol', 55)).toBe('borderline_low');
    expect(computeAmaniStatus('hdl_cholesterol', 45)).toBe('out_of_range_low');
  });

  it('flags a falling eGFR (optimal 90–200, clinical 60–200)', () => {
    expect(computeAmaniStatus('egfr', 90)).toBe('optimal');
    expect(computeAmaniStatus('egfr', 85)).toBe('borderline_low');
    expect(computeAmaniStatus('egfr', 70)).toBe('out_of_range_low');
    expect(computeAmaniStatus('egfr', 55)).toBe('out_of_range_low');
  });
});

// ─── computeAmaniStatus: cycle-phase sensitivity ─────────────────────────────
// The case the scoring engine exists for: the same number means different
// things at different points in the cycle. If these ever collapse to one
// answer, phase ranges have stopped being consulted.

describe('computeAmaniStatus — progesterone 2.0 ng/mL across the cycle', () => {
  const cases: Array<[CyclePhase, AmaniStatus]> = [
    ['menstrual', 'out_of_range_high'],
    ['follicular', 'out_of_range_high'],
    ['ovulatory', 'optimal'],
    ['luteal', 'out_of_range_low'],
  ];

  it.each(cases)('in %s phase → %s', (phase, expected) => {
    expect(computeAmaniStatus('progesterone', 2.0, phase)).toBe(expected);
  });

  it('scores luteal low and follicular high from the same value', () => {
    expect(computeAmaniStatus('progesterone', 2.0, 'luteal')).toBe('out_of_range_low');
    expect(computeAmaniStatus('progesterone', 2.0, 'follicular')).toBe('out_of_range_high');
  });

  // V2-03 (owner ruling): this used to fall back to the unphased 0.1–25 band,
  // so a luteal-phase deficiency read as optimal. Changed deliberately and made
  // stronger: with no usable phase there is NO Amani status, for every value
  // (including ones the old band called optimal or out of range), and the
  // assessment says why instead of silently classifying.
  it.each([null, undefined, 'unknown' as CyclePhase, 'not-a-phase'])(
    'withholds the Amani status when the phase is %s',
    (phase) => {
      for (const value of [0.05, 2.0, 12, 40]) {
        expect(computeAmaniStatus('progesterone', value, phase)).toBe('unknown');
        expect(assessAmaniContext('progesterone', value, contextFromReport(phase))).toEqual({
          kind: 'withheld', reason: 'cycle_phase_missing', state: null, phase: null,
        });
      }
    },
  );
});

describe('computeAmaniStatus — LH 40 mIU/mL across the cycle', () => {
  const cases: Array<[CyclePhase, AmaniStatus]> = [
    ['menstrual', 'out_of_range_high'],
    ['follicular', 'out_of_range_high'],
    ['ovulatory', 'optimal'],
    ['luteal', 'out_of_range_high'],
  ];

  it.each(cases)('in %s phase → %s', (phase, expected) => {
    expect(computeAmaniStatus('lh', 40, phase)).toBe(expected);
  });
});

describe('computeAmaniStatus — estradiol 400 pg/mL across the cycle', () => {
  const cases: Array<[CyclePhase, AmaniStatus]> = [
    ['menstrual', 'out_of_range_high'],
    ['follicular', 'out_of_range_high'],
    ['ovulatory', 'optimal'],
    ['luteal', 'out_of_range_high'],
  ];

  it.each(cases)('in %s phase → %s', (phase, expected) => {
    expect(computeAmaniStatus('estradiol', 400, phase)).toBe(expected);
  });
});

describe('computeAmaniStatus — FSH 12 mIU/mL across the cycle', () => {
  const cases: Array<[CyclePhase, AmaniStatus]> = [
    ['menstrual', 'out_of_range_high'],
    ['follicular', 'out_of_range_high'],
    ['ovulatory', 'optimal'],
    ['luteal', 'out_of_range_high'],
  ];

  it.each(cases)('in %s phase → %s', (phase, expected) => {
    expect(computeAmaniStatus('fsh', 12, phase)).toBe(expected);
  });
});

describe('computeAmaniStatus — phases with no dedicated ranges', () => {
  // V2-03 (owner ruling): pregnancy is not a menstrual-phase case. These used
  // to fall back silently to the non-pregnant general range (and the old test
  // only compared two fallbacks). Now each trimester is a non-cycling state
  // and Amani withholds wherever the catalog flags pregnancy or cycle context.
  it.each(['pregnancy_t1', 'pregnancy_t2', 'pregnancy_t3'] as CyclePhase[])(
    '%s withholds rather than using a general or menstrual band',
    (phase) => {
      for (const key of ['progesterone', 'estradiol', 'fsh', 'lh', 'ferritin', 'tsh'] as BiomarkerName[]) {
        expect(computeAmaniStatus(key, 2.0, phase)).toBe('unknown');
        expect(assessAmaniContext(key, 2.0, contextFromReport(phase))).toMatchObject({
          kind: 'withheld', reason: 'non_cycling_state', state: 'pregnancy',
        });
      }
    },
  );

  // Changed: this iterated ALL_PHASES, including the pregnancy trimesters that
  // now withhold. Menstrual phases (and a missing phase) still cannot change
  // a marker the catalog does not mark as cycle-dependent.
  it('ignores the menstrual phase entirely for a marker with no phase ranges', () => {
    for (const phase of ALL_PHASES.filter(p => !p.startsWith('pregnancy_'))) {
      expect(computeAmaniStatus('ferritin', 12, phase)).toBe('out_of_range_low');
    }
    expect(computeAmaniStatus('ferritin', 12, null)).toBe('out_of_range_low');
  });
});

// ─── computeAmaniStatus: unknown / missing-range path ────────────────────────

describe('computeAmaniStatus — unknown paths', () => {
  it('returns unknown for a slug that is not in the dictionary', () => {
    expect(computeAmaniStatus('not_a_real_marker' as BiomarkerName, 5)).toBe('unknown');
  });

  it.each(ALL_PHASES)('returns unknown for an unknown slug in %s phase', (phase) => {
    expect(computeAmaniStatus('not_a_real_marker' as BiomarkerName, 5, phase)).toBe('unknown');
  });

  // SUSPECTED BUG — pinned, not fixed. `ana_screen` is defined with all-null
  // bounds, so `getRangesForPhase` returns a range object (not null) and the
  // `if (!ranges) return 'unknown'` guard never fires. Every value falls
  // through to 'normal', which `NewReport.tsx` persists as flagged: 'in_range'
  // and `statusPill.ts` renders as a blue "Normal" pill instead of the grey
  // "No Range" pill. Reported for a decision; see the accompanying report.
  it('scores a marker with all-null bounds as normal (current behavior)', () => {
    expect(computeAmaniStatus('ana_screen', 3.2)).toBe('normal');
    expect(computeAmaniStatus('ana_screen', 0)).toBe('normal');
  });

  it.fails('SHOULD score a marker with all-null bounds as unknown', () => {
    expect(computeAmaniStatus('ana_screen', 3.2)).toBe('unknown');
  });
});

// ─── computeLabStatus ────────────────────────────────────────────────────────

describe('computeLabStatus — two-sided lab reference range (30–150)', () => {
  const cases: Array<[number, LabStatus, string]> = [
    [90, 'in_range', 'mid-range'],
    [30, 'in_range', 'exactly at the minimum'],
    [150, 'in_range', 'exactly at the maximum'],
    [29, 'borderline_low', 'just under the minimum, inside the 8% buffer'],
    [20.4, 'borderline_low', 'exactly at the buffer floor (30 − 9.6)'],
    [20, 'out_of_range_low', 'past the buffer floor'],
    [151, 'borderline_high', 'just over the maximum, inside the 8% buffer'],
    [159.6, 'borderline_high', 'exactly at the buffer ceiling (150 + 9.6)'],
    [160, 'out_of_range_high', 'past the buffer ceiling'],
  ];

  it.each(cases)('%d → %s (%s)', (value, expected) => {
    expect(computeLabStatus(value, 30, 150)).toBe(expected);
  });
});

describe('computeLabStatus — no reference range', () => {
  it('returns unknown when both bounds are null', () => {
    expect(computeLabStatus(50, null, null)).toBe('unknown');
  });
});

describe('computeLabStatus — one-sided lab reference range', () => {
  // SUSPECTED BUG — pinned, not fixed. With one bound null the range width is
  // Infinity, so the 8% buffer is Infinity and no value can ever clear it.
  // One-sided ranges are common on real lab reports ("<100" for LDL, ">40" for
  // HDL), and `ReportView.tsx` / `buildInsightSummary.ts` both test for
  // labStatus === 'out_of_range_*' to decide whether a panel is clinically out
  // of range. Reported for a decision; see the accompanying report.
  // Buffer is 8% of the single bound, so for "<100" the borderline band is
  // 100 < v <= 108, and anything above that is out of range.
  it('treats a value just past a lone upper bound as borderline_high', () => {
    expect(computeLabStatus(105, null, 100)).toBe('borderline_high');
    expect(computeLabStatus(108, null, 100)).toBe('borderline_high');
  });

  it('treats a value just under a lone lower bound as borderline_low', () => {
    expect(computeLabStatus(38, 40, null)).toBe('borderline_low');
  });

  it('still reports in_range correctly for one-sided ranges', () => {
    expect(computeLabStatus(80, null, 100)).toBe('in_range');
    expect(computeLabStatus(60, 40, null)).toBe('in_range');
  });

  it('reports out_of_range_high for 400 against an upper bound of 100', () => {
    expect(computeLabStatus(400, null, 100)).toBe('out_of_range_high');
  });

  it('reports out_of_range_low for 5 against a lower bound of 40', () => {
    expect(computeLabStatus(5, 40, null)).toBe('out_of_range_low');
  });
});

// ─── statusToConcern ─────────────────────────────────────────────────────────

describe('statusToConcern', () => {
  const cases: Array<[AmaniStatus, 0 | 1 | 2]> = [
    ['optimal', 0],
    ['normal', 0],
    ['borderline_low', 1],
    ['borderline_high', 1],
    ['out_of_range_low', 2],
    ['out_of_range_high', 2],
    ['unknown', 0],
  ];

  it.each(cases)('%s → %d', (status, expected) => {
    expect(statusToConcern(status)).toBe(expected);
  });
});

// ─── scoreBiomarker composition ──────────────────────────────────────────────

describe('scoreBiomarker', () => {
  it('composes amani status, lab status, concern and weight', () => {
    const result = scoreBiomarker('ferritin', 12, 'ng/mL', 13, 150, null);
    expect(result).toMatchObject({
      key: 'ferritin',
      value: 12,
      unit: 'ng/mL',
      // The two scales disagree on purpose: 12 is outside Amani's optimal
      // window outright, but only just under the lab's own 13–150 range, so
      // the lab scale's 8% buffer still calls it borderline.
      amaniStatus: 'out_of_range_low',
      labStatus: 'borderline_low',
      concern: 2,
      scoreWeight: 3, // critical
    });
  });

  it('reports out_of_range_low on both scales once the lab buffer is cleared', () => {
    const result = scoreBiomarker('ferritin', 2, 'ng/mL', 13, 150, null);
    expect(result.amaniStatus).toBe('out_of_range_low');
    expect(result.labStatus).toBe('out_of_range_low');
  });

  it('leaves weightedConcern at zero for an in-range marker', () => {
    const result = scoreBiomarker('ferritin', 90, 'ng/mL', 13, 150, null);
    expect(result.concern).toBe(0);
    expect(result.weightedConcern).toBe(0);
    expect(result.deviationMultiplier).toBe(1);
  });

  it('does not amplify a deviation within 15% of the clinical bound', () => {
    // 13 / 12 = 1.083 → under the 1.15 amplification threshold.
    const result = scoreBiomarker('ferritin', 12, 'ng/mL', 13, 150, null);
    expect(result.deviationMultiplier).toBe(1);
    expect(result.weightedConcern).toBe(6); // 2 concern × 3 weight × 1
  });

  it('amplifies a severe deviation on a critical marker', () => {
    // 13 / 5 = 2.6 → log2 boost plus the critical bonus for ratio ≥ 1.5.
    const result = scoreBiomarker('ferritin', 5, 'ng/mL', 13, 150, null);
    expect(result.deviationMultiplier).toBeCloseTo(1 + Math.log2(13 / 5) + 1, 5);
    expect(result.weightedConcern).toBeGreaterThan(6);
  });

  it('caps the logarithmic boost so one extreme value cannot dominate', () => {
    const result = scoreBiomarker('ferritin', 0.0001, 'ng/mL', 13, 150, null);
    // 1 + capped boost (4) + critical bonus (2) for ratio ≥ 3.
    expect(result.deviationMultiplier).toBe(7);
    expect(Number.isFinite(result.weightedConcern)).toBe(true);
  });

  it('survives a zero value without producing NaN', () => {
    const result = scoreBiomarker('ferritin', 0, 'ng/mL', 13, 150, null);
    expect(Number.isFinite(result.weightedConcern)).toBe(true);
    expect(result.amaniStatus).toBe('out_of_range_low');
  });

  it('carries the cycle phase through to the amani status', () => {
    const luteal = scoreBiomarker('progesterone', 2.0, 'ng/mL', null, null, 'luteal');
    const follicular = scoreBiomarker('progesterone', 2.0, 'ng/mL', null, null, 'follicular');
    expect(luteal.amaniStatus).toBe('out_of_range_low');
    expect(follicular.amaniStatus).toBe('out_of_range_high');
    expect(luteal.labStatus).toBe('unknown');
  });

  it('gives an unknown marker zero concern rather than throwing', () => {
    const result = scoreBiomarker('not_a_real_marker' as BiomarkerName, 5, '', null, null, null);
    expect(result.amaniStatus).toBe('unknown');
    expect(result.concern).toBe(0);
    expect(result.weightedConcern).toBe(0);
  });
});

// ─── Unit sanity (review F011) ───────────────────────────────────────────────
// Amani bands are written in the catalog unit and no conversion is approved, so
// a value in another unit is never flagged against one. Before, LDL 4.9 mmol/L
// (above her lab's interval) was flagged out_of_range_low.

describe('scoreBiomarker — a value in another unit is not flagged against the Amani band', () => {
  it.each([
    ['ldl_cholesterol', 4.9, 'mmol/L', 'out_of_range_high', 0, 3.0],
    ['fasting_glucose', 5.2, 'mmol/L', 'in_range', 3.9, 5.5],
    ['creatinine', 80, 'µmol/L', 'in_range', 45, 90],
  ] as const)('%s %s %s: no Amani status; the lab status stays %s', (key, value, unit, lab, min, max) => {
    expect(scoreBiomarker(key, value, unit, min, max, null)).toMatchObject({
      amaniStatus: 'unknown', labStatus: lab, concern: 0, weightedConcern: 0,
    });
    expect(computeAmaniStatus(key, value, null, null, unit)).toBe('unknown');
  });

  it('the same marker in the catalog unit is still flagged', () => {
    expect(scoreBiomarker('ldl_cholesterol', 160, 'mg/dL', 0, 100, null).amaniStatus).toBe('out_of_range_high');
    expect(computeAmaniStatus('ldl_cholesterol', 160, null, null, 'mg/dL')).toBe('out_of_range_high');
  });
});
