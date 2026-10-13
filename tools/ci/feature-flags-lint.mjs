#!/usr/bin/env node
/**
 * D5 (engineering review, 2026-10-12): feature flags live in
 * public.app_public_config under the key 'features', a missing flag reads as
 * off, and the owner switches flags with SQL (docs/runtime-config.md). Only
 * PK-CFG-01's migration seeds the bundle ('{}', every flag off); no other
 * migration may write it.
 *
 *   node tools/ci/feature-flags-lint.mjs [--dir supabase/migrations]
 *
 * Reads every top-level <14-digit version>_<name>.sql migration except
 * SEED_MIGRATION. Fails (exit 1, one GitHub error annotation per finding) on
 * any statement that writes app_public_config (INSERT, UPDATE, DELETE, MERGE,
 * TRUNCATE, COPY ... FROM), wherever it sits: at top level, inside a DO block
 * or function body, or as dynamic SQL in a string literal, when either
 *   - the statement names `features`, or
 *   - it cannot be shown to touch only other keys: an INSERT must use VALUES
 *     with a plain string literal for every key, and an UPDATE or DELETE must
 *     be limited by exactly `WHERE key = '<literal>'` or
 *     `WHERE key IN ('<literal>', ...)`. Anything else fails closed.
 * Reading the table, DDL, grants, policies and triggers on it are never
 * findings.
 *
 * It is a guard against a careless write, not a proof against a determined
 * one: SQL assembled at run time (format('%I', ...), a function defined by an
 * earlier migration) is out of its reach. Run by
 * .github/workflows/feature-flags.yml on every PR into main; tested by
 * tools/ci/feature-flags-lint.test.mjs.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const MIGRATIONS_DIR = 'supabase/migrations';
/** PK-CFG-01's migration: the one place the features bundle is seeded. */
export const SEED_MIGRATION = '20261013040000_runtime_config.sql';
export const MIGRATION_FILE = /^\d{14}_[^/]+\.sql$/;

// String literals become \u0001<n>\u0002 in the masked text, so their contents
// cannot look like code there and a key literal is one recognisable token.
const OPEN = '\u0001';
const CLOSE = '\u0002';
const TABLE = String.raw`(?:(?:"public"|public)\s*\.\s*)?(?:"app_public_config"|app_public_config)(?![\w$"])`;
const WRITES = [
  ['INSERT', String.raw`\binsert\s+into\s+${TABLE}`],
  ['UPDATE', String.raw`\bupdate\s+(?:only\s+)?${TABLE}`],
  ['DELETE', String.raw`\bdelete\s+from\s+(?:only\s+)?${TABLE}`],
  ['MERGE', String.raw`\bmerge\s+into\s+(?:only\s+)?${TABLE}`],
  ['TRUNCATE', String.raw`\btruncate\s+(?:table\s+)?(?:only\s+)?(?:[\w."$]+\s*,\s*)*${TABLE}`],
  ['COPY', String.raw`\bcopy\s+${TABLE}(?:\s*\([^()]*\))?\s+from\b`],
].map(([verb, source]) => ({ verb, re: new RegExp(source, 'gi') }));
const LITERAL = String.raw`${OPEN}(\d+)${CLOSE}(?:\s*::\s*text)?`;
const KEY_CONDITION = new RegExp(
  String.raw`^\s*(?:(?:[\w$]+|"[^"]+")\s*\.\s*){0,2}(?:key|"key")\s*` +
  String.raw`(?:=\s*${LITERAL}|in\s*\(\s*${LITERAL}(?:\s*,\s*${LITERAL})*\s*\))\s*$`, 'i');

/**
 * Splits SQL into statements with comments removed. Each statement keeps its
 * text (string literals verbatim) and a masked copy (literals replaced by
 * numbered tokens). Dollar-quoted bodies and string literals are returned in
 * `nested`, to be read as SQL in their own right.
 */
