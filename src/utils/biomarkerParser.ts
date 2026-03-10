export interface ExtractedBiomarker {
  name: string;
  value: number;
  rawValue?: string;
  unit: string | null;
  reference_min?: number;
  reference_max?: number;
  confidence: 'high' | 'medium' | 'low';
  rawText?: string;
}

interface BiomarkerPattern {
  canonical: string;
  patterns: string[];
  commonUnits: string[];
}

const BIOMARKER_PATTERNS: BiomarkerPattern[] = [
  {
    canonical: 'estradiol',
    patterns: ['estradiol', 'e2', 'estrogen', 'e 2', 'oestradiol'],
    commonUnits: ['pg/mL', 'pmol/L', 'pg/ml', 'pg/dl'],
  },
  {
    canonical: 'progesterone',
    patterns: ['progesterone', 'prog', 'progest'],
    commonUnits: ['ng/mL', 'nmol/L', 'ng/ml', 'ng/dl'],
  },
  {
    canonical: 'lh',
    patterns: ['lh', 'luteinizing hormone', 'luteinizing', 'lutropin'],
    commonUnits: ['mIU/mL', 'IU/L', 'miu/ml', 'iu/l', 'mIU/L'],
  },
  {
    canonical: 'fsh',
    patterns: ['fsh', 'follicle stimulating hormone', 'follicle-stimulating', 'follitropin'],
    commonUnits: ['mIU/mL', 'IU/L', 'miu/ml', 'iu/l', 'mIU/L'],
  },
  {
    canonical: 'amh',
    patterns: ['amh', 'anti-mullerian hormone', 'anti mullerian', 'antimullerian', 'anti-müllerian'],
    commonUnits: ['ng/mL', 'pmol/L', 'ng/ml', 'ng/dl'],
  },
  {
    canonical: 'total_testosterone',
    patterns: ['testosterone, total', 'total testosterone', 'testosterone total', 'testosterone serum', 'testosterone,total'],
    commonUnits: ['ng/dL', 'nmol/L', 'ng/dl'],
  },
  {
    canonical: 'free_testosterone',
    patterns: ['free testosterone', 'testosterone, free', 'testosterone free', 'testosterone,free'],
    commonUnits: ['pg/mL', 'pmol/L', 'pg/ml', 'ng/dL'],
  },
  {
    canonical: 'dheas',
    patterns: ['dhea-s', 'dhea sulfate', 'dehydroepiandrosterone sulfate', 'dheas', 'dhea-sulfate', 'dhea s'],
    commonUnits: ['mcg/dL', 'ug/dL', 'mcg/dl', 'umol/L'],
  },
  {
    canonical: 'prolactin',
    patterns: ['prolactin', 'prl'],
    commonUnits: ['ng/mL', 'mIU/L', 'ng/ml'],
  },
  {
    canonical: 'fasting_insulin',
    patterns: ['insulin', 'fasting insulin', 'insulin fasting', 'insulin, fasting'],
    commonUnits: ['mcIU/mL', 'uIU/mL', 'pmol/L', 'mIU/L'],
  },
  {
    canonical: 'shbg',
    patterns: ['shbg', 'sex hormone binding globulin', 'sex-hormone-binding globulin'],
    commonUnits: ['nmol/L', 'nM', 'nmol/l'],
  },
  {
    canonical: 'tsh',
    patterns: ['tsh', 'thyroid stimulating hormone', 'thyroid-stimulating', 'thyrotropin'],
    commonUnits: ['mIU/L', 'μIU/mL', 'uiu/ml', 'miu/l', 'uIU/ml', 'IU/L'],
  },
  {
    canonical: 'free_t4',
    patterns: ['free t4', 'free thyroxine', 't4 free', 'ft4', 'free t 4', 't4, free', 't4,free'],
    commonUnits: ['ng/dL', 'pmol/L', 'ng/dl', 'ug/dl', 'μg/dL'],
  },
  {
    canonical: 'free_t3',
    patterns: ['free t3', 'free triiodothyronine', 't3 free', 'ft3', 'free t 3', 't3, free', 't3,free'],
    commonUnits: ['pg/mL', 'pmol/L', 'pg/ml'],
  },
  {
    canonical: 'total_t4',
    patterns: ['total t4', 't4 total', 't4, total', 'thyroxine total', 'thyroxine, total'],
    commonUnits: ['mcg/dL', 'ug/dL', 'nmol/L'],
  },
  {
    canonical: 'reverse_t3',
    patterns: ['reverse t3', 'rt3', 'reverse triiodothyronine', 'reverse-t3'],
    commonUnits: ['ng/dL', 'pmol/L', 'ng/dl'],
  },
  {
    canonical: 'tpo_antibodies',
    patterns: ['tpo antibodies', 'thyroid peroxidase antibodies', 'anti-tpo', 'tpo ab', 'antithyroid peroxidase', 'thyroid peroxidase (tpo) ab', 'tpo ab igg'],
    commonUnits: ['IU/mL', 'U/mL', 'kIU/L'],
  },
  {
    canonical: 'tg_antibodies',
    patterns: ['thyroglobulin antibodies', 'tgab', 'anti-tg', 'thyroglobulin ab', 'tg antibodies', 'thyroglobulin antibody'],
    commonUnits: ['IU/mL', 'U/mL'],
  },
  {
    canonical: 'fasting_glucose',
    patterns: ['glucose, serum', 'glucose', 'fasting glucose', 'blood glucose', 'blood sugar', 'glucose fasting'],
    commonUnits: ['mg/dL', 'mmol/L', 'mg/dl'],
  },
  {
    canonical: 'hemoglobin_a1c',
    patterns: ['hba1c', 'hemoglobin a1c', 'glycated hemoglobin', 'a1c', 'hgba1c', 'haemoglobin a1c', 'hemoglobin a1c (hba1c)'],
    commonUnits: ['%', 'mmol/mol'],
  },
  {
    canonical: 'c_peptide',
    patterns: ['c-peptide', 'c peptide'],
    commonUnits: ['ng/mL', 'nmol/L'],
  },
  {
    canonical: 'total_cholesterol',
    patterns: ['total cholesterol', 'cholesterol, total', 'cholesterol total', 'cholesterol,total'],
    commonUnits: ['mg/dL', 'mmol/L', 'mg/dl'],
  },
  {
    canonical: 'ldl_cholesterol',
    patterns: ['ldl chol calc', 'ldl cholesterol', 'ldl-c', 'low density lipoprotein', 'low-density lipoprotein', 'ldl chol', 'ldl'],
    commonUnits: ['mg/dL', 'mmol/L', 'mg/dl'],
  },
  {
    canonical: 'hdl_cholesterol',
    patterns: ['hdl chol direct', 'hdl cholesterol', 'hdl-c', 'high density lipoprotein', 'high-density lipoprotein', 'hdl chol', 'hdl'],
    commonUnits: ['mg/dL', 'mmol/L', 'mg/dl'],
  },
  {
    canonical: 'triglycerides',
    patterns: ['triglycerides', 'triglyceride', 'trig', 'triacylglycerol'],
    commonUnits: ['mg/dL', 'mmol/L', 'mg/dl'],
  },
  {
    canonical: 'non_hdl_cholesterol',
    patterns: ['non-hdl cholesterol', 'non hdl cholesterol', 'non-hdl chol'],
    commonUnits: ['mg/dL', 'mmol/L', 'mg/dl'],
  },
  {
    canonical: 'apob',
    patterns: ['apob', 'apolipoprotein b', 'apo b', 'apolipoprotein-b'],
    commonUnits: ['mg/dL', 'g/L', 'mg/dl'],
  },
  {
    canonical: 'lpa',
    patterns: ['lp(a)', 'lipoprotein a', 'lipoprotein(a)', 'lp-a'],
    commonUnits: ['nmol/L', 'mg/dL', 'nmol/l'],
  },
  {
    canonical: 'alt',
    patterns: ['alt (sgpt)', 'alt/sgpt', 'alt', 'alanine aminotransferase', 'alanine transaminase', 'sgpt'],
    commonUnits: ['U/L', 'IU/L', 'u/l'],
  },
  {
    canonical: 'ast',
    patterns: ['ast (sgot)', 'ast/sgot', 'ast', 'aspartate aminotransferase', 'aspartate transaminase', 'sgot'],
    commonUnits: ['U/L', 'IU/L', 'u/l'],
  },
  {
    canonical: 'ggt',
    patterns: ['ggt', 'gamma-glutamyl transferase', 'gamma glutamyl', 'ggtp', 'gamma-gt', 'ggt (gamma glutamyl transpeptidase)'],
    commonUnits: ['U/L', 'IU/L', 'u/l'],
  },
  {
    canonical: 'alkaline_phosphatase',
    patterns: ['alkaline phosphatase', 'alk phos', 'alp'],
    commonUnits: ['U/L', 'IU/L', 'u/l'],
  },
  {
    canonical: 'bilirubin_total',
    patterns: ['total bilirubin', 'bilirubin total', 'bilirubin, total', 'tbili', 'bilirubin,total'],
    commonUnits: ['mg/dL', 'umol/L', 'mg/dl'],
  },
  {
    canonical: 'creatinine',
    patterns: ['creatinine, serum', 'creatinine', 'serum creatinine', 'creat'],
    commonUnits: ['mg/dL', 'umol/L', 'mg/dl'],
  },
  {
    canonical: 'egfr',
    patterns: ['egfr non-afr. american', 'egfr african american', 'egfr', 'estimated gfr', 'glomerular filtration rate', 'egfr-ckd-epi', 'gfr estimated non-african american'],
    commonUnits: ['mL/min/1.73m2', 'mL/min', 'ml/min'],
  },
  {
    canonical: 'bun',
    patterns: ['bun', 'blood urea nitrogen', 'urea nitrogen', 'urea', 'urea nitrogen (bun)'],
    commonUnits: ['mg/dL', 'mmol/L', 'mg/dl'],
  },
  {
    canonical: 'hs_crp',
    patterns: ['c-reactive protein, cardiac', 'hs-crp', 'hscrp', 'high sensitivity crp', 'high-sensitivity c-reactive protein', 'hs crp', 'hscrp', 'c-reactive protein (high sensitivity)', 'crp, high sensitivity'],
    commonUnits: ['mg/L', 'mg/dL', 'mg/l'],
  },
  {
    canonical: 'esr',
    patterns: ['esr', 'sed rate', 'erythrocyte sedimentation rate', 'sedimentation rate'],
    commonUnits: ['mm/h', 'mm/hr'],
  },
  {
    canonical: 'ferritin',
    patterns: ['ferritin, serum', 'ferritin', 'serum ferritin'],
    commonUnits: ['ng/mL', 'μg/L', 'ng/ml', 'ug/l', 'ng/dL'],
  },
  {
    canonical: 'iron_saturation',
    patterns: ['iron saturation', 'iron, % saturation', 'transferrin saturation', 'iron sat'],
    commonUnits: ['%'],
  },
  {
    canonical: 'vitamin_d_25_oh',
    patterns: ['vitamin d, 25-hydroxy', 'vitamin d, 25-oh', '25-hydroxy vitamin d', '25-oh vitamin d', 'vit d', '25(oh)d', '25 hydroxy', 'cholecalciferol', 'vitamin d (25-oh)', '25-hydroxyvitamin d'],
    commonUnits: ['ng/mL', 'nmol/L', 'ng/ml', 'ng/dl'],
  },
  {
    canonical: 'vitamin_b12',
    patterns: ['vitamin b12', 'b12', 'cobalamin', 'cyanocobalamin', 'vit b12', 'vitamin b12, serum'],
    commonUnits: ['pg/mL', 'pmol/L', 'pg/ml'],
  },
  {
    canonical: 'folate',
    patterns: ['folate', 'folic acid', 'rbc folate', 'folate rbc', 'vitamin b9', 'folate, serum'],
    commonUnits: ['ng/mL', 'nmol/L', 'ng/ml'],
  },
  {
    canonical: 'magnesium',
    patterns: ['magnesium', 'rbc magnesium', 'magnesium rbc', 'serum magnesium', 'mg rbc', 'magnesium, serum'],
    commonUnits: ['mg/dL', 'mEq/L', 'mg/dl', 'mmol/L'],
  },
];

