import type { TopFinding } from '../insights/buildInsightSummary';
import {
  canClaimFavourableDirection, canDescribeAsOptimal, isReviewedRange,
  type ClaimEvidence, type RangeProvenance,
} from '../biomarkers/provenance';
import { assessAmaniContext, contextFromReport, formatInterval, type AmaniAssessment, type AmaniBand, type NonCyclingState } from './amaniContext';
import { CATEGORY_DISPLAY, type BiomarkerCategory, type BiomarkerName } from '../../types';

/*
  V2-03 amendment 3. Narrative copy built in src/lib/insights (outside TASK-044's
  paths, and not ours to rewrite) still says "optimal range" about bands whose
  review status is UNKNOWN, DISPUTED or NEEDS_CONTEXT. That copy reaches the page
  only through in-scope call sites, so the call sites qualify it here instead of
  rendering it verbatim.

  V2-03 amendment 4 (R1, R2). authorizedLanguage() is the single owner of what
  may be said about an Amani band, by review status:
    SAFE           reviewed wording; "optimal" ONLY with optimal-target evidence,
                   "improved" or a success indicator ONLY with directional evidence
    NEEDS_CONTEXT  "More context needed"
    DISPUTED       "Interpretation unavailable pending clinical review"
    UNKNOWN        neutral comparison only: no optimal, healthy, improved, good, bad
  A band whose review cannot be established gets UNKNOWN's language. No band in
  the catalog carries claim evidence today, so nothing here can authorize
  "optimal" or a favourable direction for real data.
*/

export type ReviewStatus = RangeProvenance['review_status'];

/** The parts of an applied Amani band that decide its language. */
export interface BandAuthority {
  provenance: RangeProvenance;
  claims: ClaimEvidence;
}

export type Placement = 'within' | 'outside' | null;

export interface AuthorizedLanguage {
  /** Transitional legacy permissions above are not clinical-rule authority. */
  bands?: readonly BandAuthority[];
  /** Null when the band's review state could not be established. */
  reviewStatus: ReviewStatus | null;
  /** SAFE with complete provenance: reviewed, evaluative wording is allowed. */
  reviewedWording: boolean;
  /** The word "optimal". Distinct from review: needs optimal-target evidence. */
  optimal: boolean;
  /** "Improved", favourable direction wording, green success iconography. */
  favourableDirection: boolean;
}

const OPTIMAL = /optimal/i;
const FAVOURABLE = /\bimprov|\bright direction\b|\bpositive direction\b|\bconstructive direction\b|\bbetter range\b/i;
const EVALUATIVE = /\b(healthy|good|bad)\b/i;
const PLURAL_SUBJECT = /(antibodies|cells|ratios|levels|counts|enzymes|lipids|electrolytes|hormones|platelets|lymphocytes|monocytes|eosinophils|basophils|neutrophils|reticulocytes|triglycerides|globulins)\b/i;

export function claimsOptimal(text: string): boolean {
  return OPTIMAL.test(text);
}

export function claimsFavourableDirection(text: string): boolean {
  return FAVOURABLE.test(text);
}

export function authorizedLanguage(band: BandAuthority | null | undefined): AuthorizedLanguage {
  if (!band) return { reviewStatus: null, reviewedWording: false, optimal: false, favourableDirection: false };
  return {
    bands: [band],
    reviewStatus: band.provenance.review_status,
    reviewedWording: isReviewedRange(band.provenance),
    optimal: canDescribeAsOptimal(band.provenance, band.claims),
    favourableDirection: canClaimFavourableDirection(band.provenance, band.claims),
  };
}

// Most restrictive first. An unestablished review ranks with UNKNOWN.
const RESTRICTION: Record<ReviewStatus | 'none', number> = { DISPUTED: 0, NEEDS_CONTEXT: 1, none: 2, UNKNOWN: 2, SAFE: 3 };

/**
 * Language for copy that speaks about several bands at once: the most
 * restrictive status, and a permission only if every band grants it. No band
 * at all means nothing could be established.
 */
export function combineLanguage(languages: readonly AuthorizedLanguage[]): AuthorizedLanguage {
  if (languages.length === 0) return authorizedLanguage(null);
  const strictest = [...languages].sort(
    (a, b) => RESTRICTION[a.reviewStatus ?? 'none'] - RESTRICTION[b.reviewStatus ?? 'none'],
  )[0]!;
  return {
    bands: languages.flatMap(l => l.bands ?? []),
    reviewStatus: strictest.reviewStatus,
    reviewedWording: languages.every(l => l.reviewedWording),
    optimal: languages.every(l => l.optimal),
    favourableDirection: languages.every(l => l.favourableDirection),
  };
}

/** Short status phrase, the owner's wording for each review state. */
export function reviewPhrase(language: AuthorizedLanguage): string {
  switch (language.reviewStatus) {
    case 'NEEDS_CONTEXT': return 'More context needed';
    case 'DISPUTED': return 'Interpretation unavailable pending clinical review';
    case 'SAFE': return language.reviewedWording ? 'Reviewed band' : 'Not yet reviewed';
    default: return 'Not yet reviewed';
  }
}

/** The authorized statement that stands in for a claim the band cannot support. */
export function reviewStatement(language: AuthorizedLanguage, placement: Placement = null): string {
  if (language.reviewStatus === 'DISPUTED') return 'Interpretation unavailable pending clinical review.';
  const pending = 'This band has not yet completed clinical review.';
  if (language.reviewStatus === 'NEEDS_CONTEXT') {
    return `More context needed. Amani's comparison band for this result has not yet completed clinical review.`;
  }
  if (language.reviewedWording) {
    if (placement === 'outside') return "Your result falls outside Amani's reviewed comparison band.";
    if (placement === 'within') return "Your result falls within Amani's reviewed comparison band.";
    return "This compares your result with Amani's reviewed comparison band.";
  }
  if (placement === 'outside') return `Your result falls outside Amani's current comparison band. ${pending}`;
  if (placement === 'within') return `Your result falls within Amani's current comparison band. ${pending}`;
  return `Amani's comparison band for this result has not yet completed clinical review.`;
}

/** Each claim in `text` that `language` does not authorize. Empty means it may render. */
export function unauthorizedClaims(text: string, language: AuthorizedLanguage): ('optimal' | 'favourable_direction' | 'evaluative')[] {
  const out: ('optimal' | 'favourable_direction' | 'evaluative')[] = [];
  if (!language.optimal && OPTIMAL.test(text)) out.push('optimal');
  if (!language.favourableDirection && FAVOURABLE.test(text)) out.push('favourable_direction');
  if (!language.reviewedWording && EVALUATIVE.test(text)) out.push('evaluative');
  return out;
}

