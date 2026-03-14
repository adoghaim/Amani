import type {
  BiomarkerName,
  BiomarkerCategory,
  AmaniStatus,
  LabStatus,
  CyclePhase,
  Biomarker,
  LabResult,
} from '../types';

export const BIOMARKER_CATEGORY_MAP: Record<BiomarkerName, BiomarkerCategory> = {
  estradiol: 'hormones', progesterone: 'hormones', fsh: 'hormones', lh: 'hormones',
  total_testosterone: 'hormones', free_testosterone: 'hormones', shbg: 'hormones',
  dheas: 'hormones', prolactin: 'hormones', amh: 'hormones',
  tsh: 'thyroid', free_t3: 'thyroid', free_t4: 'thyroid', total_t4: 'thyroid',
  reverse_t3: 'thyroid', tpo_antibodies: 'thyroid', tg_antibodies: 'thyroid',
  fasting_glucose: 'metabolic', hemoglobin_a1c: 'metabolic', fasting_insulin: 'metabolic', c_peptide: 'metabolic',
  total_cholesterol: 'lipids', hdl_cholesterol: 'lipids', ldl_cholesterol: 'lipids', triglycerides: 'lipids',
  non_hdl_cholesterol: 'lipids', apob: 'lipids', lpa: 'lipids',
  ast: 'liver', alt: 'liver', ggt: 'liver', alkaline_phosphatase: 'liver', bilirubin_total: 'liver',
  creatinine: 'kidney', bun: 'kidney', egfr: 'kidney',
  hs_crp: 'inflammation', esr: 'inflammation',
  ferritin: 'nutrients', iron_saturation: 'nutrients', vitamin_d_25_oh: 'nutrients',
  vitamin_b12: 'nutrients', folate: 'nutrients', magnesium: 'nutrients',
  free_thyroxine_index: 'thyroid', t3_uptake: 'thyroid', total_t3: 'thyroid',
  chol_hdl_ratio: 'lipids',
  globulin: 'liver', albumin: 'liver', total_protein: 'liver', albumin_globulin_ratio: 'liver',
  bun_creatinine_ratio: 'kidney', serum_iron: 'nutrients', tibc: 'nutrients', uibc: 'nutrients',
  wbc: 'blood', rbc: 'blood', hemoglobin: 'blood', hematocrit: 'blood', mcv: 'blood', mch: 'blood',
  mchc: 'blood', rdw: 'blood', platelets: 'blood', mpv: 'blood',
  neutrophils: 'blood', lymphocytes: 'blood', monocytes: 'blood', eosinophils: 'blood', basophils: 'blood',
  sodium: 'metabolic', potassium: 'metabolic', chloride: 'metabolic', co2: 'metabolic', calcium: 'metabolic',
};

interface OptimalRange {
  min: number | null;
  max: number | null;
}

interface ClinicalRange {
  min: number | null;
  max: number | null;
}

interface BiomarkerRanges {
  optimal: OptimalRange;
  clinical: ClinicalRange;
  phaseRanges?: Partial<Record<CyclePhase | 'general', { optimal: OptimalRange; clinical: ClinicalRange }>>;
  scoreWeight: number;
  higherIsBetter?: boolean;
}

