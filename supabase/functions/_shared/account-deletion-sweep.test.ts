import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  deletionDeployPrerequisites,
  deletionPreflightSql,
  orderedDeletes,
  registryProblems,
  USER_DATA_REGISTRY,
  V2_RUNBOOK_LAST_MIGRATION,
  type UserDataRegistryEntry,
} from './user-data-registry.ts';

/*
  Erasure coverage, derived from the migrations rather than from memory.

  Ported from PR #92 (factory/pk-03e-e-account-deletion-deadlock,
  account-deletion-sweep.test.ts), which checked one SQL erasure function. On
  main, delete-user-data erases from user-data-registry.ts, so this checks the
  registry (PK-INT-01, owner decision D3).

  A table holds user data when it has a user_id, lab_report_id, report_id or
  Stripe customer_id column, a foreign key to users or lab_reports, or a
  foreign key to another table that holds user data. Every such table must be
  registered, and each registered mechanism must hold in the migrations as
  written:
    erase_reports_cascade  an ON DELETE CASCADE chain from lab_reports reaches it
    auth_cascade           an ON DELETE CASCADE chain from auth.users reaches it
    ordered_delete         delete-user-data deletes it by ownerColumn
    exception              its reason says what erases it; the claims of the
                           current exceptions are checked one by one below
  A registered table must exist and have its ownerColumn. A new table fails
  here until it is registered, so "we forgot the new table" cannot ship.

  Renames are followed: an entry may name a table by the name its CREATE TABLE
  gave it. The renamed interpretations table is registered that way, because
  TASK-047 M8c (legacy-raw-access.test.ts) forbids its current name anywhere in
  application code, this file included. An ordered_delete entry must use the
  current name: delete-user-data deletes by it.
*/

const MIGRATIONS = fileURLToPath(new URL('../../migrations/', import.meta.url));

type OnDelete = 'cascade' | 'set null' | 'set default' | 'restrict' | 'no action';
interface ForeignKey { name: string; columns: string[]; target: string; onDelete: OnDelete }
/** `name` is the current name; `names` every name it has had, current last. */
interface Table { name: string; names: string[]; createdIn: string; columns: Set<string>; direct: boolean; fks: ForeignKey[] }
type Schema = Map<string, Table>;
interface Migration { name: string; sql: string }

const OWNER_COLUMN = /^\s*"?(user_id|lab_report_id|report_id|customer_id)"?\s/i;
const OWNER_REFERENCE = /references\s+(?:auth\.|public\.)?"?(users|lab_reports)\b"?/i;
const owns = (entry: string) => OWNER_COLUMN.test(entry) || OWNER_REFERENCE.test(entry);
const CONSTRAINT_ENTRY = /^\s*(constraint|primary|unique|foreign|check|exclude)\b/i;
const REFERENCES = /\breferences\s+(?:"?(\w+)"?\s*\.\s*)?"?(\w+)"?([\s\S]*)$/i;

/** The body of `CREATE TABLE name ( ... )`, by balanced parentheses. */
function tableBody(sql: string, open: number): string {
  let depth = 0;
  for (let i = open; i < sql.length; i++) {
    if (sql[i] === '(') depth++;
    else if (sql[i] === ')' && --depth === 0) return sql.slice(open + 1, i);
  }
  throw new Error(`unbalanced CREATE TABLE body at offset ${open}`);
}

/** Top-level comma-separated entries (columns and constraints, or ALTER sub-commands). */
function entries(body: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of body) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      out.push(current);
      current = '';
    } else current += ch;
  }
  return [...out, current].filter(e => e.trim() !== '');
}

const qualified = (schema: string | undefined, name: string) =>
  !schema || schema.toLowerCase() === 'public' ? name.toLowerCase() : `${schema.toLowerCase()}.${name.toLowerCase()}`;
