import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { movementPolicyBytes, checkLanguageArtifact, languageArtifact } from './language-policy.mjs';

const root = new URL('../../', import.meta.url);
const source = readFileSync(new URL('src/lib/scoring/insightCopy.ts', root), 'utf8');
test('Edge movement policy is the exact client policy bytes, with no boundary imports', () => {
  const expected = movementPolicyBytes(source);
  checkLanguageArtifact(expected, readFileSync(new URL(languageArtifact, root), 'utf8'));
  assert.doesNotMatch(expected, /^import\b/m);
});
test('negative controls: divergence, missing and duplicate markers fail closed', () => {
  const expected = movementPolicyBytes(source);
  assert.throws(() => checkLanguageArtifact(expected, expected + '\n'), /drifted/);
  assert.throws(() => movementPolicyBytes(''), /exactly one/);
  assert.throws(() => movementPolicyBytes(source + source), /exactly one/);
});