/** Replaces matching sentences with `replacement` (once), or drops them when it is empty. */
function replaceSentences(text: string, matches: (sentence: string) => boolean, replacement: string): string {
  const sentences = text.split(/(?<=[.!?])\s+/);
  if (!sentences.some(matches)) return text;
  const kept: string[] = [];
  let replaced = false;
  for (const sentence of sentences) {
    if (!matches(sentence)) kept.push(sentence);
    else if (!replaced && replacement) {
      kept.push(replacement);
      replaced = true;
    }
  }
  return kept.join(' ').trim();
}

/**
 * Renders `text` within what `language` authorizes: every sentence carrying an
 * unauthorized claim is replaced, once, by the band's authorized statement.
 * Text with no such sentence is returned unchanged.
 */
export function authorizeText(text: string, language: AuthorizedLanguage, placement: Placement = null): string {
  return replaceSentences(
    text, s => unauthorizedClaims(s, language).length > 0, reviewStatement(language, placement),
  );
}

/** A title carrying an unauthorized claim becomes "<subject> needs review". */
export function authorizeTitle(title: string, subject: string, language: AuthorizedLanguage): string {
  return unauthorizedClaims(title, language).length > 0 ? `${subject} needs review` : title;
}

export const BANDS_UNDER_REVIEW = "Amani's context bands are still under review.";

// A borderline status is a value outside the band, so "outside" is the whole fact.
export const FOCUS_AREA_BAND_SENTENCE =
  `One or more of these markers is outside its Amani band. ${BANDS_UNDER_REVIEW}`;

/** Top Priority fallback text, built locally like the deterministic branches
 * above it rather than echoing TopFinding.fact. A DISPUTED band withholds
 * placement here as it does in every other sentence. */
export function primaryFindingSentence(
  finding: Pick<TopFinding, 'displayName' | 'direction' | 'value' | 'unit'>,
  language?: AuthorizedLanguage,
): string {
  if (language?.reviewStatus === 'DISPUTED') {
    return `${finding.displayName} was measured at ${finding.value} ${finding.unit}. ${reviewStatement(language)}`;
  }
  const where = finding.direction === 'high' ? 'above' : finding.direction === 'low' ? 'below' : 'outside';
  return `${finding.displayName} is ${where} the Amani band at ${finding.value} ${finding.unit}. ${BANDS_UNDER_REVIEW}`;
}

/** Replaces every sentence that calls a band "optimal" with `replacement`
 * (once), or drops those sentences when `replacement` is empty. Text with no
 * such sentence is returned unchanged. Used where no single band's review
 * state is known; authorizeText is the review-aware form. */
export function withoutOptimalClaims(text: string, replacement = ''): string {
  return replaceSentences(text, s => OPTIMAL.test(s), replacement);
}

/**
 * V2-03b: language carries its source, category and presentation semantics.
 * A range review is not a clinical rule, an optimal-target grant, or a safety
 * rule. The legacy permission object is retained while callers migrate; it
 * cannot mint any of the clinical categories below.
 *
 * Clinical rule variants are a transport contract, not an approval mechanism.
 * No clinical grant is registered or issued here yet. A future producer must
 * resolve the rule and its claim-specific evidence through an approved registry,
 * never accept a rule ID supplied by an LLM or infer approval from band status.
 */
type ReviewedRuleSource = {
  kind: 'reviewed_amani_rule'; ruleId: string; evidenceId: string;
  reviewer: string; reviewedAt: string;
};
type SafetyRuleSource = {
  kind: 'deterministic_safety_rule'; ruleId: string; version: string;
};
/**
 * Amani's standing educational disclaimer (NUTRIENT_GUIDELINES.md rule 2,
 * CLAUDE.md "Medical boundaries"). It is the same text for every report and
 * names no result, so no band, status or movement can produce or withhold it.
 */
type ProductDisclaimerSource = {
  kind: 'product_disclaimer'; policy: 'NUTRIENT_GUIDELINES.md rule 2'; trigger: 'unconditional';
};
/*
  Cues. 'attention' is neutral attention ("this differs, look at it"), never
  "this is bad": it may carry a comparison-band or lab-interval placement.
  'warning' and 'critical' belong to the safety channel and to clinical actions
  that cite a rule; no comparison-band or factual variant can carry them.
*/
export type ClinicalLanguage =
  | { category: 'factual_observation'; text: string; cue: 'neutral' | 'attention'; authority:
      | { kind: 'lab_data'; subject: string; previous: number | null; current: number; unit: string }
      | { kind: 'patient_lab_interval'; subject: string; min: number | null; max: number | null }
      | { kind: 'personal_history'; subject: string } }
  | { category: 'comparison_band'; text: string; cue: 'neutral' | 'attention'; authority: {
      kind: 'amani_comparison_band'; reviewStatus: ReviewStatus | null; bands: readonly BandAuthority[];
    } }
  | { category: 'reviewed_interpretation'; text: string; cue: 'neutral'; authority: ReviewedRuleSource }
  | { category: 'optimal_target'; text: string; cue: 'neutral'; authority: {
      kind: 'optimal_target_evidence'; rule: ReviewedRuleSource; targetEvidenceId: string;
    } }
  | { category: 'safety_warning'; text: string; cue: 'warning' | 'critical'; authority: SafetyRuleSource }
  | { category: 'clinical_action'; text: string; cue: 'neutral' | 'warning' | 'critical';
      authority: ReviewedRuleSource | SafetyRuleSource | ProductDisclaimerSource }
  | { category: 'discussion_prep'; text: string; cue: 'neutral'; authority: DiscussionPrepSource }
  | { category: 'educational_content'; text: string; cue: 'neutral'; authority: GeneralEducationSource };

/*
  Owner R2. A question she may bring to a clinician. Its premises are the only
  facts it may rest on: measured values, measured changes, her laboratory's
  printed interval, a reviewed interpretation (none is registered), or context
  she supplied. An Amani comparison band is not an admissible premise, and the
  prompt carries no recommendation or safety authority: it is preparation, not
  escalation, and its cue can only be neutral.
*/
export type DiscussionPremise =
  | { kind: 'measured_value'; subject: string; value: number; unit: string }
  | { kind: 'measured_change'; subject: string; previous: number; current: number; unit: string }
  | { kind: 'patient_lab_interval'; subject: string; value: number; unit: string;
      min: number | null; max: number | null; placement: LabPlacement }
  | { kind: 'reviewed_interpretation'; rule: ReviewedRuleSource }
  | { kind: 'patient_context'; field: string };
