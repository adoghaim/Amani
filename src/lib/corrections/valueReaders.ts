/**
 * Every client value read (PK-CORRECT-01; engineering re-review R18, R24).
 *
 * Each function is one of the value reads a page used to make inline, with the
 * same select, filters and order, moved here so the pages and the R24
 * regression table run the same code:
 *
 *   readDashboardBiomarkers   Dashboard.tsx (formerly :104)
 *   readReportValues          ReportView.tsx (formerly :654, :655)
 *   readPreviousBiomarkers    ReportView.tsx (formerly :702)
 *   readHistoricalBiomarkers  ReportView.tsx (formerly :720)
 *   readTrackerBiomarkers     Tracker.tsx (formerly :163)
 *
 * The table comes from valueTables(): the raw tables while
 * features.value_corrections is off, the corrected views while it is on. The
 * rows go through withCorrectionMarks, so they are today's rows unless a value
 * is corrected. An explicit column list gains the provenance columns only
 * while the views are read.
 *
 * Row cap (F2, R27): the all-reports reads are not paged here. PK-FIX-07 adds
 * the paging and composes with these functions; R24's fixture stays under
 * 1,000 rows.
 */
import { supabase } from '../supabase';
import { PROVENANCE_COLUMNS, withCorrectionMarks, type ValueCorrectionMark } from './provenance';
import { readsCorrectedViews, valueTables, type ValueTables } from './valueTables';

type Client = Pick<typeof supabase, 'from'>;
type Reply<T> = { data: (T & { correction?: ValueCorrectionMark })[] | null; error: unknown };

/** An explicit column list, plus the provenance columns while the views are read. */
function columns(list: readonly string[], tables: ValueTables): string {
  return (readsCorrectedViews(tables) ? [...list, ...PROVENANCE_COLUMNS] : list).join(', ');
}

/** Dashboard: every biomarker of her reports. */
export async function readDashboardBiomarkers<T extends object>(
  ids: string[], tables: ValueTables = valueTables(), client: Client = supabase,
): Promise<Reply<T>> {
  const { data, error } = await client.from(tables.biomarkers).select('*').in('lab_report_id', ids);
  return { data: withCorrectionMarks((data ?? null) as T[] | null, 'biomarkers'), error };
}

/** ReportView: this report's biomarkers and its full lab panel (by raw_name). */
export async function readReportValues<B extends object, A extends object>(
  reportId: string, tables: ValueTables = valueTables(), client: Client = supabase,
): Promise<{ biomarkers: Reply<B>; analytes: Reply<A> }> {
  const [biomarkers, analytes] = await Promise.all([
    client.from(tables.biomarkers).select('*').eq('lab_report_id', reportId),
    client.from(tables.reportAnalytes).select('*').eq('lab_report_id', reportId).order('raw_name'),
  ]);
  return {
    biomarkers: { data: withCorrectionMarks((biomarkers.data ?? null) as B[] | null, 'biomarkers'), error: biomarkers.error },
    analytes: { data: withCorrectionMarks((analytes.data ?? null) as A[] | null, 'report_analytes'), error: analytes.error },
  };
}

/** ReportView: the immediately previous report's biomarkers. */
export async function readPreviousBiomarkers<T extends object>(
  reportId: string, tables: ValueTables = valueTables(), client: Client = supabase,
): Promise<Reply<T>> {
  const { data, error } = await client.from(tables.biomarkers).select('*').eq('lab_report_id', reportId);
  return { data: withCorrectionMarks((data ?? null) as T[] | null, 'biomarkers'), error };
}

export const HISTORICAL_BIOMARKER_COLUMNS = ['name', 'value', 'unit', 'reference_min', 'reference_max', 'lab_report_id'] as const;

/** ReportView: the biomarkers of every earlier report, for trends and the comparison. */
export async function readHistoricalBiomarkers<T extends object>(
  ids: string[], tables: ValueTables = valueTables(), client: Client = supabase,
): Promise<Reply<T>> {
  const { data, error } = await client.from(tables.biomarkers)
    .select(columns(HISTORICAL_BIOMARKER_COLUMNS, tables))
    .in('lab_report_id', ids);
  return { data: withCorrectionMarks((data ?? null) as T[] | null, 'biomarkers'), error };
}

/** Tracker: every biomarker of her reports, for compare and the labs timeline. */
export async function readTrackerBiomarkers<T extends object>(
  ids: string[], tables: ValueTables = valueTables(), client: Client = supabase,
): Promise<Reply<T>> {
  const { data, error } = await client.from(tables.biomarkers).select('*').in('lab_report_id', ids);
  return { data: withCorrectionMarks((data ?? null) as T[] | null, 'biomarkers'), error };
}
