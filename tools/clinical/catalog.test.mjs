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
    c => { c.analytes[0].ranges[0].review_status = 'DISPUTED'; },
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
  for (const a of readCatalog().analytes) for (const r of a.ranges) {
    assert.equal(r.evidence_grade, 'unsourced');
    assert.equal(r.review_status, 'UNKNOWN');
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
