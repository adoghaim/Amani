import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readCatalog, assertAuditInventory, renderCatalog, artifact } from './generate.mjs';
import { validateCatalog } from './validate.mjs';
import { renderAuditQueue, auditArtifact, rangeId } from './audit-queue.mjs';
import { renderSql, sqlPayload } from './sql.mjs';

const fields = ['value_origin', 'value_origin_table', 'modifiers', 'audit'];

test('audit seed requires exactly 83 analytes and 198 ranges', () => {
  const c = readCatalog();
  assert.equal(c.analytes.length, 83);
  assert.equal(c.analytes.flatMap(a => a.ranges).length, 198);
  const missingAnalyte = structuredClone(c);
  missingAnalyte.analytes.pop();
  assert.throws(() => assertAuditInventory(missingAnalyte), /83 analytes \/ 198 ranges/);
  c.analytes[0].ranges.pop();
  assert.throws(() => assertAuditInventory(c), /83 analytes \/ 198 ranges/);
});

test('new audit fields are mandatory on every range; modifiers fail closed', () => {
  const c = readCatalog();
  for (const [i, a] of c.analytes.entries()) for (const [j] of a.ranges.entries()) {
    for (const field of fields) {
      const copy = structuredClone(c);
      delete copy.analytes[i].ranges[j][field];
      assert.throws(() => validateCatalog(copy), new RegExp(`missing ${field}`));
    }
  }
  for (const key of ['sex', 'age', 'cycle', 'pregnancy', 'life_stage']) {
    const copy = structuredClone(c);
    delete copy.analytes[0].ranges[0].modifiers[key];
    assert.throws(() => validateCatalog(copy), new RegExp(`missing ${key}`));
  }
  for (const mutate of [
    r => { r.modifiers.sex = false; },
    r => { r.modifiers.cycle = 'UNKNOWN'; },
    r => { r.audit.tier = 'SAFE'; },
    r => { r.audit.open_question = '  '; },
    r => { delete r.audit.required_artifact; },
  ]) {
    const copy = structuredClone(c);
    mutate(copy.analytes[0].ranges[0]);
    assert.throws(() => validateCatalog(copy));
  }
});

test('origin cannot impersonate clinical evidence or a human reviewer', () => {
  for (const patch of [
    { value_origin: 'reviewed_evidence' },
    { value_origin: 'invented_origin' },
    { value_origin: 'legacy_db_table', value_origin_table: null },
    { value_origin: 'legacy_db_table', value_origin_table: ' \t' },
    { value_origin_table: 'biomarker_definitions' },
    { evidence_grade: 'A', source: 'synthetic fixture', source_date: '2026-10-06' },
    { review_status: 'SAFE', reviewer: 'synthetic fixture', reviewed_at: '2026-10-06' },
    { reviewer: 'synthetic fixture' },
  ]) {
    const c = readCatalog();
    Object.assign(c.analytes[0].ranges[0], patch);
    assert.throws(() => validateCatalog(c));
  }
  const c = readCatalog();
  Object.assign(c.analytes[0].ranges[0], { value_origin: 'legacy_db_table', value_origin_table: 'biomarker_reference_ranges' });
  assert.equal(validateCatalog(c), c);
});

test('shipping provenance never promotes validity or seeds dormant magnesium', () => {
  const c = readCatalog();
  for (const a of c.analytes) for (const r of a.ranges) {
    assert.equal(r.value_origin, 'shipping_dictionary_2fd9433');
    assert.equal(r.value_origin_table, null);
    assert.equal(r.evidence_grade, 'unsourced');
    assert.equal(r.review_status, 'UNKNOWN');
    assert.equal(r.candidate_id, undefined);
    for (const key of ['source', 'source_url', 'source_date', 'reviewer', 'reviewed_at']) assert.equal(r[key], null);
  }
  assert.deepEqual(c.analytes.find(a => a.slug === 'magnesium').ranges.map(r => [r.min, r.max]), [[1.8, 2.4], [1.7, 2.5]]);
  assert.deepEqual(c.analytes.find(a => a.slug === 'vitamin_d_25_oh').ranges.map(r => [r.min, r.max]), [[50, 80], [30, 100]]);
  assert.equal(c.analytes.filter(a => a.catalog_metadata).length, 76);
  assert.equal(c.analytes.filter(a => a.sex_applicability === 'female').length, 44);
  assert.equal(c.analytes.filter(a => a.sex_applicability === 'all').length, 32);
  assert.equal(c.analytes.filter(a => a.sex_applicability === null).length, 7);
  for (const a of c.analytes.filter(a => a.catalog_metadata)) {
    assert.equal(a.sex_applicability, a.catalog_metadata.sex_applicability);
    assert.match(a.sex_applicability_provenance, /default/i);
  }
});

