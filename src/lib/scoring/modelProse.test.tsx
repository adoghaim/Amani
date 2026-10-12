import { mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import {
  authorizeModelProse, createMovementClaim, MODEL_PROSE_FIELDS, movementClaimsByKey, resolveModelProposal,
  type MeasuredMovement,
} from './insightCopy';
import * as edge from '../../../supabase/functions/_shared/clinical-movement-policy.generated';
import { MODEL_CANARIES } from './modelProse.testkit';
import { modelCanaries as BROWSER_CANARIES } from '../../../e2e/reports/synthetic-reports';

it('the browser fixture carries the same canaries as the logic fixture', () => {
  expect([...BROWSER_CANARIES]).toEqual([...MODEL_CANARIES]);
});

/*
  V2-03b turn 13, owner R1: "No free-form model-written clinical statement may
  render directly to the user merely because the model generated it." One
  gate, the movement kernel's validator, now stands between every model field
  and the renderer. These are its logic and structural proofs; the page and
  browser proofs are in ReportView.language.test.tsx and the E2E spec.
*/
const TSH: MeasuredMovement = { displayName: 'TSH', previousValue: 6, currentValue: 9, unit: 'uIU/mL', significance: 'significant' };
const FERRITIN: MeasuredMovement = { displayName: 'Ferritin', previousValue: 25, currentValue: 20, unit: 'ng/mL', significance: 'moderate' };

describe('the gate: a model proposal renders only as an issued claim phrase', () => {
  it('owner example: rephrasing is allowed, strengthening is not, by rewording or by addition', () => {
    const claims = [createMovementClaim(TSH)];
    expect(resolveModelProposal(claims, 'Your TSH increased from your previous result.')?.claim).toBe(claims[0]);
    expect(resolveModelProposal(claims, 'TSH increased from 6 to 9 uIU/mL.')?.authority)
      .toEqual({ kind: 'lab_data', subject: 'TSH', previous: 6, current: 9, unit: 'uIU/mL' });
    for (const proposal of ['Your thyroid health has worsened.', 'Your TSH increased from your previous result, which is concerning.',
      'Your TSH increased from your previous result. Ask about medication.', 'Your TSH decreased from your previous result.',
      'TSH increased from 6 to 19 uIU/mL.', ...MODEL_CANARIES, '', null, 42, { text: 'Your TSH increased from your previous result.' }]) {
      expect(resolveModelProposal(claims, proposal), String(proposal)).toBeNull();
    }
  });

  it('a claim authorizes only its own fact: another marker\'s sentence needs that marker\'s claim', () => {
    const tsh = createMovementClaim(TSH);
    const ferritin = createMovementClaim(FERRITIN);
    const sentence = 'Your Ferritin decreased from your previous result.';
    expect(resolveModelProposal([tsh], sentence)).toBeNull();
    expect(resolveModelProposal([tsh, ferritin], sentence)?.claim).toBe(ferritin);
  });

  it('no claims, no render: forged and deserialized claims grant nothing', () => {
    const claim = createMovementClaim(TSH);
    const proposal = 'Your TSH increased from your previous result.';
    expect(resolveModelProposal([], proposal)).toBeNull();
    expect(resolveModelProposal([JSON.parse(JSON.stringify(claim))], proposal)).toBeNull();
    expect(resolveModelProposal([{ ...claim }], proposal)).toBeNull();
  });
});

describe('coverage, per dimension (standing rule 4)', () => {
  it('the model-field inventory is pinned: a new model field must be classified here first', () => {
    expect(MODEL_PROSE_FIELDS).toEqual([
      'interpretation.headline', 'interpretation.summary_bullets', 'interpretation.pattern_signals.title',
      'interpretation.pattern_signals.explanation', 'interpretation.cycle_context.explanation', 'interpretation.disclaimer',
      'interpretation.biomarkers.plain_english_meaning', 'interpretation.biomarkers.timing_notes',
      'interpretation.biomarkers.common_non_alarm_reasons', 'interpretation.biomarkers.when_clinicians_follow_up',
      'insights.summary', 'insights.notable_changes.change', 'insights.notable_changes.possible_factors',
      'basic.basic_interpretation', 'basic.preview',
    ]);
  });

  it.each(MODEL_PROSE_FIELDS)('%s: canaries and strengthened phrases are suppressed; the authorized phrase carries its claim', field => {
    const claims = [...movementClaimsByKey([['tsh', TSH], ['ferritin', FERRITIN]] as const).values()];
    for (const proposal of [...MODEL_CANARIES, 'Your thyroid health has worsened.']) {
      expect(authorizeModelProse(field, proposal, claims)).toEqual([]);
      expect(authorizeModelProse(field, [proposal], claims)).toEqual([]);
    }
    const authorized = authorizeModelProse(field, [MODEL_CANARIES[0], 'Your TSH increased from your previous result.',
      ' Your TSH increased from your previous result. ', 'Ferritin decreased from 25 to 20 ng/mL.'], claims);
    expect(authorized.map(p => [p.field, p.language.text, p.language.claim.fact.displayName])).toEqual([
      [field, 'Your TSH increased from your previous result.', 'TSH'],
      [field, 'Ferritin decreased from 25 to 20 ng/mL.', 'Ferritin'],
    ]);
    for (const p of authorized) {
      expect(p.language.claim).toMatchObject({ recommendationAuthority: 'none', safetyAuthority: 'none', category: 'factual_observation' });
      expect(p.language.cue).toBe('neutral');
    }
  });

  it('movementClaimsByKey issues nothing for a change that cannot be a claim', () => {
    const claims = movementClaimsByKey([
      ['a', TSH], ['b', { ...TSH, currentValue: Number.NaN }], ['c', { ...TSH, significance: 'large' as never }],
    ] as const);
    expect([...claims.keys()]).toEqual(['a']);
  });
});

describe('the server copy carries the same gate (generated, byte-identity checked)', () => {
  it('client and generated server resolve identically, and neither accepts the other\'s claims', () => {
    const client = [createMovementClaim(TSH)];
    const server = [edge.createMovementClaim(TSH)];
    for (const proposal of ['Your TSH increased from your previous result.', 'Your thyroid health has worsened.', ...MODEL_CANARIES]) {
      expect(edge.resolveModelProposal(server, proposal)?.text ?? null).toBe(resolveModelProposal(client, proposal)?.text ?? null);
    }
    // Capabilities are process-local: a claim is reconstructed from facts, never passed across.
    expect(edge.resolveModelProposal(client as never, 'Your TSH increased from your previous result.')).toBeNull();
    expect(resolveModelProposal(server as never, 'Your TSH increased from your previous result.')).toBeNull();
  });
});

/*
  Standing rule 2, structurally. A page check sees only what a fixture puts on
  the page; this sees every component and page. Any read of a model-written
  string (a string field declared on a model output type, or the freemium
  helpers that return model text) must sit inside the arguments of
  authorizeModelProse. The parser that normalizes the stored payload is the
  one declared exception: it copies fields, it renders nothing.
*/
const MODEL_TYPES = new Set(['AIInterpretation', 'AIPatternSignal', 'AIPrimaryConcern', 'AIKeyFinding', 'AITopFinding', 'Insight']);
// Anchored at a separator OR the start: scanned root files are relative paths,
// imported ones absolute (a negative control found the relative case unseen).
const MODEL_TYPE_FILES = /(?:^|[\\/])src[\\/](?:types[\\/]index\.ts|components[\\/]InsightsModal\.tsx)$/;
const MODEL_TEXT_FUNCTIONS = new Set(['basicInterpretationText', 'previewText']);
const PARSERS = new Set(['normalizeInterpretation']);
// Lookup keys (a marker's name or slug). Allowed as keys, never as text: a read
// inside any JSX expression other than a `key` attribute is still a hit.
const IDENTITY_FIELDS = new Set(['name', 'biomarker_slug']);
// Not reachable from src/main.tsx (optimalWording.test.ts proves reachability
// and pins its 'unreachable' debt). Deleting it removes this entry.
const UNREACHABLE = new Set(['src/components/QuickHighlights.tsx']);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

function unauthorizedModelReads(files: string[], typeFiles = MODEL_TYPE_FILES): string[] {
  const program = ts.createProgram(files, {
    target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
    jsx: ts.JsxEmit.ReactJSX, strict: true, skipLibCheck: true, noEmit: true, allowImportingTsExtensions: true,
  });
  const checker = program.getTypeChecker();
  const ownerOf = (symbol: ts.Symbol): string | null => {
    const decl = symbol.declarations?.[0];
    if (!decl || !typeFiles.test(decl.getSourceFile().fileName)) return null;
    let node: ts.Node | undefined = decl.parent;
    while (node && !ts.isInterfaceDeclaration(node) && !ts.isTypeAliasDeclaration(node)) node = node.parent;
    return node && MODEL_TYPES.has(node.name.text) ? node.name.text : null;
  };
  const carriesText = (n: ts.Node) => {
    const type = checker.getNonNullableType(checker.getTypeAtLocation(n));
    const element = checker.isArrayType(type) ? checker.getTypeArguments(type as ts.TypeReference)[0]! : type;
    const parts = element.isUnion() ? element.types : [element];
    return parts.some(t => !!(t.flags & ts.TypeFlags.String));
  };
  const renderedInJsx = (n: ts.Node): boolean => {
    for (let p: ts.Node | undefined = n.parent; p; p = p.parent) {
      if (ts.isJsxExpression(p)) return !(ts.isJsxAttribute(p.parent) && p.parent.name.getText() === 'key');
    }
    return false;
  };
  const hits: string[] = [];
  for (const file of files) {
    const visit = (n: ts.Node): void => {
      if (ts.isFunctionDeclaration(n) && n.name && PARSERS.has(n.name.text)) return;
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'authorizeModelProse') return;
      if (ts.isPropertyAccessExpression(n)) {
        const symbol = checker.getSymbolAtLocation(n.name);
        const owner = symbol && ownerOf(symbol);
        if (owner && carriesText(n) && (!IDENTITY_FIELDS.has(n.name.text) || renderedInJsx(n))) {
          hits.push(`${file}: ${owner}.${n.name.text}`);
        }
      }
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && MODEL_TEXT_FUNCTIONS.has(n.expression.text)) {
        hits.push(`${file}: ${n.expression.text}()`);
      }
      ts.forEachChild(n, visit);
    };
    visit(program.getSourceFile(file)!);
  }
  return [...new Set(hits)].sort();
}