type DiscussionPrepSource = {
  kind: 'discussion_prep'; premises: readonly DiscussionPremise[];
  recommendationAuthority: 'none'; safetyAuthority: 'none';
};
/*
  Owner R4. General education names no result, so the same text appears for
  every report that selects its topic. It is never personalized and carries no
  recommendation authority: a food, nutrient, supplement or lifestyle
  recommendation tied to her result needs a Clinical Truth rule, and none exists.
*/
type GeneralEducationSource = {
  kind: 'general_education'; topic: string; personalized: false; recommendationAuthority: 'none';
};

// BEGIN GENERATED MOVEMENT POLICY
// Dependency-free policy kernel, copied byte-for-byte for Edge packaging.
// Only deterministic application code supplies facts; model output is never a fact input.
export interface MovementLanguage {
  category: 'factual_observation';
  text: string;
  cue: 'neutral';
  authority: { kind: 'lab_data'; subject: string; previous: number | null; current: number; unit: string };
}
export interface MovementClaim {
  readonly category: 'factual_observation';
  readonly fact: Readonly<MeasuredMovement>;
  readonly authority: MovementLanguage['authority'];
  readonly recommendationAuthority: 'none';
  readonly safetyAuthority: 'none';
}

export interface ValidatedMovementLanguage extends MovementLanguage {
  readonly claim: MovementClaim;
}

// Object identity is deliberately local: deserialized/model-authored claims are not grants.
// A server must reconstruct claims from its own persisted facts, not accept client grants.
const movementClaims = new WeakMap<MovementClaim, readonly string[]>();
const MOVEMENT_PLURAL_SUBJECT = /(antibodies|cells|ratios|levels|counts|enzymes|lipids|electrolytes|hormones|platelets|lymphocytes|monocytes|eosinophils|basophils|neutrophils|reticulocytes|triglycerides|globulins)\b/i;

export interface MeasuredMovement {
  displayName: string;
  previousValue: number | null;
  currentValue: number;
  unit: string;
  /** Comes from the existing deterministic magnitude calculation. */
  significance: 'minor' | 'moderate' | 'significant';
}

/** No status or band placement can authorize harm, benefit, or care advice. */
function movementLanguage(
  movement: MeasuredMovement,
  format: 'values' | 'direction' | 'magnitude' = 'values',
): MovementLanguage {
  const { displayName, previousValue, currentValue, unit, significance } = movement;
  let text: string;
  if (previousValue === null) {
    text = `${displayName} was measured at ${currentValue} ${unit}.`;
  } else if (format === 'magnitude') {
    text = significance === 'minor'
      ? `${displayName} has not changed significantly.`
      : currentValue === previousValue ? `${displayName} has the same measured value as before.`
      : `${displayName} has changed since your prior report.`;
  } else if (format === 'direction' && currentValue !== previousValue) {
    const has = MOVEMENT_PLURAL_SUBJECT.test(displayName) ? 'have' : 'has';
    text = `${displayName} ${has} ${currentValue > previousValue ? 'risen' : 'dropped'} from ${previousValue} to ${currentValue} ${unit}.`;
  } else if (significance === 'minor') {
    text = `${displayName} has not changed significantly: ${previousValue} to ${currentValue} ${unit}.`;
  } else {
    // Equality remains factual even if an upstream significance is inconsistent.
    const verb = currentValue > previousValue ? 'increased' : currentValue < previousValue ? 'decreased' : 'remained';
    text = currentValue === previousValue
      ? `${displayName} ${verb} at ${currentValue} ${unit}.`
      : `${displayName} ${verb} from ${previousValue} to ${currentValue} ${unit}.`;
  }
  return {
    category: 'factual_observation', text, cue: 'neutral',
    authority: { kind: 'lab_data', subject: displayName, previous: previousValue, current: currentValue, unit },
  };
}

/** Issue from deterministic measurements only; never call with model-extracted authority. */
export function createMovementClaim(movement: MeasuredMovement): MovementClaim {
  if (!movement.displayName.trim() || !Number.isFinite(movement.currentValue)
    || (movement.previousValue !== null && !Number.isFinite(movement.previousValue))
    || !['minor', 'moderate', 'significant'].includes(movement.significance)) {
    throw new Error('Movement claim requires finite measurements and deterministic significance');
  }
  const fact = Object.freeze({ ...movement });
  const authority = Object.freeze(movementLanguage(fact).authority);
  const claim: MovementClaim = Object.freeze({
    category: 'factual_observation', fact, authority,
    recommendationAuthority: 'none', safetyAuthority: 'none',
  });
  const phrases = ['values', 'direction', 'magnitude'].map(format =>
    movementLanguage(fact, format as 'values' | 'direction' | 'magnitude').text);
  if (fact.previousValue !== null && fact.currentValue !== fact.previousValue) {
    const verb = fact.currentValue > fact.previousValue ? 'increased' : 'decreased';
    phrases.push(`Your ${fact.displayName} ${verb} from your previous result.`);
  }
  movementClaims.set(claim, Object.freeze(phrases));
  return claim;
}

/**
 * Optional model phrasing is a finite semantic selection, not free prose checked
 * with a denylist. Unknown phrasing, forged provenance, added advice or stronger
 * meaning is suppressed. Caller may separately render the canonical observation.
 */
export function validateMovementPhrase(claim: MovementClaim, proposal: unknown): ValidatedMovementLanguage | null {
  const phrases = movementClaims.get(claim);
  if (typeof proposal !== 'string' || !phrases?.includes(proposal)) return null;
  return Object.freeze({ category: 'factual_observation', text: proposal, cue: 'neutral', authority: claim.authority, claim });
}

/** Existing movement surfaces now pass through fact -> claim -> policy -> validator. */
export function describeMeasuredMovement(
  movement: MeasuredMovement,
  format: 'values' | 'direction' | 'magnitude' = 'values',
): ValidatedMovementLanguage {
  const claim = createMovementClaim(movement);
  const language = validateMovementPhrase(claim, movementLanguage(claim.fact, format).text);
  if (!language) throw new Error('Canonical movement phrase failed policy validation');
  return language;
}

/**
 * Owner R1, for every model-fed surface: a model proposal renders only as an
 * authorized phrase of a claim the application issued from its own facts.
 * Matching none of them is the common case, and then nothing renders.
 */
export function resolveModelProposal(claims: readonly MovementClaim[], proposal: unknown): ValidatedMovementLanguage | null {
  for (const claim of claims) {
    const validated = validateMovementPhrase(claim, proposal);
    if (validated) return validated;
  }
  return null;
}
// END GENERATED MOVEMENT POLICY

