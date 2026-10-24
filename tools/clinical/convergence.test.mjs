import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { readCatalog, renderCatalog, renderContext, projectEntries, projectUnitEquivalences } from './generate.mjs';
import { renderSql, renderReviewSql, sqlPayload, migrationArtifact, stableJson } from './sql.mjs';
import { validateCatalog, validateSchema, APPROVED_UNIT_EQUIVALENCES } from './validate.mjs';

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
test('DISPUTED candidates remain in the seed and are excluded from frozen SQL and the shipping API', () => {
  const c = structuredClone(readCatalog());
  c.analytes[0].ranges.push({ ...c.analytes[0].ranges[0], min: 1, max: 2, review_status: 'DISPUTED', candidate_id: 'historical_alternative' });
  assert.equal(validateCatalog(c), c);
  assert.equal(renderCatalog(c), renderCatalog());
  assert.deepEqual(sqlPayload(c), sqlPayload(readCatalog()));
  assert.equal(c.analytes[0].ranges.at(-1).candidate_id, 'historical_alternative');
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
// Review-2 of RV-CS1, owner decision 2026-10-23: 1:1 unit identities, scoped per analyte.
test('unit equivalences are owner-approved identities for exactly the approved analytes', () => {
  const c = readCatalog();
  assert.deepEqual(c.unit_equivalences.map(e => [e.slug, e.unit, e.canonical_unit]), APPROVED_UNIT_EQUIVALENCES);
  for (const e of c.unit_equivalences) {
    assert.equal(e.factor, 1);
    assert.equal(e.canonical_unit, c.analytes.find(a => a.slug === e.slug).canonical_unit);
    assert.deepEqual([e.approved_by, e.approved_at, e.decision], ['owner', '2026-10-23', 'Approve the equivalences (Recommended)']);
    assert.deepEqual([e.reviewer, e.reviewed_at], [null, null]);
    assert.match(e.basis, /^Definitional unit identity/);
  }
  assert.deepEqual(projectUnitEquivalences(c), APPROVED_UNIT_EQUIVALENCES.map(([key, unit, canonicalUnit]) => ({ key, unit, canonicalUnit })));
  assert.ok(renderContext(c).includes('export const UNIT_EQUIVALENCES'));
  const template = { slug: 'sodium', unit: 'mmol/L', canonical_unit: 'mEq/L', factor: 1, basis: 'b', approved_by: 'owner',
    approved_at: '2026-10-23', decision: 'd', decision_ref: 'r', reviewer: null, reviewed_at: null };
  for (const { mutate, error } of [
    // mEq/L = mmol/L is for monovalent ions only; IU/L = U/L only for ALT, AST, ALP.
    { mutate: c => c.unit_equivalences.push({ ...template, slug: 'calcium', canonical_unit: 'mg/dL', unit: 'mEq/L' }), error: /unapproved unit equivalence/ },
    { mutate: c => c.unit_equivalences.push({ ...template, slug: 'magnesium', canonical_unit: 'mg/dL', unit: 'mEq/L' }), error: /unapproved unit equivalence/ },
    { mutate: c => c.unit_equivalences.push({ ...template, slug: 'ggt', canonical_unit: 'U/L', unit: 'IU/L' }), error: /unapproved unit equivalence/ },
    { mutate: c => c.unit_equivalences.push({ ...template, slug: 'fasting_glucose', canonical_unit: 'mg/dL', unit: 'mmol/L' }), error: /unapproved unit equivalence/ },
    { mutate: c => c.unit_equivalences.pop(), error: /unapproved unit equivalence/ },
    { mutate: c => { c.unit_equivalences[0].factor = 2; }, error: /unexpected constant/ },
    { mutate: c => { c.unit_equivalences[0].canonical_unit = 'mmol/L'; }, error: /canonical unit/ },
    { mutate: c => { c.unit_equivalences[0].slug = 'not_an_analyte'; }, error: /unknown analyte/ },
    { mutate: c => { c.unit_equivalences[0].reviewer = 'Invented reviewer'; }, error: /cannot assign clinical review/ },
    { mutate: c => { c.unit_equivalences[0].basis = ' '; }, error: /needs basis/ },
    { mutate: c => { c.unit_equivalences[0].approved_by = 'implementer'; }, error: /unexpected enum/ },
    { mutate: c => c.unit_equivalences.push({ ...c.unit_equivalences[0] }), error: /duplicate unit equivalence/ },
    { mutate: c => { delete c.unit_equivalences; }, error: /missing unit_equivalences/ },
  ]) {
    const copy = structuredClone(c);
    mutate(copy);
    assert.throws(() => validateCatalog(copy), error);
  }
});
test('unit equivalences change no frozen SQL and no shipping dictionary value', () => {
  const c = readCatalog();
  for (const text of ['unit_equivalences', 'Approve the equivalences', 'Definitional unit identity']) {
    assert.equal(stableJson(sqlPayload(c)).includes(text), false, text);
    assert.equal(renderCatalog(c).includes(text), false, text);
  }
  const edited = structuredClone(c);
  for (const e of edited.unit_equivalences) Object.assign(e, { basis: 'synthetic basis', decision_ref: 'synthetic ref', approved_at: '2000-01-01' });
  assert.deepEqual(renderSql(edited), renderSql(c));
  assert.deepEqual(renderReviewSql(edited), renderReviewSql(c));
  assert.equal(renderCatalog(edited), renderCatalog(c));
  for (const a of c.analytes) assert.deepEqual(a.unit_conversions, []);
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
