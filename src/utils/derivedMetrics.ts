import type { Biomarker, DerivedMetric, DerivedMetricName } from '../types';

interface BiomarkerMap {
  [key: string]: number;
}

function buildMap(biomarkers: Biomarker[]): BiomarkerMap {
  const map: BiomarkerMap = {};
  for (const b of biomarkers) {
    map[b.name] = b.value;
  }
  return map;
}

export interface ComputedDerivedMetric {
  name: DerivedMetricName;
  value: number;
  interpretation: string;
}

export function computeDerivedMetrics(biomarkers: Biomarker[]): ComputedDerivedMetric[] {
  const m = buildMap(biomarkers);
  const results: ComputedDerivedMetric[] = [];

  if (m['glucose_fasting'] !== undefined && m['insulin'] !== undefined) {
    const homaIr = (m['glucose_fasting'] * m['insulin']) / 405;
    let interp = '';
    if (homaIr < 1.0) interp = 'Often consistent with good insulin sensitivity.';
    else if (homaIr < 1.9) interp = 'Borderline — may warrant monitoring alongside symptoms and lifestyle factors.';
    else if (homaIr < 2.9) interp = 'May suggest early insulin resistance — worth discussing with your provider.';
    else interp = 'Outside the typical range — clinicians commonly evaluate this alongside glucose trends and HbA1c.';
    results.push({ name: 'HOMA_IR', value: parseFloat(homaIr.toFixed(2)), interpretation: interp });
  }

  if (m['triglycerides'] !== undefined && m['hdl'] !== undefined && m['hdl'] > 0) {
    const ratio = m['triglycerides'] / m['hdl'];
    let interp = '';
    if (ratio < 2.0) interp = 'Often consistent with a favorable metabolic and cardiovascular risk profile.';
    else if (ratio < 3.5) interp = 'Borderline — some clinicians may discuss lifestyle factors that influence this ratio.';
    else interp = 'Outside the preferred range — clinicians commonly evaluate this in the context of overall cardiovascular health.';
    results.push({ name: 'Triglyceride_HDL_ratio', value: parseFloat(ratio.toFixed(2)), interpretation: interp });
  }

  if (m['testosterone_total'] !== undefined && m['shbg'] !== undefined && m['shbg'] > 0) {
    const fai = (m['testosterone_total'] / m['shbg']) * 100;
    let interp = '';
    if (fai < 5) interp = 'Within a typical range for women; reflects the proportion of unbound, biologically active testosterone.';
    else if (fai < 10) interp = 'Moderately elevated — some clinicians discuss FAI alongside symptoms such as acne, hair changes, or irregular cycles.';
    else interp = 'Outside the typical range for women — clinicians commonly evaluate this in the context of androgen-related symptoms.';
    results.push({ name: 'Free_Androgen_Index', value: parseFloat(fai.toFixed(2)), interpretation: interp });
  }

  if (m['apob'] !== undefined && m['ldl'] !== undefined && m['ldl'] > 0) {
    const ratio = m['apob'] / m['ldl'];
    let interp = '';
    if (ratio < 0.9) interp = 'Within a typical range — ApoB and LDL are closely aligned.';
    else if (ratio < 1.1) interp = 'Borderline — some clinicians use this ratio to assess particle concentration relative to cholesterol mass.';
    else interp = 'Elevated ApoB relative to LDL — clinicians may discuss this as an indicator of higher small, dense LDL particle count.';
    results.push({ name: 'ApoB_ratio', value: parseFloat(ratio.toFixed(2)), interpretation: interp });
  }

  if (m['free_t3'] !== undefined && m['free_t4'] !== undefined && m['free_t4'] > 0) {
    const ratio = m['free_t3'] / m['free_t4'];
    let interp = '';
    if (ratio >= 0.2 && ratio <= 0.3) interp = 'Within a commonly cited range, suggesting typical T4-to-T3 conversion.';
    else if (ratio < 0.2) interp = 'Lower than typical — some clinicians discuss this in the context of poor T4-to-T3 conversion, particularly with symptoms of fatigue or brain fog.';
    else interp = 'Higher than typical — worth discussing with your provider in the context of your full thyroid panel.';
    results.push({ name: 'T3_T4_ratio', value: parseFloat(ratio.toFixed(3)), interpretation: interp });
  }

  return results;
}

export interface InsightRule {
  id: string;
  severity: 'info' | 'caution' | 'discuss';
  title: string;
  biomarkersInvolved: string[];
  check: (m: BiomarkerMap) => string | null;
}