/* ── Model-written prose (owner R1) ──────────────────────────────────
  The interpretation model, the comparison model and any future Ask Amani
  answer are proposals, never authority. Every field a model writes that can
  reach a renderer is listed here, and a renderer reads one only through
  authorizeModelProse. A sentence survives only as an authorized phrase of a
  claim the application issued from its own measurements, so it carries that
  claim's category, fact and source, and no recommendation or safety
  authority. Everything else is suppressed, not labelled: a disclaimer does
  not authorize a claim, and a model cannot strengthen one by rewording it or
  by adding to it.
*/
export const MODEL_PROSE_FIELDS = [
  'interpretation.headline',
  'interpretation.summary_bullets',
  'interpretation.pattern_signals.title',
  'interpretation.pattern_signals.explanation',
  'interpretation.cycle_context.explanation',
  'interpretation.disclaimer',
  'interpretation.biomarkers.plain_english_meaning',
  'interpretation.biomarkers.timing_notes',
  'interpretation.biomarkers.common_non_alarm_reasons',
  'interpretation.biomarkers.when_clinicians_follow_up',
  'insights.summary',
  'insights.notable_changes.change',
  'insights.notable_changes.possible_factors',
  'basic.basic_interpretation',
  'basic.preview',
] as const;
export type ModelProseField = typeof MODEL_PROSE_FIELDS[number];

export interface AuthorizedModelProse {
  readonly field: ModelProseField;
  readonly language: ValidatedMovementLanguage;
}

/** The authorized sentences in a model field (a string or a list of them), each once. */
export function authorizeModelProse(
  field: ModelProseField, proposal: unknown, claims: readonly MovementClaim[],
): AuthorizedModelProse[] {
  const out: AuthorizedModelProse[] = [];
  const seen = new Set<string>();
  for (const item of Array.isArray(proposal) ? proposal : [proposal]) {
    const language = resolveModelProposal(claims, typeof item === 'string' ? item.trim() : item);
    if (language && !seen.has(language.text)) {
      seen.add(language.text);
      out.push(Object.freeze({ field, language }));
    }
  }
  return out;
}

/**
 * One claim per measured change the application computed (compareReports),
 * keyed as the caller keys its markers. A change that cannot be a claim is left
 * out, so nothing about it can be authorized.
 */
export function movementClaimsByKey<K>(changes: Iterable<readonly [K, MeasuredMovement]>): Map<K, MovementClaim> {
  const claims = new Map<K, MovementClaim>();
  for (const [key, change] of changes) {
    try {
      claims.set(key, createMovementClaim({
        displayName: change.displayName, previousValue: change.previousValue,
        currentValue: change.currentValue, unit: change.unit, significance: change.significance,
      }));
    } catch {
      // Non-finite or unsignified measurements issue no claim.
    }
  }
  return claims;
}

/** A comparison-band observation is always separate from clinical meaning. */
export function describeComparisonBand(language: AuthorizedLanguage, placement: Placement = null): Extract<ClinicalLanguage, { category: 'comparison_band' }> {
  return bandLanguageOf(reviewStatement(language, placement), language, 'neutral');
}

/* ─────────────────────────── V2-03b Stage 2 ───────────────────────────
  The owner's seven authority categories, as types. Every ClinicalLanguage
  variant maps to exactly one. UNAUTHORIZED_DEBT has no variant, so this
  module cannot mint it: it classifies copy not yet migrated, in
  docs/clinical/TASK-045/legacy-claim-exceptions.json, which
  optimalWording.test.ts validates against this list.

  "Why is Amani allowed to say this?" is answered by `authority` on every
  value below, never by a status, a fixture, a model or a legacy component.
*/
export const AUTHORITY_CATEGORIES = [
  'FACTUAL_OBSERVATION', 'COMPARISON_BAND_OBSERVATION', 'REVIEWED_CLINICAL_INTERPRETATION',
  'OPTIMAL_TARGET_CLAIM', 'SAFETY_CRITICAL_WARNING', 'CLINICAL_ACTION_RECOMMENDATION',
  // Owner Stage-2 rulings R2 and R4: narrow categories that grant no clinical
  // interpretation and no individualized recommendation.
  'DISCUSSION_PREP_PROMPT', 'EDUCATIONAL_CONTENT',
  'UNAUTHORIZED_DEBT',
] as const;
export type AuthorityCategory = typeof AUTHORITY_CATEGORIES[number];

/** Exhaustive: a new language variant fails typecheck until it is classified. */
export const LANGUAGE_AUTHORITY: {
  readonly [K in ClinicalLanguage['category']]: Exclude<AuthorityCategory, 'UNAUTHORIZED_DEBT'>
} = {
  factual_observation: 'FACTUAL_OBSERVATION',
  comparison_band: 'COMPARISON_BAND_OBSERVATION',
  reviewed_interpretation: 'REVIEWED_CLINICAL_INTERPRETATION',
  optimal_target: 'OPTIMAL_TARGET_CLAIM',
  safety_warning: 'SAFETY_CRITICAL_WARNING',
  clinical_action: 'CLINICAL_ACTION_RECOMMENDATION',
  discussion_prep: 'DISCUSSION_PREP_PROMPT',
  educational_content: 'EDUCATIONAL_CONTENT',
};

export type Cue = ClinicalLanguage['cue'];
export type FactualLanguage = Extract<ClinicalLanguage, { category: 'factual_observation' }>;
export type ComparisonBandLanguage = Extract<ClinicalLanguage, { category: 'comparison_band' }>;
export type SafetyWarning = Extract<ClinicalLanguage, { category: 'safety_warning' }>;
export type DiscussionPrepPrompt = Extract<ClinicalLanguage, { category: 'discussion_prep' }>;
export type EducationalContent = Extract<ClinicalLanguage, { category: 'educational_content' }>;
export type ProductDisclaimer = Extract<ClinicalLanguage, { category: 'clinical_action' }> & {
  authority: ProductDisclaimerSource;
};

/** Presentation follows the cue, never a raw status: only a safety cue is amber or red. */
export const CUE_STYLE: Readonly<Record<Cue, { bg: string; text: string; border: string; dot: string }>> = {
  neutral: { bg: 'bg-theme-neutral-100', text: 'text-theme-neutral-600', border: 'border-theme-neutral-200', dot: 'bg-theme-neutral-400' },
  attention: { bg: 'bg-theme-info-bg', text: 'text-theme-info', border: 'border-theme-info-border', dot: 'bg-theme-info' },
  warning: { bg: 'bg-theme-flag-watch-bg', text: 'text-theme-flag-watch', border: 'border-theme-flag-watch-border', dot: 'bg-theme-flag-watch' },
  critical: { bg: 'bg-theme-flag-low-bg', text: 'text-theme-flag-low', border: 'border-theme-flag-low-border', dot: 'bg-theme-flag-low' },
};

