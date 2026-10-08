import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { BiomarkerName } from '../../types';
import { getAllEntries, getEntry } from '../biomarkers/dictionary';
import { canDescribeAsOptimal, NO_CLAIM_EVIDENCE, type ClaimEvidence, type RangeProvenance } from '../biomarkers/provenance';
import { ANALYTE_CONTEXT } from '../biomarkers/rangeContext.generated';
import {
  MENSTRUAL_PHASES,
  assessAmaniContext,
  contextFromReport,
  formatInterval,
  requiresCycleContext,
  reviewStatusLabel,
  withheldCopy,
  type AmaniAssessment,
  type NonCyclingState,
} from './amaniContext';
import { compareReports } from './compareReports';
import { groupBySystem } from './groupBySystem';
import { comparisonBandLabel, systemSummaryLabel } from './insightCopy';
import { scoreBiomarker } from './scoreBiomarker';

const pillText = (a: AmaniAssessment, value = 1.5) => comparisonBandLabel(a, value).text;

const STATES: NonCyclingState[] = ['pregnancy', 'postpartum', 'hormonal_contraception', 'hormone_therapy', 'perimenopause', 'menopause'];
const cycleKeys = ANALYTE_CONTEXT.filter(a => requiresCycleContext(a.key)).map(a => a.key);
const valuesFor = (key: BiomarkerName) => {
  const e = getEntry(key)!;
  const points = [e.optimal.min, e.optimal.max, e.clinical.min, e.clinical.max].filter((v): v is number => v !== null);
  return [0, ...points, ...points.map(v => v * 0.5), ...points.map(v => v * 2), 1e5];
};
const statusOf = (key: BiomarkerName, phase: string | null) =>
  ANALYTE_CONTEXT.find(a => a.key === key)!.bands.find(b => b.kind === 'amani_context' && b.phase === phase)!.provenance.review_status;

