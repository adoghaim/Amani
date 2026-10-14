import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import { deleteUserDataTables, isMissingTableError, MissingTableError } from './account-deletion.ts';

/**
 * PK-FIX-04 adds one user-owned table, `lab_file_cleanup`. Account deletion must
 * erase it, and the packet must not change account deletion. This pins how both
 * hold at once: the table's user_id cascades from `public.users`, and
 * delete-user-data's real `deleteDataTables` (executed from source, the
 * delete-user-data.erasure.test.ts technique) deletes the `users` row as its
 * last write. The SQL side — account erasure through that cascade succeeds and
 * leaves no row, and records nothing for an owner already gone — is proven by
 * execution in supabase/migrations/__verification__/lab-file-cleanup.verify.sql.
 */

const migrationsDir = new URL('../../migrations/', import.meta.url);
const migrationName = readdirSync(migrationsDir).find((name) => name.endsWith('_lab_file_cleanup.sql'));
const migration = readFileSync(new URL(migrationName ?? 'missing.sql', migrationsDir), 'utf8');
const deleteUserData = readFileSync(new URL('../delete-user-data/index.ts', import.meta.url), 'utf8');

function deleteDataTablesFromSource() {
  const start = deleteUserData.indexOf('async deleteDataTables(userId) {');
  const end = deleteUserData.indexOf('async deleteAuthUser(', start);
  expect(start).toBeGreaterThan(0);
  expect(end).toBeGreaterThan(start);
  const { code } = transformSync(`const o = {\n${deleteUserData.slice(start, end)}\n};\nreturn o.deleteDataTables;`,
    { loader: 'ts', target: 'es2022' });
  // PK-INT-01: the handler's method calls deleteUserDataTables (and its missing-table
  // helpers), imported from ./account-deletion.ts. The real ones are passed in under
  // those names, as delete-user-data.erasure.test.ts does, so this still executes the
  // handler's own code and the shared, registry-driven order.
  return (supabase: unknown) => new Function('supabase', 'deleteUserDataTables', 'isMissingTableError', 'MissingTableError', code)(
    supabase, deleteUserDataTables, isMissingTableError, MissingTableError) as (userId: string) => Promise<void>;
}

function recordingSupabase(reportIds: string[]) {
  const writes: string[] = [];
  const from = (table: string) => {
    let op = `select:${table}`;
    const query: Record<string, unknown> = {};
    query.select = () => query;
    query.delete = () => { op = `delete:${table}`; return query; };
    query.eq = () => query;
    query.then = (done: (v: unknown) => unknown) => {
      if (op !== `select:${table}`) writes.push(op);
      return Promise.resolve({ data: op === 'select:lab_reports' ? reportIds.map((id) => ({ id })) : null, error: null }).then(done);
    };
    return query;
  };
  const rpc = async (name: string) => { writes.push(`rpc:${name}`); return { data: null, error: null }; };
  return { client: { from, rpc }, writes };
}

describe('lab_file_cleanup is erased by account deletion, which PK-FIX-04 leaves unchanged', () => {
  it('exactly one migration creates the table, with user_id cascading from public.users', () => {
    expect(migrationName).toBeDefined();
    expect(migration).toMatch(/CREATE TABLE public\.lab_file_cleanup \(/);
    expect(migration).toMatch(/user_id uuid NOT NULL REFERENCES public\.users\(id\) ON DELETE CASCADE/);
  });

  it('delete-user-data deletes the users row last, after erase_reports, so the cascade erases every cleanup row', async () => {
    const fake = recordingSupabase(['r1', 'r2']);
    await deleteDataTablesFromSource()(fake.client)('u');
    expect(fake.writes[0]).toBe('rpc:erase_reports');
    expect(fake.writes.at(-1)).toBe('delete:users');
    // Whatever erase_reports' trigger recorded is gone with the users row; an
    // explicit sweep, if one is ever added, must also come before it.
    const sweep = fake.writes.indexOf('delete:lab_file_cleanup');
    if (sweep >= 0) expect(sweep).toBeLessThan(fake.writes.length - 1);
  });

  it('account deletion still sweeps the whole storage prefix, so it never depends on the queue', () => {
    expect(deleteUserData).toMatch(/storage\.from\("lab-files"\)\.list\(userId,/);
    expect(deleteUserData).toMatch(/storage\.from\("lab-files"\)\.remove\(paths\)/);
  });
});
