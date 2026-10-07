// @vitest-environment jsdom
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import type { Biomarker, BiomarkerName } from '../../types';
import { BiomarkerCard } from '../../components/BiomarkerCard';
import { DerivedMetricsPanel } from '../../components/DerivedMetricsPanel';
import { InsightFlagsPanel } from '../../components/InsightFlagsPanel';
import { SafetyWarnings } from '../../components/SafetyWarnings';
import { SystemSummaryCards } from '../../components/SystemSummaryCards';
import { CARD_MAP } from '../cards/cardMap';
import { getAllEntries, getEntry } from '../biomarkers/dictionary';
import { buildInsightSummary } from '../insights/buildInsightSummary';
import { computeDerivedMetrics, evaluateInsightRules, INSIGHT_RULES } from '../../utils/derivedMetrics';
import { assessAmaniContext, contextFromReport, MENSTRUAL_PHASES } from './amaniContext';
import { authorizeInsightMatches, gateInsightMatches } from './insightGate';
import {
  AUTHORITY_CATEGORIES, authorizedLanguage, comparisonBandLabel, CUE_STYLE, derivedMetricObservation, describeComparisonBand,
  describeMeasuredMovement, evaluateSafetyRules, focusAreaObservation, labIntervalObservation, labIntervalPlacement,
  LANGUAGE_AUTHORITY, patternRuleObservation, PRODUCT_DISCLAIMERS, reportHeadline, SAFETY_RULES, systemSummaryLabel,
  type AuthorizedLanguage, type ClinicalLanguage, type SafetyRule,
} from './insightCopy';

/*
  V2-03b Stage 2 — the logic half of the dual proof, one block per invariant.
  The page-wide half is src/pages/ReportView.language.test.tsx (jsdom) and
  e2e/reports/clinical-language-policy.spec.ts (browser).
*/

const lang = (review_status: 'UNKNOWN' | 'DISPUTED' | 'NEEDS_CONTEXT' | 'SAFE', reviewed = false): AuthorizedLanguage => authorizedLanguage({
  provenance: reviewed
    ? { evidence_grade: 'A', review_status, source: 'synthetic', source_date: '2000-01-01', reviewer: 'synthetic', reviewed_at: '2000-01-01' }
    : { evidence_grade: 'unsourced', review_status, source: null, source_date: null, reviewer: null, reviewed_at: null },
  claims: { optimal_target: true, favourable_direction: true },
});
const LANGUAGES = [lang('UNKNOWN'), lang('DISPUTED'), lang('NEEDS_CONTEXT'), lang('SAFE', true), authorizedLanguage(null)];

