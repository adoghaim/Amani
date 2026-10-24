import type { Biomarker, BiomarkerName, LabResult, DerivedMetricName, InsightSeverity } from '../types';
import { getEntry } from '../lib/biomarkers/dictionary';
import { sameUnit } from '../lib/biomarkers/normalizeReportItems';

type AnyBiomarker = Biomarker | LabResult;

function buildMap(biomarkers: AnyBiomarker[]): Record<string, number> {
  const map: Record<string, number> = {};
  for (const b of biomarkers) {
    const name = 'biomarker_name' in b ? b.biomarker_name : b.name;
    map[name] = b.value;
  }
  return map;
}

/*
  Each formula and band below is written for its inputs' catalog units, and the
  catalog approves no unit conversions: a value in another unit is not an input,
  so no metric is calculated from it (review F011).
*/
function inCatalogUnit(b: AnyBiomarker): boolean {
  const entry = getEntry(('biomarker_name' in b ? b.biomarker_name : b.name) as BiomarkerName);
  return entry !== undefined && sameUnit(b.unit, entry.defaultUnit);
}

/*
  V2-03b Stage 2. Every calculation and threshold below is unchanged. What
  changed is that this file no longer writes anything a user reads: each metric
  used to carry an interpretation ("May suggest early insulin resistance —
  worth discussing with your provider") and each rule a title naming a
  condition and a description with provider advice. None of those had an
  authorizing rule: no rule here is clinically reviewed, approved, or a
  deterministic safety rule, and none of these thresholds is in the clinical
  catalog. Their wording is now the policy's (insightCopy.ts:
  derivedMetricObservation, patternRuleObservation), which states the measured
  values and the match without a diagnosis or advice. See
  docs/clinical/TASK-045/REPORT.md, "R2 provider advice", for each instance.
*/
export interface ComputedDerivedMetric {
  name: DerivedMetricName;
  displayName: string;
  value: number;
  unit: string;
  status: 'optimal' | 'borderline' | 'out_of_range' | 'unknown';
  optimalMin: number;
  optimalMax: number;
  formulaNote: string;
}

export function computeDerivedMetrics(biomarkers: AnyBiomarker[]): ComputedDerivedMetric[] {
  const m = buildMap(biomarkers.filter(inCatalogUnit));
  const results: ComputedDerivedMetric[] = [];

  const glucose = m['fasting_glucose'];
  const insulin = m['fasting_insulin'];
  if (glucose !== undefined && insulin !== undefined) {
    const val = parseFloat(((glucose * insulin) / 405).toFixed(2));
    const status: ComputedDerivedMetric['status'] = val < 1.0 ? 'optimal' : val < 1.9 ? 'borderline' : 'out_of_range';
    results.push({
      name: 'HOMA_IR', displayName: 'HOMA-IR', value: val, unit: '', status,
      optimalMin: 0, optimalMax: 1.0, formulaNote: '(Fasting Glucose × Fasting Insulin) ÷ 405',
    });
  }

  const trig = m['triglycerides'];
  const hdl = m['hdl_cholesterol'];
  if (trig !== undefined && hdl !== undefined && hdl > 0) {
    const val = parseFloat((trig / hdl).toFixed(2));
    const status: ComputedDerivedMetric['status'] = val < 2.0 ? 'optimal' : val < 3.5 ? 'borderline' : 'out_of_range';
    results.push({
      name: 'TG_HDL_RATIO', displayName: 'Triglyceride : HDL Ratio', value: val, unit: '', status,
      optimalMin: 0, optimalMax: 2.0, formulaNote: 'Triglycerides ÷ HDL Cholesterol',
    });
  }

  const totalChol = m['total_cholesterol'];
  if (totalChol !== undefined && hdl !== undefined) {
    const val = parseFloat((totalChol - hdl).toFixed(1));
    const status: ComputedDerivedMetric['status'] = val <= 130 ? 'optimal' : val <= 159 ? 'borderline' : 'out_of_range';
    results.push({
      name: 'NON_HDL', displayName: 'Non-HDL Cholesterol', value: val, unit: 'mg/dL', status,
      optimalMin: 80, optimalMax: 130, formulaNote: 'Total Cholesterol − HDL Cholesterol',
    });
  }

  const tt = m['total_testosterone'];
  const shbg = m['shbg'];
  if (tt !== undefined && shbg !== undefined && shbg > 0) {
    const val = parseFloat(((tt / shbg) * 100).toFixed(2));
    const status: ComputedDerivedMetric['status'] = val <= 5.0 ? 'optimal' : val <= 10 ? 'borderline' : 'out_of_range';
    results.push({
      name: 'FREE_ANDROGEN_INDEX', displayName: 'Free Androgen Index (FAI)', value: val, unit: '%', status,
      optimalMin: 0, optimalMax: 5.0, formulaNote: '(Total Testosterone ÷ SHBG) × 100',
    });
  }

  const ft3 = m['free_t3'];
  const ft4 = m['free_t4'];
  if (ft3 !== undefined && ft4 !== undefined && ft4 > 0) {
    const val = parseFloat((ft3 / ft4).toFixed(3));
    const status: ComputedDerivedMetric['status'] = val >= 0.2 && val <= 0.3 ? 'optimal' : 'borderline';
    results.push({
      name: 'FT3_FT4_RATIO', displayName: 'Free T3 : Free T4 Ratio', value: val, unit: '', status,
      optimalMin: 0.2, optimalMax: 0.3, formulaNote: 'Free T3 ÷ Free T4',
    });
  }

  return results;
}

