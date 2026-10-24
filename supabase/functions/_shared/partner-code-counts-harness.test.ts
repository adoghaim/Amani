import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { harnessCaseNames } from '../../migrations/__verification__/harness-cases';

/*
  20261022180000_partner_code_counts.sql was applied to production on
  2026-10-22 from the owner's commit b60fe06, before it reached main. Two
  things keep main honest about it:

    - the file stays byte-for-byte what production applied (D6: never edit a
      shipped migration; production will not re-run it, so an edit here would
      only make main lie about the live view);
    - a migration-harness case applies it, fails loudly, and runs its
      assertions (partner-code-counts.verify.sql: security_invoker, grants,
      counts). The behaviour itself is proven by running the harness.
*/

const MIGRATIONS = fileURLToPath(new URL('../../migrations/', import.meta.url));
const MIGRATION = '20261022180000_partner_code_counts.sql';
// sha256 of `git show b60fe06:supabase/migrations/20261022180000_partner_code_counts.sql`.
const APPLIED_SHA256 = '17371560ef052e266789cfa9f9fed33bb49844830a1cd93fac20261a9ece9a42';

const caseText = (name: string) => readFileSync(join(MIGRATIONS, '__verification__', 'cases', name), 'utf8');

describe('partner_code_counts: the production-applied migration on main', () => {
  it('is byte-identical to the file production applied', () => {
    const bytes = readFileSync(join(MIGRATIONS, MIGRATION));
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(APPLIED_SHA256);
  });

  it('is applied and verified by exactly one harness case, which stops on the first error', () => {
    const owners = harnessCaseNames().filter(name => caseText(name).includes(`PARTNER_CODE_COUNTS=${MIGRATION}`));
    expect(owners).toEqual(['250-partner-code-counts.sh']);
    const text = caseText(owners[0]!);
    expect(text).toMatch(/psql_pcc\(\) \{[^}]*-v ON_ERROR_STOP=1/);
    expect(text).toContain('psql_pcc -q -f "/tmp/$PARTNER_CODE_COUNTS"');
    expect(text).toContain('psql_pcc -q -f /tmp/partner-code-counts.verify.sql');
    for (const fixture of ['partner-code-counts.prelude.sql', 'partner-code-counts.verify.sql']) {
      expect(readFileSync(join(MIGRATIONS, '__verification__', fixture), 'utf8').length).toBeGreaterThan(0);
    }
  });
});
