import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { readCatalog, generateArtifacts, renderCatalog, renderContext, artifact, contextArtifact, creatableArtifacts } from './generate.mjs';
import { projectEntries, projectContext } from './project.mjs';
import { renderSql, renderReviewSql, reviewPayload, migrationArtifact, reviewMigrationArtifact, reviewRollbackArtifact, reviewVerifyArtifact } from './sql.mjs';
import { clinicalSqlFiles } from './sql-parse-guard.mjs';

// The 43 dispositioned shipping ranges, restated independently of the seed.
const disputed = [
  ...['estradiol', 'fsh', 'lh'].flatMap(slug => ['follicular', 'luteal', 'menstrual', 'ovulatory'].flatMap(phase =>
    ['amani_context', 'lab_reference'].map(kind => `${slug}/${kind}/${phase}`))),
  ...['follicular', 'luteal', 'menstrual'].flatMap(phase => ['amani_context', 'lab_reference'].map(kind => `progesterone/${kind}/${phase}`)),
  'lh/amani_context/-', 'estradiol/amani_context/-', 'estradiol/lab_reference/-', 'fsh/amani_context/-', 'fsh/lab_reference/-',
].sort();
const needsContext = ['vitamin_d_25_oh', 'egfr', 'rheumatoid_factor', 'ana_screen']
  .flatMap(slug => ['amani_context', 'lab_reference'].map(kind => `${slug}/${kind}/-`)).sort();
const id = r => `${r.slug}/${r.kind}/${r.phase ?? '-'}`;

test('review payload persists exactly the 43 audit dispositions over the 198 frozen identities', () => {
  const { reviews } = reviewPayload(readCatalog());
  assert.equal(reviews.length, 198);
  assert.equal(new Set(reviews.map(id)).size, 198);
  assert.deepEqual(reviews.filter(r => r.review_status === 'DISPUTED').map(id).sort(), disputed);
  assert.deepEqual(reviews.filter(r => r.review_status === 'NEEDS_CONTEXT').map(id).sort(), needsContext);
  assert.equal(reviews.filter(r => r.review_status === 'UNKNOWN').length, 155);
  for (const r of reviews) {
    assert.equal(r.population, 'general');
    assert.equal(r.candidate_id, 'shipping');
    assert.equal(r.disposition_basis, 'task042_internal_audit');
  }
  // Same identities, in the same shape, as the frozen V2-01 range payload.
  const frozen = JSON.parse(readFileSync(migrationArtifact, 'utf8').match(/seed jsonb := '(.*)'::jsonb;/)[1].replaceAll("''", "'"));
  assert.deepEqual(frozen.ranges.map(id).sort(), reviews.map(id).sort());
  assert.ok(frozen.ranges.every(r => r.review_status === 'UNKNOWN'));
});

test('SAFE can never be persisted by the review migration', () => {
  const c = structuredClone(readCatalog());
  // The seed validator refuses first; the payload guard and table CHECK back it up.
  c.analytes.find(a => a.slug === 'tsh').ranges[0].review_status = 'SAFE';
  assert.throws(() => reviewPayload(c));
  const sql = readFileSync(reviewMigrationArtifact, 'utf8');
  assert.match(sql, /review_status text NOT NULL CHECK\(review_status IN \('NEEDS_CONTEXT','DISPUTED','UNKNOWN'\)\)/);
});

test('review SQL is generated, deterministic, checked in and bound to the frozen V2-01 seed hash', () => {
  const c = readCatalog();
  const reordered = JSON.parse(JSON.stringify(c), (_key, v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).reverse()) : v);
  assert.deepEqual(renderReviewSql(c), renderReviewSql(reordered));
  for (const [name, content] of Object.entries(renderReviewSql(c))) assert.equal(readFileSync(name, 'utf8'), content, name);
  const baseHash = readFileSync(migrationArtifact, 'utf8').match(/^-- Seed SHA-256: ([a-f0-9]{64})$/m)[1];
  const review = readFileSync(reviewMigrationArtifact, 'utf8');
  assert.ok(review.includes(`-- Requires V2-01 seed SHA-256: ${baseHash}`));
  assert.ok(review.includes(`base.seed_hash <> '${baseHash}'`));
  assert.ok(readFileSync(reviewRollbackArtifact, 'utf8').includes(baseHash));
  assert.ok(readFileSync(reviewVerifyArtifact, 'utf8').includes(baseHash));
  // The frozen migration is still exactly what the frozen generator emits.
  assert.equal(readFileSync(migrationArtifact, 'utf8'), renderSql(c)[migrationArtifact]);
});

