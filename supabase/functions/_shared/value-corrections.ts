/**
 * Corrected values, server side (PK-CORRECT-01; D20, engineering re-review
 * R18, R19, R24). The client mirror is src/lib/corrections/.
 *
 * R18: every value reader picks its table through `valueTables`, which names
 * the corrected views (biomarkers_corrected, report_analytes_corrected) only
 * while features.value_corrections is on. So a redeploy of lab-insights or
 * generate-interpretation for another fix keeps reading the raw tables until
 * the owner pushes 20261015100000 and turns the flag on (D6.2).
 *
 * The two function payload builders live here, behind a structural client
 * port, so Vitest drives them with a fake client (R24) and the Deno handlers
 * stay thin. They select exactly the columns the handlers selected before, so
 * with the flag off their output is unchanged, and with it on a corrected
 * value differs only in its value and unit.
 *
 * Pure: no Deno, no Supabase import.
 */

export const VALUE_CORRECTIONS_FLAG = "value_corrections";

export interface ValueTables {
  readonly biomarkers: "biomarkers" | "biomarkers_corrected";
  readonly reportAnalytes: "report_analytes" | "report_analytes_corrected";
}

const RAW_TABLES: ValueTables = Object.freeze({ biomarkers: "biomarkers", reportAnalytes: "report_analytes" });
const CORRECTED_VIEWS: ValueTables = Object.freeze({
  biomarkers: "biomarkers_corrected",
  reportAnalytes: "report_analytes_corrected",
});

/** The tables a value reader reads: the corrected views only while the flag is on. */
export function valueTables(correctionsOn: boolean): ValueTables {
  return correctionsOn ? CORRECTED_VIEWS : RAW_TABLES;
}

/**
 * True only when app_public_config's `features` bundle holds `name: true`.
 * A missing row, key or bundle, or any non-boolean value, reads as off (D5).
 */
export function featureEnabledIn(rows: unknown, name: string): boolean {
  if (!Array.isArray(rows)) return false;
  for (const row of rows as unknown[]) {
    if (typeof row !== "object" || row === null) continue;
    const { key, value } = row as { key?: unknown; value?: unknown };
    if (key !== "features" || typeof value !== "object" || value === null || Array.isArray(value)) continue;
    return (value as Record<string, unknown>)[name] === true;
  }
  return false;
}

/**
 * Reads features.value_corrections. Fails CLOSED: any error, a timeout or a
 * malformed reply reads as off, so the readers keep the raw tables, which
 * exist on every deploy. `read` is one app_public_config select.
 */
export async function readValueCorrectionsFlag(
  read: () => PromiseLike<{ data: unknown; error: unknown }>,
): Promise<boolean> {
  try {
    const { data, error } = await read();
    if (error) return false;
    return featureEnabledIn(data, VALUE_CORRECTIONS_FLAG);
  } catch {
    return false;
  }
}

// ── R19: an explanation written before a correction ────────────────────────

/** The newest `corrected_at` among rows the corrected views returned, or null. */
export function newestCorrectionAt(rows: readonly unknown[] | null | undefined): string | null {
  let newest: string | null = null;
  let newestMs = -Infinity;
  for (const row of rows ?? []) {
    if (typeof row !== "object" || row === null) continue;
    const { is_corrected, corrected_at } = row as { is_corrected?: unknown; corrected_at?: unknown };
    if (is_corrected !== true || typeof corrected_at !== "string") continue;
    const ms = Date.parse(corrected_at);
    if (Number.isFinite(ms) && ms > newestMs) {
      newestMs = ms;
      newest = corrected_at;
    }
  }
  return newest;
}

/**
 * R19's rule: the explanation on screen is stale when the newest correction
 * is later than the time that explanation was written. No correction: never
 * stale. A correction but no known writing time: stale, because nothing shows
 * the explanation came after it.
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

export const STALE_EXPLANATION_TEXT = "This explanation was written before you corrected a value";
export const REFRESH_EXPLANATION_LABEL = "Refresh explanation";

// ── The payload builders (R24) ──────────────────────────────────────────────

/** A query result, as supabase-js resolves it. */
export interface QueryResult<T> {
  data: T | null;
  error: unknown;
}

