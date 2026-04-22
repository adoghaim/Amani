import type {
  Biomarker,
  CyclePhase,
  DerivedMetricName,
  InsightSeverity,
  LabResult,
} from '../types';

type AnyBiomarker = Biomarker | LabResult;

function buildMap(biomarkers: AnyBiomarker[]): Record<string, number> {
  const map: Record<string, number> = {};

  for (const biomarker of biomarkers) {
    const name = 'biomarker_name' in biomarker ? biomarker.biomarker_name : biomarker.name;
    map[name] = biomarker.value;
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
  const values = buildMap(biomarkers);
  const results: ComputedDerivedMetric[] = [];

  const glucose = values.fasting_glucose;
  const insulin = values.fasting_insulin;
  if (glucose !== undefined && insulin !== undefined) {
    const value = parseFloat(((glucose * insulin) / 405).toFixed(2));
    let status: ComputedDerivedMetric['status'] = 'optimal';
    let interpretation = '';

    if (value < 1.0) {
      interpretation = 'Often consistent with good insulin sensitivity.';
    } else if (value < 1.9) {
      status = 'borderline';
      interpretation = 'Borderline. Monitor alongside symptoms and lifestyle factors.';
    } else if (value < 2.9) {
      status = 'out_of_range';
      interpretation = 'May suggest early insulin resistance and is worth discussing with your provider.';
    } else {
      status = 'out_of_range';
      interpretation = 'Outside the typical range. Clinicians commonly review this with glucose trends and HbA1c.';
    }

    results.push({
      name: 'HOMA_IR',
      displayName: 'HOMA-IR',
      value,
      unit: '',
      status,
      interpretation,
      optimalMin: 0,
      optimalMax: 1.0,
      formulaNote: '(Fasting Glucose × Fasting Insulin) ÷ 405',
    });
  }

  const triglycerides = values.triglycerides;
  const hdl = values.hdl_cholesterol;
  if (triglycerides !== undefined && hdl !== undefined && hdl > 0) {
    const value = parseFloat((triglycerides / hdl).toFixed(2));
    let status: ComputedDerivedMetric['status'] = 'optimal';
    let interpretation = '';

    if (value < 2.0) {
      interpretation = 'Often consistent with a favorable metabolic and cardiovascular risk profile.';
    } else if (value < 3.5) {
      status = 'borderline';
      interpretation = 'Borderline. Some clinicians review lifestyle factors that influence this ratio.';
    } else {
      status = 'out_of_range';
      interpretation = 'Outside the preferred range and commonly reviewed in overall cardiovascular context.';
    }

    results.push({
      name: 'TG_HDL_RATIO',
      displayName: 'Triglyceride : HDL Ratio',
      value,
      unit: '',
      status,
      interpretation,
      optimalMin: 0,
      optimalMax: 2.0,
      formulaNote: 'Triglycerides ÷ HDL Cholesterol',
    });
  }

  const totalCholesterol = values.total_cholesterol;
  if (totalCholesterol !== undefined && hdl !== undefined) {
    const value = parseFloat((totalCholesterol - hdl).toFixed(1));
    let status: ComputedDerivedMetric['status'] = 'optimal';
    let interpretation = '';

    if (value <= 130) {
      interpretation = 'Within the optimal range and reflects a favorable balance of atherogenic particles.';
    } else if (value <= 159) {
      status = 'borderline';
      interpretation = 'Near the upper boundary. Non-HDL includes all atherogenic lipoprotein particles.';
    } else {
      status = 'out_of_range';
      interpretation = 'Outside the optimal range and worth discussing in cardiovascular context.';
    }

    results.push({
      name: 'NON_HDL',
      displayName: 'Non-HDL Cholesterol',
      value,
      unit: 'mg/dL',
      status,
      interpretation,
      optimalMin: 80,
      optimalMax: 130,
      formulaNote: 'Total Cholesterol − HDL Cholesterol',
    });
  }

  const totalTestosterone = values.total_testosterone;
  const shbg = values.shbg;
  if (totalTestosterone !== undefined && shbg !== undefined && shbg > 0) {
    const value = parseFloat(((totalTestosterone / shbg) * 100).toFixed(2));
    let status: ComputedDerivedMetric['status'] = 'optimal';
    let interpretation = '';

    if (value <= 5.0) {
      interpretation = 'Within a typical range for women and reflects the proportion of unbound testosterone.';
    } else if (value <= 10) {
      status = 'borderline';
      interpretation = 'Moderately elevated and sometimes reviewed with acne, hair changes, or irregular cycles.';
    } else {
      status = 'out_of_range';
      interpretation = 'Outside the typical range for women and commonly reviewed with androgen-related symptoms.';
    }

    results.push({
      name: 'FREE_ANDROGEN_INDEX',
      displayName: 'Free Androgen Index (FAI)',
      value,
      unit: '%',
      status,
      interpretation,
      optimalMin: 0,
      optimalMax: 5.0,
      formulaNote: '(Total Testosterone ÷ SHBG) × 100',
    });
  }

  const freeT3 = values.free_t3;
  const freeT4 = values.free_t4;
  if (freeT3 !== undefined && freeT4 !== undefined && freeT4 > 0) {
    const value = parseFloat((freeT3 / freeT4).toFixed(3));
    let status: ComputedDerivedMetric['status'] = 'unknown';
    let interpretation = '';

    if (value >= 0.2 && value <= 0.3) {
      status = 'optimal';
      interpretation = 'Within a commonly cited range, suggesting typical T4-to-T3 conversion.';
    } else if (value < 0.2) {
      status = 'borderline';
      interpretation = 'Lower than typical and sometimes discussed with fatigue or brain fog.';
    } else {
      status = 'borderline';
      interpretation = 'Higher than typical and worth reviewing with your full thyroid panel.';
    }

    results.push({
      name: 'FT3_FT4_RATIO',
      displayName: 'Free T3 : Free T4 Ratio',
      value,
      unit: '',
      status,
      interpretation,
      optimalMin: 0.2,
      optimalMax: 0.3,
      formulaNote: 'Free T3 ÷ Free T4',
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
      if (m.tpo_antibodies !== undefined && m.tsh !== undefined && m.tpo_antibodies > 100 && m.tsh > 2) {
        return 'TPO antibodies are elevated and TSH is above the Amani optimal range. Clinicians commonly review this pattern in autoimmune thyroid conditions such as Hashimoto\'s thyroiditis.';
      }
      return null;
    },
  },
  {
    rule_id: 'insulin_resistance_pattern',
    severity: 'discuss',
    title: 'Metabolic / Insulin Resistance Pattern',
    biomarkers_involved: ['fasting_glucose', 'fasting_insulin', 'triglycerides', 'hdl_cholesterol'],
    check: (m) => {
      let signals = 0;
      if (m.fasting_glucose !== undefined && m.fasting_glucose > 90) signals++;
      if (m.fasting_insulin !== undefined && m.fasting_insulin > 10) signals++;
      if (m.triglycerides !== undefined && m.triglycerides > 100) signals++;
      if (m.hdl_cholesterol !== undefined && m.hdl_cholesterol < 60) signals++;
      if (signals >= 3) {
        return 'Three or more metabolic markers are outside optimal ranges. This combination is often reviewed as part of overall insulin sensitivity.';
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
      if (m.progesterone !== undefined && cyclePhase === 'luteal' && m.progesterone < 5.0) {
        return 'Progesterone is below the expected range for the luteal phase. This pattern may warrant cycle-timed retesting and provider follow-up.';
      }
      if (m.progesterone !== undefined && !cyclePhase && m.progesterone < 1.0) {
        return 'Progesterone is very low. If this was drawn in the luteal phase, clinicians often repeat testing with clear cycle-day context.';
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
      const lowFerritin = m.ferritin !== undefined && m.ferritin < 30;
      const lowSaturation = m.iron_saturation !== undefined && m.iron_saturation < 25;
      if (lowFerritin && lowSaturation) {
        return 'Ferritin and iron saturation are both below optimal, which can fit an iron deficiency pattern even before anemia appears.';
      }
      if (lowFerritin) {
        return 'Ferritin is below the Amani optimal range and can reflect low iron stores, especially with heavy periods or fatigue symptoms.';
      }
      return null;
    },
  },
  {
    rule_id: 'possible_pcos_pattern',
    severity: 'discuss',
    title: 'Possible PCOS-Related Pattern',
    biomarkers_involved: ['total_testosterone', 'dheas', 'shbg', 'lh', 'fsh'],
    check: (m) => {
      const highTT = m.total_testosterone !== undefined && m.total_testosterone > 70;
      const highDhea = m.dheas !== undefined && m.dheas > 380;
      const lowShbg = m.shbg !== undefined && m.shbg < 40;
      const lhFshRatioHigh =
        m.lh !== undefined &&
        m.fsh !== undefined &&
        m.fsh > 0 &&
        m.lh / m.fsh > 2;
      const signals = [highTT, highDhea, lowShbg, lhFshRatioHigh].filter(Boolean).length;
      if (signals >= 2) {
        return 'Multiple androgen-related markers are outside optimal ranges, which clinicians commonly review in the context of PCOS alongside symptoms and cycle history.';
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
      if (m.tsh !== undefined && m.free_t4 !== undefined && m.free_t3 !== undefined && m.tsh > 2.5 && m.free_t3 < 3.0) {
        return 'TSH is in the higher-normal range alongside a lower Free T3. Some clinicians review this with conversion concerns and symptoms such as fatigue or brain fog.';
      }
      return null;
    },
  },
  {
    rule_id: 'cardiovascular_risk_cluster',
    severity: 'discuss',
    title: 'Cardiovascular Risk Cluster',
    biomarkers_involved: ['ldl_cholesterol', 'apob', 'hs_crp', 'lpa'],
    check: (m) => {
      let signals = 0;
      if (m.ldl_cholesterol !== undefined && m.ldl_cholesterol > 100) signals++;
      if (m.apob !== undefined && m.apob > 90) signals++;
      if (m.hs_crp !== undefined && m.hs_crp > 1.0) signals++;
      if (m.lpa !== undefined && m.lpa > 75) signals++;
      if (signals >= 2) {
        return 'Two or more cardiovascular risk markers are outside optimal range and may deserve a more focused discussion with your provider.';
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
      const altHigh = m.alt !== undefined && m.alt > 25;
      const astHigh = m.ast !== undefined && m.ast > 25;
      const ggtHigh = m.ggt !== undefined && m.ggt > 20;
      if ([altHigh, astHigh, ggtHigh].filter(Boolean).length >= 2) {
        return 'Multiple liver enzymes are above the Amani optimal range. This pattern is commonly reviewed for liver and metabolic context.';
      }
      return null;
    },
  },
  {
    rule_id: 'vitamin_d_deficiency',
    severity: 'caution',
    title: 'Vitamin D Below Optimal',
    biomarkers_involved: ['vitamin_d_25_oh'],
    check: (m) => {
      if (m.vitamin_d_25_oh !== undefined && m.vitamin_d_25_oh < 30) {
        return 'Vitamin D is below 30 ng/mL, which is generally considered deficient and often discussed alongside bone, immune, and mood health.';
      }
      if (m.vitamin_d_25_oh !== undefined && m.vitamin_d_25_oh < 50) {
        return 'Vitamin D is within the clinical reference range but below the Amani optimal threshold of 50 ng/mL.';
      }
      return null;
    },
  },
  {
    rule_id: 'low_hba1c_pattern',
    severity: 'caution',
    title: 'Elevated HbA1c',
    biomarkers_involved: ['hemoglobin_a1c'],
    check: (m) => {
      if (m.hemoglobin_a1c !== undefined && m.hemoglobin_a1c >= 5.7) {
        return 'HbA1c is at or above 5.7%, which some guidelines classify as prediabetes range and is worth reviewing with fasting glucose and symptoms.';
      }
      return null;
    },
  },
];

export function evaluateInsightRules(
  biomarkers: AnyBiomarker[],
  cyclePhase?: CyclePhase | string | null
): InsightRuleMatch[] {
  const values = buildMap(biomarkers);
  const matches: InsightRuleMatch[] = [];

  for (const rule of INSIGHT_RULES) {
    const description = rule.check(values, cyclePhase ?? undefined);
    if (description) {
      matches.push({
        rule_id: rule.rule_id,
        severity: rule.severity,
        title: rule.title,
        description,
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
  const keyBiomarkers: Record<string, string[]> = {
    hormones: ['estradiol', 'progesterone', 'fsh', 'lh', 'total_testosterone', 'shbg', 'amh'],
    thyroid: ['tsh', 'free_t3', 'free_t4', 'tpo_antibodies'],
    metabolic: ['fasting_glucose', 'hemoglobin_a1c', 'fasting_insulin'],
    lipids: ['total_cholesterol', 'hdl_cholesterol', 'ldl_cholesterol', 'triglycerides', 'apob'],
    liver: ['alt', 'ast'],
    kidney: ['creatinine', 'egfr'],
    inflammation: ['hs_crp'],
    nutrients: ['ferritin', 'vitamin_d_25_oh', 'vitamin_b12'],
  };

  const target = category ? keyBiomarkers[category] ?? [] : Object.values(keyBiomarkers).flat();
  return target.filter((biomarker) => !presentNames.includes(biomarker));
}
