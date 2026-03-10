import type { BiomarkerName, BiomarkerInput } from '../types';

export interface ExtractedBiomarker extends BiomarkerInput {
  confidence: 'high' | 'medium' | 'low';
  rawText?: string;
}

interface BiomarkerPattern {
  canonical: BiomarkerName;
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
    canonical: 'testosterone_total',
    patterns: ['testosterone, total', 'total testosterone', 'testosterone total', 'testosterone serum'],
    commonUnits: ['ng/dL', 'nmol/L', 'ng/dl'],
  },
  {
    canonical: 'testosterone_free',
    patterns: ['free testosterone', 'testosterone, free', 'testosterone free'],
    commonUnits: ['pg/mL', 'pmol/L', 'pg/ml', 'ng/dL'],
  },
  {
    canonical: 'dhea_s',
    patterns: ['dhea-s', 'dhea sulfate', 'dehydroepiandrosterone sulfate', 'dheas', 'dhea-sulfate'],
    commonUnits: ['mcg/dL', 'ug/dL', 'mcg/dl', 'umol/L'],
  },
  {
    canonical: 'cortisol',
    patterns: ['cortisol', 'cortisol am', 'am cortisol', 'morning cortisol'],
    commonUnits: ['mcg/dL', 'ug/dL', 'nmol/L', 'mcg/dl'],
  },
  {
    canonical: 'prolactin',
    patterns: ['prolactin', 'prl'],
    commonUnits: ['ng/mL', 'mIU/L', 'ng/ml'],
  },
  {
    canonical: 'insulin',
    patterns: ['insulin', 'fasting insulin', 'insulin fasting'],
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
    patterns: ['free t4', 'free thyroxine', 't4 free', 'ft4', 'free t 4', 't4, free'],
    commonUnits: ['ng/dL', 'pmol/L', 'ng/dl', 'ug/dl', 'μg/dL'],
  },
  {
    canonical: 'free_t3',
    patterns: ['free t3', 'free triiodothyronine', 't3 free', 'ft3', 'free t 3', 't3, free'],
    commonUnits: ['pg/mL', 'pmol/L', 'pg/ml'],
  },
  {
    canonical: 'reverse_t3',
    patterns: ['reverse t3', 'rt3', 'reverse triiodothyronine', 'reverse-t3'],
    commonUnits: ['ng/dL', 'pmol/L', 'ng/dl'],
  },
  {
    canonical: 'tpo_antibodies',
    patterns: ['tpo antibodies', 'thyroid peroxidase antibodies', 'anti-tpo', 'tpo ab', 'antithyroid peroxidase'],
    commonUnits: ['IU/mL', 'U/mL', 'kIU/L'],
  },
  {
    canonical: 'tgab',
    patterns: ['thyroglobulin antibodies', 'tgab', 'anti-tg', 'thyroglobulin ab', 'tg antibodies'],
    commonUnits: ['IU/mL', 'U/mL'],
  },
  {
    canonical: 'glucose_fasting',
    patterns: ['glucose', 'fasting glucose', 'blood glucose', 'blood sugar', 'glucose fasting'],
    commonUnits: ['mg/dL', 'mmol/L', 'mg/dl'],
  },
  {
    canonical: 'hba1c',
    patterns: ['hba1c', 'hemoglobin a1c', 'glycated hemoglobin', 'a1c', 'hgba1c', 'haemoglobin a1c'],
    commonUnits: ['%', 'mmol/mol'],
  },
  {
    canonical: 'total_cholesterol',
    patterns: ['total cholesterol', 'cholesterol, total', 'cholesterol total'],
    commonUnits: ['mg/dL', 'mmol/L', 'mg/dl'],
  },
  {
    canonical: 'ldl',
    patterns: ['ldl', 'ldl cholesterol', 'ldl-c', 'low density lipoprotein', 'low-density lipoprotein'],
    commonUnits: ['mg/dL', 'mmol/L', 'mg/dl'],
  },
  {
    canonical: 'hdl',
    patterns: ['hdl', 'hdl cholesterol', 'hdl-c', 'high density lipoprotein', 'high-density lipoprotein'],
    commonUnits: ['mg/dL', 'mmol/L', 'mg/dl'],
  },
  {
    canonical: 'triglycerides',
    patterns: ['triglycerides', 'triglyceride', 'trig', 'triacylglycerol'],
    commonUnits: ['mg/dL', 'mmol/L', 'mg/dl'],
  },
  {
    canonical: 'apob',
    patterns: ['apob', 'apolipoprotein b', 'apo b', 'apolipoprotein-b'],
    commonUnits: ['mg/dL', 'g/L', 'mg/dl'],
  },
  {
    canonical: 'lpA',
    patterns: ['lp(a)', 'lipoprotein a', 'lipoprotein(a)', 'lp-a'],
    commonUnits: ['nmol/L', 'mg/dL', 'nmol/l'],
  },
  {
    canonical: 'alt',
    patterns: ['alt', 'alanine aminotransferase', 'alanine transaminase', 'sgpt', 'alt/sgpt'],
    commonUnits: ['U/L', 'IU/L', 'u/l'],
  },
  {
    canonical: 'ast',
    patterns: ['ast', 'aspartate aminotransferase', 'aspartate transaminase', 'sgot', 'ast/sgot'],
    commonUnits: ['U/L', 'IU/L', 'u/l'],
  },
  {
    canonical: 'ggt',
    patterns: ['ggt', 'gamma-glutamyl transferase', 'gamma glutamyl', 'ggtp', 'gamma-gt'],
    commonUnits: ['U/L', 'IU/L', 'u/l'],
  },
  {
    canonical: 'total_bilirubin',
    patterns: ['total bilirubin', 'bilirubin total', 'bilirubin, total', 'tbili'],
    commonUnits: ['mg/dL', 'umol/L', 'mg/dl'],
  },
  {
    canonical: 'albumin',
    patterns: ['albumin', 'serum albumin'],
    commonUnits: ['g/dL', 'g/L', 'g/dl'],
  },
  {
    canonical: 'creatinine',
    patterns: ['creatinine', 'serum creatinine', 'creat'],
    commonUnits: ['mg/dL', 'umol/L', 'mg/dl'],
  },
  {
    canonical: 'egfr',
    patterns: ['egfr', 'estimated gfr', 'glomerular filtration rate', 'egfr-ckd-epi'],
    commonUnits: ['mL/min', 'mL/min/1.73m2', 'ml/min'],
  },
  {
    canonical: 'bun',
    patterns: ['bun', 'blood urea nitrogen', 'urea nitrogen', 'urea'],
    commonUnits: ['mg/dL', 'mmol/L', 'mg/dl'],
  },
  {
    canonical: 'uric_acid',
    patterns: ['uric acid', 'urate', 'serum uric acid'],
    commonUnits: ['mg/dL', 'umol/L', 'mg/dl'],
  },
  {
    canonical: 'ferritin',
    patterns: ['ferritin', 'serum ferritin'],
    commonUnits: ['ng/mL', 'μg/L', 'ng/ml', 'ug/l', 'ng/dL'],
  },
  {
    canonical: 'vitamin_d',
    patterns: ['vitamin d', '25-hydroxy vitamin d', '25-oh vitamin d', 'vit d', '25(oh)d', '25 hydroxy', 'cholecalciferol'],
    commonUnits: ['ng/mL', 'nmol/L', 'ng/ml', 'ng/dl'],
  },
  {
    canonical: 'b12',
    patterns: ['vitamin b12', 'b12', 'cobalamin', 'cyanocobalamin', 'vit b12'],
    commonUnits: ['pg/mL', 'pmol/L', 'pg/ml'],
  },
  {
    canonical: 'folate',
    patterns: ['folate', 'folic acid', 'rbc folate', 'folate rbc', 'vitamin b9'],
    commonUnits: ['ng/mL', 'nmol/L', 'ng/ml'],
  },
  {
    canonical: 'magnesium',
    patterns: ['magnesium', 'rbc magnesium', 'magnesium rbc', 'serum magnesium', 'mg rbc'],
    commonUnits: ['mg/dL', 'mEq/L', 'mg/dl', 'mmol/L'],
  },
  {
    canonical: 'zinc',
    patterns: ['zinc', 'serum zinc', 'plasma zinc'],
    commonUnits: ['mcg/dL', 'umol/L', 'ug/dl'],
  },
  {
    canonical: 'iron',
    patterns: ['iron', 'serum iron', 'fe'],
    commonUnits: ['mcg/dL', 'umol/L', 'ug/dl'],
  },
  {
    canonical: 'hscrp',
    patterns: ['hs-crp', 'hscrp', 'high sensitivity crp', 'high-sensitivity c-reactive protein', 'hs crp', 'hsCRP'],
    commonUnits: ['mg/L', 'mg/dL', 'mg/l'],
  },
  {
    canonical: 'homocysteine',
    patterns: ['homocysteine', 'hcy', 'homocysteine plasma'],
    commonUnits: ['mcmol/L', 'umol/L', 'micromol/L'],
  },
];