const unquote = (name: string) => name.replace(/"/g, '').trim().toLowerCase();

function foreignKey(table: string, entry: string, columnName?: string): ForeignKey | null {
  const ref = REFERENCES.exec(entry);
  if (!ref) return null;
  const fkColumns = /foreign\s+key\s*\(([^)]*)\)/i.exec(entry)?.[1]?.split(',').map(unquote)
    ?? (columnName ? [columnName] : []);
  const named = /\bconstraint\s+"?(\w+)"?/i.exec(entry)?.[1]?.toLowerCase();
  const action = /\bon\s+delete\s+(cascade|restrict|no\s+action|set\s+null|set\s+default)/i.exec(ref[3]!)?.[1];
  return {
    name: named ?? `${table}_${fkColumns.join('_')}_fkey`,
    columns: fkColumns,
    target: qualified(ref[1], ref[2]!),
    onDelete: (action?.toLowerCase().replace(/\s+/g, ' ') ?? 'no action') as OnDelete,
  };
}

function addEntry(table: Table, entry: string) {
  if (/^\s*like\b/i.test(entry)) throw new Error(`${table.createdIn}: cannot model ${table.name} (... LIKE ...) — extend this test`);
  const column = CONSTRAINT_ENTRY.test(entry) ? undefined : unquote(entry.trim().split(/\s+/)[0]!);
  if (column) table.columns.add(column);
  if (owns(entry)) table.direct = true;
  const fk = foreignKey(table.name, entry, column);
  if (fk) table.fks.push(fk);
}

/** Every table the migrations leave behind, with its columns and foreign keys, in file order. */
function deriveSchema(migrations: Migration[]): Schema {
  const schema: Schema = new Map();
  const statement = new RegExp([
    String.raw`create\s+table\s+(?:if\s+not\s+exists\s+)?(?:"?(\w+)"?\s*\.\s*)?"?(\w+)"?\s*(\(|as\b|partition\b|of\b)`,
    String.raw`drop\s+table\s+(?:if\s+exists\s+)?((?:"?\w+"?\s*\.\s*)?"?\w+"?(?:\s*,\s*(?:"?\w+"?\s*\.\s*)?"?\w+"?)*)`,
    String.raw`alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?(?:"?(\w+)"?\s*\.\s*)?"?(\w+)"?\s+([^;]*)`,
  ].join('|'), 'gi');
  for (const { name: file, sql: raw } of migrations) {
    const sql = raw.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, '');
    for (const m of sql.matchAll(statement)) {
      if (m[2]) {
        const name = qualified(m[1], m[2]);
        if (m[3] !== '(') throw new Error(`${file}: cannot model CREATE TABLE ${name} ${m[3]} — extend this test`);
        const open = m.index! + m[0].length - 1;
        const body = tableBody(sql, open);
        const close = open + body.length + 1;
        if (/^\s*inherits\b/i.test(sql.slice(close + 1, close + 40))) {
          throw new Error(`${file}: cannot model CREATE TABLE ${name} ... INHERITS — extend this test`);
        }
        // CREATE TABLE of a table that exists only succeeds when it is skipped
        // (IF NOT EXISTS, or a guarding DO block): the first definition stands.
        if (schema.has(name)) continue;
        const table: Table = { name, names: [name], createdIn: file, columns: new Set(), direct: false, fks: [] };
        for (const entry of entries(body)) addEntry(table, entry);
        schema.set(name, table);
      } else if (m[4]) {
        for (const dropped of m[4].split(',').map(t => t.trim()).filter(Boolean)) {
          const [first, second] = dropped.split('.').map(unquote);
          const name = second ? qualified(first, second) : first!;
          schema.delete(name);
          // CASCADE drops the foreign keys that pointed at it; without CASCADE
          // the DROP fails while any exist, so either way none survive.
          for (const table of schema.values()) table.fks = table.fks.filter(fk => fk.target !== name);
        }
      } else if (m[6]) {
        const name = qualified(m[5], m[6]);
        const table = schema.get(name);
        for (const command of entries(m[7]!)) {
          const renamed = /^\s*rename\s+to\s+"?(\w+)"?\s*$/i.exec(command);
          const moved = /^\s*set\s+schema\s+"?(\w+)"?\s*$/i.exec(command);
          if (renamed || moved) {
            const next = renamed ? renamed[1]!.toLowerCase() : qualified(moved![1], name.split('.').pop()!);
            if (!table) continue;
            schema.delete(name);
            table.name = next;
            table.names.push(next);
            schema.set(next, table);
            for (const other of schema.values()) for (const fk of other.fks) if (fk.target === name) fk.target = next;
            continue;
          }
          if (!table) continue;
          const column = /^\s*rename\s+(?:column\s+)?"?(\w+)"?\s+to\s+"?(\w+)"?\s*$/i.exec(command);
          if (column && column[1]!.toLowerCase() !== 'constraint') {
            table.columns.delete(column[1]!.toLowerCase());
            table.columns.add(column[2]!.toLowerCase());
            for (const fk of table.fks) fk.columns = fk.columns.map(c => (c === column[1]!.toLowerCase() ? column[2]!.toLowerCase() : c));
            continue;
          }
          const dropColumn = /^\s*drop\s+(?:column\s+)?(?:if\s+exists\s+)?"?(\w+)"?/i.exec(command);
          if (dropColumn && !/^\s*drop\s+constraint\b/i.test(command)) {
            const dropped = dropColumn[1]!.toLowerCase();
            table.columns.delete(dropped);
            table.fks = table.fks.filter(fk => !fk.columns.includes(dropped));
            continue;
          }
          const dropConstraint = /^\s*drop\s+constraint\s+(?:if\s+exists\s+)?"?(\w+)"?/i.exec(command);
          if (dropConstraint) {
            table.fks = table.fks.filter(fk => fk.name !== dropConstraint[1]!.toLowerCase());
            continue;
          }
          const added = /^\s*add\s+(?:column\s+)?(?:if\s+not\s+exists\s+)?([\s\S]*)$/i.exec(command);
          if (added) addEntry(table, ' ' + added[1]!);
        }
      }
    }
  }
  return schema;
}