export function scanSql(sql) {
  const statements = [];
  const nested = [];
  let text = '';
  let masked = '';
  let literals = [];
  const flush = () => {
    if (text.trim()) statements.push({ text: text.trim(), masked: masked.trim(), literals });
    text = '';
    masked = '';
    literals = [];
  };
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    if (ch === '-' && sql[i + 1] === '-') {
      const end = sql.indexOf('\n', i);
      i = end < 0 ? sql.length : end;
      text += ' ';
      masked += ' ';
    } else if (ch === '/' && sql[i + 1] === '*') {
      let depth = 1;
      let j = i + 2;
      while (j < sql.length && depth > 0) {
        if (sql.startsWith('/*', j)) { depth += 1; j += 2; } else if (sql.startsWith('*/', j)) { depth -= 1; j += 2; } else j += 1;
      }
      i = j;
      text += ' ';
      masked += ' ';
    } else if (ch === "'") {
      // E'...' strings take backslash escapes; '' is a quote in every string.
      const escapes = /[eE]/.test(sql[i - 1] ?? '') && !/[\w$]/.test(sql[i - 2] ?? '');
      let j = i + 1;
      let value = '';
      while (j < sql.length) {
        if (escapes && sql[j] === '\\') { value += sql[j + 1] ?? ''; j += 2; continue; }
        if (sql[j] === "'") {
          if (sql[j + 1] === "'") { value += "'"; j += 2; continue; }
          break;
        }
        value += sql[j];
        j += 1;
      }
      text += sql.slice(i, j + 1);
      masked += `${OPEN}${literals.length}${CLOSE}`;
      literals.push({ value, plain: !escapes && !/&$/.test(sql.slice(Math.max(0, i - 2), i)) });
      nested.push({ kind: 'string literal', sql: value });
      i = j + 1;
    } else if (ch === '"') {
      let j = i + 1;
      while (j < sql.length && !(sql[j] === '"' && sql[j + 1] !== '"')) j += sql[j] === '"' ? 2 : 1;
      text += sql.slice(i, j + 1);
      masked += sql.slice(i, j + 1);
      i = j + 1;
    } else if (ch === '$' && !/[\w$]/.test(sql[i - 1] ?? '') && /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/.test(sql.slice(i, i + 65))) {
      const tag = /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i, i + 65))[0];
      const close = sql.indexOf(tag, i + tag.length);
      const end = close < 0 ? sql.length : close;
      nested.push({ kind: 'dollar-quoted body', sql: sql.slice(i + tag.length, end) });
      text += ' $body$ ';
      masked += ' $body$ ';
      i = close < 0 ? sql.length : close + tag.length;
    } else if (ch === ';') {
      flush();
      i += 1;
    } else {
      text += ch;
      masked += ch;
      i += 1;
    }
  }
  flush();
  return { statements, nested };
}

/** The masked clause from `start` up to an unbalanced ')' (the end of a CTE) or the end. */
function clauseFrom(masked, start) {
  let depth = 0;
  for (let i = start; i < masked.length; i++) {
    if (masked[i] === '(') depth += 1;
    else if (masked[i] === ')' && --depth < 0) return masked.slice(start, i);
  }
  return masked.slice(start);
}

/** Index of a top-level keyword (outside parentheses) in a masked clause, or -1. */
function topLevel(clause, keyword, from = 0) {
  const re = new RegExp(String.raw`\b${keyword}\b`, 'gi');
  re.lastIndex = from;
  for (let m; (m = re.exec(clause));) {
    let depth = 0;
    for (let i = 0; i < m.index; i++) {
      if (clause[i] === '(') depth += 1;
      else if (clause[i] === ')') depth -= 1;
    }
    if (depth === 0) return m.index;
  }
  return -1;
}

const plainLiteral = (literals, token) => {
  const m = new RegExp(`^${LITERAL}$`).exec(token.trim());
  return m !== null && literals[Number(m[1])]?.plain === true;
};

/** Comma-separated items at depth 0 of a parenthesised list starting at `open`; returns [items, index after ')']. */
function parenList(clause, open) {
  const items = [];
  let depth = 0;
  let current = '';
  for (let i = open; i < clause.length; i++) {
    const ch = clause[i];
    if (ch === '(') { depth += 1; if (depth === 1) continue; }
    if (ch === ')') { depth -= 1; if (depth === 0) { items.push(current); return [items, i + 1]; } }
    if (ch === ',' && depth === 1) { items.push(current); current = ''; continue; }
    current += ch;
  }
  return [null, clause.length];
}

/** Does this INSERT give every row a plain string-literal key? */
function insertIsKeyScoped(clause, literals) {
  const head = new RegExp(String.raw`^insert\s+into\s+${TABLE}(?:\s+(?:as\s+)?(?!values\b|select\b|default\b|overriding\b|with\b)(?:[\w$]+|"[^"]+"))?\s*`, 'i').exec(clause);
  if (!head) return false;
  let at = head[0].length;
  let keyIndex = 0;
  if (clause[at] === '(') {
    const [columns, after] = parenList(clause, at);
    if (!columns) return false;
    keyIndex = columns.map(c => c.trim().replace(/^"|"$/g, '').toLowerCase()).indexOf('key');
    if (keyIndex < 0) return false;
    at = after;
  }
  const values = /^\s*(?:overriding\s+\w+\s+value\s+)?values\s*/i.exec(clause.slice(at));
  if (!values) return false;
  at += values[0].length;
  for (;;) {
    if (clause[at] !== '(') return false;
    const [row, after] = parenList(clause, at);
    if (!row || keyIndex >= row.length || !plainLiteral(literals, row[keyIndex])) return false;
    const comma = /^\s*,\s*/.exec(clause.slice(after));
    if (!comma) return /^\s*(?:$|on\s+conflict\b|returning\b)/i.test(clause.slice(after));
    at = after + comma[0].length;
  }
}

