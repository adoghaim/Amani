import type { TopFinding } from '../insights/buildInsightSummary';
import {
  canClaimFavourableDirection, canDescribeAsOptimal, isReviewedRange,
  type ClaimEvidence, type RangeProvenance,
} from '../biomarkers/provenance';

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

export const FOCUS_AREA_BAND_SENTENCE =
  `One or more of these markers is borderline or outside its Amani band. ${BANDS_UNDER_REVIEW}`;

/** Top Priority fallback text, built locally like the deterministic branches
 * above it rather than echoing TopFinding.fact. */
export function primaryFindingSentence(
  finding: Pick<TopFinding, 'displayName' | 'direction' | 'value' | 'unit'>,
): string {
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
export type ClinicalLanguage =
  | { category: 'factual_observation'; text: string; cue: 'neutral'; authority:
      | { kind: 'lab_data'; subject: string; previous: number | null; current: number; unit: string }
      | { kind: 'patient_lab_interval'; subject: string; min: number | null; max: number | null } }
  | { category: 'comparison_band'; text: string; cue: 'neutral'; authority: {
      kind: 'amani_comparison_band'; reviewStatus: ReviewStatus | null; bands: readonly BandAuthority[];
    } }
  | { category: 'reviewed_interpretation'; text: string; cue: 'neutral'; authority: ReviewedRuleSource }
  | { category: 'optimal_target'; text: string; cue: 'neutral'; authority: {
      kind: 'optimal_target_evidence'; rule: ReviewedRuleSource; targetEvidenceId: string;
    } }
  | { category: 'safety_warning'; text: string; cue: 'warning' | 'critical'; authority: SafetyRuleSource }
  | { category: 'clinical_action'; text: string; cue: 'neutral' | 'warning' | 'critical';
      authority: ReviewedRuleSource | SafetyRuleSource };

export interface MeasuredMovement {
  displayName: string;
  previousValue: number | null;
  currentValue: number;
  unit: string;
  /** Comes from the existing deterministic magnitude calculation. */
  significance: 'minor' | 'moderate' | 'significant';
}

/** No status or band placement can authorize harm, benefit, or care advice. */
export function describeMeasuredMovement(
  movement: MeasuredMovement,
  format: 'values' | 'direction' | 'magnitude' = 'values',
): Extract<ClinicalLanguage, { category: 'factual_observation' }> {
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
    const has = /(antibodies|cells|ratios|levels|counts|enzymes|lipids|electrolytes|hormones|platelets|lymphocytes|monocytes|eosinophils|basophils|neutrophils|reticulocytes|triglycerides|globulins)\b/i.test(displayName) ? 'have' : 'has';
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

/** A comparison-band observation is always separate from clinical meaning. */
export function describeComparisonBand(language: AuthorizedLanguage, placement: Placement = null): Extract<ClinicalLanguage, { category: 'comparison_band' }> {
  return {
    category: 'comparison_band', text: reviewStatement(language, placement), cue: 'neutral',
    authority: { kind: 'amani_comparison_band', reviewStatus: language.reviewStatus, bands: language.bands ?? [] },
  };
}