describe('policy-only authorship of model fields, by the type checker (standing rule 2)', () => {
  it('the scan sees each way model text could reach a renderer', () => {
    const dir = mkdtempSync(join(tmpdir(), 'model-prose-'));
    try {
      const probe = join(dir, 'Probe.tsx');
      const root = process.cwd();
      writeFileSync(probe, [
        `import type { AIInterpretation } from '${join(root, 'src/types')}';`,
        `import { previewText, type PremiumPreview } from '${join(root, 'src/lib/freemium/interpretationAccess')}';`,
        `import { authorizeModelProse } from '${join(root, 'src/lib/scoring/insightCopy')}';`,
        'export function A({ i }: { i: AIInterpretation }) { return <ul>{i.summary_bullets.map(b => <li key={b}>{b}</li>)}</ul>; }',
        'export function B({ i }: { i: AIInterpretation }) { return <p title={i.headline}>x</p>; }',
        'export function C({ i }: { i: AIInterpretation }) { const s = i.pattern_signals[0]!; return <p>{s.explanation}</p>; }',
        'export function D({ p }: { p: PremiumPreview }) { const t = previewText(p); return <p>{t?.body}</p>; }',
        'export function E({ i }: { i: AIInterpretation }) { return <p>{authorizeModelProse(\'interpretation.headline\', i.headline, []).length}</p>; }',
        'export function F({ i }: { i: AIInterpretation }) { return <p>{i.pattern_signals.length}</p>; }',
        // A lookup key is not text; rendering the same field is.
        'export function G({ i }: { i: AIInterpretation }) { const m = new Map((i.biomarkers ?? []).map(b => [b.name, b])); return <p>{m.size}</p>; }',
        'export function H({ i }: { i: AIInterpretation }) { return <ul>{(i.biomarkers ?? []).map(b => <li key={b.name}>{b.name}</li>)}</ul>; }',
      ].join('\n'));
      expect(unauthorizedModelReads([probe], /[\\/]src[\\/]types[\\/]index\.ts$/)).toEqual([
        `${probe}: AIInterpretation.headline`, `${probe}: AIInterpretation.name`, `${probe}: AIInterpretation.summary_bullets`,
        `${probe}: AIPatternSignal.explanation`, `${probe}: previewText()`,
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    // Both path shapes the program reports: relative roots and absolute imports.
    for (const path of ['src/components/InsightsModal.tsx', join(process.cwd(), 'src/types/index.ts'), 'src/types/index.ts']) {
      expect(MODEL_TYPE_FILES.test(path), path).toBe(true);
    }
    expect(MODEL_TYPE_FILES.test('src/notsrc/types/index.ts')).toBe(false);
  }, 60_000);

  it('no component or page reads model prose except through authorizeModelProse', () => {
    const files = ['src/components', 'src/pages'].flatMap(sourceFiles);
    for (const file of UNREACHABLE) expect(files, file).toContain(file);
    expect(unauthorizedModelReads(files.filter(f => !UNREACHABLE.has(f)))).toEqual([]);
    // The exemption hides exactly what it names, and nothing reachable.
    expect(unauthorizedModelReads([...UNREACHABLE]).length).toBeGreaterThan(0);
  }, 120_000);
});
