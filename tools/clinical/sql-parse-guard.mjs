// Guards against plpgsql parse defects that only surface when the harness runs.
// plpgsql ends an IF/ELSIF condition at the first THEN outside parentheses, so a
// bare CASE expression in the condition truncates it (TASK-041 turn-5 defect,
// same class as TASK-035 turn 3). Static check here; the Docker harness also
// compiles every DO body with plpgsql's validator (see compileStatements).
import { readFileSync, readdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const clinicalSqlFiles = () => [
  'supabase/migrations/20261012000000_clinical_catalog.sql',
  'supabase/migrations/20261012000001_clinical_range_review_status.sql',
  ...readdirSync('supabase/migrations/__verification__').filter(f => /^clinical-catalog\..*\.sql$/.test(f))
    .sort().map(f => `supabase/migrations/__verification__/${f}`),
  ...readdirSync('tools/clinical').filter(f => f.endsWith('.sql.txt')).sort().map(f => `tools/clinical/${f}`),
];

// Every harness SQL file and every migration after the frozen pair, for checks
// that are static and safe to widen (the plpgsql compile list stays as above).
export const harnessSqlFiles = () => [...new Set([
  ...clinicalSqlFiles(),
  ...readdirSync('supabase/migrations').filter(f => /^\d{14}_.*\.sql$/.test(f) && f >= '20261012000002').sort()
    .map(f => `supabase/migrations/${f}`),
  ...readdirSync('supabase/migrations/__verification__').filter(f => f.endsWith('.sql')).sort()
    .map(f => `supabase/migrations/__verification__/${f}`),
])];

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

// Returns [{ line, text }] for each JSON path step directly followed by an
// arithmetic operator. `+ - * / %` bind tighter than `->`/`->>`/`#>`, so
// `j->'a' - 'b'` parses as `j -> ('a' - 'b')`: `unknown - unknown` fails only at
// execution (TASK-046 turn-2 claim-policy-gate.prelude.sql:103 defect).
// Parenthesize the path: `(j->'a') - 'b'::text`.
export function findArithmeticAfterJsonPath(sql) {
  const masked = maskSql(sql);
  const findings = [];
  for (const m of masked.matchAll(/(?:->>?|#>>?)\s*(?:[A-Za-z_][\w.]*|\d+)?\s*[-+*/%](?![->#])/g)) {
    const start = sql.lastIndexOf('\n', m.index) + 1;
    findings.push({ line: lineOf(sql, m.index), text: sql.slice(start, sql.indexOf('\n', m.index)).trim() });
  }
  return findings;
}

// System-catalog columns of type "char" (not text). `text || "char"` has no
// unique operator, so a bare one in a concatenation fails only at execution
// (TASK-046 turn-3 claim-policy-gate.snapshot.sql:7 `c.relkind` defect).
// Cast it: `c.relkind::text`.
export const CHAR_CATALOG_COLUMNS = [
  'relkind', 'relpersistence', 'relreplident', 'prokind', 'provolatile', 'proparallel',
  'typtype', 'typcategory', 'typalign', 'typstorage', 'typdelim', 'attalign', 'attstorage',
  'attidentity', 'attgenerated', 'attcompression', 'contype', 'confupdtype', 'confdeltype',
  'confmatchtype', 'tgenabled', 'polcmd', 'defaclobjtype', 'deptype', 'ev_type', 'ev_enabled',
  'castcontext', 'castmethod', 'oprkind', 'aggkind', 'amtype', 'amoppurpose', 'partstrat',
  'collprovider', 'datlocprovider', 'evtenabled', 'privtype', 'srsubstate',
];

// Returns [{ line, text }] for each bare "char" catalog column used as an
// operand of `||`. A column followed by `::` is cast and passes.
export function findCharColumnConcat(sql) {
  const masked = maskSql(sql);
  const col = `(?<![\\w."])(?:[A-Za-z_]\\w*\\.)?(?:${CHAR_CATALOG_COLUMNS.join('|')})(?![\\w"])`;
  const findings = [];
  const re = new RegExp(`\\|\\|\\s*${col}(?!\\s*::)|${col}\\s*\\|\\|`, 'gi');
  for (const m of masked.matchAll(re)) {
    const start = sql.lastIndexOf('\n', m.index) + 1;
    findings.push({ line: lineOf(sql, m.index), text: sql.slice(start, sql.indexOf('\n', m.index)).trim() });
  }
  return findings;
}

// The family: an operand whose type PostgreSQL must infer, feeding an
// overloaded operator. Each rule is one shape of it; findings carry the rule.
export function findInferredTypeOperands(sql) {
  return [
    ...findArithmeticAfterJsonPath(sql).map(f => ({ ...f, rule: 'arithmetic operator binds inside a JSON path step' })),
    ...findCharColumnConcat(sql).map(f => ({ ...f, rule: '"char" catalog column concatenated without ::text' })),
  ].sort((a, b) => a.line - b.line);
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
    const loose = harnessSqlFiles().flatMap(f => findInferredTypeOperands(readFileSync(f, 'utf8')).map(x => `${f}:${x.line}: ${x.rule}: ${x.text}`));
    if (loose.length) { console.error(`operand type left to inference at an overloaded operator:\n${loose.join('\n')}`); process.exit(1); }
  }
}