test('198 distinct range rows are sorted by tier with vitamin D first and eight-question coverage', () => {
  const c = readCatalog();
  const output = renderAuditQueue(c);
  assert.equal(readFileSync(auditArtifact, 'utf8'), output);
  const rows = output.split('\n').filter(line => /^\| P[0-3] \|/.test(line));
  assert.equal(rows.length, 198);
  assert.match(rows[0], /vitamin_d_25_oh/);
  const tiers = rows.map(line => line.split('|')[1].trim());
  assert.deepEqual(tiers, [...tiers].sort());
  for (const a of c.analytes) for (const r of a.ranges) {
    const matching = rows.filter(line => line.includes('`' + rangeId(a, r) + '`'));
    assert.equal(matching.length, 1);
    assert.match(matching[0], /unsourced/);
    assert.match(matching[0], /UNKNOWN/);
    assert.ok(matching[0].includes(r.audit.required_artifact));
    assert.ok(matching[0].includes(a.specimen));
    assert.match(r.audit.open_question, /\?/);
  }
  const reordered = JSON.parse(JSON.stringify(c), (_key, v) => v && typeof v === 'object' && !Array.isArray(v)
    ? Object.fromEntries(Object.entries(v).reverse()) : v);
  assert.equal(renderAuditQueue(reordered), output);
});

test('carry-forward inventory has all 15 conflicts and 13 unmapped names without additional ranges', () => {
  const text = readFileSync('docs/clinical/AUDIT-CARRY-FORWARD.md', 'utf8');
  for (let i = 1; i <= 7; i++) assert.ok(text.includes(`CF-0${i}`));
  const conflicts = readFileSync('docs/clinical/CONFLICTS.md', 'utf8').split('\n')
    .filter(line => /^\| (estradiol|fsh|lh|progesterone) \|/.test(line));
  assert.equal(conflicts.length, 15);
  for (const line of conflicts) {
    const cells = line.split('|').slice(1, 7).map(s => s.trim());
    assert.ok(text.includes(`| CF-03-${cells[0]}-${cells[1]} | ${cells.slice(1).join(' | ')} |`));
  }
  for (const slug of ['b12', 'dhea_s', 'glucose_fasting', 'hba1c', 'hdl', 'hscrp', 'insulin', 'ldl', 'non_hdl', 'testosterone_free', 'testosterone_total', 'tgab', 'vitamin_d']) {
    assert.ok(text.includes(`| ${slug} |`));
    assert.equal(readCatalog().analytes.some(a => a.slug === slug), false);
  }
  assert.match(text, /severe hypermagnesemia/);
  assert.match(text, /never seed forward/);
});

test('seven unit joins preserve explicit arithmetic, reversibility and P0 differential flags', () => {
  const c = readCatalog();
  const abs = c.analytes.filter(a => a.legacy_key);
  assert.equal(abs.length, 5);
  for (const a of abs) {
    assert.equal(a.unit_mapping.legacy_to_registry_factor, 0.001);
    assert.equal(1000 * a.unit_mapping.legacy_to_registry_factor, 1);
    assert.equal(1 / a.unit_mapping.legacy_to_registry_factor, 1000);
    for (const r of a.ranges) {
      assert.equal(r.audit.tier, 'P0');
      for (const value of [r.min, r.max]) assert.ok(Math.abs((value * 0.001) / 0.001 - value) < 1e-9);
    }
  }
  for (const slug of ['tsh', 'rbc']) {
    const a = c.analytes.find(a => a.slug === slug);
    assert.equal(a.unit_mapping.legacy_to_registry_factor, 1);
    assert.notEqual(a.unit_mapping.legacy_unit, a.unit_mapping.registry_unit);
    for (const r of a.ranges) for (const value of [r.min, r.max]) assert.equal(value * a.unit_mapping.legacy_to_registry_factor, value);
  }
});

test('audit metadata does not rewrite frozen V2-01 SQL or client; value drift still affects both', () => {
  const c = readCatalog();
  assert.equal(renderCatalog(c), readFileSync(artifact, 'utf8'));
  for (const [path, expected] of Object.entries(renderSql(c))) assert.equal(readFileSync(path, 'utf8'), expected);
  const payload = sqlPayload(c);
  for (const entry of payload.entries) assert.equal(entry.metadata.specimen, null);
  for (const r of payload.ranges) for (const field of fields) assert.equal(Object.hasOwn(r, field), false);
  const beforeSql = renderSql(c);
  const beforeClient = renderCatalog(c);
  c.analytes[0].ranges[0].min += 1;
  assert.notDeepEqual(renderSql(c), beforeSql);
  assert.notEqual(renderCatalog(c), beforeClient);
});