/** Tables holding user data: direct owners, then anything with a foreign key into them. */
function userOwnedTables(schema: Schema): Set<string> {
  const owned = new Set([...schema.values()].filter(t => t.direct).map(t => t.name));
  for (let grew = true; grew;) {
    grew = false;
    for (const table of schema.values()) {
      if (!owned.has(table.name) && table.fks.some(fk => owned.has(fk.target))) {
        owned.add(table.name);
        grew = true;
      }
    }
  }
  return owned;
}

/** Does deleting a `root` row reach `table` through ON DELETE CASCADE foreign keys? */
function cascadesFrom(schema: Schema, root: string, table: string, seen = new Set<string>()): boolean {
  if (seen.has(table)) return false;
  seen.add(table);
  return (schema.get(table)?.fks ?? []).some(fk =>
    fk.onDelete === 'cascade' && (fk.target === root || cascadesFrom(schema, root, fk.target, seen)));
}

/** The table a name refers to: a table's current name first, else a name it had before a rename. */
function resolve(schema: Schema, name: string): Table | undefined {
  return schema.get(name) ?? [...schema.values()].find(table => table.names.includes(name));
}

function coverageProblems(schema: Schema, registry: readonly UserDataRegistryEntry[]): string[] {
  const problems = registryProblems(registry).map(problem => `registry: ${problem}`);
  const entriesFor = new Map<Table, string[]>();
  for (const entry of registry) {
    const table = resolve(schema, entry.table);
    if (!table) {
      problems.push(`${entry.table} is registered but no migration leaves such a table`);
      continue;
    }
    entriesFor.set(table, [...(entriesFor.get(table) ?? []), entry.table]);
    if (entry.mechanism === 'ordered_delete' && entry.table !== table.name) {
      problems.push(`${entry.table} is an ordered delete, so it must name the table as a migration last named it`);
    }
    if (!table.columns.has(entry.ownerColumn)) problems.push(`${entry.table} has no column ${entry.ownerColumn}`);
    if (entry.mechanism === 'erase_reports_cascade' && !cascadesFrom(schema, 'lab_reports', table.name)) {
      problems.push(`${entry.table} is registered as erase_reports_cascade, but no ON DELETE CASCADE chain from lab_reports reaches it`);
    }
    if (entry.mechanism === 'auth_cascade' && !cascadesFrom(schema, 'auth.users', table.name)) {
      problems.push(`${entry.table} is registered as auth_cascade, but no ON DELETE CASCADE chain from auth.users reaches it`);
    }
  }
  for (const names of entriesFor.values()) {
    if (names.length > 1) problems.push(`${names.join(' and ')} register the same table`);
  }
  for (const name of [...userOwnedTables(schema)].sort()) {
    const table = schema.get(name)!;
    if (!entriesFor.has(table)) {
      problems.push(`${table.names[0]} holds user data (created in ${table.createdIn}) but is not in user-data-registry.ts`);
    }
  }
  return problems;
}

