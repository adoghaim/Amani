/**
 * Test helper, imported only by tests (PK-CORRECT-01, R24): one shared fixture
 * of a user's value rows and an in-memory client that answers PostgREST-style
 * queries over it, including the two corrected views with the semantics of
 * 20261015100000 (the latest correction per value wins; provenance columns
 * appended). The SQL itself is proven by the migration harness
 * (cases/190-analyte-corrections.sh); this fake lets every reader run against
 * the same rows in three states.
 *
 * Every value is invented. No patient, report or production row.
 */

export type Row = Record<string, unknown>;

export const USER_ID = '00000000-0000-4000-8000-0000000000c1';
export const REPORT_EARLIER = '00000000-0000-4000-a000-0000000000e1';
export const REPORT_LATER = '00000000-0000-4000-a000-0000000000e2';

const biomarker = (id: string, report: string, name: string, value: number, unit: string,
  min: number | null, max: number | null, flagged: string, raw: string | null): Row => ({
  id, lab_report_id: report, name, value, unit, reference_min: min, reference_max: max, flagged, raw_value_text: raw,
});

const analyte = (id: string, report: string, rawName: string, slug: string | null, value: number | null,
  raw: string | null, unit: string | null, range: string | null, min: number | null, max: number | null,
  isCore: boolean): Row => ({
  id, lab_report_id: report, raw_name: rawName, raw_value_text: raw, value_numeric: value, unit,
  raw_reference_range: range, normalized_min: min, normalized_max: max, normalized_operator: null,
  normalized_operator_value: null, source_snippet: null, confidence_score: 'high', canonical_analyte_id: null,
  canonical_slug: slug, parse_status: slug ? 'mapped' : 'unmapped', needs_review: false, is_core: isCore,
  created_at: '2026-09-01T00:00:00.000Z', display_name: null, system_category: null, normalization_status: 'mapped',
  source_format: 'text', parser_version: 'v1', unit_original: unit, unit_normalized: unit, review_status: 'pending',
  reviewed_by_user: false,
});

/** The rows as stored. Two reports; the later one's ferritin is the one Amani misread. */
export function baseTables(): Record<string, Row[]> {
  return {
    lab_reports: [
      { id: REPORT_EARLIER, user_id: USER_ID, report_date: '2026-06-01' },
      { id: REPORT_LATER, user_id: USER_ID, report_date: '2026-09-01' },
    ],
    biomarkers: [
      biomarker('00000000-0000-4000-9000-0000000000b1', REPORT_EARLIER, 'ferritin', 40, 'ng/mL', 15, 150, 'in_range', '40'),
      biomarker('00000000-0000-4000-9000-0000000000b2', REPORT_EARLIER, 'tsh', 2.1, 'uIU/mL', 0.45, 4.5, 'in_range', '2.1'),
      biomarker('00000000-0000-4000-9000-0000000000b3', REPORT_LATER, 'ferritin', 450, 'ng/mL', 15, 150, 'out_of_range', '450'),
      biomarker('00000000-0000-4000-9000-0000000000b4', REPORT_LATER, 'tsh', 2.4, 'uIU/mL', 0.45, 4.5, 'in_range', '2.4'),
    ],
    report_analytes: [
      analyte('00000000-0000-4000-9000-0000000000a1', REPORT_EARLIER, 'Ferritin', 'ferritin', 40, '40', 'ng/mL', '15-150', 15, 150, true),
      analyte('00000000-0000-4000-9000-0000000000a2', REPORT_EARLIER, 'TSH', 'tsh', 2.1, '2.1', 'uIU/mL', '0.45-4.5', 0.45, 4.5, true),
      analyte('00000000-0000-4000-9000-0000000000a3', REPORT_LATER, 'Ferritin', 'ferritin', 450, '450', 'ng/mL', '15-150', 15, 150, true),
      analyte('00000000-0000-4000-9000-0000000000a4', REPORT_LATER, 'TSH', 'tsh', 2.4, '2.4', 'uIU/mL', '0.45-4.5', 0.45, 4.5, true),
      analyte('00000000-0000-4000-9000-0000000000a5', REPORT_LATER, 'Basophils', null, 1, '1', '%', '0-2', 0, 2, false),
    ],
    analyte_corrections: [],
  };
}

