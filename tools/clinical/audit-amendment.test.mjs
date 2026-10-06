import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { readCatalog, assertAuditInventory, generateArtifacts, renderCatalog, artifact } from './generate.mjs';
import { validateCatalog, validateRangeEvidence } from './validate.mjs';
import { renderSql } from './sql.mjs';
import { renderAuditQueue } from './audit-queue.mjs';

const fallbackIds = new Set(['lh/amani_context', 'estradiol/amani_context', 'estradiol/lab_reference', 'fsh/amani_context', 'fsh/lab_reference']);
const contextSlugs = new Set(['vitamin_d_25_oh', 'egfr', 'rheumatoid_factor', 'ana_screen']);

test('amendment dispositions match the 15 conflict pairs, five fallback bands and four context analytes', () => {
  const conflicts = new Set(readFileSync('docs/clinical/CONFLICTS.md', 'utf8').split('\n')
    .filter(line => /^\| (estradiol|fsh|lh|progesterone) \|/.test(line))
    .map(line => line.split('|').slice(1, 3).map(s => s.trim()).join('/')));
  assert.equal(conflicts.size, 15);
  const counts = { UNKNOWN: 0, NEEDS_CONTEXT: 0, DISPUTED: 0 };
  for (const a of readCatalog().analytes) for (const r of a.ranges) {
    const fallback = r.phase === null && fallbackIds.has(`${a.slug}/${r.kind}`);
    const expected = conflicts.has(`${a.slug}/${r.phase}`) || fallback ? 'DISPUTED'
      : contextSlugs.has(a.slug) ? 'NEEDS_CONTEXT' : 'UNKNOWN';
    assert.equal(r.review_status, expected, `${a.slug}/${r.phase}/${r.kind}`);
    counts[expected]++;
    if (fallback) {
      assert.equal(r.audit.tier, 'P0');
      const phased = a.ranges.filter(p => p.phase && p.kind === r.kind);
      assert.ok(phased.some(p => p.min < r.min || p.max > r.max));
    }
    if (!a.registry_identity) assert.equal(r.audit.tier, 'P2');
  }
  assert.deepEqual(counts, { UNKNOWN: 155, NEEDS_CONTEXT: 8, DISPUTED: 35 });
});

test('shipping DISPUTED is representable without introducing a candidate', () => {
  const c = readCatalog();
  const r = c.analytes.find(a => a.slug === 'fasting_glucose').ranges[0];
  r.review_status = 'DISPUTED';
  assert.equal(r.candidate_id, undefined);
  assert.equal(validateCatalog(c), c);
});

test('inventory and shipping queue tolerate candidates but still detect missing shipping rows', () => {
  const c = readCatalog();
  const a = c.analytes[0];
  const candidate = { ...structuredClone(a.ranges[0]), candidate_id: 'synthetic_alternative', review_status: 'DISPUTED' };
  a.ranges.push(candidate);
  assert.equal(validateCatalog(c), c);
  assert.doesNotThrow(() => assertAuditInventory(c));
  assert.equal(renderCatalog(c), renderCatalog());
  assert.equal(renderAuditQueue(c), renderAuditQueue());
  a.ranges.shift();
  assert.throws(() => assertAuditInventory(c), /83 analytes \/ 198 ranges/);
});

test('all frozen artifacts are checked before any mutable write, including next value change', () => {
  const c = readCatalog();
  const files = { [artifact]: renderCatalog(c), ...renderSql(c) };
  const writes = [];
  const io = { read: name => files[name], write: (name, value) => { writes.push(name); files[name] = value; } };
  const altered = structuredClone(c);
  altered.analytes.find(a => a.slug === 'vitamin_d_25_oh').ranges[0].min += 1;
  assert.throws(() => generateArtifacts(altered, io), /frozen/);
  assert.deepEqual(writes, []);
  assert.equal(files[artifact], renderCatalog(c));
  for (const name of Object.keys(renderSql(c))) {
    const changedFiles = { ...files, [artifact]: 'synthetic client drift', [name]: 'synthetic SQL drift' };
    assert.throws(() => generateArtifacts(c, { read: path => changedFiles[path], write: io.write }), /frozen/);
    assert.deepEqual(writes, []);
  }
  files[artifact] = 'synthetic client drift';
  generateArtifacts(c, io);
  assert.deepEqual(writes, [artifact]);
  assert.equal(files[artifact], renderCatalog(c));
});

