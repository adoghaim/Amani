/**
 * Which tables the app reads values from (PK-CORRECT-01; engineering re-review
 * R18). The client mirror of supabase/functions/_shared/value-corrections.ts.
 *
 * Every value reader picks its table here. While features.value_corrections is
 * off (a missing key is off, D5) it names the raw tables, exactly as before;
 * only when the owner has pushed 20261015100000 and switched the flag on does
 * it name the corrected views, which return the latest correction's value,
 * unit and flag plus the original reading (D6.2).
 *
 * valueReads.guard.test.ts fails on a raw-table value read anywhere outside
 * the upload writer (NewReport) and the dev-only parser debugger.
 */
import { isFeatureEnabled } from '../runtimeConfig';

export const VALUE_CORRECTIONS_FLAG = 'value_corrections';

export interface ValueTables {
  readonly biomarkers: 'biomarkers' | 'biomarkers_corrected';
  readonly reportAnalytes: 'report_analytes' | 'report_analytes_corrected';
}

const RAW_TABLES: ValueTables = Object.freeze({ biomarkers: 'biomarkers', reportAnalytes: 'report_analytes' });
const CORRECTED_VIEWS: ValueTables = Object.freeze({
  biomarkers: 'biomarkers_corrected',
  reportAnalytes: 'report_analytes_corrected',
});

/** True only while features.value_corrections is on. */
export function valueCorrectionsOn(): boolean {
  return isFeatureEnabled(VALUE_CORRECTIONS_FLAG);
}

/** The tables a value reader reads: the corrected views only while the flag is on. */
export function valueTables(correctionsOn: boolean = valueCorrectionsOn()): ValueTables {
  return correctionsOn ? CORRECTED_VIEWS : RAW_TABLES;
}

/** True when `tables` names the corrected views (their rows carry the provenance columns). */
export function readsCorrectedViews(tables: ValueTables): boolean {
  return tables === CORRECTED_VIEWS || tables.biomarkers === CORRECTED_VIEWS.biomarkers;
}