const CATALOG_SLUG_ALIASES: Record<string, string> = {
  testosterone_total: 'total_testosterone',
  testosterone_free: 'free_testosterone',
  dhea_s: 'dheas',
  insulin: 'fasting_insulin',
  ldl: 'ldl_cholesterol',
  hdl: 'hdl_cholesterol',
  non_hdl: 'non_hdl_cholesterol',
  lpa: 'lpa',
  lpA: 'lpa',
  glucose_fasting: 'fasting_glucose',
  hba1c: 'hemoglobin_a1c',
  hscrp: 'hs_crp',
  vitamin_d: 'vitamin_d_25_oh',
  b12: 'vitamin_b12',
  tgab: 'tg_antibodies',
  total_bilirubin: 'bilirubin_total',
};

function normalizeToCatalogSlug(slug: string): string {
  return CATALOG_SLUG_ALIASES[slug] ?? slug;
}

function parseValueWithPrefix(text: string): { value: number; rawValue: string } | null {
  const ltMatch = text.match(/<\s*(\d+\.?\d*)/);
  if (ltMatch) {
    return { value: parseFloat(ltMatch[1]) * 0.5, rawValue: `<${ltMatch[1]}` };
  }
  const gtMatch = text.match(/>\s*(\d+\.?\d*)/);
  if (gtMatch) {
    return { value: parseFloat(gtMatch[1]), rawValue: `>${gtMatch[1]}` };
  }
  const numMatch = text.match(/(\d+\.?\d*)/);
  if (numMatch) {
    return { value: parseFloat(numMatch[1]), rawValue: numMatch[1] };
  }
  return null;
}