describe('the authority model is a type the code enforces, not a column', () => {
  it('exactly the owner\'s seven categories, each language variant mapped to one, debt not mintable', () => {
    expect([...AUTHORITY_CATEGORIES]).toEqual(['FACTUAL_OBSERVATION', 'COMPARISON_BAND_OBSERVATION', 'REVIEWED_CLINICAL_INTERPRETATION',
      'OPTIMAL_TARGET_CLAIM', 'SAFETY_CRITICAL_WARNING', 'CLINICAL_ACTION_RECOMMENDATION', 'UNAUTHORIZED_DEBT']);
    expect(Object.keys(LANGUAGE_AUTHORITY).sort()).toEqual(['clinical_action', 'comparison_band', 'factual_observation',
      'optimal_target', 'reviewed_interpretation', 'safety_warning']);
    expect(Object.values(LANGUAGE_AUTHORITY)).not.toContain('UNAUTHORIZED_DEBT');
    expect(new Set(Object.values(LANGUAGE_AUTHORITY)).size).toBe(6);
  });

  it('compile-time: band and factual language cannot carry a safety cue; safety cannot be neutral', () => {
    const band = describeComparisonBand(authorizedLanguage(null));
    // @ts-expect-error a comparison-band observation cannot carry the warning cue
    const warned: ClinicalLanguage = { ...band, cue: 'warning' };
    // @ts-expect-error a factual observation cannot carry the critical cue
    const critical: ClinicalLanguage = { ...describeMeasuredMovement({ displayName: 'X', previousValue: 1, currentValue: 2, unit: 'u', significance: 'significant' }), cue: 'critical' };
    // @ts-expect-error a safety warning must carry warning or critical, and a rule source
    const neutralSafety: ClinicalLanguage = { category: 'safety_warning', text: 't', cue: 'neutral', authority: { kind: 'deterministic_safety_rule', ruleId: 'r', version: '1' } };
    // @ts-expect-error an optimal-target claim needs a reviewed rule and a target-evidence id
    const optimal: ClinicalLanguage = { category: 'optimal_target', text: 'Optimal', cue: 'neutral', authority: { kind: 'amani_comparison_band', reviewStatus: 'SAFE', bands: [] } };
    expect([warned, critical, neutralSafety, optimal]).toHaveLength(4);
  });

  it('only the policy constructs clinical language: no other production module writes a category literal', () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) files.push(path);
      }
    };
    walk('src');
    // Value constructions only (object literals), not type positions.
    const constructed = (file: string): string[] => {
      const sf = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true,
        file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
      const out: string[] = [];
      const visit = (n: ts.Node) => {
        if (ts.isObjectLiteralExpression(n)) {
          for (const p of n.properties) {
            if (ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === 'category'
              && ts.isStringLiteral(p.initializer) && p.initializer.text in LANGUAGE_AUTHORITY) out.push(p.initializer.text);
          }
        }
        ts.forEachChild(n, visit);
      };
      visit(sf);
      return out;
    };
    const byFile = new Map(files.map(f => [f, constructed(f)] as const).filter(([, c]) => c.length > 0));
    expect([...byFile.keys()]).toEqual([join('src/lib/scoring', 'insightCopy.ts')]);
    const minted: string[] = byFile.get(join('src/lib/scoring', 'insightCopy.ts'))!;
    // Exactly one place mints a safety warning (the rule evaluator); nothing
    // mints a reviewed interpretation or an optimal target: no reviewed rule exists.
    expect(minted.filter(c => c === 'safety_warning')).toHaveLength(1);
    expect(minted.filter(c => c === 'reviewed_interpretation' || c === 'optimal_target')).toEqual([]);
    // Negative control: the AST check sees a construction placed in a component.
    expect(constructedIn(`const x = { category: 'safety_warning', text: 't', cue: 'critical' };`)).toEqual(['safety_warning']);
    function constructedIn(source: string): string[] {
      const sf = ts.createSourceFile('probe.ts', source, ts.ScriptTarget.Latest, true);
      const out: string[] = [];
      const visit = (n: ts.Node) => {
        if (ts.isObjectLiteralExpression(n)) {
          for (const p of n.properties) {
            if (ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === 'category' && ts.isStringLiteral(p.initializer)) out.push(p.initializer.text);
          }
        }
        ts.forEachChild(n, visit);
      };
      visit(sf);
      return out;
    }
  });
});

describe('release invariant 1 — her laboratory\'s interval carries no Amani margin or judgement', () => {
  it('a value past either printed bound is outside it, however close; the bounds themselves are within', () => {
    expect(labIntervalPlacement(4.51, 0.45, 4.5)).toBe('above');
    expect(labIntervalPlacement(4.5, 0.45, 4.5)).toBe('within');
    expect(labIntervalPlacement(0.449, 0.45, 4.5)).toBe('below');
    expect(labIntervalPlacement(145.5, 136, 145)).toBe('above');
    expect(labIntervalPlacement(110, null, 100)).toBe('above');
    expect(labIntervalPlacement(30, 40, null)).toBe('below');
    expect(labIntervalPlacement(99, null, null, '<', 100)).toBe('within');
    expect(labIntervalPlacement(101, null, null, '< OR =', 100)).toBe('above');
    expect(labIntervalPlacement(39, null, null, '>', 40)).toBe('below');
    expect(labIntervalPlacement(5, null, null)).toBeNull();
    expect(labIntervalPlacement(null, 1, 2)).toBeNull();
  });

  it('the statement is factual, names her lab, and uses the attention cue only when outside', () => {
    expect(labIntervalObservation('Sodium', 145.5, 136, 145)).toMatchObject({
      category: 'factual_observation', text: "Above your lab's range", cue: 'attention',
      authority: { kind: 'patient_lab_interval', subject: 'Sodium', min: 136, max: 145 },
    });
    expect(labIntervalObservation('TSH', 2, 0.45, 4.5)).toMatchObject({ text: "Within your lab's range", cue: 'neutral' });
    expect(labIntervalObservation('LDL', 120, null, null, '<', 100)).toMatchObject({ text: "Above your lab's range", authority: { min: null, max: 100 } });
  });

  it('the biomarker card, expanded, states a value 0.06 past the lab bound as outside it, never "borderline"', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    try {
      // TSH 4.56 sits inside the 8% margin (0.33) the card used to add to 0.45–4.5.
      await act(async () => root.render(<BiomarkerCard name="tsh" value={4.56} unit="uIU/mL" labRefMin={0.45} labRefMax={4.5} cyclePhase={null} />));
      await act(async () => host.querySelector('button')!.click());
      const lab = host.querySelector('[data-language-source="patient_lab_interval"]');
      expect(lab?.textContent).toBe("Above your lab's range");
      expect(host.textContent).not.toMatch(/borderline|normal\b|out of range|in range/i);
      expect(host.innerHTML).not.toMatch(/flag-(?:ok|watch|low)/);
    } finally {
      await act(async () => root.unmount());
      host.remove();
      vi.unstubAllGlobals();
    }
  });
});

