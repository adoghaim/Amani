import type { ReportItem } from './types';
import { checkPhysiologicalBounds } from './pipeline';
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
    ? checkPhysiologicalBounds(item.canonical_slug, item.value_numeric)
    : null;
  const parse_error = item.parse_error ?? boundsError;
  return {
    ...item,
    parse_error,
    needs_review: item.needs_review || parse_error != null || isBelowLimitResult(item.value_text),
  };
}

/**
 * A value outside physiological bounds, which Amani has probably misread,
 * that she has not marked correct or corrected. Until she does, or removes
 * the row, it cannot be saved (F022).
 */
export function awaitsHerConfirmation(item: Pick<ReportItem, 'parse_error' | 'reviewed_by_user'>): boolean {
  return !!item.parse_error && item.reviewed_by_user !== true;
}
