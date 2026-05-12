import type { BiomarkerPattern } from './types';

export const BIOMARKER_PATTERNS: BiomarkerPattern[] = [
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
    patterns: ['lh', 'luteinizing hormone', 'luteinising hormone', 'luteinizing', 'luteinising', 'lutropin', 'lh, serum'],
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
    patterns: ['testosterone, total, ms', 'testosterone, total', 'total testosterone', 'testosterone total', 'testosterone serum', 'testosterone,total', 'testosterone, total ms'],
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
    patterns: ['sex hormone binding globulin', 'shbg', 'sex-hormone-binding globulin'],
    commonUnits: ['nmol/L', 'nM', 'nmol/l'],
  },
  {
    canonical: 'tsh',
    patterns: ['tsh', 'thyroid stimulating hormone', 'thyroid-stimulating', 'thyrotropin'],
    commonUnits: ['mIU/L', 'μIU/mL', 'uiu/ml', 'miu/l', 'uIU/ml', 'IU/L'],
  },
  {
    canonical: 'total_t4',
    patterns: [
      't4 (thyroxine), total', 'total t4', 't4 total', 't4, total', 'thyroxine total', 'thyroxine, total',
      't4 (thyroxine)', 'thyroxine (t4)', 't4, serum', 'serum t4',
    ],
    commonUnits: ['mcg/dL', 'ug/dL', 'nmol/L'],
  },
  {
    canonical: 'free_thyroxine_index',
    patterns: ['free t4 index (t7)', 'free thyroxine index (t7)', 'free t4 index', 'free thyroxine index', 'fti', 't7'],
    commonUnits: [''],
  },
  {
    canonical: 'free_t4',
    patterns: ['t4, free', 'free t4', 'free thyroxine', 't4 free', 'ft4', 'free t 4', 't4,free', 't4 free (direct)'],
    commonUnits: ['ng/dL', 'pmol/L', 'ng/dl', 'ug/dl', 'μg/dL'],
  },
  {
    canonical: 'free_t3',
    patterns: ['t3, free', 'free t3', 'free triiodothyronine', 't3 free', 'ft3', 'free t 3', 't3,free'],
    commonUnits: ['pg/mL', 'pmol/L', 'pg/ml'],
  },
  {
    canonical: 'reverse_t3',
    patterns: ['reverse t3', 'rt3', 'reverse triiodothyronine', 'reverse-t3'],
    commonUnits: ['ng/dL', 'pmol/L', 'ng/dl'],
  },
  {
    canonical: 'tpo_antibodies',
    patterns: [
      'thyroid peroxidase (tpo) antibodies', 'thyroid peroxidase antibodies',
      'thyroid peroxidase (tpo) ab', 'thyroid peroxidase (tpo) antibody',
      'thyroid peroxidase antibody', 'tpo antibodies', 'tpo antibody', 'anti-tpo', 'tpo ab', 'tpo ab igg',
      'antithyroid peroxidase', 'thyroid peroxidase ab', 'tpo (thyroid peroxidase antibody)',
      'thyroid peroxidase (tpo)', 'peroxidase (tpo) antibodies',
    ],
    commonUnits: ['IU/mL', 'U/mL', 'kIU/L', 'IU/ml'],
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
    patterns: ['hemoglobin a1c (hba1c)', 'hba1c', 'hemoglobin a1c', 'glycated hemoglobin', 'a1c', 'hgba1c', 'haemoglobin a1c'],
    commonUnits: ['%', 'mmol/mol'],
  },
  {
    canonical: 'c_peptide',
    patterns: ['c-peptide', 'c peptide'],
    commonUnits: ['ng/mL', 'nmol/L'],
  },
  {
    canonical: 'total_cholesterol',
    patterns: ['cholesterol, total', 'total cholesterol', 'cholesterol total', 'cholesterol,total'],
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
    patterns: ['non-hdl cholesterol', 'non hdl cholesterol', 'non-hdl chol', 'non hdl chol', 'cholesterol, non-hdl', 'cholesterol, non hdl', 'non-hdl-c', 'non hdl-c'],
    commonUnits: ['mg/dL', 'mmol/L', 'mg/dl'],
  },
  {
    canonical: 'chol_hdl_ratio',
    patterns: ['chol/hdlc ratio', 'chol/hdl ratio', 'cholesterol/hdl ratio', 'cholesterol hdl ratio', 'chol hdl ratio', 'total chol/hdl', 'chol/hdlc', 'total cholesterol/hdl'],
    commonUnits: ['ratio', ''],
  },
  {
    canonical: 'apob',
    patterns: ['apolipoprotein b', 'apob', 'apo b', 'apolipoprotein-b', 'apo b-100', 'apolipoprotein b-100', 'apo b100'],
    commonUnits: ['mg/dL', 'g/L', 'mg/dl'],
  },
  {
    canonical: 'lpa',
    patterns: ['lp(a)', 'lipoprotein a', 'lipoprotein(a)', 'lp-a'],
    commonUnits: ['nmol/L', 'mg/dL', 'nmol/l'],
  },
  {
    canonical: 'alt',
    patterns: ['alt (sgpt)', 'alt/sgpt', 'alanine aminotransferase', 'alanine transaminase', 'sgpt', 'alt'],
    commonUnits: ['U/L', 'IU/L', 'u/l'],
  },
  {
    canonical: 'ast',
    patterns: ['ast (sgot)', 'ast/sgot', 'aspartate aminotransferase', 'aspartate transaminase', 'sgot', 'ast'],
    commonUnits: ['U/L', 'IU/L', 'u/l'],
  },
  {
    canonical: 'ggt',
    patterns: ['ggt (gamma glutamyl transpeptidase)', 'ggt', 'gamma-glutamyl transferase', 'gamma glutamyl', 'ggtp', 'gamma-gt'],
    commonUnits: ['U/L', 'IU/L', 'u/l'],
  },
  {
    canonical: 'alkaline_phosphatase',
    patterns: ['alkaline phosphatase', 'alk phos', 'alp'],
    commonUnits: ['U/L', 'IU/L', 'u/l'],
  },
  {
    canonical: 'bilirubin_total',
    patterns: ['bilirubin, total', 'total bilirubin', 'bilirubin total', 'tbili', 'bilirubin,total', 'bilirubin'],
    commonUnits: ['mg/dL', 'umol/L', 'mg/dl'],
  },
  {
    canonical: 'creatinine',
    patterns: ['creatinine, serum', 'serum creatinine', 'creatinine', 'creat'],
    commonUnits: ['mg/dL', 'umol/L', 'mg/dl'],
  },
  {
    canonical: 'egfr',
    patterns: ['egfr non-afr. american', 'gfr estimated non-african american', 'egfr african american', 'egfr', 'estimated gfr', 'glomerular filtration rate', 'egfr-ckd-epi'],
    commonUnits: ['mL/min/1.73m2', 'mL/min', 'ml/min'],
  },
  {
    canonical: 'bun',
    patterns: ['urea nitrogen (bun)', 'bun', 'blood urea nitrogen', 'urea nitrogen', 'urea'],
    commonUnits: ['mg/dL', 'mmol/L', 'mg/dl'],
  },
  {
    canonical: 'hs_crp',
    patterns: ['c-reactive protein, cardiac', 'hs-crp', 'hscrp', 'high sensitivity crp', 'high-sensitivity c-reactive protein', 'hs crp', 'c-reactive protein (high sensitivity)', 'crp, high sensitivity'],
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
    // Bare 'vitamin d' is listed alongside compound forms. The global longest-first
    // matcher in labelMatching.ts naturally resolves "Vitamin D, 25-OH, Total" to the
    // compound alias first; bare "Vitamin D 42 ng/mL …" falls through to this entry.
    patterns: ['vitamin d, 25-hydroxy', 'vitamin d, 25-oh', '25-hydroxy vitamin d', '25-oh vitamin d', '25-hydroxyvitamin d', 'vitamin d (25-oh)', 'cholecalciferol', '25 hydroxy', '25(oh)d', 'vitamin d', 'vit d'],
    commonUnits: ['ng/mL', 'nmol/L', 'ng/ml', 'ng/dl'],
  },
  {
    canonical: 'vitamin_b12',
    patterns: ['vitamin b12, serum', 'vitamin b12', 'b12', 'cobalamin', 'cyanocobalamin', 'vit b12'],
    commonUnits: ['pg/mL', 'pmol/L', 'pg/ml'],
  },
  {
    canonical: 'folate',
    patterns: ['folate, serum', 'folate', 'folic acid', 'rbc folate', 'folate rbc', 'vitamin b9'],
    commonUnits: ['ng/mL', 'nmol/L', 'ng/ml'],
  },
  {
    canonical: 'magnesium',
    patterns: ['magnesium, serum', 'magnesium', 'rbc magnesium', 'magnesium rbc', 'serum magnesium', 'mg rbc'],
    commonUnits: ['mg/dL', 'mEq/L', 'mg/dl', 'mmol/L'],
  },
  {
    canonical: 'wbc',
    patterns: ['wbc', 'white blood cell count', 'white blood cells', 'leukocytes', 'wbc count', 'white blood count'],
    commonUnits: ['x10E3/uL', 'K/uL', '10^3/uL', 'x10^3/uL', 'thou/uL', 'K/µL'],
  },
  {
    canonical: 'rbc',
    patterns: ['rbc', 'red blood cell count', 'red blood cells', 'erythrocytes', 'rbc count', 'red blood count'],
    commonUnits: ['x10E6/uL', 'M/uL', '10^6/uL', 'x10^6/uL', 'mill/uL', 'M/µL'],
  },
  {
    canonical: 'hemoglobin',
    patterns: ['hemoglobin', 'haemoglobin', 'hgb', 'hb'],
    commonUnits: ['g/dL', 'g/dl', 'g/L'],
  },
  {
    canonical: 'hematocrit',
    patterns: ['hematocrit', 'haematocrit', 'hct', 'packed cell volume', 'pcv'],
    commonUnits: ['%'],
  },
  {
    canonical: 'mcv',
    patterns: ['mcv', 'mean corpuscular volume', 'mean cell volume'],
    commonUnits: ['fL', 'fl'],
  },
  {
    canonical: 'mch',
    patterns: ['mch', 'mean corpuscular hemoglobin', 'mean cell hemoglobin'],
    commonUnits: ['pg'],
  },
  {
    canonical: 'mchc',
    patterns: ['mchc', 'mean corpuscular hemoglobin concentration', 'mean cell hemoglobin concentration'],
    commonUnits: ['g/dL', 'g/dl'],
  },
  {
    canonical: 'rdw',
    patterns: ['rdw', 'rdw-cv', 'red cell distribution width', 'red blood cell distribution width'],
    commonUnits: ['%'],
  },
  {
    canonical: 'platelets',
    patterns: ['platelet count', 'platelets', 'plt', 'thrombocytes'],
    commonUnits: ['x10E3/uL', 'K/uL', '10^3/uL', 'thou/uL'],
  },
  {
    canonical: 'mpv',
    patterns: ['mpv', 'mean platelet volume'],
    commonUnits: ['fL', 'fl'],
  },
  {
    canonical: 'neutrophils_absolute',
    patterns: ['absolute neutrophils', 'neutrophils absolute', 'abs neutrophils', 'neut absolute', 'abs. neutrophils', 'neutrophils (abs)', 'neut #', 'neutrophils #', 'neutrophil count'],
    commonUnits: ['cells/uL', 'cells/μL', 'x10E3/uL', 'K/uL', '10^3/uL'],
  },
  {
    canonical: 'lymphocytes_absolute',
    patterns: ['absolute lymphocytes', 'lymphocytes absolute', 'abs lymphocytes', 'lymph absolute', 'abs. lymphocytes', 'lymphocytes (abs)', 'lymph #', 'lymphocytes #', 'lymphocyte count'],
    commonUnits: ['cells/uL', 'cells/μL', 'x10E3/uL', 'K/uL', '10^3/uL'],
  },
  {
    canonical: 'monocytes_absolute',
    patterns: ['absolute monocytes', 'monocytes absolute', 'abs monocytes', 'mono absolute', 'abs. monocytes', 'monocytes (abs)', 'mono #', 'monocytes #', 'monocyte count'],
    commonUnits: ['cells/uL', 'cells/μL', 'x10E3/uL', 'K/uL', '10^3/uL'],
  },
  {
    canonical: 'eosinophils_absolute',
    patterns: ['absolute eosinophils', 'eosinophils absolute', 'abs eosinophils', 'eos absolute', 'abs. eosinophils', 'eosinophils (abs)', 'eos #', 'eosinophils #', 'eosinophil count'],
    commonUnits: ['cells/uL', 'cells/μL', 'x10E3/uL', 'K/uL', '10^3/uL'],
  },
  {
    canonical: 'basophils_absolute',
    patterns: ['absolute basophils', 'basophils absolute', 'abs basophils', 'baso absolute', 'abs. basophils', 'basophils (abs)', 'baso #', 'basophils #', 'basophil count'],
    commonUnits: ['cells/uL', 'cells/μL', 'x10E3/uL', 'K/uL', '10^3/uL'],
  },
  {
    canonical: 'neutrophils',
    patterns: ['neutrophils %', 'neutrophils (%)', 'neutrophils percent', 'neut %', 'neutrophil %', 'neutrophils pct', 'neutrophils'],
    commonUnits: ['%'],
  },
  {
    canonical: 'lymphocytes',
    patterns: ['lymphocytes %', 'lymphocytes (%)', 'lymphocytes percent', 'lymph %', 'lymphocytes pct', 'lymphocytes', 'lymphs'],
    commonUnits: ['%'],
  },
  {
    canonical: 'monocytes',
    patterns: ['monocytes %', 'monocytes (%)', 'monocytes percent', 'mono %', 'monocytes pct', 'monocytes'],
    commonUnits: ['%'],
  },
  {
    canonical: 'eosinophils',
    patterns: ['eosinophils %', 'eosinophils (%)', 'eosinophils percent', 'eos %', 'eosinophils pct', 'eosinophils'],
    commonUnits: ['%'],
  },
  {
    canonical: 'basophils',
    patterns: ['basophils %', 'basophils (%)', 'basophils percent', 'baso %', 'basophils pct', 'basophils'],
    commonUnits: ['%'],
  },
  {
    canonical: 'rheumatoid_factor',
    patterns: ['rheumatoid factor (rf)', 'rheumatoid factor', 'rf'],
    commonUnits: ['IU/mL', 'IU/ml', 'iu/ml', 'U/mL'],
  },
  {
    // Qualitative-only marker. Not in CORE_SLUGS — saved as extended via the
    // value_text/qualitative pipeline. Aliases longest-first for the matcher.
    canonical: 'ana_screen',
    patterns: ['antinuclear antibodies', 'antinuclear antibody', 'ana screen, ifa', 'ana screen ifa', 'ana screen', 'ana ifa', 'ana'],
    commonUnits: [''],
  },
  {
    canonical: 'sodium',
    patterns: ['sodium', 'na', 'sodium, serum', 'serum sodium', 'na+'],
    commonUnits: ['mmol/L', 'mEq/L', 'meq/l'],
  },
  {
    canonical: 'potassium',
    patterns: ['potassium', 'k', 'potassium, serum', 'serum potassium', 'k+'],
    commonUnits: ['mmol/L', 'mEq/L', 'meq/l'],
  },
  {
    canonical: 'chloride',
    patterns: ['chloride', 'cl', 'chloride, serum', 'serum chloride'],
    commonUnits: ['mmol/L', 'mEq/L', 'meq/l'],
  },
  {
    canonical: 'co2',
    patterns: ['co2', 'carbon dioxide', 'total co2', 'bicarbonate', 'bicarb', 'hco3', 'co2, total'],
    commonUnits: ['mmol/L', 'mEq/L', 'meq/l'],
  },
  {
    canonical: 'calcium',
    patterns: ['calcium', 'ca', 'calcium, serum', 'serum calcium', 'total calcium'],
    commonUnits: ['mg/dL', 'mmol/L', 'mg/dl'],
  },
  {
    canonical: 'total_protein',
    patterns: ['total protein', 'protein, total', 'serum protein', 'protein total'],
    commonUnits: ['g/dL', 'g/L', 'g/dl'],
  },
  {
    canonical: 'albumin',
    patterns: ['albumin', 'albumin, serum', 'serum albumin'],
    commonUnits: ['g/dL', 'g/L', 'g/dl'],
  },
  {
    canonical: 'globulin',
    patterns: ['globulin', 'globulin, total', 'total globulin', 'globulin (calc)'],
    commonUnits: ['g/dL', 'g/L', 'g/dl'],
  },
  {
    canonical: 'albumin_globulin_ratio',
    patterns: ['albumin/globulin ratio', 'a/g ratio', 'a:g ratio', 'ag ratio', 'albumin globulin ratio'],
    commonUnits: ['ratio', ''],
  },
  {
    canonical: 'bun_creatinine_ratio',
    patterns: ['bun/creatinine ratio', 'bun/creat ratio', 'urea/creat ratio', 'bun:creatinine', 'bun creatinine ratio', 'bun/creatinine', 'blood urea nitrogen/creatinine ratio', 'bun/creat', 'bun / creatinine'],
    commonUnits: ['ratio', ''],
  },
  {
    canonical: 't3_uptake',
    patterns: ['t3 uptake', 't-3 uptake', 't3 resin uptake', 't3ru', 'triiodothyronine uptake'],
    commonUnits: ['%'],
  },
  {
    canonical: 'total_t3',
    patterns: ['t3 total', 'total t3', 't3, total', 'triiodothyronine total', 'triiodothyronine, total'],
    commonUnits: ['ng/dL', 'nmol/L', 'ng/dl', 'pg/mL'],
  },
  {
    canonical: 'serum_iron',
    patterns: ['iron, serum', 'serum iron', 'iron total', 'iron'],
    commonUnits: ['mcg/dL', 'ug/dL', 'umol/L', 'mcg/dl'],
  },
  {
    canonical: 'tibc',
    patterns: ['tibc', 'total iron binding capacity', 'iron binding capacity', 'iron-binding capacity'],
    commonUnits: ['mcg/dL', 'ug/dL', 'umol/L'],
  },
  {
    canonical: 'uibc',
    patterns: ['uibc', 'unsaturated iron binding capacity', 'unsaturated iron-binding capacity'],
    commonUnits: ['mcg/dL', 'ug/dL', 'umol/L'],
  },
];

