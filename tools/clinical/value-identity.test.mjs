import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';
import ts from 'typescript';
import { renderCatalog } from './generate.mjs';

const base = '2fd9433bbcbed73a1e137505d2542ee58a16d9e0';
const plain = value => JSON.parse(JSON.stringify(value));
function evaluate(source) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports });
  return exports;
}

test('all baseline entries and public behavior survive projection', () => {
  const original = evaluate(execFileSync('git', ['show', `${base}:src/lib/biomarkers/dictionary.ts`], { encoding: 'utf8' }));
  const generated = evaluate(renderCatalog());
  assert.equal(original.getAllEntries().length, 83);
  assert.deepEqual(Object.keys(generated).sort(), Object.keys(original).sort());
  assert.deepEqual(plain(generated.getAllEntries()), plain(original.getAllEntries()));
  const phases = [undefined, null, 'general', 'menstrual', 'follicular', 'ovulatory', 'luteal', 'unknown'];
  for (const entry of [...original.getAllEntries(), { key: 'unknown_key', aliases: [], category: 'unknown' }]) {
    for (const name of ['getEntry', 'getDisplayName', 'getCategory', 'getImportance', 'getScoreWeight']) {
      assert.deepEqual(generated[name](entry.key) === undefined ? undefined : plain(generated[name](entry.key)), original[name](entry.key) === undefined ? undefined : plain(original[name](entry.key)));
    }
    for (const phase of phases) assert.deepEqual(plain(generated.getRangesForPhase(entry.key, phase)), plain(original.getRangesForPhase(entry.key, phase)));
    for (const alias of [entry.key, ...entry.aliases]) {
      for (const text of [alias, alias.toUpperCase(), `  ${alias}  `, alias.replaceAll(' ', '-')]) assert.equal(generated.resolveAlias(text), original.resolveAlias(text));
    }
    assert.deepEqual(plain(generated.getEntriesByCategory(entry.category)), plain(original.getEntriesByCategory(entry.category)));
  }
});