/** Is this UPDATE or DELETE limited by exactly `key = '<literal>'` or `key IN ('<literal>', ...)`? */
function whereIsKeyScoped(clause, literals) {
  const where = topLevel(clause, 'where');
  if (where < 0) return false;
  const returning = topLevel(clause, 'returning', where);
  const condition = clause.slice(where + 'where'.length, returning < 0 ? undefined : returning);
  const m = KEY_CONDITION.exec(condition);
  if (!m) return false;
  const tokens = [...condition.matchAll(new RegExp(`${OPEN}(\\d+)${CLOSE}`, 'g'))];
  return tokens.every(t => literals[Number(t[1])]?.plain === true);
}

function judge(statement, verb, start) {
  if (/\bfeatures\b/i.test(statement.text)) {
    return `${verb} on app_public_config names "features": only PK-CFG-01 seeds the features bundle; ` +
      'the owner switches flags with SQL, never in a migration (D5)';
  }
  if (verb !== 'INSERT' && verb !== 'UPDATE' && verb !== 'DELETE') {
    return `${verb} on app_public_config can rewrite the features bundle; only PK-CFG-01 seeds it (D5)`;
  }
  const clause = clauseFrom(statement.masked, start);
  const scoped = verb === 'INSERT' ? insertIsKeyScoped(clause, statement.literals) : whereIsKeyScoped(clause, statement.literals);
  if (scoped) return null;
  return `${verb} on app_public_config does not name its keys as plain literals, so it cannot be shown to leave ` +
    'the features bundle alone (D5). Use INSERT ... VALUES (\'<key>\', ...) or WHERE key = \'<key>\'';
}

/** Findings for one SQL text, its bodies and its string literals. */
export function lintSql(sql, where = 'top level') {
  const { statements, nested } = scanSql(sql);
  const findings = [];
  for (const statement of statements) {
    for (const { verb, re } of WRITES) {
      re.lastIndex = 0;
      for (const m of statement.masked.matchAll(re)) {
        const message = judge(statement, verb, m.index);
        if (message) {
          const preview = statement.text.replace(/\s+/g, ' ').slice(0, 160);
          findings.push({ where, message, statement: preview });
        }
      }
    }
  }
  for (const inner of nested) findings.push(...lintSql(inner.sql, `${inner.kind} (${where})`));
  return findings;
}

/**
 * @param {Array<{ name: string, sql: string }>} migrations
 * @returns {{ checked: string[], exempt: string[], findings: Array<{ file: string, where: string, message: string, statement: string }> }}
 */
export function lintMigrations(migrations, seed = SEED_MIGRATION) {
  const checked = [];
  const exempt = [];
  const findings = [];
  for (const { name, sql } of [...migrations].sort((a, b) => a.name.localeCompare(b.name))) {
    if (name === seed) { exempt.push(name); continue; }
    checked.push(name);
    for (const finding of lintSql(sql)) findings.push({ file: name, ...finding });
  }
  return { checked, exempt, findings };
}

/** Top-level migration files of a directory, with their SQL. */
export function readMigrations(dir = MIGRATIONS_DIR) {
  return readdirSync(dir).filter(name => MIGRATION_FILE.test(name)).sort()
    .map(name => ({ name, sql: readFileSync(join(dir, name), 'utf8') }));
}

function option(argv, name, fallback) {
  const index = argv.indexOf(name);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
}

export function main(argv = process.argv.slice(2), log = console.log) {
  const dir = option(argv, '--dir', MIGRATIONS_DIR);
  const { checked, exempt, findings } = lintMigrations(readMigrations(dir));
  log(`Checked ${checked.length} migration(s); exempt as PK-CFG-01's seed: ${exempt.join(', ') || 'none present'}.`);
  for (const f of findings) {
    log(`::error file=${dir}/${f.file}::${f.message}. In the ${f.where}: ${f.statement}`);
  }
  if (findings.length > 0) {
    log(`FAIL: ${findings.length} write(s) to the features bundle, or unscoped write(s) to app_public_config, ` +
      'in a migration (D5). Turn flags on with the SQL in docs/runtime-config.md. If this is PK-CFG-01\'s own ' +
      'seed renumbered under D6, update SEED_MIGRATION in tools/ci/feature-flags-lint.mjs.');
    return 1;
  }
  log('PASS: no migration but PK-CFG-01\'s seed writes the features bundle (D5).');
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) process.exitCode = main();