/** The one correction: the later ferritin read as 450 is 45.0 on her report; an earlier, superseded one too. */
export function oneCorrection(): Row[] {
  const base = {
    user_id: USER_ID, lab_report_id: REPORT_LATER, report_analyte_id: '00000000-0000-4000-9000-0000000000a3',
    biomarker_id: '00000000-0000-4000-9000-0000000000b3', canonical_slug: 'ferritin',
    original_value: 450, original_raw_text: '450', original_unit: 'ng/mL',
  };
  return [
    { ...base, id: 'c-1', corrected_value: 4.5, corrected_raw_text: '4.5', corrected_unit: 'ng/mL',
      corrected_flag: 'out_of_range', created_at: '2026-10-01T10:00:00.000Z' },
    { ...base, id: 'c-2', corrected_value: 45, corrected_raw_text: '45.0', corrected_unit: 'ng/mL',
      corrected_flag: 'in_range', created_at: '2026-10-01T10:05:00.000Z' },
  ];
}

function latestCorrection(corrections: Row[], match: (c: Row) => boolean): Row | null {
  return corrections.filter(match)
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)) || String(b.id).localeCompare(String(a.id)))[0] ?? null;
}

/** The corrected views, as 20261015100000 defines them. */
function viewRows(tables: Record<string, Row[]>, view: string): Row[] {
  const corrections = tables.analyte_corrections ?? [];
  if (view === 'biomarkers_corrected') {
    return (tables.biomarkers ?? []).map(b => {
      const c = latestCorrection(corrections, x => x.lab_report_id === b.lab_report_id
        && x.canonical_slug === b.name && x.biomarker_id === b.id);
      return {
        ...b,
        value: c ? c.corrected_value : b.value,
        unit: c ? (c.corrected_unit ?? b.unit) : b.unit,
        flagged: c ? c.corrected_flag : b.flagged,
        raw_value_text: c ? c.corrected_raw_text : b.raw_value_text,
        original_value: b.value, original_raw_text: b.raw_value_text, original_unit: b.unit,
        is_corrected: !!c, corrected_at: c ? c.created_at : null,
      };
    });
  }
  return (tables.report_analytes ?? []).map(ra => {
    const c = latestCorrection(corrections, x => x.report_analyte_id === ra.id);
    return {
      ...ra,
      raw_value_text: c ? c.corrected_raw_text : ra.raw_value_text,
      value_numeric: c ? c.corrected_value : ra.value_numeric,
      unit: c ? (c.corrected_unit ?? ra.unit) : ra.unit,
      flagged: c ? c.corrected_flag : null,
      original_value: ra.value_numeric, original_raw_text: ra.raw_value_text, original_unit: ra.unit,
      is_corrected: !!c, corrected_at: c ? c.created_at : null,
    };
  });
}

type Filter = (row: Row) => boolean;

/** A PostgREST-style query over the fixture: select, eq, neq, lt, in, order, limit, maybeSingle. */
export function fakeValueClient(tables: Record<string, Row[]>, log: string[] = []) {
  return {
    from(table: string) {
      const filters: Filter[] = [];
      const orders: { column: string; ascending: boolean }[] = [];
      let columns: string[] | null = null;
      let limit: number | null = null;
      const source = () => table.endsWith('_corrected') ? viewRows(tables, table) : (tables[table] ?? []);
      const run = (): Row[] => {
        let rows = source().filter(row => filters.every(f => f(row)));
        for (const { column, ascending } of [...orders].reverse()) {
          rows = [...rows].sort((a, b) => (ascending ? 1 : -1) * String(a[column]).localeCompare(String(b[column])));
        }
        if (limit !== null) rows = rows.slice(0, limit);
        return columns === null ? rows.map(r => ({ ...r }))
          : rows.map(r => Object.fromEntries(columns!.map(c => [c, r[c]])));
      };
      const query = {
        select(list: string) {
          log.push(`${table}:${list.replace(/\s/g, '')}`);
          columns = list.trim() === '*' ? null : list.split(',').map(c => c.trim());
          return query;
        },
        eq(column: string, value: unknown) { filters.push(r => r[column] === value); return query; },
        neq(column: string, value: unknown) { filters.push(r => r[column] !== value); return query; },
        lt(column: string, value: unknown) { filters.push(r => String(r[column]) < String(value)); return query; },
        in(column: string, values: unknown[]) { filters.push(r => values.includes(r[column])); return query; },
        order(column: string, options?: { ascending?: boolean }) {
          orders.push({ column, ascending: options?.ascending ?? true });
          return query;
        },
        limit(count: number) { limit = count; return query; },
        async maybeSingle() { return { data: run()[0] ?? null, error: null }; },
        then<T>(resolve: (value: { data: Row[]; error: null }) => T, reject?: (reason: unknown) => T) {
          return Promise.resolve({ data: run(), error: null }).then(resolve, reject);
        },
      };
      return query;
    },
  };
}