export const CATALOG_SLUG_ALIASES: Record<string, string> = {
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
  ag_ratio: 'albumin_globulin_ratio',
};

export function normalizeToCatalogSlug(slug: string): string {
  return CATALOG_SLUG_ALIASES[slug] ?? slug;
}

export const CORE_SLUGS = new Set([
  'estradiol', 'progesterone', 'lh', 'fsh', 'amh', 'total_testosterone', 'free_testosterone',
  'dheas', 'prolactin', 'fasting_insulin', 'shbg',
  'tsh', 'free_t4', 'free_t3', 'total_t4', 'total_t3', 'reverse_t3', 'tpo_antibodies', 'tg_antibodies',
  't3_uptake', 'free_thyroxine_index',
  'fasting_glucose', 'hemoglobin_a1c', 'c_peptide',
  'calcium', 'sodium', 'potassium', 'chloride', 'co2',
  'total_cholesterol', 'ldl_cholesterol', 'hdl_cholesterol', 'triglycerides', 'non_hdl_cholesterol',
  'apob', 'lpa', 'chol_hdl_ratio',
  'alt', 'ast', 'ggt', 'alkaline_phosphatase', 'bilirubin_total',
  'albumin', 'globulin', 'total_protein', 'albumin_globulin_ratio',
  'creatinine', 'egfr', 'bun', 'bun_creatinine_ratio',
  'hs_crp', 'esr',
  'ferritin', 'iron_saturation', 'vitamin_d_25_oh', 'vitamin_b12', 'folate', 'magnesium',
  'serum_iron', 'tibc', 'uibc',
  'wbc', 'rbc', 'hemoglobin', 'hematocrit', 'mcv', 'mch', 'mchc', 'rdw', 'platelets', 'mpv',
  'neutrophils', 'lymphocytes', 'monocytes', 'eosinophils', 'basophils',
  'neutrophils_absolute', 'lymphocytes_absolute', 'monocytes_absolute', 'eosinophils_absolute', 'basophils_absolute',
  'rheumatoid_factor',
]);

