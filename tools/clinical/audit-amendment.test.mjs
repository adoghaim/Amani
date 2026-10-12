import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { readCatalog, assertAuditInventory, generateArtifacts, renderCatalog, renderContext, artifact, contextArtifact } from './generate.mjs';
import { validateCatalog, validateRangeEvidence } from './validate.mjs';
import { fallbackFindings, fallbackSummary } from './fallback-audit.mjs';
import { renderSql, renderReviewSql, sqlPayload, FROZEN_V2_01_REVIEW_STATUS } from './sql.mjs';
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
  // TASK-044 adds the context artifact and the V2-03 review SQL; both SQL sets are frozen once present.
  const files = { [artifact]: renderCatalog(c), [contextArtifact]: renderContext(c), ...renderSql(c), ...renderReviewSql(c) };
  const writes = [];
  const io = { read: name => files[name], write: (name, value) => { writes.push(name); files[name] = value; } };
  const altered = structuredClone(c);
  altered.analytes.find(a => a.slug === 'vitamin_d_25_oh').ranges[0].min += 1;
  assert.throws(() => generateArtifacts(altered, io), /frozen/);
  assert.deepEqual(writes, []);
  assert.equal(files[artifact], renderCatalog(c));
  for (const name of [...Object.keys(renderSql(c)), ...Object.keys(renderReviewSql(c))]) {
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

test('frozen SQL differs from shipping range fields only in the 43 intentional audit statuses', () => {
  const c = readCatalog();
  const payload = sqlPayload(c);
  const expectedIds = new Set([
    ...['estradiol', 'fsh', 'lh'].flatMap(slug => ['menstrual', 'follicular', 'ovulatory', 'luteal']
      .flatMap(phase => ['amani_context', 'lab_reference'].map(kind => `${slug}/${phase}/${kind}`))),
    ...['menstrual', 'follicular', 'luteal'].flatMap(phase => ['amani_context', 'lab_reference'].map(kind => `progesterone/${phase}/${kind}`)),
    ...[...fallbackIds].map(id => id.replace('/', '/null/')),
    ...[...contextSlugs].flatMap(slug => ['amani_context', 'lab_reference'].map(kind => `${slug}/null/${kind}`)),
  ]);
  assert.equal(expectedIds.size, 43);
  const actualIds = [];
  let i = 0;
  for (const a of c.analytes) for (const r of a.ranges.filter(r => !r.candidate_id)) {
    // Normalize only the documented V2-01 omissions and SQL identity fields.
    // Deep equality below covers EVERY retained range field, not just endpoints.
    const original = { ...r };
    for (const field of ['value_origin', 'value_origin_table', 'modifiers', 'audit']) delete original[field];
    const sql = { ...payload.ranges[i++] };
    assert.equal(sql.slug, a.slug);
    assert.equal(sql.unit, a.canonical_unit);
    assert.equal(sql.candidate_id, 'shipping');
    for (const field of ['slug', 'unit', 'candidate_id']) delete sql[field];
    assert.equal(sql.review_status, FROZEN_V2_01_REVIEW_STATUS);
    if (sql.review_status !== original.review_status) actualIds.push(`${a.slug}/${r.phase}/${r.kind}`);
    assert.deepEqual({ ...sql, review_status: original.review_status }, original);
  }
  assert.equal(i, 198);
  assert.equal(payload.ranges.length, i);
  assert.deepEqual(actualIds.sort(), [...expectedIds].sort());
});

test('synthetic candidate survives validation while generate and check preserve every frozen artifact', () => {
  const c = readCatalog();
  const a = c.analytes[0];
  a.ranges.push({ ...structuredClone(a.ranges[0]), min: -123, max: 456,
    candidate_id: 'synthetic_alternative', review_status: 'DISPUTED' });
  validateCatalog(c);
  assertAuditInventory(c);
  const writes = [];
  const io = { read: path => readFileSync(path, 'utf8'), write: path => { writes.push(path); } };
  generateArtifacts(c, io);
  generateArtifacts(c, { ...io, check: true });
  assert.deepEqual(writes, []);
  for (const [path, output] of Object.entries({ ...renderSql(c), ...renderReviewSql(c) })) assert.equal(output, readFileSync(path, 'utf8'));
  assert.equal(renderAuditQueue(c), readFileSync('docs/clinical/AUDIT-QUEUE.md', 'utf8'));
  assert.equal(sqlPayload(c).ranges.length, 198);
});

test('UNKNOWN specimen basis and UNKNOWN specimen must imply each other', () => {
  for (const [specimen, basis] of [['UNKNOWN', 'INFERRED synthetic basis'], ['serum_or_plasma', 'UNKNOWN synthetic basis']]) {
    const c = readCatalog();
    const a = c.analytes[0];
    a.specimen = specimen;
    a.specimen_basis = basis;
    for (const r of a.ranges) r.audit.specimen_basis = basis;
    assert.throws(() => validateCatalog(c), /UNKNOWN/);
  }
});

test('fallback audit detects both directions, union gaps, and phase masking even with equal envelopes', () => {
  const check = (min, max, bands) => {
    const fallback = { min, max, phase: null, population: 'general', kind: 'lab_reference' };
    return fallbackFindings({ ranges: [fallback, ...bands.map(([low, high], i) =>
      ({ ...fallback, min: low, max: high, phase: String(i) }))] }, fallback);
  };
  assert.equal(check(2, 8, [[1, 10]]).narrowerThanUnion, true);
  assert.equal(check(2, 8, [[1, 10]]).widerThanUnion, false);
  assert.equal(check(0, 11, [[1, 10]]).widerThanUnion, true);
  assert.equal(check(0, 11, [[1, 10]]).narrowerThanUnion, false);
  assert.equal(check(0, 8, [[1, 10]]).widerThanUnion, true);
  assert.equal(check(0, 8, [[1, 10]]).narrowerThanUnion, true);
  assert.equal(check(1, 10, [[1, 3], [5, 10]]).widerThanUnion, true);
  const equalUnion = check(1, 10, [[1, 5], [3, 10]]);
  assert.equal(equalUnion.widerThanUnion, false);
  assert.equal(equalUnion.narrowerThanUnion, false);
  assert.equal(equalUnion.widerThanPhases.length, 2);
  const c = readCatalog();
  const found = c.analytes.flatMap(a => a.ranges.map(r => ({ a, r, f: fallbackFindings(a, r) }))).filter(row => row.f);
  assert.equal(found.length, 8);
  assert.equal(found.filter(({ f }) => f.narrowerThanUnion).length, 5);
  assert.equal(found.filter(({ f }) => f.widerThanUnion).length, 1); // progesterone context has gaps
  for (const { r, f } of found) {
    assert.equal(r.audit.tier, 'P0');
    assert.ok(f.widerThanPhases.length);
    assert.ok(r.audit.reason.includes(fallbackSummary(f)));
  }
  const p = c.analytes.find(a => a.slug === 'progesterone');
  for (const kind of ['amani_context', 'lab_reference']) {
    const fallback = p.ranges.find(r => r.phase === null && r.kind === kind);
    const luteal = p.ranges.find(r => r.phase === 'luteal' && r.kind === kind);
    assert.ok(2 >= fallback.min && 2 <= fallback.max && 2 < luteal.min);
  }
  const output = renderAuditQueue(c);
  const firstFallback = output.indexOf('`lh/general/unphased/lab_reference`');
  assert.ok(firstFallback < output.indexOf('`magnesium/general/unphased/amani_context`'));
});

test('each historical conflict kind discloses endpoint agreement or difference per row', () => {
  const c = readCatalog();
  let agreeing = 0;
  for (const line of readFileSync('docs/clinical/CONFLICTS.md', 'utf8').split('\n').filter(l => /^\| (estradiol|fsh|lh|progesterone) \|/.test(l))) {
    const cells = line.split('|').slice(1, 7).map(s => s.trim());
    const a = c.analytes.find(a => a.slug === cells[0]);
    for (const { kind, i } of [{ kind: 'amani_context', i: 2 }, { kind: 'lab_reference', i: 4 }]) {
      const r = a.ranges.find(r => r.phase === cells[1] && r.kind === kind);
      const equal = JSON.stringify(cells[i].split('-').map(Number)) === JSON.stringify(cells[i + 1].split('-').map(Number));
      assert.match(r.audit.reason, equal ? /two legacy copies agree.*family-level/ : /legacy endpoints differ/);
      if (equal) agreeing++;
    }
  }
  assert.equal(agreeing, 6);
});
