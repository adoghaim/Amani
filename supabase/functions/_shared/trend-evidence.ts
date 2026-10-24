/**
 * Cross-report comparison, shared by lab-insights (its prompt) and
 * generate-interpretation (stored `trend_evidence[]`). Pure — no Deno, no
 * network, no clock.
 *
 * `compareBiomarkerValues`, `isSignificantChange` and `topChanges` are the
 * lab-insights comparison rules moved here verbatim: pair by key, require the
 * same unit, percent change against the previous value (0 when it was 0).
 */
import { isCensoredValue } from "./censored-value.ts";

export type BiomarkerChange = {
  name: string;
  previous_value: number;
  current_value: number;
  unit: string;
  delta: number;
  percent_change: number;
};

export interface ComparableValue {
  /** Pairing key. lab-insights: normalized name; generation: biomarker slug. */
  key: string;
  name: string;
  value: number;
  unit: string;
  /** The result as printed; a censored one ('<8') carries a placeholder value (review F021). */
  valueText?: string | null;
}

/**
 * Whether a prior value may be compared with a current one: only in the same
 * unit, a missing unit being "". This is the pairing rule trend evidence uses;
 * a prior in another unit is no prior (no trajectory, change or "improved").
 * Review F013: generate-interpretation's buildPrimaryContext must apply it too.
 */
export function sameTrendUnit(current: string | null | undefined, previous: string | null | undefined): boolean {
  return (current ?? "") === (previous ?? "");
}

export function compareBiomarkerValues(
  current: readonly ComparableValue[],
  previous: readonly ComparableValue[],
): Array<BiomarkerChange & { key: string }> {
  return current
    .map(value => {
      const prior = previous.find(p => p.key === value.key);
      if (!prior || !sameTrendUnit(value.unit, prior.unit)) return null;
      // F021: a censored result is a printed limit, not a measurement: no delta or percent change.
      if (isCensoredValue(value.valueText) || isCensoredValue(prior.valueText)) return null;
      const delta = value.value - prior.value;
      return {
        key: value.key,
        name: value.name,
        previous_value: prior.value,
        current_value: value.value,
        unit: value.unit,
        delta,
        percent_change: prior.value !== 0 ? (delta / prior.value) * 100 : 0,
      };
    })
    .filter((x): x is BiomarkerChange & { key: string } => Boolean(x));
}

/** The biomarkers columns lab-insights compares. raw_value_text marks a censored result (review F021). */
export const STORED_BIOMARKER_COLUMNS = "name, value, unit, raw_value_text";

export interface StoredBiomarkerRow {
  name: string;
  value: number;
  unit: string;
  raw_value_text?: string | null;
}

/**
 * lab-insights' pairing of two reports' stored biomarkers rows: by lower-cased,
 * trimmed name, with each value's printed text, so a censored result is never
 * compared or put in its prompt (F021).
 */
export function compareStoredBiomarkers(
  current: readonly StoredBiomarkerRow[],
  previous: readonly StoredBiomarkerRow[],
): Array<BiomarkerChange & { key: string }> {
  const comparable = (b: StoredBiomarkerRow): ComparableValue => ({
    key: b.name.toLowerCase().trim(), name: b.name, value: b.value, unit: b.unit, valueText: b.raw_value_text ?? null,
  });
  return compareBiomarkerValues(current.map(comparable), previous.map(comparable));
}

// Keep this conservative to avoid noise.
// Many lab units vary widely, so we primarily rely on percent change.
export function isSignificantChange(change: BiomarkerChange): boolean {
  const absPct = Math.abs(change.percent_change);
  // Treat tiny baselines carefully: percent changes can explode.
  // If previous value is very small, require a meaningful absolute delta too.
  if (Math.abs(change.previous_value) < 0.01) {
    return Math.abs(change.delta) >= 0.5;
  }
  return absPct >= 10;
}

export function topChanges<T extends BiomarkerChange>(changes: readonly T[], n = 10): T[] {
  return [...changes]
    .sort((a, b) => Math.abs(b.percent_change) - Math.abs(a.percent_change))
    .slice(0, n);
}

