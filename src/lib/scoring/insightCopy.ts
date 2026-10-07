import type { TopFinding } from '../insights/buildInsightSummary';

/*
  V2-03 amendment 3. Narrative copy built in src/lib/insights (outside TASK-044's
  paths, and not ours to rewrite) still says "optimal range" about bands whose
  review status is UNKNOWN, DISPUTED or NEEDS_CONTEXT. That copy reaches the page
  only through in-scope call sites, so the call sites qualify it here instead of
  rendering it verbatim. Nothing in this file passes canDescribeAsOptimal, so
  nothing here may say "optimal".
*/

const OPTIMAL = /optimal/i;

export function claimsOptimal(text: string): boolean {
  return OPTIMAL.test(text);
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
 * such sentence is returned unchanged. */
export function withoutOptimalClaims(text: string, replacement = ''): string {
  const sentences = text.split(/(?<=[.!?])\s+/);
  if (!sentences.some(s => OPTIMAL.test(s))) return text;
  const kept: string[] = [];
  let replaced = false;
  for (const sentence of sentences) {
    if (!OPTIMAL.test(sentence)) kept.push(sentence);
    else if (!replaced && replacement) {
      kept.push(replacement);
      replaced = true;
    }
  }
  return kept.join(' ').trim();
}
