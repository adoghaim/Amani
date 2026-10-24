import type { AmaniStatus, BiomarkerName } from '../../types';
import { getEntry, type ClinicalRange, type OptimalRange } from '../biomarkers/dictionary';
import { isCatalogUnit } from '../biomarkers/normalizeReportItems';
import {
  canDescribeAsOptimal, NO_CLAIM_EVIDENCE, type ClaimEvidence, type RangeProvenance,
} from '../biomarkers/provenance';
import { ANALYTE_CONTEXT, type AnalyteContext, type ContextModifier } from '../biomarkers/rangeContext.generated';
import { censoredResult, type CensoredResult } from '../../../supabase/functions/_shared/censored-value';

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
 * for these states arrive in V2-04; today a report's pregnancy phase and the
 * reproductive status she declared (stateFromPregnancyStatus) reach this module.
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

// Review F012, interim before PK-04: users.pregnancy_status as onboarding and
// Settings write it (PREGNANCY_OPTIONS). Breastfeeding has no state of its own;
// postpartum's modifiers include pregnancy's, so it withholds at least as much.
const DECLARED_STATE = new Map<string, NonCyclingState>([
  ['pregnant', 'pregnancy'],
  ['postpartum', 'postpartum'],
  ['breastfeeding', 'postpartum'],
]);

/**
 * The non-cycling state her declared reproductive status names, or null.
 * Never infers: 'None', 'Prefer not to say', empty or unrecognised is no state.
 */
export function stateFromPregnancyStatus(status: string | null | undefined): NonCyclingState | null {
  if (typeof status !== 'string') return null;
  return DECLARED_STATE.get(status.trim().toLowerCase()) ?? null;
}

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

/**
 * Claim-specific evidence for a band (amendment 4, R2). The catalog has no
 * field recording it for any band, so this is NO_CLAIM_EVIDENCE for every
 * analyte and phase; it is never inferred from review status.
 */
export function bandClaims(_key: BiomarkerName, _phase: MenstrualPhase | null): ClaimEvidence {
  return NO_CLAIM_EVIDENCE;
}

export type WithheldReason = 'cycle_phase_missing' | 'cycle_phase_unsupported' | 'non_cycling_state' | 'censored_result';

export interface AmaniBand {
  /** Placement follows the existing scoring direction; this is not claim authority. */
  higherIsBetter?: boolean;
  min: number | null;
  max: number | null;
  phase: MenstrualPhase | null;
  provenance: RangeProvenance;
  /** Evidence for specific claims, separate from review (amendment 4, R2). */
  claims: ClaimEvidence;
  /** canDescribeAsOptimal(provenance, claims): the ONLY gate for an Optimal label. */
  describeAsOptimal: boolean;
}

export type AmaniAssessment =
  /** `censored`: the printed limit this status was decided on (F021). */
  | { kind: 'scored'; status: AmaniStatus; band: AmaniBand; censored?: CensoredResult }
  | { kind: 'withheld'; reason: Exclude<WithheldReason, 'censored_result'>; state: NonCyclingState | null; phase: MenstrualPhase | null }
  /** F021: a printed limit ('> OR = 60') its band cannot place. `printed` is the result as printed. */
  | { kind: 'withheld'; reason: 'censored_result'; state: null; phase: MenstrualPhase | null; printed: string }
  | { kind: 'unavailable' };

/**
 * Review F021. A censored result allows every value from its printed limit to
 * the open end (0 below a '<' limit, unbounded above a '>' one). Each
 * classifier this is given orders its classes along the value axis, so all of
 * those values share one class exactly when the limit and the open end do:
 * that class, else null (withheld). It reads only the printed comparator and
 * limit and adds no threshold. A strict limit that sits exactly on a boundary
 * can be withheld when it need not be; it is never placed when it should not be.
 */
export function censoredClassification<T>(censored: CensoredResult, classify: (value: number) => T): T | null {
  const atLimit = classify(censored.threshold);
  return atLimit === classify(censored.comparator.startsWith('<') ? 0 : Number.MAX_VALUE) ? atLimit : null;
}

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

/**
 * `unit` is the value's own unit. Bands are written in the catalog unit and the
 * catalog approves no unit conversions, so a value in any other unit, or with
 * none, has no band (review F011). Omit `unit` only for a value already in the
 * catalog unit. `valueText` is the result as printed: a censored one ('<8') is
 * placed by its printed limit, never by its stored placeholder (F021).
 */
export function assessAmaniContext(
  key: BiomarkerName,
  value: number,
  context: PhysiologicalContext,
  unit?: string | null,
  valueText?: string | null,
): AmaniAssessment {
  const entry = getEntry(key);
  const analyte = CONTEXT_BY_KEY.get(key);
  if (!entry || !analyte) return { kind: 'unavailable' };
  if (unit !== undefined && !isCatalogUnit(key, unit)) return { kind: 'unavailable' };
  // Review F097: a value that is not a finite, non-negative number is no measurement.
  if (!Number.isFinite(value) || value < 0) return { kind: 'unavailable' };

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
  // Review F097: a band with no bound at all (ana_screen) places nothing.
  if ([values.optimal.min, values.optimal.max, values.clinical.min, values.clinical.max].every(b => b === null)) {
    return { kind: 'unavailable' };
  }
  const classify = (v: number) => classifyAgainstBand(v, values.optimal, values.clinical, entry.higherIsBetter);
  const censored = censoredResult(valueText);
  const status = censored ? censoredClassification(censored, classify) : classify(value);
  if (status === null) return { kind: 'withheld', reason: 'censored_result', state: null, phase, printed: String(valueText).trim() };
  const provenance = bandProvenance(key, phase);
  const claims = bandClaims(key, phase);
  return {
    kind: 'scored',
    status,
    ...(censored ? { censored } : {}),
    band: {
      higherIsBetter: entry.higherIsBetter,
      min: values.optimal.min,
      max: values.optimal.max,
      phase,
      provenance,
      claims,
      describeAsOptimal: canDescribeAsOptimal(provenance, claims),
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

// V2-03b: the review-state label and withheld copy are band language, so the
// policy authors them. Re-exported here for existing callers.
export { reviewStatusLabel, withheldCopy } from './insightCopy';
