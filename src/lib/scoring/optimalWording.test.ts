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
 *
 * Standing rule 4: coverage is enumerated per dimension, each with its own
 * probe in the coverage suite below.
 *   Directories: every directory under src is classified. 'excluded' is
 *     proven claim-free by scanning; 'test-data' is proven unimported by
 *     production code. Nothing is accepted on a reason string alone.
 *   Shapes: string literals, assembled templates and JSX text. Only
 *     lowercase snake_case code values are exempt; single words such as
 *     'Normal' or 'Reassuring' are scanned.
 *   Vocabulary: CLAIM below, with inflected forms (bands, ranges, reviews,
 *     concerns, risks, discussing, monitoring). A concept with no listed word
 *     is not covered; REPORT.md lists the known gaps.
 */
const CLAIM = new RegExp('\\b(?:' + [
  'bands?', 'ranges?', 'review\\w*', 'context needed',
  'optimal\\w*', 'optimi[sz]\\w*', 'borderline', '(?:needs|mild) attention', 'urgent\\w*',
  // Whole-string labels only: as words these are dominated by CSS tokens (flag-low).
  '^(?:high|low)$',
  'normal(?:ly)?','abnormal\\w*', 'healthy', 'healthier', 'unhealthy',
  'improv\\w*', 'worsen\\w*', 'deteriorat\\w*', 'better', 'worse',
  'concern\\w*', 'reassur\\w*', 'elevat\\w*', 'deficien\\w*', 'insufficien\\w*',
  'risks?', 'risky', 'suggest\\w*', 'recommend\\w*', 'should', 'caution\\w*',
  'discuss\\w*', 'monitor\\w*', 'talk (?:to|with) your (?:doctor|provider)s?', 'seek care',
  '(?:is|are|was|were|remains?|remained) (?:high|low)', '(?:positive|wrong|right) directions?',
].join('|') + ')\\b', 'i');
// Lowercase snake_case is a code value (AmaniStatus 'normal', bucket 'discuss'),
// the same test the optimal scan above uses. Anything else is potential copy.
const isCodeValue = (text: string) => /^[a-z][a-z0-9_]*$/.test(text);

function clinicalClaimCopy(file: string, source = readFileSync(file, 'utf8')): string[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const hits: string[] = [];
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
      if (!isCodeValue(text) && CLAIM.test(text)) hits.push(text);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return hits.sort();
}

// insightCopy.ts is the ONLY exempt production module: the policy author.
const POLICY_AUTHOR = 'src/lib/scoring/insightCopy.ts';
type CoverageMode = 'scanned' | 'excluded' | 'test-data';
interface DirectoryClassification { directory: string; mode: CoverageMode; reason: string }
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
// Production sources directly inside one directory; children are classified separately.
function directSources(dir: string): string[] {
  return readdirSync(dir).map(name => join(dir, name))
    .filter(path => statSync(path).isFile() && /\.tsx?$/.test(path) && !/\.test\.tsx?$/.test(path));
}
function testDataRoots(base: string): string[] {
  return directoryCoverage.filter(e => e.mode === 'test-data').map(e => join(base, e.directory));
}
// Every .ts/.tsx under src except tests and proven test data: no directory allow-list.
function productionSources(base: string): string[] {
  const testData = testDataRoots(base);
  return sourceFiles(join(base, 'src')).filter(file => !testData.some(root => isUnder(file, root)));
}
function relativeTo(base: string, file: string): string {
  return base === '.' ? file : file.slice(base.length + 1);
}
function assertDirectoryCoverage(base = '.') {
  // Exact directory inventory, not inherited permission from a scanned ancestor:
  // even a new nested directory must be deliberately classified.
  expect(directories(join(base, 'src'))).toEqual(directoryCoverage.map(e => join(base, e.directory)).sort());
  for (const entry of directoryCoverage) {
    expect(entry.reason.trim().length, entry.directory).toBeGreaterThan(0);
    expect(['scanned', 'excluded', 'test-data'], entry.directory).toContain(entry.mode);
    if (entry.mode !== 'excluded') continue;
    // Proven, not asserted: an exclusion holds only while its scan finds nothing.
    const hits = directSources(join(base, entry.directory))
      .flatMap(file => clinicalClaimCopy(file).map(text => `${relativeTo(base, file)}: ${text}`));
    expect(hits, `${entry.directory} is excluded but authors claims`).toEqual([]);
  }
  // Test data stays outside the inventory only because no production module can reach it.
  const testData = testDataRoots(base);
  const testDataNames = testData.map(root => root.split('/').pop()!);
  for (const file of productionSources(base)) {
    for (const { fileName } of ts.preProcessFile(readFileSync(file, 'utf8'), true, true).importedFiles) {
      const target = fileName.startsWith('.') ? join(file, '..', fileName) : fileName;
      const leaks = testData.some(root => isUnder(target, root)) || testDataNames.some(name => fileName.includes(name));
      expect(leaks, `${relativeTo(base, file)} imports test data ${fileName}`).toBe(false);
    }
  }
}
function claimInventory(base = '.') {
  return productionSources(base)
    .filter(file => file !== join(base, POLICY_AUTHOR))
    .flatMap(file => clinicalClaimCopy(file).map(text => ({ file: relativeTo(base, file), text })));
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

  it('vocabulary: plural and inflected forms are claims, not only the singular', () => {
    for (const text of ['Within Amani bands', 'generally within reference ranges.', 'Pending reviews',
      'Two concerns', 'Known risks', 'Worth monitoring', 'Discussing this', 'Values were low']) {
      expect(clinicalClaimCopy('builder.ts', `const copy = ${JSON.stringify(text)};`), text).toEqual([text]);
    }
  });

  it('shape: single-word labels are scanned; only snake_case code values are exempt', () => {
    for (const word of ['Normal', 'Abnormal', 'Reassuring', 'Discuss', 'Monitor', 'NORMAL', 'font-normal']) {
      expect(clinicalClaimCopy('labels.ts', `const l = { label: ${JSON.stringify(word)} };`), word).toEqual([word]);
      expect(clinicalClaimCopy('Label.tsx', `const L = () => <span>${word}</span>;`), word).toEqual([word]);
    }
    // Negative controls: code values and single words outside the vocabulary.
    expect(clinicalClaimCopy('keys.ts', [
      "if (s === 'normal' || s === 'reassuring' || s === 'out_of_range_high') {}",
      "const b = 'discuss'; const m = 'monitor';",
      "const l = { label: 'Track' }; const r = 'Retest';",
    ].join('\n'))).toEqual([]);
  });

  it('every legacy exception has a reason and exact text; new or changed claims fail', () => {
    expect(legacyClaims.every(entry => entry.reason.trim().length > 0)).toBe(true);
    assertClaimInventory();
  });
});


