export interface ComparatorRange {
  operator: '<' | '<=' | '>' | '>=' | '> OR =' | '< OR =';
  value: number;
  raw: string;
}

export interface ExtractedBiomarker {
  name: string;
  value: number;
  rawValue?: string;
  unit: string | null;
  reference_min?: number;
  reference_max?: number;
  reference_comparator?: ComparatorRange;
  reference_text_raw?: string;
  confidence: 'high' | 'medium' | 'low';
  rawText?: string;
  debugInfo?: ParserDebugInfo;
}

export interface ReportItem {
  raw_name: string;
  canonical_slug: string | null;
  category: string | null;
  value_numeric: number;
  value_text: string | null;
  unit: string | null;
  raw_reference_range: string | null;
  normalized_reference_min: number | null;
  normalized_reference_max: number | null;
  reference_operator: string | null;
  reference_operator_value: number | null;
  confidence_score: 'high' | 'medium' | 'low';
  is_core_biomarker: boolean;
  needs_review: boolean;
  source_snippet: string | null;
}

export interface ParserDebugInfo {
  matchedLabel: string;
  chosenValue: number;
  chosenUnit: string | null;
  referenceRangeText: string | null;
  sourceSnippet: string;
  rejectionReason?: string;
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
    patterns: ['testosterone, total, ms', 'testosterone, total', 'total testosterone', 'testosterone total', 'testosterone serum', 'testosterone,total'],
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
    canonical: 'free_t4',
    patterns: ['t4, free', 'free t4', 'free thyroxine', 't4 free', 'ft4', 'free t 4', 't4,free'],
    commonUnits: ['ng/dL', 'pmol/L', 'ng/dl', 'ug/dl', 'μg/dL'],
  },
  {
    canonical: 'free_t3',
    patterns: ['t3, free', 'free t3', 'free triiodothyronine', 't3 free', 'ft3', 'free t 3', 't3,free'],
    commonUnits: ['pg/mL', 'pmol/L', 'pg/ml'],
  },
  {
    canonical: 'total_t4',
    patterns: [
      'total t4', 't4 total', 't4, total', 'thyroxine total', 'thyroxine, total',
      't4 (thyroxine)', 'thyroxine (t4)', 't4, serum', 'serum t4',
    ],
    commonUnits: ['mcg/dL', 'ug/dL', 'nmol/L'],
  },
  {
    canonical: 'reverse_t3',
    patterns: ['reverse t3', 'rt3', 'reverse triiodothyronine', 'reverse-t3'],
    commonUnits: ['ng/dL', 'pmol/L', 'ng/dl'],
  },
  {
    canonical: 'tpo_antibodies',
    patterns: [
      'thyroid peroxidase antibodies', 'thyroid peroxidase (tpo) ab', 'thyroid peroxidase (tpo) antibody',
      'thyroid peroxidase antibody', 'tpo antibodies', 'tpo antibody', 'anti-tpo', 'tpo ab', 'tpo ab igg',
      'antithyroid peroxidase', 'thyroid peroxidase ab', 'tpo (thyroid peroxidase antibody)',
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
    patterns: ['non-hdl cholesterol', 'non hdl cholesterol', 'non-hdl chol'],
    commonUnits: ['mg/dL', 'mmol/L', 'mg/dl'],
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
    patterns: ['bilirubin, total', 'total bilirubin', 'bilirubin total', 'tbili', 'bilirubin,total'],
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
    patterns: ['vitamin d, 25-hydroxy', 'vitamin d, 25-oh', '25-hydroxy vitamin d', '25-oh vitamin d', 'vit d', '25(oh)d', '25 hydroxy', 'cholecalciferol', 'vitamin d (25-oh)', '25-hydroxyvitamin d'],
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

  // ─── CBC ──────────────────────────────────────────────────────────────────
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
    canonical: 'neutrophils',
    patterns: ['neutrophils', 'neutrophils (%)', 'neut %', 'neutrophil %', 'neutrophils absolute', 'neutrophils (abs)', 'abs. neutrophils', 'absolute neutrophils'],
    commonUnits: ['%', 'x10E3/uL', 'K/uL'],
  },
  {
    canonical: 'lymphocytes',
    patterns: ['lymphocytes', 'lymphs', 'lymphocytes (%)', 'lymph %', 'lymphocytes (abs)', 'absolute lymphocytes'],
    commonUnits: ['%', 'x10E3/uL', 'K/uL'],
  },
  {
    canonical: 'monocytes',
    patterns: ['monocytes', 'mono %', 'monocytes (%)', 'monocytes (abs)', 'absolute monocytes'],
    commonUnits: ['%', 'x10E3/uL', 'K/uL'],
  },
  {
    canonical: 'eosinophils',
    patterns: ['eosinophils', 'eos %', 'eosinophils (%)', 'eosinophils (abs)', 'absolute eosinophils'],
    commonUnits: ['%', 'x10E3/uL', 'K/uL'],
  },
  {
    canonical: 'basophils',
    patterns: ['basophils', 'baso %', 'basophils (%)', 'basophils (abs)', 'absolute basophils'],
    commonUnits: ['%', 'x10E3/uL', 'K/uL'],
  },

  // ─── CMP / BMP electrolytes & proteins ───────────────────────────────────
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
    canonical: 'ag_ratio',
    patterns: ['a/g ratio', 'albumin/globulin ratio', 'a:g ratio', 'ag ratio'],
    commonUnits: ['ratio', ''],
  },
  {
    canonical: 'bun_creatinine_ratio',
    patterns: ['bun/creatinine ratio', 'bun/creat ratio', 'urea/creat ratio', 'bun:creatinine'],
    commonUnits: ['ratio', ''],
  },

  // ─── Thyroid extras ───────────────────────────────────────────────────────
  {
    canonical: 't3_uptake',
    patterns: ['t3 uptake', 't-3 uptake', 't3 resin uptake', 't3ru', 'triiodothyronine uptake'],
    commonUnits: ['%'],
  },
  {
    canonical: 'free_thyroxine_index',
    patterns: ['free thyroxine index', 'fti', 't7', 't4 free index'],
    commonUnits: [''],
  },
  {
    canonical: 'total_t3',
    patterns: ['t3 total', 'total t3', 't3, total', 'triiodothyronine total', 'triiodothyronine, total'],
    commonUnits: ['ng/dL', 'nmol/L', 'ng/dl', 'pg/mL'],
  },

  // ─── Iron panel extras ────────────────────────────────────────────────────
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

