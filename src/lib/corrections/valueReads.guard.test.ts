import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

/*
  R18 guard (PK-CORRECT-01): no code reads a value from the raw value tables
  directly, and none names the corrected views directly. Every value reader
  picks its table through the flag-gated helper of its runtime
  (src/lib/corrections/valueTables.ts, supabase/functions/_shared/value-corrections.ts),
  so it reads the corrected views once features.value_corrections is on.

  Allowed:
    - the upload writer, src/pages/NewReport.tsx (it inserts the rows);
    - the dev-only parser debugger, src/pages/ParserDebugger.tsx (it shows
      what the parser stored, and saves values through correct_analyte);
    - a read that selects no value column at all (Reports.tsx counts rows by
      lab_report_id).
  A new reader that writes `.from('biomarkers').select('*')` fails here, so a
  screen cannot silently show a misread value or its old flag.
*/

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const SCANNED = ['src', 'supabase/functions'];
const ALLOWED_FILES = new Set(['src/pages/NewReport.tsx', 'src/pages/ParserDebugger.tsx']);
const HELPERS = new Set(['src/lib/corrections/valueTables.ts', 'supabase/functions/_shared/value-corrections.ts']);
const RAW = /\.from\(\s*(['"`])(biomarkers|report_analytes)\1\s*\)/g;
const VIEWS = /(['"`])(biomarkers_corrected|report_analytes_corrected)\1/;

/** Columns that carry no value: identity and bookkeeping only. */
const NON_VALUE_COLUMNS = new Set(['id', 'lab_report_id', 'name', 'canonical_slug', 'canonical_analyte_id', 'raw_name',
  'display_name', 'is_core', 'parse_status', 'created_at', 'review_status', 'reviewed_by_user', 'needs_review']);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(entry => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return entry === 'node_modules' ? [] : sourceFiles(path);
    return /\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry) && !/\.testkit\.ts$/.test(entry) ? [path] : [];
  });
}

/** Every raw-table value read in `source`, as "file:line what". */
export function rawValueReads(file: string, source: string): string[] {
  const findings: string[] = [];
  for (const match of source.matchAll(RAW)) {
    const after = source.slice(match.index! + match[0].length);
    // The chain up to the end of the statement.
    const chain = after.slice(0, after.search(/;|\n\s*\n/) === -1 ? after.length : after.search(/;|\n\s*\n/));
    const line = source.slice(0, match.index).split('\n').length;
    const write = /^\s*\.(insert|update|upsert|delete)\(/.exec(chain);
    if (write) {
      findings.push(`${file}:${line} ${write[1]} on ${match[2]}`);
      continue;
    }
    const select = /^\s*\.select\(\s*(['"`])([^'"`]*)\1/.exec(chain);
    if (!select) {
      findings.push(`${file}:${line} ${match[2]} read without a literal column list`);
      continue;
    }
    const columns = select[2]!.split(',').map(c => c.trim());
    const valueColumns = columns.filter(c => !NON_VALUE_COLUMNS.has(c));
    if (valueColumns.length > 0) findings.push(`${file}:${line} ${match[2]} select(${valueColumns.join(', ')})`);
  }
  return findings;
}

const files = SCANNED.flatMap(dir => sourceFiles(join(ROOT, dir))).map(path => ({
  file: relative(ROOT, path).split('\\').join('/'),
  source: readFileSync(path, 'utf8'),
}));

describe('R18 guard: value reads go through the flag-gated table helper', () => {
  it('no raw-table value read outside the upload writer and the parser debugger', () => {
    const findings = files.filter(f => !ALLOWED_FILES.has(f.file)).flatMap(f => rawValueReads(f.file, f.source));
    expect(findings).toEqual([]);
  });

  it('the corrected views are named only by the two helpers', () => {
    const named = files.filter(f => !HELPERS.has(f.file) && VIEWS.test(f.source)).map(f => f.file);
    expect(named).toEqual([]);
  });

  it('the readers it moved go through the helpers', () => {
    const reads = (file: string) => files.find(f => f.file === file)!.source;
    expect(reads('src/pages/Dashboard.tsx')).toContain('readDashboardBiomarkers');
    expect(reads('src/pages/Tracker.tsx')).toContain('readTrackerBiomarkers');
    for (const reader of ['readReportValues', 'readPreviousBiomarkers', 'readHistoricalBiomarkers']) {
      expect(reads('src/pages/ReportView.tsx')).toContain(reader);
    }
    expect(reads('supabase/functions/lab-insights/index.ts')).toContain('loadComparisonBiomarkers(');
    expect(reads('supabase/functions/generate-interpretation/index.ts')).toContain('loadInterpretationAnalytes(');
    expect(reads('src/lib/corrections/valueReaders.ts').match(/valueTables\(\)/g)?.length).toBeGreaterThanOrEqual(5);
  });

  it('is not vacuous: it finds the shapes a forgotten reader would take', () => {
    expect(rawValueReads('x.tsx', "await supabase.from('biomarkers').select('*').in('lab_report_id', ids);"))
      .toEqual(["x.tsx:1 biomarkers select(*)"]);
    expect(rawValueReads('x.ts', 'await supabase\n  .from("report_analytes")\n  .select("id, value_numeric, unit")\n  .eq("x", 1);'))
      .toEqual(['x.ts:2 report_analytes select(value_numeric, unit)']);
    expect(rawValueReads('x.ts', "supabase.from('biomarkers').update({ value: 1 }).eq('id', id);"))
      .toEqual(['x.ts:1 update on biomarkers']);
    expect(rawValueReads('x.ts', "supabase.from('biomarkers').select(columns);"))
      .toEqual(['x.ts:1 biomarkers read without a literal column list']);
    expect(rawValueReads('x.ts', "supabase.from('biomarkers').select('lab_report_id').in('lab_report_id', ids);")).toEqual([]);
    // The two allowed files really do read or write the raw tables.
    for (const file of ALLOWED_FILES) {
      expect(rawValueReads(file, files.find(f => f.file === file)!.source).length, file).toBeGreaterThan(0);
    }
  });
});