describe('invariant 4 — missing physiological context withholds the Amani score', () => {
  it('derives cycle dependence from catalog data, not a fixed list', () => {
    expect(cycleKeys.length).toBeGreaterThan(0);
    for (const a of ANALYTE_CONTEXT) {
      const flagged = a.cycleDependent || a.bands.some(b => b.kind === 'amani_context' && b.modifiers.cycle === 'requires_context');
      expect(requiresCycleContext(a.key)).toBe(flagged);
    }
    // The four reproductive hormones V2-02 audited are among them.
    expect(cycleKeys).toEqual(expect.arrayContaining(['estradiol', 'progesterone', 'fsh', 'lh']));
  });

  it('never classifies a cycle-dependent marker against the unphased fallback band', () => {
    for (const key of cycleKeys) {
      for (const value of valuesFor(key)) {
        for (const phase of [null, undefined, '', 'unknown', 'general', 'Luteal phase', 'pregnancy_t4']) {
          expect(assessAmaniContext(key, value, contextFromReport(phase))).toEqual({
            kind: 'withheld', reason: 'cycle_phase_missing', state: null, phase: null,
          });
        }
      }
    }
  });

  it('applies only the phase-specific band once the report records a phase', () => {
    for (const key of cycleKeys) {
      for (const phase of MENSTRUAL_PHASES) {
        const a = assessAmaniContext(key, 1, contextFromReport(phase));
        const values = getEntry(key)!.phaseRanges?.[phase];
        if (!values) {
          expect(a).toEqual({ kind: 'withheld', reason: 'cycle_phase_unsupported', state: null, phase });
          continue;
        }
        expect(a.kind).toBe('scored');
        if (a.kind !== 'scored') continue;
        expect(a.band).toMatchObject({ min: values.optimal.min, max: values.optimal.max, phase });
        expect(a.band.provenance.review_status).toBe(statusOf(key, phase));
      }
    }
  });

  it('reads a luteal progesterone of 2 as low, and never reassures without a phase', () => {
    const luteal = assessAmaniContext('progesterone', 2, contextFromReport('luteal'));
    expect(luteal).toMatchObject({ kind: 'scored', status: 'out_of_range_low', band: { phase: 'luteal' } });
    expect(assessAmaniContext('progesterone', 2, contextFromReport(null)).kind).toBe('withheld');
  });

  it.each(STATES)('%s is not a menstrual-phase case and withholds even with a phase', (state) => {
    for (const key of cycleKeys) {
      for (const phase of [...MENSTRUAL_PHASES, null]) {
        expect(assessAmaniContext(key, 1, contextFromReport(phase, state))).toEqual({
          kind: 'withheld', reason: 'non_cycling_state', state, phase: null,
        });
      }
    }
    expect(contextFromReport('luteal', state)).toEqual({ cyclePhase: null, state });
  });

  it('withholds for a state only where the catalog flags a relevant modifier', () => {
    for (const a of ANALYTE_CONTEXT) {
      const flags = a.bands.filter(b => b.kind === 'amani_context').map(b => b.modifiers);
      const pregnancyFlagged = flags.some(m => m.pregnancy === 'requires_context' || m.cycle === 'requires_context');
      expect(assessAmaniContext(a.key, 1, contextFromReport('pregnancy_t2')).kind === 'withheld').toBe(pregnancyFlagged);
    }
  });

  it('does not invent a phase from anything but a recognised report value', () => {
    expect(contextFromReport('LUTEAL')).toEqual({ cyclePhase: 'luteal', state: null });
    expect(contextFromReport('pregnancy_t1')).toEqual({ cyclePhase: null, state: 'pregnancy' });
    for (const raw of [null, undefined, 'unknown', 'mid-cycle', 'day 21', 'general']) {
      expect(contextFromReport(raw)).toEqual({ cyclePhase: null, state: null });
    }
  });

  it('explains what is needed without implying a score exists', () => {
    const missing = withheldCopy({ kind: 'withheld', reason: 'cycle_phase_missing', state: null, phase: null });
    expect(missing.title).toBe('Amani context score unavailable');
    expect(missing.body).toBe('This marker changes meaning across the menstrual cycle. Add or confirm your cycle phase for a more specific interpretation.');
    for (const state of STATES) {
      const copy = withheldCopy({ kind: 'withheld', reason: 'non_cycling_state', state, phase: null });
      expect(copy.body).toMatch(/does not score this result/);
      expect(copy.body).not.toMatch(/menstrual phase|cycle phase/i);
    }
    for (const copy of [missing, withheldCopy({ kind: 'withheld', reason: 'cycle_phase_unsupported', state: null, phase: 'luteal' })]) {
      expect(`${copy.title} ${copy.body}`).not.toMatch(/\b(optimal|normal|in range|score:)\b/i);
    }
  });
});

describe('invariant 2 — the Amani band carries its review status', () => {
  it('attaches the catalog review status of the exact band applied, for every marker', () => {
    const seen = new Set<string>();
    for (const e of getAllEntries()) {
      const phases = requiresCycleContext(e.key) ? MENSTRUAL_PHASES.filter(p => e.phaseRanges?.[p]) : [null];
      for (const phase of phases) {
        const a = assessAmaniContext(e.key, 1, contextFromReport(phase));
        expect(a.kind).toBe('scored');
        if (a.kind !== 'scored') continue;
        expect(a.band.provenance.review_status).toBe(statusOf(e.key, phase));
        expect(a.band.claims).toEqual(NO_CLAIM_EVIDENCE);
        expect(a.band.describeAsOptimal).toBe(canDescribeAsOptimal(a.band.provenance, a.band.claims));
        expect(a.band.describeAsOptimal).toBe(false);
        seen.add(a.band.provenance.review_status);
      }
    }
    expect([...seen].sort()).toEqual(['DISPUTED', 'NEEDS_CONTEXT', 'UNKNOWN']);
    expect(assessAmaniContext('vitamin_d_25_oh', 60, contextFromReport(null))).toMatchObject({
      kind: 'scored', band: { min: 50, max: 80, provenance: { review_status: 'NEEDS_CONTEXT' } },
    });
  });

  it('labels each review state for the user', () => {
    const band = (review_status: RangeProvenance['review_status']) => ({ min: 1, max: 2, phase: null, describeAsOptimal: false, claims: NO_CLAIM_EVIDENCE,
      provenance: { evidence_grade: 'unsourced' as const, review_status, source: null, source_date: null, reviewer: null, reviewed_at: null } });
    expect(reviewStatusLabel(band('UNKNOWN'))).toBe('Not yet reviewed');
    expect(reviewStatusLabel(band('DISPUTED'))).toBe('Disputed range, under review');
    expect(reviewStatusLabel(band('NEEDS_CONTEXT'))).toBe('Needs more context, under review');
  });
});

