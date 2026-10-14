import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { harnessCaseNames, harnessText } from '../../migrations/__verification__/harness-cases';

/*
  PK-INT-01 (D3): the migration harness runs its cases from
  supabase/migrations/__verification__/cases/, one file per case, in lexical
  order. These tests pin the two things that make that safe: the runner cannot
  skip a case silently (list-cases.sh, executed here against fixtures), and the
  split moved every case of the old single-file run.sh, in its original order,
  without leaving any step behind in run.sh.

  The behaviour itself is proven by running the harness: identical PASS lines
  before and after the split (see the PK-INT-01 PR).
*/

const DIR = fileURLToPath(new URL('../../migrations/__verification__/', import.meta.url));
const LISTER = join(DIR, 'list-cases.sh');
const runSh = readFileSync(join(DIR, 'run.sh'), 'utf8');
const caseText = (name: string) => readFileSync(join(DIR, 'cases', name), 'utf8');

function listCases(dir: string) {
  const result = spawnSync('bash', [LISTER, dir], { encoding: 'utf8' });
  return {
    status: result.status,
    names: result.stdout.split('\n').filter(Boolean).map(path => path.split('/').pop()),
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function withCaseDir(entries: string[], run: (dir: string) => void, directories: string[] = []) {
  const dir = mkdtempSync(join(tmpdir(), 'harness-cases-'));
  try {
    for (const name of entries) writeFileSync(join(dir, name), 'echo "PASS: fixture"\n');
    for (const name of directories) mkdirSync(join(dir, name));
    run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('list-cases.sh: the order run.sh sources cases in', () => {
  it('lists the real cases in the order the TypeScript helper reads them', () => {
    const listed = listCases(join(DIR, 'cases'));
    expect(listed.status).toBe(0);
    expect(listed.names).toEqual(harnessCaseNames());
    expect(listed.names.length).toBeGreaterThanOrEqual(16);
  });

  it('orders by number, whatever order the files were created in', () => {
    withCaseDir(['100-c.sh', '020-b.sh', '090-a.sh', '010-z.sh'], dir => {
      const listed = listCases(dir);
      expect(listed.status).toBe(0);
      expect(listed.names).toEqual(['010-z.sh', '020-b.sh', '090-a.sh', '100-c.sh']);
    });
  });

  it.each(['10-short.sh', '0100-long.sh', '030_underscore.sh', '030-Upper.sh', '030-case.bash', '030-case.sh.bak', 'notes.md', '030-.sh'])(
    'fails on a misnamed entry (%s) instead of skipping it',
    misnamed => {
      withCaseDir(['010-ok.sh', misnamed], dir => {
        const listed = listCases(dir);
        expect(listed.status).not.toBe(0);
        expect(listed.stdout).toBe('');
        expect(listed.stderr).toContain(`FAIL: cases/${misnamed} is not a NNN-name.sh file`);
      });
    },
  );

  it('fails when two cases share a number', () => {
    withCaseDir(['030-a.sh', '030-b.sh'], dir => {
      const listed = listCases(dir);
      expect(listed.status).not.toBe(0);
      expect(listed.stdout).toBe('');
      expect(listed.stderr).toContain('two cases share the number 030');
    });
  });

  it('fails on a directory named like a case', () => {
    withCaseDir(['010-ok.sh'], dir => {
      const listed = listCases(dir);
      expect(listed.status).not.toBe(0);
      expect(listed.stderr).toContain('FAIL: cases/020-nested.sh is not a NNN-name.sh file');
    }, ['020-nested.sh']);
  });

  it('fails on an empty or missing case directory', () => {
    withCaseDir([], dir => {
      const empty = listCases(dir);
      expect(empty.status).not.toBe(0);
      expect(empty.stderr).toContain('FAIL: no cases in');
      const missing = listCases(join(dir, 'absent'));
      expect(missing.status).not.toBe(0);
      expect(missing.stderr).toContain('FAIL: no case directory');
    });
  });

  it('ignores dot files such as .DS_Store', () => {
    withCaseDir(['.DS_Store', '010-only.sh'], dir => {
      const listed = listCases(dir);
      expect(listed.status).toBe(0);
      expect(listed.names).toEqual(['010-only.sh']);
    });
  });
});

describe('run.sh is the runner and holds no case of its own', () => {
  it('lists the cases before Postgres starts, then sources each in order in its own shell', () => {
    const listing = runSh.indexOf('case_list=$(bash "$HERE/list-cases.sh" "$HERE/cases")');
    expect(listing).toBeGreaterThan(-1);
    expect(listing).toBeLessThan(runSh.indexOf('docker run -d'));
    // Sourced from an array, never from a loop reading stdin: a case's
    // `docker exec -i` would otherwise swallow the rest of the list.
    expect(runSh).toMatch(/for case_file in "\$\{cases\[@\]\}"; do\n[^\n]*\n[^\n]*\n\s*source "\$case_file"\ndone\n$/);
    expect(runSh).toContain('set -euo pipefail');
  });

  it('applies no migration, copies no fixture and prints no PASS itself', () => {
    expect(runSh).not.toMatch(/\d{14}_\w+\.sql/);
    expect(runSh).not.toMatch(/^\s*docker cp /m);
    expect(runSh).not.toMatch(/^\s*echo "PASS/m);
  });

  it('keeps CLINICAL_ONLY=1 as the isolated clinical catalog rehearsal', () => {
    expect(runSh).toMatch(/if \[ "\$\{CLINICAL_ONLY:-0\}" = 1 \]; then[\s\S]*?source "\$HERE\/clinical-catalog\.run\.sh"\n\s*exit 0\nfi/);
  });
});

describe('the split moved every case of the old run.sh, in its order', () => {
  // The first line of each case block in the single-file run.sh, in run order.
  const ORIGINAL_ORDER = [
    'echo "==> schema stubs + migration"',
    '# ── Case 2: iap_beta_testers',
    '# Case 3: RevenueCat ordering and lease upgrade',
    '# Case 4: upgrade the existing ledger to three',
    '# Case 5: same draw racing for the last slot',
    '# Case 6: DARK prepare -> deployed stable writers',
    '# Case 7a: deterministic projection floor applied BEFORE cutover',
    '# Case 8 (pre-cutover half): the read-source migration refuses',
    '# Case 7b: the same migration AFTER cutover',
    '# Case 8: read RPC returns interpretation_source after the cutover',
    '# Case 9: flagged-trend parity/backfill after cutover',
    '# Case 10: post-cutover Basic confidentiality',
    '# Case 11 (TASK-046, V2-03c)',
    'source "$HERE/legacy-quarantine.run.sh"',
    '# TASK-041: isolated reference catalog',
    'source "$HERE/interpretation-versions.run.sh"',
  ];

  it('each case file holds exactly one of the old blocks, and they run in the old order', () => {
    const names = harnessCaseNames();
    expect(names).toHaveLength(ORIGINAL_ORDER.length);
    names.forEach((name, index) => {
      const text = caseText(name);
      const held = ORIGINAL_ORDER.filter(marker => text.includes(marker));
      expect(held, name).toEqual([ORIGINAL_ORDER[index]]);
    });
    // And in the text the harness actually executes.
    const harness = harnessText();
    let cursor = harness.indexOf(ORIGINAL_ORDER[0]!);
    expect(cursor).toBeGreaterThan(-1);
    for (const marker of ORIGINAL_ORDER.slice(1)) {
      const next = harness.indexOf(marker, cursor + 1);
      expect(next, marker).toBeGreaterThan(cursor);
      cursor = next;
    }
  });

  it('each sub-harness is sourced by exactly one case', () => {
    for (const sub of ['legacy-quarantine.run.sh', 'clinical-catalog.run.sh', 'interpretation-versions.run.sh']) {
      const owners = harnessCaseNames().filter(name => caseText(name).includes(`source "$HERE/${sub}"`));
      expect(owners, sub).toHaveLength(1);
    }
  });

  it('case files are steps for the runner, not scripts: no shebang, no set, no early exit 0', () => {
    for (const name of harnessCaseNames()) {
      const text = caseText(name);
      expect(text.startsWith('#!'), name).toBe(false);
      expect(text, name).not.toMatch(/^\s*set\s+[-+]/m);
      // `exit 0` in a sourced case would end the whole run and skip every later case.
      expect(text, name).not.toMatch(/^\s*exit\s+0\b/m);
    }
  });
});