export function parseBiomarkersFromText(text: string): ExtractedBiomarker[] {
  const extractedBiomarkers: ExtractedBiomarker[] = [];
  const textLower = text.toLowerCase();

  for (const pattern of BIOMARKER_PATTERNS) {
    for (const patternStr of pattern.patterns) {
      const patternLower = patternStr.toLowerCase();
      let searchIndex = 0;

      while (true) {
        const foundIndex = textLower.indexOf(patternLower, searchIndex);
        if (foundIndex === -1) break;

        const contextStart = Math.max(0, foundIndex - 50);
        const contextEnd = Math.min(text.length, foundIndex + 200);
        const contextText = text.substring(contextStart, contextEnd);

        const extracted = extractBiomarkerFromContext(
          contextText,
          pattern.canonical,
          pattern.commonUnits
        );

        if (extracted) {
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
  name: BiomarkerName,
  commonUnits: string[]
): ExtractedBiomarker | null {
  const numberPattern = /(\d+\.?\d*)/g;
  const numbers = [...contextText.matchAll(numberPattern)].map((m) => parseFloat(m[1]));

  if (numbers.length === 0) return null;

  let value: number | null = null;
  let unit: string | null = null;
  let referenceMin: number | undefined;
  let referenceMax: number | undefined;
  let confidence: 'high' | 'medium' | 'low' = 'low';

  const unitMatch = commonUnits.find((u) => {
    const unitLower = u.toLowerCase();
    const escapedUnit = unitLower.replace(/[/()]/g, '\\$&');
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
  for (const pattern of rangePatterns) {
    rangeMatches = [...contextText.matchAll(pattern)];
    if (rangeMatches.length > 0) break;
  }

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
  } else if (numbers.length >= 2) {
    const sortedNumbers = [...numbers].sort((a, b) => a - b);

    if (numbers.length === 3) {
      value = numbers[0];
      referenceMin = sortedNumbers[0] === value ? sortedNumbers[1] : sortedNumbers[0];
      referenceMax = sortedNumbers[2];
      if (referenceMin < referenceMax && referenceMin !== value && referenceMax !== value) {
        confidence = 'medium';
      }
    } else {
      value = numbers[0];
    }
  }

  if (value === null) {
    value = numbers[0];
  }

  if (value < 0 || value > 100000) {
    return null;
  }

  return {
    name,
    value,
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
    if (!b.value || b.value <= 0) return false;
    if (!b.unit) return false;
    if (b.reference_min !== undefined && b.reference_max !== undefined) {
      if (b.reference_min >= b.reference_max) return false;
    }
    return true;
  });
}
