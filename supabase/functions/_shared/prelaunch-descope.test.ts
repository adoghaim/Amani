/**
 * TASK-048 turn 13 / PK-03e-G: pre-launch de-scope of legacy remediation.
 * Owner decision 2026-10-12: no genuine legacy customers. These tests prove the
 * packet's acceptance criteria that are statically or purely checkable:
 *   A1 no reachable legacy-remediation UI/copy/CTA, server module or DB object;
 *   A2 no server path grants a $0 / legacy entitlement;
 *   A3 the version write path stays service-only and its effective DB comment
 *      carries no remediation gate.
 * Versioning behaviour itself is proven by interpretation-version-write.handler.test.ts,
 * the ReportView regenerate tests and the migration harness (§8–§11).
 */
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ALLOWED_RESIDUE, REMOVED_PATHS, clientVersionWriteGrants, effectiveFunctionComment,
  forwardMigrations, remediationFindings, unreviewedFindings,
} from '../../migrations/__verification__/remediation-descope-guard';
import { resolveEntitlement, type EntitlementInput } from './entitlement';
import { regenerationProvenance } from './interpretation-version-write';

const ROOT = process.cwd();
const PRIMITIVE = 'public.append_interpretation_version_internal(uuid,uuid,uuid,uuid,uuid,jsonb,jsonb,text,text,jsonb)';