const migrations: Migration[] = readdirSync(MIGRATIONS).filter(f => /^\d{14}_.*\.sql$/.test(f)).sort()
  .map(name => ({ name, sql: readFileSync(join(MIGRATIONS, name), 'utf8') }));
const schema = deriveSchema(migrations);
const fixture = (sql: string): Migration[] => [...migrations, { name: '99999999999999_fixture.sql', sql }];
const withEntry = (entry: UserDataRegistryEntry) =>
  [...USER_DATA_REGISTRY.filter(e => e.table !== 'users'), entry, USER_DATA_REGISTRY.find(e => e.table === 'users')!];
const fk = (table: string, target: string) => schema.get(table)!.fks.filter(f => f.target === target);

describe('account erasure coverage, derived from the migrations', () => {
  it('recognises the table shapes a future migration might use', () => {
    const owned = (sql: string) => userOwnedTables(deriveSchema([{ name: 'x.sql', sql }]));
    expect(owned('CREATE TABLE public.x (\n  id uuid,\n  user_id uuid NOT NULL);')).toEqual(new Set(['x']));
    expect(owned('CREATE TABLE x (id uuid PRIMARY KEY, owner uuid REFERENCES auth.users(id));')).toEqual(new Set(['x']));
    expect(owned('CREATE TABLE x (id uuid PRIMARY KEY REFERENCES public.users (id));')).toEqual(new Set(['x']));
    expect(owned('CREATE TABLE x (owner uuid REFERENCES auth.users ON DELETE CASCADE);')).toEqual(new Set(['x']));
    expect(owned('CREATE TABLE x (id uuid, note text CHECK (length(note) < 9));')).toEqual(new Set());
    // A child of a user-owned table holds user data even with no user column.
    expect(owned('CREATE TABLE r (id uuid PRIMARY KEY, lab_report_id uuid);\n'
      + 'CREATE TABLE note (id uuid, r_id uuid REFERENCES r(id) ON DELETE CASCADE);')).toEqual(new Set(['r', 'note']));
    // ALTER TABLE ... ADD a user column; a table in another schema keeps its schema.
    expect(owned('CREATE TABLE x (id uuid);\nALTER TABLE x ADD COLUMN IF NOT EXISTS user_id uuid;')).toEqual(new Set(['x']));
    expect(owned('CREATE TABLE private.x (user_id uuid);')).toEqual(new Set(['private.x']));
    expect(() => deriveSchema([{ name: 'x.sql', sql: 'CREATE TABLE x AS SELECT 1;' }])).toThrow(/extend this test/);
  });

  it('follows renames, drops and foreign-key changes the way Postgres does', () => {
    const s = deriveSchema([{ name: 'x.sql', sql: `
      CREATE TABLE lab_reports (id uuid PRIMARY KEY, user_id uuid);
      CREATE TABLE a (id uuid, lab_report_id uuid REFERENCES lab_reports(id) ON DELETE CASCADE);
      CREATE TABLE b (id uuid, a_id uuid, CONSTRAINT b_a_fk FOREIGN KEY (a_id) REFERENCES a(id) ON DELETE CASCADE);
      ALTER TABLE a RENAME TO a_private;
      CREATE TABLE c (id uuid, lab_report_id uuid REFERENCES lab_reports(id) ON DELETE SET NULL);
      CREATE TABLE d (id uuid, lab_report_id uuid REFERENCES lab_reports(id) ON DELETE CASCADE);
      ALTER TABLE d DROP CONSTRAINT d_lab_report_id_fkey;
      ALTER TABLE d ADD CONSTRAINT d_soft FOREIGN KEY (lab_report_id) REFERENCES lab_reports(id) ON DELETE SET NULL;` }]);
    expect(cascadesFrom(s, 'lab_reports', 'a_private')).toBe(true);
    expect(cascadesFrom(s, 'lab_reports', 'b')).toBe(true);
    expect(s.get('b')!.fks[0]!.target).toBe('a_private');
    expect(cascadesFrom(s, 'lab_reports', 'c')).toBe(false);
    expect(cascadesFrom(s, 'lab_reports', 'd')).toBe(false);
  });

  it('every table holding user data is registered, with a mechanism that holds for it', () => {
    expect(coverageProblems(schema, USER_DATA_REGISTRY)).toEqual([]);
    // Not vacuous: the derivation finds the report graph and the V2 version tables.
    const owned = userOwnedTables(schema);
    expect(owned.size).toBeGreaterThanOrEqual(30);
    for (const name of ['users', 'lab_reports', 'interpretations', 'interpretation_versions', 'iap_subscriptions']) {
      expect(owned.has(resolve(schema, name)?.name ?? ''), name).toBe(true);
    }
  });

  it('PK-EXP5: the event ledger and signup attribution are user data, swept by delete-user-data before the auth user', () => {
    const owned = userOwnedTables(schema);
    for (const name of ['app_events', 'user_attribution']) {
      expect(owned.has(name), name).toBe(true);
      // An ordered delete, so the rows are gone even if deleteAuthUser later fails.
      expect(USER_DATA_REGISTRY.find(e => e.table === name), name)
        .toEqual(expect.objectContaining({ ownerColumn: 'user_id', mechanism: 'ordered_delete' }));
      expect(cascadesFrom(schema, 'auth.users', name), name).toBe(true);
    }
    // Hashed IP counters hold no user id and are not user data.
    expect(owned.has('anon_event_counters')).toBe(false);
    // Unregistering either one fails the coverage check.
    for (const name of ['app_events', 'user_attribution']) {
      expect(coverageProblems(schema, USER_DATA_REGISTRY.filter(e => e.table !== name)).join('\n')).toContain(name);
    }
  });

  it('follows the interpretations rename: registered by its creation name, erased with its reports', () => {
    const interpretations = resolve(schema, 'interpretations')!;
    expect(interpretations.names).toHaveLength(2);
    expect(interpretations.names[0]).toBe('interpretations');
    expect(interpretations.createdIn).toBe('20260216193045_initial_schema.sql');
    expect(cascadesFrom(schema, 'lab_reports', interpretations.name)).toBe(true);
    expect(USER_DATA_REGISTRY.find(e => e.table === 'interpretations')?.mechanism).toBe('erase_reports_cascade');
  });

  it('a renamed table may be registered by its first name, but an ordered delete needs the current one, and a table registers once', () => {
    const renamed = deriveSchema([{ name: 'x.sql', sql: `
      CREATE TABLE users (id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE);
      CREATE TABLE lab_reports (id uuid PRIMARY KEY, user_id uuid REFERENCES users(id) ON DELETE CASCADE);
      CREATE TABLE notes (id uuid, lab_report_id uuid REFERENCES lab_reports(id) ON DELETE CASCADE);
      ALTER TABLE notes RENAME TO notes_hidden;` }]);
    const lab: UserDataRegistryEntry = { table: 'lab_reports', ownerColumn: 'user_id', mechanism: 'ordered_delete' };
    const notes: UserDataRegistryEntry = { table: 'notes', ownerColumn: 'lab_report_id', mechanism: 'erase_reports_cascade' };
    const users: UserDataRegistryEntry = { table: 'users', ownerColumn: 'id', mechanism: 'ordered_delete' };
    expect(coverageProblems(renamed, [lab, notes, users])).toEqual([]);
    expect(coverageProblems(renamed, [lab, { ...notes, mechanism: 'ordered_delete' }, users]))
      .toEqual(['notes is an ordered delete, so it must name the table as a migration last named it']);
    expect(coverageProblems(renamed, [lab, notes, { ...notes, table: 'notes_hidden' }, users]))
      .toEqual(['notes and notes_hidden register the same table']);
    expect(coverageProblems(renamed, [lab, users]))
      .toEqual(['notes holds user data (created in x.sql) but is not in user-data-registry.ts']);
  });

  it('fails on an unregistered user table, and passes once it is registered', () => {
    const added = deriveSchema(fixture(`CREATE TABLE public.fixture_new_feature (
      id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE, note text);`));
    expect(coverageProblems(added, USER_DATA_REGISTRY)).toEqual([
      'fixture_new_feature holds user data (created in 99999999999999_fixture.sql) but is not in user-data-registry.ts',
    ]);
    expect(coverageProblems(added, withEntry({ table: 'fixture_new_feature', ownerColumn: 'user_id', mechanism: 'ordered_delete' }))).toEqual([]);
  });

  it('fails on an unregistered child of a user table that has no user column of its own', () => {
    const added = deriveSchema(fixture(`CREATE TABLE public.fixture_version_notes (
      id uuid PRIMARY KEY, version_id uuid NOT NULL REFERENCES public.interpretation_versions(id) ON DELETE CASCADE);`));
    expect(coverageProblems(added, USER_DATA_REGISTRY)).toEqual([
      'fixture_version_notes holds user data (created in 99999999999999_fixture.sql) but is not in user-data-registry.ts',
    ]);
    expect(coverageProblems(added, withEntry({ table: 'fixture_version_notes', ownerColumn: 'version_id', mechanism: 'erase_reports_cascade' }))).toEqual([]);
  });

  it('fails when a mechanism does not hold for its table', () => {
    const replaced = (table: string, change: Partial<UserDataRegistryEntry>) =>
      USER_DATA_REGISTRY.map(e => (e.table === table ? { ...e, ...change } : e));
    // Its report_id is ON DELETE SET NULL: erase_reports keeps these rows.
    expect(coverageProblems(schema, replaced('interpretation_generation_costs', { mechanism: 'erase_reports_cascade' }))).toEqual([
      'interpretation_generation_costs is registered as erase_reports_cascade, but no ON DELETE CASCADE chain from lab_reports reaches it',
    ]);
    // stripe_customers references auth.users with no ON DELETE action.
    expect(coverageProblems(schema, replaced('stripe_customers', { mechanism: 'auth_cascade' }))).toEqual([
      'stripe_customers is registered as auth_cascade, but no ON DELETE CASCADE chain from auth.users reaches it',
    ]);
    expect(coverageProblems(schema, replaced('reminders', { ownerColumn: 'owner_id' }))).toEqual(['reminders has no column owner_id']);
    expect(coverageProblems(schema, withEntry({ table: 'fixture_gone', ownerColumn: 'user_id', mechanism: 'ordered_delete' })))
      .toEqual(['fixture_gone is registered but no migration leaves such a table']);
    expect(coverageProblems(schema, USER_DATA_REGISTRY.filter(e => e.table !== 'biomarkers'))).toEqual([
      'biomarkers holds user data (created in 20260216193045_initial_schema.sql) but is not in user-data-registry.ts',
    ]);
  });
});