// ─── Lines that look like chart axes, date stamps, or footer noise ────────────

const NOISE_LINE_RE = /^(?:\d{1,2}\/\d{1,2}\/\d{2,4}|page\s+\d|copyright|\d{4}-\d{4}|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i;
const CHART_AXIS_RE = /^\d+\.?\d*\s*$/;

function isNoiseLine(line: string): boolean {
  const t = line.trim();
  return NOISE_LINE_RE.test(t) || CHART_AXIS_RE.test(t);
}

// ─── Comparator reference range detection ───────────────────────────────────

function detectComparatorRange(text: string): ComparatorRange | null {
  const patterns: Array<{ re: RegExp; op: ComparatorRange['operator'] }> = [
    { re: />\s*or\s*=\s*(\d+\.?\d*)/i,   op: '> OR =' },
    { re: /<\s*or\s*=\s*(\d+\.?\d*)/i,   op: '< OR =' },
    { re: />=\s*(\d+\.?\d*)/,             op: '>=' },
    { re: /<=\s*(\d+\.?\d*)/,             op: '<=' },
    { re: />\s*(\d+\.?\d*)/,              op: '>' },
    { re: /<\s*(\d+\.?\d*)/,              op: '<' },
  ];

  for (const { re, op } of patterns) {
    const m = text.match(re);
    if (m) {
      return { operator: op, value: parseFloat(m[1]), raw: m[0].replace(/\s+/g, ' ').trim() };
    }
  }
  return null;
}

interface RangeResult {
  min?: number;
  max?: number;
  comparator?: ComparatorRange;
  raw: string;
}

function detectReferenceRange(text: string): RangeResult | null {
  const minMaxRe = [
    /(\d+\.?\d*)\s*[-–—]\s*(\d+\.?\d*)/,
    /(\d+\.?\d*)\s+to\s+(\d+\.?\d*)/i,
  ];
  for (const rp of minMaxRe) {
    const m = text.match(rp);
    if (m) {
      const min = parseFloat(m[1]);
      const max = parseFloat(m[2]);
      if (!isNaN(min) && !isNaN(max) && min < max) {
        return { min, max, raw: m[0] };
      }
    }
  }

  const comp = detectComparatorRange(text);
  if (comp) return { comparator: comp, raw: comp.raw };

  return null;
}

// ─── Value prefix (<X, >X) parsing ──────────────────────────────────────────

function parseValueWithPrefix(text: string): { value: number; rawValue: string } | null {
  const ltMatch = text.match(/^<\s*(\d+\.?\d*)/);
  if (ltMatch) {
    return { value: parseFloat(ltMatch[1]) * 0.5, rawValue: `<${ltMatch[1]}` };
  }
  const gtMatch = text.match(/^>\s*(\d+\.?\d*)/);
  if (gtMatch) {
    return { value: parseFloat(gtMatch[1]), rawValue: `>${gtMatch[1]}` };
  }
  const numMatch = text.match(/(\d+\.?\d*)/);
  if (numMatch) {
    return { value: parseFloat(numMatch[1]), rawValue: numMatch[1] };
  }
  return null;
}

// ─── Layer 1: Split into clean, non-noise lines ──────────────────────────────

function splitIntoLines(text: string): string[] {
  return text.split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l.length > 0 && !isNoiseLine(l));
}

