/*
  Review F014 interim (2026-10-23). Not PK-05-B: Amani holds no approved
  critical-value threshold (PK-05-A's clinical reviewer is [Pending]), so
  nothing here compares a value with anything. The rule recognises only a flag
  the laboratory itself printed beside a result to mark it critical, on the
  result's saved line (report_analytes.source_snippet): the token printed
  straight after the value, where resultRow.printedLabFlag reads the lab's H/L
  flag, and also the token after the value's unit ("6.8 mmol/L HH") or glued to
  the value or its unit ("6.8HH", "6.8mmol/L HH": the parser reads a result
  glued to its flag or unit). Every place the value is printed on the line is
  read, so a name that holds the same number ("CA 125 125 HH") cannot hide it.

  The markers are the lab's own words for a critical result and the HL7 v2
  panic-limit codes HH and LL (table 0078). Ordinary H, L, A, High, Low,
  Abnormal and an asterisk are never critical here. The letter codes count in
  capitals only, as printedLabFlag reads the letter family, so a unit is never
  taken for a flag; the words count in any case.

  Pure and deterministic: no clock, randomness, locale or network. Every
  finding carries the rule id and version for audit (labCriticalFlagRule.ts).
  The notice itself is minted by the safety channel
  (insightCopy.labCriticalFlagWarnings), and the page shows it only while
  features.lab_critical_flag_notice is on: the owner turns that on after
  clinical GO on the notice's words and this table [Pending]
  (docs/runtime-config.md).
*/
import { KNOWN_UNITS } from '../../utils/parser/labelMatching';
import type { ReportAnalyte } from '../../types';
import { LAB_CRITICAL_FLAG_RULE, type LabCriticalFinding } from './labCriticalFlagRule';

export { LAB_CRITICAL_FLAG_RULE, type LabCriticalFinding } from './labCriticalFlagRule';

/** features.<name> that shows the notice on the report page. Off unless the owner sets it. */
export const LAB_CRITICAL_FLAG_NOTICE_FLAG = 'lab_critical_flag_notice';

/** Each marker as the lab prints it, matched as a whole token, with the optional parentheses and trailing asterisk printedLabFlag allows. */
export const LAB_CRITICAL_MARKERS: readonly { readonly marker: string; readonly match: RegExp }[] = Object.freeze([
  { marker: 'HH', match: /^HH$/ },
  { marker: 'LL', match: /^LL$/ },
  { marker: 'CRIT', match: /^crit$/i },
  { marker: 'CRITICAL', match: /^critical$/i },
  { marker: 'PANIC', match: /^panic$/i },
  { marker: 'ALERT', match: /^alert$/i },
].map(m => Object.freeze(m)));

const UNITS = new Set(KNOWN_UNITS.map(u => u.toLowerCase()));

/** The critical marker one printed token carries, or null. */
export function criticalMarker(token: string | null | undefined): string | null {
  if (!token) return null;
  const bare = token.replace(/^\(/, '').replace(/\*$/, '').replace(/\)$/, '');
  return LAB_CRITICAL_MARKERS.find(m => m.match.test(bare))?.marker ?? null;
}

/**
 * The critical marker the lab printed beside this value on its saved line, as
 * { marker, printed }, or null. `units` are the result's own unit spellings;
 * any unit the parser knows also counts as the unit printed after the value.
 */
export function printedCriticalMarker(
  sourceSnippet: string | null | undefined,
  valueText: string | null | undefined,
  units: readonly (string | null | undefined)[] = [],
): { marker: string; printed: string } | null {
  const value = valueText?.trim();
  if (!sourceSnippet || !value) return null;
  const tokens = sourceSnippet.trim().split(/\s+/);
  const isUnit = (t: string | undefined) => t !== undefined
    && (UNITS.has(t.toLowerCase()) || units.some(u => !!u && u.toLowerCase() === t.toLowerCase()));
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;
    let printed: string | undefined;
    if (token === value) {
      printed = isUnit(tokens[i + 1]) ? tokens[i + 2] : tokens[i + 1];
    } else if (token.startsWith(value)) {
      // Glued to the value ("6.8HH"), or the value glued to its unit ("6.8mmol/L HH").
      const rest = token.slice(value.length);
      printed = isUnit(rest) ? tokens[i + 1] : rest;
    }
    const marker = criticalMarker(printed);
    if (marker && printed) return { marker, printed };
  }
  return null;
}

export type CriticalFlagAnalyte = Pick<ReportAnalyte,
  'id' | 'raw_name' | 'display_name' | 'raw_value_text' | 'value_numeric' | 'unit' | 'unit_original' | 'source_snippet'>;

/** One finding per saved result her lab printed a critical marker beside, in the rows' order. */
export function findLabCriticalFlags(analytes: readonly CriticalFlagAnalyte[]): LabCriticalFinding[] {
  const findings: LabCriticalFinding[] = [];
  for (const a of analytes) {
    // The value text exactly as the result row shows it.
    const valueText = a.raw_value_text ?? (a.value_numeric != null ? String(a.value_numeric) : null);
    const hit = printedCriticalMarker(a.source_snippet, valueText, [a.unit, a.unit_original]);
    if (hit) findings.push(Object.freeze({ ...LAB_CRITICAL_FLAG_RULE, analyteId: a.id, name: a.display_name || a.raw_name, ...hit }));
  }
  return findings;
}
