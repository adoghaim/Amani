import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import * as placement from './lab-placement';
import { findTextViolations, validateInterpretationOutput } from './nutrient-policy';

/*
  The deterministic interpretation generate-interpretation serves when the model
  is not used (generateFallbackInterpretation, rewritten by #152) never passes
  through validateInterpretationOutput at runtime: the handler validates model
  output only. So its copy is held to the same medical boundary here, through
  the validator #159 hardened. This runs the handler's own functions from source
  (the generation-pipeline.smoke.test.ts technique) over synthetic reports that
  reach every headline, bullet, question and summary branch and every pattern
  detectPatterns can produce. The policy may only get stricter: a violation found
  here is fixed in the fallback copy, never by loosening nutrient-policy.ts.
*/

const source = readFileSync(new URL('../generate-interpretation/index.ts', import.meta.url), 'utf8');
function fragment(start: string, end: string) {
  const a = source.indexOf(start);
  const b = source.indexOf(end, a);
  expect(a).toBeGreaterThan(0);
  expect(b).toBeGreaterThan(a);
  return source.slice(a, b);
}

type Analyte = {
  id: string; raw_name: string; canonical_slug: string; value_numeric: number; raw_value_text: string;
  unit: string; raw_reference_range: string; normalized_min: number | null; normalized_max: number | null;
  normalized_operator: string | null; normalized_operator_value: number | null; is_core: boolean;
};
type Report = {
  id: string; report_date: string; estimated_cycle_day: number | null; estimated_cycle_phase: string;
  context: { birth_control?: string; pregnant?: string; postpartum?: string; top_symptoms?: string[] };
};
type Fallback = Record<string, unknown> & {
  headline: string; summary_bullets: string[]; overall_interpretation: string; questions_for_doctor: string[];
  pattern_signals: { title: string }[];
};

const api = new Function(...Object.keys(placement), transformSync(
  fragment('function classifyAnalyte(', '// ─── OpenAI Call')
    + '\nreturn { buildPrimaryContext, generateFallbackInterpretation };',
  { loader: 'ts', target: 'es2022' },
).code)(...Object.values(placement)) as {
  buildPrimaryContext: (analytes: Analyte[], prior: Analyte[], priorDate: string | null, pinned: string | null) => unknown;
  generateFallbackInterpretation: (report: Report, analytes: Analyte[], primary: unknown) => Fallback;
};

/** A synthetic result with its printed interval; `op` gives a one-sided printed bound instead. */
const lab = (slug: string, name: string, value: number, unit: string, min: number | null, max: number | null,
  op?: { operator: string; value: number }): Analyte => ({
  id: slug, raw_name: name, canonical_slug: slug, value_numeric: value, raw_value_text: String(value), unit,
  raw_reference_range: op ? `${op.operator}${op.value}` : `${min ?? ''}-${max ?? ''}`,
  normalized_min: op ? null : min, normalized_max: op ? null : max,
  normalized_operator: op?.operator ?? null, normalized_operator_value: op?.value ?? null, is_core: true,
});
const report = (over: Partial<Report> = {}): Report => ({
  id: 'synthetic', report_date: '2026-10-17', estimated_cycle_day: null, estimated_cycle_phase: 'unknown', context: {}, ...over,
});