// ─── Layer 2: Section header detection ──────────────────────────────────────

const SECTION_HEADERS = [
  'lipid panel', 'lipids', 'lipid',
  'comprehensive metabolic', 'cmp', 'basic metabolic', 'bmp',
  'complete blood count', 'cbc',
  'thyroid', 'thyroid panel', 'thyroid function',
  'hormone', 'hormones', 'reproductive hormones', 'sex hormones',
  'liver', 'hepatic', 'liver function',
  'kidney', 'renal', 'renal function',
  'inflammation', 'inflammatory markers',
  'nutrients', 'nutritional', 'vitamins', 'minerals',
  'iron studies', 'iron panel',
  'diabetes', 'glucose metabolism',
  'cardiovascular',
];

function isSectionHeader(line: string): boolean {
  const lower = line.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
  return SECTION_HEADERS.some(h => lower === h || lower.startsWith(h + ' ') || lower.endsWith(' ' + h));
}

// ─── Layer 3: Biomarker label matching ──────────────────────────────────────

function matchBiomarkerLabel(line: string): BiomarkerPattern | null {
  const lineLower = line.toLowerCase().trim();
  for (const bp of BIOMARKER_PATTERNS) {
    const sortedPatterns = [...bp.patterns].sort((a, b) => b.length - a.length);
    for (const p of sortedPatterns) {
      if (lineLower === p || lineLower.startsWith(p + ' ') || lineLower.startsWith(p + ',')) {
        return bp;
      }
      if (lineLower.includes(p) && p.length > 5) {
        return bp;
      }
    }
  }
  return null;
}

// ─── Layer 4: Unit detection ─────────────────────────────────────────────────