export function parseBiomarkersFromText(text: string): ExtractedBiomarker[] {
  const extractedBiomarkers: ExtractedBiomarker[] = [];
  const textLower = text.toLowerCase();

  for (const pattern of BIOMARKER_PATTERNS) {
    const sortedPatterns = [...pattern.patterns].sort((a, b) => b.length - a.length);

    for (const patternStr of sortedPatterns) {
      const patternLower = patternStr.toLowerCase();
      let searchIndex = 0;

      while (true) {
        const foundIndex = textLower.indexOf(patternLower, searchIndex);
        if (foundIndex === -1) break;

        const contextStart = Math.max(0, foundIndex - 20);
        const contextEnd = Math.min(text.length, foundIndex + 300);
        const contextText = text.substring(contextStart, contextEnd);

        const extracted = extractBiomarkerFromContext(
          contextText,
          pattern.canonical,
          pattern.commonUnits
        );

        if (extracted) {
          const catalogSlug = normalizeToCatalogSlug(extracted.name);
          extracted.name = catalogSlug;

          const existingIndex = extractedBiomarkers.findIndex(
            (b) => b.name === extracted.name
          );

          if (existingIndex >= 0) {
            if (extracted.confidence === 'high' && extractedBiomarkers[existingIndex].confidence !== 'high') {
              extractedBiomarkers[existingIndex] = extracted;
            }
          } else {
            extractedBiomarkers.push(extracted);
          }
        }

        searchIndex = foundIndex + patternLower.length;
      }
    }
  }

  return extractedBiomarkers;
}