describe('invariant 3 — UNKNOWN, DISPUTED and NEEDS_CONTEXT never read as unqualified "Optimal"', () => {
  it('no marker at any value or phase yields an "Optimal" label today', () => {
    for (const e of getAllEntries()) {
      for (const phase of [null, ...MENSTRUAL_PHASES]) {
        for (const value of valuesFor(e.key)) {
          const a = assessAmaniContext(e.key, value, contextFromReport(phase));
          expect(pillText(a, value)).not.toMatch(/optimal|normal|borderline/i);
        }
      }
    }
  });

  /*
    V2-03b Stage 2 replaces "the only path to Optimal is canDescribeAsOptimal".
    OPTIMAL_TARGET_CLAIM needs authority the policy can trace: a reviewed rule
    and a target-evidence id. A boolean on the band cannot supply either, so the
    pill has no path to "Optimal" at all, including SAFE with optimal_target set.
  */
  it('no band, even SAFE with optimal-target evidence, makes the pill say "Optimal"', () => {
    const reviewed: RangeProvenance = { evidence_grade: 'A', review_status: 'SAFE', source: 'synthetic fixture',
      source_date: '2000-01-01', reviewer: 'synthetic reviewer', reviewed_at: '2000-01-01' };
    const optimalTarget: ClaimEvidence = { ...NO_CLAIM_EVIDENCE, optimal_target: true };
    const scored = (provenance: RangeProvenance, claims: ClaimEvidence = optimalTarget): AmaniAssessment => ({ kind: 'scored', status: 'optimal',
      band: { min: 1, max: 2, phase: null, provenance, claims, describeAsOptimal: canDescribeAsOptimal(provenance, claims) } });
    const granted = scored(reviewed);
    expect(granted.kind === 'scored' && granted.band.describeAsOptimal).toBe(true);
    expect(pillText(scored(reviewed))).toBe('Within Amani band');
    expect(pillText(scored(reviewed, NO_CLAIM_EVIDENCE))).toBe('Within Amani band');
    for (const review_status of ['UNKNOWN', 'DISPUTED', 'NEEDS_CONTEXT'] as const) {
      expect(pillText(scored({ ...reviewed, review_status }))).toBe('Within Amani band');
    }
    expect(comparisonBandLabel(scored(reviewed), 1.5).category).toBe('comparison_band');
  });

  it('placement is arithmetic on the band, not the status', () => {
    const provenance: RangeProvenance = { evidence_grade: 'unsourced', review_status: 'UNKNOWN', source: null, source_date: null, reviewer: null, reviewed_at: null };
    const band = (min: number | null, max: number | null) => ({ min, max, phase: null, provenance, claims: NO_CLAIM_EVIDENCE, describeAsOptimal: false });
    // A status alone grants no directional metadata: ordinary bands retain the upper bound.
    expect(comparisonBandLabel({ kind: 'scored', status: 'optimal', band: band(50, 90) }, 120)).toMatchObject({ text: 'Outside Amani band', cue: 'attention' });
    expect(comparisonBandLabel({ kind: 'scored', status: 'optimal', band: { ...band(50, 90), higherIsBetter: true } }, 120)).toMatchObject({ text: 'Within Amani band', cue: 'neutral' });
    // 'normal' arises inside a one-sided band, so it is within, never "Normal".
    expect(comparisonBandLabel({ kind: 'scored', status: 'normal', band: band(50, null) }, 60)).toMatchObject({ text: 'Within Amani band', cue: 'neutral' });
    expect(comparisonBandLabel({ kind: 'scored', status: 'normal', band: band(null, null) }, 60).text).toBe('No Amani band');
    for (const status of ['borderline_low', 'out_of_range_low'] as const) {
      expect(comparisonBandLabel({ kind: 'scored', status, band: band(50, 90) }, 40)).toMatchObject({ text: 'Outside Amani band', cue: 'attention' });
    }
  });

  it('no component or page hard-codes an "Optimal" status label', () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) files.push(path);
      }
    };
    ['src/components', 'src/pages', 'src/lib/scoring'].forEach(walk);
    // V2-03b: no exemption left. statusPill.ts is unreachable from the app
    // (see the reachability proof in optimalWording.test.ts) and still carries
    // its gated label, so it is the one known match.
    const offenders = files.filter(f => /(['"`>])\s*Optimal\s*(['"`<])/.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([join('src/lib/scoring', 'statusPill.ts')]);
  });
});

