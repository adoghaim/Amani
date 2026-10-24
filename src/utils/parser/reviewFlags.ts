import type { ReportItem } from './types';
import { checkPhysiologicalBounds, isOutsideBoundsInAnotherUnit } from './pipeline';
import { isBelowLimitResult } from './valueExtraction';

const DIGIT_RE = /\d/;

/*
  The parser's review rules, applied to every row the confirm step shows,
  whichever reader produced it (F022, F098). AI refinement replaces the
  parser's rows and OCR has none, and neither carries a parse_error, so the
  parser's physiological bounds and its below-limit rule are applied again
  here. A row keeps any verdict the parser already gave it.
*/
export function withReviewFlags<T extends ReportItem>(item: T): T {
  const qualitative = item.value_text != null && !DIGIT_RE.test(item.value_text);
  const boundsError = item.canonical_slug && Number.isFinite(item.value_numeric) && !qualitative
    ? checkPhysiologicalBounds(item.canonical_slug, item.value_numeric, item.unit)
    : null;
  const parse_error = item.parse_error ?? boundsError;
  const held = parse_error == null && heldForHerCheck(item);
  return {
    ...item,
    parse_error,
    ...(held ? { confidence_score: 'low' as const } : {}),
    needs_review: item.needs_review || parse_error != null || held || isBelowLimitResult(item.value_text),
  };
}

type CheckFields = Pick<ReportItem, 'canonical_slug' | 'value_numeric' | 'value_text' | 'unit'>;

function heldForHerCheck(item: CheckFields): boolean {
  const qualitative = item.value_text != null && !DIGIT_RE.test(item.value_text);
  return !!item.canonical_slug && !qualitative && isOutsideBoundsInAnotherUnit(item.canonical_slug, item.value_numeric, item.unit);
}

/**
 * IA2 review wave 2: a value printed in another unit outside the bounds,
 * which Amani cannot check, that she has not marked correct or corrected. It
 * does not keep Save closed, but she is asked to check it, and until she
 * confirms it the saved row is unconfirmed (low confidence, needs_review).
 */
export function awaitsHerCheck(item: CheckFields & Pick<ReportItem, 'parse_error' | 'reviewed_by_user'>): boolean {
  return !item.parse_error && item.reviewed_by_user !== true && heldForHerCheck(item);
}

/**
 * A value outside physiological bounds, which Amani has probably misread,
 * that she has not marked correct or corrected. Until she does, or removes
 * the row, it cannot be saved (F022).
 */
export function awaitsHerConfirmation(item: Pick<ReportItem, 'parse_error' | 'reviewed_by_user'>): boolean {
  return !!item.parse_error && item.reviewed_by_user !== true;
}