describe('the comparison-band pill: placement and review state, never Normal, Borderline or Optimal', () => {
  const valuesFor = (key: BiomarkerName) => {
    const e = getEntry(key)!;
    const points = [e.optimal.min, e.optimal.max, e.clinical.min, e.clinical.max].filter((v): v is number => v !== null);
    return [0, ...points, ...points.map(v => v * 0.9), ...points.map(v => v * 1.1), ...points.map(v => v * 3), 1e5];
  };

  it('every catalog marker, phase and value: only "Within/Outside Amani band", "Context needed" or "No Amani band"', () => {
    let swept = 0;
    for (const e of getAllEntries()) {
      for (const phase of [null, ...MENSTRUAL_PHASES, 'pregnancy_t2']) {
        for (const value of valuesFor(e.key)) {
          const pill = comparisonBandLabel(assessAmaniContext(e.key, value, contextFromReport(phase)), value);
          expect(['Within Amani band', 'Outside Amani band', 'Context needed', 'No Amani band']).toContain(pill.text);
          expect(pill.category).toBe('comparison_band');
          expect(['neutral', 'attention']).toContain(pill.cue);
          expect(CUE_STYLE[pill.cue].bg).not.toMatch(/flag-/);
          swept++;
        }
      }
    }
    expect(swept).toBeGreaterThan(5000);
  });

  it('a system label states counts, not attention levels', () => {
    expect(systemSummaryLabel(0, 0).text).toBe('Not scored');
    expect(systemSummaryLabel(3, 0)).toMatchObject({ text: 'Scored markers within Amani bands', cue: 'neutral' });
    expect(systemSummaryLabel(3, 1)).toMatchObject({ text: '1 outside Amani band', cue: 'attention' });
    expect(systemSummaryLabel(9, 4)).toMatchObject({ text: '4 outside Amani bands', cue: 'attention' });
    const html = renderToStaticMarkup(<SystemSummaryCards activeCategory={null} onCategoryClick={() => {}}
      systems={buildInsightSummary([{ key: 'tsh', value: 9, unit: 'uIU/mL', labRefMin: 0.45, labRefMax: 4.5 }], null).systemSummaries} />);
    expect(html).toContain('1 outside Amani band');
    expect(html).not.toMatch(/Needs Attention|Mild Attention|flag-(?:ok|watch|low)/);
  });
});