export const BIOMARKER_RANGES: Record<BiomarkerName, BiomarkerRanges> = {
  estradiol: {
    optimal: { min: 30, max: 350 }, clinical: { min: 10, max: 400 }, scoreWeight: 1.5,
    phaseRanges: {
      menstrual:  { optimal: { min: 20, max: 80 },   clinical: { min: 10, max: 200 } },
      follicular: { optimal: { min: 30, max: 250 },  clinical: { min: 20, max: 400 } },
      ovulatory:  { optimal: { min: 150, max: 750 }, clinical: { min: 100, max: 1000 } },
      luteal:     { optimal: { min: 50, max: 300 },  clinical: { min: 30, max: 500 } },
    },
  },
  progesterone: {
    optimal: { min: 0.1, max: 25 }, clinical: { min: 0.1, max: 30 }, scoreWeight: 1.5,
    phaseRanges: {
      menstrual:  { optimal: { min: 0.1, max: 0.9 }, clinical: { min: 0.1, max: 1.5 } },
      follicular: { optimal: { min: 0.1, max: 0.9 }, clinical: { min: 0.1, max: 1.5 } },
      ovulatory:  { optimal: { min: 1.0, max: 3.0 }, clinical: { min: 0.5, max: 5.0 } },
      luteal:     { optimal: { min: 5.0, max: 25 },  clinical: { min: 3.0, max: 30 } },
    },
  },
  fsh: {
    optimal: { min: 3, max: 10 }, clinical: { min: 2, max: 25 }, scoreWeight: 1.5,
    phaseRanges: {
      menstrual:  { optimal: { min: 3, max: 10 }, clinical: { min: 3, max: 20 } },
      follicular: { optimal: { min: 2, max: 10 }, clinical: { min: 2, max: 20 } },
      ovulatory:  { optimal: { min: 2, max: 15 }, clinical: { min: 2, max: 30 } },
      luteal:     { optimal: { min: 1, max: 8 },  clinical: { min: 1, max: 10 } },
    },
  },
  lh: {
    optimal: { min: 2, max: 15 }, clinical: { min: 1, max: 100 }, scoreWeight: 1.2,
    phaseRanges: {
      menstrual:  { optimal: { min: 2, max: 15 },  clinical: { min: 1, max: 25 } },
      follicular: { optimal: { min: 2, max: 15 },  clinical: { min: 1, max: 25 } },
      ovulatory:  { optimal: { min: 20, max: 80 }, clinical: { min: 15, max: 100 } },
      luteal:     { optimal: { min: 2, max: 12 },  clinical: { min: 1, max: 20 } },
    },
  },
  total_testosterone: { optimal: { min: 15, max: 70 },  clinical: { min: 10, max: 100 }, scoreWeight: 1.2 },
  free_testosterone:  { optimal: { min: 1.0, max: 8.5 }, clinical: { min: 0.5, max: 10 }, scoreWeight: 1.3 },
  shbg:               { optimal: { min: 40, max: 120 }, clinical: { min: 18, max: 200 }, scoreWeight: 1.0 },
  dheas:              { optimal: { min: 65, max: 380 }, clinical: { min: 35, max: 430 }, scoreWeight: 1.0 },
  prolactin:          { optimal: { min: 3, max: 20 },   clinical: { min: 2, max: 29 },  scoreWeight: 1.3 },
  amh:                { optimal: { min: 1.0, max: 3.5 }, clinical: { min: 0.1, max: 6.0 }, scoreWeight: 1.5 },
  tsh:                { optimal: { min: 1.0, max: 2.5 }, clinical: { min: 0.4, max: 4.0 }, scoreWeight: 2.0 },
  free_t3:            { optimal: { min: 3.0, max: 4.0 }, clinical: { min: 2.3, max: 4.2 }, scoreWeight: 1.8 },
  free_t4:            { optimal: { min: 0.9, max: 1.7 }, clinical: { min: 0.8, max: 1.8 }, scoreWeight: 1.5 },
  total_t4:           { optimal: { min: 5.5, max: 11.0 }, clinical: { min: 4.5, max: 12.0 }, scoreWeight: 1.0 },
  reverse_t3:         { optimal: { min: 10, max: 24 },  clinical: { min: 8, max: 25 }, scoreWeight: 1.0 },
  tpo_antibodies:     { optimal: { min: 0, max: 34 },   clinical: { min: 0, max: 35 }, scoreWeight: 1.8 },
  tg_antibodies:      { optimal: { min: 0, max: 0.9 },  clinical: { min: 0, max: 1.0 }, scoreWeight: 1.5 },
  fasting_glucose:    { optimal: { min: 72, max: 90 },  clinical: { min: 70, max: 99 }, scoreWeight: 1.8 },
  hemoglobin_a1c:     { optimal: { min: 4.6, max: 5.4 }, clinical: { min: 4.0, max: 5.6 }, scoreWeight: 2.0 },
  fasting_insulin:    { optimal: { min: 2, max: 10 },   clinical: { min: 1, max: 25 }, scoreWeight: 1.8 },
  c_peptide:          { optimal: { min: 0.8, max: 3.1 }, clinical: { min: 0.5, max: 4.0 }, scoreWeight: 1.0 },
  total_cholesterol:  { optimal: { min: 160, max: 200 }, clinical: { min: 100, max: 239 }, scoreWeight: 1.2 },
  hdl_cholesterol:    { optimal: { min: 60, max: 90 },  clinical: { min: 50, max: 100 }, scoreWeight: 1.5, higherIsBetter: true },
  ldl_cholesterol:    { optimal: { min: 60, max: 100 }, clinical: { min: 0, max: 129 }, scoreWeight: 1.5 },
  triglycerides:      { optimal: { min: 60, max: 100 }, clinical: { min: 0, max: 149 }, scoreWeight: 1.5 },
  non_hdl_cholesterol:{ optimal: { min: 80, max: 130 }, clinical: { min: 0, max: 159 }, scoreWeight: 1.2 },
  apob:               { optimal: { min: 55, max: 90 },  clinical: { min: 40, max: 120 }, scoreWeight: 1.8 },
  lpa:                { optimal: { min: 0, max: 75 },   clinical: { min: 0, max: 125 }, scoreWeight: 1.3 },
  ast:                { optimal: { min: 10, max: 25 },  clinical: { min: 10, max: 40 }, scoreWeight: 1.3 },
  alt:                { optimal: { min: 7, max: 25 },   clinical: { min: 7, max: 45 }, scoreWeight: 1.5 },
  ggt:                { optimal: { min: 8, max: 20 },   clinical: { min: 8, max: 45 }, scoreWeight: 1.2 },
  alkaline_phosphatase: { optimal: { min: 40, max: 100 }, clinical: { min: 35, max: 130 }, scoreWeight: 1.0 },
  bilirubin_total:    { optimal: { min: 0.3, max: 1.0 }, clinical: { min: 0.2, max: 1.2 }, scoreWeight: 1.0 },
  creatinine:         { optimal: { min: 0.5, max: 0.9 }, clinical: { min: 0.5, max: 1.1 }, scoreWeight: 1.5 },
  bun:                { optimal: { min: 7, max: 18 },   clinical: { min: 6, max: 20 }, scoreWeight: 1.2 },
  egfr:               { optimal: { min: 90, max: 200 }, clinical: { min: 60, max: 200 }, scoreWeight: 1.8, higherIsBetter: true },
  hs_crp:             { optimal: { min: 0, max: 1.0 },  clinical: { min: 0, max: 3.0 }, scoreWeight: 1.8 },
  esr:                { optimal: { min: 0, max: 15 },   clinical: { min: 0, max: 20 }, scoreWeight: 1.2 },
  ferritin:           { optimal: { min: 30, max: 150 }, clinical: { min: 13, max: 150 }, scoreWeight: 1.8 },
  iron_saturation:    { optimal: { min: 25, max: 40 },  clinical: { min: 15, max: 50 }, scoreWeight: 1.3 },
  vitamin_d_25_oh:    { optimal: { min: 50, max: 80 },  clinical: { min: 30, max: 100 }, scoreWeight: 1.8 },
  vitamin_b12:        { optimal: { min: 400, max: 900 }, clinical: { min: 200, max: 900 }, scoreWeight: 1.5 },
  folate:             { optimal: { min: 10, max: 20 },  clinical: { min: 5, max: 20 }, scoreWeight: 1.3 },
  magnesium:          { optimal: { min: 5.2, max: 6.5 }, clinical: { min: 4.2, max: 6.8 }, scoreWeight: 1.3 },
  free_thyroxine_index: { optimal: { min: 1.2, max: 4.9 }, clinical: { min: 1.0, max: 4.9 }, scoreWeight: 1.0 },
  t3_uptake:          { optimal: { min: 24, max: 39 },   clinical: { min: 22, max: 43 }, scoreWeight: 1.0 },
  total_t3:           { optimal: { min: 80, max: 200 },  clinical: { min: 71, max: 220 }, scoreWeight: 1.0 },
  chol_hdl_ratio:     { optimal: { min: 0, max: 3.5 },   clinical: { min: 0, max: 5.0 }, scoreWeight: 1.3 },
  albumin:            { optimal: { min: 4.0, max: 5.0 }, clinical: { min: 3.5, max: 5.5 }, scoreWeight: 1.0 },
  globulin:           { optimal: { min: 2.0, max: 3.5 }, clinical: { min: 1.5, max: 4.0 }, scoreWeight: 1.0 },
  total_protein:      { optimal: { min: 6.5, max: 8.0 }, clinical: { min: 6.0, max: 8.5 }, scoreWeight: 1.0 },
  albumin_globulin_ratio: { optimal: { min: 1.3, max: 2.5 }, clinical: { min: 1.0, max: 3.0 }, scoreWeight: 1.0 },
  bun_creatinine_ratio: { optimal: { min: 10, max: 20 }, clinical: { min: 6, max: 25 }, scoreWeight: 1.0 },
  serum_iron:         { optimal: { min: 60, max: 150 },  clinical: { min: 50, max: 175 }, scoreWeight: 1.2 },
  tibc:               { optimal: { min: 250, max: 370 }, clinical: { min: 250, max: 400 }, scoreWeight: 1.0 },
  uibc:               { optimal: { min: 150, max: 310 }, clinical: { min: 111, max: 343 }, scoreWeight: 1.0 },
  wbc:                { optimal: { min: 4.5, max: 10.5 }, clinical: { min: 3.5, max: 11.0 }, scoreWeight: 1.2 },
  rbc:                { optimal: { min: 3.8, max: 5.2 }, clinical: { min: 3.5, max: 5.5 }, scoreWeight: 1.0 },
  hemoglobin:         { optimal: { min: 12.0, max: 16.0 }, clinical: { min: 11.5, max: 17.0 }, scoreWeight: 1.3 },
  hematocrit:         { optimal: { min: 36, max: 48 },   clinical: { min: 34, max: 52 }, scoreWeight: 1.0 },
  mcv:                { optimal: { min: 80, max: 95 },   clinical: { min: 75, max: 100 }, scoreWeight: 1.0 },
  mch:                { optimal: { min: 27, max: 32 },   clinical: { min: 25, max: 35 }, scoreWeight: 1.0 },
  mchc:               { optimal: { min: 32, max: 36 },   clinical: { min: 31, max: 37 }, scoreWeight: 1.0 },
  rdw:                { optimal: { min: 11.5, max: 14.5 }, clinical: { min: 11.0, max: 15.0 }, scoreWeight: 1.0 },
  platelets:          { optimal: { min: 150, max: 400 }, clinical: { min: 130, max: 450 }, scoreWeight: 1.2 },
  mpv:                { optimal: { min: 7.5, max: 12.5 }, clinical: { min: 7.0, max: 13.0 }, scoreWeight: 1.0 },
  neutrophils:        { optimal: { min: 45, max: 70 },   clinical: { min: 40, max: 80 }, scoreWeight: 1.0 },
  lymphocytes:        { optimal: { min: 20, max: 40 },   clinical: { min: 15, max: 45 }, scoreWeight: 1.0 },
  monocytes:          { optimal: { min: 2, max: 10 },    clinical: { min: 1, max: 12 }, scoreWeight: 1.0 },
  eosinophils:        { optimal: { min: 0, max: 5 },     clinical: { min: 0, max: 7 }, scoreWeight: 1.0 },
  basophils:          { optimal: { min: 0, max: 2 },     clinical: { min: 0, max: 3 }, scoreWeight: 1.0 },
  sodium:             { optimal: { min: 136, max: 145 }, clinical: { min: 134, max: 146 }, scoreWeight: 1.5 },
  potassium:          { optimal: { min: 3.8, max: 4.8 }, clinical: { min: 3.5, max: 5.0 }, scoreWeight: 1.5 },
  chloride:           { optimal: { min: 98, max: 107 },  clinical: { min: 96, max: 109 }, scoreWeight: 1.0 },
  co2:                { optimal: { min: 22, max: 29 },   clinical: { min: 20, max: 32 }, scoreWeight: 1.0 },
  calcium:            { optimal: { min: 9.0, max: 10.0 }, clinical: { min: 8.5, max: 10.5 }, scoreWeight: 1.2 },
};

