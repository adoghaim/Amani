import type { Biomarker, LabResult, DerivedMetricName, InsightSeverity } from '../types';

type AnyBiomarker = Biomarker | LabResult;

function buildMap(biomarkers: AnyBiomarker[]): Record<string, number> {
  const map: Record<string, number> = {};
  for (const b of biomarkers) {
    const name = 'biomarker_name' in b ? b.biomarker_name : b.name;
    map[name] = b.value;
  }
  return map;
}

export interface ComputedDerivedMetric {
  name: DerivedMetricName;
  displayName: string;
  value: number;
  unit: string;
  status: 'optimal' | 'borderline' | 'out_of_range' | 'unknown';
  interpretation: string;
  optimalMin: number;
  optimalMax: number;
  formulaNote: string;
}

export function computeDerivedMetrics(biomarkers: AnyBiomarker[]): ComputedDerivedMetric[] {
  const m = buildMap(biomarkers);
  const results: ComputedDerivedMetric[] = [];

  if (m['glucose_fasting'] !== undefined && m['insulin'] !== undefined) {
    const val = parseFloat(((m['glucose_fasting'] * m['insulin']) / 405).toFixed(2));
    let status: ComputedDerivedMetric['status'] = 'optimal';
    let interp = '';
    if (val < 1.0) {
      status = 'optimal';
      interp = 'Often consistent with good insulin sensitivity.';
    } else if (val < 1.9) {
      status = 'borderline';
      interp = 'Borderline — may warrant monitoring alongside symptoms and lifestyle factors.';
    } else if (val < 2.9) {
      status = 'out_of_range';
      interp = 'May suggest early insulin resistance — worth discussing with your provider.';
    } else {
      status = 'out_of_range';
      interp = 'Outside the typical range — clinicians commonly evaluate this alongside glucose trends and HbA1c.';
    }
    results.push({
      name: 'HOMA_IR', displayName: 'HOMA-IR', value: val, unit: '', status, interpretation: interp,
      optimalMin: 0, optimalMax: 1.0, formulaNote: '(Fasting Glucose × Fasting Insulin) ÷ 405',
    });
  }

  if (m['triglycerides'] !== undefined && m['hdl'] !== undefined && m['hdl'] > 0) {
    const val = parseFloat((m['triglycerides'] / m['hdl']).toFixed(2));
    let status: ComputedDerivedMetric['status'] = 'optimal';
    let interp = '';
    if (val < 2.0) {
      status = 'optimal';
      interp = 'Often consistent with a favorable metabolic and cardiovascular risk profile.';
    } else if (val < 3.5) {
      status = 'borderline';
      interp = 'Borderline — some clinicians discuss lifestyle factors that influence this ratio.';
    } else {
      status = 'out_of_range';
      interp = 'Outside the preferred range — clinicians commonly evaluate this in the context of overall cardiovascular health.';
    }
    results.push({
      name: 'TG_HDL_RATIO', displayName: 'Triglyceride : HDL Ratio', value: val, unit: '', status, interpretation: interp,
      optimalMin: 0, optimalMax: 2.0, formulaNote: 'Triglycerides ÷ HDL Cholesterol',
    });
  }

  if (m['total_cholesterol'] !== undefined && m['hdl'] !== undefined) {
    const val = parseFloat((m['total_cholesterol'] - m['hdl']).toFixed(1));
    let status: ComputedDerivedMetric['status'] = 'optimal';
    let interp = '';
    if (val <= 130) {
      status = 'optimal';
      interp = 'Within the optimal range — reflects a favorable balance of atherogenic particles.';
    } else if (val <= 159) {
      status = 'borderline';
      interp = 'Near the upper boundary — non-HDL cholesterol includes all atherogenic lipoprotein particles.';
    } else {
      status = 'out_of_range';
      interp = 'Outside the optimal range — non-HDL is a strong predictor of cardiovascular risk worth discussing with your provider.';
    }
    results.push({
      name: 'NON_HDL', displayName: 'Non-HDL Cholesterol', value: val, unit: 'mg/dL', status, interpretation: interp,
      optimalMin: 80, optimalMax: 130, formulaNote: 'Total Cholesterol − HDL Cholesterol',
    });
  }

  if (m['testosterone_total'] !== undefined && m['shbg'] !== undefined && m['shbg'] > 0) {
    const val = parseFloat(((m['testosterone_total'] / m['shbg']) * 100).toFixed(2));
    let status: ComputedDerivedMetric['status'] = 'optimal';
    let interp = '';
    if (val <= 5.0) {
      status = 'optimal';
      interp = 'Within a typical range for women; reflects the proportion of unbound, biologically active testosterone.';
    } else if (val <= 10) {
      status = 'borderline';
      interp = 'Moderately elevated — some clinicians discuss FAI alongside symptoms such as acne, hair changes, or irregular cycles.';
    } else {
      status = 'out_of_range';
      interp = 'Outside the typical range for women — clinicians commonly evaluate this in the context of androgen-related symptoms.';
    }
    results.push({
      name: 'FREE_ANDROGEN_INDEX', displayName: 'Free Androgen Index (FAI)', value: val, unit: '%', status, interpretation: interp,
      optimalMin: 0, optimalMax: 5.0, formulaNote: '(Total Testosterone ÷ SHBG) × 100',
    });
  }

  if (m['free_t3'] !== undefined && m['free_t4'] !== undefined && m['free_t4'] > 0) {
    const val = parseFloat((m['free_t3'] / m['free_t4']).toFixed(3));
    let status: ComputedDerivedMetric['status'] = 'unknown';
    let interp = '';
    if (val >= 0.2 && val <= 0.3) {
      status = 'optimal';
      interp = 'Within a commonly cited range, suggesting typical T4-to-T3 conversion.';
    } else if (val < 0.2) {
      status = 'borderline';
      interp = 'Lower than typical — some clinicians discuss this in the context of poor T4-to-T3 conversion, particularly with symptoms of fatigue or brain fog.';
    } else {
      status = 'borderline';
      interp = 'Higher than typical — worth discussing with your provider in the context of your full thyroid panel.';
    }
    results.push({
      name: 'FT3_FT4_RATIO', displayName: 'Free T3 : Free T4 Ratio', value: val, unit: '', status, interpretation: interp,
      optimalMin: 0.2, optimalMax: 0.3, formulaNote: 'Free T3 ÷ Free T4',
    });
  }

  return results;
}

