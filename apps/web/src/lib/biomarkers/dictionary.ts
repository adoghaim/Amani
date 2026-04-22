import type { BiomarkerName, BiomarkerCategory, CyclePhase } from '../../types';

export type ImportanceLevel = 'critical' | 'important' | 'supporting';

export interface OptimalRange {
  min: number | null;
  max: number | null;
}

export interface ClinicalRange {
  min: number | null;
  max: number | null;
}

export interface PhaseRange {
  optimal: OptimalRange;
  clinical: ClinicalRange;
}

export interface BiomarkerEntry {
  key: BiomarkerName;
  displayName: string;
  aliases: string[];
  defaultUnit: string;
  category: BiomarkerCategory;
  importance: ImportanceLevel;
  scoreWeight: number;
  optimal: OptimalRange;
  clinical: ClinicalRange;
  phaseRanges?: Partial<Record<CyclePhase | 'general', PhaseRange>>;
  higherIsBetter?: boolean;
}

type EntryInput = Omit<BiomarkerEntry, 'scoreWeight'> & { scoreWeight?: number };

function w(importance: ImportanceLevel): number {
  if (importance === 'critical') return 3;
  if (importance === 'important') return 2;
  return 1;
}

const RAW_ENTRIES: EntryInput[] = [
  // ── Hormones ──
  {
    key: 'estradiol', displayName: 'Estradiol (E2)', defaultUnit: 'pg/mL', category: 'hormones', importance: 'critical',
    aliases: ['estradiol', 'e2', 'oestradiol', 'estradiol e2'],
    optimal: { min: 30, max: 350 }, clinical: { min: 10, max: 400 },
    phaseRanges: {
      menstrual:  { optimal: { min: 20, max: 80 },   clinical: { min: 10, max: 200 } },
      follicular: { optimal: { min: 30, max: 250 },  clinical: { min: 20, max: 400 } },
      ovulatory:  { optimal: { min: 150, max: 750 }, clinical: { min: 100, max: 1000 } },
      luteal:     { optimal: { min: 50, max: 300 },  clinical: { min: 30, max: 500 } },
    },
  },
  {
    key: 'progesterone', displayName: 'Progesterone', defaultUnit: 'ng/mL', category: 'hormones', importance: 'critical',
    aliases: ['progesterone', 'p4'],
    optimal: { min: 0.1, max: 25 }, clinical: { min: 0.1, max: 30 },
    phaseRanges: {
      menstrual:  { optimal: { min: 0.1, max: 0.9 }, clinical: { min: 0.1, max: 1.5 } },
      follicular: { optimal: { min: 0.1, max: 0.9 }, clinical: { min: 0.1, max: 1.5 } },
      ovulatory:  { optimal: { min: 1.0, max: 3.0 }, clinical: { min: 0.5, max: 5.0 } },
      luteal:     { optimal: { min: 5.0, max: 25 },  clinical: { min: 3.0, max: 30 } },
    },
  },
  {
    key: 'fsh', displayName: 'FSH', defaultUnit: 'mIU/mL', category: 'hormones', importance: 'critical',
    aliases: ['fsh', 'follicle stimulating hormone', 'follicle-stimulating hormone'],
    optimal: { min: 3, max: 10 }, clinical: { min: 2, max: 25 },
    phaseRanges: {
      menstrual:  { optimal: { min: 3, max: 10 }, clinical: { min: 3, max: 20 } },
      follicular: { optimal: { min: 2, max: 10 }, clinical: { min: 2, max: 20 } },
      ovulatory:  { optimal: { min: 2, max: 15 }, clinical: { min: 2, max: 30 } },
      luteal:     { optimal: { min: 1, max: 8 },  clinical: { min: 1, max: 10 } },
    },
  },
  {
    key: 'lh', displayName: 'LH', defaultUnit: 'mIU/mL', category: 'hormones', importance: 'important',
    aliases: ['lh', 'luteinizing hormone'],
    optimal: { min: 2, max: 15 }, clinical: { min: 1, max: 100 },
    phaseRanges: {
      menstrual:  { optimal: { min: 2, max: 15 },  clinical: { min: 1, max: 25 } },
      follicular: { optimal: { min: 2, max: 15 },  clinical: { min: 1, max: 25 } },
      ovulatory:  { optimal: { min: 20, max: 80 }, clinical: { min: 15, max: 100 } },
      luteal:     { optimal: { min: 2, max: 12 },  clinical: { min: 1, max: 20 } },
    },
  },
  { key: 'total_testosterone', displayName: 'Total Testosterone', defaultUnit: 'ng/dL', category: 'hormones', importance: 'important', aliases: ['total testosterone', 'testosterone total', 'testosterone'], optimal: { min: 15, max: 70 }, clinical: { min: 10, max: 100 } },
  { key: 'free_testosterone', displayName: 'Free Testosterone', defaultUnit: 'pg/mL', category: 'hormones', importance: 'important', aliases: ['free testosterone', 'testosterone free'], optimal: { min: 1.0, max: 8.5 }, clinical: { min: 0.5, max: 10 } },
  { key: 'shbg', displayName: 'SHBG', defaultUnit: 'nmol/L', category: 'hormones', importance: 'supporting', aliases: ['shbg', 'sex hormone binding globulin', 'sex hormone-binding globulin'], optimal: { min: 40, max: 120 }, clinical: { min: 18, max: 200 } },
  { key: 'dheas', displayName: 'DHEA-S', defaultUnit: 'ug/dL', category: 'hormones', importance: 'supporting', aliases: ['dheas', 'dhea-s', 'dhea sulfate', 'dehydroepiandrosterone sulfate'], optimal: { min: 65, max: 380 }, clinical: { min: 35, max: 430 } },
  { key: 'prolactin', displayName: 'Prolactin', defaultUnit: 'ng/mL', category: 'hormones', importance: 'important', aliases: ['prolactin', 'prl'], optimal: { min: 3, max: 20 }, clinical: { min: 2, max: 29 } },
  { key: 'amh', displayName: 'AMH', defaultUnit: 'ng/mL', category: 'hormones', importance: 'critical', aliases: ['amh', 'anti-mullerian hormone', 'anti mullerian hormone', 'antimullerian hormone'], optimal: { min: 1.0, max: 3.5 }, clinical: { min: 0.1, max: 6.0 } },

  // ── Thyroid ──
  { key: 'tsh', displayName: 'TSH', defaultUnit: 'mIU/L', category: 'thyroid', importance: 'critical', aliases: ['tsh', 'thyroid stimulating hormone', 'thyroid-stimulating hormone', 'thyrotropin'], optimal: { min: 1.0, max: 2.5 }, clinical: { min: 0.4, max: 4.0 } },
  { key: 'free_t3', displayName: 'Free T3', defaultUnit: 'pg/mL', category: 'thyroid', importance: 'critical', aliases: ['free t3', 'ft3', 'triiodothyronine free'], optimal: { min: 3.0, max: 4.0 }, clinical: { min: 2.3, max: 4.2 } },
  { key: 'free_t4', displayName: 'Free T4', defaultUnit: 'ng/dL', category: 'thyroid', importance: 'critical', aliases: ['free t4', 'ft4', 'free thyroxine', 'thyroxine free'], optimal: { min: 0.9, max: 1.7 }, clinical: { min: 0.8, max: 1.8 } },
  { key: 'total_t4', displayName: 'Total T4', defaultUnit: 'ug/dL', category: 'thyroid', importance: 'supporting', aliases: ['total t4', 't4', 'thyroxine'], optimal: { min: 5.5, max: 11.0 }, clinical: { min: 4.5, max: 12.0 } },
  { key: 'reverse_t3', displayName: 'Reverse T3', defaultUnit: 'ng/dL', category: 'thyroid', importance: 'supporting', aliases: ['reverse t3', 'rt3', 'reverse triiodothyronine'], optimal: { min: 10, max: 24 }, clinical: { min: 8, max: 25 } },
  { key: 'tpo_antibodies', displayName: 'TPO Antibodies', defaultUnit: 'IU/mL', category: 'thyroid', importance: 'critical', aliases: ['tpo antibodies', 'tpo ab', 'thyroid peroxidase antibodies', 'anti-tpo', 'tpo'], optimal: { min: 0, max: 34 }, clinical: { min: 0, max: 35 } },
  { key: 'tg_antibodies', displayName: 'TgAb', defaultUnit: 'IU/mL', category: 'thyroid', importance: 'important', aliases: ['tg antibodies', 'tgab', 'thyroglobulin antibodies', 'anti-tg'], optimal: { min: 0, max: 0.9 }, clinical: { min: 0, max: 1.0 } },
  { key: 'free_thyroxine_index', displayName: 'Free T4 Index (T7)', defaultUnit: '', category: 'thyroid', importance: 'supporting', aliases: ['free thyroxine index', 't7', 'fti'], optimal: { min: 1.2, max: 4.9 }, clinical: { min: 1.0, max: 4.9 } },
  { key: 't3_uptake', displayName: 'T3 Uptake', defaultUnit: '%', category: 'thyroid', importance: 'supporting', aliases: ['t3 uptake', 't3u'], optimal: { min: 24, max: 39 }, clinical: { min: 22, max: 43 } },
  { key: 'total_t3', displayName: 'Total T3', defaultUnit: 'ng/dL', category: 'thyroid', importance: 'supporting', aliases: ['total t3', 't3', 'triiodothyronine'], optimal: { min: 80, max: 200 }, clinical: { min: 71, max: 220 } },

  // ── Metabolic ──
  { key: 'fasting_glucose', displayName: 'Fasting Glucose', defaultUnit: 'mg/dL', category: 'metabolic', importance: 'critical', aliases: ['fasting glucose', 'glucose fasting', 'glucose', 'blood glucose', 'glucose serum'], optimal: { min: 72, max: 90 }, clinical: { min: 70, max: 99 } },
  { key: 'hemoglobin_a1c', displayName: 'HbA1c', defaultUnit: '%', category: 'metabolic', importance: 'critical', aliases: ['hemoglobin a1c', 'hba1c', 'a1c', 'glycated hemoglobin', 'glycohemoglobin'], optimal: { min: 4.6, max: 5.4 }, clinical: { min: 4.0, max: 5.6 } },
  { key: 'fasting_insulin', displayName: 'Fasting Insulin', defaultUnit: 'uIU/mL', category: 'metabolic', importance: 'critical', aliases: ['fasting insulin', 'insulin fasting', 'insulin'], optimal: { min: 2, max: 10 }, clinical: { min: 1, max: 25 } },
  { key: 'c_peptide', displayName: 'C-Peptide', defaultUnit: 'ng/mL', category: 'metabolic', importance: 'supporting', aliases: ['c-peptide', 'c peptide'], optimal: { min: 0.8, max: 3.1 }, clinical: { min: 0.5, max: 4.0 } },
  { key: 'sodium', displayName: 'Sodium', defaultUnit: 'mEq/L', category: 'metabolic', importance: 'important', aliases: ['sodium', 'na'], optimal: { min: 136, max: 145 }, clinical: { min: 134, max: 146 } },
  { key: 'potassium', displayName: 'Potassium', defaultUnit: 'mEq/L', category: 'metabolic', importance: 'important', aliases: ['potassium', 'k'], optimal: { min: 3.8, max: 4.8 }, clinical: { min: 3.5, max: 5.0 } },
  { key: 'chloride', displayName: 'Chloride', defaultUnit: 'mEq/L', category: 'metabolic', importance: 'supporting', aliases: ['chloride', 'cl'], optimal: { min: 98, max: 107 }, clinical: { min: 96, max: 109 } },
  { key: 'co2', displayName: 'CO2', defaultUnit: 'mEq/L', category: 'metabolic', importance: 'supporting', aliases: ['co2', 'carbon dioxide', 'bicarbonate'], optimal: { min: 22, max: 29 }, clinical: { min: 20, max: 32 } },
  { key: 'calcium', displayName: 'Calcium', defaultUnit: 'mg/dL', category: 'metabolic', importance: 'important', aliases: ['calcium', 'ca'], optimal: { min: 9.0, max: 10.0 }, clinical: { min: 8.5, max: 10.5 } },

  // ── Lipids ──
  { key: 'total_cholesterol', displayName: 'Total Cholesterol', defaultUnit: 'mg/dL', category: 'lipids', importance: 'important', aliases: ['total cholesterol', 'cholesterol total', 'cholesterol'], optimal: { min: 160, max: 200 }, clinical: { min: 100, max: 239 } },
  { key: 'hdl_cholesterol', displayName: 'HDL', defaultUnit: 'mg/dL', category: 'lipids', importance: 'critical', aliases: ['hdl cholesterol', 'hdl', 'hdl-c'], optimal: { min: 60, max: 90 }, clinical: { min: 50, max: 100 }, higherIsBetter: true },
  { key: 'ldl_cholesterol', displayName: 'LDL', defaultUnit: 'mg/dL', category: 'lipids', importance: 'critical', aliases: ['ldl cholesterol', 'ldl', 'ldl-c', 'ldl calculated', 'ldl calc'], optimal: { min: 60, max: 100 }, clinical: { min: 0, max: 129 } },
  { key: 'triglycerides', displayName: 'Triglycerides', defaultUnit: 'mg/dL', category: 'lipids', importance: 'critical', aliases: ['triglycerides', 'trigs', 'tg'], optimal: { min: 60, max: 100 }, clinical: { min: 0, max: 149 } },
  { key: 'non_hdl_cholesterol', displayName: 'Non-HDL Cholesterol', defaultUnit: 'mg/dL', category: 'lipids', importance: 'important', aliases: ['non-hdl cholesterol', 'non hdl cholesterol'], optimal: { min: 80, max: 130 }, clinical: { min: 0, max: 159 } },
  { key: 'apob', displayName: 'ApoB', defaultUnit: 'mg/dL', category: 'lipids', importance: 'critical', aliases: ['apob', 'apolipoprotein b', 'apo b'], optimal: { min: 55, max: 90 }, clinical: { min: 40, max: 120 } },
  { key: 'lpa', displayName: 'Lp(a)', defaultUnit: 'nmol/L', category: 'lipids', importance: 'important', aliases: ['lpa', 'lp(a)', 'lipoprotein a', 'lipoprotein(a)'], optimal: { min: 0, max: 75 }, clinical: { min: 0, max: 125 } },
  { key: 'chol_hdl_ratio', displayName: 'Chol/HDL Ratio', defaultUnit: '', category: 'lipids', importance: 'supporting', aliases: ['chol/hdl ratio', 'cholesterol hdl ratio', 'total cholesterol/hdl ratio'], optimal: { min: 0, max: 3.5 }, clinical: { min: 0, max: 5.0 } },

  // ── Liver ──
  { key: 'ast', displayName: 'AST', defaultUnit: 'U/L', category: 'liver', importance: 'important', aliases: ['ast', 'aspartate aminotransferase', 'sgot'], optimal: { min: 10, max: 25 }, clinical: { min: 10, max: 40 } },
  { key: 'alt', displayName: 'ALT', defaultUnit: 'U/L', category: 'liver', importance: 'critical', aliases: ['alt', 'alanine aminotransferase', 'sgpt'], optimal: { min: 7, max: 25 }, clinical: { min: 7, max: 45 } },
  { key: 'ggt', displayName: 'GGT', defaultUnit: 'U/L', category: 'liver', importance: 'important', aliases: ['ggt', 'gamma-glutamyl transferase', 'gamma glutamyl transferase', 'gamma gt'], optimal: { min: 8, max: 20 }, clinical: { min: 8, max: 45 } },
  { key: 'alkaline_phosphatase', displayName: 'Alkaline Phosphatase', defaultUnit: 'U/L', category: 'liver', importance: 'supporting', aliases: ['alkaline phosphatase', 'alk phos', 'alp'], optimal: { min: 40, max: 100 }, clinical: { min: 35, max: 130 } },
  { key: 'bilirubin_total', displayName: 'Bilirubin', defaultUnit: 'mg/dL', category: 'liver', importance: 'supporting', aliases: ['bilirubin total', 'total bilirubin', 'bilirubin'], optimal: { min: 0.3, max: 1.0 }, clinical: { min: 0.2, max: 1.2 } },
  { key: 'albumin', displayName: 'Albumin', defaultUnit: 'g/dL', category: 'liver', importance: 'supporting', aliases: ['albumin'], optimal: { min: 4.0, max: 5.0 }, clinical: { min: 3.5, max: 5.5 } },
  { key: 'globulin', displayName: 'Globulin', defaultUnit: 'g/dL', category: 'liver', importance: 'supporting', aliases: ['globulin'], optimal: { min: 2.0, max: 3.5 }, clinical: { min: 1.5, max: 4.0 } },
  { key: 'total_protein', displayName: 'Total Protein', defaultUnit: 'g/dL', category: 'liver', importance: 'supporting', aliases: ['total protein', 'protein total'], optimal: { min: 6.5, max: 8.0 }, clinical: { min: 6.0, max: 8.5 } },
  { key: 'albumin_globulin_ratio', displayName: 'A/G Ratio', defaultUnit: '', category: 'liver', importance: 'supporting', aliases: ['a/g ratio', 'albumin/globulin ratio', 'albumin globulin ratio'], optimal: { min: 1.3, max: 2.5 }, clinical: { min: 1.0, max: 3.0 } },

  // ── Kidney ──
  { key: 'creatinine', displayName: 'Creatinine', defaultUnit: 'mg/dL', category: 'kidney', importance: 'critical', aliases: ['creatinine', 'creat'], optimal: { min: 0.5, max: 0.9 }, clinical: { min: 0.5, max: 1.1 } },
  { key: 'bun', displayName: 'BUN', defaultUnit: 'mg/dL', category: 'kidney', importance: 'important', aliases: ['bun', 'blood urea nitrogen', 'urea nitrogen'], optimal: { min: 7, max: 18 }, clinical: { min: 6, max: 20 } },
  { key: 'egfr', displayName: 'eGFR', defaultUnit: 'mL/min/1.73m2', category: 'kidney', importance: 'critical', aliases: ['egfr', 'estimated gfr', 'glomerular filtration rate'], optimal: { min: 90, max: 200 }, clinical: { min: 60, max: 200 }, higherIsBetter: true },
  { key: 'bun_creatinine_ratio', displayName: 'BUN/Creatinine Ratio', defaultUnit: '', category: 'kidney', importance: 'supporting', aliases: ['bun/creatinine ratio', 'bun creatinine ratio'], optimal: { min: 10, max: 20 }, clinical: { min: 6, max: 25 } },

  // ── Inflammation ──
  { key: 'hs_crp', displayName: 'hs-CRP', defaultUnit: 'mg/L', category: 'inflammation', importance: 'critical', aliases: ['hs-crp', 'hs crp', 'high sensitivity c-reactive protein', 'c-reactive protein', 'crp'], optimal: { min: 0, max: 1.0 }, clinical: { min: 0, max: 3.0 } },
  { key: 'esr', displayName: 'ESR', defaultUnit: 'mm/hr', category: 'inflammation', importance: 'important', aliases: ['esr', 'sed rate', 'erythrocyte sedimentation rate', 'sedimentation rate'], optimal: { min: 0, max: 15 }, clinical: { min: 0, max: 20 } },

  // ── Nutrients ──
  { key: 'ferritin', displayName: 'Ferritin', defaultUnit: 'ng/mL', category: 'nutrients', importance: 'critical', aliases: ['ferritin'], optimal: { min: 30, max: 150 }, clinical: { min: 13, max: 150 } },
  { key: 'iron_saturation', displayName: 'Iron Saturation', defaultUnit: '%', category: 'nutrients', importance: 'important', aliases: ['iron saturation', 'iron sat', 'tibc saturation', 'transferrin saturation'], optimal: { min: 25, max: 40 }, clinical: { min: 15, max: 50 } },
  { key: 'vitamin_d_25_oh', displayName: 'Vitamin D', defaultUnit: 'ng/mL', category: 'nutrients', importance: 'critical', aliases: ['vitamin d', '25-oh vitamin d', 'vitamin d 25-oh', '25-hydroxyvitamin d', 'vitamin d 25 hydroxy'], optimal: { min: 50, max: 80 }, clinical: { min: 30, max: 100 } },
  { key: 'vitamin_b12', displayName: 'Vitamin B12', defaultUnit: 'pg/mL', category: 'nutrients', importance: 'important', aliases: ['vitamin b12', 'b12', 'cobalamin'], optimal: { min: 400, max: 900 }, clinical: { min: 200, max: 900 } },
  { key: 'folate', displayName: 'Folate', defaultUnit: 'ng/mL', category: 'nutrients', importance: 'important', aliases: ['folate', 'folic acid', 'folate serum'], optimal: { min: 10, max: 20 }, clinical: { min: 5, max: 20 } },
  { key: 'magnesium', displayName: 'Magnesium', defaultUnit: 'mg/dL', category: 'nutrients', importance: 'important', aliases: ['magnesium', 'mg'], optimal: { min: 5.2, max: 6.5 }, clinical: { min: 4.2, max: 6.8 } },
  { key: 'serum_iron', displayName: 'Serum Iron', defaultUnit: 'ug/dL', category: 'nutrients', importance: 'important', aliases: ['serum iron', 'iron serum', 'iron'], optimal: { min: 60, max: 150 }, clinical: { min: 50, max: 175 } },
  { key: 'tibc', displayName: 'TIBC', defaultUnit: 'ug/dL', category: 'nutrients', importance: 'supporting', aliases: ['tibc', 'total iron binding capacity', 'iron binding capacity'], optimal: { min: 250, max: 370 }, clinical: { min: 250, max: 400 } },
  { key: 'uibc', displayName: 'UIBC', defaultUnit: 'ug/dL', category: 'nutrients', importance: 'supporting', aliases: ['uibc', 'unsaturated iron binding capacity'], optimal: { min: 150, max: 310 }, clinical: { min: 111, max: 343 } },

  // ── Blood ──
  { key: 'wbc', displayName: 'WBC', defaultUnit: 'K/uL', category: 'blood', importance: 'important', aliases: ['wbc', 'white blood cell count', 'white blood cells', 'leukocytes'], optimal: { min: 4.5, max: 10.5 }, clinical: { min: 3.5, max: 11.0 } },
  { key: 'rbc', displayName: 'RBC', defaultUnit: 'M/uL', category: 'blood', importance: 'supporting', aliases: ['rbc', 'red blood cell count', 'red blood cells', 'erythrocytes'], optimal: { min: 3.8, max: 5.2 }, clinical: { min: 3.5, max: 5.5 } },
  { key: 'hemoglobin', displayName: 'Hemoglobin', defaultUnit: 'g/dL', category: 'blood', importance: 'important', aliases: ['hemoglobin', 'hgb', 'hb'], optimal: { min: 12.0, max: 16.0 }, clinical: { min: 11.5, max: 17.0 } },
  { key: 'hematocrit', displayName: 'Hematocrit', defaultUnit: '%', category: 'blood', importance: 'supporting', aliases: ['hematocrit', 'hct'], optimal: { min: 36, max: 48 }, clinical: { min: 34, max: 52 } },
  { key: 'mcv', displayName: 'MCV', defaultUnit: 'fL', category: 'blood', importance: 'supporting', aliases: ['mcv', 'mean corpuscular volume'], optimal: { min: 80, max: 95 }, clinical: { min: 75, max: 100 } },
  { key: 'mch', displayName: 'MCH', defaultUnit: 'pg', category: 'blood', importance: 'supporting', aliases: ['mch', 'mean corpuscular hemoglobin'], optimal: { min: 27, max: 32 }, clinical: { min: 25, max: 35 } },
  { key: 'mchc', displayName: 'MCHC', defaultUnit: 'g/dL', category: 'blood', importance: 'supporting', aliases: ['mchc', 'mean corpuscular hemoglobin concentration'], optimal: { min: 32, max: 36 }, clinical: { min: 31, max: 37 } },
  { key: 'rdw', displayName: 'RDW', defaultUnit: '%', category: 'blood', importance: 'supporting', aliases: ['rdw', 'red cell distribution width', 'rdw-cv'], optimal: { min: 11.5, max: 14.5 }, clinical: { min: 11.0, max: 15.0 } },
  { key: 'platelets', displayName: 'Platelets', defaultUnit: 'K/uL', category: 'blood', importance: 'important', aliases: ['platelets', 'platelet count', 'plt'], optimal: { min: 150, max: 400 }, clinical: { min: 130, max: 450 } },
  { key: 'mpv', displayName: 'MPV', defaultUnit: 'fL', category: 'blood', importance: 'supporting', aliases: ['mpv', 'mean platelet volume'], optimal: { min: 7.5, max: 12.5 }, clinical: { min: 7.0, max: 13.0 } },
  { key: 'neutrophils', displayName: 'Neutrophils', defaultUnit: '%', category: 'blood', importance: 'supporting', aliases: ['neutrophils', 'neutrophils %', 'neut %'], optimal: { min: 45, max: 70 }, clinical: { min: 40, max: 80 } },
  { key: 'lymphocytes', displayName: 'Lymphocytes', defaultUnit: '%', category: 'blood', importance: 'supporting', aliases: ['lymphocytes', 'lymphocytes %', 'lymph %'], optimal: { min: 20, max: 40 }, clinical: { min: 15, max: 45 } },
  { key: 'monocytes', displayName: 'Monocytes', defaultUnit: '%', category: 'blood', importance: 'supporting', aliases: ['monocytes', 'monocytes %', 'mono %'], optimal: { min: 2, max: 10 }, clinical: { min: 1, max: 12 } },
  { key: 'eosinophils', displayName: 'Eosinophils', defaultUnit: '%', category: 'blood', importance: 'supporting', aliases: ['eosinophils', 'eosinophils %', 'eos %'], optimal: { min: 0, max: 5 }, clinical: { min: 0, max: 7 } },
  { key: 'basophils', displayName: 'Basophils', defaultUnit: '%', category: 'blood', importance: 'supporting', aliases: ['basophils', 'basophils %', 'baso %'], optimal: { min: 0, max: 2 }, clinical: { min: 0, max: 3 } },
];

