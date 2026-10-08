import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { INSIGHT_RULES } from '../../utils/derivedMetrics';
import { ANALYTE_FREE_RULES, ruleDependency } from './insightGate';

/*
  V2-03 amendment 4, R3. A rule's biomarkers_involved is safety metadata: the
  context gate checks exactly those analytes, so an undeclared read would
  bypass it silently. Two independent proofs, both directions, no inspection:

  1. Static. The TypeScript AST of every check body in src/utils/derivedMetrics.ts.
     Every use of the metrics parameter must be m['<literal>']; any other use
     (a computed key, m.x, passing m on, spreading or destructuring it) means
     the dependency cannot be established and the proof fails.
  2. Dynamic. Each real check runs against a Proxy that records every key it
     touches, over many synthetic panels and phases; enumeration fails the proof.

  V2-03b Stage 2 changed each check's return from prose to a boolean match;
  no threshold or condition changed, and both proofs run over the new bodies.
*/

const SOURCE = 'src/utils/derivedMetrics.ts';

interface StaticRule {
  ruleId: string;
  declared: string[] | null;
  reads: Set<string>;
  unresolved: string[];
}

function analyse(fileName: string, text: string): StaticRule[] | null {
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true);
  let array: ts.ArrayLiteralExpression | null = null;
  const find = (n: ts.Node) => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === 'INSIGHT_RULES'
      && n.initializer && ts.isArrayLiteralExpression(n.initializer)) array = n.initializer;
    ts.forEachChild(n, find);
  };
  find(sf);
  if (!array) return null;
  return (array as ts.ArrayLiteralExpression).elements.map(el => {
    const rule: StaticRule = { ruleId: '?', declared: null, reads: new Set(), unresolved: [] };
    if (!ts.isObjectLiteralExpression(el)) {
      rule.unresolved.push('rule is not an object literal');
      return rule;
    }
    for (const prop of el.properties) {
      if (!ts.isPropertyAssignment(prop) || !ts.isIdentifier(prop.name)) {
        rule.unresolved.push(`unsupported property ${prop.getText(sf).slice(0, 40)}`);
        continue;
      }
      const name = prop.name.text;
      const init = prop.initializer;
      if (name === 'rule_id') {
        if (ts.isStringLiteral(init)) rule.ruleId = init.text;
        else rule.unresolved.push('rule_id is not a literal');
      } else if (name === 'biomarkers_involved') {
        if (ts.isArrayLiteralExpression(init) && init.elements.every(ts.isStringLiteral)) {
          rule.declared = init.elements.map(e => (e as ts.StringLiteral).text);
        } else rule.unresolved.push('biomarkers_involved is not a literal string array');
      } else if (name === 'check') {
        if (!ts.isArrowFunction(init) && !ts.isFunctionExpression(init)) {
          rule.unresolved.push('check is not an inline function');
          continue;
        }
        const param = init.parameters[0];
        if (!param) continue; // reads nothing
        if (!ts.isIdentifier(param.name)) {
          rule.unresolved.push('metrics parameter is destructured');
          continue;
        }
        const m = param.name.text;
        const visit = (n: ts.Node) => {
          if (ts.isIdentifier(n) && n.text === m && n !== param.name) {
            const parent = n.parent;
            if (ts.isElementAccessExpression(parent) && parent.expression === n
              && ts.isStringLiteralLike(parent.argumentExpression)) {
              const write = ts.isBinaryExpression(parent.parent) && parent.parent.left === parent
                && parent.parent.operatorToken.kind === ts.SyntaxKind.EqualsToken;
              if (write) rule.unresolved.push(`writes ${m}[...]`);
              else rule.reads.add(parent.argumentExpression.text);
            } else {
              rule.unresolved.push(`unresolvable use of ${m}: ${parent.getText(sf).slice(0, 60)}`);
            }
          }
          ts.forEachChild(n, visit);
        };
        visit(init.body);
      }
    }
    return rule;
  });
}

const sorted = (xs: Iterable<string>) => [...xs].sort();