export interface InsightRuleMatch {
  rule_id: string;
  severity: InsightSeverity;
  title: string;
  description: string;
  biomarkers_involved: string[];
}

export const INSIGHT_RULES: {
  rule_id: string;
  severity: InsightSeverity;
  title: string;
  biomarkers_involved: string[];
  check: (m: Record<string, number>, cyclePhase?: string) => string | null;
}[] = [
  {
    rule_id: 'autoimmune_thyroid_pattern',
    severity: 'discuss',
    title: 'Possible Autoimmune Thyroid Pattern',
    biomarkers_involved: ['tpo_antibodies', 'tsh'],
    check: (m) => {
      if (m['tpo_antibodies'] !== undefined && m['tsh'] !== undefined) {
        if (m['tpo_antibodies'] > 100 && m['tsh'] > 2) {
          return 'Your TPO antibodies are elevated (above 100 IU/mL) and TSH is above the Amani optimal range. Clinicians commonly evaluate this combination in the context of autoimmune thyroid conditions such as Hashimoto\'s thyroiditis. This pattern may be worth discussing with your provider alongside any thyroid-related symptoms such as fatigue, hair loss, or weight changes.';
        }
      }
      return null;
    },
  },
  {
    rule_id: 'insulin_resistance_pattern',
    severity: 'discuss',
    title: 'Metabolic / Insulin Resistance Pattern',
    biomarkers_involved: ['glucose_fasting', 'insulin', 'triglycerides', 'hdl'],
    check: (m) => {
      let signals = 0;
      if (m['glucose_fasting'] !== undefined && m['glucose_fasting'] > 90) signals++;
      if (m['insulin'] !== undefined && m['insulin'] > 10) signals++;
      if (m['triglycerides'] !== undefined && m['triglycerides'] > 100) signals++;
      if (m['hdl'] !== undefined && m['hdl'] < 60) signals++;
      if (signals >= 3) {
        return 'Three or more metabolic markers are outside optimal ranges. Clinicians commonly evaluate combinations of fasting glucose, insulin, triglycerides, and HDL together as they can reflect overall metabolic and insulin sensitivity. This cluster pattern may be worth a focused conversation with your provider.';
      }
      return null;
    },
  },
  {
    rule_id: 'possible_luteal_insufficiency',
    severity: 'caution',
    title: 'Possible Luteal Phase Insufficiency',
    biomarkers_involved: ['progesterone'],
    check: (m, cyclePhase) => {
      if (m['progesterone'] !== undefined && cyclePhase === 'luteal' && m['progesterone'] < 5.0) {
        return 'Progesterone is below the expected range for the luteal phase (optimal: 5–25 ng/mL). Adequate progesterone after ovulation supports uterine lining health and cycle regularity. This pattern may warrant testing on a specific cycle day (typically Day 21 of a 28-day cycle) and discussion with your provider.';
      }
      if (m['progesterone'] !== undefined && !cyclePhase && m['progesterone'] < 1.0) {
        return 'Progesterone is very low. If tested during the luteal phase, this level is below what supports adequate luteal function. Consider re-testing with specific cycle day information to contextualize this result.';
      }
      return null;
    },
  },
  {
    rule_id: 'possible_iron_deficiency',
    severity: 'discuss',
    title: 'Iron Deficiency Pattern',
    biomarkers_involved: ['ferritin', 'iron_saturation'],
    check: (m) => {
      const lowFerritin = m['ferritin'] !== undefined && m['ferritin'] < 30;
      const lowSaturation = m['iron_saturation'] !== undefined && m['iron_saturation'] < 25;
      if (lowFerritin && lowSaturation) {
        return 'Both ferritin (iron storage) and iron saturation (transport) are below optimal. This pattern is consistent with iron deficiency that may precede anemia. Common symptoms include fatigue, hair loss, shortness of breath, and reduced exercise tolerance. This is worth discussing with your provider, especially if you have heavy periods.';
      }
      if (lowFerritin) {
        return 'Ferritin is below 30 ng/mL, which is below the Amani optimal range even when within the standard lab reference range. Some clinicians consider functional iron deficiency at this level, particularly in women with heavy periods or active lifestyles. Symptoms such as fatigue and hair loss may be present before anemia develops.';
      }
      return null;
    },
  },
  {
    rule_id: 'possible_pcos_pattern',
    severity: 'discuss',
    title: 'Possible PCOS-Related Pattern',
    biomarkers_involved: ['testosterone_total', 'dhea_s', 'shbg', 'lh', 'fsh'],
    check: (m) => {
      const highTT = m['testosterone_total'] !== undefined && m['testosterone_total'] > 70;
      const highDhea = m['dhea_s'] !== undefined && m['dhea_s'] > 380;
      const lowShbg = m['shbg'] !== undefined && m['shbg'] < 40;
      const lhFshRatioHigh = m['lh'] !== undefined && m['fsh'] !== undefined && m['fsh'] > 0 && (m['lh'] / m['fsh']) > 2;
      const signals = [highTT, highDhea, lowShbg, lhFshRatioHigh].filter(Boolean).length;
      if (signals >= 2) {
        return 'Multiple androgen-related markers are outside the optimal range. Elevated testosterone or DHEA-S with low SHBG, or an LH:FSH ratio above 2, are patterns clinicians commonly evaluate in the context of PCOS (polycystic ovary syndrome). This pattern should be discussed with your provider alongside cycle history, symptoms, and any imaging.';
      }
      return null;
    },
  },
  {
    rule_id: 'thyroid_conversion_concern',
    severity: 'caution',
    title: 'Thyroid Conversion Pattern',
    biomarkers_involved: ['tsh', 'free_t4', 'free_t3'],
    check: (m) => {
      if (m['tsh'] !== undefined && m['free_t4'] !== undefined && m['free_t3'] !== undefined) {
        if (m['tsh'] > 2.5 && m['free_t3'] < 3.0) {
          return 'TSH is in the higher-normal range alongside a lower Free T3. Some clinicians evaluate this pattern in the context of suboptimal T4-to-T3 conversion, particularly when symptoms such as fatigue, brain fog, or cold sensitivity are present. This combination may be worth discussing in the context of your full thyroid panel.';
        }
      }
      return null;
    },
  },
  {
    rule_id: 'cardiovascular_risk_cluster',
    severity: 'discuss',
    title: 'Cardiovascular Risk Cluster',
    biomarkers_involved: ['ldl', 'apob', 'hscrp', 'lpa'],
    check: (m) => {
      let signals = 0;
      if (m['ldl'] !== undefined && m['ldl'] > 100) signals++;
      if (m['apob'] !== undefined && m['apob'] > 90) signals++;
      if (m['hscrp'] !== undefined && m['hscrp'] > 1.0) signals++;
      if (m['lpa'] !== undefined && m['lpa'] > 75) signals++;
      if (signals >= 2) {
        return 'Two or more cardiovascular risk markers are outside the optimal range. LDL, ApoB, hs-CRP, and Lp(a) are commonly evaluated together when assessing cardiovascular health. This combination may be worth a dedicated conversation with your provider, especially if you have a family history of heart disease.';
      }
      return null;
    },
  },
  {
    rule_id: 'liver_enzyme_elevation',
    severity: 'discuss',
    title: 'Liver Enzyme Elevation',
    biomarkers_involved: ['alt', 'ast', 'ggt'],
    check: (m) => {
      const altHigh = m['alt'] !== undefined && m['alt'] > 25;
      const astHigh = m['ast'] !== undefined && m['ast'] > 25;
      const ggtHigh = m['ggt'] !== undefined && m['ggt'] > 20;
      if ([altHigh, astHigh, ggtHigh].filter(Boolean).length >= 2) {
        return 'Multiple liver enzymes are above the Amani optimal range. Clinicians commonly evaluate elevated ALT, AST, and GGT together to assess liver health. Contributing factors can include fatty liver, alcohol, medications, or metabolic conditions. This pattern is worth discussing with your provider.';
      }
      return null;
    },
  },
  {
    rule_id: 'vitamin_d_deficiency',
    severity: 'caution',
    title: 'Vitamin D Below Optimal',
    biomarkers_involved: ['vitamin_d'],
    check: (m) => {
      if (m['vitamin_d'] !== undefined && m['vitamin_d'] < 30) {
        return 'Vitamin D is below 30 ng/mL, which is generally considered deficient. Vitamin D plays a role in immune function, bone health, mood regulation, and hormone signaling. This is commonly discussed with a provider, particularly if you have limited sun exposure or related symptoms.';
      }
      if (m['vitamin_d'] !== undefined && m['vitamin_d'] < 50) {
        return 'Vitamin D is within the clinical reference range but below the Amani optimal threshold of 50 ng/mL. Vitamin D plays a role in immune function, hormone signaling, and mood regulation. Some clinicians target higher levels. This may be worth discussing with your provider.';
      }
      return null;
    },
  },
];

