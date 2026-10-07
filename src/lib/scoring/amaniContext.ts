import type { AmaniStatus, BiomarkerName } from '../../types';
import { getEntry, type ClinicalRange, type OptimalRange } from '../biomarkers/dictionary';
import { canDescribeAsOptimal, type RangeProvenance } from '../biomarkers/provenance';
import { ANALYTE_CONTEXT, type AnalyteContext, type ContextModifier } from '../biomarkers/rangeContext.generated';

/*
  V2-03: Amani withholds rather than guesses.

  A laboratory's own interval (biomarkers.reference_min/max) and Amani's context
  band are separate concepts. This module only decides the Amani side: whether a
  context band may be applied at all, which one, and with what review state.

  Whether an analyte needs context is read from the catalog (is_cycle_dependent
  and the V2-02 range modifiers), never from a hard-coded analyte list. When the
  required context is missing or unsupported there is NO Amani score: callers
  must still show the raw value and the lab's range.
*/

export const MENSTRUAL_PHASES = ['menstrual', 'follicular', 'ovulatory', 'luteal'] as const;
export type MenstrualPhase = typeof MENSTRUAL_PHASES[number];

/**
 * Physiological states that are not menstrual-phase cases. None has an
 * evidence-backed context rule yet, so each withholds. First-class sources
 * for these states arrive in V2-04; today only a report's pregnancy phase
 * reaches this module.
 */
export type NonCyclingState =
  | 'pregnancy'
  | 'postpartum'
  | 'hormonal_contraception'
  | 'hormone_therapy'
  | 'perimenopause'
  | 'menopause';

export interface PhysiologicalContext {
  cyclePhase: MenstrualPhase | null;
  state: NonCyclingState | null;
}

// Which catalog modifiers a state makes relevant. Every state includes cycle:
// none of them is an ordinary menstrual phase.
const STATE_MODIFIERS: Record<NonCyclingState, readonly ContextModifier[]> = {
  pregnancy: ['pregnancy', 'cycle'],
  postpartum: ['pregnancy', 'life_stage', 'cycle'],
  hormonal_contraception: ['cycle', 'life_stage'],
  hormone_therapy: ['cycle', 'life_stage'],
  perimenopause: ['cycle', 'life_stage'],
  menopause: ['cycle', 'life_stage'],
};

const STATE_LABEL: Record<NonCyclingState, string> = {
  pregnancy: 'pregnancy',
  postpartum: 'the postpartum period',
  hormonal_contraception: 'hormonal contraception',
  hormone_therapy: 'hormone therapy',
  perimenopause: 'perimenopause',
  menopause: 'menopause',
};

/**
 * Builds context from what a report recorded. Never infers: an absent,
 * 'unknown' or unrecognised phase is missing context, and a pregnancy phase
 * is a non-cycling state rather than a menstrual phase.
 */
export function contextFromReport(
  estimatedCyclePhase: string | null | undefined,
  state: NonCyclingState | null = null,
): PhysiologicalContext {
  const raw = typeof estimatedCyclePhase === 'string' ? estimatedCyclePhase.trim().toLowerCase() : '';
  const reportState: NonCyclingState | null = /^pregnancy_t[123]$/.test(raw) ? 'pregnancy' : null;
  const resolvedState = state ?? reportState;
  const phase = (MENSTRUAL_PHASES as readonly string[]).includes(raw) ? raw as MenstrualPhase : null;
  return { cyclePhase: resolvedState ? null : phase, state: resolvedState };
}

const CONTEXT_BY_KEY = new Map<BiomarkerName, AnalyteContext>(ANALYTE_CONTEXT.map(a => [a.key, a]));

// Anything not found in the projection is treated as unreviewed and unsourced.
const UNREVIEWED: RangeProvenance = {
  evidence_grade: 'unsourced', review_status: 'UNKNOWN', source: null, source_date: null, reviewer: null, reviewed_at: null,
};

function contextBands(analyte: AnalyteContext) {
  return analyte.bands.filter(b => b.kind === 'amani_context');
}

/** Catalog data say this analyte cannot be read without a menstrual phase. */
export function requiresCycleContext(key: BiomarkerName): boolean {
  const analyte = CONTEXT_BY_KEY.get(key);
  if (!analyte) return false;
  return analyte.cycleDependent || contextBands(analyte).some(b => b.modifiers.cycle === 'requires_context');
}

function stateRequiresContext(analyte: AnalyteContext, state: NonCyclingState): ContextModifier[] {
  const relevant = STATE_MODIFIERS[state];
  return relevant.filter(m => contextBands(analyte).some(b => b.modifiers[m] === 'requires_context'));
}

export function bandProvenance(key: BiomarkerName, phase: MenstrualPhase | null): RangeProvenance {
  const band = CONTEXT_BY_KEY.get(key)?.bands.find(b => b.kind === 'amani_context' && b.phase === phase);
  return band?.provenance ?? UNREVIEWED;
}

