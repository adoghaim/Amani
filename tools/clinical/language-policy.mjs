import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = new URL('../../', import.meta.url);
export const languageArtifact = 'supabase/functions/_shared/clinical-movement-policy.generated.ts';
/** @param {string} source */
export function movementPolicyBytes(source) {
  const start = '// BEGIN GENERATED MOVEMENT POLICY\n';
  const end = '// END GENERATED MOVEMENT POLICY\n';
  if (source.split(start).length !== 2 || source.split(end).length !== 2) {
    throw new Error('Movement policy requires exactly one start and end marker');
  }
  const from = source.indexOf(start);
  const through = source.indexOf(end) + end.length;
  if (through <= from) throw new Error('Movement policy markers are reversed');
  return source.slice(from, through);
}
/** @param {string} expected @param {string} actual */
export function checkLanguageArtifact(expected, actual) {
  if (expected !== actual) throw new Error('Clinical movement policy drifted; run npm run clinical:generate');
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const expected = movementPolicyBytes(readFileSync(new URL('src/lib/scoring/insightCopy.ts', root), 'utf8'));
  const target = new URL(languageArtifact, root);
  if (process.argv.includes('--check')) checkLanguageArtifact(expected, readFileSync(target, 'utf8'));
  else writeFileSync(target, expected);
  console.log('Clinical movement policy byte identity verified/generated');
}
