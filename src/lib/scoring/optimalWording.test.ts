import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/*
  V2-03 amendment 2 (B3): the earlier scan only caught a quote-bounded,
  capitalised "Optimal", so "improved from borderline to optimal range" slipped
  through. This scan parses each file and inspects every string literal,
  template chunk and JSX text node for the word in any casing and position.
  Snake-case keys such as the AmaniStatus value 'optimal' are code, not copy.
  Comments and identifiers are not user-facing and are not scanned.
*/

function sourceFiles(root: string): string[] {
  if (statSync(root).isFile()) return [root];
  return readdirSync(root).flatMap(name => {
    const path = join(root, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

function optimalCopy(file: string, source = readFileSync(file, 'utf8')): string[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const hits: string[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) return;
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateLiteralToken(n) || ts.isJsxText(n)) {
      const text = n.text.trim();
      if (/optimal/i.test(text) && !/^[a-z][a-z0-9_]*$/.test(text)) hits.push(text);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return hits;
}

describe('the scanner can see the defect class it guards', () => {
  it('catches the word in any casing and position, in strings, templates and JSX', () => {
    const source = [
      "const a = 'TSH improved from borderline to optimal range';",
      'const b = `${n} is outside OPTIMAL at ${v}`;',
      'const c = <p>Within the Optimal band</p>;',
      "const d: Record<string, string> = { optimal: 'optimal range' };",
    ].join('\n');
    expect(optimalCopy('probe.tsx', source)).toEqual([
      'TSH improved from borderline to optimal range',
      'is outside OPTIMAL at',
      'Within the Optimal band',
      'optimal range',
    ]);
  });

  it('ignores status keys, comments and identifiers', () => {
    const source = [
      "// optimal range in a comment",
      "if (status === 'optimal' || status === 'out_of_range_high') {}",
      'const optimalMin = 1;',
    ].join('\n');
    expect(optimalCopy('probe.ts', source)).toEqual([]);
  });
});

describe('invariant 3 — no user-facing copy calls an unreviewed band "optimal"', () => {
  it('components, pages, scoring and biomarkers carry no "optimal" copy outside the gated pill', () => {
    const offenders = ['src/components', 'src/pages', 'src/lib/scoring', 'src/lib/biomarkers']
      .flatMap(sourceFiles)
      .flatMap(f => optimalCopy(f).map(text => `${f}: ${text}`))
      // statusPill.ts may say it only behind canDescribeAsOptimal (asserted in amaniContext.test.ts).
      .filter(hit => hit !== `${join('src/lib/scoring', 'statusPill.ts')}: Optimal`);
    expect(offenders).toEqual([]);
  });

  /*
    Known, recorded, NOT fixed: these files are outside TASK-044's allowed paths
    (src/lib/insights) or their wording is a frozen clinical rule
    (src/utils/derivedMetrics.ts, amendment 2 B1 ruling). Pinned exactly so a
    new instance fails here and a removal forces this list to be updated.
    See docs/clinical/V2-03-REPORT.md section 7.
  */
  it('out-of-scope "optimal" copy is pinned, not silently growing', () => {
    const counts = Object.fromEntries(['src/lib/insights', 'src/utils/derivedMetrics.ts']
      .flatMap(sourceFiles)
      .map(f => [f, optimalCopy(f).length] as const)
      .filter(([, n]) => n > 0));
    expect(counts).toEqual({
      [join('src/lib/insights', 'biomarkerExplanations.ts')]: 1,
      [join('src/lib/insights', 'buildFocusAreas.ts')]: 5,
      [join('src/lib/insights', 'buildInsightSummary.ts')]: 8,
      [join('src/lib/insights', 'buildPersonalInsights.ts')]: 3,
      'src/utils/derivedMetrics.ts': 13,
    });
  });
});
