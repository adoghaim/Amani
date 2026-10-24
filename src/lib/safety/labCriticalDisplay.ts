/*
  RV-CR1: where the report page shows each marker her lab printed to mark a
  result critical (labCriticalFlags.ts). The safety notice, the result rows
  and the result cards take their markers from one findLabCriticalFlags
  result, so they always name the same results: this module reads no line and
  knows no marker. Each badge carries the token exactly as the lab printed it
  (the finding's `printed`), never the normalized marker.

  Result rows are report_analytes rows, by id. Result cards are biomarkers
  rows, matched to their analyte by report, slug and value, as confirmation.ts
  matches them (keyOf). Pure: no React, no Supabase.
*/
import { keyOf } from '../biomarkers/confirmation';
import type { ReportAnalyte } from '../../types';
import type { LabCriticalFinding } from './labCriticalFlagRule';

export type CriticalDisplayAnalyte = Pick<ReportAnalyte, 'id' | 'lab_report_id' | 'canonical_slug' | 'value_numeric'>;

export interface LabCriticalDisplay {
  /** The token each result row shows, by report_analytes id. */
  readonly rows: ReadonlyMap<string, string>;
  /** The token each result card shows, by reading key (keyOf: report, slug, value). */
  readonly cards: ReadonlyMap<string, string>;
}

/**
 * Each finding's printed token, for its row and, when the row has a slug and
 * a value, for its card. When rows share a reading key, the first in row order
 * that has a finding gives the card its token. No finding, no token.
 */
export function labCriticalDisplay(
  analytes: readonly CriticalDisplayAnalyte[],
  findings: readonly LabCriticalFinding[],
): LabCriticalDisplay {
  const printed = new Map<string, string>();
  for (const f of findings) if (!printed.has(f.analyteId)) printed.set(f.analyteId, f.printed);
  const rows = new Map<string, string>();
  const cards = new Map<string, string>();
  for (const a of analytes) {
    const token = printed.get(a.id);
    if (token === undefined) continue;
    rows.set(a.id, token);
    if (!a.canonical_slug || a.value_numeric == null) continue;
    const key = keyOf(a.lab_report_id, a.canonical_slug, a.value_numeric);
    if (!cards.has(key)) cards.set(key, token);
  }
  return { rows, cards };
}
