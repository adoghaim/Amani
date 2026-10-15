/**
 * Test-only stand-in for a Supabase/PostgREST table read (imported by tests,
 * never by the app). It reproduces the behaviour R27 is about: every request
 * returns at most `maxRows` rows (1,000 by default) and reports no error when
 * it truncates.
 *
 * Supports the chain the pages use: select, eq, in, lt, order, limit, range,
 * maybeSingle, and awaiting the builder directly.
 */
export type Row = Record<string, unknown>;
type Result = { data: Row[] | null; error: unknown };

export interface FakeRequest {
  table: string;
  range: [number, number] | null;
  returned: number;
}

export interface FakeDb {
  from(table: string): FakeQuery;
  requests: FakeRequest[];
}

export interface FakeQuery extends PromiseLike<Result> {
  select(columns?: string): FakeQuery;
  eq(column: string, value: unknown): FakeQuery;
  in(column: string, values: unknown[]): FakeQuery;
  lt(column: string, value: unknown): FakeQuery;
  order(column: string, opts?: { ascending?: boolean }): FakeQuery;
  limit(n: number): FakeQuery;
  range(from: number, to: number): FakeQuery;
  maybeSingle(): Promise<{ data: Row | null; error: unknown }>;
}

export function createFakeDb(
  tables: Record<string, Row[]>,
  opts: { maxRows?: number; failOn?: (req: FakeRequest, index: number) => unknown } = {},
): FakeDb {
  const maxRows = opts.maxRows ?? 1000;
  const requests: FakeRequest[] = [];

  const from = (table: string): FakeQuery => {
    let rows = [...(tables[table] ?? [])];
    let range: [number, number] | null = null;
    let limit: number | null = null;

    const run = (): Result => {
      let out = rows;
      if (range) out = out.slice(range[0], range[1] + 1);
      if (limit !== null) out = out.slice(0, limit);
      out = out.slice(0, maxRows); // the silent server-side cap
      const req: FakeRequest = { table, range, returned: out.length };
      const index = requests.push(req) - 1;
      const error = opts.failOn?.(req, index);
      if (error) return { data: null, error };
      return { data: out, error: null };
    };

    const query: FakeQuery = {
      select: () => query,
      eq: (c, v) => { rows = rows.filter((r) => r[c] === v); return query; },
      in: (c, vs) => { rows = rows.filter((r) => vs.includes(r[c])); return query; },
      lt: (c, v) => { rows = rows.filter((r) => String(r[c]) < String(v)); return query; },
      order: (c, o) => {
        const dir = o?.ascending === false ? -1 : 1;
        rows = [...rows].sort((a, b) => dir * String(a[c]).localeCompare(String(b[c])));
        return query;
      },
      limit: (n) => { limit = n; return query; },
      range: (a, b) => { range = [a, b]; return query; },
      maybeSingle: async () => {
        const { data, error } = run();
        return { data: data?.[0] ?? null, error };
      },
      then: (onFulfilled, onRejected) => Promise.resolve(run()).then(onFulfilled, onRejected),
    };
    return query;
  };

  return { from, requests };
}

/** `count` biomarker rows for one report, with ids that sort after `idPrefix`'s predecessors. */
export function seedBiomarkers(reportId: string, count: number, idPrefix: string, name = (i: number) => `Marker ${i}`): Row[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `${idPrefix}-${String(i).padStart(5, '0')}`,
    lab_report_id: reportId,
    name: name(i),
    value: i,
    unit: 'u',
    reference_min: null,
    reference_max: null,
    status: 'normal',
  }));
}