/** The part of a PostgREST filter builder the payload builders use. */
export interface ValueQuery<T> extends PromiseLike<QueryResult<T[]>> {
  eq(column: string, value: unknown): ValueQuery<T>;
  neq(column: string, value: unknown): ValueQuery<T>;
  lt(column: string, value: unknown): ValueQuery<T>;
  order(column: string, options?: { ascending?: boolean }): ValueQuery<T>;
  limit(count: number): ValueQuery<T>;
  maybeSingle(): PromiseLike<QueryResult<T>>;
}

/** The part of a Supabase client the payload builders use. */
export interface ValueReadClient {
  from(table: string): { select(columns: string): unknown };
}

function select<T>(client: ValueReadClient, table: string, columns: string): ValueQuery<T> {
  return client.from(table).select(columns) as ValueQuery<T>;
}

/** lab-insights: the columns it compares (name, value, unit). */
export interface ComparisonBiomarker {
  name: string;
  value: number;
  unit: string;
}

/**
 * lab-insights' value reads (index.ts, formerly lines 145 and 150): the
 * current and previous report's biomarkers, through the user's own client so
 * RLS applies.
 */
export async function loadComparisonBiomarkers(
  client: ValueReadClient,
  tables: ValueTables,
  currentReportId: string,
  previousReportId: string,
): Promise<{ current: ComparisonBiomarker[] | null; previous: ComparisonBiomarker[] | null }> {
  const { data: current } = await select<ComparisonBiomarker>(client, tables.biomarkers, "name, value, unit")
    .eq("lab_report_id", currentReportId);
  const { data: previous } = await select<ComparisonBiomarker>(client, tables.biomarkers, "name, value, unit")
    .eq("lab_report_id", previousReportId);
  return { current, previous };
}

/** generate-interpretation: the analyte columns the prompt is built from. */
export const INTERPRETATION_ANALYTE_COLUMNS =
  "id, raw_name, canonical_slug, value_numeric, raw_value_text, unit, raw_reference_range, normalized_min, normalized_max, normalized_operator, normalized_operator_value, is_core";

export interface InterpretationAnalyteRow {
  id: string;
  raw_name: string;
  canonical_slug: string | null;
  value_numeric: number | null;
  raw_value_text: string | null;
  unit: string | null;
  raw_reference_range: string | null;
  normalized_min: number | null;
  normalized_max: number | null;
  normalized_operator: string | null;
  normalized_operator_value: number | null;
  is_core: boolean;
}

/**
 * generate-interpretation's value reads (index.ts, formerly lines 1353 and
 * 1378): this report's analytes and those of the most recent earlier report of
 * the same user, with the queries, filters and order it always used.
 */
export async function loadInterpretationAnalytes(
  client: ValueReadClient,
  tables: ValueTables,
  input: { reportId: string; userId: string | null; report: { report_date: string } | null },
): Promise<{
  analytes: InterpretationAnalyteRow[];
  priorAnalytes: InterpretationAnalyteRow[];
  priorReportDate: string | null;
}> {
  const { data: rawAnalytes } = await select<InterpretationAnalyteRow>(
    client, tables.reportAnalytes, INTERPRETATION_ANALYTE_COLUMNS,
  )
    .eq("lab_report_id", input.reportId)
    .order("raw_name");
  const analytes = rawAnalytes ?? [];

  let priorAnalytes: InterpretationAnalyteRow[] = [];
  let priorReportDate: string | null = null;
  if (input.report && input.userId) {
    const { data: priorReport } = await select<{ id: string; report_date: string }>(
      client, "lab_reports", "id, report_date",
    )
      .eq("user_id", input.userId)
      .neq("id", input.reportId)
      .lt("report_date", input.report.report_date)
      .order("report_date", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (priorReport?.id) {
      priorReportDate = priorReport.report_date;
      const { data: priorRows } = await select<InterpretationAnalyteRow>(
        client, tables.reportAnalytes, INTERPRETATION_ANALYTE_COLUMNS,
      )
        .eq("lab_report_id", priorReport.id);
      priorAnalytes = priorRows ?? [];
    }
  }
  return { analytes, priorAnalytes, priorReportDate };
}