const KNOWN_UNITS = [
  'pg/mL', 'pg/ml', 'ng/mL', 'ng/ml', 'ng/dL', 'ng/dl',
  'mcg/dL', 'mcg/dl', 'ug/dL', 'ug/dl',
  'nmol/L', 'nmol/l', 'pmol/L', 'pmol/l', 'mmol/L', 'mmol/l',
  'mIU/mL', 'miu/ml', 'mIU/L', 'miu/l', 'IU/mL', 'iu/ml', 'IU/L', 'iu/l',
  'uIU/mL', 'uiu/ml', 'mcIU/mL', 'mcu/ml',
  'mg/dL', 'mg/dl', 'mg/L', 'mg/l',
  'U/L', 'u/l', 'IU/mL', 'iu/ml', 'kIU/L', 'kiu/l',
  'mL/min/1.73m2', 'ml/min/1.73m2', 'mL/min', 'ml/min',
  'mm/h', 'mm/hr',
  'g/dL', 'g/dl', 'g/L', 'g/l',
  'fL', 'fl', 'pg',
  'x10E3/uL', 'x10E6/uL', 'K/uL', 'M/uL',
  '%',
  'mEq/L', 'meq/l',
];

function detectUnit(text: string): string | null {
  for (const u of KNOWN_UNITS) {
    const escaped = u.replace(/[/()[\].+*?^${}|\\]/g, '\\$&');
    if (new RegExp('\\b' + escaped + '\\b', 'i').test(text)) {
      return u;
    }
  }
  return null;
}

// ─── Layer 5: Value extraction from lookahead window ────────────────────────
//
// Strategy:
//   1. Strip noise lines from the window before parsing.
//   2. Look for a value token on the FIRST non-label line (closest to label).
//   3. Prefer the first numeric token that is NOT part of the reference range.
//   4. A value token on the label line itself is also accepted.

interface ParsedResult {
  value: number;
  rawValue?: string;
  unit: string | null;
  referenceResult?: RangeResult;
}

function extractValueFromWindow(lines: string[], preferredUnits: string[]): ParsedResult | null {
  const cleanLines = lines.filter(l => !isNoiseLine(l));
  if (cleanLines.length === 0) return null;

  const windowText = cleanLines.join(' ');
  const unit = detectUnit(windowText) ?? preferredUnits[0] ?? null;
  const referenceResult = detectReferenceRange(windowText) ?? undefined;

  const prefixRe = /(?:^|\s)(<\s*\d+\.?\d*|>\s*\d+\.?\d*)/;
  const prefixMatch = windowText.match(prefixRe);
  if (prefixMatch) {
    const parsed = parseValueWithPrefix(prefixMatch[1].trim());
    if (parsed) {
      return { value: parsed.value, rawValue: parsed.rawValue, unit, referenceResult };
    }
  }

  const knownRangeNumbers = new Set<string>();
  if (referenceResult?.min !== undefined) knownRangeNumbers.add(String(referenceResult.min));
  if (referenceResult?.max !== undefined) knownRangeNumbers.add(String(referenceResult.max));
  if (referenceResult?.comparator) knownRangeNumbers.add(String(referenceResult.comparator.value));

  for (const line of cleanLines) {
    const tokens = line.match(/\d+\.?\d*/g) ?? [];
    for (const tok of tokens) {
      if (knownRangeNumbers.has(tok)) continue;
      const v = parseFloat(tok);
      if (v >= 0 && v <= 100000) {
        return { value: v, rawValue: tok, unit, referenceResult };
      }
    }
  }

  return null;
}

// ─── Layer 6: Main layered parse ────────────────────────────────────────────