describe('the current exceptions and the auth cascade are what their reasons say', () => {
  const reasonOf = (table: string) => USER_DATA_REGISTRY.find(e => e.table === table)?.reason ?? '';

  it('iap_subscriptions rides the auth.users cascade and is never erased early', () => {
    expect(fk('iap_subscriptions', 'auth.users').map(f => f.onDelete)).toEqual(['cascade']);
    expect(orderedDeletes().map(e => e.table)).not.toContain('iap_subscriptions');
    expect(reasonOf('iap_subscriptions')).toContain('20260821000000_add_iap_subscriptions.sql');
  });

  it('interpretation_generation_costs goes with the users row, and erase_reports leaves it', () => {
    expect(fk('interpretation_generation_costs', 'users').map(f => [f.columns, f.onDelete])).toEqual([[['user_id'], 'cascade']]);
    expect(fk('interpretation_generation_costs', 'lab_reports').map(f => [f.columns, f.onDelete])).toEqual([[['report_id'], 'set null']]);
    expect(orderedDeletes().at(-1)).toEqual(expect.objectContaining({ table: 'users', ownerColumn: 'id' }));
  });

  it('the Stripe step deletes exactly the Stripe exceptions, by the column the registry names', () => {
    const handler = readFileSync(new URL('../delete-user-data/index.ts', import.meta.url), 'utf8');
    const start = handler.indexOf('async deleteLocalStripeRecords(');
    const step = handler.slice(start, handler.indexOf('async deleteStorageFiles(', start));
    expect(start).toBeGreaterThan(0);
    const deleted = [...step.matchAll(/\.from\("(\w+)"\)\.delete\(\)\.eq\("(\w+)",/g)].map(m => [m[1], m[2]]);
    const stripeExceptions = USER_DATA_REGISTRY.filter(e => e.mechanism === 'exception' && e.reason?.includes('deleteLocalStripeRecords'));
    expect(deleted.sort()).toEqual(stripeExceptions.map(e => [e.table, e.ownerColumn]).sort());
    expect(stripeExceptions.map(e => e.table).sort()).toEqual(['stripe_customers', 'stripe_orders', 'stripe_subscriptions']);
    // A stripe_customers row left behind blocks deleteAuthUser instead of outliving the account.
    expect(fk('stripe_customers', 'auth.users').map(f => f.onDelete)).toEqual(['no action']);
  });

  it('ai_call_costs (PK-FIX-01b) is nulled, not erased: auth.users deletion sets user_id null, and nothing cascades it away', () => {
    expect(fk('ai_call_costs', 'auth.users').map(f => [f.columns, f.onDelete])).toEqual([[['user_id'], 'set null']]);
    // No other foreign key, so no other deletion (users, lab_reports) reaches it.
    expect(schema.get('ai_call_costs')!.fks).toHaveLength(1);
    expect(cascadesFrom(schema, 'auth.users', 'ai_call_costs')).toBe(false);
    expect(cascadesFrom(schema, 'lab_reports', 'ai_call_costs')).toBe(false);
    // Not swept early, so the month's spend the budget alert sums survives deletion.
    expect(orderedDeletes().map(e => e.table)).not.toContain('ai_call_costs');
    expect(reasonOf('ai_call_costs')).toContain('ON DELETE SET NULL');
    expect(reasonOf('ai_call_costs')).toContain('20261013050000_ai_cost_ledger.sql');
    // The budget alert log holds no user data at all.
    expect(userOwnedTables(schema).has('ai_budget_alerts')).toBe(false);
  });

  it('PK-HARM-01: interpretation_feedback is user data, swept by user_id, and also goes with its report and its account', () => {
    expect(userOwnedTables(schema).has('interpretation_feedback')).toBe(true);
    expect(USER_DATA_REGISTRY.find(e => e.table === 'interpretation_feedback'))
      .toEqual(expect.objectContaining({ ownerColumn: 'user_id', mechanism: 'ordered_delete' }));
    expect(fk('interpretation_feedback', 'lab_reports').map(f => [f.columns, f.onDelete])).toEqual([[['report_id'], 'cascade']]);
    expect(fk('interpretation_feedback', 'auth.users').map(f => [f.columns, f.onDelete])).toEqual([[['user_id'], 'cascade']]);
  });

  it('deploy order: an ordered delete of a table created after the V2 runbook names the migration that creates it', () => {
    const version = (file: string) => file.slice(0, 14);
    const problems: string[] = [];
    for (const entry of orderedDeletes()) {
      const created = version(resolve(schema, entry.table)!.createdIn);
      // PK-EXP5: a mayBeUndeployed table is the other answer to the same
      // question (its absence reads as nothing to erase); it is created after
      // the V2 runbook and its reason names the migration that creates it.
      if (entry.mayBeUndeployed) {
        if (!(created > V2_RUNBOOK_LAST_MIGRATION)) problems.push(`${entry.table}: mayBeUndeployed but created in ${created}`);
        if (!entry.reason?.includes(created)) problems.push(`${entry.table}: reason does not name ${created}`);
        if (entry.requiresMigration !== undefined) problems.push(`${entry.table}: both mayBeUndeployed and requiresMigration`);
        continue;
      }
      const expected = created > V2_RUNBOOK_LAST_MIGRATION ? created : undefined;
      if (entry.requiresMigration !== expected) {
        problems.push(`${entry.table}: requiresMigration ${entry.requiresMigration} but it is created in ${created}`);
      }
    }
    expect(problems).toEqual([]);
    // Not vacuous: this packet's table is the one that needs it.
    expect(deletionDeployPrerequisites().filter(p => p.requiresMigration !== null))
      .toEqual([{ table: 'interpretation_feedback', requiresMigration: '20261015020000' },
        // PK-CONSENT-01: the consent ledger, created after the V2 runbook too.
        { table: 'consent_records', requiresMigration: '20261015040000' }]);
    expect(migrations.some(m => m.name.startsWith(V2_RUNBOOK_LAST_MIGRATION))).toBe(true);
    // The reason says the ordering in words, for whoever reads the registry.
    expect(reasonOf('interpretation_feedback')).toContain('never deploy delete-user-data');
    expect(reasonOf('interpretation_feedback')).toContain('20261015020000');
    // A malformed or misplaced declaration is a registry problem.
    expect(registryProblems([...withEntry({ table: 'x_rows', ownerColumn: 'user_id', mechanism: 'ordered_delete', requiresMigration: '2026' })]))
      .toEqual(['x_rows: requiresMigration "2026" is not a migration version']);
    expect(registryProblems([...withEntry({ table: 'x_rows', ownerColumn: 'lab_report_id', mechanism: 'erase_reports_cascade', requiresMigration: '20261015020000' })]))
      .toEqual(['x_rows: requiresMigration only applies to an ordered delete']);
    expect(registryProblems([...withEntry({ table: 'x_rows', ownerColumn: 'user_id', mechanism: 'ordered_delete',
      mayBeUndeployed: true, reason: 'fixture, created by 20261015020000', requiresMigration: '20261015020000' })]))
      .toEqual(['x_rows: mayBeUndeployed and requiresMigration contradict each other']);
  });

  it('deploy order: the owner preflight SQL file is exactly deletionPreflightSql()', () => {
    const file = readFileSync(new URL('../../../factory/sql/verify-account-deletion-tables.sql', import.meta.url), 'utf8');
    expect(file).toBe(deletionPreflightSql());
    // Every table that must exist before a deploy; a mayBeUndeployed table
    // (PK-EXP5) is not a prerequisite, so the preflight does not list it.
    for (const { table, mayBeUndeployed } of orderedDeletes()) {
      if (mayBeUndeployed) expect(file).not.toContain(`'${table}'::text`);
      else expect(file).toContain(`'${table}'::text`);
    }
    expect(orderedDeletes().filter(e => e.mayBeUndeployed).map(e => e.table)).toEqual(['app_events', 'user_attribution']);
    expect(file).toContain("(6, 'interpretation_feedback'::text, '20261015020000'::text)");
    // Read-only: outside its comments it only selects.
    const statements = file.replace(/--[^\n]*/g, '');
    expect(statements).toMatch(/^\s*select\b/i);
    expect(statements).not.toMatch(/\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|copy|call|do)\b/i);
  });

  it('PK-FIX-04: lab_file_cleanup goes with the users row, and erase_reports leaves it', () => {
    expect(fk('lab_file_cleanup', 'users').map(f => [f.columns, f.onDelete])).toEqual([[['user_id'], 'cascade']]);
    // report_id has no foreign key: the report row is deleted in the same transaction that records the file.
    expect(schema.get('lab_file_cleanup')!.fks).toHaveLength(1);
    expect(cascadesFrom(schema, 'lab_reports', 'lab_file_cleanup')).toBe(false);
    expect(orderedDeletes().map(e => e.table)).not.toContain('lab_file_cleanup');
    expect(orderedDeletes().at(-1)).toEqual(expect.objectContaining({ table: 'users', ownerColumn: 'id' }));
    expect(reasonOf('lab_file_cleanup')).toContain('20261015110000_lab_file_cleanup.sql');
  });

  it('every exception is one of the six reviewed here', () => {
    expect(USER_DATA_REGISTRY.filter(e => e.mechanism === 'exception').map(e => e.table).sort())
      .toEqual(['ai_call_costs', 'interpretation_generation_costs', 'lab_file_cleanup', 'stripe_customers', 'stripe_orders', 'stripe_subscriptions']);
  });
});
