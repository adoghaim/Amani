import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import * as reportDeletion from './report-deletion.ts';

/**
 * Executes the real delete-report Deno handler from source (the
 * entitlement-response.test.ts technique) against a fake Supabase that keeps a
 * tiny in-memory database and bucket and records every call. Proves the wiring:
 * auth and input boundary, which client (caller RLS vs service) does what, the
 * erase_reports call, the bucket, user scoping of every queue read/write, and
 * the HTTP answers. The policy itself is covered in report-deletion.test.ts;
 * the trigger that fills lab_file_cleanup is proven in the SQL harness.
 */

const source = readFileSync(new URL('../delete-report/index.ts', import.meta.url), 'utf8');
const handlerSource = source.slice(source.indexOf('const headers'));

const USER = '0f8fad5b-d9cb-469f-a165-70867728950e';
const OTHER = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const REPORT = '11111111-2222-4333-8444-555555555555';
const FILE = `${USER}/1725379200000.pdf`;
const ANON = 'anon-key';
const SERVICE = 'service-key';

interface Call { client: 'user' | 'service'; op: string; table?: string; filters: string[]; args?: unknown }
interface Scenario {
  user?: { id: string } | null;
  reports?: Array<{ id: string; user_id: string; file_url: string | null }>;
  objects?: string[];
  storageError?: { message: string; status?: number } | null;
  ownershipError?: { message: string } | null;
  eraseError?: { message: string } | null;
}

