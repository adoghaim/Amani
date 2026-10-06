import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { readCatalog, renderCatalog, artifact } from './generate.mjs';
import { validateCatalog } from './validate.mjs';

test('every provenance field is mandatory on every range', () => {
  const catalog = readCatalog();
  const fields = ['source', 'source_url', 'source_date', 'evidence_grade', 'review_status', 'reviewer', 'reviewed_at', 'version', 'notes'];
  for (const [i, analyte] of catalog.analytes.entries()) {
    for (const [j] of analyte.ranges.entries()) {
      for (const field of fields) {
        const copy = structuredClone(catalog);
        delete copy.analytes[i].ranges[j][field];
        assert.throws(() => validateCatalog(copy), new RegExp(`missing ${field}`));
      }
    }
  }
});

test('invalid and ambiguous ranges fail closed', () => {
  for (const mutate of [
    c => { c.analytes[0].ranges[0].review_status = 'SAFE'; },
    c => { c.analytes[0].ranges[0].review_status = 'INVALID_STATUS'; },
    c => { c.analytes[0].ranges[0].population = 'pregnancy_t1'; },
    c => { c.analytes[0].ranges[0].min = 10000; },
    c => { c.analytes[0].ranges[0].source = 'Invented citation'; },
    c => { c.analytes[0].ranges.push(c.analytes[0].ranges[0]); },
    c => { c.analytes[0].ranges.shift(); },
    c => { c.analytes.push(c.analytes[0]); },
  ]) {
    const copy = structuredClone(readCatalog());
    mutate(copy);
    assert.throws(() => validateCatalog(copy));
  }
});

test('all inherited ranges are honestly unsourced and UNKNOWN', () => {
  const disputed = new Set([
    ...['estradiol', 'fsh', 'lh'].flatMap(slug =>
      ['follicular', 'luteal', 'menstrual', 'ovulatory'].flatMap(phase =>
        ['amani_context', 'lab_reference'].map(kind => `${slug}/${kind}/${phase}`))),
    ...['follicular', 'luteal', 'menstrual'].flatMap(phase =>
      ['amani_context', 'lab_reference'].map(kind => `progesterone/${kind}/${phase}`)),
    'lh/amani_context/-',
    'estradiol/amani_context/-', 'estradiol/lab_reference/-',
    'fsh/amani_context/-', 'fsh/lab_reference/-',
  ]);
  const needsContext = new Set(
    ['vitamin_d_25_oh', 'egfr', 'rheumatoid_factor', 'ana_screen'].flatMap(slug =>
      ['amani_context', 'lab_reference'].map(kind => `${slug}/${kind}/-`)));
  const ranges = readCatalog().analytes.flatMap(a => a.ranges.map(r => ({
    id: `${a.slug}/${r.kind}/${r.phase ?? '-'}`, status: r.review_status,
  })));
  assert.equal(ranges.length, 198);
  assert.equal(new Set(ranges.map(r => r.id)).size, 198);
  assert.equal(disputed.size, 35);
  assert.equal(needsContext.size, 8);
  assert.deepEqual(ranges.filter(r => r.status === 'DISPUTED').map(r => r.id).sort(), [...disputed].sort());
  assert.deepEqual(ranges.filter(r => r.status === 'NEEDS_CONTEXT').map(r => r.id).sort(), [...needsContext].sort());
  assert.deepEqual(ranges.filter(r => r.status === 'UNKNOWN').map(r => r.id).sort(),
    ranges.filter(r => !disputed.has(r.id) && !needsContext.has(r.id)).map(r => r.id).sort());
  assert.equal(ranges.filter(r => r.status === 'UNKNOWN').length, 155);
  assert.equal(ranges.filter(r => r.status === 'SAFE').length, 0);
  for (const a of readCatalog().analytes) for (const r of a.ranges) {
    assert.equal(r.evidence_grade, 'unsourced');
    assert.notEqual(r.value_origin, 'reviewed_evidence');
    for (const key of ['source', 'source_url', 'source_date', 'reviewer', 'reviewed_at']) assert.equal(r[key], null);
  }
});

test('generation is byte-deterministic and ignores object-key ordering', () => {
  const a = renderCatalog();
  const reordered = JSON.parse(JSON.stringify(readCatalog()), (_key, value) => value && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).reverse()) : value);
  assert.equal(renderCatalog(reordered), a);
  assert.equal(renderCatalog(), a);
  assert.equal(readFileSync(artifact, 'utf8'), a);
});

test('CLI drift check fails on a hand edit and does not overwrite it', () => {
  const original = readFileSync(artifact, 'utf8');
  try {
    writeFileSync(artifact, original + '// deliberate drift probe\n');
    const result = spawnSync(process.execPath, ['tools/clinical/generate.mjs', '--check'], { encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /drifted/);
    assert.equal(readFileSync(artifact, 'utf8'), original + '// deliberate drift probe\n');
  } finally { writeFileSync(artifact, original); }
  execFileSync(process.execPath, ['tools/clinical/generate.mjs', '--check']);
});
