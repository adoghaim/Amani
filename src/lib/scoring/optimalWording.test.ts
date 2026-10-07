import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
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

/*
  V2-03 amendment 3. Pinning out-of-scope definitions by count did not stop them
  rendering: TopFinding.fact and FocusArea.whyItMatters reached the report page
  verbatim. This scan follows the render path with the type checker. For every
  JSX child expression in components and pages it finds each string read from a
  property, or returned by a function, declared in an out-of-scope copy source,
  following local consts to their initialisers. A read passes only inside a
  qualifier from insightCopy.ts. The rest are listed exactly below, each with
  the reason it cannot carry the word, so a new unqualified sink fails here.
*/
const OUT_OF_SCOPE_COPY = /[\\/]src[\\/](lib[\\/]insights[\\/]|utils[\\/]derivedMetrics\.ts$)/;
const QUALIFIERS = new Set(['withoutOptimalClaims', 'primaryFindingSentence']);
// Names, units, ids and dates, not sentences. Display names come from
// src/lib/biomarkers/dictionary, which the copy scan above already covers.
const IDENTITY_FIELDS = new Set([
  'TopFinding.displayName', 'BiggestChange.displayName', 'FocusAreaMarker.displayName',
  'TopFinding.unit', 'BiggestChange.unit', 'FocusArea.id', 'FocusAreaMarker.slug',
  'BiggestChange.priorReportDate', 'formatPriorReportDate',
  // A numeric interval such as "5–25 ng/mL".
  'TopFinding.rangeLabel',
  // boundaryCrossing.direction: 'improved' | 'worsened' | 'stable' from compareReports, typed string.
  'BiggestChange.direction',
]);
const RENDER_SINKS_REVIEWED = [
  // Questions that claim optimality are dropped whole by claimsOptimal before
  // render, a filter this scan cannot see; proven in FocusAreas.test.tsx.
  'src/components/DoctorQuestionsCard.tsx: DoctorQuestion.text',
  // Rule titles in buildFocusAreas.ts; none says "optimal", held by the count pin above.
  'src/components/FocusAreas.tsx: FocusArea.title',
  // Watch-signal titles; none says "optimal", held by the count pin above. Not rendered by any route.
  'src/components/WhatToWatchCard.tsx: WatchSignal.title',
  // buildHealthStory.ts has no "optimal" string, held by the count pin above.
  'src/components/YourHealthStory.tsx: HealthStorySentence.text',
].sort();

