import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { harnessCaseNames, harnessText } from '../../migrations/__verification__/harness-cases';
import { USER_DATA_REGISTRY } from './user-data-registry';

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
    // Cases added after the split (D3: a new case is a new file) hold none of
    // the old blocks; every file that holds one is checked exactly as before.
    const names = harnessCaseNames().filter(name => ORIGINAL_ORDER.some(marker => caseText(name).includes(marker)));
    expect(names).toHaveLength(ORIGINAL_ORDER.length);
    // A case added after the split runs after every moved block, never between them.
    const added = harnessCaseNames().filter(name => !names.includes(name));
    for (const name of added) expect(name > names[names.length - 1]!, name).toBe(true);
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

/*
  DB1 (review F127, F100, F125, F124, F095, F035). The harness behaviour is
  proven by running it; these pin what keeps it honest.
*/

const MIGRATIONS = join(DIR, '..');
const harnessFile = (name: string) => readFileSync(join(DIR, name), 'utf8');

describe('run.sh tests the Postgres major production runs (F127)', () => {
  it('names the image from one PG_MAJOR, equal to production\'s major, and stops on any other server', () => {
    const pins = [...runSh.matchAll(/^PG_MAJOR=(\d+)$/gm)];
    expect(pins).toHaveLength(1);
    // Production's Postgres, as the Lead verified it (docs/clinical/TABLE-DISPOSITION.md:49,
    // 'PostgreSQL is 17.6'). Pinned here, in a tracked file: supabase/.temp is CLI state
    // and is not tracked (scripts/repo-hygiene.test.ts). A production upgrade changes this line.
    const PRODUCTION_POSTGRES = '17.6';
    expect(PRODUCTION_POSTGRES.split('.')[0]).toBe(pins[0]![1]);
    expect(runSh).toContain('"postgres:$PG_MAJOR-alpine"');
    expect(runSh).not.toMatch(/postgres:\d/);
    // Checked once the server accepts connections, before any case or the clinical-only run.
    const check = runSh.indexOf("show server_version_num");
    expect(check).toBeGreaterThan(runSh.indexOf('docker run -d'));
    expect(check).toBeLessThan(runSh.indexOf('CLINICAL_ONLY:-0'));
    expect(runSh).toMatch(/if \[ "\$\(\(server_version_num \/ 10000\)\)" != "\$PG_MAJOR" \]; then\n\s*echo "FAIL: [^\n]*" >&2\n\s*exit 1\nfi/);
  });
});