export const CORE_CATEGORIES: Record<string, string> = {
  estradiol: 'hormones', progesterone: 'hormones', lh: 'hormones', fsh: 'hormones', amh: 'hormones',
  total_testosterone: 'hormones', free_testosterone: 'hormones', dheas: 'hormones', prolactin: 'hormones',
  fasting_insulin: 'hormones', shbg: 'hormones',
  tsh: 'thyroid', free_t4: 'thyroid', free_t3: 'thyroid', total_t4: 'thyroid', total_t3: 'thyroid',
  reverse_t3: 'thyroid', tpo_antibodies: 'thyroid', tg_antibodies: 'thyroid',
  t3_uptake: 'thyroid', free_thyroxine_index: 'thyroid',
  fasting_glucose: 'metabolic', hemoglobin_a1c: 'metabolic', c_peptide: 'metabolic',
  calcium: 'metabolic', sodium: 'metabolic', potassium: 'metabolic', chloride: 'metabolic', co2: 'metabolic',
  total_cholesterol: 'lipids', ldl_cholesterol: 'lipids', hdl_cholesterol: 'lipids', triglycerides: 'lipids',
  non_hdl_cholesterol: 'lipids', apob: 'lipids', lpa: 'lipids', chol_hdl_ratio: 'lipids',
  alt: 'liver', ast: 'liver', ggt: 'liver', alkaline_phosphatase: 'liver', bilirubin_total: 'liver',
  albumin: 'liver', globulin: 'liver', total_protein: 'liver', albumin_globulin_ratio: 'liver',
  creatinine: 'kidney', egfr: 'kidney', bun: 'kidney', bun_creatinine_ratio: 'kidney',
  hs_crp: 'inflammation', esr: 'inflammation',
  ferritin: 'nutrients', iron_saturation: 'nutrients', vitamin_d_25_oh: 'nutrients',
  vitamin_b12: 'nutrients', folate: 'nutrients', magnesium: 'nutrients',
  serum_iron: 'nutrients', tibc: 'nutrients', uibc: 'nutrients',
  wbc: 'blood', rbc: 'blood', hemoglobin: 'blood', hematocrit: 'blood', mcv: 'blood', mch: 'blood',
  mchc: 'blood', rdw: 'blood', platelets: 'blood', mpv: 'blood',
  neutrophils: 'blood', lymphocytes: 'blood', monocytes: 'blood', eosinophils: 'blood', basophils: 'blood',
  neutrophils_absolute: 'blood', lymphocytes_absolute: 'blood', monocytes_absolute: 'blood',
  eosinophils_absolute: 'blood', basophils_absolute: 'blood',
  rheumatoid_factor: 'inflammation',
};