const cases: { name: string; report: Report; analytes: Analyte[]; prior?: Analyte[]; pinned?: string }[] = [
  {
    name: 'the October smoke panel, Vitamin D pinned, cycle unknown',
    report: report(),
    analytes: [lab('ferritin', 'Ferritin', 18, 'ng/mL', 16, 154), lab('tsh', 'TSH', 2.85, 'uIU/mL', 0.4, 4.5),
      lab('vitamin_d_25_oh', 'Vitamin D', 24, 'ng/mL', 30, 100),
      lab('ldl_cholesterol', 'LDL', 112, 'mg/dL', null, null, { operator: '<', value: 100 })],
    pinned: 'vitamin_d_25_oh',
  },
  {
    name: 'every value within its printed range, luteal day 21, symptoms reported',
    report: report({ estimated_cycle_day: 21, estimated_cycle_phase: 'luteal',
      context: { birth_control: 'no', pregnant: 'no', postpartum: 'no', top_symptoms: ['fatigue', 'cramps'] } }),
    analytes: [lab('tsh', 'TSH', 2, 'uIU/mL', 0.4, 4.5), lab('free_t4', 'Free T4', 1.2, 'ng/dL', 0.8, 1.8),
      lab('vitamin_d_25_oh', 'Vitamin D', 45, 'ng/mL', 30, 100), lab('hs_crp', 'hs-CRP', 0.5, 'mg/L', 0, 3)],
  },
  { name: 'no values read', report: report(), analytes: [] },
  {
    name: 'thyroid antibodies, glucose and lipids outside, TSH up since the prior report',
    report: report(),
    analytes: [lab('tpo_antibodies', 'TPO Antibodies', 120, 'IU/mL', 0, 34), lab('tsh', 'TSH', 6.5, 'uIU/mL', 0.4, 4.5),
      lab('fasting_glucose', 'Glucose', 112, 'mg/dL', 65, 99), lab('hemoglobin_a1c', 'Hemoglobin A1c', 6.1, '%', 4, 5.6),
      lab('fasting_insulin', 'Insulin', 30, 'uIU/mL', 2.6, 24.9), lab('ldl_cholesterol', 'LDL', 160, 'mg/dL', 0, 99),
      lab('total_cholesterol', 'Total Cholesterol', 250, 'mg/dL', 100, 199)],
    prior: [lab('tsh', 'TSH', 5, 'uIU/mL', 0.4, 4.5)],
    pinned: 'tsh',
  },
  {
    name: 'thyroid function, one glucose result and nutrients outside, pregnant, ferritin down since the prior report',
    report: report({ context: { pregnant: 'yes' } }),
    analytes: [lab('tsh', 'TSH', 0.05, 'uIU/mL', 0.4, 4.5), lab('fasting_glucose', 'Glucose', 110, 'mg/dL', 65, 99),
      lab('ferritin', 'Ferritin', 8, 'ng/mL', 16, 154), lab('vitamin_d_25_oh', 'Vitamin D', 15, 'ng/mL', 30, 100)],
    prior: [lab('ferritin', 'Ferritin', 12, 'ng/mL', 16, 154)],
    pinned: 'ferritin',
  },
  {
    name: 'luteal hormones, AMH and iron markers outside, progesterone unchanged since the prior report',
    report: report({ estimated_cycle_day: 21, estimated_cycle_phase: 'luteal',
      context: { birth_control: 'no', pregnant: 'no', top_symptoms: ['low_libido'] } }),
    analytes: [lab('estradiol', 'Estradiol', 20, 'pg/mL', 44, 211), lab('progesterone', 'Progesterone', 1, 'ng/mL', 2.5, 28),
      lab('amh', 'AMH', 0.3, 'ng/mL', 1, 8), lab('ferritin', 'Ferritin', 10, 'ng/mL', 16, 154),
      lab('hemoglobin', 'Hemoglobin', 10.5, 'g/dL', 11.7, 15.5)],
    prior: [lab('progesterone', 'Progesterone', 1, 'ng/mL', 2.5, 28)],
    pinned: 'progesterone',
  },
  {
    name: 'postpartum, on hormonal birth control, a censored result',
    report: report({ context: { postpartum: 'yes', birth_control: 'yes' } }),
    analytes: [{ ...lab('hs_crp', 'hs-CRP', 0.25, 'mg/L', 0, 3), raw_value_text: '<0.5' },
      lab('estradiol', 'Estradiol', 30, 'pg/mL', null, null)],
  },
];

const produced = cases.map(c => {
  const primary = api.buildPrimaryContext(c.analytes, c.prior ?? [], c.prior ? '2026-04-17' : null, c.pinned ?? null);
  return { name: c.name, fallback: api.generateFallbackInterpretation(c.report, c.analytes, primary) };
});

describe('the deterministic fallback interpretation passes the nutrient policy', () => {
  it.each(produced)('$name: no medical-boundary violation anywhere in the body', ({ fallback }) => {
    expect(validateInterpretationOutput(fallback)).toEqual({ valid: true, violations: [] });
    for (const text of [fallback.headline, fallback.overall_interpretation, ...fallback.summary_bullets, ...fallback.questions_for_doctor]) {
      expect(findTextViolations(text), text).toEqual([]);
    }
  });

  it('the cases reach every pattern, headline, bullet, question and summary branch', () => {
    const all = (pick: (f: Fallback) => string[]) => produced.flatMap(p => pick(p.fallback));
    // The ninth pattern, "Iron-Deficiency Signal", cannot be produced: low ferritin
    // and low hemoglobin already make the nutrient pattern above it.
    expect(new Set(all(f => f.pattern_signals.map(p => p.title)))).toEqual(new Set([
      'Thyroid Autoimmunity Pattern', 'Glucose Regulation Pattern', 'Lipid Pattern Worth Monitoring',
      'Thyroid Function Variation', 'Fasting Glucose Elevation', 'Nutrient Depletion Pattern',
      'Reproductive Hormone Variation', 'Low Ovarian Reserve Signal',
    ]));
    const headlines = all(f => [f.headline]).join('\n');
    expect(headlines).toMatch(/^No lab values could be read/m);
    expect(headlines).toMatch(/^No value on this panel is outside/m);
    expect(headlines).toMatch(/^\d+ values? outside the lab's printed reference range, including /m);
    const bullets = all(f => f.summary_bullets).join('\n');
    for (const branch of ['were drawn on cycle day 21', "Cycle timing isn't available", 'Reported symptoms:', 'Currently pregnant.',
      'Postpartum status noted. On hormonal birth control.', 'Pattern analysis identified', 'none is outside', 'No lab values were read']) {
      expect(bullets).toContain(branch);
    }
    const questions = all(f => f.questions_for_doctor).join('\n');
    for (const branch of ['came back', 'you\'d want to track over time', 'The pattern analysis flagged', 'Would adding',
      'Are there any markers not on this panel', 'drawn on day 21 of my cycle', 'most sensitive to cycle timing']) {
      expect(questions).toContain(branch);
    }
    const summaries = all(f => [f.overall_interpretation]).join('\n');
    for (const branch of ['has increased from', 'has decreased from', 'the same as your previous result', ' is also ']) {
      expect(summaries).toContain(branch);
    }
  });

  it('control: the same validator rejects a dosing line added to a fallback body', () => {
    const { fallback } = produced[0]!;
    const dosed = { ...fallback, summary_bullets: [...fallback.summary_bullets, 'Take 2000 IU of vitamin D daily.'] };
    expect(validateInterpretationOutput(dosed).valid).toBe(false);
  });
});