function layeredParse(text: string, debug = false): ExtractedBiomarker[] {
  const lines = splitIntoLines(text);
  const results = new Map<string, ExtractedBiomarker>();
  const debugLog: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (isSectionHeader(line)) continue;

    const bp = matchBiomarkerLabel(line);
    if (!bp) continue;

    const windowSize = 4;
    const windowLines = lines.slice(i, Math.min(i + windowSize, lines.length));
    const parsed = extractValueFromWindow(windowLines, bp.commonUnits);

    const canonical = normalizeToCatalogSlug(bp.canonical);
    const snippetText = windowLines.join(' ').substring(0, 150);

    if (!parsed) {
      if (debug) debugLog.push(`[MISS] ${canonical} | label="${line}" | no value found in window: "${snippetText}"`);
      continue;
    }

    if (parsed.value < 0 || parsed.value > 100000) {
      if (debug) debugLog.push(`[REJECT] ${canonical} | value=${parsed.value} out of bounds`);
      continue;
    }

    const ref = parsed.referenceResult;
    const hasMinMax = ref?.min !== undefined && ref?.max !== undefined;
    const hasComparator = !!ref?.comparator;

    const confidence: 'high' | 'medium' | 'low' =
      (hasMinMax || hasComparator) && parsed.unit
        ? 'high'
        : parsed.unit
        ? 'medium'
        : 'low';

    const debugInfo: ParserDebugInfo | undefined = debug ? {
      matchedLabel: line,
      chosenValue: parsed.value,
      chosenUnit: parsed.unit,
      referenceRangeText: ref?.raw ?? null,
      sourceSnippet: snippetText,
    } : undefined;

    const existing = results.get(canonical);
    if (!existing || confidenceRank(confidence) > confidenceRank(existing.confidence)) {
      results.set(canonical, {
        name: canonical,
        value: parsed.value,
        rawValue: parsed.rawValue,
        unit: parsed.unit,
        reference_min: ref?.min,
        reference_max: ref?.max,
        reference_comparator: ref?.comparator,
        reference_text_raw: ref?.raw,
        confidence,
        rawText: snippetText,
        debugInfo,
      });

      if (debug) {
        debugLog.push(
          `[MATCH] ${canonical} | label="${line}" | value=${parsed.value} | unit=${parsed.unit} | ref="${ref?.raw ?? 'none'}" | conf=${confidence}`
        );
      }
    }
  }

  if (debug && debugLog.length > 0) {
    console.group('[BiomarkerParser] layeredParse debug');
    debugLog.forEach(l => console.log(l));
    console.groupEnd();
  }

  return Array.from(results.values());
}

function confidenceRank(c: 'high' | 'medium' | 'low'): number {
  return c === 'high' ? 2 : c === 'medium' ? 1 : 0;
}

// ─── Flat-scan fallback ──────────────────────────────────────────────────────