function bandLanguageOf(text: string, language: AuthorizedLanguage, cue: 'neutral' | 'attention'): ComparisonBandLanguage {
  return {
    category: 'comparison_band', text, cue,
    authority: { kind: 'amani_comparison_band', reviewStatus: language.reviewStatus, bands: language.bands ?? [] },
  };
}

function isAre(subjects: readonly string[]): 'is' | 'are' {
  return subjects.length === 1 && !PLURAL_SUBJECT.test(subjects[0]!) ? 'is' : 'are';
}

function listOf(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/* ── Comparison band: one marker ────────────────────────────────────── */

/**
 * Placement against the applied comparison band. Direction metadata preserves
 * the existing scoring rule: higher-is-better bands have no upper placement
 * bound. This describes comparison only, never clinical benefit or safety.
 */
export function bandBounds(band: AmaniBand): { min: number | null; max: number | null } {
  return { min: band.min, max: band.higherIsBetter ? null : band.max };
}

/** Printed interval and plotted region share the placement rule, not catalog endpoints. */
export function bandInterval(band: AmaniBand): string | null {
  const { min, max } = bandBounds(band);
  return formatInterval(min, max);
}

export function bandPlacement(assessment: AmaniAssessment, value: number): Placement {
  if (assessment.kind !== 'scored') return null;
  const { min, max } = bandBounds(assessment.band);
  if (min === null && max === null) return null;
  return (min !== null && value < min) || (max !== null && value > max) ? 'outside' : 'within';
}

/** Shared selection for count-based surfaces; never derive placement from concern. */
export function markerBandPlacement(key: BiomarkerName, value: number, cyclePhase?: string | null): Placement {
  return bandPlacement(assessAmaniContext(key, value, contextFromReport(cyclePhase)), value);
}

/** Short, user-facing review state carried beside every Amani band. */
export function reviewStatusLabel(band: AmaniBand): string {
  if (isReviewedRange(band.provenance)) return 'Reviewed range';
  switch (band.provenance.review_status) {
    case 'DISPUTED': return 'Disputed range, under review';
    case 'NEEDS_CONTEXT': return 'Needs more context, under review';
    default: return 'Not yet reviewed';
  }
}

const STATE_LABEL: Record<NonCyclingState, string> = {
  pregnancy: 'pregnancy',
  postpartum: 'the postpartum period',
  hormonal_contraception: 'hormonal contraception',
  hormone_therapy: 'hormone therapy',
  perimenopause: 'perimenopause',
  menopause: 'menopause',
};

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

export const LAB_INTERVAL_TERM = "Your lab's range:";

export function bandTerm(phase: string | null): string {
  return `Amani context band${phase ? ` (${phase} phase)` : ''}:`;
}

export function phaseBandNote(phase: string, band: AmaniBand): string {
  return `Showing Amani's context band for the ${phase} phase recorded on this report (${reviewStatusLabel(band).toLowerCase()}).`;
}

/** The marker pill. Placement only; review state travels in its authority. */
export function comparisonBandLabel(assessment: AmaniAssessment, value: number): ComparisonBandLanguage {
  if (assessment.kind === 'withheld') return bandLanguageOf('Context needed', authorizedLanguage(null), 'neutral');
  if (assessment.kind === 'unavailable') return bandLanguageOf('No Amani band', authorizedLanguage(null), 'neutral');
  const language = authorizedLanguage(assessment.band);
  const placement = bandPlacement(assessment, value);
  if (placement === 'within') return bandLanguageOf('Within Amani band', language, 'neutral');
  if (placement === 'outside') return bandLanguageOf('Outside Amani band', language, 'attention');
  return bandLanguageOf('No Amani band', language, 'neutral');
}

/* ── The patient's own laboratory interval (release invariant 1) ───────── */

export type LabPlacement = 'below' | 'within' | 'above';

/**
 * Her laboratory's interval exactly as printed. Amani adds no margin: a value
 * past either bound is outside it, however close.
 */
export function labIntervalPlacement(
  value: number | null | undefined,
  min: number | null | undefined,
  max: number | null | undefined,
  operator?: string | null,
  operatorValue?: number | null,
): LabPlacement | null {
  if (value == null || Number.isNaN(value)) return null;
  if (min != null || max != null) {
    if (min != null && value < min) return 'below';
    if (max != null && value > max) return 'above';
    return 'within';
  }
  if (operator && operatorValue != null) {
    // Inclusive at the printed bound, as the lab-value classifier has always read it.
    if (operator === '<' || operator === '<=' || operator === '< OR =') return value <= operatorValue ? 'within' : 'above';
    if (operator === '>' || operator === '>=' || operator === '> OR =') return value >= operatorValue ? 'within' : 'below';
  }
  return null;
}

const LAB_PLACEMENT_TEXT: Record<LabPlacement, string> = {
  below: "Below your lab's range",
  within: "Within your lab's range",
  above: "Above your lab's range",
};

export const NO_LAB_INTERVAL = 'No lab range';

/** Null when the report printed no usable interval. */
export function labIntervalObservation(
  subject: string,
  value: number | null | undefined,
  min: number | null | undefined,
  max: number | null | undefined,
  operator?: string | null,
  operatorValue?: number | null,
): FactualLanguage | null {
  const placement = labIntervalPlacement(value, min, max, operator, operatorValue);
  if (!placement) return null;
  const upper = operator && /^</.test(operator) ? operatorValue ?? null : max ?? null;
  const lower = operator && /^>/.test(operator) ? operatorValue ?? null : min ?? null;
  return {
    category: 'factual_observation', text: LAB_PLACEMENT_TEXT[placement],
    cue: placement === 'within' ? 'neutral' : 'attention',
    authority: { kind: 'patient_lab_interval', subject, min: lower, max: upper },
  };
}

/**
 * The same placement as a sentence: "Your ferritin is below your laboratory's
 * reference interval." The authority is stated in the sentence (owner R3).
 */
export function labIntervalStatement(
  subject: string, value: number, min: number | null, max: number | null,
): FactualLanguage | null {
  const observation = labIntervalObservation(subject, value, min, max);
  const placement = labIntervalPlacement(value, min, max);
  if (!observation || !placement) return null;
  return { ...observation, text: `Your ${subject} is ${placement} your laboratory's reference interval.` };
}

/**
 * The bar's "far" marker: the value is more than three times the bound of the
 * interval it is drawn against. Magnitude, not severity: no danger colour.
 */
export function extremeMagnitudeLabel(direction: 'above' | 'below', reference: 'lab' | 'amani'): string {
  const of = reference === 'lab' ? "your lab's range" : "Amani's band";
  return direction === 'above' ? `Over 3× the top of ${of}` : `Under ⅓ of the bottom of ${of}`;
}

/* ── Comparison bands across a system or a report ──────────────────── */

/**
 * A body-system name for the report page. CATEGORY_DISPLAY (src/types, outside
 * this task's paths) labels nutrients "Nutrients & Deficiency", naming a
 * condition; the report shows the system's name only.
 */
export function systemDisplayLabel(category: BiomarkerCategory): string {
  return category === 'nutrients' ? 'Nutrients' : CATEGORY_DISPLAY[category].label;
}

export const SYSTEMS_INTRO ='Scored against Amani context bands, which are still under review. Select a system to filter biomarkers.';

export function systemSummaryLabel(scoredCount: number, outsideCount: number): ComparisonBandLanguage {
  const unestablished = authorizedLanguage(null);
  if (scoredCount === 0) return bandLanguageOf('Not scored', unestablished, 'neutral');
  if (outsideCount === 0) return bandLanguageOf('Scored markers within Amani bands', unestablished, 'neutral');
  return bandLanguageOf(`${outsideCount} outside Amani band${outsideCount === 1 ? '' : 's'}`, unestablished, 'attention');
}

export function outsideBandCount(count: number): string {
  return `${count} outside Amani band${count === 1 ? '' : 's'}`;
}

export interface MarkerBand {
  name: string;
  language: AuthorizedLanguage;
}

/**
 * The report headline when Amani writes it. Placement is stated only where the
 * band permits it: a DISPUTED band withholds placement, as everywhere else.
 */
export function reportHeadline(scoredCount: number, outside: readonly MarkerBand[], all: AuthorizedLanguage): ComparisonBandLanguage {
  if (scoredCount === 0) {
    return bandLanguageOf('Amani did not score any marker on this report against its comparison bands.', all, 'neutral');
  }
  if (outside.length === 0) {
    return bandLanguageOf(all.reviewedWording
      ? "All scored values are within Amani's reviewed comparison bands."
      : "All scored values are within Amani's context bands, which are still under review.", all, 'neutral');
  }
  const placed = outside.filter(o => o.language.reviewStatus !== 'DISPUTED');
  const disputed = outside.filter(o => o.language.reviewStatus === 'DISPUTED');
  const parts: string[] = [];
  if (placed.length > 0) {
    const names = placed.length > 3
      ? [...placed.slice(0, 2).map(p => p.name), `${placed.length - 2} other markers`]
      : placed.map(p => p.name);
    parts.push(`${listOf(names)} ${isAre(names)} outside Amani's current comparison band${placed.length > 1 ? 's' : ''}.`);
  }
  if (disputed.length > 0) {
    parts.push(`Interpretation of ${listOf(disputed.map(d => d.name))} is unavailable pending clinical review.`);
  }
  const language = combineLanguage(outside.map(o => o.language));
  if (placed.length > 0 && !combineLanguage(placed.map(p => p.language)).reviewedWording) parts.push(BANDS_UNDER_REVIEW);
  return bandLanguageOf(parts.join(' '), language, 'attention');
}

export const PRIMARY_FINDING_LABEL = 'Primary finding';

/** The report title when Amani scored nothing and no model headline resolves. Names no result. */
export const REPORT_TITLE = 'Your lab results';

/* The comparison modal: measured changes between two reports, nothing more. */
export const COMPARISON_CHANGES_HEADING = 'Measured changes';
export const COMPARISON_CHANGES_EMPTY = 'No measured change between these two reports is available to show.';

/* ── Trajectory (owner R1: movement stated, never judged) ──────────── */

/** A change of band classification, without naming either bucket. */
export function crossingObservation(subject: string, since: string, language: AuthorizedLanguage): ComparisonBandLanguage {
  return bandLanguageOf(`${subject} changed from its previous range classification${since}. ${reviewStatement(language)}`, language, 'neutral');
}

/** A measured change for a marker that stays outside its band. */
export function valuesChangeObservation(
  subject: string, previous: number, current: number, unit: string, since: string, language: AuthorizedLanguage,
): ComparisonBandLanguage {
  return bandLanguageOf(`${subject} changed from ${previous} to ${current} ${unit}${since}. ${reviewStatement(language)}`, language, 'neutral');
}

/*
  Bucket names for a band crossing. No routed surface prints them since V2-03b
  removed the favourable crossing sentence; kept for the comparison data model.
  "borderline" was the status word, not a placement: the bucket is still outside.
*/
export const BOUNDARY_BUCKET_LABEL = {
  within_band: 'within the Amani band',
  borderline: 'just outside the Amani band',
  out_of_range: 'outside the Amani band',
} as const;

/* ── Focus areas and the health story ──────────────────────────────── */

// Names no placement, so a DISPUTED area's card states none anywhere.
export const FOCUS_AREAS_INTRO = 'Markers from this report, grouped by body system.';
export const FOCUS_AREAS_EMPTY = "No scored marker on this report is outside Amani's comparison bands.";
export const HEALTH_STORY_EMPTY = FOCUS_AREAS_EMPTY;

/** A focus area's sentence: placement for its markers, with the band's review state. */
export function focusAreaObservation(names: readonly string[], language: AuthorizedLanguage): string {
  if (language.reviewStatus === 'DISPUTED') return reviewStatement(language);
  const several = names.length > 1;
  const placed = `${listOf(names)} ${isAre(names)} outside Amani's ${language.reviewedWording ? 'reviewed' : 'current'} comparison band${several ? 's' : ''}.`;
  if (language.reviewedWording) return placed;
  if (language.reviewStatus === 'NEEDS_CONTEXT') return `${placed} ${reviewStatement(language)}`;
  return `${placed} ${several ? 'These bands have' : 'This band has'} not yet completed clinical review.`;
}

/* ── Derived calculations and pattern rules ────────────────────────── */

export interface DerivedMetricInput {
  displayName: string;
  value: number;
  unit: string;
  bandMin: number;
  bandMax: number;
}

/**
 * A ratio Amani calculates from her values, compared with a band that exists
 * only in code: it has no catalog entry, so no review can be established.
 */
export function derivedMetricObservation(metric: DerivedMetricInput): {
  label: ComparisonBandLanguage; sentence: ComparisonBandLanguage; band: string;
} {
  const unestablished = authorizedLanguage(null);
  const within = metric.value >= metric.bandMin && metric.value <= metric.bandMax;
  const band = `${metric.bandMin}–${metric.bandMax}${metric.unit}`;
  return {
    label: bandLanguageOf(within ? 'Within Amani band' : 'Outside Amani band', unestablished, within ? 'neutral' : 'attention'),
    sentence: bandLanguageOf(
      `${metric.displayName} is ${metric.value}${metric.unit}, ${within ? 'within' : 'outside'} Amani's comparison band of ${band}. `
        + "Amani's band for this calculation has not yet completed clinical review.",
      unestablished, within ? 'neutral' : 'attention'),
    band: `Amani band: ${band}`,
  };
}

export const PATTERN_RULES_HEADING = 'Pattern-rule matches';
export const PATTERN_RULES_INTRO =
  "Combinations of your values that matched one of Amani's pattern rules. These rules have not yet completed clinical review. Tap a card for the values.";

export interface MeasuredValue {
  name: string;
  value: number;
  unit: string;
}

/**
 * A pattern rule's match, stated as what was measured and that a rule matched.
 * No rule in src/utils/derivedMetrics.ts is reviewed, approved or a safety
 * rule, so a match names no condition and gives no advice (owner R2).
 */
export function patternRuleObservation(subject: string, measured: readonly MeasuredValue[], language: AuthorizedLanguage): {
  title: ComparisonBandLanguage; description: ComparisonBandLanguage; badge: ComparisonBandLanguage;
} {
  const values = measured.length > 0
    ? ` Measured: ${measured.map(m => `${m.name} ${m.value}${m.unit ? ` ${m.unit}` : ''}`).join('; ')}.` : '';
  const matched = language.reviewStatus === 'DISPUTED'
    ? '' : " These values matched one of Amani's pattern rules, which have not yet completed clinical review.";
  return {
    title: bandLanguageOf(`${subject}: pattern-rule match`, language, 'attention'),
    description: bandLanguageOf(`${reviewStatement(language)}${values}${matched}`, language, 'attention'),
    badge: bandLanguageOf('Not yet reviewed', language, 'attention'),
  };
}

/*
  "Recommended labs ... suggested based on this report" recommended testing,
  ranked by placement against unreviewed bands, with no rule authorizing a
  test recommendation (CLINICAL_ACTION_RECOMMENDATION needs one). The list is
  a fact: markers related to this report that it did not include.
*/
export const RELATED_MARKERS_HEADING = 'Related markers not on this report';
export function relatedMarkersIntro(count: number): string {
  return `${count} related ${count === 1 ? 'marker' : 'markers'} this report did not include`;
}

/* ── Discussion preparation (DISCUSSION_PREP_PROMPT, owner R2) ─────────
  Questions she may bring to a clinician, built only from admissible premises.
  Each question states its premise in the words the rest of the page uses for
  the same fact (the measured change; her lab's interval as printed), then asks
  a neutral question. It never presumes direction of health ("getting worse"),
  treatment ("should I start"), danger, or a need for care: urgency belongs to
  the safety channel alone.

  Only prompts this module issued render. A prompt is a capability, like a
  movement claim: copying one and editing its text, or deserializing one, does
  not keep the grant.
*/
const issuedPrompts = new WeakSet<DiscussionPrepPrompt>();

function prepPrompt(text: string, premises: readonly DiscussionPremise[]): DiscussionPrepPrompt {
  const prompt: DiscussionPrepPrompt = Object.freeze({
    category: 'discussion_prep', text, cue: 'neutral',
    authority: Object.freeze({
      kind: 'discussion_prep', premises: Object.freeze([...premises]),
      recommendationAuthority: 'none', safetyAuthority: 'none',
    }),
  } as const);
  issuedPrompts.add(prompt);
  return prompt;
}

/** True only for a prompt this policy issued, unmodified. Everything else must not render. */
export function isIssuedDiscussionPrompt(value: unknown): value is DiscussionPrepPrompt {
  return typeof value === 'object' && value !== null && issuedPrompts.has(value as DiscussionPrepPrompt);
}

export const DISCUSSION_PREP_HEADING = 'Questions you could bring to a clinician';
export const DISCUSSION_PREP_INTRO =
  'Optional questions built from the values on this report, to help you prepare for any conversation with your clinician. '
  + 'They are preparation only, not a judgement about your results.';

const LAB_INTERVAL_WORDS: Record<Exclude<LabPlacement, 'within'>, string> = {
  below: 'below', above: 'above',
};

export const DISCUSSION_PREP = {
  /** A measured change between two of her results. */
  change: (subject: string, previous: number, current: number, unit: string): DiscussionPrepPrompt => prepPrompt(
    `My ${subject} changed from ${previous} to ${current} ${unit}. What could explain this change, and is it clinically meaningful?`,
    [{ kind: 'measured_change', subject, previous, current, unit }],
  ),
  /** Her value outside her own laboratory's printed interval, exactly as labIntervalPlacement reads it. */
  labInterval: (subject: string, value: number, unit: string, min: number | null, max: number | null): DiscussionPrepPrompt | null => {
    const placement = labIntervalPlacement(value, min, max);
    const interval = formatInterval(min ?? null, max ?? null);
    if (!placement || placement === 'within' || !interval) return null;
    return prepPrompt(
      `My ${subject} is ${value} ${unit}, ${LAB_INTERVAL_WORDS[placement]} my lab's reference interval of ${interval} ${unit}. `
        + 'What does this mean in the context of my overall labs?',
      [{ kind: 'patient_lab_interval', subject, value, unit, min: min ?? null, max: max ?? null, placement }],
    );
  },
  /** Several of her values outside their laboratory intervals in one body system. */
  relate: (premises: readonly Extract<DiscussionPremise, { kind: 'patient_lab_interval' }>[]): DiscussionPrepPrompt | null => {
    if (premises.length < 2) return null;
    const names = premises.length > 3
      ? [...premises.slice(0, 2).map(p => p.subject), `${premises.length - 2} other results`]
      : premises.map(p => p.subject);
    return prepPrompt(`Could you help me understand how my ${listOf(names)} results relate to each other?`, premises);
  },
  /** Assumes nothing about her results, so it may appear on any report. */
  context: (): DiscussionPrepPrompt => prepPrompt(
    'Is there anything about my routine or history that matters for reading these results?', [],
  ),
} as const;

/* ── General education (EDUCATIONAL_CONTENT, owner R4) ─────────────────
  Selected by topic, never written from her values: the text is fixed per
  topic and states no result. No food, nutrient, supplement, dose or lifestyle
  recommendation is education: each needs an approved Clinical Truth rule.
*/
function educationalContent(topic: string, text: string): EducationalContent {
  return Object.freeze({
    category: 'educational_content', text, cue: 'neutral',
    authority: Object.freeze({ kind: 'general_education', topic, personalized: false, recommendationAuthority: 'none' }),
  } as const);
}

/** The only education the report page shows: how markers in a system are read together. */
export const EDUCATION = {
  thyroid_antibodies: educationalContent('thyroid_antibodies',
    'TPO antibodies are usually read together with TSH, Free T4, Free T3 and any thyroid-related symptoms.'),
  lipids: educationalContent('lipids',
    'HDL, LDL, triglycerides, total cholesterol and ApoB are usually read together as one lipid pattern over time.'),
  cycle_hormones: educationalContent('cycle_hormones',
    'Hormone values can shift with cycle timing, so cycle day and symptoms matter when reading this area.'),
  glucose: educationalContent('glucose',
    'Glucose-related markers are often read together, because one marker alone may not show the full metabolic picture.'),
  kidney: educationalContent('kidney',
    'BUN, creatinine and their ratio can be influenced by hydration, protein intake and kidney-related context.'),
  nutrients: educationalContent('nutrients',
    'Iron-related and other nutrient markers are often read together as a panel, which gives a fuller picture than any single value.'),
} as const satisfies Record<string, EducationalContent>;

export const EDUCATION_HEADING = 'About these body systems';
export const EDUCATION_INTRO = 'General information about the systems on this report. It is not advice about your results.';

/** Watch signals: grouping metadata, not rendered by any routed surface today. */
export const WATCH_SIGNALS = {
  systemTitle: (system: string) => `${system}: several markers outside Amani bands`,
  systemDescription: (names: readonly string[]) =>
    `${listOf(names)} ${isAre(names)} outside Amani's comparison bands. These bands have not yet completed clinical review.`,
  crossingTitle: (name: string) => `${name}: changed across an Amani band`,
  changeTitle: (name: string) => `${name}: changed since the prior report`,
  change: (from: number, to: number, unit: string, pct: string) => `Changed from ${from} to ${to} ${unit}${pct} since the last report.`,
  patternTitle: (system: string) => `${system}: related markers changed since the last report`,
  patternDescription: (names: string) => `${names} each changed since the last panel.`,
} as const;

// Tracker comparison: "Fluctuations can be normal" reassured about any shift.
export const COMPARE_SHIFTS_NOTE = 'These are measured differences between the two reports. Amani does not interpret them here.';

/* ── Personal history ──────────────────────────────────────────────── */

export function personalHistoryLabel(
  subject: string,
  status: 'above_baseline' | 'below_baseline' | 'near_baseline',
  staleness: 'fresh' | 'stale' | 'limited',
): FactualLanguage {
  const text = staleness === 'limited' ? 'Limited prior history'
    : status === 'above_baseline' ? (staleness === 'stale' ? 'Higher compared with older history' : 'Higher than your usual level')
    : status === 'below_baseline' ? (staleness === 'stale' ? 'Lower compared with older history' : 'Lower than your usual level')
    : staleness === 'stale' ? 'Within your older history range' : 'Within your usual range';
  return { category: 'factual_observation', text, cue: 'neutral', authority: { kind: 'personal_history', subject } };
}

/* ── Product disclaimers (CLINICAL_ACTION_RECOMMENDATION) ──────────── */

function disclaimer(text: string): ProductDisclaimer {
  return {
    category: 'clinical_action', text, cue: 'neutral',
    authority: { kind: 'product_disclaimer', policy: 'NUTRIENT_GUIDELINES.md rule 2', trigger: 'unconditional' },
  };
}

/** Fixed text: no value, band, status or movement selects or edits any of these. */
export const PRODUCT_DISCLAIMERS = {
  derivedMetrics: disclaimer('Derived metrics are educational calculations and not diagnostic values. Always discuss with your healthcare provider.'),
  patternRules: disclaimer('These flags are educational pattern observations, not diagnoses. Always discuss results with your healthcare provider.'),
  guidance: disclaimer('Educational information only. Discuss changes with your provider, especially if you are pregnant, breastfeeding, taking medications, or managing kidney-related concerns.'),
  guidanceCycle: disclaimer('Educational information only. Hormone values are timing-sensitive, so discuss cycle timing and symptoms with your provider.'),
  guidanceKidney: disclaimer('Educational information only. Because kidney-related markers are involved, discuss major diet or supplement changes with your provider first.'),
  // The interpretation's own disclaimer was model or server text; this is the server's default, owned here.
  report: disclaimer('This report is for educational purposes only and does not constitute medical advice.'),
  comparison: disclaimer('This information is for educational purposes only and is not medical advice. Always consult your healthcare provider before making changes to your health routine.'),
} as const satisfies Record<string, ProductDisclaimer>;

/* ── Safety channel (SAFETY_CRITICAL_WARNING) ──────────────────────────
  Separate from everything above, in both directions:
  1. Nothing in this module filters, rewrites or withholds a safety warning.
     authorizeText and the band constructors never receive one.
  2. A rule reads one analyte's measured value and unit. It is never given a
     band, review status, placement or movement, so a band change cannot
     produce or resemble a warning, and the band constructors above can only
     produce 'neutral' or 'attention' cues.
  A rule must carry its clinical approval. None is approved, so the registry is
  empty: Amani has no deterministic safety or critical-value rule today
  (scoreBiomarker.ts notes the missing panic-value tier). Adding one is a
  clinical decision, made through the Clinical Truth Layer, not here.
*/
export interface SafetyRule {
  ruleId: string;
  version: string;
  analyte: string;
  approval: { approvedBy: string; approvedAt: string; evidenceId: string };
  evaluate: (value: number, unit: string) => { cue: 'warning' | 'critical'; text: string } | null;
}

export const SAFETY_RULES: readonly SafetyRule[] = Object.freeze([]);

function isApproved(rule: SafetyRule): boolean {
  const { approvedBy, approvedAt, evidenceId } = rule.approval ?? {};
  return [rule.ruleId, rule.version, approvedBy, approvedAt, evidenceId].every(s => typeof s === 'string' && s.trim().length > 0);
}

/** Every approved rule's warning for these measurements. Unapproved rules fail closed. */
export function evaluateSafetyRules(
  measured: readonly { name: string; value: number; unit: string }[],
  rules: readonly SafetyRule[] = SAFETY_RULES,
): SafetyWarning[] {
  const out: SafetyWarning[] = [];
  for (const rule of rules) {
    if (!isApproved(rule)) continue;
    for (const m of measured) {
      if (m.name !== rule.analyte) continue;
      const hit = rule.evaluate(m.value, m.unit);
      if (hit) {
        out.push({
          category: 'safety_warning', text: hit.text, cue: hit.cue,
          authority: { kind: 'deterministic_safety_rule', ruleId: rule.ruleId, version: rule.version },
        });
      }
    }
  }
  return out;
}
