import { readdirSync, readFileSync } from 'node:fs';

/*
  The migration harness as it executes: run.sh, then every cases/NNN-name.sh in
  the order list-cases.sh gives (lexical byte order). Tests that pin what the
  harness runs read this text, so moving a step between run.sh and a case file
  cannot hide it from them. verification-harness.test.ts proves that this order
  and list-cases.sh agree.
*/

const HERE = new URL('./', import.meta.url);

/** Case file names, in run order. Dot files are not cases (list-cases.sh skips them). */
export function harnessCaseNames(): string[] {
  // Default sort compares UTF-16 code units: byte order for these ASCII names.
  return readdirSync(new URL('cases/', HERE)).filter(name => !name.startsWith('.')).sort();
}

/** run.sh followed by each case file, in run order. */
export function harnessText(): string {
  return [
    readFileSync(new URL('run.sh', HERE), 'utf8'),
    ...harnessCaseNames().map(name => readFileSync(new URL(`cases/${name}`, HERE), 'utf8')),
  ].join('\n');
}
