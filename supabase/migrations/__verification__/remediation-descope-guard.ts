import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * TASK-048 turn 13 (PK-03e-G): pre-launch de-scope guard.
 *
 * Owner decision 2026-10-12: Amani has no genuine legacy customers, so the
 * legacy-remediation machinery (paid-legacy regeneration eligibility, a $0
 * historical entitlement, repeat-remediation policy, legacy copy/CTA,
 * historical payment reconstruction) must not exist in any reachable path.
 * The versioning / history-protection / legacy-read-quarantine architecture is
 * kept and is not matched here (quarantine code says "legacy", never
 * "remediation" or "legacy eligibility/grant").
 *
 * Deliberately scans comments and strings too: reintroducing remediation copy
 * or an identifier needs an explicit, reviewed allow-list entry.
 */
export const REMEDIATION_PATTERN =
  /remediat|evaluate_legacy|legacy[_ -]?(regenerat|eligib|grant|cta|offer)|paid[_ -]?legacy|historical[_ -]?(payment|purchase|entitlement)|reason:\s*['"]legacy/i;

/** Trees that can ship to a user or a database. */
export const SCANNED_ROOTS = ['src', 'e2e', 'supabase/functions', 'supabase/migrations'] as const;

/** This guard and its test necessarily name the pattern. */
const SELF = new Set([
  'supabase/migrations/__verification__/remediation-descope-guard.ts',
  'supabase/functions/_shared/prelaunch-descope.test.ts',
]);

/**
 * Reviewed residue: each entry is history or a test name, not a path. The value is
 * the exact number of matching lines, so any new match in these files still fails.
 */
export const ALLOWED_RESIDUE: Readonly<Record<string, { lines: number; why: string }>> = {
  'supabase/migrations/20261012000004_interpretation_version_foundation.sql': {
    lines: 1,
    why: 'Superseded COMMENT text on the dormant primitive; 20261012000008 replaces it and the harness asserts the stale text is gone (H048L-COMMENTS). Not edited: a V2 migration the harness replays byte for byte.',
  },
  'supabase/migrations/__verification__/interpretation-versions.ledger-rollback.sql': {
    lines: 1,
    why: 'Rollback rehearsal restores the 20261012000004 comment byte for byte.',
  },
  'supabase/migrations/__verification__/interpretation-versions.run.sh': {
    lines: 2,
    why: 'History note that the evaluator was removed, and the H048L-COMMENTS assertion that the stale text is gone.',
  },
  'supabase/migrations/__verification__/interpretation-versions.read.sql': {
    lines: 2,
    why: 'Probe label H048V-NEVER-REMEDIATED: a report with no version (a read case, not a remediation path).',
  },
  'supabase/migrations/__verification__/interpretation-versions.read-export.sql': {
    lines: 1,
    why: 'Fixture case name never-remediated (= no version selected), shared with legacy-sql-parity.test.ts.',
  },
  'supabase/functions/_shared/legacy-sql-parity.test.ts': {
    lines: 1,
    why: 'Fixture case name never-remediated, exported by interpretation-versions.read-export.sql.',
  },
  'supabase/functions/_shared/interpretation-read.test.ts': {
    lines: 1,
    why: 'Test title asserting the read quarantine is independent of any legacy eligibility.',
  },
  'supabase/migrations/__verification__/interpretation-versions.overwrite.sql': {
    lines: 1,
    why: 'Overwrite-protection fixture covers historical paid rows: history protection is kept.',
  },
};

/** Files turn 10 removed; they must stay removed. */
export const REMOVED_PATHS = [
  'supabase/functions/_shared/legacy-remediation.ts',
  'supabase/functions/_shared/legacy-remediation.test.ts',
  'supabase/functions/_shared/legacy-remediation.handler.test.ts',
  'supabase/functions/_shared/remediation-draw-parity.test.ts',
  'supabase/migrations/20261011000000_legacy_remediation_eligibility.sql',
  'supabase/migrations/20261012000005_legacy_remediation_eligibility.sql',
  'supabase/migrations/__verification__/interpretation-versions.remediation.sql',
  'supabase/migrations/__verification__/interpretation-versions.remediation-rollback.sql',
] as const;

export interface Finding { file: string; line: number; text: string }

export function remediationFindings(root: string): Finding[] {
  const findings: Finding[] = [];
  function walk(directory: string) {
    if (!existsSync(directory)) return;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      const file = relative(root, path).replaceAll('\\', '/');
      if (entry.isDirectory()) {
        if (!['node_modules', 'test-results', 'playwright-report'].includes(entry.name)) walk(path);
      } else if (entry.isFile() && !SELF.has(file)) {
        readFileSync(path, 'utf8').split('\n').forEach((text, index) => {
          if (REMEDIATION_PATTERN.test(text)) findings.push({ file, line: index + 1, text: text.trim() });
        });
      }
    }
  }
  for (const directory of SCANNED_ROOTS) walk(join(root, directory));
  return findings;
}

/** Findings that are not reviewed residue (new files, or extra lines in an allowed file). */
export function unreviewedFindings(root: string): Finding[] {
  const findings = remediationFindings(root);
  const byFile = new Map<string, Finding[]>();
  for (const f of findings) byFile.set(f.file, [...(byFile.get(f.file) ?? []), f]);
  const out: Finding[] = [];
  for (const [file, list] of byFile) {
    const allowed = ALLOWED_RESIDUE[file];
    if (!allowed || list.length !== allowed.lines) out.push(...list);
  }
  return out;
}

/** Forward migrations in apply order (excludes the harness directory). */
export function forwardMigrations(root: string): Array<{ name: string; sql: string }> {
  const directory = join(root, 'supabase/migrations');
  return readdirSync(directory)
    .filter(name => /^\d{14}_.*\.sql$/.test(name))
    .sort()
    .map(name => ({ name, sql: readFileSync(join(directory, name), 'utf8') }));
}

/** The comment a fresh database ends with for a function (last COMMENT ON wins). */
export function effectiveFunctionComment(root: string, signature: string): string | null {
  let comment: string | null = null;
  const escaped = signature.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`COMMENT ON FUNCTION\\s+${escaped}\\s+IS\\s+'((?:[^']|'')*)'`, 'gi');
  for (const { sql } of forwardMigrations(root)) {
    for (const match of sql.matchAll(pattern)) comment = match[1].replaceAll("''", "'");
  }
  return comment;
}

/** Any forward-migration grant of a version write path to a client role. */
export function clientVersionWriteGrants(root: string): string[] {
  const out: string[] = [];
  const grant = /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.(append_interpretation_version\w*|commit_deep_access_version)\b[^;]*\bTO\b([^;]*)/gi;
  for (const { name, sql } of forwardMigrations(root)) {
    for (const match of sql.matchAll(grant)) {
      if (/\b(authenticated|anon|public)\b/i.test(match[2])) out.push(`${name}: ${match[1]} ->${match[2].trim()}`);
    }
  }
  return out;
}