test('structural evidence guards are reachable but complete synthetic evidence never bypasses seed policy', () => {
  // Fictional tokens test structure only; they are not clinical citations or reviewers.
  const c = readCatalog();
  const base = structuredClone(c.analytes[0].ranges[0]);
  const evidence = { ...base, evidence_grade: 'A', source: 'SYNTHETIC TEST TOKEN', source_date: '2000-01-01' };
  for (const patch of [{ source: null }, { source: '   ' }, { source_date: null }]) {
    assert.throws(() => validateRangeEvidence({ ...evidence, ...patch }), /requires source and date/);
  }
  assert.throws(() => validateRangeEvidence({ ...evidence, source_date: 'not-a-date' }), /pattern/);
  assert.throws(() => validateRangeEvidence({ ...base, source: 'SYNTHETIC TEST TOKEN' }), /unsourced range carries a citation/);
  const reviewed = { ...evidence, review_status: 'SAFE', reviewer: 'SYNTHETIC TEST TOKEN', reviewed_at: '2000-01-01' };
  for (const patch of [{ reviewer: ' ' }, { reviewed_at: null }, { evidence_grade: 'unsourced', source: null, source_date: null }]) {
    assert.throws(() => validateRangeEvidence({ ...reviewed, ...patch }), /SAFE requires evidence and review/);
  }
  assert.equal(validateRangeEvidence(reviewed), reviewed);
  for (const fixture of [evidence, reviewed, { ...base, value_origin: 'reviewed_evidence' }]) {
    c.analytes[0].ranges[0] = fixture;
    assert.throws(() => validateCatalog(c), /implementer seed|implementer seeds/);
  }
});

test('specimen uncertainty is colocated, mandatory and consistent; ANA and magnesium attribution is honest', () => {
  const c = readCatalog();
  for (const a of c.analytes) {
    assert.match(a.specimen_basis, /^(INFERRED|UNKNOWN)/);
    for (const r of a.ranges) assert.equal(r.audit.specimen_basis, a.specimen_basis);
  }
  const ana = c.analytes.find(a => a.slug === 'ana_screen');
  assert.equal(ana.specimen, 'UNKNOWN');
  assert.match(ana.specimen_basis, /empty unit, null numeric endpoints/);
  assert.match(c.analytes.find(a => a.slug === 'magnesium').specimen_basis, /not evidence of the shipping specimen/);
  delete ana.specimen_basis;
  assert.throws(() => validateCatalog(c), /missing specimen_basis/);
});

test('queue differentiates P1 context and remains deterministic under reordered analytes and ranges', () => {
  const c = readCatalog();
  const p1 = c.analytes.flatMap(a => a.ranges).filter(r => r.audit.tier === 'P1');
  assert.ok(new Set(p1.map(r => r.audit.reason)).size > 50);
  for (const a of c.analytes) for (const r of a.ranges) {
    assert.doesNotMatch(r.audit.reason, /scoring=True|scoring=False/);
    if (!Object.values(r.modifiers).includes('UNKNOWN')) assert.doesNotMatch(r.audit.open_question, /UNKNOWN modifier|unresolved modifiers/);
  }
  const before = renderAuditQueue(c);
  c.analytes.reverse();
  for (const a of c.analytes) a.ranges.reverse();
  assert.equal(renderAuditQueue(c), before);
});

test('turn 2 preserves clinical values and source fields relative to accepted turn 1', t => {
  const result = spawnSync('git', ['show', '51c20ca:clinical/catalog/catalog.json'], { encoding: 'utf8' });
  if (result.status !== 0) return t.skip('Accepted turn-1 history unavailable, e.g. shallow CI');
  const previous = JSON.parse(result.stdout);
  const current = readCatalog();
  for (let i = 0; i < previous.analytes.length; i++) {
    const a = previous.analytes[i];
    const b = current.analytes[i];
    for (const field of ['slug', 'canonical_unit', 'unit_conversions']) assert.deepEqual(b[field], a[field]);
    for (let j = 0; j < a.ranges.length; j++) for (const field of ['min', 'max', 'kind', 'population', 'phase', 'source', 'source_url', 'source_date', 'evidence_grade', 'reviewer', 'reviewed_at', 'value_origin']) {
      assert.deepEqual(b.ranges[j][field], a.ranges[j][field], `${a.slug}/${j}/${field}`);
    }
  }
});
