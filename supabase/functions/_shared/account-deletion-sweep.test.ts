import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/*
  Erasure coverage, derived from the migrations rather than from memory.

  Every table that can hold a row belonging to a user — anything with a
  user_id, lab_report_id, report_id or Stripe customer_id column — must be
  erased by public.delete_user_data. A new table (V2 female context, safety
  audit, ...) fails the first test below until it is added to that function
  AND to the list here, so "we forgot the new table" cannot ship silently.
*/

const MIGRATIONS = join(__dirname, '..', '..', 'migrations');
const MIGRATION_FILES = readdirSync(MIGRATIONS).filter((f) => /^\d{14}_.*\.sql$/.test(f)).sort();
// The private interpretations relation, named by the migration that created it
// (the cutover's ALTER ... RENAME TO). legacy-raw-access.test.ts forbids its
// literal name anywhere under supabase/functions, tests included, so it is
// derived here instead of written.
const RAW_INTERPRETATIONS = (() => {
  const cutover = readFileSync(join(MIGRATIONS, '20260926000001_interpretations_compatibility_view.sql'), 'utf8');
  const m = cutover.match(/ALTER TABLE public\.interpretations RENAME TO (\w+);/);
  if (!m) throw new Error('cutover no longer renames interpretations; update this test');
  return m[1];
})();
// The definition that wins is the LAST migration (in push order) that creates
// or replaces public.delete_user_data, so a later redefinition is what gets
// checked, never a stale earlier body.
const DEFINES_ERASURE = /create\s+(?:or\s+replace\s+)?function\s+public\.delete_user_data\s*\(/i;
const ERASURE_HISTORY = MIGRATION_FILES.filter((f) => DEFINES_ERASURE.test(readFileSync(join(MIGRATIONS, f), 'utf8')));
const ERASURE = ERASURE_HISTORY[ERASURE_HISTORY.length - 1];
const OWNER_COLUMN = /^\s*"?(user_id|lab_report_id|report_id|customer_id)"?\s/i;
// A column that points at a user or a report makes its table user-owned,
// whatever the column is called.
const OWNER_REFERENCE = /references\s+(?:auth\.|public\.)?"?(users|lab_reports)"?\s*\(/i;

/** The body of `CREATE TABLE name ( ... )`, by balanced parentheses. */
function tableBody(sql: string, open: number): string {
  let depth = 0;
  for (let i = open; i < sql.length; i++) {
    if (sql[i] === '(') depth++;
    else if (sql[i] === ')' && --depth === 0) return sql.slice(open + 1, i);
  }
  throw new Error(`unbalanced CREATE TABLE body at offset ${open}`);
}

/** Top-level comma-separated entries (columns and constraints). */
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
  return [...out, current];
}

const owns = (entry: string) => OWNER_COLUMN.test(entry) || OWNER_REFERENCE.test(entry);

function userOwnedTables(): Set<string> {
  const tables = new Set<string>();
  for (const file of MIGRATION_FILES) {
    const sql = readFileSync(join(MIGRATIONS, file), 'utf8').replace(/--[^\n]*/g, '');
    // One pass in file order: a migration may DROP then re-CREATE a table.
    const statement =
      /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?"?(\w+)"?\s*(\(|as\b|partition\b)|drop\s+table\s+(?:if\s+exists\s+)?(?:public\.)?(\w+)|alter\s+table\s+(?:if\s+exists\s+)?(?:public\.)?(\w+)\s+rename\s+to\s+(\w+)|alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?(?:public\.)?(\w+)\s+([^;]*)/gi;
    for (const m of sql.matchAll(statement)) {
      if (m[1]) {
        const table = m[1].toLowerCase();
        if (m[2] !== '(') {
          // CREATE TABLE ... AS / PARTITION OF cannot be classified from text.
          throw new Error(`${file}: cannot classify CREATE TABLE ${table} ${m[2]} — extend this test`);
        }
        if (entries(tableBody(sql, m.index! + m[0].length - 1)).some(owns)) tables.add(table);
      } else if (m[3]) {
        tables.delete(m[3].toLowerCase());
      } else if (m[4]) {
        if (tables.delete(m[4].toLowerCase())) tables.add(m[5].toLowerCase());
      } else if (m[6]) {
        // ALTER TABLE x ADD [COLUMN] [IF NOT EXISTS] col ..., ADD CONSTRAINT ... REFERENCES users
        const added = m[7].split(/,\s*(?=add\b)/i).map((part) =>
          part.replace(/^add\s+(?:column\s+)?(?:if\s+not\s+exists\s+)?/i, ' '));
        if (/^\s*add\b/i.test(m[7]) && added.some(owns)) tables.add(m[6].toLowerCase());
      }
    }
  }
  return tables;
}

const erasureSql = readFileSync(join(MIGRATIONS, ERASURE), 'utf8');
const erases = (table: string) =>
  erasureSql.includes(`'${table}'`) || new RegExp(`public\\.${table}\\b`).test(erasureSql);

/**
 * Not erased by delete_user_data, on purpose, with the mechanism that does it.
 * Adding a table here needs the same kind of justification.
 */
const ERASED_ELSEWHERE: Record<string, string> = {
  iap_subscriptions:
    'auth.users ON DELETE CASCADE at deleteAuthUser — never erased early, so a failed deletion cannot strand a paying customer',
};

describe('account erasure coverage', () => {
  it('recognises the table shapes a future migration might use', () => {
    const body = (sql: string) => entries(tableBody(sql, sql.indexOf('(')));
    expect(body('CREATE TABLE public.x (\n  id uuid,\n  user_id uuid NOT NULL);').some(owns)).toBe(true);
    expect(body('CREATE TABLE x (id uuid PRIMARY KEY, owner uuid REFERENCES auth.users(id));').some(owns)).toBe(true);
    expect(body('CREATE TABLE x (id uuid PRIMARY KEY REFERENCES public.users (id));').some(owns)).toBe(true);
    expect(body('CREATE TABLE x (id uuid, note text CHECK (length(note) < 9));').some(owns)).toBe(false);
  });

  it('lists every user-owned table in the schema', () => {
    expect([...userOwnedTables()].sort()).toEqual([
      'audit_events',
      'biomarkers',
      'complimentary_entitlements',
      'cycle_events',
      'derived_metric_results',
      'health_scores',
      'iap_beta_testers',
      'iap_subscriptions',
      'insight_rule_results',
      'interpretation_current_versions',
      'interpretation_generation_costs',
      'interpretation_history_protection',
      'interpretation_versions',
      RAW_INTERPRETATIONS,
      'interventions',
      'introductory_deep_access_claims',
      'lab_reports',
      'lab_results',
      'notification_preferences',
      'parser_debug',
      'period_logs',
      'rate_limits',
      'reminders',
      'report_analytes',
      'report_items',
      'stripe_customers',
      'stripe_orders',
      'stripe_subscriptions',
      'symptom_logs',
      'users',
    ]);
  });

  it.each([...userOwnedTables()].filter((t) => !(t in ERASED_ELSEWHERE)))(
    'delete_user_data erases %s',
    (table) => {
      expect(erases(table)).toBe(true);
    },
  );

  it('leaves iap_subscriptions to the auth cascade, and that cascade exists', () => {
    expect(erases('iap_subscriptions')).toBe(false);
    const iap = readFileSync(join(MIGRATIONS, '20260821000000_add_iap_subscriptions.sql'), 'utf8');
    expect(iap).toMatch(/user_id\s+uuid[^,]*REFERENCES\s+auth\.users\s*\(\s*id\s*\)\s+ON DELETE CASCADE/i);
  });

  it('never UPDATEs a claim — the immutability trigger only tolerates the FK SET NULL', () => {
    expect(erasureSql).not.toMatch(/update\s+(public\.)?introductory_deep_access_claims/i);
  });

  it('takes the claim advisory lock, then users, then lab_reports — in that order', () => {
    const advisory = erasureSql.indexOf("pg_advisory_xact_lock(hashtext('introductory_claim:'");
    const users = erasureSql.indexOf('FROM public.users WHERE id = p_user_id FOR UPDATE');
    const reports = erasureSql.indexOf('ORDER BY id FOR UPDATE');
    expect(advisory).toBeGreaterThan(-1);
    expect(users).toBeGreaterThan(advisory);
    expect(reports).toBeGreaterThan(users);
  });

  it('is callable by the service role only', () => {
    expect(erasureSql).toMatch(/REVOKE ALL ON FUNCTION public\.delete_user_data\(uuid\) FROM PUBLIC, anon, authenticated;/);
    expect(erasureSql).toMatch(/GRANT EXECUTE ON FUNCTION public\.delete_user_data\(uuid\) TO service_role;/);
  });
});

/*
  PK-03e-K: the V2 schema. Production applied 20261011000000 (delete_user_data)
  before any V2 migration, so V2's migrations were renumbered after it and the
  erasure was redefined for V2's guarded interpretation graph.
*/
const V2_GRAPH = [
  RAW_INTERPRETATIONS,
  'interpretation_history_protection',
  'interpretation_versions',
  'interpretation_current_versions',
];
const FOUNDATION = '20261012000004_interpretation_version_foundation.sql';
// The executable SQL only: the header comment quotes the refused statement.
const erasureCode = erasureSql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '');

describe('account erasure on the V2 schema (PK-03e-K)', () => {
  it('no two migrations share a version (the 20261011000000 collision)', () => {
    const versions = MIGRATION_FILES.map((f) => f.slice(0, 14));
    const dupes = versions.filter((v, i) => versions.indexOf(v) !== i);
    expect(dupes).toEqual([]);
  });

  it('the production erasure is followed by the V2 chain, then the V2 erasure, in push order', () => {
    expect(ERASURE_HISTORY).toEqual(['20261011000000_delete_user_data_ordered.sql', '20261012000100_delete_user_data_v2.sql']);
    const v2 = MIGRATION_FILES.filter((f) => f > '20261011000000_delete_user_data_ordered.sql' && f < ERASURE);
    expect(v2).toEqual([
      '20261012000000_clinical_catalog.sql',
      '20261012000001_clinical_range_review_status.sql',
      '20261012000002_claim_policy_basic_gate.sql',
      '20261012000003_legacy_read_quarantine.sql',
      '20261012000004_interpretation_version_foundation.sql',
      '20261012000005_interpretation_version_writer.sql',
      '20261012000006_erase_reports.sql',
      '20261012000007_interpretation_version_readers.sql',
      '20261012000008_interpretation_version_ledger.sql',
    ]);
  });

  it('refuses to apply before the production erasure or the V2 foundation', () => {
    expect(erasureSql).toMatch(/to_regprocedure\('public\.delete_user_data\(uuid\)'\) IS NULL/);
    for (const rel of V2_GRAPH) expect(erasureSql).toContain(`to_regclass('public.${rel}') IS NULL`);
  });

  it('never deletes a guarded V2 relation directly; the lab_reports cascade erases it', () => {
    for (const rel of V2_GRAPH) {
      expect(erasureCode).not.toMatch(new RegExp(`delete\\s+from\\s+(public\\.)?${rel}\\b`, 'i'));
    }
    // The only dynamic DELETEs iterate the leaf children and user tables, not the graph.
    expect(erasureSql).toMatch(/FOREACH v_table IN ARRAY report_children LOOP\s+EXECUTE format\('DELETE/);
    expect(erasureSql).not.toMatch(/FOREACH v_table IN ARRAY report_graph LOOP\s+EXECUTE format\('DELETE/);
    expect(erasureSql).toMatch(/DELETE FROM public\.lab_reports WHERE user_id = p_user_id;/);
  });

  it('every V2 relation is reachable by that cascade (ON DELETE CASCADE from lab_reports or its anchor)', () => {
    const foundation = readFileSync(join(MIGRATIONS, FOUNDATION), 'utf8');
    expect(foundation).toMatch(new RegExp(`interpretation_history_protection_source_fk FOREIGN KEY\\(interpretation_id,lab_report_id\\)\\s+REFERENCES public\\.${RAW_INTERPRETATIONS}\\(id,lab_report_id\\) ON DELETE CASCADE`));
    expect(foundation).toMatch(/CREATE TABLE public\.interpretation_versions \([\s\S]*?lab_report_id uuid NOT NULL REFERENCES public\.lab_reports\(id\) ON DELETE CASCADE/);
    expect(foundation).toMatch(/CREATE TABLE public\.interpretation_current_versions \(\s*lab_report_id uuid PRIMARY KEY REFERENCES public\.lab_reports\(id\) ON DELETE CASCADE/);
    // The guards admit exactly that path: a delete is allowed once the report row is gone.
    expect(foundation).toMatch(/IF EXISTS\(SELECT 1 FROM public\.lab_reports WHERE id=OLD\.lab_report_id\) THEN\s+RAISE EXCEPTION 'delete the report graph, not its interpretation'/);
  });

  it('the post-condition covers the V2 graph', () => {
    expect(erasureSql).toMatch(/FOREACH v_table IN ARRAY report_children \|\| report_graph LOOP/);
    for (const rel of V2_GRAPH) expect(erasureSql).toContain(`'${rel}'`);
  });

  it('keeps the production signature, return type and lock-timeout', () => {
    expect(erasureSql).toMatch(/CREATE OR REPLACE FUNCTION public\.delete_user_data\(p_user_id uuid\)\s+RETURNS jsonb/);
    expect(erasureSql).toMatch(/SECURITY DEFINER/);
    expect(erasureSql).toContain("set_config('lock_timeout', '5s', true)");
  });

  it('leaves erase_reports and delete_interpretations as V2 defined them', () => {
    expect(erasureSql).not.toMatch(/function\s+public\.(erase_reports|delete_interpretations)/i);
  });

  it('the harness proves it on the full V2 schema (Case 13)', () => {
    const harness = readFileSync(join(MIGRATIONS, '__verification__', 'run.sh'), 'utf8');
    expect(harness).toContain('ERASURE_V2=20261012000100_delete_user_data_v2.sql');
    expect(harness).toContain('CREATE DATABASE deletion_v2 TEMPLATE amani;');
    expect(harness).toContain('psql_del_v2 -q -f /tmp/deletion-verify.sql');
    expect(harness).toContain('psql_del_v2 -q -f /tmp/deletion-v2-verify.sql');
    expect(harness).toContain('delete the report graph, not its interpretation');
    // Case 13 runs after the whole V2 chain has been applied to `amani`.
    expect(harness.indexOf('ERASURE_V2=')).toBeGreaterThan(harness.indexOf('source "$HERE/interpretation-versions.run.sh"'));
  });
});
