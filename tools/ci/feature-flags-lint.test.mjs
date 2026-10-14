import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lintMigrations, lintSql, main, readMigrations, scanSql, SEED_MIGRATION } from './feature-flags-lint.mjs';

// D5: only PK-CFG-01's seed writes the app_public_config features bundle.
const MIGRATIONS = fileURLToPath(new URL('../../supabase/migrations', import.meta.url));
const flagged = (sql) => lintSql(sql).map((f) => f.message);
const passes = (sql) => assert.deepEqual(lintSql(sql), [], sql);
const fails = (sql, pattern) => {
  const messages = flagged(sql);
  assert.ok(messages.length > 0, `expected a finding for:\n${sql}`);
  if (pattern) assert.match(messages.join('\n'), pattern, sql);
};
const NAMES_FEATURES = /names "features"/;
const UNSCOPED = /does not name its keys as plain literals/;

test('the real migrations pass, with PK-CFG-01\'s seed the only exemption', () => {
  const migrations = readMigrations(MIGRATIONS);
  const { checked, exempt, findings } = lintMigrations(migrations);
  assert.deepEqual(findings, []);
  assert.deepEqual(exempt, [SEED_MIGRATION]);
  assert.ok(checked.length >= 50, `only ${checked.length} migrations checked`);
});

test('not vacuous: the seed itself would be flagged under any other name', () => {
  const seed = readFileSync(join(MIGRATIONS, SEED_MIGRATION), 'utf8');
  const { findings } = lintMigrations([{ name: '20991231000000_copied_seed.sql', sql: seed }]);
  assert.ok(findings.some((f) => NAMES_FEATURES.test(f.message)), JSON.stringify(findings));
  assert.ok(findings.every((f) => f.file === '20991231000000_copied_seed.sql'));
});

test('the owner\'s enable snippet in a migration fails', () => {
  fails(`update app_public_config set value = value || '{"visit_summary":true}' where key = 'features';`, NAMES_FEATURES);
});

test('every way of writing the bundle fails', () => {
  for (const sql of [
    `INSERT INTO app_public_config (key, value) VALUES ('features', '{"x": true}') ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;`,
    `INSERT INTO "public"."app_public_config" VALUES ('features', '{}');`,
    `UPDATE public.app_public_config SET value = jsonb_set(value, '{x}', 'true') WHERE key IN ('min_version_ios', 'features');`,
    `DELETE FROM app_public_config WHERE key = 'features';`,
    `UPDATE ONLY public.app_public_config AS c SET value = '{}' WHERE c.key = 'FEATURES';`,
  ]) fails(sql, NAMES_FEATURES);
});

test('writes that cannot be shown to spare the bundle fail closed', () => {
  for (const sql of [
    `UPDATE app_public_config SET value = '{}';`,
    `UPDATE app_public_config SET value = 'null' WHERE key = 'min_version_ios' OR true;`,
    `UPDATE app_public_config SET value = 'null' WHERE key LIKE 'min_version_%';`,
    `UPDATE app_public_config SET value = 'null' WHERE key = 'feat' || 'ures';`,
    `UPDATE app_public_config SET value = 'null' WHERE key = E'\\x66eatures';`,
    `DELETE FROM app_public_config;`,
    `DELETE FROM app_public_config USING other o WHERE app_public_config.key = o.k;`,
    `INSERT INTO app_public_config (key, value) SELECT k, v FROM staging;`,
    `INSERT INTO app_public_config (value, key) VALUES ('null', lower('X'));`,
    `INSERT INTO app_public_config DEFAULT VALUES;`,
    `WITH u AS (UPDATE app_public_config SET value = '{}' RETURNING key) SELECT * FROM u;`,
  ]) fails(sql, UNSCOPED);
  for (const sql of [
    `TRUNCATE app_public_config;`,
    `TRUNCATE TABLE other_table, public.app_public_config RESTART IDENTITY;`,
    `MERGE INTO app_public_config c USING staging s ON c.key = s.key WHEN MATCHED THEN UPDATE SET value = s.value;`,
    `COPY app_public_config (key, value) FROM stdin;`,
  ]) fails(sql, /can rewrite the features bundle/);
});

test('writes inside DO blocks, function bodies and dynamic SQL are found', () => {
  fails(`DO $$ BEGIN UPDATE app_public_config SET value = '{"x":true}' WHERE key = 'features'; END $$;`, NAMES_FEATURES);
  fails(`CREATE FUNCTION public.flip() RETURNS void LANGUAGE plpgsql AS $fn$
    BEGIN
      IF true THEN
        UPDATE public.app_public_config SET value = value || jsonb_build_object(p_name, true);
      END IF;
    END $fn$;`, UNSCOPED);
  fails(`DO $$ BEGIN EXECUTE 'UPDATE app_public_config SET value = ''{}'' WHERE key = ''features'''; END $$;`, NAMES_FEATURES);
  const [finding] = lintSql(`DO $$ BEGIN EXECUTE 'DELETE FROM app_public_config'; END $$;`);
  assert.match(finding.where, /string literal \(dollar-quoted body \(top level\)\)/);
});