describe('R3 — static proof over the rule bodies', () => {
  const rules = analyse(SOURCE, readFileSync(SOURCE, 'utf8'));

  it('finds every runtime rule, in order', () => {
    expect(rules).not.toBeNull();
    expect(rules!.map(r => r.ruleId)).toEqual(INSIGHT_RULES.map(r => r.rule_id));
  });

  it.each(INSIGHT_RULES.map(r => [r.rule_id]))('%s: every key its check reads is declared, and every declared key is read', id => {
    const rule = rules!.find(r => r.ruleId === id)!;
    expect(rule.unresolved).toEqual([]);
    expect(rule.declared).not.toBeNull();
    expect(sorted(rule.reads)).toEqual(sorted(rule.declared!));
    // The runtime array is the one analysed.
    expect(sorted(INSIGHT_RULES.find(r => r.rule_id === id)!.biomarkers_involved)).toEqual(sorted(rule.declared!));
  });

  it('analyte-free rules are declared by id, never inferred', () => {
    for (const id of ANALYTE_FREE_RULES) {
      const rule = rules!.find(r => r.ruleId === id);
      expect(rule, id).toBeDefined();
      expect(rule!.declared, id).toEqual([]);
      expect(rule!.reads.size, id).toBe(0);
    }
    for (const rule of rules!) {
      if (rule.declared?.length === 0) expect(ANALYTE_FREE_RULES.has(rule.ruleId), rule.ruleId).toBe(true);
    }
    // Today every rule reads analytes, so the set is explicitly empty.
    expect(ANALYTE_FREE_RULES.size).toBe(0);
  });

  it('every real rule has an established dependency at the gate', () => {
    for (const rule of INSIGHT_RULES) {
      expect(ruleDependency({ rule_id: rule.rule_id, biomarkers_involved: [...rule.biomarkers_involved] }))
        .toEqual({ kind: 'analytes', analytes: rule.biomarkers_involved });
    }
  });

  it('self-test: the analyser sees an undeclared read, a missing read, and an unresolvable use', () => {
    const probe = `
      export const INSIGHT_RULES = [
        { rule_id: 'under', biomarkers_involved: ['a'], check: (m) => m['a'] > 1 && m['b'] > 1 ? 'x' : null },
        { rule_id: 'over', biomarkers_involved: ['a', 'c'], check: (m) => m['a'] > 1 ? 'x' : null },
        { rule_id: 'computed', biomarkers_involved: ['a'], check: (m) => { const k = 'a'; return m[k] > 1 ? 'x' : null; } },
        { rule_id: 'dotted', biomarkers_involved: ['a'], check: (m) => m.a > 1 ? 'x' : null },
        { rule_id: 'passed', biomarkers_involved: ['a'], check: (m) => helper(m) },
        { rule_id: 'destructured', biomarkers_involved: ['a'], check: ({ a }) => a > 1 ? 'x' : null },
        { rule_id: 'spread', biomarkers_involved: ['a'], check: (m) => ({ ...m }).a ? 'x' : null },
        { rule_id: 'clean', biomarkers_involved: ['a'], check: (m) => m['a'] > 1 ? 'x' : null },
      ];`;
    const found = Object.fromEntries(analyse('probe.ts', probe)!.map(r => [r.ruleId, r]));
    expect(sorted(found.under!.reads)).not.toEqual(sorted(found.under!.declared!));
    expect(sorted(found.over!.reads)).not.toEqual(sorted(found.over!.declared!));
    for (const id of ['computed', 'dotted', 'passed', 'destructured', 'spread']) {
      expect(found[id]!.unresolved.length, id).toBeGreaterThan(0);
    }
    expect(found.clean!.unresolved).toEqual([]);
    expect(sorted(found.clean!.reads)).toEqual(['a']);
  });
});

// ── Dynamic proof ──────────────────────────────────────────────────────────

type Check = (m: Record<string, number>, cyclePhase?: string) => boolean | string | null;

function recordReads(check: Check, values: Record<string, number>, phase?: string) {
  const reads = new Set<string>();
  let enumerated = false;
  const proxy = new Proxy(values, {
    get(target, key, receiver) {
      if (typeof key === 'string') reads.add(key);
      return Reflect.get(target, key, receiver);
    },
    has(target, key) {
      if (typeof key === 'string') reads.add(key);
      return Reflect.has(target, key);
    },
    getOwnPropertyDescriptor(target, key) {
      if (typeof key === 'string') reads.add(key);
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
    ownKeys(target) {
      enumerated = true;
      return Reflect.ownKeys(target);
    },
  });
  check(proxy, phase);
  return { reads, enumerated };
}

const ALL_KEYS = [...new Set(INSIGHT_RULES.flatMap(r => r.biomarkers_involved))];
// Analytes no rule declares: a read of one would be an undeclared dependency.
const DECOYS = ['estradiol', 'amh', 'vitamin_b12', 'creatinine', 'total_cholesterol'];
const LEVELS = [0.1, 0.9, 1, 2, 2.6, 3, 5, 20, 29, 31, 45, 60, 95, 120, 400, 1e4];
const PHASES = [undefined, 'menstrual', 'follicular', 'ovulatory', 'luteal'];

function panels(declared: readonly string[]): Record<string, number>[] {
  const out: Record<string, number>[] = [];
  const keys = [...ALL_KEYS, ...DECOYS];
  for (const level of LEVELS) out.push(Object.fromEntries(keys.map(k => [k, level])));
  // Alternating extremes so mixed branches are reached.
  out.push(Object.fromEntries(keys.map((k, i) => [k, i % 2 ? 1e4 : 0.1])));
  out.push(Object.fromEntries(keys.map((k, i) => [k, i % 2 ? 0.1 : 1e4])));
  for (const key of declared) {
    for (const level of LEVELS) {
      out.push({ [key]: level });
      out.push(Object.fromEntries(keys.filter(k => k !== key).map(k => [k, level])));
    }
  }
  return out;
}

describe('R3 — dynamic proof: the real checks, instrumented', () => {
  it.each(INSIGHT_RULES.map(r => [r.rule_id]))('%s: reads only declared keys, and reads all of them', id => {
    const rule = INSIGHT_RULES.find(r => r.rule_id === id)!;
    const union = new Set<string>();
    for (const values of panels(rule.biomarkers_involved)) {
      for (const phase of PHASES) {
        const { reads, enumerated } = recordReads(rule.check, values, phase);
        expect(enumerated, 'a check that enumerates the panel has no establishable dependency').toBe(false);
        for (const key of reads) {
          expect(rule.biomarkers_involved, `${id} read undeclared ${key}`).toContain(key);
          union.add(key);
        }
      }
    }
    expect(sorted(union)).toEqual(sorted(rule.biomarkers_involved));
  });

  it('self-test: the recorder catches an undeclared read and an enumeration', () => {
    const sneaky: Check = m => (m['a']! > 1 && m['estradiol']! > 1 ? 'x' : null);
    expect([...recordReads(sneaky, { a: 2, estradiol: 2 }).reads]).toContain('estradiol');
    const enumerating: Check = m => (Object.keys(m).length > 3 ? 'x' : null);
    expect(recordReads(enumerating, { a: 1 }).enumerated).toBe(true);
  });
});