describe('headline, focus areas and derived metrics: placement only where the band permits it', () => {
  it('a DISPUTED band withholds placement in the headline; others state it with review state', () => {
    const disputed = lang('DISPUTED');
    const unknown = lang('UNKNOWN');
    expect(reportHeadline(2, [{ name: 'TSH', language: unknown }, { name: 'Progesterone', language: disputed }], unknown).text)
      .toBe("TSH is outside Amani's current comparison band. Interpretation of Progesterone is unavailable pending clinical review. Amani's context bands are still under review.");
    expect(reportHeadline(0, [], authorizedLanguage(null)).text).toBe('Amani did not score any marker on this report against its comparison bands.');
    expect(reportHeadline(3, [], unknown).text).toBe("All scored values are within Amani's context bands, which are still under review.");
    expect(focusAreaObservation(['TSH'], disputed)).toBe('Interpretation unavailable pending clinical review.');
    expect(focusAreaObservation(['HbA1c', 'Fasting Insulin'], unknown))
      .toBe("HbA1c and Fasting Insulin are outside Amani's current comparison bands. These bands have not yet completed clinical review.");
  });

  it('every derived metric reads as a comparison against an unreviewed band, with no interpretation', () => {
    const metrics = computeDerivedMetrics([
      { name: 'fasting_glucose', value: 95 }, { name: 'fasting_insulin', value: 12 }, { name: 'triglycerides', value: 150 },
      { name: 'hdl_cholesterol', value: 40 }, { name: 'total_cholesterol', value: 220 }, { name: 'total_testosterone', value: 80 },
      { name: 'shbg', value: 30 }, { name: 'free_t3', value: 2.5 }, { name: 'free_t4', value: 1 },
    ] as Biomarker[]);
    expect(metrics).toHaveLength(5);
    for (const m of metrics) {
      expect(Object.keys(m)).not.toContain('interpretation');
      const { sentence, label } = derivedMetricObservation({ displayName: m.displayName, value: m.value, unit: m.unit, bandMin: m.optimalMin, bandMax: m.optimalMax });
      expect(sentence.text).toMatch(/^.+ is .+, (?:within|outside) Amani's comparison band of .+\. Amani's band for this calculation has not yet completed clinical review\.$/);
      expect(label.authority.reviewStatus).toBeNull();
    }
    const html = renderToStaticMarkup(<DerivedMetricsPanel metrics={metrics} />);
    expect(html).toContain('HOMA-IR is 2.81, outside');
    expect(html).not.toMatch(/insulin resistance|worth discussing|Borderline|favorable|flag-(?:ok|watch|low)/i);
  });
});

