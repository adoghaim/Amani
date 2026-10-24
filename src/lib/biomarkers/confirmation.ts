import { isBelowLimitResult } from '../../utils/parser/valueExtraction';

const READING_REVIEW_COLUMN_LIST = [
  'id', 'lab_report_id', 'canonical_slug', 'value_numeric', 'raw_value_text', 'confidence_score', 'needs_review', 'reviewed_by_user',
  'review_status',
] as const;
type Joined<T extends readonly string[]> = T extends readonly [infer H extends string, ...infer R extends readonly string[]]
  ? (R extends readonly [] ? H : `${H},${Joined<R>}`)
  : never;
/**
 * The report_analytes columns that say whether she confirmed a value, each
 * added by an existing migration. Typed as the joined literal, so the
 * Supabase select parser types the rows it returns.
 */
export const READING_REVIEW_COLUMNS = READING_REVIEW_COLUMN_LIST.join(',') as Joined<typeof READING_REVIEW_COLUMN_LIST>;

export interface ReadingReview {
  lab_report_id: string;
  canonical_slug: string | null;
  value_numeric: number | null;
  raw_value_text?: string | null;
  confidence_score?: string | null;
  needs_review?: boolean | null;
  reviewed_by_user?: boolean | null;
  review_status?: string | null;
}

/*
  Before IA2, typing a corrected value set review_status 'edited_by_user' but
  left reviewed_by_user false and needs_review true; Mark as Correct set
  'reviewed'. Both still count as her confirmation (IA2 review wave 2). The
  column comes from the same migrations as reviewed_by_user, and an absent
  value confirms nothing.
*/
const CONFIRMED_REVIEW_STATUSES: ReadonlySet<string> = new Set(['reviewed', 'edited_by_user']);

/**
 * A value Amani may have misread that she has not confirmed (F022): flagged
 * for her review, not marked correct or corrected by her, and either read with
 * low confidence (a physiological-bounds parse error, a model sanity check, an
 * unclear photo) or printed below a limit, so its number is half that limit
 * (F098). It never picks her primary finding and is never a trend point.
 *
 * A row flagged only because its lab printed several intervals (PK-FIX-05)
 * is not one: its value was read cleanly.
 */
export function isUnconfirmedReading(row: ReadingReview): boolean {
  return row.needs_review === true && row.reviewed_by_user !== true
    && !CONFIRMED_REVIEW_STATUSES.has(row.review_status ?? '')
    && (row.confidence_score === 'low' || isBelowLimitResult(row.raw_value_text));
}

interface ScoredValue {
  lab_report_id: string;
  name: string;
  value: number;
}

export const keyOf = (reportId: string, slug: string, value: number) => `${reportId}|${slug}|${Number(value)}`;

/*
  biomarkers rows carry no review columns. NewReport writes each one from the
  same item as its report_analytes row, so a scored value is matched to its
  review by report, slug and value.
*/
export function unconfirmedReadingKeys(analytes: readonly ReadingReview[]): ReadonlySet<string> {
  const keys = new Set<string>();
  for (const a of analytes) {
    if (a.canonical_slug && a.value_numeric != null && isUnconfirmedReading(a)) {
      keys.add(keyOf(a.lab_report_id, a.canonical_slug, a.value_numeric));
    }
  }
  return keys;
}

export function isUnconfirmedBiomarker(b: ScoredValue, keys: ReadonlySet<string>): boolean {
  return keys.has(keyOf(b.lab_report_id, b.name, b.value));
}

export function withoutUnconfirmed<T extends ScoredValue>(rows: readonly T[], analytes: readonly ReadingReview[]): T[] {
  const keys = unconfirmedReadingKeys(analytes);
  return rows.filter(b => !isUnconfirmedBiomarker(b, keys));
}
