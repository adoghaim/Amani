/**
 * What she types when a value is wrong (PK-CORRECT-01; D20, Q1, R23).
 *
 * Q1: her input takes the upload's path before it is scored.
 *   - The value runs through the upload's value parsing (parseValueWithPrefix,
 *     src/utils/parser/valueExtraction.ts). A "<" or ">" qualifier is kept as
 *     raw text with the numeric part, exactly as the upload keeps it.
 *   - A decimal comma ("5,2") is accepted and read as a decimal point.
 *   - The unit runs through the upload's unit normalization
 *     (normalizeReportItems), so "ng/ml" is stored as "ng/mL".
 *   - Anything that is not a number (with an optional qualifier) is refused
 *     with an inline error, and her text is kept on screen.
 * The flag is recomputed with the upload's own scoring code (uploadFlag),
 * against the report's cycle phase, for a value that has a biomarkers row.
 *
 * R23: a value more than 10 times higher or lower than what Amani read asks
 * once before saving. Nothing is blocked.
 */
import type { BiomarkerName } from '../../types';
import { normalizeReportItems } from '../biomarkers/normalizeReportItems';
import { isScorableValue, uploadFlag, type StoredFlag } from '../scoring/uploadFlag';
import { parseValueWithPrefix } from '../../utils/parser/valueExtraction';
import type { ReportItem } from '../../utils/parser/types';

/** Her text: a number with at most one decimal point or comma, optionally after "<" or ">". */
const NUMBER_AS_PRINTED = /^([<>])?\s*(\d+(?:[.,]\d+)?)$/;

/** Longest value text the database accepts (analyte_corrections_raw_text_length). */
export const CORRECTION_TEXT_MAX = 40;
/** Longest unit the database accepts (analyte_corrections_unit_length). */
export const CORRECTION_UNIT_MAX = 32;

export const CORRECTION_INPUT_ERROR = 'Enter the number as it appears on your lab report, for example 4.5 or <0.5.';
export const CORRECTION_UNIT_ERROR = `Keep the unit to ${CORRECTION_UNIT_MAX} characters.`;

export type ParsedCorrection =
  | { ok: true; value: number; rawText: string; unit: string | null }
  | { ok: false; field: 'value' | 'unit'; error: string };

/** The analyte being corrected, as the saved values give it. */
export interface CorrectionTarget {
  rawName: string;
  canonicalSlug: string | null;
  isCore: boolean;
}

/** Her value and unit, parsed and normalized the way the upload does it. */
export function parseCorrectionInput(text: string, unitText: string, target: CorrectionTarget): ParsedCorrection {
  const trimmed = text.trim();
  const match = NUMBER_AS_PRINTED.exec(trimmed);
  if (!match || trimmed.length > CORRECTION_TEXT_MAX) return { ok: false, field: 'value', error: CORRECTION_INPUT_ERROR };
  const unitTrimmed = unitText.trim();
  if (unitTrimmed.length > CORRECTION_UNIT_MAX) return { ok: false, field: 'unit', error: CORRECTION_UNIT_ERROR };

  const asPrinted = `${match[1] ?? ''}${match[2]!.replace(',', '.')}`;
  const parsed = parseValueWithPrefix(asPrinted);
  if (!parsed || !Number.isFinite(parsed.value)) return { ok: false, field: 'value', error: CORRECTION_INPUT_ERROR };

  const item: ReportItem = {
    raw_name: target.rawName,
    canonical_slug: target.canonicalSlug,
    category: null,
    value_numeric: parsed.value,
    value_text: parsed.rawValue,
    unit: unitTrimmed === '' ? null : unitTrimmed,
    raw_reference_range: null,
    normalized_reference_min: null,
    normalized_reference_max: null,
    reference_operator: null,
    reference_operator_value: null,
    confidence_score: 'high',
    is_core_biomarker: target.isCore,
    needs_review: false,
    source_snippet: null,
  };
  const [normalized] = normalizeReportItems([item]);
  return { ok: true, value: parsed.value, rawText: parsed.rawValue, unit: normalized?._normalized_unit ?? null };
}

/**
 * The flag to store with the correction: the upload's flag for a value with a
 * biomarkers row (a scorable core analyte), otherwise null.
 */
export function correctedFlag(
  target: CorrectionTarget,
  value: number,
  cyclePhase: string | null | undefined,
  hasBiomarkerRow: boolean,
): StoredFlag | null {
  if (!hasBiomarkerRow || !target.canonicalSlug) return null;
  if (!isScorableValue(value)) return 'unknown';
  return uploadFlag(target.canonicalSlug as BiomarkerName, value, cyclePhase);
}

/** R23: more than 10 times higher or lower than what Amani read. */
export const CONFIRM_RATIO = 10;

export function needsConfirmation(readValue: number | null | undefined, newValue: number): boolean {
  if (readValue === null || readValue === undefined || !Number.isFinite(readValue) || !Number.isFinite(newValue)) return false;
  const read = Math.abs(readValue);
  const next = Math.abs(newValue);
  if (read === next) return false;
  if (read === 0 || next === 0) return true;
  return next > read * CONFIRM_RATIO || next < read / CONFIRM_RATIO;
}

/** R23's copy (DESIGN.md "Correction check"). The clinical reviewer reads it with D20's other copy (D7.9). */
export function confirmationQuestion(readDisplay: string): string {
  return `That's very different from what we read (${readDisplay}). Is that what your report says?`;
}
export const CONFIRM_SAVE_LABEL = 'Yes, save it';
export const CONFIRM_CHECK_LABEL = 'Let me check';