/** Stored as json_output.trend_evidence[]: additive, deterministic, no model input. */
export interface TrendEvidence {
  biomarker_slug: string;
  marker: string;
  previous_value: number;
  current_value: number;
  delta: number;
  /** Null when the previous value was 0 (no meaningful ratio). */
  percent_change: number | null;
  unit: string | null;
  previous_date: string | null;
  direction: "increased" | "decreased";
  /** Canonical preview text, e.g. "Vitamin D increased 18 → 31 ng/mL since 2026-03-01". */
  summary: string;
}

/** Bounds prompt tokens and stored size; the largest relative changes win. */
export const MAX_TREND_EVIDENCE = 8;

export interface TrendInputValue {
  slug: string;
  name: string;
  value: unknown;
  unit: string | null;
  /** report_analytes.raw_value_text; a censored result is never part of a trend (F021). */
  value_text?: string | null;
}

const round = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Significant same-unit changes between the current report and the user's most
 * recent earlier report, largest relative change first. Non-numeric values are
 * skipped rather than coerced, so a missing prior value is never a trend.
 */
export function buildTrendEvidence(
  current: readonly TrendInputValue[],
  previous: readonly TrendInputValue[],
  previousDate: string | null,
): TrendEvidence[] {
  // No per-entry timestamp exists here. Prefer a usable numeric entry with a
  // non-empty unit; among equally complete entries the last input occurrence
  // wins. Do not combine a value with a different entry's unit. Map insertion
  // order keeps equal-magnitude ties deterministic, and dedupe precedes the cap.
  const comparable = (values: readonly TrendInputValue[]): ComparableValue[] => {
    const unique = new Map<string, ComparableValue>();
    for (const v of values) {
      const value = typeof v.value === "number" ? v.value
        : typeof v.value === "string" && v.value.trim() !== "" ? Number(v.value) : NaN;
      if (typeof v.slug !== "string" || !v.slug || !Number.isFinite(value)) continue;
      const unit = v.unit ?? "";
      if (!unit && unique.get(v.slug)?.unit) continue;
      unique.set(v.slug, { key: v.slug, name: v.name, value, unit, valueText: v.value_text ?? null });
    }
    return [...unique.values()];
  };
  const date = typeof previousDate === "string" && /^\d{4}-\d{2}-\d{2}/.test(previousDate)
    ? previousDate.slice(0, 10) : null;
  const changes = compareBiomarkerValues(comparable(current), comparable(previous))
    .filter(change => change.delta !== 0 && isSignificantChange(change));
  return topChanges(changes, MAX_TREND_EVIDENCE).map(change => {
    const direction = change.delta > 0 ? "increased" as const : "decreased" as const;
    const unit = change.unit || null;
    return {
      biomarker_slug: change.key,
      marker: change.name,
      previous_value: change.previous_value,
      current_value: change.current_value,
      delta: round(change.delta),
      percent_change: change.previous_value !== 0 ? round(change.percent_change) : null,
      unit,
      previous_date: date,
      direction,
      summary: `${change.name} ${direction} ${change.previous_value} → ${change.current_value}${unit ? ` ${unit}` : ""}`
        + ` since ${date ?? "your previous report"}`,
    };
  });
}

/**
 * Prompt block for generate-interpretation. Empty evidence returns "", so the
 * prompt is byte-identical to before whenever there is nothing to compare.
 */
export function formatTrendEvidencePrompt(evidence: readonly TrendEvidence[]): string {
  if (evidence.length === 0) return "";
  return `\nPRIOR-REPORT CHANGES (deterministic, computed from the user's previous report — do NOT recompute):\n`
    + evidence.map(e => `- ${e.marker} [${e.biomarker_slug}]: ${e.previous_value} → ${e.current_value}${e.unit ? ` ${e.unit}` : ""}`
      + ` (${e.delta > 0 ? "+" : ""}${e.delta}${e.percent_change === null ? "" : `, ${e.percent_change > 0 ? "+" : ""}${Math.round(e.percent_change)}%`})`
      + `${e.previous_date ? ` since ${e.previous_date}` : ""}`).join("\n")
    + `\nWhen a pattern_signals item describes one of these changes, add "trend_biomarker": "<slug from the brackets above>" to that item. Only use a slug listed above; never invent a change.`;
}