describe('a harness step that must be refused fails the run when it is not (F100, F125)', () => {
  it('no harness file turns ON_ERROR_STOP off', () => {
    const files = readdirSync(DIR).filter(name => /\.(sql|sh)$/.test(name)).map(name => [name, harnessFile(name)] as const);
    for (const name of harnessCaseNames()) files.push([`cases/${name}`, caseText(name)]);
    for (const [name, text] of files) expect(text, name).not.toMatch(/ON_ERROR_STOP[ =]+(0|off)\b/i);
  });

  it('case 010 runs both verify files so that an error stops it, and filters neither through grep', () => {
    const text = caseText('010-introductory-claims.sh');
    for (const file of ['/tmp/verify.sql', '/tmp/comp-verify.sql']) {
      expect(text).toContain(`psql_f -v ON_ERROR_STOP=1 -q -f ${file}\n`);
    }
    expect(text).not.toMatch(/\|\s*grep\b/);
    for (const name of ['introductory-claims.verify.sql', 'complimentary-entitlements.verify.sql']) {
      expect(harnessFile(name).startsWith('\\set ON_ERROR_STOP 1\n'), name).toBe(true);
      // Refusals are asserted by SQLSTATE and cause, not printed.
      expect(harnessFile(name), name).toMatch(/pg_temp\.refused\(/);
      expect(harnessFile(name), name).not.toMatch(/^\\echo /m);
    }
  });
});

describe('the whole migration chain replays from empty (F124, F095, F035)', () => {
  const replay = caseText('240-full-chain-replay.sh');
  const migrations = readdirSync(MIGRATIONS).filter(name => name.endsWith('.sql')).sort();

  // Shipped before the harness had a case for every migration: covered only by
  // the full-chain replay and its across-the-board assertions. Frozen; it may
  // only shrink. A newer migration needs a case of its own (G3).
  const FULL_CHAIN_ONLY = [
    '20260115202339_add_interpretation_source.sql',
    '20260126021208_add_cycle_events.sql',
    '20260126030815_add_interventions.sql',
    '20260216193045_initial_schema.sql',
    '20260216194325_20260126021208_add_cycle_events.sql',
    '20260216194328_20260126030815_add_interventions.sql',
    '20260216195036_add_lab_files_storage_bucket.sql',
    '20260221194201_add_foreign_key_indexes.sql',
    '20260224062147_security_hardening_rls_audit_storage_rate_limits.sql',
    '20260307054419_add_period_logs_symptom_logs_notifications.sql',
    '20260308131250_auto_create_user_profile_on_signup.sql',
    '20260310051744_add_biomarker_definitions_and_derived_metrics.sql',
    '20260310054519_full_44_biomarker_panel_schema_v3.sql',
    '20260310055655_create_biomarker_catalog.sql',
    '20260310071546_add_report_items_full_ingestion.sql',
    '20260312070949_add_interpretation_source_and_unique_constraint.sql',
    '20260312182252_add_rate_limits_rls_policies.sql',
    '20260312194342_add_canonical_analytes_and_report_analytes.sql',
    '20260312194513_seed_canonical_analytes_and_synonyms.sql',
    '20260313061510_add_parser_debug_table.sql',
    '20260314200025_add_raw_value_text_to_biomarkers.sql',
    '20260402000000_intelligent_data_pipeline_schema.sql',
    '20260402000001_report_analytes_telemetry.sql',
    '20260406055443_add_normalization_and_telemetry_columns_to_report_analytes.sql',
    '20260414122512_add_lab_source_and_import_method.sql',
    '20260430000000_add_stripe_idempotency.sql',
    '20260501000000_lock_lab_reports_user_write_columns.sql',
    '20260502000000_add_onboarding_fields_to_users.sql',
    '20260519000000_add_full_name_to_users.sql',
    '20260521000000_defer_trial_start_until_onboarding.sql',
    '20260811000000_stripe_event_claim_lease.sql',
    '20260823000000_lock_users_privileged_columns.sql',
  ];

  it('applies every top-level migration by listing the directory, never a list of its own', () => {
    expect(replay).toContain(`find . -mindepth 1 -maxdepth 1 -name '*.sql'`);
    expect(replay).toMatch(/for chain_name in "\$\{chain_files\[@\]\}"; do\n\s*chain_deferred=''/);
    expect(migrations.length).toBeGreaterThanOrEqual(70);
  });

  it('defers only migrations that exist, each to a later one, and nothing newer than the baseline', () => {
    const block = /^CHAIN_DEFERRED='([^']*)'$/m.exec(replay);
    expect(block).not.toBeNull();
    const rows = block![1]!.split('\n').map(line => line.split('|'));
    expect(rows.map(([file]) => file)).toEqual(['20260115202339_add_interpretation_source.sql', '20260126021208_add_cycle_events.sql']);
    for (const [file, anchor, error] of rows) {
      expect(migrations, file).toContain(file);
      expect(migrations, anchor).toContain(anchor);
      expect(anchor! > file!, file).toBe(true);
      expect(error, file).toMatch(/^relation "[a-z_.]+" does not exist$/);
      expect(file! < '20260216193045', file).toBe(true);
    }
  });

  it('expects no grant-audit row on the replayed chain: CHAIN_KNOWN_VIOLATIONS holds notes only (DB2 and RV-DB5)', () => {
    const block = /^CHAIN_KNOWN_VIOLATIONS='([^']*)'$/m.exec(replay);
    expect(block).not.toBeNull();
    expect(block![1]!.split('\n').filter(line => line.trim() !== '' && !line.startsWith('#'))).toEqual([]);
  });

  it('each migration is named by a case of its own or a sub-harness, or is one of the frozen pre-harness files', () => {
    const dedicated = [
      ...harnessCaseNames().filter(name => name !== '240-full-chain-replay.sh').map(caseText),
      ...readdirSync(DIR).filter(name => name.endsWith('.run.sh')).map(harnessFile),
    ].join('\n');
    expect(migrations.filter(name => !dedicated.includes(name))).toEqual(FULL_CHAIN_ONLY);
    for (const name of FULL_CHAIN_ONLY) expect(name < '20260823010000', name).toBe(true);
  });

  it('probes cross-user denial on every user-owned table in USER_DATA_REGISTRY, and on the views clients read', () => {
    const probes = harnessFile('full-chain.probes.sql');
    const targets = (kind: string) => [...probes.matchAll(new RegExp(`pg_temp\\.fc_${kind}\\('([a-z_]+)'`, 'g'))].map(m => m[1]!);
    const crossUser = targets('cross_user');
    const probed = [...crossUser, ...targets('no_client_access')];
    expect(new Set(probed).size).toBe(probed.length);
    // Every user-owned table is probed under its registered name (a renamed
    // table's client view is probed under the old name, its table under the new).
    const registry = USER_DATA_REGISTRY.map(entry => entry.table);
    for (const table of registry) expect(probed, table).toContain(table);
    // The views clients read, the audit's client views, each get the cross-user
    // read probes, and are the only cross-user targets beyond the registry.
    const clientViews = /client_view\(relname\) AS \(([\s\S]*?)\n\),/.exec(
      readFileSync(join(MIGRATIONS, '../../factory/sql/verify-privileges.sql'), 'utf8'));
    expect(clientViews).not.toBeNull();
    const designed = [...clientViews![1]!.matchAll(/'([a-z_]+)'/g)].map(m => m[1]!);
    expect(designed).toHaveLength(4);
    for (const view of designed) expect(crossUser, view).toContain(view);
    expect(crossUser.filter(name => !registry.includes(name)).sort())
      .toEqual(designed.filter(name => !registry.includes(name)).sort());
  });

  it('its files are where the case copies them from', () => {
    for (const file of ['full-chain.prelude.sql', 'full-chain.verify.sql', 'full-chain.probes.sql', 'pgtap-standin.sql',
      'interpretation-versions.helpers.sql']) {
      expect(existsSync(join(DIR, file)), file).toBe(true);
      expect(replay, file).toContain(file);
    }
    expect(replay).toContain('"$HERE/../../tests/privileged_columns_test.sql"');
    expect(existsSync(join(MIGRATIONS, '../tests/privileged_columns_test.sql'))).toBe(true);
  });
});
