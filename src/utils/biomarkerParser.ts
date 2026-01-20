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
    patterns: ['estradiol', 'e2', 'estrogen'],
    commonUnits: ['pg/mL', 'pmol/L', 'pg/ml'],
  },
  {
    canonical: 'progesterone',
    patterns: ['progesterone', 'prog'],
    commonUnits: ['ng/mL', 'nmol/L', 'ng/ml'],
  },
  {
    canonical: 'lh',
    patterns: ['lh', 'luteinizing hormone', 'luteinizing'],
    commonUnits: ['mIU/mL', 'IU/L', 'miu/ml'],
  },
  {
    canonical: 'fsh',
    patterns: ['fsh', 'follicle stimulating hormone', 'follicle-stimulating'],
    commonUnits: ['mIU/mL', 'IU/L', 'miu/ml'],
  },
  {
    canonical: 'amh',
    patterns: ['amh', 'anti-mullerian hormone', 'anti mullerian'],
    commonUnits: ['ng/mL', 'pmol/L', 'ng/ml'],
  },
  {
    canonical: 'tsh',
    patterns: ['tsh', 'thyroid stimulating hormone', 'thyroid-stimulating'],
    commonUnits: ['mIU/L', 'μIU/mL', 'uiu/ml', 'miu/l'],
  },
  {
    canonical: 'free_t4',
    patterns: ['free t4', 'free thyroxine', 't4 free', 'ft4'],
    commonUnits: ['ng/dL', 'pmol/L', 'ng/dl'],
  },
  {
    canonical: 'ferritin',
    patterns: ['ferritin'],
    commonUnits: ['ng/mL', 'μg/L', 'ng/ml', 'ug/l'],
  },
  {
    canonical: 'vitamin_d',
    patterns: ['vitamin d', '25-hydroxy vitamin d', '25-oh vitamin d', 'vit d', '25(oh)d'],
    commonUnits: ['ng/mL', 'nmol/L', 'ng/ml'],
  },
];

export function parseBiomarkersFromText(text: string): ExtractedBiomarker[] {
  const extractedBiomarkers: ExtractedBiomarker[] = [];
  const lines = text.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].toLowerCase().trim();
    if (!line) continue;

    for (const pattern of BIOMARKER_PATTERNS) {
      const matchedPattern = pattern.patterns.find((p) =>
        line.includes(p.toLowerCase())
      );

      if (matchedPattern) {
        const extracted = extractBiomarkerFromLine(
          line,
          lines[i],
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
      }
    }
  }

  return extractedBiomarkers;
}

function extractBiomarkerFromLine(
  lineLower: string,
  lineOriginal: string,
  name: BiomarkerName,
  commonUnits: string[]
): ExtractedBiomarker | null {
  const numberPattern = /\b(\d+\.?\d*)\b/g;
  const numbers = [...lineLower.matchAll(numberPattern)].map((m) => parseFloat(m[1]));

  if (numbers.length === 0) return null;

  let value: number | null = null;
  let unit: string | null = null;
  let referenceMin: number | undefined;
  let referenceMax: number | undefined;
  let confidence: 'high' | 'medium' | 'low' = 'low';

  const unitMatch = commonUnits.find((u) => lineLower.includes(u.toLowerCase()));
  if (unitMatch) {
    unit = unitMatch;
    confidence = 'medium';
  } else {
    unit = commonUnits[0];
  }

  const rangePattern = /(\d+\.?\d*)\s*-\s*(\d+\.?\d*)/g;
  const rangeMatches = [...lineLower.matchAll(rangePattern)];

  if (rangeMatches.length > 0) {
    const lastRange = rangeMatches[rangeMatches.length - 1];
    referenceMin = parseFloat(lastRange[1]);
    referenceMax = parseFloat(lastRange[2]);
    confidence = 'high';

    const numbersBeforeRange = numbers.filter(
      (n) => n !== referenceMin && n !== referenceMax
    );
    if (numbersBeforeRange.length > 0) {
      value = numbersBeforeRange[0];
    } else if (numbers.length > 2) {
      value = numbers[0];
    }
  } else {
    value = numbers[0];
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
    rawText: lineOriginal,
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
