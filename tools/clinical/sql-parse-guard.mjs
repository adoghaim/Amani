// Guards against plpgsql parse defects that only surface when the harness runs.
// plpgsql ends an IF/ELSIF condition at the first THEN outside parentheses, so a
// bare CASE expression in the condition truncates it (TASK-041 turn-5 defect,
// same class as TASK-035 turn 3). Static check here; the Docker harness also
// compiles every DO body with plpgsql's validator (see compileStatements).
import { readFileSync, readdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const clinicalSqlFiles = () => [
  'supabase/migrations/20261006000000_clinical_catalog.sql',
  ...readdirSync('supabase/migrations/__verification__').filter(f => /^clinical-catalog\..*\.sql$/.test(f))
    .sort().map(f => `supabase/migrations/__verification__/${f}`),
  ...readdirSync('tools/clinical').filter(f => f.endsWith('.sql.txt')).sort().map(f => `tools/clinical/${f}`),
];

// Blank out comments and single-quoted literals (keeping offsets and newlines),
// so keywords inside dynamic SQL strings or the JSON payload are not scanned.
export function maskSql(sql) {
  let out = '';
  for (let i = 0; i < sql.length;) {
    if (sql.startsWith('--', i)) {
      const end = sql.indexOf('\n', i);
      const stop = end < 0 ? sql.length : end;
      out += ' '.repeat(stop - i); i = stop;
    } else if (sql[i] === "'") {
      let j = i + 1;
      while (j < sql.length && !(sql[j] === "'" && sql[j + 1] !== "'")) j += sql[j] === "'" ? 2 : 1;
      out += sql.slice(i, j + 1).replace(/[^\n]/g, ' '); i = j + 1;
    } else { out += sql[i]; i += 1; }
  }
  return out;
}

const lineOf = (sql, index) => sql.slice(0, index).split('\n').length;

// Returns [{ line, text }] for each IF/ELSIF whose condition holds a CASE at
// parenthesis depth 0. Non-control IFs (IF EXISTS in DDL) reach ';' first.
export function findBareCaseInIf(sql) {
  const masked = maskSql(sql);
  const findings = [];
  for (const m of masked.matchAll(/\b(ELSIF|IF)\b/gi)) {
    if (/\bEND\s*$/i.test(masked.slice(Math.max(0, m.index - 40), m.index))) continue;
    let depth = 0;
    const tokens = /\(|\)|;|\bTHEN\b|\bCASE\b/gi;
    tokens.lastIndex = m.index + m[0].length;
    for (let t; (t = tokens.exec(masked));) {
      const word = t[0].toUpperCase();
      if (word === '(') depth += 1;
      else if (word === ')') depth -= 1;
      else if (depth > 0) continue;
      else if (word === ';' || word === 'THEN') break;
      else if (word === 'CASE') {
        findings.push({ line: lineOf(sql, m.index), text: sql.slice(m.index, sql.indexOf('\n', m.index)).trim() });
        break;
      }
    }
  }
  return findings;
}

// Every DO body as a plpgsql function definition. CREATE FUNCTION runs
// plpgsql_validator, which parses the body and its embedded SQL without
// executing it or resolving tables, so a syntax error fails here by file name.
export function compileStatements(file, sql, fileIndex = 0) {
  const bodies = [...sql.matchAll(/\bDO\s+(\$[A-Za-z0-9_]*\$)([\s\S]*?)\1/g)];
  if (bodies.length === 0) return '';
  return bodies.map(([, tag, body], n) =>
    `\\echo parse-check ${file} DO#${n + 1}\nCREATE FUNCTION pg_temp.task041_parse_${fileIndex}_${n}() RETURNS void LANGUAGE plpgsql AS ${tag}${body}${tag};\n`).join('');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // --compile-sql: emit one transaction that validates every DO body, then rolls back.
  const files = clinicalSqlFiles().filter(f => !f.endsWith('.sql.txt'));
  if (process.argv.includes('--compile-sql')) {
    process.stdout.write('\\set ON_ERROR_STOP on\nSET check_function_bodies = on;\nBEGIN;\n'
      + files.map((f, i) => compileStatements(f, readFileSync(f, 'utf8'), i)).join('') + 'ROLLBACK;\n');
  } else {
    const bad = clinicalSqlFiles().flatMap(f => findBareCaseInIf(readFileSync(f, 'utf8')).map(x => `${f}:${x.line}: ${x.text}`));
    if (bad.length) { console.error(`unparenthesized CASE in IF condition:\n${bad.join('\n')}`); process.exit(1); }
  }
}
