import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { clinicalSqlFiles, compileStatements, findArithmeticAfterJsonPath, findBareCaseInIf, findCharColumnConcat,
  findInferredTypeOperands, harnessSqlFiles, maskSql }
  from './sql-parse-guard.mjs';

test('no clinical SQL file has an unparenthesized CASE in an IF condition', () => {
  const files = clinicalSqlFiles();
  assert.ok(files.includes('supabase/migrations/__verification__/clinical-catalog.verify.sql'));
  assert.ok(files.includes('tools/clinical/migration.sql.txt'));
  for (const file of files) assert.deepEqual(findBareCaseInIf(readFileSync(file, 'utf8')), [], file);
});
test('the turn-5 verify.sql defect is detected and its parenthesized fix is not', () => {
  const defect = `IF st.absent_legacy <> CASE st.mode WHEN 'production' THEN '{}'::text[] WHEN 'chain' THEN ARRAY['x']
    ELSE ARRAY['y'] END
    THEN RAISE EXCEPTION 'bad'; END IF;`;
  assert.equal(findBareCaseInIf(defect).length, 1);
  assert.equal(findBareCaseInIf(defect.replace('<> CASE', '<> (CASE').replace('END\n    THEN', 'END)\n    THEN')).length, 0);
  assert.equal(findBareCaseInIf('ELSIF x = CASE WHEN y THEN 1 END THEN NULL; END IF;').length, 1);
});
test('the guard flags the real turn-5 verify.sql (271d4f8) at its defective line', (t) => {
  const old = spawnSync('git', ['show', '271d4f8:supabase/migrations/__verification__/clinical-catalog.verify.sql'], { encoding: 'utf8' });
  if (old.status !== 0) { t.skip('commit 271d4f8 not in this checkout (shallow clone)'); return; }
  assert.deepEqual(findBareCaseInIf(old.stdout).map(f => f.line), [43]);
});
test('the guard ignores CASE outside IF conditions, in strings, comments and DDL IFs', () => {
  for (const sql of [
    "run_mode := CASE WHEN a THEN 'x' END; IF run_mode IS NULL THEN NULL; END IF;",
    "IF (SELECT CASE WHEN a THEN 1 END) = 1 THEN NULL; END IF;",
    "IF x = 'CASE' THEN NULL; END IF; -- IF y = CASE",
    "CREATE INDEX IF NOT EXISTS i ON t(c); SELECT CASE WHEN a THEN 1 END;",
    "EXECUTE 'IF a = CASE WHEN b THEN 1 END THEN'; END IF;",
  ]) assert.deepEqual(findBareCaseInIf(sql), [], sql);
  assert.equal(maskSql("a 'it''s' b").length, "a 'it''s' b".length);
});
test('compile step wraps every DO body in the clinical SQL for plpgsql validation', () => {
  const verify = readFileSync('supabase/migrations/__verification__/clinical-catalog.verify.sql', 'utf8');
  const out = compileStatements('verify', verify, 3);
  assert.equal((out.match(/CREATE FUNCTION pg_temp\.task041_parse_3_\d+\(\)/g) ?? []).length, 3);
  const all = spawnSync(process.execPath, ['tools/clinical/sql-parse-guard.mjs', '--compile-sql'], { encoding: 'utf8' });
  assert.equal(all.status, 0, all.stderr);
  assert.match(all.stdout, /^\\set ON_ERROR_STOP on\nSET check_function_bodies = on;\nBEGIN;\n/);
  assert.match(all.stdout, /ROLLBACK;\n$/);
  for (const file of ['supabase/migrations/20261012000000_clinical_catalog.sql',
    'supabase/migrations/__verification__/clinical-catalog.rollback.sql',
    'supabase/migrations/__verification__/clinical-catalog.verify.sql']) assert.ok(all.stdout.includes(`parse-check ${file} DO#1`), file);
  const names = all.stdout.match(/pg_temp\.task041_parse_\d+_\d+/g) ?? [];
  assert.equal(new Set(names).size, names.length);
});
test('arithmetic after a JSON path step is flagged; parenthesized paths, chains and comparisons are not', () => {
  for (const sql of ["SELECT e.c->'claim_preview' - 'claim';", "SELECT j->>'n' + 1;", "SELECT j->k * 2;",
    "SELECT j#>'{a,b}' - 'c';", "SELECT j->'a'\n  - 'b';"]) assert.equal(findArithmeticAfterJsonPath(sql).length, 1, sql);
  for (const sql of ["SELECT (e.c->'claim_preview') - 'claim'::text;", "SELECT j->'a'->>'b';", "SELECT j->'a'#>'{b}';",
    "SELECT j->>'a' = 'x' AND j->'b' || '{}'::jsonb;", "SELECT (j->>'n')::numeric - 1;", "SELECT j - 'a' - 'b';",
    "SELECT j->'a'; -- j->'a' - 'b'", "SELECT 'j->a - b';"]) assert.deepEqual(findArithmeticAfterJsonPath(sql), [], sql);
});
test('the guard flags the real turn-2 claim-policy-gate prelude (d9f913a) at its defective line', (t) => {
  const old = spawnSync('git', ['show', 'd9f913a:supabase/migrations/__verification__/claim-policy-gate.prelude.sql'], { encoding: 'utf8' });
  if (old.status !== 0) { t.skip('commit d9f913a not in this checkout (shallow clone)'); return; }
  assert.deepEqual(findArithmeticAfterJsonPath(old.stdout).map(f => f.line), [103]);
});
test('the inferred-operand family check covers every harness SQL file and the claim gate migration', () => {
  const files = harnessSqlFiles();
  for (const name of ['supabase/migrations/20261012000002_claim_policy_basic_gate.sql',
    'supabase/migrations/__verification__/claim-policy-gate.prelude.sql',
    'supabase/migrations/__verification__/prelude.sql',
    'supabase/migrations/__verification__/clinical-catalog.verify.sql']) assert.ok(files.includes(name), name);
  for (const file of files) assert.deepEqual(findInferredTypeOperands(readFileSync(file, 'utf8')), [], file);
});
test('a bare "char" catalog column in || is flagged; cast, compared and quoted uses are not', () => {
  for (const sql of ["SELECT 'r:'||c.relkind||'|';", "SELECT 'k:' || prokind;", "SELECT c.relpersistence || 'x';",
    "SELECT 'a'||\n  t.typtype;", "SELECT x || RELKIND;"]) assert.equal(findCharColumnConcat(sql).length, 1, sql);
  for (const sql of ["SELECT 'r:'||c.relkind::text||'|';", "SELECT 'k:' || prokind :: text;", "SELECT c.relkind = 'r';",
    "SELECT c.relkind IN ('r','v') AND 'a'||'b' = x;", "SELECT 'a' || my_relkind;", "SELECT 'a' || c.relkind_note;",
    "SELECT 'x'; -- 'a'||c.relkind", "SELECT 'a||relkind';", "SELECT 'public.' || name;", "SELECT 'a' || \"relkind\";"])
    assert.deepEqual(findCharColumnConcat(sql), [], sql);
});
test('the family check reports both shapes with their rule', () => {
  const found = findInferredTypeOperands("SELECT 'r:'||c.relkind;\nSELECT j->'a' - 'b';");
  assert.deepEqual(found.map(f => [f.line, f.rule]), [
    [1, '"char" catalog column concatenated without ::text'], [2, 'arithmetic operator binds inside a JSON path step']]);
});
test('the guard flags the real turn-3 claim-policy-gate snapshot (a9e082b) at its defective line', (t) => {
  const old = spawnSync('git', ['show', 'a9e082b:supabase/migrations/__verification__/claim-policy-gate.snapshot.sql'], { encoding: 'utf8' });
  if (old.status !== 0) { t.skip('commit a9e082b not in this checkout (shallow clone)'); return; }
  assert.deepEqual(findInferredTypeOperands(old.stdout).map(f => f.line), [7]);
  assert.deepEqual(findArithmeticAfterJsonPath(old.stdout), [], 'the turn-3 one-shape rule alone missed it');
});
test('the static guard passes on the working tree', () => {
  const run = spawnSync(process.execPath, ['tools/clinical/sql-parse-guard.mjs'], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
});