export function parseBiomarkersFromText(text: string, debug = false): ExtractedBiomarker[] {
  const layeredResults = layeredParse(text, debug);
  if (layeredResults.length > 0) {
    return layeredResults;
  }

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

          const existingIndex = extractedBiomarkers.findIndex(b => b.name === extracted.name);
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
  let referenceComparator: ComparatorRange | undefined;
  let referenceTextRaw: string | undefined;
  let confidence: 'high' | 'medium' | 'low' = 'low';

  const unitMatch = commonUnits.find(u => {
    const escapedUnit = u.toLowerCase().replace(/[/()[\].+*?^${}|\\]/g, '\\$&');
    return new RegExp(escapedUnit, 'i').test(contextText);
  });
  unit = unitMatch ?? commonUnits[0];
  if (unitMatch) confidence = 'medium';

  const ref = detectReferenceRange(contextText);
  if (ref) {
    referenceMin = ref.min;
    referenceMax = ref.max;
    referenceComparator = ref.comparator;
    referenceTextRaw = ref.raw;
  }

  const prefixRe = /<\s*(\d+\.?\d*)|>\s*(\d+\.?\d*)/;
  const prefixMatch = contextText.match(prefixRe);

  if (prefixMatch) {
    const parsed = parseValueWithPrefix(prefixMatch[0]);
    if (parsed) {
      value = parsed.value;
      rawValue = parsed.rawValue;
      confidence = ref ? 'high' : 'medium';
    }
  } else {
    const numberPattern = /(\d+\.?\d*)/g;
    const numbers = [...contextText.matchAll(numberPattern)].map(m => parseFloat(m[1]));

    if (numbers.length === 0) return null;

    const knownRangeNums = new Set<number>();
    if (referenceMin !== undefined) knownRangeNums.add(referenceMin);
    if (referenceMax !== undefined) knownRangeNums.add(referenceMax);
    if (referenceComparator) knownRangeNums.add(referenceComparator.value);

    if (ref) {
      confidence = 'high';
      const outside = numbers.filter(n => !knownRangeNums.has(n));
      value = outside.length > 0 ? outside[0] : numbers[0];
    } else if (numbers.length === 1) {
      value = numbers[0];
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
    reference_comparator: referenceComparator,
    reference_text_raw: referenceTextRaw,
    confidence,
    rawText: contextText.substring(0, 100),
  };
}

// ─── Validate: keep no-unit entries at low confidence instead of dropping ────

export function validateExtractedBiomarkers(
  biomarkers: ExtractedBiomarker[]
): ExtractedBiomarker[] {
  return biomarkers
    .filter(b => {
      if (b.value === undefined || b.value === null) return false;
      if (b.value < 0) return false;
      if (b.reference_min !== undefined && b.reference_max !== undefined) {
        if (b.reference_min >= b.reference_max) return false;
      }
      return true;
    })
    .map(b => {
      if (!b.unit) {
        return { ...b, confidence: 'low' as const };
      }
      return b;
    });
}

export function getCatalogSlug(legacyName: string): string {
  return normalizeToCatalogSlug(legacyName);
}

// ─── Core biomarker metadata for ReportItem conversion ───────────────────────

const CORE_SLUGS = new Set([
  'estradiol','progesterone','lh','fsh','amh','total_testosterone','free_testosterone',
  'dheas','prolactin','fasting_insulin','shbg',
  'tsh','free_t4','free_t3','total_t4','reverse_t3','tpo_antibodies','tg_antibodies',
  'fasting_glucose','hemoglobin_a1c','c_peptide',
  'total_cholesterol','ldl_cholesterol','hdl_cholesterol','triglycerides','non_hdl_cholesterol','apob','lpa',
  'alt','ast','ggt','alkaline_phosphatase','bilirubin_total',
  'creatinine','egfr','bun',
  'hs_crp','esr',
  'ferritin','iron_saturation','vitamin_d_25_oh','vitamin_b12','folate','magnesium',
]);

const CORE_CATEGORIES: Record<string, string> = {
  estradiol:'hormones',progesterone:'hormones',lh:'hormones',fsh:'hormones',amh:'hormones',
  total_testosterone:'hormones',free_testosterone:'hormones',dheas:'hormones',prolactin:'hormones',
  fasting_insulin:'hormones',shbg:'hormones',
  tsh:'thyroid',free_t4:'thyroid',free_t3:'thyroid',total_t4:'thyroid',reverse_t3:'thyroid',
  tpo_antibodies:'thyroid',tg_antibodies:'thyroid',
  fasting_glucose:'metabolic',hemoglobin_a1c:'metabolic',c_peptide:'metabolic',
  total_cholesterol:'lipids',ldl_cholesterol:'lipids',hdl_cholesterol:'lipids',triglycerides:'lipids',
  non_hdl_cholesterol:'lipids',apob:'lipids',lpa:'lipids',
  alt:'liver',ast:'liver',ggt:'liver',alkaline_phosphatase:'liver',bilirubin_total:'liver',
  creatinine:'kidney',egfr:'kidney',bun:'kidney',
  hs_crp:'inflammation',esr:'inflammation',
  ferritin:'nutrients',iron_saturation:'nutrients',vitamin_d_25_oh:'nutrients',
  vitamin_b12:'nutrients',folate:'nutrients',magnesium:'nutrients',
};

export function convertExtractedToReportItems(extracted: ExtractedBiomarker[]): ReportItem[] {
  return extracted.map(b => {
    const slug = b.name;
    const isCore = CORE_SLUGS.has(slug);
    const ref = b.reference_comparator;
    return {
      raw_name: b.name,
      canonical_slug: isCore ? slug : null,
      category: isCore ? (CORE_CATEGORIES[slug] ?? null) : null,
      value_numeric: b.value,
      value_text: b.rawValue ?? null,
      unit: b.unit,
      raw_reference_range: b.reference_text_raw ?? null,
      normalized_reference_min: b.reference_min ?? null,
      normalized_reference_max: b.reference_max ?? null,
      reference_operator: ref?.operator ?? null,
      reference_operator_value: ref?.value ?? null,
      confidence_score: b.confidence,
      is_core_biomarker: isCore,
      needs_review: b.confidence === 'low' || !b.unit,
      source_snippet: b.rawText ?? null,
    };
  });
}

// ─── Generic line-based extractor for non-core items ─────────────────────────
//
// Runs after the core parser and captures any remaining lines that look like
// "Label    Value   Unit   Reference" but didn't match the core pattern list.

const SKIP_LINES_RE = /^(?:test|result|reference|range|units?|flag|status|notes?|comments?|physician|patient|dob|date|page|lab\s|quest\s|labcorp)/i;
const LABEL_VALUE_RE = /^([A-Za-z][A-Za-z0-9,.()\-/%\s]{2,50}?)\s{2,}(<?>\s*\d+\.?\d*|>=?\s*\d+\.?\d*|<=?\s*\d+\.?\d*|\d+\.?\d*)(?:\s+([a-zA-Z%/]+[0-9]?))?/;

export function parseAllReportItems(text: string, debug = false): ReportItem[] {
  const coreExtracted = parseBiomarkersFromText(text, debug);
  const coreItems = convertExtractedToReportItems(coreExtracted);
  const coreRawNames = new Set(coreItems.map(i => i.raw_name.toLowerCase()));

  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
  const extendedItems: ReportItem[] = [];

  for (const line of lines) {
    if (SKIP_LINES_RE.test(line)) continue;
    if (line.length > 120) continue;

    const m = line.match(LABEL_VALUE_RE);
    if (!m) continue;

    const rawName = m[1].trim();
    const rawValueStr = m[2].trim();
    const rawUnit = m[3]?.trim() ?? null;

    if (coreRawNames.has(rawName.toLowerCase())) continue;
    if (rawName.split(' ').length > 8) continue;

    let valueNumeric: number;
    let valueText: string | null = null;

    if (/^</.test(rawValueStr)) {
      const n = parseFloat(rawValueStr.replace(/[^0-9.]/g, ''));
      if (isNaN(n)) continue;
      valueNumeric = n * 0.5;
      valueText = rawValueStr;
    } else if (/^>/.test(rawValueStr)) {
      const n = parseFloat(rawValueStr.replace(/[^0-9.]/g, ''));
      if (isNaN(n)) continue;
      valueNumeric = n;
      valueText = rawValueStr;
    } else {
      valueNumeric = parseFloat(rawValueStr);
      if (isNaN(valueNumeric)) continue;
    }

    if (valueNumeric < 0 || valueNumeric > 100000) continue;

    const ref = detectReferenceRange(line);
    const confidence: 'high' | 'medium' | 'low' =
      rawUnit && ref ? 'high' : rawUnit ? 'medium' : 'low';

    extendedItems.push({
      raw_name: rawName,
      canonical_slug: null,
      category: null,
      value_numeric: valueNumeric,
      value_text: valueText,
      unit: rawUnit,
      raw_reference_range: ref?.raw ?? null,
      normalized_reference_min: ref?.min ?? null,
      normalized_reference_max: ref?.max ?? null,
      reference_operator: ref?.comparator?.operator ?? null,
      reference_operator_value: ref?.comparator?.value ?? null,
      confidence_score: confidence,
      is_core_biomarker: false,
      needs_review: confidence === 'low',
      source_snippet: line.substring(0, 120),
    });
  }

  return [...coreItems, ...extendedItems];
}
