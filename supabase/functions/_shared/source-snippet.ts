/**
 * RV-SN1 (R-SNIPPET): the printed line behind each row extract-biomarkers
 * answers with, kept as report_analytes.source_snippet.
 *
 * The line is read from the redacted lab text the model was given; the model
 * never writes it. So a snippet is the lab's own words by construction, and
 * model output can never add a flag or critical marker to it: the app reads
 * the lab's printed H/L flag (printedLabFlag, lib/resultRow.ts) and critical
 * marker (lib/safety/labCriticalFlags.ts) from it, and shows it for review.
 *
 * A snippet is the tail of exactly one line of the text, from the result's
 * label on, that prints the result's value after the label: at most
 * MAX_SOURCE_SNIPPET_LENGTH characters, cut only at a space. No such line, or
 * two different ones, gives null (what every row carried before): no
 * tie-break, guess or join across lines.
 *
 * Pure and total, with no imports, so Vitest and the edge runtime both load
 * it. It logs nothing. No RegExp is built from the text or the row, and the
 * work per row is linear in the text length (Knuth-Morris-Pratt search).
 */

/** At most this many characters: the client parser's own snippet window. */
export const MAX_SOURCE_SNIPPET_LENGTH = 200;

/** One row as the model typed it: any field can be any JSON value, or missing. */
export interface SnippetRow {
  name: unknown;
  valueText: unknown;
  valueNumeric: unknown;
}

const LINE_BREAK = /\r\n|\r|\n/;
const WHITESPACE_RUN = /\s+/g;
const ASCII_UPPER = /[A-Z]/g;
const LETTER = /\p{L}/u;
// A letter or number touching the name makes it part of a longer word ("ALT"
// in "HEALTH"). Read from two code units, so a letter outside the BMP counts.
const WORD_CHAR_BEFORE = /[\p{L}\p{N}]$/u;
const WORD_CHAR_AFTER = /^[\p{L}\p{N}]/u;
// A value running on into more number is not that value: "6.8" is not 6,
// "1400" is not 140.
const MORE_NUMBER = /^[\p{Nd}.,]/u;
const SPACE = 0x20;

/** Every whitespace run as one space, trimmed: how lines, names and values compare. */
const normalise = (s: string): string => s.replace(WHITESPACE_RUN, " ").trim();

/** A-Z as a-z, every other code unit as it is: the same length, so an index means the same in both. */
const foldAscii = (s: string): string =>
  s.replace(ASCII_UPPER, (c) => String.fromCharCode(c.charCodeAt(0) + 0x20));

/** The value as the lab printed it: the value text if usable, else the number, else null. */
function printedValue(row: SnippetRow): string | null {
  if (typeof row.valueText === "string") {
    const text = normalise(row.valueText);
    if (text !== "") return text;
  } else if (typeof row.valueText === "number" && Number.isFinite(row.valueText)) {
    return String(row.valueText);
  }
  return typeof row.valueNumeric === "number" && Number.isFinite(row.valueNumeric)
    ? String(row.valueNumeric)
    : null;
}

/** Knuth-Morris-Pratt table: entry i is the length of the longest proper border of p[0..i]. */
function borderTable(p: string): number[] {
  const table = [0];
  for (let i = 1, k = 0; i < p.length; i++) {
    while (k > 0 && p.charCodeAt(i) !== p.charCodeAt(k)) k = table[k - 1];
    if (p.charCodeAt(i) === p.charCodeAt(k)) k++;
    table.push(k);
  }
  return table;
}

/**
 * The first index from `from` at which non-empty `p` occurs in `s` and
 * `accept` holds, else -1. One left-to-right pass: linear in the length of `s`.
 */
function firstOccurrence(
  s: string,
  from: number,
  p: string,
  table: readonly number[],
  accept: (at: number) => boolean,
): number {
  for (let i = from, k = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    while (k > 0 && c !== p.charCodeAt(k)) k = table[k - 1];
    if (c === p.charCodeAt(k)) k++;
    if (k === p.length) {
      if (accept(i + 1 - k)) return i + 1 - k;
      k = table[k - 1];
    }
  }
  return -1;
}

/** No letter or number right before line[start] or right after line[end - 1]. */
const standsAlone = (line: string, start: number, end: number): boolean =>
  !WORD_CHAR_BEFORE.test(line.slice(Math.max(0, start - 2), start)) &&
  !WORD_CHAR_AFTER.test(line.slice(end, end + 2));

/** A token starts at `at`: the line's start, or a space before it. */
const startsToken = (line: string, at: number): boolean => at === 0 || line.charCodeAt(at - 1) === SPACE;

/** The value ends at `end`: its token ends there, or runs on into a flag or unit, not into more number. */
const endsValue = (line: string, end: number): boolean => !MORE_NUMBER.test(line.slice(end, end + 2));

/** `tail` within MAX_SOURCE_SNIPPET_LENGTH, cut at its last space, or null if the cut would drop the value. */
function capped(tail: string, valueEnd: number): string | null {
  if (tail.length <= MAX_SOURCE_SNIPPET_LENGTH) return tail;
  const cut = tail.lastIndexOf(" ", MAX_SOURCE_SNIPPET_LENGTH);
  return cut >= valueEnd ? tail.slice(0, cut) : null;
}

/**
 * Splits the text into lines once (every whitespace run as one space, trimmed,
 * empty lines dropped) and returns the finder for one row, which answers the
 * one distinct snippet or null:
 * - the name is the row's name, normalised like a line, and must hold a
 *   letter. It matches A-Z case-insensitively and every other character
 *   exactly, only where no letter or number touches it; the snippet starts at
 *   the line's first such match.
 * - the value is the row's value text (a comparator such as "<150" matches as
 *   printed, never as its placeholder), else its number. After the name, the
 *   line's tokens must hold the value's tokens in a row, compared exactly; the
 *   last may run on into a flag or unit ("6.8HH", "6.8mmol/L").
 */
export function sourceSnippetFinder(text: unknown): (row: SnippetRow) => string | null {
  const lines = typeof text === "string"
    ? text.split(LINE_BREAK).map(normalise).filter((line) => line !== "")
    : [];
  const folded = lines.map(foldAscii);

  return (row: SnippetRow): string | null => {
    if (typeof row !== "object" || row === null) return null;
    const name = typeof row.name === "string" ? normalise(row.name) : "";
    const value = printedValue(row);
    if (!LETTER.test(name) || value === null) return null;

    const foldedName = foldAscii(name);
    const nameTable = borderTable(foldedName);
    const valueTable = borderTable(value);
    let snippet: string | null = null;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const start = firstOccurrence(folded[i], 0, foldedName, nameTable, (at) => standsAlone(line, at, at + name.length));
      if (start < 0) continue;
      const valueAt = firstOccurrence(
        line,
        start + name.length,
        value,
        valueTable,
        (at) => startsToken(line, at) && endsValue(line, at + value.length),
      );
      if (valueAt < 0) continue;
      const candidate = capped(line.slice(start), valueAt + value.length - start);
      if (candidate === null) continue;
      if (snippet !== null && candidate !== snippet) return null;
      snippet = candidate;
    }
    return snippet;
  };
}