function fakeRuntime(scenario: Scenario) {
  const reports = (scenario.reports ?? [{ id: REPORT, user_id: USER, file_url: FILE }]).map((r) => ({ ...r }));
  const objects = new Set(scenario.objects ?? [FILE]);
  const queue: Array<Record<string, unknown>> = [];
  const calls: Call[] = [];
  const delays: number[] = [];
  let seq = 0;
  const authedUser = scenario.user === undefined ? { id: USER } : scenario.user;

  const matches = (row: Record<string, unknown>, filters: Array<[string, string, unknown]>) =>
    filters.every(([kind, column, value]) => kind === 'eq' ? row[column] === value
      : kind === 'in' ? (value as unknown[]).includes(row[column])
        : kind === 'not-null' ? row[column] !== null : true);

  function client(kind: 'user' | 'service') {
    const from = (table: string) => {
      const filters: Array<[string, string, unknown]> = [];
      const call: Call = { client: kind, op: 'select', table, filters: [] };
      let patch: Record<string, unknown> | null = null;
      let limit = Infinity;
      const run = () => {
        calls.push(call);
        if (table === 'lab_reports') {
          if (scenario.ownershipError && call.args === 'id') return { data: null, error: scenario.ownershipError };
          // The caller's client sees only the caller's rows (RLS).
          const visible = reports.filter((r) => kind === 'service' || r.user_id === authedUser?.id);
          const rows = visible.filter((r) => matches(r, filters));
          return { data: call.op === 'maybeSingle' ? rows[0] ?? null : rows, error: null };
        }
        if (table === 'lab_file_cleanup') {
          const rows = queue.filter((r) => matches(r, filters));
          if (call.op === 'delete') { for (const r of rows) queue.splice(queue.indexOf(r), 1); return { data: null, error: null }; }
          if (call.op === 'update') { for (const r of rows) Object.assign(r, patch); return { data: null, error: null }; }
          return { data: rows.slice(0, limit), error: null };
        }
        throw new Error(`unexpected table ${table}`);
      };
      const query: Record<string, unknown> = {
        select: (columns: string) => { call.args = columns; return query; },
        delete: () => { call.op = 'delete'; return query; },
        update: (values: Record<string, unknown>) => { call.op = 'update'; patch = values; call.args = values; return query; },
        eq: (column: string, value: unknown) => { filters.push(['eq', column, value]); call.filters.push(`${column}=${String(value)}`); return query; },
        in: (column: string, value: unknown[]) => { filters.push(['in', column, value]); call.filters.push(`${column} in ${value.join(',')}`); return query; },
        not: (column: string, operator: string, value: unknown) => {
          if (operator !== 'is' || value !== null) throw new Error('unexpected not()');
          filters.push(['not-null', column, null]); call.filters.push(`${column} not null`); return query;
        },
        order: (column: string, options: { ascending: boolean }) => { call.filters.push(`order ${column} ${options.ascending ? 'asc' : 'desc'}`); return query; },
        limit: (n: number) => { limit = n; call.filters.push(`limit ${n}`); return query; },
        maybeSingle: async () => { call.op = 'maybeSingle'; return run(); },
        then: (done: (value: unknown) => unknown, fail: (error: unknown) => unknown) => Promise.resolve().then(run).then(done, fail),
      };
      return query;
    };
    return {
      auth: {
        getUser: async () => (authedUser ? { data: { user: authedUser }, error: null }
          : { data: { user: null }, error: { message: 'invalid JWT' } }),
      },
      from,
      rpc: async (name: string, args: { p_report_ids: string[] }) => {
        calls.push({ client: kind, op: `rpc:${name}`, filters: [], args });
        if (scenario.eraseError) return { data: null, error: scenario.eraseError };
        // The AFTER DELETE trigger: record each erased report's file, same step.
        for (const id of args.p_report_ids) {
          const index = reports.findIndex((r) => r.id === id);
          if (index < 0) continue;
          const [report] = reports.splice(index, 1);
          if (report.file_url) {
            queue.push({ id: `q${++seq}`, user_id: report.user_id, report_id: report.id, file_ref: report.file_url,
              attempts: 0, last_error: null, last_attempt_at: null, created_at: `2026-10-12T00:00:0${seq}Z` });
          }
        }
        return { data: null, error: null };
      },
      storage: {
        from: (bucket: string) => ({
          remove: async (paths: string[]) => {
            calls.push({ client: kind, op: `storage:${bucket}:remove`, filters: [], args: paths });
            if (scenario.storageError) return { data: null, error: scenario.storageError };
            const removed = paths.filter((p) => objects.delete(p)).map((name) => ({ name }));
            return { data: removed, error: null };
          },
        }),
      },
    };
  }

  const createClient = (_url: string, key: string) => {
    if (key === ANON) return client('user');
    if (key === SERVICE) return client('service');
    throw new Error(`unexpected key ${key}`);
  };
  let handler: ((req: Request) => Promise<Response>) | null = null;
  const env: Record<string, string> = { SUPABASE_URL: 'https://amani-test.invalid', SUPABASE_ANON_KEY: ANON, SUPABASE_SERVICE_ROLE_KEY: SERVICE };
  const Deno = { serve: (fn: (req: Request) => Promise<Response>) => { handler = fn; }, env: { get: (k: string) => env[k] } };
  const setTimeout = (fn: () => void, ms: number) => { delays.push(ms); fn(); return 0; };
  const quietConsole = { ...console, warn: () => {}, error: () => {} };
  const { code } = transformSync(handlerSource, { loader: 'ts', target: 'es2022' });
  new Function('Deno', 'createClient', 'setTimeout', 'console', ...Object.keys(reportDeletion), code)(
    Deno, createClient, setTimeout, quietConsole, ...Object.values(reportDeletion));
  if (!handler) throw new Error('handler was not registered');
  const serve = handler as (req: Request) => Promise<Response>;

  const request = (body: unknown, init: { method?: string; auth?: string | null } = {}) => serve(new Request('https://fn.invalid/delete-report', {
    method: init.method ?? 'POST',
    headers: init.auth === null ? {} : { Authorization: init.auth ?? 'Bearer user-jwt', 'Content-Type': 'application/json' },
    body: init.method && init.method !== 'POST' ? undefined : JSON.stringify(body),
  }));
  return { request, calls, queue, objects, reports, delays };
}

const ops = (calls: Call[]) => calls.map((c) => `${c.client}:${c.op}${c.table ? `:${c.table}` : ''}`);