export const BIOMARKER_DISPLAY: Record<BiomarkerName, string> = {
  estradiol: 'Estradiol (E2)', progesterone: 'Progesterone', fsh: 'FSH', lh: 'LH',
  total_testosterone: 'Total Testosterone', free_testosterone: 'Free Testosterone',
  shbg: 'SHBG', dheas: 'DHEA-S', prolactin: 'Prolactin', amh: 'AMH',
  tsh: 'TSH', free_t3: 'Free T3', free_t4: 'Free T4', total_t4: 'Total T4',
  reverse_t3: 'Reverse T3', tpo_antibodies: 'TPO Antibodies', tg_antibodies: 'TgAb',
  free_thyroxine_index: 'Free T4 Index (T7)', t3_uptake: 'T3 Uptake', total_t3: 'Total T3',
  fasting_glucose: 'Fasting Glucose', hemoglobin_a1c: 'HbA1c', fasting_insulin: 'Fasting Insulin', c_peptide: 'C-Peptide',
  total_cholesterol: 'Total Cholesterol', hdl_cholesterol: 'HDL', ldl_cholesterol: 'LDL', triglycerides: 'Triglycerides',
  non_hdl_cholesterol: 'Non-HDL Cholesterol', apob: 'ApoB', lpa: 'Lp(a)', chol_hdl_ratio: 'Chol/HDL Ratio',
  ast: 'AST', alt: 'ALT', ggt: 'GGT', alkaline_phosphatase: 'Alkaline Phosphatase', bilirubin_total: 'Bilirubin',
  albumin: 'Albumin', globulin: 'Globulin', total_protein: 'Total Protein', albumin_globulin_ratio: 'A/G Ratio',
  creatinine: 'Creatinine', bun: 'BUN', egfr: 'eGFR', bun_creatinine_ratio: 'BUN/Creatinine Ratio',
  hs_crp: 'hs-CRP', esr: 'ESR',
  ferritin: 'Ferritin', iron_saturation: 'Iron Saturation', vitamin_d_25_oh: 'Vitamin D',
  vitamin_b12: 'Vitamin B12', folate: 'Folate', magnesium: 'Magnesium',
  serum_iron: 'Serum Iron', tibc: 'TIBC', uibc: 'UIBC',
  wbc: 'WBC', rbc: 'RBC', hemoglobin: 'Hemoglobin', hematocrit: 'Hematocrit',
  mcv: 'MCV', mch: 'MCH', mchc: 'MCHC', rdw: 'RDW', platelets: 'Platelets', mpv: 'MPV',
  neutrophils: 'Neutrophils', lymphocytes: 'Lymphocytes', monocytes: 'Monocytes',
  eosinophils: 'Eosinophils', basophils: 'Basophils',
  sodium: 'Sodium', potassium: 'Potassium', chloride: 'Chloride', co2: 'CO2', calcium: 'Calcium',
};