test('key-scoped writes of other keys pass', () => {
  passes(`INSERT INTO public.app_public_config (key, value) VALUES ('min_version_web', 'null'::jsonb) ON CONFLICT (key) DO NOTHING;`);
  passes(`INSERT INTO app_public_config VALUES ('a_key', '1'), ('b_key', '2');`);
  passes(`INSERT INTO app_public_config AS c ("value", "key") VALUES ('null', 'c_key'::text) RETURNING *;`);
  passes(`UPDATE public.app_public_config SET value = '"1.2.0"' WHERE key = 'min_version_ios';`);
  passes(`UPDATE app_public_config c SET value = 'null' WHERE c.key IN ('min_version_ios', 'min_version_android') RETURNING key;`);
  passes(`DELETE FROM app_public_config WHERE "key" = 'retired_key';`);
  passes(`DO $$ BEGIN UPDATE app_public_config SET value = 'null' WHERE key = 'min_version_android'; END $$;`);
});

test('reads, DDL, grants, policies, triggers and comments are not writes', () => {
  passes(`SELECT value FROM app_public_config WHERE key = 'features';`);
  passes(`SELECT * FROM app_public_config FOR UPDATE;`);
  passes(`ALTER TABLE public.app_public_config ADD COLUMN note text;`);
  passes(`REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.app_public_config FROM anon, authenticated;`);
  passes(`GRANT SELECT, UPDATE ON app_public_config TO service_role;`);
  passes(`CREATE POLICY p ON app_public_config FOR UPDATE TO service_role USING (key <> 'features');`);
  passes(`CREATE TRIGGER t BEFORE INSERT OR UPDATE OR DELETE ON public.app_public_config FOR EACH ROW EXECUTE FUNCTION f();`);
  passes(`COMMENT ON TABLE app_public_config IS 'The features bundle lives here.';`);
  passes(`COPY app_public_config TO stdout;`);
  passes(`-- update app_public_config set value = '{"x":true}' where key = 'features';
          /* delete from app_public_config where key = 'features'; /* nested */ still a comment */
          SELECT 1;`);
  passes(`UPDATE app_public_config_history SET value = '{}' WHERE key = 'features';`);
  passes(`UPDATE other_table SET features = '{"x": true}';`);
  passes(`INSERT INTO audit (note) VALUES ('see app_public_config');`);
});

test('text that reads as a write inside any string literal is checked as dynamic SQL (fails closed)', () => {
  // A string cannot be told apart from SQL that EXECUTE will run later, so a
  // comment or note phrased as a write must be rephrased.
  fails(`COMMENT ON TABLE x IS 'run: update app_public_config set value = ''{}'' where key = ''features''';`, NAMES_FEATURES);
  fails(`DO $$ DECLARE q text := 'DELETE FROM app_public_config'; BEGIN EXECUTE q; END $$;`, UNSCOPED);
});

test('the scanner keeps literals, identifiers and bodies apart', () => {
  const { statements, nested } = scanSql(`SELECT 'a;b', "c;d", E'it\\'s'; DO $tag$ SELECT 1; $tag$;`);
  assert.equal(statements.length, 2);
  assert.deepEqual(statements[0].literals.map((l) => [l.value, l.plain]), [['a;b', true], ["it's", false]]);
  assert.match(statements[0].text, /"c;d"/);
  assert.deepEqual(nested.map((n) => [n.kind, n.sql.trim()]),
    [['string literal', 'a;b'], ['string literal', "it's"], ['dollar-quoted body', 'SELECT 1;']]);
});

test('main exits 0 on the repository', () => {
  const lines = [];
  assert.equal(main(['--dir', MIGRATIONS], (line) => lines.push(line)), 0);
  assert.match(lines.at(-1), /^PASS/);
  assert.match(lines[0], new RegExp(`exempt as PK-CFG-01's seed: ${SEED_MIGRATION}`));
});

test('main exits 1 with a GitHub annotation per finding, and ignores files that are not migrations', () => {
  const dir = mkdtempSync(join(tmpdir(), 'feature-flags-lint-'));
  try {
    writeFileSync(join(dir, '20991231000000_enable_flag.sql'),
      `update app_public_config set value = value || '{"visit_summary":true}' where key = 'features';\n` +
      `delete from app_public_config;\n`);
    writeFileSync(join(dir, '20991231000001_fine.sql'), `insert into app_public_config (key, value) values ('other_key', 'null');\n`);
    writeFileSync(join(dir, 'notes.sql'), `delete from app_public_config where key = 'features';\n`);
    const lines = [];
    assert.equal(main(['--dir', dir], (line) => lines.push(line)), 1);
    const errors = lines.filter((line) => line.startsWith('::error '));
    assert.equal(errors.length, 2);
    assert.ok(errors.every((line) => line.startsWith(`::error file=${dir}/20991231000000_enable_flag.sql::`)), errors.join('\n'));
    assert.match(lines[0], /Checked 2 migration\(s\); exempt as PK-CFG-01's seed: none present/);
    assert.match(lines.at(-1), /^FAIL: 2 write/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