export function evaluateInsightRules(
  biomarkers: AnyBiomarker[],
  cyclePhase?: CyclePhase | string | null
): InsightRuleMatch[] {
  const m = buildMap(biomarkers);
  const matches: InsightRuleMatch[] = [];
  for (const rule of INSIGHT_RULES) {
    const desc = rule.check(m, cyclePhase ?? undefined);
    if (desc) {
      matches.push({
        rule_id: rule.rule_id,
        severity: rule.severity,
        title: rule.title,
        description: desc,
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
    hormones: ['estradiol', 'progesterone', 'fsh', 'lh', 'testosterone_total', 'shbg', 'amh'],
    thyroid: ['tsh', 'free_t3', 'free_t4', 'tpo_antibodies'],
    metabolic: ['glucose_fasting', 'hba1c', 'insulin'],
    lipids: ['total_cholesterol', 'hdl', 'ldl', 'triglycerides', 'apob'],
    liver: ['alt', 'ast'],
    kidney: ['creatinine', 'egfr'],
    inflammation: ['hscrp'],
    nutrients: ['ferritin', 'vitamin_d', 'b12'],
  };

  const target = category ? KEY_BIOMARKERS[category] ?? [] : Object.values(KEY_BIOMARKERS).flat();
  return target.filter(b => !presentNames.includes(b));
}