/*
  Owner R2, instance by instance. The eight provider-advice sentences, and the
  condition-naming titles beside them, came from INSIGHT_RULES and the derived
  metrics. Each rule's authority was looked for in all three admissible places
  and is absent from all three, so none may remain as clinical-action advice.
*/
describe('R2 — the derived-metric and pattern-rule advice, classified then replaced', () => {
  it('no rule is a registered safety rule, a reviewed rule, or an otherwise authorized pathway', () => {
    const ruleIds = INSIGHT_RULES.map(r => r.rule_id);
    expect(ruleIds).toHaveLength(10);
    expect(SAFETY_RULES.map(r => r.ruleId).filter(id => ruleIds.includes(id))).toEqual([]);
    // No reviewed-rule source exists anywhere in the policy to cite.
    expect(readFileSync('src/lib/scoring/insightCopy.ts', 'utf8')).not.toMatch(/kind: 'reviewed_amani_rule'[^;]*ruleId: '/);
    // No thresholds for these rules are catalog entries with review provenance.
    const catalog = readFileSync('clinical/catalog/catalog.json', 'utf8');
    for (const id of ruleIds) expect(catalog, id).not.toContain(id);
  });

  it('every rendered card, expanded, names its markers and gives no advice; the footer is the product disclaimer', async () => {
    const everything: Record<string, number> = {
      tpo_antibodies: 200, tsh: 3, fasting_glucose: 100, fasting_insulin: 15, triglycerides: 150, hdl_cholesterol: 40,
      progesterone: 0.5, ferritin: 20, iron_saturation: 20, lh: 30, fsh: 6, total_testosterone: 80, dheas: 400, shbg: 30,
      free_t4: 1, free_t3: 2.5, ldl_cholesterol: 130, apob: 100, hs_crp: 2, lpa: 80, alt: 30, ast: 30, ggt: 30,
      vitamin_d_25_oh: 20, hemoglobin_a1c: 6,
    };
    const biomarkers = Object.entries(everything).map(([name, value]) => ({ name, value, unit: 'u' } as Biomarker));
    const ctx = contextFromReport('follicular');
    const flags = authorizeInsightMatches(gateInsightMatches(evaluateInsightRules(biomarkers, 'follicular'), biomarkers, ctx), biomarkers, ctx);
    expect(flags.length).toBeGreaterThanOrEqual(8);
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    try {
      await act(async () => root.render(<InsightFlagsPanel flags={flags} />));
      for (const b of Array.from(host.querySelectorAll('button'))) await act(async () => b.click());
      const footer = host.querySelector('[data-language-source="product_disclaimer"]');
      expect(footer?.textContent).toBe(PRODUCT_DISCLAIMERS.patternRules.text);
      footer!.remove();
      expect(host.textContent).not.toMatch(/worth discussing|should be discussed|discuss with|provider|conversation|PCOS|Hashimoto|insulin resistance|iron deficiency|prediabet|luteal phase insufficiency|risk cluster|Below Optimal|Elevated/i);
      expect(host.innerHTML).not.toMatch(/flag-(?:ok|watch|low)/);
    } finally {
      await act(async () => root.unmount());
      host.remove();
      vi.unstubAllGlobals();
    }
  });

  it('logic twin of the browser spec: the exact card text for each e2e fixture', () => {
    const cards = (values: [string, number, string][], phase: string | null) => {
      const biomarkers = values.map(([name, value, unit]) => ({ name, value, unit } as Biomarker));
      const ctx = contextFromReport(phase);
      return authorizeInsightMatches(gateInsightMatches(evaluateInsightRules(biomarkers, phase), biomarkers, ctx), biomarkers, ctx);
    };
    const pattern: [string, number, string][] = [['lh', 30, 'mIU/mL'], ['fsh', 6, 'mIU/mL'], ['total_testosterone', 80, 'ng/dL'],
      ['progesterone', 0.5, 'ng/mL'], ['hemoglobin_a1c', 6, '%']];
    expect(cards(pattern, 'unknown').map(c => c.title.text)).toEqual(['HbA1c: pattern-rule match']);
    const follicular = cards(pattern, 'follicular');
    const pcos = follicular.find(c => c.rule_id === 'possible_pcos_pattern')!;
    expect(pcos.title.text).toBe('Total Testosterone and LH and FSH: pattern-rule match');
    // A follicular LH or FSH band is DISPUTED, so the combined card withholds the match as well as placement.
    expect(pcos.description.authority.reviewStatus).toBe('DISPUTED');
    expect(pcos.description.text).toBe('Interpretation unavailable pending clinical review. Measured: Total Testosterone 80 ng/dL; LH 30 mIU/mL; FSH 6 mIU/mL.');
    expect(cards([['vitamin_d_25_oh', 40, 'ng/mL']], 'unknown')[0]!.description.text)
      .toMatch(/^More context needed\. Amani's comparison band for this result has not yet completed clinical review\. Measured: Vitamin D 40 ng\/mL\. /);
    expect(cards([['progesterone', 2, 'ng/mL']], 'luteal')[0]!.description.text)
      .toBe('Interpretation unavailable pending clinical review. Measured: Progesterone 2 ng/mL.');
  });
});

describe('safety separation, direction 1: the policy never suppresses an approved deterministic warning', () => {
  const approved: SafetyRule = {
    ruleId: 'synthetic-potassium', version: '1', analyte: 'potassium',
    approval: { approvedBy: 'synthetic fixture', approvedAt: '2026-10-07', evidenceId: 'SYNTHETIC-ONLY' },
    evaluate: value => value >= 6.5 ? { cue: 'critical', text: 'Synthetic critical value: this is urgent, seek care now.' } : null,
  };

  it('emits the rule\'s own text and cue verbatim, whatever any band says', () => {
    const [warning] = evaluateSafetyRules([{ name: 'potassium', value: 7, unit: 'mmol/L' }], [approved]);
    expect(warning).toEqual({
      category: 'safety_warning', text: 'Synthetic critical value: this is urgent, seek care now.', cue: 'critical',
      authority: { kind: 'deterministic_safety_rule', ruleId: 'synthetic-potassium', version: '1' },
    });
    // The words the band channel may never use are exactly what this warning needs to say.
    expect(warning!.text).toMatch(/urgent|seek care/);
    const html = renderToStaticMarkup(<SafetyWarnings warnings={[warning!]} />);
    expect(html).toContain('role="alert"');
    expect(html).toContain('Synthetic critical value: this is urgent, seek care now.');
    expect(html).toContain('data-language-cue="critical"');
    expect(html).toMatch(/flag-low/);
  });

  it('the rule never sees a band, so no review state or placement can change its output', () => {
    const calls: unknown[][] = [];
    const spy: SafetyRule = { ...approved, evaluate: (...args) => { calls.push(args); return approved.evaluate(...args); } };
    evaluateSafetyRules([{ name: 'potassium', value: 7, unit: 'mmol/L' }], [spy]);
    expect(calls).toEqual([[7, 'mmol/L']]);
  });

  it('only an approved rule may speak: missing approval fails closed (and the registry is empty today)', () => {
    expect(SAFETY_RULES).toEqual([]);
    expect(Object.isFrozen(SAFETY_RULES)).toBe(true);
    const unapproved = { ...approved, approval: { approvedBy: '', approvedAt: '2026-10-07', evidenceId: 'X' } };
    expect(evaluateSafetyRules([{ name: 'potassium', value: 7, unit: 'mmol/L' }], [unapproved])).toEqual([]);
    expect(evaluateSafetyRules([{ name: 'potassium', value: 9, unit: 'mmol/L' }])).toEqual([]);
  });
});

describe('safety separation, direction 2: a band change never produces or resembles a safety warning', () => {
  it('every band constructor, under every review state, yields only neutral or attention cues and no safety category', () => {
    const produced: ClinicalLanguage[] = [];
    for (const language of LANGUAGES) {
      for (const placement of ['within', 'outside', null] as const) produced.push(describeComparisonBand(language, placement));
      produced.push(reportHeadline(4, [{ name: 'TSH', language }, { name: 'Ferritin', language }], language));
      produced.push(...Object.values(patternRuleObservation('TSH', [{ name: 'TSH', value: 400, unit: 'uIU/mL' }], language)));
    }
    for (const [prev, curr] of [[6, 400], [400, 6], [6, 6.1]] as const) {
      for (const significance of ['minor', 'moderate', 'significant'] as const) {
        for (const format of ['values', 'direction', 'magnitude'] as const) {
          produced.push(describeMeasuredMovement({ displayName: 'TSH', previousValue: prev, currentValue: curr, unit: 'uIU/mL', significance }, format));
        }
      }
    }
    produced.push(systemSummaryLabel(5, 5), labIntervalObservation('TSH', 400, 0.45, 4.5)!);
    produced.push(derivedMetricObservation({ displayName: 'HOMA-IR', value: 40, unit: '', bandMin: 0, bandMax: 1 }).label);
    expect(produced.length).toBeGreaterThan(60);
    for (const p of produced) {
      expect(['factual_observation', 'comparison_band']).toContain(p.category);
      expect(['neutral', 'attention']).toContain(p.cue);
    }
  });

  it('with the real (empty) registry, no value however extreme produces a warning', () => {
    for (const e of getAllEntries()) {
      for (const value of [0, 1e-3, 1e3, 1e6]) expect(evaluateSafetyRules([{ name: e.key, value, unit: e.defaultUnit }])).toEqual([]);
    }
  });
});

describe('CLINICAL_ACTION_RECOMMENDATION: only result-independent product disclaimers exist', () => {
  it('each disclaimer cites its pathway and is fixed text; every guidance card note is one of them', () => {
    for (const d of Object.values(PRODUCT_DISCLAIMERS)) {
      expect(d).toMatchObject({ category: 'clinical_action', cue: 'neutral', authority: { kind: 'product_disclaimer', policy: 'NUTRIENT_GUIDELINES.md rule 2', trigger: 'unconditional' } });
      expect(d.text).not.toMatch(/\$\{|\d/);
    }
    const notes = new Set(Object.values(PRODUCT_DISCLAIMERS));
    for (const card of Object.values(CARD_MAP)) expect(notes.has(card.note)).toBe(true);
  });
});