describe('standing rules 3 and 4 — coverage of the clinical-copy guard, one probe per dimension', { timeout: 120_000 }, () => {
  it('classifies every src directory and proves every exclusion by scanning', () => {
    assertDirectoryCoverage();
  });

  // Each probe mutates a copy of src. Both checks pass on the unmodified copy
  // before and after, so a throw is caused by the probe and nothing else.
  function withSrcCopy(prefix: string, body: (dir: string) => void) {
    const dir = mkdtempSync(join(tmpdir(), prefix));
    try {
      cpSync('src', join(dir, 'src'), { recursive: true });
      assertClaimInventory(dir);
      assertDirectoryCoverage(dir);
      body(dir);
      assertClaimInventory(dir);
      assertDirectoryCoverage(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  function withProbe(path: string, content: string, check: () => void) {
    const original = statSync(path, { throwIfNoEntry: false }) ? readFileSync(path, 'utf8') : undefined;
    try {
      writeFileSync(path, original === undefined ? content : `${original}\n${content}\n`);
      check();
    } finally {
      if (original === undefined) rmSync(path, { force: true });
      else writeFileSync(path, original);
    }
  }

  it('directory: a claim in a new directory, outside or under a scanned tree, fails both checks', () => {
    withSrcCopy('claim-dir-', dir => {
      for (const root of ['src/newClinicalSurface', 'src/lib/scoring/newSurface']) {
        const probe = join(dir, root);
        try {
          mkdirSync(probe);
          writeFileSync(join(probe, 'Card.tsx'), 'export const C = () => <p>Your result is healthy.</p>;');
          expect(() => assertDirectoryCoverage(dir), root).toThrow();
          expect(claimInventory(dir)).toContainEqual({ file: `${root}/Card.tsx`, text: 'Your result is healthy.' });
          expect(() => assertClaimInventory(dir), root).toThrow();
        } finally {
          rmSync(probe, { recursive: true, force: true });
        }
      }
    });
  });

  it('directory: a claim inside any excluded directory breaks its exclusion proof', () => {
    const excluded = directoryCoverage.filter(e => e.mode === 'excluded').map(e => e.directory);
    expect(excluded.length).toBeGreaterThan(0);
    withSrcCopy('claim-excluded-', dir => {
      for (const root of excluded) {
        withProbe(join(dir, root, 'UnpinnedClaim.ts'), "export const label = 'Reassuring';", () => {
          expect(() => assertDirectoryCoverage(dir), root).toThrow(/excluded but authors claims/);
          expect(() => assertClaimInventory(dir), root).toThrow();
        });
      }
    });
  });

  it('directory: production code importing test data breaks the test-data exclusion', () => {
    withSrcCopy('claim-testdata-', dir => {
      withProbe(join(dir, 'src/utils/fixtureLeak.ts'), "export * from './parser/__fixtures__/quest';", () => {
        expect(() => assertDirectoryCoverage(dir)).toThrow(/imports test data/);
      });
    });
  });

  it('shape: a single-word claim appended to an already-scanned file fails the inventory', () => {
    withSrcCopy('claim-shape-', dir => {
      for (const [file, word] of <Array<[string, string]>>[
        ['src/components/QuickHighlights.tsx', 'Abnormal'],
        ['src/lib/scoring/statusPill.ts', 'Reassuring'],
        ['src/lib/insights/buildFocusAreas.ts', 'Monitor'],
        ['src/utils/derivedMetrics.ts', 'Normal'],
      ]) {
        withProbe(join(dir, file), `export const probeLabel = ${JSON.stringify(word)};`, () => {
          expect(claimInventory(dir)).toContainEqual({ file, text: word });
          expect(() => assertClaimInventory(dir), file).toThrow();
        });
      }
      // Negative control: a snake_case code value in the same position passes.
      withProbe(join(dir, 'src/lib/scoring/statusPill.ts'), "export const probeKey = 'reassuring';", () => {
        assertClaimInventory(dir);
      });
    });
  });

  it('vocabulary: a plural phrase in every scanned directory fails the inventory', () => {
    const scanned = directoryCoverage.filter(e => e.mode === 'scanned').map(e => e.directory);
    withSrcCopy('claim-vocab-', dir => {
      for (const root of scanned) {
        for (const text of ['Within Amani bands', 'Generally within reference ranges.', 'This worsened and is worth discussing with your provider.']) {
          withProbe(join(dir, root, 'UnpinnedClaim.ts'), `export const copy = ${JSON.stringify(text)};`, () => {
            expect(claimInventory(dir), root).toContainEqual({ file: `${root}/UnpinnedClaim.ts`, text });
            expect(() => assertClaimInventory(dir), root).toThrow();
          });
        }
      }
    });
  });
});