function unqualifiedRenderSinks(roots: string[]): string[] {
  const files = roots.flatMap(sourceFiles).filter(f => f.endsWith('.tsx'));
  const program = ts.createProgram(files, {
    target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
    jsx: ts.JsxEmit.ReactJSX, strict: true, skipLibCheck: true, noEmit: true, allowImportingTsExtensions: true,
  });
  const checker = program.getTypeChecker();
  const declaredOutOfScope = (symbol: ts.Symbol | undefined) => {
    const target = symbol && symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
    return !!target?.declarations?.some(d => OUT_OF_SCOPE_COPY.test(d.getSourceFile().fileName));
  };
  // "Interface.field" for a property, the function name for a call.
  const declaredName = (symbol: ts.Symbol): string => {
    const target = symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
    let owner: ts.Node | undefined = target.declarations?.[0]?.parent;
    while (owner && !ts.isInterfaceDeclaration(owner) && !ts.isTypeAliasDeclaration(owner)) owner = owner.parent;
    return owner ? `${owner.name.text}.${target.name}` : target.name;
  };
  // Free text only: a literal-union field such as status or direction is a
  // closed set of code values that cannot carry a sentence.
  const isString = (n: ts.Node) => {
    const type = checker.getNonNullableType(checker.getTypeAtLocation(n));
    const parts = type.isUnion() ? type.types : [type];
    return parts.every(t => !!(t.flags & ts.TypeFlags.StringLike)) && parts.some(t => !!(t.flags & ts.TypeFlags.String));
  };
  const hits: string[] = [];
  for (const file of files) {
    const sf = program.getSourceFile(file)!;
    const rel = file;
    const trace = (n: ts.Node, seen: Set<ts.Node>): void => {
      if (seen.has(n)) return;
      seen.add(n);
      if (ts.isCallExpression(n)) {
        const callee = ts.isPropertyAccessExpression(n.expression) ? n.expression.name : n.expression;
        if (ts.isIdentifier(callee) && QUALIFIERS.has(callee.text)) return;
        const symbol = checker.getSymbolAtLocation(callee);
        if (declaredOutOfScope(symbol) && isString(n) && !IDENTITY_FIELDS.has(declaredName(symbol!))) {
          hits.push(`${rel}: ${declaredName(symbol!)}()`);
        }
      }
      if (ts.isPropertyAccessExpression(n)) {
        const symbol = checker.getSymbolAtLocation(n.name);
        if (declaredOutOfScope(symbol) && isString(n) && !IDENTITY_FIELDS.has(declaredName(symbol!))) {
          hits.push(`${rel}: ${declaredName(symbol!)}`);
        }
      }
      if (ts.isIdentifier(n) && !ts.isPropertyAccessExpression(n.parent)) {
        const decl = checker.getSymbolAtLocation(n)?.valueDeclaration;
        if (decl && ts.isVariableDeclaration(decl) && decl.initializer && decl.getSourceFile() === sf) trace(decl.initializer, seen);
      }
      ts.forEachChild(n, c => trace(c, seen));
    };
    const visit = (n: ts.Node) => {
      if (ts.isJsxExpression(n) && n.expression && !ts.isJsxAttribute(n.parent)) trace(n.expression, new Set());
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  return [...new Set(hits)].sort();
}

describe('invariant 3 — out-of-scope copy cannot reach the page unqualified', () => {
  it('the render-path scan sees the amendment-3 defect class', () => {
    const dir = mkdtempSync(join(tmpdir(), 'render-sink-'));
    try {
      const probe = join(dir, 'Probe.tsx');
      writeFileSync(probe, [
        `import type { TopFinding } from '${join(process.cwd(), 'src/lib/insights/buildInsightSummary')}';`,
        `import type { FocusArea } from '${join(process.cwd(), 'src/lib/insights/buildFocusAreas')}';`,
        `import { withoutOptimalClaims } from '${join(process.cwd(), 'src/lib/scoring/insightCopy')}';`,
        'export function A({ f }: { f: TopFinding }) { return <p>{f.fact}</p>; }',
        'export function B({ a }: { a: FocusArea }) { const why = a.whyItMatters; return <p>{why}</p>; }',
        'export function C({ a }: { a: FocusArea }) { return <p>{withoutOptimalClaims(a.whyItMatters)}</p>; }',
      ].join('\n'));
      expect(unqualifiedRenderSinks([dir])).toEqual([`${probe}: FocusArea.whyItMatters`, `${probe}: TopFinding.fact`]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it('every unqualified sink in components and pages is listed with its reason', () => {
    expect(unqualifiedRenderSinks(['src/components', 'src/pages'])).toEqual(RENDER_SINKS_REVIEWED);
  }, 120_000);
});

/* Standing rule 2: qualifiers do not permit authorship of new clinical prose
 * outside insightCopy. Scan producers as well as JSX sinks, including unused
 * branches. Exact legacy exceptions are debt, not clinical authorization.
 * This is a lexical guard, not a proof that arbitrary English is claim-free.
 */
function clinicalClaimCopy(file: string, source = readFileSync(file, 'utf8')): string[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const hits: string[] = [];
  const claim = /\b(?:band|range|review(?:ed)?|context needed|optimal|normal|abnormal|healthy|unhealthy|improv\w*|worsen\w*|deteriorat\w*|better|worse|concerning|reassuring|elevated|deficien\w*|insufficien\w*|risk|suggest\w*|recommend\w*|should|caution|worth discussing|talk to your doctor|seek care|(?:is|are|remains?) (?:high|low)|(?:positive|wrong|right) direction)\b/i;
  const visit = (n: ts.Node) => {
    if (ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) return;
    // Assemble template chunks so interpolations cannot split a claim into
    // seemingly harmless fragments. Inspect nested expressions separately.
    let text: string | undefined;
    if (ts.isTemplateExpression(n)) {
      text = n.head.text + n.templateSpans.map(s => '${…}' + s.literal.text).join('');
    } else if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isJsxText(n)) {
      text = n.text;
    }
    if (text !== undefined) {
      text = text.trim().replace(/\s+/g, ' ');
      // Status keys and class names are not prose. Short labels containing
      // spaces ARE scanned: a claim need not end with punctuation.
      if (/\s/.test(text) && claim.test(text)) hits.push(text);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return hits.sort();
}

const CLAIM_ROOTS = [
  'src/lib/insights', 'src/components', 'src/pages', 'src/lib/scoring',
  'src/utils', 'src/lib/personalization', 'src/lib/biomarkers',
  'src/features', 'src/contexts', 'src/hooks', 'src/lib/cards',
];
// insightCopy.ts is the ONLY exempt production module: the policy author.
// Parser fixtures/snapshots and test files are test data, not production authors.
const POLICY_AUTHOR = 'src/lib/scoring/insightCopy.ts';
const TEST_DATA_ROOTS = ['src/utils/parser/__fixtures__', 'src/utils/parser/__snapshots__'];
interface DirectoryClassification { directory: string; mode: 'scanned' | 'excluded'; reason: string }
const directoryCoverage = JSON.parse(readFileSync('docs/clinical/TASK-045/claim-directory-coverage.json', 'utf8')) as DirectoryClassification[];

function directories(root: string): string[] {
  return [root, ...readdirSync(root).flatMap(name => {
    const path = join(root, name);
    return statSync(path).isDirectory() ? directories(path) : [];
  })].sort();
}
function isUnder(path: string, root: string): boolean {
  return path === root || path.startsWith(root + '/');
}
function assertDirectoryCoverage(base = '.') {
  // Exact directory inventory, not inherited permission from a scanned ancestor:
  // even a new nested directory must be deliberately classified.
  expect(directories(join(base, 'src'))).toEqual(directoryCoverage.map(e => join(base, e.directory)).sort());
  for (const entry of directoryCoverage) {
    expect(entry.reason.trim().length).toBeGreaterThan(0);
    const scanned = CLAIM_ROOTS.some(root => isUnder(entry.directory, root))
      && !TEST_DATA_ROOTS.some(root => isUnder(entry.directory, root));
    expect(entry.mode, entry.directory).toBe(scanned ? 'scanned' : 'excluded');
  }
}
function claimInventory(base = '.') {
  return CLAIM_ROOTS.flatMap(root => sourceFiles(join(base, root)))
    .filter(file => file !== join(base, POLICY_AUTHOR)
      && !TEST_DATA_ROOTS.some(root => isUnder(file, join(base, root))))
    .flatMap(file => clinicalClaimCopy(file).map(text => ({ file: file.slice(base === '.' ? 0 : base.length + 1), text })));
}
function assertClaimInventory(base = '.') {
  expect(claimInventory(base)).toEqual(legacyClaims.map(({ file, text }) => ({ file, text })));
}
interface LegacyClaimException { file: string; text: string; reason: string }
const legacyClaims = JSON.parse(readFileSync('docs/clinical/TASK-045/legacy-claim-exceptions.json', 'utf8')) as LegacyClaimException[];

describe('standing rule 2 — policy owns clinical-language sentences', () => {
  it('detects placement, review state and clinical meaning in builders and JSX', () => {
    const sentences = [
      "This marker remains outside Amani's current comparison band.",
      'This band has not yet completed clinical review.',
      'Interpretation unavailable pending clinical review.',
      'Your result is healthy.',
      'This worsened and is worth discussing.',
      'Your result is low.',
    ];
    for (const sentence of sentences) {
      expect(clinicalClaimCopy('builder.ts', `const copy = ${JSON.stringify(sentence)};`)).toEqual([sentence]);
      expect(clinicalClaimCopy('Card.tsx', `<p>${sentence}</p>`)).toEqual([sentence]);
    }
    expect(clinicalClaimCopy('builder.ts', 'const copy = `${name} remains ${placement} the comparison band.`;'))
      .toEqual(['${…} remains ${…} the comparison band.']);
    expect(clinicalClaimCopy('builder.ts', "// This worsened.\nconst status = 'newly_abnormal';" )).toEqual([]);
  });

  it('every legacy exception has a reason and exact text; new or changed claims fail', () => {
    expect(legacyClaims.every(entry => entry.reason.trim().length > 0)).toBe(true);
    assertClaimInventory();
  });
});


describe('standing rule 3 — coverage of the clinical-copy guard', () => {
  it('classifies every src directory, including excluded user-visible producers', () => {
    assertDirectoryCoverage();
  });

  it('rejects unpinned claims in every newly required root, outside the original three', () => {
    const dir = mkdtempSync(join(tmpdir(), 'claim-inventory-'));
    try {
      cpSync('src', join(dir, 'src'), { recursive: true });
      assertClaimInventory(dir); // Positive control uses the same real inventory.
      for (const root of ['src/lib/scoring', 'src/utils', 'src/lib/personalization', 'src/lib/biomarkers']) {
        const probe = join(dir, root, 'UnpinnedClaim.ts');
        try {
          writeFileSync(probe, "export const copy = 'This worsened and is worth discussing with your provider.';");
          expect(claimInventory(dir)).toContainEqual({ file: root + '/UnpinnedClaim.ts', text: 'This worsened and is worth discussing with your provider.' });
          expect(() => assertClaimInventory(dir)).toThrow();
        } finally {
          rmSync(probe, { force: true });
        }
      }
      assertClaimInventory(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects a new producer directory outside all scanned roots and under a scanned root', () => {
    const dir = mkdtempSync(join(tmpdir(), 'claim-coverage-'));
    try {
      cpSync('src', join(dir, 'src'), { recursive: true });
      assertDirectoryCoverage(dir);
      for (const root of ['src/newClinicalSurface', 'src/lib/scoring/newSurface']) {
        const probe = join(dir, root);
        try {
          mkdirSync(probe);
          writeFileSync(join(probe, 'Card.tsx'), '<p>Your result is healthy.</p>');
          expect(() => assertDirectoryCoverage(dir)).toThrow();
        } finally {
          rmSync(probe, { recursive: true, force: true });
        }
      }
      assertDirectoryCoverage(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