export function computeAmaniStatus(
  name: BiomarkerName,
  value: number,
  cyclePhase?: CyclePhase | null
): AmaniStatus {
  const ranges = BIOMARKER_RANGES[name];
  if (!ranges) return 'unknown';

  let optMin = ranges.optimal.min;
  let optMax = ranges.optimal.max;
  let clinMin = ranges.clinical.min;
  let clinMax = ranges.clinical.max;

  if (cyclePhase && ranges.phaseRanges && ranges.phaseRanges[cyclePhase]) {
    const pr = ranges.phaseRanges[cyclePhase]!;
    optMin = pr.optimal.min ?? optMin;
    optMax = pr.optimal.max ?? optMax;
    clinMin = pr.clinical.min ?? clinMin;
    clinMax = pr.clinical.max ?? clinMax;
  }

  if (optMin !== null && optMax !== null && value >= optMin && value <= optMax) return 'optimal';

  const borderlineBuffer = 0.15;

  if (optMax !== null && value > optMax) {
    if (ranges.higherIsBetter) return 'optimal';
    const threshold = optMax * (1 + borderlineBuffer);
    if (clinMax !== null && value > clinMax) return 'out_of_range_high';
    if (threshold !== undefined && value <= threshold) return 'borderline_high';
    return 'out_of_range_high';
  }

  if (optMin !== null && value < optMin) {
    const threshold = optMin * (1 - borderlineBuffer);
    if (clinMin !== null && value < clinMin) return 'out_of_range_low';
    if (threshold !== undefined && value >= threshold) return 'borderline_low';
    return 'out_of_range_low';
  }

  return 'normal';
}