const ENTRIES: BiomarkerEntry[] = RAW_ENTRIES.map(e => ({
  ...e,
  scoreWeight: w(e.importance),
}));

const BY_KEY = new Map<BiomarkerName, BiomarkerEntry>();
const ALIAS_MAP = new Map<string, BiomarkerName>();

for (const entry of ENTRIES) {
  BY_KEY.set(entry.key, entry);
  ALIAS_MAP.set(entry.key, entry.key);
  for (const alias of entry.aliases) {
    ALIAS_MAP.set(alias.toLowerCase(), entry.key);
  }
}

export function getEntry(key: BiomarkerName): BiomarkerEntry | undefined {
  return BY_KEY.get(key);
}

export function resolveAlias(rawName: string): BiomarkerName | null {
  const normalized = rawName.toLowerCase().trim().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
  const direct = ALIAS_MAP.get(normalized);
  if (direct) return direct;
  const underscore = ALIAS_MAP.get(normalized.replace(/ /g, '_'));
  if (underscore) return underscore;
  return null;
}

export function getDisplayName(key: BiomarkerName): string {
  return BY_KEY.get(key)?.displayName ?? key.replace(/_/g, ' ');
}

export function getCategory(key: BiomarkerName): BiomarkerCategory | null {
  return BY_KEY.get(key)?.category ?? null;
}

export function getImportance(key: BiomarkerName): ImportanceLevel {
  return BY_KEY.get(key)?.importance ?? 'supporting';
}

export function getScoreWeight(key: BiomarkerName): number {
  return BY_KEY.get(key)?.scoreWeight ?? 1;
}

export function getAllEntries(): BiomarkerEntry[] {
  return ENTRIES;
}

export function getEntriesByCategory(category: BiomarkerCategory): BiomarkerEntry[] {
  return ENTRIES.filter(e => e.category === category);
}

export function getRangesForPhase(
  key: BiomarkerName,
  phase?: CyclePhase | null,
): { optimal: OptimalRange; clinical: ClinicalRange } | null {
  const entry = BY_KEY.get(key);
  if (!entry) return null;
  if (phase && entry.phaseRanges?.[phase]) {
    return entry.phaseRanges[phase]!;
  }
  return { optimal: entry.optimal, clinical: entry.clinical };
}

export { ENTRIES as BIOMARKER_ENTRIES };