export interface InsightRuleMatch {
  rule_id: string;
  severity: InsightSeverity;
  biomarkers_involved: string[];
}

/** A rule matches or it does not. It says nothing; the policy words a match. */
export const INSIGHT_RULES: {
  rule_id: string;
  severity: InsightSeverity;
  biomarkers_involved: string[];
  check: (m: Record<string, number>, cyclePhase?: string) => boolean;
}[] = [
  {
    rule_id: 'autoimmune_thyroid_pattern',
    severity: 'discuss',
    biomarkers_involved: ['tpo_antibodies', 'tsh'],
    check: (m) => m['tpo_antibodies'] !== undefined && m['tsh'] !== undefined
      && m['tpo_antibodies'] > 100 && m['tsh'] > 2,
  },
  {
    rule_id: 'insulin_resistance_pattern',
    severity: 'discuss',
    biomarkers_involved: ['fasting_glucose', 'fasting_insulin', 'triglycerides', 'hdl_cholesterol'],
    check: (m) => {
      let signals = 0;
      if (m['fasting_glucose'] !== undefined && m['fasting_glucose'] > 90) signals++;
      if (m['fasting_insulin'] !== undefined && m['fasting_insulin'] > 10) signals++;
      if (m['triglycerides'] !== undefined && m['triglycerides'] > 100) signals++;
      if (m['hdl_cholesterol'] !== undefined && m['hdl_cholesterol'] < 60) signals++;
      return signals >= 3;
    },
  },
  {
    rule_id: 'possible_luteal_insufficiency',
    severity: 'caution',
    biomarkers_involved: ['progesterone'],
    check: (m, cyclePhase) => (m['progesterone'] !== undefined && cyclePhase === 'luteal' && m['progesterone'] < 5.0)
      || (m['progesterone'] !== undefined && !cyclePhase && m['progesterone'] < 1.0),
  },
  {
    rule_id: 'possible_iron_deficiency',
    severity: 'discuss',
    biomarkers_involved: ['ferritin', 'iron_saturation'],
    check: (m) => {
      const lowFerritin = m['ferritin'] !== undefined && m['ferritin'] < 30;
      const lowSaturation = m['iron_saturation'] !== undefined && m['iron_saturation'] < 25;
      // Either branch matched before (both low, or ferritin alone); the match is the same.
      return (lowFerritin && lowSaturation) || lowFerritin;
    },
  },
  {
    rule_id: 'possible_pcos_pattern',
    severity: 'discuss',
    biomarkers_involved: ['total_testosterone', 'dheas', 'shbg', 'lh', 'fsh'],
    check: (m) => {
      const highTT = m['total_testosterone'] !== undefined && m['total_testosterone'] > 70;
      const highDhea = m['dheas'] !== undefined && m['dheas'] > 380;
      const lowShbg = m['shbg'] !== undefined && m['shbg'] < 40;
      const lhFshRatioHigh = m['lh'] !== undefined && m['fsh'] !== undefined && m['fsh'] > 0 && (m['lh'] / m['fsh']) > 2;
      return [highTT, highDhea, lowShbg, lhFshRatioHigh].filter(Boolean).length >= 2;
    },
  },
  {
    rule_id: 'thyroid_conversion_concern',
    severity: 'caution',
    biomarkers_involved: ['tsh', 'free_t4', 'free_t3'],
    check: (m) => m['tsh'] !== undefined && m['free_t4'] !== undefined && m['free_t3'] !== undefined
      && m['tsh'] > 2.5 && m['free_t3'] < 3.0,
  },
  {
    rule_id: 'cardiovascular_risk_cluster',
    severity: 'discuss',
    biomarkers_involved: ['ldl_cholesterol', 'apob', 'hs_crp', 'lpa'],
    check: (m) => {
      let signals = 0;
      if (m['ldl_cholesterol'] !== undefined && m['ldl_cholesterol'] > 100) signals++;
      if (m['apob'] !== undefined && m['apob'] > 90) signals++;
      if (m['hs_crp'] !== undefined && m['hs_crp'] > 1.0) signals++;
      if (m['lpa'] !== undefined && m['lpa'] > 75) signals++;
      return signals >= 2;
    },
  },
  {
    rule_id: 'liver_enzyme_elevation',
    severity: 'discuss',
    biomarkers_involved: ['alt', 'ast', 'ggt'],
    check: (m) => {
      const altHigh = m['alt'] !== undefined && m['alt'] > 25;
      const astHigh = m['ast'] !== undefined && m['ast'] > 25;
      const ggtHigh = m['ggt'] !== undefined && m['ggt'] > 20;
      return [altHigh, astHigh, ggtHigh].filter(Boolean).length >= 2;
    },
  },
  {
    rule_id: 'vitamin_d_deficiency',
    severity: 'caution',
    biomarkers_involved: ['vitamin_d_25_oh'],
    // Both former branches (< 30, then < 50) match; < 50 contains < 30.
    check: (m) => (m['vitamin_d_25_oh'] !== undefined && m['vitamin_d_25_oh'] < 30)
      || (m['vitamin_d_25_oh'] !== undefined && m['vitamin_d_25_oh'] < 50),
  },
  {
    rule_id: 'low_hba1c_pattern',
    severity: 'caution',
    biomarkers_involved: ['hemoglobin_a1c'],
    check: (m) => m['hemoglobin_a1c'] !== undefined && m['hemoglobin_a1c'] >= 5.7,
  },
];

