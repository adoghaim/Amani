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
const ERASURE = '20261011000000_delete_user_data_ordered.sql';
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
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
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
      'interpretation_generation_costs',
      'interpretations_private',
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