export const INSIGHT_RULES: InsightRule[] = [
  {
    id: 'autoimmune_thyroid',
    severity: 'discuss',
    title: 'Possible autoimmune thyroid pattern',
    biomarkersInvolved: ['tpo_antibodies', 'tsh'],
    check: (m) => {
      if (m['tpo_antibodies'] !== undefined && m['tsh'] !== undefined) {
        if (m['tpo_antibodies'] > 100 && m['tsh'] > 2) {
          return 'Your TPO antibodies are elevated (above 100 IU/mL) and your TSH is above the optimal range. Clinicians commonly evaluate this combination in the context of autoimmune thyroid conditions such as Hashimoto\'s thyroiditis. This pattern may be worth discussing with your provider alongside any thyroid-related symptoms.';
        }
      }
      return null;
    },
  },
  {
    id: 'insulin_resistance_pattern',
    severity: 'discuss',
    title: 'Metabolic pattern worth discussing',
    biomarkersInvolved: ['glucose_fasting', 'insulin', 'triglycerides', 'hdl'],
    check: (m) => {
      let signals = 0;
      if (m['glucose_fasting'] !== undefined && m['glucose_fasting'] > 90) signals++;
      if (m['insulin'] !== undefined && m['insulin'] > 10) signals++;
      if (m['triglycerides'] !== undefined && m['triglycerides'] > 100) signals++;
      if (m['hdl'] !== undefined && m['hdl'] < 60) signals++;
      if (signals >= 3) {
        return 'Multiple metabolic markers are outside optimal ranges. Clinicians commonly evaluate combinations of fasting glucose, insulin, triglycerides, and HDL together as they can reflect overall metabolic health. This pattern may be worth a focused conversation with your provider.';
      }
      return null;
    },
  },
  {
    id: 'thyroid_conversion_concern',
    severity: 'caution',
    title: 'Thyroid conversion pattern',
    biomarkersInvolved: ['tsh', 'free_t4', 'free_t3'],
    check: (m) => {
      if (m['tsh'] !== undefined && m['free_t4'] !== undefined && m['free_t3'] !== undefined) {
        if (m['tsh'] > 2.5 && m['free_t3'] < 3.0) {
          return 'Your TSH is in the higher-normal range alongside a lower Free T3. Some clinicians evaluate this pattern in the context of suboptimal T4-to-T3 conversion, particularly when symptoms such as fatigue, brain fog, or cold sensitivity are present.';
        }
      }
      return null;
    },
  },
  {
    id: 'low_iron_stores',
    severity: 'discuss',
    title: 'Iron status pattern',
    biomarkersInvolved: ['ferritin', 'iron'],
    check: (m) => {
      if (m['ferritin'] !== undefined && m['ferritin'] < 30) {
        const ironLow = m['iron'] !== undefined && m['iron'] < 70;
        if (ironLow) {
          return 'Both ferritin and serum iron are in the lower range. Clinicians commonly evaluate this combination as it may reflect iron deficiency at the storage and circulating level. This is worth discussing with your provider, particularly if you experience fatigue, hair loss, or shortness of breath.';
        }
        return 'Ferritin is below 30 ng/mL, which is below the optimal range even when within the clinical reference range. Some clinicians consider functional iron deficiency at this level, particularly in women with heavy periods or active lifestyles.';
      }
      return null;
    },
  },
  {
    id: 'cardiovascular_risk_cluster',
    severity: 'discuss',
    title: 'Cardiovascular risk factors cluster',
    biomarkersInvolved: ['ldl', 'apob', 'hscrp', 'homocysteine'],
    check: (m) => {
      let signals = 0;
      if (m['ldl'] !== undefined && m['ldl'] > 100) signals++;
      if (m['apob'] !== undefined && m['apob'] > 90) signals++;
      if (m['hscrp'] !== undefined && m['hscrp'] > 1.0) signals++;
      if (m['homocysteine'] !== undefined && m['homocysteine'] > 10) signals++;
      if (signals >= 2) {
        return 'Two or more cardiovascular risk markers are outside the optimal range. Clinicians commonly evaluate LDL, ApoB, hs-CRP, and homocysteine together when assessing overall cardiovascular health. This combination may be worth a dedicated discussion with your provider.';
      }
      return null;
    },
  },
  {
    id: 'high_androgens_women',
    severity: 'caution',
    title: 'Elevated androgen pattern',
    biomarkersInvolved: ['testosterone_total', 'dhea_s', 'shbg'],
    check: (m) => {
      const highTestosterone = m['testosterone_total'] !== undefined && m['testosterone_total'] > 70;
      const highDhea = m['dhea_s'] !== undefined && m['dhea_s'] > 380;
      const lowShbg = m['shbg'] !== undefined && m['shbg'] < 40;
      if ((highTestosterone || highDhea) && lowShbg) {
        return 'Elevated androgen levels alongside low SHBG may result in higher free androgen availability. Clinicians commonly discuss this pattern in the context of symptoms such as acne, unwanted hair growth, or irregular cycles — and may evaluate for conditions like PCOS or adrenal androgen excess.';
      }
      if (highTestosterone && highDhea) {
        return 'Both total testosterone and DHEA-S are in the higher range. Clinicians commonly evaluate this combination alongside symptoms and cycle patterns to assess androgen-related conditions.';
      }
      return null;
    },
  },
  {
    id: 'vitamin_d_deficiency',
    severity: 'caution',
    title: 'Vitamin D below optimal',
    biomarkersInvolved: ['vitamin_d'],
    check: (m) => {
      if (m['vitamin_d'] !== undefined && m['vitamin_d'] < 30) {
        return 'Vitamin D is below 30 ng/mL, which is generally considered deficient. Vitamin D plays a role in immune function, bone health, mood regulation, and hormone signaling. This is commonly discussed with a provider, particularly if you have limited sun exposure or related symptoms.';
      }
      return null;
    },
  },
  {
    id: 'liver_enzyme_elevation',
    severity: 'discuss',
    title: 'Liver enzyme elevation',
    biomarkersInvolved: ['alt', 'ast', 'ggt'],
    check: (m) => {
      const altHigh = m['alt'] !== undefined && m['alt'] > 35;
      const astHigh = m['ast'] !== undefined && m['ast'] > 35;
      const ggtHigh = m['ggt'] !== undefined && m['ggt'] > 40;
      const count = [altHigh, astHigh, ggtHigh].filter(Boolean).length;
      if (count >= 2) {
        return 'Multiple liver enzymes are outside the typical range. Clinicians commonly evaluate elevated ALT, AST, and GGT together to assess liver health. This pattern may be worth discussing with your provider, particularly in the context of medications, alcohol intake, or metabolic factors.';
      }
      return null;
    },
  },
  {
    id: 'kidney_function_concern',
    severity: 'discuss',
    title: 'Kidney function pattern',
    biomarkersInvolved: ['egfr', 'creatinine', 'bun'],
    check: (m) => {
      const lowEgfr = m['egfr'] !== undefined && m['egfr'] < 60;
      const highCreatinine = m['creatinine'] !== undefined && m['creatinine'] > 1.0;
      if (lowEgfr || (highCreatinine && m['bun'] !== undefined && m['bun'] > 20)) {
        return 'Kidney function markers are outside the typical range. Clinicians commonly evaluate eGFR, creatinine, and BUN together to assess kidney health. This pattern is worth discussing with your provider, particularly if you experience changes in urination, swelling, or fatigue.';
      }
      return null;
    },
  },
  {
    id: 'inflammation_markers_elevated',
    severity: 'caution',
    title: 'Inflammation markers elevated',
    biomarkersInvolved: ['hscrp', 'homocysteine'],
    check: (m) => {
      const highCrp = m['hscrp'] !== undefined && m['hscrp'] > 3.0;
      const highHcy = m['homocysteine'] !== undefined && m['homocysteine'] > 15;
      if (highCrp && highHcy) {
        return 'Both hs-CRP and homocysteine are elevated. These are markers of systemic inflammation and vascular stress. Clinicians commonly evaluate this combination alongside cardiovascular and lifestyle factors. Discussing these results with your provider is recommended.';
      }
      return null;
    },
  },
];

export function evaluateInsightRules(biomarkers: Biomarker[]) {
  const m = buildMap(biomarkers);
  return INSIGHT_RULES
    .map(rule => {
      const description = rule.check(m);
      if (!description) return null;
      return {
        rule_id: rule.id,
        severity: rule.severity,
        title: rule.title,
        description,
        biomarkers_involved: rule.biomarkersInvolved,
      };
    })
    .filter(Boolean) as { rule_id: string; severity: 'info' | 'caution' | 'discuss'; title: string; description: string; biomarkers_involved: string[] }[];
}