describe('delete-report handler (executed from source)', () => {
  it('answers CORS preflight and refuses other methods and missing auth before touching data', async () => {
    const rt = fakeRuntime({});
    const preflight = await rt.request(null, { method: 'OPTIONS' });
    expect(preflight.status).toBe(200);
    expect(preflight.headers.get('Access-Control-Allow-Methods')).toBe('POST, OPTIONS');
    expect((await rt.request(null, { method: 'GET' })).status).toBe(405);
    const anonymous = await rt.request({ report_id: REPORT }, { auth: null });
    expect(anonymous.status).toBe(401);
    expect(await anonymous.json()).toEqual({ code: 'unauthorized' });
    expect(rt.calls).toEqual([]);
  });

  it('refuses an invalid session or report id without erasing anything', async () => {
    const expired = fakeRuntime({ user: null });
    expect((await expired.request({ report_id: REPORT })).status).toBe(401);
    const rt = fakeRuntime({});
    for (const body of [null, {}, { report_id: 'report-1' }, { report_id: 42 }, { reportId: REPORT }]) {
      const response = await rt.request(body);
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ code: 'invalid_report_id' });
    }
    expect(rt.calls).toEqual([]);
    expect(rt.reports).toHaveLength(1);
  });

  it('erases through erase_reports, removes the file from lab-files and completes the record, all scoped to the caller', async () => {
    const rt = fakeRuntime({});
    const response = await rt.request({ report_id: REPORT });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, status: 'deleted' });
    expect(ops(rt.calls).slice(0, 6)).toEqual([
      'user:maybeSingle:lab_reports',
      'service:rpc:erase_reports',
      'user:select:lab_reports',
      'service:select:lab_file_cleanup',
      'service:storage:lab-files:remove',
      'service:delete:lab_file_cleanup',
    ]);
    const [ownership, erase, live, ownItems, removal, completion] = rt.calls;
    expect(ownership.filters).toEqual([`id=${REPORT}`, `user_id=${USER}`]);
    expect(erase.args).toEqual({ p_report_ids: [REPORT] });
    expect(live.filters).toEqual([`user_id=${USER}`, 'file_url not null']);
    expect(ownItems.filters).toEqual([`user_id=${USER}`, `report_id=${REPORT}`, 'order created_at asc', 'limit 50']);
    expect(removal.args).toEqual([FILE]);
    expect(completion.filters).toEqual([`user_id=${USER}`, 'id in q1']);
    // Backlog read is the caller's own queue only.
    const backlogRead = rt.calls[6];
    expect(backlogRead).toMatchObject({ client: 'service', op: 'select', table: 'lab_file_cleanup' });
    expect(backlogRead.filters[0]).toBe(`user_id=${USER}`);
    expect(rt.objects.size).toBe(0);
    expect(rt.queue).toEqual([]);
  });

  it('a storage outage answers 503 file_cleanup_pending, records the attempt, and keeps the record for the retry', async () => {
    const rt = fakeRuntime({ storageError: { message: 'storage unavailable', status: 503 } });
    const response = await rt.request({ report_id: REPORT });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      success: false, code: 'file_cleanup_pending', report_deleted: true, retry: true,
      error: 'The report was deleted, but its uploaded file could not be removed yet. Please try again.',
    });
    expect(rt.calls.filter((c) => c.op === 'storage:lab-files:remove')).toHaveLength(reportDeletion.REPORT_FILE_ATTEMPTS);
    expect(rt.delays).toEqual([...reportDeletion.RETRY_BACKOFF_MS]);
    const update = rt.calls.find((c) => c.op === 'update')!;
    expect(update.filters).toEqual([`user_id=${USER}`, 'id=q1']);
    expect(update.args).toMatchObject({ attempts: 1, last_error: 'storage unavailable' });
    expect(Number.isNaN(Date.parse((update.args as { last_attempt_at: string }).last_attempt_at))).toBe(false);
    expect(rt.queue).toMatchObject([{ report_id: REPORT, user_id: USER, attempts: 1 }]);
    expect(rt.reports).toEqual([]);
  });

  it('a missing object is success; a second call for the same report is idempotent', async () => {
    const rt = fakeRuntime({ objects: [] });
    expect(await (await rt.request({ report_id: REPORT })).json()).toEqual({ success: true, status: 'deleted' });
    const again = await rt.request({ report_id: REPORT });
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ success: true, status: 'already_deleted' });
    expect(rt.calls.filter((c) => c.op === 'rpc:erase_reports')).toHaveLength(1);
  });

  it('another user\'s report id is never erased and looks exactly like an unknown id', async () => {
    const theirs = fakeRuntime({ reports: [{ id: REPORT, user_id: OTHER, file_url: `${OTHER}/1.pdf` }], objects: [`${OTHER}/1.pdf`] });
    const response = await theirs.request({ report_id: REPORT });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, status: 'already_deleted' });
    expect(theirs.calls.some((c) => c.op.startsWith('rpc:') || c.op.startsWith('storage:'))).toBe(false);
    expect(theirs.reports).toHaveLength(1);
    expect(theirs.objects.has(`${OTHER}/1.pdf`)).toBe(true);
  });

  it('an ownership-read or erase failure answers 500 report_deletion_failed and touches no file', async () => {
    for (const scenario of [{ ownershipError: { message: 'db offline' } }, { eraseError: { message: 'deadlock detected' } }]) {
      const rt = fakeRuntime(scenario);
      const response = await rt.request({ report_id: REPORT });
      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({
        success: false, code: 'report_deletion_failed', report_deleted: false, retry: true,
        error: 'The report could not be deleted. Please try again.',
      });
      expect(rt.calls.some((c) => c.op.startsWith('storage:'))).toBe(false);
      expect(rt.objects.has(FILE)).toBe(true);
    }
  });
});