export type WithheldReason = 'cycle_phase_missing' | 'cycle_phase_unsupported' | 'non_cycling_state';

export interface AmaniBand {
  min: number | null;
  max: number | null;
  phase: MenstrualPhase | null;
  provenance: RangeProvenance;
  /** canDescribeAsOptimal(provenance): the ONLY gate for an Optimal label. */
  describeAsOptimal: boolean;
}

export type AmaniAssessment =
  | { kind: 'scored'; status: AmaniStatus; band: AmaniBand }
  | { kind: 'withheld'; reason: WithheldReason; state: NonCyclingState | null; phase: MenstrualPhase | null }
  | { kind: 'unavailable' };

/** Classification against one Amani band. Unchanged from the pre-V2-03 rule. */
export function classifyAgainstBand(
  value: number,
  optimal: OptimalRange,
  clinical: ClinicalRange,
  higherIsBetter: boolean | undefined,
): AmaniStatus {
  const { min: optMin, max: optMax } = optimal;
  const { min: clinMin, max: clinMax } = clinical;

  if (optMin !== null && optMax !== null && value >= optMin && value <= optMax) return 'optimal';

  const borderlineBuffer = 0.15;

  if (optMax !== null && value > optMax) {
    if (higherIsBetter) return 'optimal';
    const threshold = optMax * (1 + borderlineBuffer);
    if (clinMax !== null && value > clinMax) return 'out_of_range_high';
    if (value <= threshold) return 'borderline_high';
    return 'out_of_range_high';
  }

  if (optMin !== null && value < optMin) {
    const threshold = optMin * (1 - borderlineBuffer);
    if (clinMin !== null && value < clinMin) return 'out_of_range_low';
    if (value >= threshold) return 'borderline_low';
    return 'out_of_range_low';
  }

  return 'normal';
}

export function assessAmaniContext(
  key: BiomarkerName,
  value: number,
  context: PhysiologicalContext,
): AmaniAssessment {
  const entry = getEntry(key);
  const analyte = CONTEXT_BY_KEY.get(key);
  if (!entry || !analyte) return { kind: 'unavailable' };

  if (context.state && stateRequiresContext(analyte, context.state).length > 0) {
    return { kind: 'withheld', reason: 'non_cycling_state', state: context.state, phase: null };
  }

  let phase: MenstrualPhase | null = null;
  if (requiresCycleContext(key)) {
    // Never fall back to the unphased band: it is both too wide and too narrow.
    if (!context.cyclePhase) return { kind: 'withheld', reason: 'cycle_phase_missing', state: null, phase: null };
    if (!entry.phaseRanges?.[context.cyclePhase]) {
      return { kind: 'withheld', reason: 'cycle_phase_unsupported', state: null, phase: context.cyclePhase };
    }
    phase = context.cyclePhase;
  }

  const values = phase ? entry.phaseRanges![phase]! : { optimal: entry.optimal, clinical: entry.clinical };
  const provenance = bandProvenance(key, phase);
  return {
    kind: 'scored',
    status: classifyAgainstBand(value, values.optimal, values.clinical, entry.higherIsBetter),
    band: {
      min: values.optimal.min,
      max: values.optimal.max,
      phase,
      provenance,
      describeAsOptimal: canDescribeAsOptimal(provenance),
    },
  };
}

/**
 * A bound pair as written: "0.4–4.0", "≤ 100" or "≥ 40". Null when neither
 * bound exists. One-sided intervals are common on real reports ("<100").
 */
export function formatInterval(min: number | null, max: number | null): string | null {
  if (min !== null && max !== null) return `${min}–${max}`;
  if (max !== null) return `≤ ${max}`;
  if (min !== null) return `≥ ${min}`;
  return null;
}

/** Short, user-facing review state carried beside every Amani band. */
export function reviewStatusLabel(band: AmaniBand): string {
  if (band.describeAsOptimal) return 'Reviewed range';
  switch (band.provenance.review_status) {
    case 'DISPUTED': return 'Disputed range, under review';
    case 'NEEDS_CONTEXT': return 'Needs more context, under review';
    default: return 'Not yet reviewed';
  }
}

/** Copy for a withheld score. Never implies that a score exists. */
export function withheldCopy(assessment: Extract<AmaniAssessment, { kind: 'withheld' }>): { title: string; body: string } {
  const title = 'Amani context score unavailable';
  if (assessment.reason === 'non_cycling_state' && assessment.state) {
    return {
      title,
      body: `This marker can read differently during ${STATE_LABEL[assessment.state]}, and Amani has no reviewed context for it yet, so it does not score this result. Your result and your lab's range are shown as reported.`,
    };
  }
  if (assessment.reason === 'cycle_phase_unsupported') {
    return {
      title,
      body: 'This marker changes meaning across the menstrual cycle, and Amani has no context band for the recorded phase. Your result and your lab\'s range are shown as reported.',
    };
  }
  return {
    title,
    body: 'This marker changes meaning across the menstrual cycle. Add or confirm your cycle phase for a more specific interpretation.',
  };
}