export function computeLabStatus(
  value: number,
  refMin: number | null,
  refMax: number | null
): LabStatus {
  if (refMin === null && refMax === null) return 'unknown';
  const range = (refMax ?? Infinity) - (refMin ?? -Infinity);
  const buffer = range * 0.08;
  if (refMin !== null && value < refMin) {
    return value < refMin - buffer ? 'out_of_range_low' : 'borderline_low';
  }
  if (refMax !== null && value > refMax) {
    return value > refMax + buffer ? 'out_of_range_high' : 'borderline_high';
  }
  return 'in_range';
}

export type StatusPillVariant =
  | 'optimal'
  | 'normal'
  | 'borderline_low'
  | 'borderline_high'
  | 'out_of_range'
  | 'unknown';

export function amaniStatusToVariant(status: AmaniStatus): StatusPillVariant {
  if (status === 'optimal') return 'optimal';
  if (status === 'normal') return 'normal';
  if (status === 'borderline_low' || status === 'borderline_high') return status as StatusPillVariant;
  if (status === 'out_of_range_low' || status === 'out_of_range_high') return 'out_of_range';
  return 'unknown';
}

export const STATUS_PILL_CONFIG: Record<StatusPillVariant, {
  label: string;
  bg: string;
  text: string;
  border: string;
  dot: string;
}> = {
  optimal:       { label: 'Optimal',        bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200', dot: 'bg-emerald-500' },
  normal:        { label: 'Normal',          bg: 'bg-blue-50',    text: 'text-blue-700',    border: 'border-blue-200',   dot: 'bg-blue-400' },
  borderline_low:  { label: 'Borderline Low',  bg: 'bg-amber-50',   text: 'text-amber-700',   border: 'border-amber-200',  dot: 'bg-amber-400' },
  borderline_high: { label: 'Borderline High', bg: 'bg-orange-50',  text: 'text-orange-700',  border: 'border-orange-200', dot: 'bg-orange-400' },
  out_of_range:  { label: 'Out of Range',    bg: 'bg-red-50',     text: 'text-red-700',     border: 'border-red-200',    dot: 'bg-red-500' },
  unknown:       { label: 'No Range',        bg: 'bg-gray-100',   text: 'text-gray-600',    border: 'border-gray-200',   dot: 'bg-gray-400' },
};

export function computeHealthScores(
  biomarkers: (Biomarker | LabResult)[],
  cyclePhase?: CyclePhase | null
): Record<string, number> {
  type CategoryAccum = { penalty: number; weight: number; count: number };
  const categories: Record<BiomarkerCategory, CategoryAccum> = {
    hormones:    { penalty: 0, weight: 0, count: 0 },
    thyroid:     { penalty: 0, weight: 0, count: 0 },
    metabolic:   { penalty: 0, weight: 0, count: 0 },
    lipids:      { penalty: 0, weight: 0, count: 0 },
    liver:       { penalty: 0, weight: 0, count: 0 },
    kidney:      { penalty: 0, weight: 0, count: 0 },
    inflammation:{ penalty: 0, weight: 0, count: 0 },
    nutrients:   { penalty: 0, weight: 0, count: 0 },
  };

  for (const b of biomarkers) {
    const name = ('biomarker_name' in b ? b.biomarker_name : b.name) as BiomarkerName;
    const value = b.value;
    const cat = BIOMARKER_CATEGORY_MAP[name];
    if (!cat) continue;

    const ranges = BIOMARKER_RANGES[name];
    if (!ranges) continue;

    const weight = ranges.scoreWeight;
    const status = computeAmaniStatus(name, value, cyclePhase);

    let penaltyFactor = 0;
    switch (status) {
      case 'optimal': penaltyFactor = 0; break;
      case 'normal': penaltyFactor = 0.1; break;
      case 'borderline_low':
      case 'borderline_high': penaltyFactor = 0.35; break;
      case 'out_of_range_low':
      case 'out_of_range_high': penaltyFactor = 0.7; break;
      default: penaltyFactor = 0.05;
    }

    categories[cat].penalty += penaltyFactor * weight;
    categories[cat].weight += weight;
    categories[cat].count += 1;
  }

  const scores: Record<string, number> = {};
  let totalPenalty = 0;
  let totalWeight = 0;

  for (const [cat, accum] of Object.entries(categories) as [BiomarkerCategory, CategoryAccum][]) {
    if (accum.count === 0) {
      scores[`${cat}_score`] = 100;
      continue;
    }
    const normalizedPenalty = accum.weight > 0 ? (accum.penalty / accum.weight) * 100 : 0;
    const score = Math.max(0, Math.round(100 - normalizedPenalty));
    scores[`${cat}_score`] = score;
    totalPenalty += accum.penalty;
    totalWeight += accum.weight;
  }

  scores['overall_score'] = totalWeight > 0
    ? Math.max(0, Math.round(100 - (totalPenalty / totalWeight) * 100))
    : 100;

  return scores;
}

export const RECOMMENDED_LABS: Record<BiomarkerCategory, { name: BiomarkerName; reason: string }[]> = {
  hormones: [
    { name: 'amh', reason: 'Ovarian reserve assessment' },
    { name: 'free_testosterone', reason: 'Androgen bioavailability' },
    { name: 'prolactin', reason: 'Cycle disruption evaluation' },
  ],
  thyroid: [
    { name: 'free_t3', reason: 'Active thyroid hormone status' },
    { name: 'reverse_t3', reason: 'Conversion efficiency' },
    { name: 'tpo_antibodies', reason: 'Autoimmune thyroid screening' },
  ],
  metabolic: [
    { name: 'fasting_insulin', reason: 'Insulin resistance assessment' },
    { name: 'c_peptide', reason: 'Pancreatic insulin production' },
    { name: 'hemoglobin_a1c', reason: 'Long-term glucose control' },
  ],
  lipids: [
    { name: 'apob', reason: 'Particle burden assessment' },
    { name: 'lpa', reason: 'Genetic cardiovascular risk' },
    { name: 'hs_crp', reason: 'Vascular inflammation' },
  ],
  liver: [
    { name: 'ggt', reason: 'Liver/biliary marker' },
    { name: 'alkaline_phosphatase', reason: 'Liver and bone enzyme' },
  ],
  kidney: [
    { name: 'egfr', reason: 'Kidney filtration capacity' },
    { name: 'bun', reason: 'Kidney function context' },
  ],
  inflammation: [
    { name: 'esr', reason: 'Broad inflammatory marker' },
    { name: 'hs_crp', reason: 'Cardiovascular inflammation risk' },
  ],
  nutrients: [
    { name: 'iron_saturation', reason: 'Iron transport status' },
    { name: 'vitamin_d_25_oh', reason: 'Immune and hormone function' },
    { name: 'vitamin_b12', reason: 'Neurological function' },
    { name: 'magnesium', reason: 'Enzyme and hormone support' },
  ],
};
