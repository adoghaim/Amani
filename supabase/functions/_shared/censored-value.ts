/**
 * Review F021. A result printed with a comparator ('<8', '> OR = 60', '≤0.5')
 * is censored: the laboratory reported a limit, not a measurement. Storage
 * still holds a placeholder number for it (report_items.value_numeric is NOT
 * NULL; '<X' is stored as X/2 by the parser and by extract-biomarkers), so the
 * printed text is the only authority. Read it here, never the placeholder,
 * before a value is compared, trended or given a percent change.
 *
 * Pure, no imports: used by the web client and the Deno functions alike.
 */

export type CensoredComparator = "<" | "<=" | ">" | ">=";

export interface CensoredResult {
  comparator: CensoredComparator;
  /** The limit as printed, e.g. 8 for '<8'. */
  threshold: number;
}

const CENSORED_RE = /^\s*(<|>|≤|≥)\s*(=|or\s*=)?\s*(\d+(?:\.\d+)?|\.\d+)/i;

/** The comparator and printed limit of a censored result, or null for anything else. */
export function censoredResult(text: unknown): CensoredResult | null {
  if (typeof text !== "string") return null;
  const match = text.match(CENSORED_RE);
  if (!match || match[1] === undefined || match[3] === undefined) return null;
  const threshold = Number(match[3]);
  if (!Number.isFinite(threshold)) return null;
  const symbol = match[1];
  const inclusive = match[2] !== undefined || symbol === "≤" || symbol === "≥";
  const below = symbol === "<" || symbol === "≤";
  const comparator: CensoredComparator = below ? (inclusive ? "<=" : "<") : (inclusive ? ">=" : ">");
  return { comparator, threshold };
}

/** True when the printed result is a limit rather than a measured number. */
export function isCensoredValue(text: unknown): boolean {
  return censoredResult(text) !== null;
}

/**
 * The storage placeholder for a censored result, by the existing convention
 * (half the limit below it, the limit above it), so a row keeps its required
 * number. Null when the text is not censored. Never a value to display,
 * compare or prompt with: readers check isCensoredValue first.
 */
export function censoredPlaceholder(text: unknown): number | null {
  const censored = censoredResult(text);
  if (!censored) return null;
  return censored.comparator.startsWith("<") ? censored.threshold / 2 : censored.threshold;
}
