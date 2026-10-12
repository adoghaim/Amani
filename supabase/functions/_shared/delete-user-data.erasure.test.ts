import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';

/**
 * Executes delete-user-data's real `deleteDataTables` from source (the
 * entitlement-response.test.ts technique) against a recording fake. Every
 * query records when it starts executing and when it settles, and the RPC
 * settles only on a later macrotask, so any overlap would be visible.
 *
 * PK-03e-K (owner decision): on V2 the handler erases through ONE call to
 * public.delete_user_data (PK-03e-E / PR #92, redefined for V2's guarded
 * interpretation graph by 20261012000100), not through erase_reports plus a
 * per-table sweep. The SQL side (lock order, cascade through the V2 graph,
 * overlapping deletions, post-condition) is proven by harness Case 13 in
 * supabase/migrations/__verification__/run.sh; the retry policy by
 * account-deletion.test.ts. A real deadlock needs two connections and is not
 * reproducible in a fake; this pins the shape that removed it.
 */

const source = readFileSync(new URL('../delete-user-data/index.ts', import.meta.url), 'utf8');
function slice(startMarker: string, endMarker: string) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  expect(start).toBeGreaterThan(0);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

// The pre-turn-7 shape, kept as a negative control for the recorder itself.
const OLD_SHAPE = `async deleteDataTables(userId) {
  const { data: reportIds } = await supabase.from("lab_reports").select("id").eq("user_id", userId);
  const ids = (reportIds ?? []).map((r) => r.id);
  if (ids.length > 0) {
    const perReport = await Promise.all([
      supabase.rpc("delete_interpretations", { p_report_ids: ids }),
      supabase.from("biomarkers").delete().in("lab_report_id", ids),
      supabase.from("report_items").delete().in("lab_report_id", ids),
      supabase.from("report_analytes").delete().in("lab_report_id", ids),
    ]);
  }
},`;

function deleteDataTablesFrom(methodSource: string) {
  const { code } = transformSync(`const o = {\n${methodSource}\n};\nreturn o.deleteDataTables;`,
    { loader: 'ts', target: 'es2022' });
  return (supabase: unknown) => new Function('supabase', code)(supabase) as (userId: string) => Promise<void>;
}

type Event = { at: number; kind: 'start' | 'end'; op: string };

function recordingSupabase(reportIds: string[], opts: { eraseError?: string; eraseCode?: string } = {}) {
  const events: Event[] = [];
  let clock = 0;
  const run = (op: string, result: () => unknown, deferred: boolean) => {
    events.push({ at: clock++, kind: 'start', op });
    return new Promise(resolve => {
      const settle = () => { events.push({ at: clock++, kind: 'end', op }); resolve(result()); };
      if (deferred) setTimeout(settle, 0); else queueMicrotask(settle);
    });
  };
  const from = (table: string) => {
    let op = `select:${table}`;
    const query: Record<string, unknown> = {};
    query.select = () => query;
    query.delete = () => { op = `delete:${table}`; return query; };
    query.update = () => { op = `update:${table}`; return query; };
    query.eq = () => query;
    query.in = () => query;
    query.then = (done: (v: unknown) => unknown, fail: (e: unknown) => unknown) =>
      run(op, () => ({ data: op === 'select:lab_reports' ? reportIds.map(id => ({ id })) : null, error: null }), false)
        .then(done, fail);
    return query;
  };
  const rpcArgs: unknown[] = [];
  const rpc = (name: string, args?: unknown) => {
    rpcArgs.push(args);
    return run(`rpc:${name}`, () => ({ data: null,
      error: name === 'delete_user_data' && opts.eraseError ? { message: opts.eraseError, code: opts.eraseCode } : null }), true);
  };
  return { client: { from, rpc }, events, rpcArgs };
}

const started = (events: Event[]) => events.filter(e => e.kind === 'start').map(e => e.op);
const endOf = (events: Event[], op: string) => events.find(e => e.kind === 'end' && e.op === op)!.at;

describe('delete-user-data account erasure (executed from source)', () => {
  const method = slice('async deleteDataTables(userId) {', 'async deleteAuthUser(');
  const deleteDataTables = deleteDataTablesFrom(method);

  it('erases through exactly one awaited delete_user_data call and nothing else', async () => {
    const fake = recordingSupabase(['r2', 'r1']);
    await deleteDataTables(fake.client)('u');
    expect(started(fake.events)).toEqual(['rpc:delete_user_data']);
    expect(fake.rpcArgs).toEqual([{ p_user_id: 'u' }]);
  });

  it('never touches the report graph through erase_reports, delete_interpretations or a per-table sweep', async () => {
    const fake = recordingSupabase(['r1']);
    await deleteDataTables(fake.client)('u');
    const ops = started(fake.events);
    expect(ops.filter(op => op.startsWith('delete:') || op.startsWith('select:'))).toEqual([]);
    expect(source).not.toContain('erase_reports');
    expect(source).not.toContain('delete_interpretations');
    expect(method).not.toMatch(/\.from\(/);
    expect(method).not.toMatch(/Promise\.all(Settled)?\s*\(/);
  });

  it('a user with no reports is still erased by the same single call', async () => {
    const fake = recordingSupabase([]);
    await deleteDataTables(fake.client)('u');
    expect(started(fake.events)).toEqual(['rpc:delete_user_data']);
  });

  it('a failed erasure throws and keeps the SQLSTATE, so the shared module can retry 40P01', async () => {
    const fake = recordingSupabase(['r1'], { eraseError: 'deadlock detected', eraseCode: '40P01' });
    await expect(deleteDataTables(fake.client)('u')).rejects.toMatchObject({
      message: 'Erasing user data failed: deadlock detected', code: '40P01' });
    expect(started(fake.events)).toEqual(['rpc:delete_user_data']);
  });

  it('negative control: the recorder sees the old shape start child deletes before the RPC settles', async () => {
    const fake = recordingSupabase(['r1']);
    await deleteDataTablesFrom(OLD_SHAPE)(fake.client)('u');
    const settled = endOf(fake.events, 'rpc:delete_interpretations');
    const overlapping = fake.events.filter(e => e.kind === 'start' && e.at < settled
      && ['delete:biomarkers', 'delete:report_items', 'delete:report_analytes'].includes(e.op));
    expect(overlapping.map(e => e.op)).toEqual(['delete:biomarkers', 'delete:report_items', 'delete:report_analytes']);
  });
});
