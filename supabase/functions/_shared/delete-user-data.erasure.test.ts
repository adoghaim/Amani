import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import { deleteUserDataTables } from './account-deletion.ts';
import { orderedDeletes } from './user-data-registry.ts';

/**
 * Executes delete-user-data's real `deleteDataTables` from source (the
 * entitlement-response.test.ts technique) against a recording fake. Every
 * query records when it starts executing and when it settles, and the RPC
 * settles only on a later macrotask, so any overlap with the report-graph
 * erasure is visible. The SQL side (erase_reports deletes the whole graph, no
 * refund, service only) is proven in
 * supabase/migrations/__verification__/interpretation-versions.erase-reports.sql. A real deadlock
 * needs two connections and is not reproducible in a fake; this pins the shape
 * that removed it: one awaited erase_reports, nothing concurrent on the graph.
 */

const source = readFileSync(new URL('../delete-user-data/index.ts', import.meta.url), 'utf8');
// Every delete the function may issue after erasure: the unchanged user-keyed
// sweep (lab_reports included, by user_id) and the profile row.
const USER_KEYED = ['interventions', 'cycle_events', 'parser_debug', 'introductory_deep_access_claims',
  'complimentary_entitlements', 'lab_reports', 'period_logs', 'symptom_logs', 'notification_preferences',
  'reminders', 'audit_events', 'rate_limits', 'iap_beta_testers', 'users'];

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
  // PK-INT-01: the handler's method calls deleteUserDataTables, which it imports
  // from ../_shared/account-deletion.ts. The real one is passed in under that
  // name, so this still executes the handler's own code and the shared order.
  return (supabase: unknown) => new Function('supabase', 'deleteUserDataTables', code)(supabase, deleteUserDataTables) as (userId: string) => Promise<void>;
}

type Event = { at: number; kind: 'start' | 'end'; op: string };

function recordingSupabase(reportIds: string[], opts: { eraseError?: string } = {}) {
  const events: Event[] = [];
  // The column each delete filters on, in the order the deletes run.
  const deleteFilters: Array<{ op: string; column: string }> = [];
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
    let column = '';
    const query: Record<string, unknown> = {};
    query.select = () => query;
    query.delete = () => { op = `delete:${table}`; return query; };
    query.update = () => { op = `update:${table}`; return query; };
    query.eq = (filter: string) => { column = filter; return query; };
    query.in = () => query;
    query.then = (done: (v: unknown) => unknown, fail: (e: unknown) => unknown) => {
      if (op.startsWith('delete:')) deleteFilters.push({ op, column });
      return run(op, () => ({ data: op === 'select:lab_reports' ? reportIds.map(id => ({ id })) : null, error: null }), false)
        .then(done, fail);
    };
    return query;
  };
  const rpc = (name: string) => run(`rpc:${name}`,
    () => ({ data: null, error: name === 'erase_reports' && opts.eraseError ? { message: opts.eraseError } : null }), true);
  return { client: { from, rpc }, events, deleteFilters };
}

const started = (events: Event[]) => events.filter(e => e.kind === 'start').map(e => e.op);
const endOf = (events: Event[], op: string) => events.find(e => e.kind === 'end' && e.op === op)!.at;

