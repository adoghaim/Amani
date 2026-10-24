import { describe, expect, it } from 'vitest';
import type { Biomarker } from '../../types';
import { getAllEntries } from '../biomarkers/dictionary';
import { evaluateInsightRules } from '../../utils/derivedMetrics';
import { censoredPlaceholder } from '../../../supabase/functions/_shared/censored-value';
import { assessAmaniContext, contextFromReport, MENSTRUAL_PHASES } from './amaniContext';
import {
  bandPlacement, comparisonBandLabel, labIntervalObservation, labIntervalPlacement, markerBandPlacement, withheldCopy,
} from './insightCopy';
import { gateInsightMatches } from './insightGate';

/*
  Review F021, wave 3. A result printed as a limit ('> OR = 60', '<8') is
  stored with a placeholder number, and that number was placed, flagged and
  ranked: eGFR '> OR = 60' (stored 60) read "below the Amani band". A censored
  result is placed only where its comparator and printed limit decide the
  placement against the existing band or interval; otherwise it is withheld.
  Synthetic values only.
*/
const NONE = contextFromReport(null);
const EGFR = 'mL/min/1.73m2';

describe('assessAmaniContext places a censored result only where its printed limit decides it (F021)', () => {
  it('eGFR "> OR = 60" (stored 60): withheld, carrying the printed result', () => {
    expect(assessAmaniContext('egfr', 60, NONE, EGFR, '> OR = 60')).toEqual({
      kind: 'withheld', reason: 'censored_result', state: null, phase: null, printed: '> OR = 60',
    });
  });

  it.each([
    ['vitamin_d_25_oh', 4, 'ng/mL', '<8', 'out_of_range_low'], // wholly below a band starting at 50
    ['ferritin', 1000, 'ng/mL', '>1000', 'out_of_range_high'], // wholly above a band ending at 150
    ['egfr', 90, EGFR, '>90', 'optimal'], // wholly within a higher-is-better band from 90
  ] as const)('%s printed %s: decided', (key, value, unit, printed, status) => {
    const assessment = assessAmaniContext(key, value, NONE, unit, printed);
    expect(assessment.kind === 'scored' && assessment.status).toBe(status);
  });

  it.each([
    ['egfr', 60, EGFR, '> OR = 60'], // below the band or within it
    ['ferritin', 20, 'ng/mL', '<40'], // a limit inside the band 30–150
    ['vitamin_d_25_oh', 22.5, 'ng/mL', '<45'], // below the band, but borderline or out of range
  ] as const)('%s printed %s: withheld', (key, value, unit, printed) => {
    expect(assessAmaniContext(key, value, NONE, unit, printed).kind).toBe('withheld');
  });

  it('the stored number never decides: a placeholder inside the band does not move "<8"', () => {
    const assessment = assessAmaniContext('vitamin_d_25_oh', 70, NONE, 'ng/mL', '<8');
    expect(assessment.kind === 'scored' && assessment.status).toBe('out_of_range_low');
  });

  it('a measured result, or one with no printed text, is assessed by its number as before', () => {
    expect(assessAmaniContext('egfr', 60, NONE, EGFR, '60')).toEqual(assessAmaniContext('egfr', 60, NONE, EGFR));
    const measured = assessAmaniContext('egfr', 60, NONE, EGFR);
    expect(measured.kind === 'scored' && measured.status).toBe('out_of_range_low');
  });

  it('other withholding comes first: a cycle-dependent marker without a phase keeps its own reason', () => {
    const assessment = assessAmaniContext('progesterone', 0.25, NONE, 'ng/mL', '<0.5');
    expect(assessment.kind === 'withheld' && assessment.reason).toBe('cycle_phase_missing');
  });
});

describe('placement, pill and note for a censored result (F021)', () => {
  it('markerBandPlacement reads the printed limit, never the placeholder', () => {
    expect(markerBandPlacement('egfr', 60, null, EGFR, null, '> OR = 60')).toBeNull();
    expect(markerBandPlacement('vitamin_d_25_oh', 4, null, 'ng/mL', null, '<8')).toBe('outside');
    expect(markerBandPlacement('egfr', 90, null, EGFR, null, '>90')).toBe('within');
    // Control: the measured 60 is outside the band.
    expect(markerBandPlacement('egfr', 60, null, EGFR, null, '60')).toBe('outside');
  });

  it('bandPlacement follows the limit a censored assessment was decided on, whatever number is passed', () => {
    const assessment = assessAmaniContext('ferritin', 1000, NONE, 'ng/mL', '>1000');
    expect(bandPlacement(assessment, 90)).toBe('outside');
  });

  it('a withheld censored result: a neutral "Context needed" pill and a note that states the printed result', () => {
    const assessment = assessAmaniContext('egfr', 60, NONE, EGFR, '> OR = 60');
    expect(comparisonBandLabel(assessment, 60)).toMatchObject({ text: 'Context needed', cue: 'neutral', category: 'comparison_band' });
    if (assessment.kind !== 'withheld') throw new Error('expected a withheld assessment');
    const copy = withheldCopy(assessment);
    expect(copy.title).toBe('Amani context score unavailable');
    expect(copy.body).toContain('> OR = 60');
    // Plain: nothing about the band and no evaluative word.
    expect(copy.body).not.toMatch(/band|below|above|within|outside|optimal|normal|healthy|good|bad|cycle/i);
  });
});