function extractBiomarkerFromContext(
  contextText: string,
  name: string,
  commonUnits: string[]
): ExtractedBiomarker | null {
  let value: number | null = null;
  let rawValue: string | undefined;
  let unit: string | null = null;
  let referenceMin: number | undefined;
  let referenceMax: number | undefined;
  let confidence: 'high' | 'medium' | 'low' = 'low';

  const unitMatch = commonUnits.find((u) => {
    const escapedUnit = u.toLowerCase().replace(/[/()[\].+*?^${}|\\]/g, '\\$&');
    const unitRegex = new RegExp(escapedUnit, 'i');
    return unitRegex.test(contextText);
  });

  if (unitMatch) {
    unit = unitMatch;
    confidence = 'medium';
  } else {
    unit = commonUnits[0];
  }

  const rangePatterns = [
    /(\d+\.?\d*)\s*[-–—]\s*(\d+\.?\d*)/g,
    /(\d+\.?\d*)\s+to\s+(\d+\.?\d*)/gi,
    /range[:\s]+(\d+\.?\d*)\s*[-–—]\s*(\d+\.?\d*)/gi,
    /ref[:\s]+(\d+\.?\d*)\s*[-–—]\s*(\d+\.?\d*)/gi,
  ];

  let rangeMatches: RegExpMatchArray[] = [];
  for (const rp of rangePatterns) {
    rangeMatches = [...contextText.matchAll(rp)];
    if (rangeMatches.length > 0) break;
  }

  const ltGtPattern = /<\s*(\d+\.?\d*)|>\s*(\d+\.?\d*)/;
  const ltGtMatch = contextText.match(ltGtPattern);

  if (ltGtMatch) {
    const parsed = parseValueWithPrefix(ltGtMatch[0]);
    if (parsed) {
      value = parsed.value;
      rawValue = parsed.rawValue;
      confidence = rangeMatches.length > 0 ? 'high' : 'medium';
    }
    if (rangeMatches.length > 0) {
      const lastRange = rangeMatches[rangeMatches.length - 1];
      referenceMin = parseFloat(lastRange[1]);
      referenceMax = parseFloat(lastRange[2]);
    }
  } else {
    const numberPattern = /(\d+\.?\d*)/g;
    const numbers = [...contextText.matchAll(numberPattern)].map((m) => parseFloat(m[1]));

    if (numbers.length === 0) return null;

    if (rangeMatches.length > 0) {
      const lastRange = rangeMatches[rangeMatches.length - 1];
      referenceMin = parseFloat(lastRange[1]);
      referenceMax = parseFloat(lastRange[2]);
      confidence = 'high';

      const numbersBeforeRange = numbers.filter(
        (n) => Math.abs(n - referenceMin!) > 0.01 && Math.abs(n - referenceMax!) > 0.01
      );

      if (numbersBeforeRange.length > 0) {
        value = numbersBeforeRange[0];
      } else if (numbers.length > 2) {
        value = numbers[0];
      }
    } else if (numbers.length === 1) {
      value = numbers[0];
    } else if (numbers.length === 3) {
      value = numbers[0];
      const sorted = [...numbers].sort((a, b) => a - b);
      referenceMin = sorted[0] === value ? sorted[1] : sorted[0];
      referenceMax = sorted[2];
      if (referenceMin < referenceMax && referenceMin !== value && referenceMax !== value) {
        confidence = 'medium';
      }
    } else {
      value = numbers[0];
    }
  }

  if (value === null) return null;
  if (value < 0 || value > 100000) return null;

  return {
    name,
    value,
    rawValue,
    unit,
    reference_min: referenceMin,
    reference_max: referenceMax,
    confidence,
    rawText: contextText.substring(0, 100),
  };
}

export function validateExtractedBiomarkers(
  biomarkers: ExtractedBiomarker[]
): ExtractedBiomarker[] {
  return biomarkers.filter((b) => {
    if (b.value === undefined || b.value === null) return false;
    if (b.value < 0) return false;
    if (!b.unit) return false;
    if (b.reference_min !== undefined && b.reference_max !== undefined) {
      if (b.reference_min >= b.reference_max) return false;
    }
    return true;
  });
}

export function getCatalogSlug(legacyName: string): string {
  return normalizeToCatalogSlug(legacyName);
}
