/**
 * PostgREST (and so Supabase) returns at most `max-rows` rows per request —
 * 1,000 by default — and says nothing when it truncates. A read that can grow
 * past that (every biomarker across every report a user has) must page.
 *
 * `fetchAllRows` asks for one `.range()` page at a time and stops at the first
 * short page. `buildQuery` is called once per page so each request gets a
 * fresh builder; it must apply a deterministic total order (for example
 * `.order('id')`) or rows can repeat or vanish between pages.
 *
 * Any page error returns `{ data: null, error }` — never a silently partial
 * list, which is exactly the failure this helper exists to prevent.
 */
export const POSTGREST_MAX_ROWS = 1000;

export interface RangeQuery<T> {
  range(from: number, to: number): PromiseLike<{ data: T[] | null; error: unknown }>;
}

export type FetchAllRowsResult<T> =
  | { data: T[]; error: null }
  | { data: null; error: unknown };

export async function fetchAllRows<T>(
  buildQuery: () => RangeQuery<T>,
  pageSize: number = POSTGREST_MAX_ROWS,
): Promise<FetchAllRowsResult<T>> {
  if (!Number.isInteger(pageSize) || pageSize < 1) {
    throw new RangeError(`fetchAllRows: pageSize must be a positive integer, got ${pageSize}`);
  }
  const rows: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await buildQuery().range(from, from + pageSize - 1);
    if (error) return { data: null, error };
    const page = data ?? [];
    rows.push(...page);
    if (page.length < pageSize) return { data: rows, error: null };
  }
}
