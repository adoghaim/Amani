import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { readCatalog, renderCatalog, projectEntries } from './generate.mjs';
import { renderSql, sqlPayload, migrationArtifact, stableJson } from './sql.mjs';
import { validateCatalog, validateSchema } from './validate.mjs';

test('replacement metacharacters survive generation literally', () => {
  const c = structuredClone(readCatalog());
  c.analytes[0].aliases.push("$& $` $' $$");
  assert.ok(renderCatalog(c).includes(JSON.stringify("$& $` $' $$")));
});
test('prototype keys cannot evade additionalProperties', () => {
  for (const key of ['constructor', 'toString', '__proto__']) {
    assert.throws(() => validateSchema(JSON.parse(`{"${key}":1}`), { type: 'object', properties: {}, additionalProperties: false }), /unknown field/);
  }
});
test('whitespace evidence and malformed review dates fail closed', () => {
  for (const patch of [
    { evidence_grade: 'A', source: ' \t\n', source_date: '2026-10-06' },
    { reviewed_at: 'yesterday' },
    { population: 'invented_population' },
  ]) {
    const c = structuredClone(readCatalog());
    Object.assign(c.analytes[0].ranges[0], patch);
    assert.throws(() => validateCatalog(c));
  }
});
test('DISPUTED candidates are retained in SQL and excluded from the shipping API', () => {
  const c = structuredClone(readCatalog());
  c.analytes[0].ranges.push({ ...c.analytes[0].ranges[0], min: 1, max: 2, review_status: 'DISPUTED', candidate_id: 'historical_alternative' });
  assert.equal(validateCatalog(c), c);
  assert.equal(renderCatalog(c), renderCatalog());
  assert.equal(sqlPayload(c).ranges.filter(r => r.review_status === 'DISPUTED').length, 1);
});
test('unit joins require approved explicit factors and refuse missing evidence', () => {
  const c = readCatalog();
  assert.equal(c.analytes.filter(a => a.legacy_key).length, 5);
  for (const a of c.analytes.filter(a => a.legacy_key)) {
    assert.equal(a.unit_mapping.legacy_unit, 'cells/uL');
    assert.equal(a.unit_mapping.registry_unit, 'K/uL');
    assert.equal(a.unit_mapping.legacy_to_registry_factor, 0.001);
    const copy = structuredClone(c);
    copy.analytes.find(b => b.slug === a.slug).unit_mapping.legacy_to_registry_factor = 1;
    assert.throws(() => validateCatalog(copy), /unapproved unit/);
  }
  for (const slug of ['tsh', 'rbc']) assert.equal(c.analytes.find(a => a.slug === slug).unit_mapping.legacy_to_registry_factor, 1);
  for (const slug of ['chol_hdl_ratio', 'albumin_globulin_ratio', 'bun_creatinine_ratio']) {
    const entry = sqlPayload(c).entries.find(a => a.slug === slug);
    assert.equal(entry.registry_slug, null);
    assert.equal(entry.legacy_to_registry_factor, null);
  }
});
test('snapshot cardinalities, absent extraction identities and SQL/client ranges agree', () => {
  const c = readCatalog();
  const sql = sqlPayload(c);
  assert.equal(sql.registry.length, 81);
  assert.equal(sql.synonyms.length, 224);
  assert.equal(sql.metadata.length, 76);
  assert.equal(sql.ranges.length, 198);
  for (const slug of ['rheumatoid_factor', 'ana_screen']) assert.equal(sql.registry.some(a => a.slug === slug), false);
  const entries = projectEntries(c);
  for (const row of sql.ranges) {
    const mapping = sql.entries.find(a => a.slug === row.slug);
    const entry = entries.find(a => a.key === mapping.legacy_key);
    const band = (row.phase === null ? entry : entry.phaseRanges[row.phase])[row.kind === 'amani_context' ? 'optimal' : 'clinical'];
    assert.deepEqual({ min: row.min, max: row.max }, band);
    assert.equal(row.unit, entry.defaultUnit);
  }
});
test('SQL generation is deterministic including reordered keys and checked-in artifacts', () => {
  const c = readCatalog();
  const reordered = JSON.parse(JSON.stringify(c), (_key, v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).reverse()) : v);
  assert.deepEqual(renderSql(c), renderSql(reordered));
  for (const [name, content] of Object.entries(renderSql(c))) assert.equal(readFileSync(name, 'utf8'), content);
  assert.equal(stableJson({ b: 2, a: 1 }), '{"a":1,"b":2}');
});
test('SQL drift is rejected without overwriting the hand edit', () => {
  const original = readFileSync(migrationArtifact, 'utf8');
  try {
    writeFileSync(migrationArtifact, original + '-- drift probe\n');
    const result = spawnSync(process.execPath, ['tools/clinical/generate.mjs', '--check'], { encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /drifted/);
    assert.equal(readFileSync(migrationArtifact, 'utf8'), original + '-- drift probe\n');
  } finally { writeFileSync(migrationArtifact, original); }
});

test('SQL literals retain quotes, replacement markers and dollar delimiters', () => {
  const c = structuredClone(readCatalog());
  const text = "__HASH__ __PAYLOAD__ __CLIENT_RANGES__ $clinical$ $& $` $' $$ \\";
  c.analytes[0].aliases.push(text);
  const sql = renderSql(c)[migrationArtifact];
  assert.ok(sql.includes(JSON.stringify(text).slice(1, -1).replaceAll("'", "''")));
  assert.match(sql, /DO \$clinical_[a-f0-9]{64}\$/);
});
