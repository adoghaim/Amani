import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { evaluateInsightRules, INSIGHT_RULES } from '../../utils/derivedMetrics';
import { assessAmaniContext, contextFromReport, requiresCycleContext } from './amaniContext';
import { ANALYTE_FREE_RULES, gateInsightMatches, ruleDependency } from './insightGate';
import type { Biomarker, BiomarkerName } from '../../types';

// Synthetic values only; no patient data. V2-03 amendment 2 (B1).
const panel = (values: Record<string, number>) =>
  Object.entries(values).map(([name, value]) => ({ name, value } as Biomarker));

const evaluate = (values: Record<string, number>, phase: string | null) => {
  const biomarkers = panel(values);
  const ungated = evaluateInsightRules(biomarkers, phase);
  const gated = gateInsightMatches(ungated, biomarkers, contextFromReport(phase));
  return { ungated: ungated.map(m => m.rule_id), gated: gated.map(m => m.rule_id) };
};

// An ovulatory-surge-shaped LH over a normal FSH (ratio 5) plus one androgen
// signal: enough for the PCOS rule's two-signal threshold.
const SURGE = { lh: 30, fsh: 6, total_testosterone: 80 };

describe('B1 — no pattern is asserted from an input Amani withholds', () => {
  it('the catalog, not a list, makes LH, FSH and progesterone context-dependent', () => {
    for (const key of ['lh', 'fsh', 'progesterone'] as const) expect(requiresCycleContext(key)).toBe(true);
  });

  it('drops "Possible PCOS-Related Pattern" when LH and FSH are withheld for a missing phase', () => {
    const { ungated, gated } = evaluate(SURGE, null);
    // The rule itself is unchanged and still fires; only the call-site gate removes it.
    expect(ungated).toContain('possible_pcos_pattern');
    expect(gated).not.toContain('possible_pcos_pattern');
    expect(evaluate(SURGE, 'unknown').gated).not.toContain('possible_pcos_pattern');
  });

  it('drops "Possible Luteal Phase Insufficiency" from its explicit no-phase branch', () => {
    const { ungated, gated } = evaluate({ progesterone: 0.5 }, null);
    expect(ungated).toContain('possible_luteal_insufficiency');
    expect(gated).toEqual([]);
  });

  it('keeps a hormone rule once the recorded phase lets Amani score its inputs', () => {
    expect(assessAmaniContext('progesterone', 2, contextFromReport('luteal')).kind).toBe('scored');
    expect(evaluate({ progesterone: 2 }, 'luteal').gated).toContain('possible_luteal_insufficiency');
  });

  it('a declared analyte absent from the report does not gate the rule', () => {
    // TT + SHBG are the PCOS rule's two signals here; LH and FSH are not inputs.
    const { ungated, gated } = evaluate({ total_testosterone: 80, shbg: 30 }, null);
    expect(ungated).toContain('possible_pcos_pattern');
    expect(gated).toContain('possible_pcos_pattern');
  });

  it('rules on analytes that need no context are untouched', () => {
    expect(evaluate({ vitamin_d_25_oh: 20 }, null).gated).toEqual(['vitamin_d_deficiency']);
  });

  it('a non-cycling state withholds pattern cards built from its context-dependent inputs', () => {
    const { ungated, gated } = evaluate({ tpo_antibodies: 200, tsh: 3, vitamin_d_25_oh: 20 }, 'pregnancy_t2');
    expect(ungated).toEqual(expect.arrayContaining(['autoimmune_thyroid_pattern', 'vitamin_d_deficiency']));
    for (const id of ungated) {
      const rule = INSIGHT_RULES.find(r => r.rule_id === id)!;
      const withheld = rule.biomarkers_involved.some(k =>
        ['tpo_antibodies', 'tsh', 'vitamin_d_25_oh'].includes(k)
        && assessAmaniContext(k as BiomarkerName, 1, contextFromReport('pregnancy_t2')).kind === 'withheld');
      expect(gated.includes(id)).toBe(!withheld);
    }
  });

  // Amendment 4 R3: replaces "a rule that declares no analytes is ungated".
  // That pass-through is the silent bypass the owner ruled out; the gate now
  // suppresses whenever the dependency cannot be established.
  it('fails safe: a match whose dependency cannot be established is suppressed', () => {
    const ctx = contextFromReport('luteal');
    const values = panel({ hemoglobin_a1c: 6 });
    const a1c = INSIGHT_RULES.find(r => r.rule_id === 'low_hba1c_pattern')!;
    const real = { rule_id: a1c.rule_id, biomarkers_involved: [...a1c.biomarkers_involved] };
    expect(gateInsightMatches([real], values, ctx)).toEqual([real]);
    const cases = [
      { rule_id: 'undeclared', biomarkers_involved: [] as string[] },        // unknown rule, empty list
      { rule_id: 'undeclared', biomarkers_involved: ['hemoglobin_a1c'] },     // unknown rule
      { ...real, biomarkers_involved: [] },                                   // declaration dropped
      { ...real, biomarkers_involved: ['hemoglobin_a1c', 'lh'] },             // disagrees with its rule
      { ...real, biomarkers_involved: undefined as unknown as string[] },     // missing
    ];
    for (const match of cases) {
      expect(ruleDependency(match).kind, JSON.stringify(match)).toBe('unestablished');
      expect(gateInsightMatches([match], values, ctx), JSON.stringify(match)).toEqual([]);
    }
  });

  it('an empty declaration is allowed only when the rule is explicitly analyte-free', () => {
    const declared = new Map([['free', [] as string[]], ['reads', ['tsh']]]);
    expect(ruleDependency({ rule_id: 'free', biomarkers_involved: [] }, declared, new Set())).toEqual({ kind: 'unestablished' });
    expect(ruleDependency({ rule_id: 'free', biomarkers_involved: [] }, declared, new Set(['free']))).toEqual({ kind: 'analyte_free' });
    // Marked analyte-free while declaring analytes is a contradiction, not a pass.
    expect(ruleDependency({ rule_id: 'reads', biomarkers_involved: ['tsh'] }, declared, new Set(['reads']))).toEqual({ kind: 'unestablished' });
    expect(ruleDependency({ rule_id: 'reads', biomarkers_involved: ['tsh'] }, declared, new Set())).toEqual({ kind: 'analytes', analytes: ['tsh'] });
    expect(ANALYTE_FREE_RULES.size).toBe(0);
  });

  it('every declared rule declares analytes, so none is silently ungated', () => {
    for (const rule of INSIGHT_RULES) expect(rule.biomarkers_involved.length).toBeGreaterThan(0);
  });

  it('property: across every context, no surviving match has a withheld input on the report', () => {
    // One synthetic panel that trips every rule at once.
    const everything = {
      tpo_antibodies: 200, tsh: 3, fasting_glucose: 100, fasting_insulin: 15, triglycerides: 150,
      hdl_cholesterol: 40, progesterone: 0.5, ferritin: 20, iron_saturation: 20, ...SURGE, dheas: 400,
      shbg: 30, free_t4: 1, free_t3: 2.5, ldl_cholesterol: 130, apob: 100, hs_crp: 2, lpa: 80,
      alt: 30, ast: 30, ggt: 30, vitamin_d_25_oh: 20, hemoglobin_a1c: 6,
    };
    const contexts = [null, 'unknown', 'menstrual', 'follicular', 'ovulatory', 'luteal', 'pregnancy_t1'];
    for (const phase of contexts) {
      const biomarkers = panel(everything);
      const gated = gateInsightMatches(evaluateInsightRules(biomarkers, phase), biomarkers, contextFromReport(phase));
      for (const match of gated) {
        for (const key of match.biomarkers_involved) {
          const value = everything[key as keyof typeof everything];
          if (value === undefined) continue;
          expect(assessAmaniContext(key as BiomarkerName, value, contextFromReport(phase)).kind, `${phase} ${match.rule_id} ${key}`)
            .not.toBe('withheld');
        }
      }
    }
    expect(evaluate(everything, null).gated).not.toContain('possible_pcos_pattern');
  });

  it('ReportView renders only gated, authorized insight flags', () => {
    const source = readFileSync('src/pages/ReportView.tsx', 'utf8');
    expect(source.match(/evaluateInsightRules\(/g)).toHaveLength(1);
    expect(source).toMatch(/gateInsightMatches\(\s*evaluateInsightRules\(biomarkers, report\?\.estimated_cycle_phase\),\s*biomarkers,\s*contextFromReport\(report\?\.estimated_cycle_phase, declaredState\),?\s*\)/);
    // Amendment 4 R2: the gated matches are then rendered through the authorized-language function.
    expect(source).toMatch(/authorizeInsightMatches\(\s*gateInsightMatches\(\s*evaluateInsightRules\([^)]*\),[^)]*\),\s*\),\s*biomarkers,\s*contextFromReport\(report\?\.estimated_cycle_phase, declaredState\),?\s*\)/);
    expect(source).toMatch(/<InsightFlagsPanel flags=\{insightFlags\} \/>/);
  });
});