describe('invariant 1 — the Amani band is never the lab_reference row', () => {
  it('a scored band carries Amani context values, not the catalog lab_reference interval', () => {
    for (const e of getAllEntries()) {
      if (requiresCycleContext(e.key)) continue;
      const a = assessAmaniContext(e.key, 1, contextFromReport(null));
      expect(a.kind).toBe('scored');
      if (a.kind === 'scored') expect({ min: a.band.min, max: a.band.max }).toEqual(e.optimal);
    }
  });

  it('formats intervals including one-sided report ranges', () => {
    expect(formatInterval(0.4, 4)).toBe('0.4–4');
    expect(formatInterval(null, 100)).toBe('≤ 100');
    expect(formatInterval(40, null)).toBe('≥ 40');
    expect(formatInterval(null, null)).toBeNull();
  });
});

describe('system summaries under withheld context', () => {
  it('a system with every marker withheld is "not scored", never reassuring', () => {
    const scored = [scoreBiomarker('progesterone', 2, 'ng/mL', 0.2, 25, null), scoreBiomarker('estradiol', 120, 'pg/mL', null, null, null)];
    const [hormones] = groupBySystem(scored);
    expect(hormones).toMatchObject({ category: 'hormones', systemLabel: 'not_scored', scoredCount: 0, totalCount: 2, flaggedCount: 0 });
    expect(systemSummaryLabel(hormones!.scoredCount, hormones!.flaggedCount)).toMatchObject({ text: 'Not scored', cue: 'neutral' });
  });

  it('a phase makes the same system scorable', () => {
    const hormones = groupBySystem([scoreBiomarker('progesterone', 2, 'ng/mL', 0.2, 25, 'luteal')])[0]!;
    expect(hormones.scoredCount).toBe(1);
    expect(hormones.systemLabel).not.toBe('not_scored');
  });
});

describe('longitudinal history under withheld context', () => {
  it('keeps the values but judges no crossing or trajectory', () => {
    const [delta] = compareReports(
      [{ key: 'progesterone', value: 12, unit: 'ng/mL' }],
      [{ key: 'progesterone', value: 2, unit: 'ng/mL' }],
      null,
    );
    expect(delta).toMatchObject({ previousValue: 12, currentValue: 2, boundaryCrossing: null, trajectoryStatus: null,
      distanceToNormalImprovement: null, previousStatus: 'unknown', currentStatus: 'unknown' });
  });

  it('still judges a cycle-dependent marker once the phase is known', () => {
    const [delta] = compareReports(
      [{ key: 'progesterone', value: 12, unit: 'ng/mL' }],
      [{ key: 'progesterone', value: 2, unit: 'ng/mL' }],
      'luteal',
    );
    expect(delta?.currentStatus).toBe('out_of_range_low');
    expect(delta?.trajectoryStatus).not.toBeNull();
  });
});