describe('delete-user-data report-graph erasure (executed from source)', () => {
  const method = slice('async deleteDataTables(userId) {', 'async deleteAuthUser(');
  const deleteDataTables = deleteDataTablesFrom(method);

  it('awaits erase_reports for every report before any other delete starts', async () => {
    const fake = recordingSupabase(['r2', 'r1']);
    await deleteDataTables(fake.client)('u');
    const ops = started(fake.events);
    expect(ops[0]).toBe('select:lab_reports');
    expect(ops[1]).toBe('rpc:erase_reports');
    const erased = endOf(fake.events, 'rpc:erase_reports');
    const writesAfterList = fake.events.filter(e => e.kind === 'start' && e.op !== 'select:lab_reports');
    for (const e of writesAfterList.slice(1)) expect(e.at).toBeGreaterThan(erased);
    // The rest of the function is unchanged: user-keyed sweeps, profile last.
    expect(ops.at(-1)).toBe('delete:users');
    expect(ops).toContain('delete:lab_reports');
  });

  it('touches the report graph only through erase_reports, never delete_interpretations', async () => {
    const fake = recordingSupabase(['r1']);
    await deleteDataTables(fake.client)('u');
    const ops = started(fake.events);
    expect(ops.filter(op => op.startsWith('rpc:'))).toEqual(['rpc:erase_reports']);
    // No per-report child delete (biomarkers, report_items, report_analytes) remains.
    expect(ops.filter(op => op.startsWith('delete:'))).toEqual(USER_KEYED.map(t => `delete:${t}`));
    expect(source).not.toContain('delete_interpretations');
    expect(method).not.toMatch(/Promise\.all(Settled)?\s*\(/);
  });

  it('the user-keyed lab_reports sweep runs only after the erase has settled', async () => {
    const fake = recordingSupabase(['r1']);
    await deleteDataTables(fake.client)('u');
    const sweep = fake.events.find(e => e.kind === 'start' && e.op === 'delete:lab_reports')!.at;
    expect(sweep).toBeGreaterThan(endOf(fake.events, 'rpc:erase_reports'));
  });

  it('a user with no reports makes no erasure call', async () => {
    const fake = recordingSupabase([]);
    await deleteDataTables(fake.client)('u');
    expect(started(fake.events).filter(op => op.startsWith('rpc:'))).toEqual([]);
  });

  it('a failed erasure stops deletion before any user-keyed table is touched', async () => {
    const fake = recordingSupabase(['r1'], { eraseError: 'boom' });
    await expect(deleteDataTables(fake.client)('u')).rejects.toThrow('Report erasure failed: boom');
    expect(started(fake.events)).toEqual(['select:lab_reports', 'rpc:erase_reports']);
  });

  it('PK-INT-01: the registry drives exactly the V2 sweep, in the V2 order', () => {
    expect(orderedDeletes().map(entry => entry.table)).toEqual(USER_KEYED);
    // The handler's method really calls the shared function it was given above.
    expect(source).toMatch(/import \{[^}]*\bdeleteUserDataTables\b[^}]*\} from "\.\.\/_shared\/account-deletion\.ts";/);
    expect(method).toContain('await deleteUserDataTables({');
  });

  it('PK-INT-01: each sweep filters on the same column as before: user_id, and id for the profile row', async () => {
    const fake = recordingSupabase(['r1']);
    await deleteDataTables(fake.client)('u');
    expect(fake.deleteFilters).toEqual(USER_KEYED.map(table =>
      ({ op: `delete:${table}`, column: table === 'users' ? 'id' : 'user_id' })));
  });

  it('PK-INT-01: a failed sweep stops at that table with the message it always had', async () => {
    const failing = (table: string) => {
      const fake = recordingSupabase([]);
      const from = fake.client.from;
      const client = {
        ...fake.client,
        from: (name: string) => {
          const query = from(name) as Record<string, unknown>;
          if (name !== table) return query;
          const remove = query.delete as () => Record<string, unknown>;
          query.delete = () => {
            const filtered = remove();
            filtered.eq = () => ({ then: (done: (v: unknown) => unknown) => Promise.resolve({ error: { message: 'boom' } }).then(done) });
            return filtered;
          };
          return query;
        },
      };
      return { fake, run: deleteDataTables(client)('u') };
    };
    const rateLimits = failing('rate_limits');
    await expect(rateLimits.run).rejects.toThrow('Deleting rate_limits failed: boom');
    expect(started(rateLimits.fake.events)).not.toContain('delete:iap_beta_testers');
    const profile = failing('users');
    await expect(profile.run).rejects.toThrow('Deleting users row failed: boom');
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
