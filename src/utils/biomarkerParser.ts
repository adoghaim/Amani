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
    canonical: 'ferritin',
    patterns: ['ferritin', 'serum ferritin'],
    commonUnits: ['ng/mL', 'μg/L', 'ng/ml', 'ug/l', 'ng/dL'],
  },
  {
    canonical: 'vitamin_d',
    patterns: ['vitamin d', '25-hydroxy vitamin d', '25-oh vitamin d', 'vit d', '25(oh)d', '25 hydroxy', 'cholecalciferol'],
    commonUnits: ['ng/mL', 'nmol/L', 'ng/ml', 'ng/dl'],
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
      (n) => Math.abs(n - referenceMin) > 0.01 && Math.abs(n - referenceMax) > 0.01
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
