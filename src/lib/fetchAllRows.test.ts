import { describe, expect, it } from 'vitest';
import { fetchAllRows, POSTGREST_MAX_ROWS } from './fetchAllRows';
import { createFakeDb, seedBiomarkers } from './fetchAllRows.fake';

// Seeded out of id order so the explicit `.order('id')` is doing real work.
function account(total: number) {
  const perReport = Math.ceil(total / 3);
  const rows = [
    ...seedBiomarkers('r3', Math.max(0, total - 2 * perReport), 'c'),
    ...seedBiomarkers('r1', Math.min(perReport, total), 'a'),
    ...seedBiomarkers('r2', Math.max(0, Math.min(perReport, total - perReport)), 'b'),
  ];
  return { db: createFakeDb({ biomarkers: rows }), rows };
}
const allValues = (db: ReturnType<typeof createFakeDb>) => () =>
  db.from('biomarkers').select('*').in('lab_report_id', ['r1', 'r2', 'r3']).order('id');
const ids = (rows: Array<Record<string, unknown>> | null) => (rows ?? []).map((r) => r.id);
const sortedIds = (rows: Array<Record<string, unknown>>) => ids(rows).sort();

describe('fetchAllRows (R27)', () => {
  it('the fake reproduces the bug: one request silently stops at 1,000 rows', async () => {
    const { db } = account(1001);
    const { data, error } = await allValues(db)();
    expect(error).toBeNull();
    expect((data as unknown[]).length).toBe(POSTGREST_MAX_ROWS);
  });

  it('returns every row of a 1,001-row account, each exactly once, in id order', async () => {
    const { db, rows } = account(1001);
    const { data, error } = await fetchAllRows(allValues(db));
    expect(error).toBeNull();
    expect(data).toHaveLength(1001);
    expect(ids(data)).toEqual(sortedIds(rows));
    expect(db.requests.map((r) => r.range)).toEqual([[0, 999], [1000, 1999]]);
  });

  it('returns every row of a 2,501-row account across three pages', async () => {
    const { db, rows } = account(2501);
    const { data } = await fetchAllRows(allValues(db));
    expect(data).toHaveLength(2501);
    expect(new Set(ids(data)).size).toBe(2501);
    expect(ids(data)).toEqual(sortedIds(rows));
    expect(db.requests).toHaveLength(3);
  });

  it('a 999-row account gets the same rows in the same order as a single request, in one request', async () => {
    const { db } = account(999);
    const single = await allValues(db)();
    const paged = await fetchAllRows(allValues(db));
    expect(paged.error).toBeNull();
    expect(paged.data).toEqual(single.data);
    expect(paged.data).toHaveLength(999);
    // one request for the single read, one for the paged read
    expect(db.requests).toHaveLength(2);
    expect(db.requests[1]?.range).toEqual([0, 999]);
  });

  it('an exact 1,000-row account confirms with one empty page and returns all 1,000', async () => {
    const { db, rows } = account(1000);
    const { data } = await fetchAllRows(allValues(db));
    expect(ids(data)).toEqual(sortedIds(rows));
    expect(db.requests.map((r) => r.returned)).toEqual([1000, 0]);
  });

  it('an empty account returns an empty list after one request', async () => {
    const db = createFakeDb({ biomarkers: [] });
    const { data, error } = await fetchAllRows(allValues(db));
    expect(error).toBeNull();
    expect(data).toEqual([]);
    expect(db.requests).toHaveLength(1);
  });

  it('a failed later page returns the error and no partial list', async () => {
    const failure = { message: 'boom' };
    const rows = seedBiomarkers('r1', 1500, 'a');
    const db = createFakeDb({ biomarkers: rows }, { failOn: (_req, index) => (index === 1 ? failure : null) });
    const result = await fetchAllRows(allValues(db));
    expect(result).toEqual({ data: null, error: failure });
  });

  it('builds a fresh query for every page', async () => {
    const { db } = account(2100);
    let built = 0;
    await fetchAllRows(() => { built += 1; return allValues(db)(); });
    expect(built).toBe(3);
  });

  it('honours a smaller page size', async () => {
    const { db, rows } = account(25);
    const { data } = await fetchAllRows(allValues(db), 10);
    expect(ids(data)).toEqual(sortedIds(rows));
    expect(db.requests.map((r) => r.range)).toEqual([[0, 9], [10, 19], [20, 29]]);
  });

  it('rejects a page size that could loop forever', async () => {
    const { db } = account(5);
    await expect(fetchAllRows(allValues(db), 0)).rejects.toThrow(RangeError);
    await expect(fetchAllRows(allValues(db), 1.5)).rejects.toThrow(RangeError);
  });
});