test('the review migration never writes to a V2-01 table', () => {
  const sql = readFileSync(reviewMigrationArtifact, 'utf8').replace(/seed jsonb := '.*'::jsonb;/, '');
  for (const table of ['clinical_ranges', 'clinical_catalog_entries', 'canonical_analytes', 'analyte_synonyms', 'biomarker_catalog']) {
    assert.doesNotMatch(sql, new RegExp(`(UPDATE|INSERT INTO|DELETE FROM|ALTER TABLE|DROP TABLE|TRUNCATE)\\s+public\\.${table}\\b`), table);
  }
  assert.doesNotMatch(sql, /task041_state\s+SET/);
  assert.match(sql, /RAISE EXCEPTION 'TASK-044 V2-01 % changed since it was applied'/);
});

test('new migration is dated after the frozen one and covered by the SQL parse guard', () => {
  assert.ok(reviewMigrationArtifact.split('/').at(-1).slice(0, 14) >= '20261007000000');
  const files = clinicalSqlFiles();
  for (const name of [reviewMigrationArtifact, reviewRollbackArtifact, reviewVerifyArtifact,
    'tools/clinical/review-status.sql.txt', 'tools/clinical/review-status.rollback.sql.txt']) assert.ok(files.includes(name), name);
  const compiled = spawnSync(process.execPath, ['tools/clinical/sql-parse-guard.mjs', '--compile-sql'], { encoding: 'utf8' });
  assert.equal(compiled.status, 0, compiled.stderr);
  for (const name of [reviewMigrationArtifact, reviewRollbackArtifact, reviewVerifyArtifact]) assert.ok(compiled.stdout.includes(`parse-check ${name} DO#1`), name);
});

test('review artifacts may be created once when absent, never overwritten; V2-01 is never creatable', () => {
  const c = readCatalog();
  const all = { [artifact]: renderCatalog(c), [contextArtifact]: renderContext(c), ...renderSql(c), ...renderReviewSql(c) };
  assert.deepEqual(creatableArtifacts.sort(), Object.keys(renderReviewSql(c)).sort());
  for (const name of creatableArtifacts) {
    const writes = [];
    const files = { ...all, [name]: null };
    generateArtifacts(c, { read: path => files[path], write: path => writes.push(path) });
    assert.deepEqual(writes, [name]);
    assert.throws(() => generateArtifacts(c, { check: true, read: path => files[path], write: () => assert.fail('check wrote') }), /drifted/);
    const drifted = { ...all, [name]: 'synthetic drift' };
    assert.throws(() => generateArtifacts(c, { read: path => drifted[path], write: () => assert.fail('wrote frozen') }), /frozen/);
  }
  for (const name of Object.keys(renderSql(c))) {
    const files = { ...all, [name]: null };
    assert.throws(() => generateArtifacts(c, { read: path => files[path], write: () => assert.fail('recreated V2-01') }), /frozen/);
  }
});

test('context projection carries every shipping band with its review state, keyed like the dictionary', () => {
  const c = readCatalog();
  const context = projectContext(c);
  const entries = projectEntries(c);
  assert.deepEqual(context.map(e => e.key), entries.map(e => e.key));
  assert.equal(context.flatMap(e => e.bands).length, 198);
  const statuses = context.flatMap(e => e.bands.map(b => b.provenance.review_status));
  assert.equal(statuses.filter(s => s === 'DISPUTED').length, 35);
  assert.equal(statuses.filter(s => s === 'NEEDS_CONTEXT').length, 8);
  assert.equal(statuses.filter(s => s === 'SAFE').length, 0);
  // Data-driven cycle requirement: exactly the analytes whose catalog data say so.
  const cycle = context.filter(e => e.cycleDependent || e.bands.some(b => b.kind === 'amani_context' && b.modifiers.cycle === 'requires_context')).map(e => e.key).sort();
  assert.deepEqual(cycle, c.analytes.filter(a => a.is_cycle_dependent || a.ranges.some(r => r.modifiers.cycle === 'requires_context')).map(a => a.legacy_key ?? a.slug).sort());
  assert.ok(cycle.length > 0);
  for (const e of context) for (const b of e.bands) {
    if (b.phase === null) continue;
    const entry = entries.find(x => x.key === e.key);
    assert.ok(entry.phaseRanges?.[b.phase], `${e.key}/${b.phase} has values in the dictionary`);
  }
  assert.equal(readFileSync(contextArtifact, 'utf8'), renderContext(c));
});
