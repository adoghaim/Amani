/**
 * A corrected value's provenance on the client (PK-CORRECT-01; D20, R18, R19;
 * DESIGN.md "Provenance").
 *
 * The corrected views add five columns to every row: original_value,
 * original_raw_text, original_unit, is_corrected and corrected_at, and
 * report_analytes_corrected adds the recomputed `flagged`. `withCorrectionMark`
 * takes them off again and, only when the row is corrected, attaches one
 * `correction` mark. So a reader's rows are exactly today's rows while the
 * flag is off or nothing is corrected (R24), and a corrected row differs only
 * in its value, unit, flag and that mark.
 */

export interface ValueCorrectionMark {
  /** What Amani read: the lab's reading, kept and shown struck through. */
  originalValue: number | null;
  originalRawText: string | null;
  originalUnit: string | null;
  /** When she corrected it (the latest correction). */
  correctedAt: string;
  /** The recomputed flag (biomarkers' flag values), or null when the value has none. */
  flag: string | null;
}

/** The columns the corrected views add to their table's own columns. */
export const PROVENANCE_COLUMNS = ['original_value', 'original_raw_text', 'original_unit', 'is_corrected', 'corrected_at'] as const;

/**
 * The view's row as its table's row, plus `correction` when it is corrected.
 * `table` says whether `flagged` is a column of the table (biomarkers) or the
 * view's own addition (report_analytes). Rows from the raw tables pass through
 * untouched.
 */
export function withCorrectionMark<T extends object>(
  row: T,
  table: 'biomarkers' | 'report_analytes',
): T & { correction?: ValueCorrectionMark } {
  const source = row as Record<string, unknown>;
  if (!('is_corrected' in source)) return row;
  const out: Record<string, unknown> = { ...source };
  for (const column of PROVENANCE_COLUMNS) delete out[column];
  if (table === 'report_analytes') delete out.flagged;
  if (source.is_corrected === true && typeof source.corrected_at === 'string') {
    out.correction = {
      originalValue: typeof source.original_value === 'number' ? source.original_value
        : source.original_value == null ? null : Number(source.original_value),
      originalRawText: typeof source.original_raw_text === 'string' ? source.original_raw_text : null,
      originalUnit: typeof source.original_unit === 'string' ? source.original_unit : null,
      correctedAt: source.corrected_at,
      flag: typeof source.flagged === 'string' ? source.flagged : null,
    } satisfies ValueCorrectionMark;
  }
  return out as T & { correction?: ValueCorrectionMark };
}

/** Marks every row of a reader's reply; null stays null. */
export function withCorrectionMarks<T extends object>(
  rows: readonly T[] | null,
  table: 'biomarkers' | 'report_analytes',
): (T & { correction?: ValueCorrectionMark })[] | null {
  return rows === null ? null : rows.map(row => withCorrectionMark(row, table));
}

/** How the misread value reads, struck through: the lab's text when kept, else the number. */
export function originalDisplay(mark: ValueCorrectionMark): string {
  const value = mark.originalRawText ?? (mark.originalValue === null ? '' : String(mark.originalValue));
  return mark.originalUnit ? `${value} ${mark.originalUnit}` : value;
}

/** Her value's colour: pen when she corrected it (DESIGN.md `her-mark`), the caller's ink otherwise. */
export function valueInkClass(mark: ValueCorrectionMark | undefined, ink: string): string {
  return mark ? 'text-theme-pen' : ink;
}

/** The later of two timestamps (either may be null); null when neither parses. */
export function latestTime(a: string | null, b: string | null): string | null {
  const ams = a ? Date.parse(a) : NaN;
  const bms = b ? Date.parse(b) : NaN;
  if (!Number.isFinite(ams)) return Number.isFinite(bms) ? b : null;
  if (!Number.isFinite(bms)) return a;
  return bms > ams ? b : a;
}

// ── R19 ────────────────────────────────────────────────────────────────────

/** The newest correction time among marked rows, or null when none is corrected. */
export function newestCorrectionAt(
  rows: Iterable<{ correction?: ValueCorrectionMark } | null | undefined>,
): string | null {
  let newest: string | null = null;
  let newestMs = -Infinity;
  for (const row of rows) {
    const at = row?.correction?.correctedAt;
    if (!at) continue;
    const ms = Date.parse(at);
    if (Number.isFinite(ms) && ms > newestMs) {
      newestMs = ms;
      newest = at;
    }
  }
  return newest;
}

/**
 * R19's rule, the same as the server's (_shared/value-corrections.ts): stale
 * when the newest correction is later than the time the explanation on screen
 * was written. No correction: never stale. A correction but no known writing
 * time: stale.
 */
export function isExplanationStale(newestCorrection: string | null, explanationWrittenAt: string | null): boolean {
  if (!newestCorrection) return false;
  const correctedMs = Date.parse(newestCorrection);
  if (!Number.isFinite(correctedMs)) return false;
  if (!explanationWrittenAt) return true;
  const writtenMs = Date.parse(explanationWrittenAt);
  if (!Number.isFinite(writtenMs)) return true;
  return correctedMs > writtenMs;
}

/** R19's copy. The clinical reviewer reads it with D20's other copy (D7.9). */
export const STALE_EXPLANATION_TEXT = 'This explanation was written before you corrected a value';
export const REFRESH_EXPLANATION_LABEL = 'Refresh explanation';
export const CORRECTED_VALUE_LABEL = 'You corrected this value';