describe('A1: no legacy-remediation machinery is reachable', () => {
  it('the removed remediation module, tests, migration and harness sections stay removed', () => {
    expect(REMOVED_PATHS.filter(path => existsSync(join(ROOT, path)))).toEqual([]);
  });

  it('src, e2e, edge functions and migrations hold no remediation identifier or copy beyond reviewed residue', () => {
    expect(unreviewedFindings(ROOT)).toEqual([]);
  });

  it('client code (UI, copy, CTA) has no match at all — no residue is allowed under src/', () => {
    expect(remediationFindings(ROOT).filter(f => f.file.startsWith('src/'))).toEqual([]);
    expect(Object.keys(ALLOWED_RESIDUE).filter(file => file.startsWith('src/'))).toEqual([]);
  });

  it('every allow-listed residue entry still matches exactly (the allow-list cannot go stale)', () => {
    const counts = new Map<string, number>();
    for (const f of remediationFindings(ROOT)) counts.set(f.file, (counts.get(f.file) ?? 0) + 1);
    for (const [file, { lines }] of Object.entries(ALLOWED_RESIDUE)) expect([file, counts.get(file)]).toEqual([file, lines]);
  });

  it('no forward migration defines a remediation function', () => {
    const defs = forwardMigrations(ROOT).flatMap(({ name, sql }) =>
      [...sql.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+([\w.]+)/gi)]
        .filter(m => /remediat|legacy_(eligib|regenerat|grant)/i.test(m[1])).map(m => `${name}: ${m[1]}`));
    expect(defs).toEqual([]);
  });

  it('the generate-interpretation request schema has no mode/remediation field (unknown keys are stripped)', () => {
    const source = readFileSync(join(ROOT, 'supabase/functions/_shared/schemas/requests.ts'), 'utf8');
    const schema = source.match(/GenerateInterpretationRequestSchema = z\.object\(\{([\s\S]*?)\}\)/);
    expect(schema).not.toBeNull();
    const keys = [...schema![1].matchAll(/^\s*(\w+):/gm)].map(m => m[1]).sort();
    expect(keys).toEqual(['primary_canonical_slug', 'reportId', 'request_id']);
    // z.object strips unknown keys unless passthrough/strict changes that.
    expect(source).not.toMatch(/GenerateInterpretationRequestSchema[\s\S]{0,400}\.(passthrough|catchall)\(/);
  });

  it('every appended version is tagged as an ordinary regeneration; the edge sets no other mode', () => {
    expect(regenerationProvenance()).toMatchObject({ pipeline: 'generate-interpretation', mode: 'regeneration' });
    const sources = ['supabase/functions/generate-interpretation/index.ts', 'supabase/functions/_shared/interpretation-version-write.ts']
      .map(file => readFileSync(join(ROOT, file), 'utf8')).join('\n');
    const modes = [...sources.matchAll(/\bmode:\s*["']([\w-]+)["']/g)].map(m => m[1]);
    expect(new Set(modes)).toEqual(new Set(['regeneration']));
  });

  it('negative control: a planted remediation CTA, module or SQL function is caught at its exact line', () => {
    const root = mkdtempSync(join(tmpdir(), 'amani-descope-guard-'));
    try {
      for (const d of ['src/components', 'e2e', 'supabase/functions/_shared', 'supabase/migrations/__verification__']) {
        mkdirSync(join(root, d), { recursive: true });
      }
      writeFileSync(join(root, 'src/components/Clean.tsx'), 'export const ok = "Regenerate interpretation";\n');
      expect(remediationFindings(root)).toEqual([]);
      writeFileSync(join(root, 'src/components/LegacyOffer.tsx'), '\n<Button>Refresh your report free (legacy CTA)</Button>\n');
      writeFileSync(join(root, 'supabase/functions/_shared/x.ts'), 'mode: "legacy_remediation"\n');
      writeFileSync(join(root, 'supabase/migrations/20990101000000_x.sql'), 'select 1;\n\nCREATE FUNCTION public.evaluate_legacy_remediation() ...\n');
      writeFileSync(join(root, 'e2e/x.spec.ts'), "return { allowed: true, reason: 'legacy' };\n");
      expect(remediationFindings(root).map(({ file, line }) => ({ file, line }))).toEqual([
        { file: 'src/components/LegacyOffer.tsx', line: 2 },
        { file: 'e2e/x.spec.ts', line: 1 },
        { file: 'supabase/functions/_shared/x.ts', line: 1 },
        { file: 'supabase/migrations/20990101000000_x.sql', line: 3 },
      ]);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it('negative control: an extra match inside an allow-listed file is not excused', () => {
    const root = mkdtempSync(join(tmpdir(), 'amani-descope-allow-'));
    try {
      const file = 'supabase/functions/_shared/interpretation-read.test.ts';
      mkdirSync(join(root, 'supabase/functions/_shared'), { recursive: true });
      writeFileSync(join(root, file), "it('independent of legacy eligibility', () => {});\n");
      expect(unreviewedFindings(root)).toEqual([]);
      writeFileSync(join(root, file), "it('independent of legacy eligibility', () => {});\nconst remediation = true;\n");
      expect(unreviewedFindings(root).map(f => f.line)).toEqual([1, 2]);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});

describe('A2: no server path grants a $0 or legacy entitlement', () => {
  const NOW = Date.parse('2026-10-12T00:00:00Z');
  const free: EntitlementInput = { stripeStatus: null, iapRecords: [], trialStartDate: null, now: NOW, onboarded: true, freemiumActive: true };

  it('history alone (a past or cancelled payment, old reports, legacy markers) never resolves to Premium', () => {
    const historical = { ...free, stripeStatus: 'canceled', legacyCustomer: true, paidBefore: true, historicalReports: 4 } as EntitlementInput;
    expect(resolveEntitlement(historical)).toEqual({ allowed: true, plan: 'free' });
    expect(resolveEntitlement({ ...free, iapRecords: [{ status: 'expired', expires_at: new Date(NOW - 1).toISOString() }] }))
      .toEqual({ allowed: true, plan: 'free' });
  });

  it.each(['legacy', 'legacy_remediation', 'remediation', 'historical'])('a complimentary row with reason %s grants nothing', reason => {
    const grant = { user_id: 'u', reason, enabled: true, expires_at: null };
    expect(resolveEntitlement({ ...free, userId: 'u', complimentary: grant })).toEqual({ allowed: true, plan: 'free' });
  });

  it('Premium still comes only from a current payment or a reviewed complimentary reason (normal users unchanged)', () => {
    expect(resolveEntitlement({ ...free, stripeStatus: 'active' })).toMatchObject({ plan: 'premium', source: 'active_subscription' });
    expect(resolveEntitlement({ ...free, userId: 'u', complimentary: { user_id: 'u', reason: 'press', enabled: true, expires_at: null } }))
      .toMatchObject({ plan: 'premium', source: 'complimentary' });
  });
});

describe('A3: the version write path stays service-only', () => {
  it('no forward migration grants a version writer to anon, authenticated or PUBLIC', () => {
    expect(clientVersionWriteGrants(ROOT)).toEqual([]);
  });

  it('the effective comment on the storage primitive names no remediation gate', () => {
    const comment = effectiveFunctionComment(ROOT, PRIMITIVE);
    expect(comment).toMatch(/Internal storage primitive/);
    expect(comment).not.toMatch(/remediat/i);
  });

  it('negative control: a client grant and a re-added remediation comment are both detected', () => {
    const root = mkdtempSync(join(tmpdir(), 'amani-descope-sql-'));
    try {
      mkdirSync(join(root, 'supabase/migrations'), { recursive: true });
      writeFileSync(join(root, 'supabase/migrations/20990101000000_a.sql'),
        `COMMENT ON FUNCTION ${PRIMITIVE}\n  IS 'Internal storage primitive.';\n`);
      expect(effectiveFunctionComment(root, PRIMITIVE)).toBe('Internal storage primitive.');
      expect(clientVersionWriteGrants(root)).toEqual([]);
      writeFileSync(join(root, 'supabase/migrations/20990102000000_b.sql'),
        `GRANT EXECUTE ON FUNCTION public.append_interpretation_version(uuid) TO service_role, authenticated;\n` +
        `COMMENT ON FUNCTION ${PRIMITIVE}\n  IS 'Open to claim-only remediation gates.';\n`);
      expect(clientVersionWriteGrants(root)).toHaveLength(1);
      expect(effectiveFunctionComment(root, PRIMITIVE)).toMatch(/remediation/);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