export const PHYSIOLOGICAL_BOUNDS: Record<string, { min: number; max: number }> = {
  hdl_cholesterol:   { min: 5,     max: 200 },
  ldl_cholesterol:   { min: 10,    max: 700 },
  total_cholesterol: { min: 50,    max: 1000 },
  triglycerides:     { min: 10,    max: 5000 },
  fasting_glucose:   { min: 30,    max: 600 },
  egfr:              { min: 2,     max: 200 },
  creatinine:        { min: 0.2,   max: 30 },
  tsh:               { min: 0.001, max: 200 },
  free_t4:           { min: 0.1,   max: 10 },
  free_t3:           { min: 0.5,   max: 20 },
  hemoglobin:        { min: 3,     max: 25 },
  hematocrit:        { min: 10,    max: 70 },
  wbc:               { min: 0.5,   max: 100 },
  platelets:         { min: 10,    max: 2000 },
  alt:               { min: 1,     max: 10000 },
  ast:               { min: 1,     max: 10000 },
  bun:               { min: 1,     max: 300 },
  sodium:            { min: 100,   max: 180 },
  potassium:         { min: 1,     max: 10 },
  chloride:          { min: 70,    max: 140 },
  co2:               { min: 5,     max: 50 },
  calcium:           { min: 4,     max: 20 },
  ferritin:          { min: 1,     max: 10000 },
  vitamin_d_25_oh:   { min: 1,     max: 300 },
  vitamin_b12:       { min: 50,    max: 5000 },
  hemoglobin_a1c:    { min: 2,     max: 20 },
};