describe('her lab interval places a censored result only where the limit decides it (F021)', () => {
  it.each([
    [4, 5, 20, null, null, '<8', null], // below 5–20 or inside it
    [4, 30, 100, null, null, '<8', 'below'],
    [60, 60, null, null, null, '> OR = 60', 'within'],
    [60, null, null, '> OR =', 60, '> OR = 60', 'within'],
    [1000, 15, 150, null, null, '>1000', 'above'],
    [0.1, null, 1, null, null, '<0.2', 'within'],
    [140, 15, 150, null, null, '>140', null], // inside 15–150 or above it
  ] as const)('stored %s against %s–%s (%s %s), printed %s → %s', (value, min, max, op, opValue, printed, placement) => {
    expect(labIntervalPlacement(value, min, max, op, opValue, printed)).toBe(placement);
  });

  it('a measured result is placed by its number as before (control)', () => {
    expect(labIntervalPlacement(4, 5, 20)).toBe('below');
    expect(labIntervalPlacement(4, 5, 20, null, null, '4')).toBe('below');
  });

  it('labIntervalObservation carries the printed text through', () => {
    // A usable interval that cannot place the limit: the fact, with no placement.
    expect(labIntervalObservation('Vitamin D', 4, 5, 20, null, null, '<8')).toMatchObject({
      category: 'factual_observation', text: 'Reported as a limit', cue: 'neutral',
      authority: { kind: 'patient_lab_interval', subject: 'Vitamin D', min: 5, max: 20 },
    });
    expect(labIntervalObservation('Vitamin D', 4, 30, 100, null, null, '<8')?.text).toBe("Below your lab's range");
    // No usable interval: nothing to say, censored or not.
    expect(labIntervalObservation('Vitamin D', 4, null, null, null, null, '<8')).toBeNull();
  });
});

describe('no pattern rule is asserted from a censored input (F021)', () => {
  const panel = (value: number, raw_value_text: string) =>
    [{ name: 'vitamin_d_25_oh', value, unit: 'ng/mL', raw_value_text } as Biomarker];

  it('vitamin D "<8" (stored 4) does not produce a pattern card that states the 4', () => {
    const biomarkers = panel(4, '<8');
    const matches = evaluateInsightRules(biomarkers, null);
    expect(matches.map(m => m.rule_id)).toContain('vitamin_d_deficiency');
    expect(gateInsightMatches(matches, biomarkers, NONE)).toEqual([]);
  });

  it('a measured vitamin D keeps its pattern card (control)', () => {
    const biomarkers = panel(20, '20');
    expect(gateInsightMatches(evaluateInsightRules(biomarkers, null), biomarkers, NONE).map(m => m.rule_id))
      .toEqual(['vitamin_d_deficiency']);
  });
});

/*
  Soundness over the whole catalog: when a censored result is given a status,
  every value its printed result allows has that same status and placement.
  Limits sit on, between and around each catalog bound.
*/
describe('a decided censored status holds for every value the printed result allows (F021)', () => {
  const round = (n: number) => Number(n.toPrecision(6));

  it('every catalog marker, phase, comparator and limit', () => {
    let decided = 0;
    let withheld = 0;
    for (const entry of getAllEntries()) {
      const bounds = [entry.optimal.min, entry.optimal.max, entry.clinical.min, entry.clinical.max].filter((b): b is number => b !== null && b > 0);
      const limits = [...new Set([0.01, ...bounds.flatMap(b => [0.5, 0.85, 0.9, 1, 1.1, 1.15, 2].map(f => round(b * f)))])];
      for (const phase of [null, ...MENSTRUAL_PHASES]) {
        const context = contextFromReport(phase);
        for (const comparator of ['<', '<=', '>', '>='] as const) {
          for (const limit of limits) {
            const printed = `${comparator}${limit}`;
            const placeholder = censoredPlaceholder(printed)!;
            const assessment = assessAmaniContext(entry.key, placeholder, context, undefined, printed);
            if (assessment.kind === 'withheld' && assessment.reason === 'censored_result') withheld++;
            if (assessment.kind !== 'scored') continue;
            decided++;
            const allowed = comparator.startsWith('<')
              ? [0, limit * 0.25, limit * 0.5, limit * 0.9, limit * 0.999, ...(comparator === '<=' ? [limit] : [])]
              : [...(comparator === '>=' ? [limit] : []), limit * 1.001, limit * 1.5, limit * 3, limit * 100, Math.max(1e6, limit * 1e4)];
            for (const value of allowed) {
              const measured = assessAmaniContext(entry.key, value, context);
              const at = `${entry.key}/${phase}/${printed}/${value}`;
              expect(measured.kind === 'scored' && measured.status, at).toBe(assessment.status);
              expect(bandPlacement(assessment, placeholder), at).toBe(bandPlacement(measured, value));
            }
          }
        }
      }
    }
    expect(decided).toBeGreaterThan(500);
    expect(withheld).toBeGreaterThan(500);
  });
});
