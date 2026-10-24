/*
  RV-LF2, Owner Ruling 7 (docs/factory/lab-flag-floor-decision.md). A range her
  lab printed on one side only ("<100", "> OR = 50") binds no bounds: NewReport
  saves its biomarkers row with null/null, and only the report_analytes row
  written from the same item keeps the comparator (normalized_operator and
  normalized_operator_value). The report page and the upload pin read it back
  here as bounds, which every lab-range reader already places exactly as
  labIntervalPlacement places the operator: inclusive at the printed bound,
  with no margin and no threshold of Amani's own.

  Anything else fails closed: no bounds, so the card says the report printed
  none. RV-GI1 copies rule (d) into supabase/functions/_shared, with a parity
  test against this module. Pure: no React, Supabase or Deno.
*/
import { censoredResult } from '../../../supabase/functions/_shared/censored-value';
import { detectComparatorRange } from '../../utils/parser/rangeDetection';
import type { ReportAnalyte } from '../../types';
import { keyOf } from './confirmation';

export type ComparatorRow = Pick<ReportAnalyte,
  'raw_value_text' | 'raw_reference_range' | 'normalized_min' | 'normalized_max'
  | 'normalized_operator' | 'normalized_operator_value'>;
export type ComparatorAnalyte = ComparatorRow & Pick<ReportAnalyte, 'lab_report_id' | 'canonical_slug' | 'value_numeric'>;

export interface PrintedComparator {
  operator: string;
  value: number;
}

export interface LabBounds {
  min: number | null;
  max: number | null;
}

interface BoundedValue {
  lab_report_id: string;
  name: string;
  value: number;
  reference_min: number | null;
  reference_max: number | null;
}

// The comparators labIntervalPlacement reads, by the side of the bound they print.
const UPPER: ReadonlySet<string> = new Set(['<', '<=', '< OR =']);
const LOWER: ReadonlySet<string> = new Set(['>', '>=', '> OR =']);

/** The one-sided range this report_analytes row's lab printed, or null. */
export function printedComparator(row: ComparatorRow): PrintedComparator | null {
  // (a) A row with either bound is placed by its bounds.
  if (row.normalized_min != null || row.normalized_max != null) return null;
  // (b) Only the comparators labIntervalPlacement reads.
  const operator = row.normalized_operator;
  if (operator == null || (!UPPER.has(operator) && !LOWER.has(operator))) return null;
  // (c) A usable bound, as computeLabStatus (scoreBiomarker.ts) requires: finite and not negative.
  const value = row.normalized_operator_value == null ? Number.NaN : Number(row.normalized_operator_value);
  if (!Number.isFinite(value) || value < 0) return null;
  // (d) A censored result's own limit ('<0.2' saved as '<' 0.2) is no range unless
  // the printed reference text prints that same comparator and value.
  const upper = UPPER.has(operator);
  const censored = censoredResult(row.raw_value_text);
  if (censored && censored.comparator.startsWith('<') === upper && censored.threshold === value) {
    const printed = row.raw_reference_range == null ? null : detectComparatorRange(row.raw_reference_range);
    if (!printed || UPPER.has(printed.operator) !== upper || printed.value !== value) return null;
  }
  return { operator, value };
}

/** The '<' family bounds from above, the '>' family from below. */
export function comparatorBounds(c: PrintedComparator): LabBounds {
  return UPPER.has(c.operator) ? { min: null, max: c.value } : { min: c.value, max: null };
}

/**
 * Her lab's bounds for one biomarkers row: its own reference_min/max when
 * either is set. Otherwise the comparator of its report_analytes rows, matched
 * by report, slug and value (keyOf, the F022 join), when at least one matches
 * and every match gives the same direction and value. No match, a
 * disagreement, or a match without a valid comparator gives no bounds.
 */
export function labBoundsFor(b: BoundedValue, analytes: readonly ComparatorAnalyte[]): LabBounds {
  if (b.reference_min != null || b.reference_max != null) return { min: b.reference_min, max: b.reference_max };
  const key = keyOf(b.lab_report_id, b.name, b.value);
  const matched = analytes
    .filter(a => a.canonical_slug != null && a.value_numeric != null
      && keyOf(a.lab_report_id, a.canonical_slug, a.value_numeric) === key)
    .map(a => {
      const comparator = printedComparator(a);
      return comparator && comparatorBounds(comparator);
    });
  const first = matched[0];
  return first && matched.every(m => m !== null && m.min === first.min && m.max === first.max)
    ? first
    : { min: null, max: null };
}