export function evaluateInsightRules(
  biomarkers: AnyBiomarker[],
  cyclePhase?: CyclePhase | string | null
): InsightRuleMatch[] {
  const m = buildMap(biomarkers);
  const matches: InsightRuleMatch[] = [];
  for (const rule of INSIGHT_RULES) {
    if (rule.check(m, cyclePhase ?? undefined)) {
      matches.push({
        rule_id: rule.rule_id,
        severity: rule.severity,
        biomarkers_involved: rule.biomarkers_involved,
      });
    }
  }
  return matches;
}

export function getMissingKeyBiomarkers(
  presentNames: string[],
  category?: string
): string[] {
  const KEY_BIOMARKERS: Record<string, string[]> = {
    hormones: ['estradiol', 'progesterone', 'fsh', 'lh', 'total_testosterone', 'shbg', 'amh'],
    thyroid: ['tsh', 'free_t3', 'free_t4', 'tpo_antibodies'],
    metabolic: ['fasting_glucose', 'hemoglobin_a1c', 'fasting_insulin'],
    lipids: ['total_cholesterol', 'hdl_cholesterol', 'ldl_cholesterol', 'triglycerides', 'apob'],
    liver: ['alt', 'ast'],
    kidney: ['creatinine', 'egfr'],
    inflammation: ['hs_crp'],
    nutrients: ['ferritin', 'vitamin_d_25_oh', 'vitamin_b12'],
  };

  const target = category ? KEY_BIOMARKERS[category] ?? [] : Object.values(KEY_BIOMARKERS).flat();
  return target.filter(b => !presentNames.includes(b));
}

import type { CyclePhase } from '../types';
