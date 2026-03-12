/*
  # Seed Canonical Analytes and Synonyms

  ## Overview
  Populates the canonical analyte registry with all known lab analytes:
  - 42 core biomarkers (hormones, thyroid, metabolic, lipids, liver, kidney, inflammation, nutrients)
  - Extended analytes (CBC, CMP, ratios, iron panel, thyroid extras)
  - Includes the newly added items: ldl_cholesterol, chol_hdl_ratio, non_hdl_cholesterol,
    bun_creatinine_ratio, albumin_globulin_ratio, tpo_antibodies, rbc, rdw, mpv, t3_uptake

  ## Synonym Coverage
  Quest and Labcorp label synonyms for all analytes, enabling full-label matching
  to prevent confusion (e.g., T3 Uptake vs Free T3, LDL vs Total Cholesterol).
*/

-- CORE BIOMARKERS: Hormones
INSERT INTO canonical_analytes (slug, display_name, category, subcategory, unit, is_core, is_ratio, affects_scoring, affects_recommendations) VALUES
('estradiol', 'Estradiol (E2)', 'hormones', 'sex_hormones', 'pg/mL', true, false, true, true),
('progesterone', 'Progesterone', 'hormones', 'sex_hormones', 'ng/mL', true, false, true, true),
('lh', 'Luteinizing Hormone (LH)', 'hormones', 'gonadotropins', 'mIU/mL', true, false, true, true),
('fsh', 'Follicle Stimulating Hormone (FSH)', 'hormones', 'gonadotropins', 'mIU/mL', true, false, true, true),
('amh', 'Anti-Mullerian Hormone (AMH)', 'hormones', 'ovarian_reserve', 'ng/mL', true, false, true, true),
('total_testosterone', 'Total Testosterone', 'hormones', 'androgens', 'ng/dL', true, false, true, true),
('free_testosterone', 'Free Testosterone', 'hormones', 'androgens', 'pg/mL', true, false, true, true),
('dheas', 'DHEA-S', 'hormones', 'androgens', 'ug/dL', true, false, true, true),
('prolactin', 'Prolactin', 'hormones', 'pituitary', 'ng/mL', true, false, true, true),
('fasting_insulin', 'Fasting Insulin', 'hormones', 'pancreatic', 'uIU/mL', true, false, true, true),
('shbg', 'SHBG', 'hormones', 'binding_proteins', 'nmol/L', true, false, true, true),
-- CORE BIOMARKERS: Thyroid
('tsh', 'TSH', 'thyroid', 'thyroid', 'uIU/mL', true, false, true, true),
('free_t4', 'Free T4', 'thyroid', 'thyroid', 'ng/dL', true, false, true, true),
('free_t3', 'Free T3', 'thyroid', 'thyroid', 'pg/mL', true, false, true, true),
('total_t4', 'Total T4', 'thyroid', 'thyroid', 'ug/dL', true, false, true, true),
('reverse_t3', 'Reverse T3', 'thyroid', 'thyroid', 'ng/dL', true, false, true, true),
('tpo_antibodies', 'Thyroid Peroxidase Antibodies (TPO)', 'thyroid', 'autoimmune', 'IU/mL', true, false, true, true),
('tg_antibodies', 'Thyroglobulin Antibodies (TgAb)', 'thyroid', 'autoimmune', 'IU/mL', true, false, true, true),
-- CORE BIOMARKERS: Metabolic
('fasting_glucose', 'Fasting Glucose', 'metabolic', 'glucose', 'mg/dL', true, false, true, true),
('hemoglobin_a1c', 'Hemoglobin A1c', 'metabolic', 'glucose', '%', true, false, true, true),
('c_peptide', 'C-Peptide', 'metabolic', 'pancreatic', 'ng/mL', true, false, true, true),
-- CORE BIOMARKERS: Lipids
('total_cholesterol', 'Total Cholesterol', 'lipids', 'lipids', 'mg/dL', true, false, true, true),
('ldl_cholesterol', 'LDL Cholesterol', 'lipids', 'lipids', 'mg/dL', true, false, true, true),
('hdl_cholesterol', 'HDL Cholesterol', 'lipids', 'lipids', 'mg/dL', true, false, true, true),
('triglycerides', 'Triglycerides', 'lipids', 'lipids', 'mg/dL', true, false, true, true),
('non_hdl_cholesterol', 'Non-HDL Cholesterol', 'lipids', 'lipids', 'mg/dL', true, false, true, true),
('apob', 'ApoB', 'lipids', 'apolipoproteins', 'mg/dL', true, false, true, true),
('lpa', 'Lp(a)', 'lipids', 'apolipoproteins', 'nmol/L', true, false, true, true),
-- CORE BIOMARKERS: Liver
('alt', 'ALT', 'liver', 'enzymes', 'U/L', true, false, true, true),
('ast', 'AST', 'liver', 'enzymes', 'U/L', true, false, true, true),
('ggt', 'GGT', 'liver', 'enzymes', 'U/L', true, false, true, true),
('alkaline_phosphatase', 'Alkaline Phosphatase', 'liver', 'enzymes', 'U/L', true, false, true, true),
('bilirubin_total', 'Total Bilirubin', 'liver', 'bilirubin', 'mg/dL', true, false, true, true),
-- CORE BIOMARKERS: Kidney
('creatinine', 'Creatinine', 'kidney', 'renal', 'mg/dL', true, false, true, true),
('egfr', 'eGFR', 'kidney', 'renal', 'mL/min/1.73m2', true, false, true, true),
('bun', 'BUN', 'kidney', 'renal', 'mg/dL', true, false, true, true),
-- CORE BIOMARKERS: Inflammation
('hs_crp', 'hs-CRP', 'inflammation', 'inflammatory', 'mg/L', true, false, true, true),
('esr', 'ESR', 'inflammation', 'inflammatory', 'mm/hr', true, false, true, true),
-- CORE BIOMARKERS: Nutrients
('ferritin', 'Ferritin', 'nutrients', 'iron', 'ng/mL', true, false, true, true),
('iron_saturation', 'Iron Saturation', 'nutrients', 'iron', '%', true, false, true, true),
('vitamin_d_25_oh', 'Vitamin D (25-OH)', 'nutrients', 'vitamins', 'ng/mL', true, false, true, true),
('vitamin_b12', 'Vitamin B12', 'nutrients', 'vitamins', 'pg/mL', true, false, true, true),
('folate', 'Folate', 'nutrients', 'vitamins', 'ng/mL', true, false, true, true),
('magnesium', 'Magnesium', 'nutrients', 'minerals', 'mg/dL', true, false, true, true)
ON CONFLICT (slug) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  category = EXCLUDED.category,
  subcategory = EXCLUDED.subcategory,
  unit = EXCLUDED.unit,
  is_core = EXCLUDED.is_core,
  affects_scoring = EXCLUDED.affects_scoring,
  affects_recommendations = EXCLUDED.affects_recommendations;

-- EXTENDED ANALYTES: CBC
INSERT INTO canonical_analytes (slug, display_name, category, subcategory, unit, is_core, is_ratio, affects_scoring, affects_recommendations) VALUES
('wbc', 'WBC', 'blood', 'cbc', 'K/uL', false, false, false, true),
('rbc', 'Red Blood Cell Count', 'blood', 'cbc', 'Million/uL', false, false, false, true),
('hemoglobin', 'Hemoglobin', 'blood', 'cbc', 'g/dL', false, false, false, true),
('hematocrit', 'Hematocrit', 'blood', 'cbc', '%', false, false, false, true),
('mcv', 'MCV', 'blood', 'cbc', 'fL', false, false, false, true),
('mch', 'MCH', 'blood', 'cbc', 'pg', false, false, false, true),
('mchc', 'MCHC', 'blood', 'cbc', 'g/dL', false, false, false, true),
('rdw', 'RDW', 'blood', 'cbc', '%', false, false, false, true),
('platelets', 'Platelets', 'blood', 'cbc', 'K/uL', false, false, false, true),
('mpv', 'MPV', 'blood', 'cbc', 'fL', false, false, false, true),
('neutrophils', 'Neutrophils', 'blood', 'cbc_differential', '%', false, false, false, true),
('lymphocytes', 'Lymphocytes', 'blood', 'cbc_differential', '%', false, false, false, true),
('monocytes', 'Monocytes', 'blood', 'cbc_differential', '%', false, false, false, true),
('eosinophils', 'Eosinophils', 'blood', 'cbc_differential', '%', false, false, false, true),
('basophils', 'Basophils', 'blood', 'cbc_differential', '%', false, false, false, true),
('neutrophils_abs', 'Neutrophils (Absolute)', 'blood', 'cbc_differential', 'K/uL', false, false, false, true),
('lymphocytes_abs', 'Lymphocytes (Absolute)', 'blood', 'cbc_differential', 'K/uL', false, false, false, true),
('monocytes_abs', 'Monocytes (Absolute)', 'blood', 'cbc_differential', 'K/uL', false, false, false, true),
('eosinophils_abs', 'Eosinophils (Absolute)', 'blood', 'cbc_differential', 'K/uL', false, false, false, true),
('basophils_abs', 'Basophils (Absolute)', 'blood', 'cbc_differential', 'K/uL', false, false, false, true),
-- EXTENDED ANALYTES: CMP electrolytes & proteins
('sodium', 'Sodium', 'metabolic', 'electrolytes', 'mEq/L', false, false, false, true),
('potassium', 'Potassium', 'metabolic', 'electrolytes', 'mEq/L', false, false, false, true),
('chloride', 'Chloride', 'metabolic', 'electrolytes', 'mEq/L', false, false, false, true),
('co2', 'CO2', 'metabolic', 'electrolytes', 'mEq/L', false, false, false, true),
('calcium', 'Calcium', 'metabolic', 'electrolytes', 'mg/dL', false, false, false, true),
('total_protein', 'Total Protein', 'liver', 'proteins', 'g/dL', false, false, false, true),
('albumin', 'Albumin', 'liver', 'proteins', 'g/dL', false, false, false, true),
('globulin', 'Globulin', 'liver', 'proteins', 'g/dL', false, false, false, true),
-- EXTENDED ANALYTES: Ratios
('chol_hdl_ratio', 'Chol/HDL Ratio', 'lipids', 'lipids', 'ratio', false, true, false, true),
('bun_creatinine_ratio', 'BUN/Creatinine Ratio', 'kidney', 'renal', 'ratio', false, true, false, true),
('albumin_globulin_ratio', 'Albumin/Globulin Ratio', 'liver', 'protein_balance', 'ratio', false, true, false, true),
-- EXTENDED ANALYTES: Thyroid extras
('t3_uptake', 'T3 Uptake', 'thyroid', 'thyroid', '%', false, false, false, true),
('free_thyroxine_index', 'Free Thyroxine Index (FTI/T7)', 'thyroid', 'thyroid', '', false, false, false, true),
('total_t3', 'Total T3', 'thyroid', 'thyroid', 'ng/dL', false, false, false, true),
-- EXTENDED ANALYTES: Iron panel
('serum_iron', 'Serum Iron', 'nutrients', 'iron', 'ug/dL', false, false, false, true),
('tibc', 'TIBC', 'nutrients', 'iron', 'ug/dL', false, false, false, true),
('uibc', 'UIBC', 'nutrients', 'iron', 'ug/dL', false, false, false, true)
ON CONFLICT (slug) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  category = EXCLUDED.category,
  subcategory = EXCLUDED.subcategory,
  unit = EXCLUDED.unit,
  is_core = EXCLUDED.is_core,
  is_ratio = EXCLUDED.is_ratio,
  affects_scoring = EXCLUDED.affects_scoring,
  affects_recommendations = EXCLUDED.affects_recommendations;

-- SYNONYMS: Hormones
INSERT INTO analyte_synonyms (canonical_analyte_id, synonym_text, source_type)
SELECT id, syn, src FROM canonical_analytes
CROSS JOIN (VALUES
  ('estradiol', 'ESTRADIOL', 'quest'),
  ('estradiol', 'ESTRADIOL, SERUM', 'quest'),
  ('estradiol', 'ESTRADIOL (E2)', 'labcorp'),
  ('progesterone', 'PROGESTERONE', 'quest'),
  ('progesterone', 'PROGESTERONE, SERUM', 'quest'),
  ('lh', 'LH', 'quest'),
  ('lh', 'LUTEINIZING HORMONE (LH)', 'quest'),
  ('lh', 'LUTEINIZING HORMONE', 'labcorp'),
  ('fsh', 'FSH', 'quest'),
  ('fsh', 'FOLLICLE-STIMULATING HORMONE (FSH)', 'quest'),
  ('fsh', 'FOLLICLE STIMULATING HORMONE', 'labcorp'),
  ('amh', 'AMH', 'quest'),
  ('amh', 'ANTI-MULLERIAN HORMONE', 'quest'),
  ('amh', 'ANTI-MULLERIAN HORMONE (AMH)', 'labcorp'),
  ('total_testosterone', 'TESTOSTERONE, TOTAL', 'quest'),
  ('total_testosterone', 'TESTOSTERONE TOTAL', 'labcorp'),
  ('total_testosterone', 'TESTOSTERONE, SERUM', 'quest'),
  ('free_testosterone', 'TESTOSTERONE, FREE', 'quest'),
  ('free_testosterone', 'TESTOSTERONE FREE', 'labcorp'),
  ('dheas', 'DHEA-S', 'quest'),
  ('dheas', 'DHEA SULFATE', 'quest'),
  ('dheas', 'DEHYDROEPIANDROSTERONE SULFATE', 'labcorp'),
  ('prolactin', 'PROLACTIN', 'quest'),
  ('prolactin', 'PROLACTIN, SERUM', 'quest'),
  ('fasting_insulin', 'INSULIN', 'quest'),
  ('fasting_insulin', 'FASTING INSULIN', 'quest'),
  ('fasting_insulin', 'INSULIN, SERUM', 'labcorp'),
  ('shbg', 'SHBG', 'quest'),
  ('shbg', 'SEX HORMONE BINDING GLOBULIN', 'quest'),
  ('shbg', 'SEX HORMONE-BINDING GLOBULIN', 'labcorp')
) AS t(slug, syn, src)
WHERE canonical_analytes.slug = t.slug
ON CONFLICT (synonym_text, source_type) DO NOTHING;

-- SYNONYMS: Thyroid
INSERT INTO analyte_synonyms (canonical_analyte_id, synonym_text, source_type)
SELECT id, syn, src FROM canonical_analytes
CROSS JOIN (VALUES
  ('tsh', 'TSH', 'quest'),
  ('tsh', 'THYROID STIMULATING HORMONE', 'quest'),
  ('tsh', 'TSH, 3RD GENERATION', 'labcorp'),
  ('free_t4', 'FREE T4', 'quest'),
  ('free_t4', 'T4, FREE', 'quest'),
  ('free_t4', 'THYROXINE, FREE', 'labcorp'),
  ('free_t3', 'FREE T3', 'quest'),
  ('free_t3', 'T3, FREE', 'quest'),
  ('free_t3', 'TRIIODOTHYRONINE, FREE', 'labcorp'),
  ('total_t4', 'T4 (THYROXINE)', 'quest'),
  ('total_t4', 'THYROXINE (T4)', 'quest'),
  ('total_t4', 'T4, SERUM', 'labcorp'),
  ('total_t4', 'T4, TOTAL', 'quest'),
  ('reverse_t3', 'REVERSE T3', 'quest'),
  ('reverse_t3', 'REVERSE T3, SERUM', 'quest'),
  ('tpo_antibodies', 'TPO AB', 'quest'),
  ('tpo_antibodies', 'TPO ANTIBODY', 'quest'),
  ('tpo_antibodies', 'THYROID PEROXIDASE ANTIBODIES', 'quest'),
  ('tpo_antibodies', 'THYROID PEROXIDASE (TPO) AB', 'quest'),
  ('tpo_antibodies', 'THYROID PEROXIDASE ANTIBODY', 'labcorp'),
  ('tpo_antibodies', 'TPO (THYROID PEROXIDASE ANTIBODY)', 'quest'),
  ('tpo_antibodies', 'ANTI-TPO', 'generic'),
  ('tg_antibodies', 'TGAB', 'quest'),
  ('tg_antibodies', 'THYROGLOBULIN ANTIBODIES', 'quest'),
  ('tg_antibodies', 'THYROGLOBULIN ANTIBODY', 'labcorp'),
  ('tg_antibodies', 'ANTI-TG', 'generic'),
  ('t3_uptake', 'T3 UPTAKE', 'quest'),
  ('t3_uptake', 'T3 UPTAKE, SERUM', 'quest'),
  ('t3_uptake', 'T-UPTAKE', 'quest'),
  ('free_thyroxine_index', 'FREE THYROXINE INDEX', 'quest'),
  ('free_thyroxine_index', 'FTI', 'quest'),
  ('free_thyroxine_index', 'T7', 'quest'),
  ('total_t3', 'T3 TOTAL', 'quest'),
  ('total_t3', 'TRIIODOTHYRONINE, TOTAL', 'labcorp'),
  ('total_t3', 'T3, TOTAL', 'quest')
) AS t(slug, syn, src)
WHERE canonical_analytes.slug = t.slug
ON CONFLICT (synonym_text, source_type) DO NOTHING;

-- SYNONYMS: Metabolic & Glucose
INSERT INTO analyte_synonyms (canonical_analyte_id, synonym_text, source_type)
SELECT id, syn, src FROM canonical_analytes
CROSS JOIN (VALUES
  ('fasting_glucose', 'GLUCOSE', 'quest'),
  ('fasting_glucose', 'GLUCOSE, SERUM', 'quest'),
  ('fasting_glucose', 'FASTING GLUCOSE', 'quest'),
  ('hemoglobin_a1c', 'HEMOGLOBIN A1C', 'quest'),
  ('hemoglobin_a1c', 'HBA1C', 'quest'),
  ('hemoglobin_a1c', 'A1C', 'quest'),
  ('hemoglobin_a1c', 'GLYCOHEMOGLOBIN', 'labcorp'),
  ('c_peptide', 'C-PEPTIDE', 'quest'),
  ('c_peptide', 'C PEPTIDE', 'labcorp')
) AS t(slug, syn, src)
WHERE canonical_analytes.slug = t.slug
ON CONFLICT (synonym_text, source_type) DO NOTHING;

-- SYNONYMS: Lipids (full label matching to prevent confusion)
INSERT INTO analyte_synonyms (canonical_analyte_id, synonym_text, source_type)
SELECT id, syn, src FROM canonical_analytes
CROSS JOIN (VALUES
  ('total_cholesterol', 'CHOLESTEROL, TOTAL', 'quest'),
  ('total_cholesterol', 'TOTAL CHOLESTEROL', 'quest'),
  ('total_cholesterol', 'CHOLESTEROL', 'quest'),
  ('ldl_cholesterol', 'LDL-CHOLESTEROL', 'quest'),
  ('ldl_cholesterol', 'LDL CHOLESTEROL', 'quest'),
  ('ldl_cholesterol', 'LDL CHOL CALC', 'quest'),
  ('ldl_cholesterol', 'LDL-C', 'labcorp'),
  ('ldl_cholesterol', 'LOW DENSITY LIPOPROTEIN CHOLESTEROL', 'labcorp'),
  ('hdl_cholesterol', 'HDL CHOLESTEROL', 'quest'),
  ('hdl_cholesterol', 'HDL CHOL DIRECT', 'quest'),
  ('hdl_cholesterol', 'HDL-C', 'labcorp'),
  ('hdl_cholesterol', 'HIGH DENSITY LIPOPROTEIN CHOLESTEROL', 'labcorp'),
  ('triglycerides', 'TRIGLYCERIDES', 'quest'),
  ('triglycerides', 'TRIGLYCERIDE', 'labcorp'),
  ('non_hdl_cholesterol', 'NON HDL CHOLESTEROL', 'quest'),
  ('non_hdl_cholesterol', 'NON-HDL CHOLESTEROL', 'quest'),
  ('non_hdl_cholesterol', 'NON-HDL-C', 'labcorp'),
  ('chol_hdl_ratio', 'CHOL/HDLC RATIO', 'quest'),
  ('chol_hdl_ratio', 'CHOL/HDLC', 'quest'),
  ('chol_hdl_ratio', 'CHOLESTEROL/HDL RATIO', 'labcorp'),
  ('chol_hdl_ratio', 'CHOLESTEROL:HDL RATIO', 'generic'),
  ('apob', 'APOB', 'quest'),
  ('apob', 'APOLIPOPROTEIN B', 'quest'),
  ('lpa', 'LPA', 'quest'),
  ('lpa', 'LIPOPROTEIN (A)', 'quest'),
  ('lpa', 'LIPOPROTEIN(A)', 'labcorp')
) AS t(slug, syn, src)
WHERE canonical_analytes.slug = t.slug
ON CONFLICT (synonym_text, source_type) DO NOTHING;

-- SYNONYMS: Liver
INSERT INTO analyte_synonyms (canonical_analyte_id, synonym_text, source_type)
SELECT id, syn, src FROM canonical_analytes
CROSS JOIN (VALUES
  ('alt', 'ALT (SGPT)', 'quest'),
  ('alt', 'ALT', 'quest'),
  ('alt', 'SGPT', 'quest'),
  ('alt', 'ALANINE AMINOTRANSFERASE', 'labcorp'),
  ('ast', 'AST (SGOT)', 'quest'),
  ('ast', 'AST', 'quest'),
  ('ast', 'SGOT', 'quest'),
  ('ast', 'ASPARTATE AMINOTRANSFERASE', 'labcorp'),
  ('ggt', 'GGT', 'quest'),
  ('ggt', 'GAMMA GT', 'quest'),
  ('ggt', 'GAMMA-GLUTAMYL TRANSFERASE', 'labcorp'),
  ('alkaline_phosphatase', 'ALKALINE PHOSPHATASE', 'quest'),
  ('alkaline_phosphatase', 'ALK PHOS', 'quest'),
  ('bilirubin_total', 'BILIRUBIN, TOTAL', 'quest'),
  ('bilirubin_total', 'TOTAL BILIRUBIN', 'labcorp'),
  ('total_protein', 'PROTEIN, TOTAL', 'quest'),
  ('total_protein', 'TOTAL PROTEIN', 'labcorp'),
  ('albumin', 'ALBUMIN', 'quest'),
  ('albumin', 'ALBUMIN, SERUM', 'quest'),
  ('globulin', 'GLOBULIN', 'quest'),
  ('globulin', 'GLOBULIN, TOTAL', 'quest'),
  ('albumin_globulin_ratio', 'ALBUMIN/GLOBULIN RATIO', 'quest'),
  ('albumin_globulin_ratio', 'A/G RATIO', 'quest'),
  ('albumin_globulin_ratio', 'A:G RATIO', 'labcorp')
) AS t(slug, syn, src)
WHERE canonical_analytes.slug = t.slug
ON CONFLICT (synonym_text, source_type) DO NOTHING;

-- SYNONYMS: Kidney
INSERT INTO analyte_synonyms (canonical_analyte_id, synonym_text, source_type)
SELECT id, syn, src FROM canonical_analytes
CROSS JOIN (VALUES
  ('creatinine', 'CREATININE', 'quest'),
  ('creatinine', 'CREATININE, SERUM', 'quest'),
  ('egfr', 'EGFR', 'quest'),
  ('egfr', 'GFR ESTIMATED', 'quest'),
  ('egfr', 'GLOMERULAR FILTRATION RATE', 'labcorp'),
  ('bun', 'BUN', 'quest'),
  ('bun', 'UREA NITROGEN (BUN)', 'quest'),
  ('bun', 'BLOOD UREA NITROGEN', 'labcorp'),
  ('bun_creatinine_ratio', 'BUN/CREATININE RATIO', 'quest'),
  ('bun_creatinine_ratio', 'BUN:CREATININE RATIO', 'labcorp'),
  ('bun_creatinine_ratio', 'BUN/CREATININE', 'generic')
) AS t(slug, syn, src)
WHERE canonical_analytes.slug = t.slug
ON CONFLICT (synonym_text, source_type) DO NOTHING;

-- SYNONYMS: Inflammation
INSERT INTO analyte_synonyms (canonical_analyte_id, synonym_text, source_type)
SELECT id, syn, src FROM canonical_analytes
CROSS JOIN (VALUES
  ('hs_crp', 'HS-CRP', 'quest'),
  ('hs_crp', 'C-REACTIVE PROTEIN, CARDIAC', 'quest'),
  ('hs_crp', 'C REACTIVE PROTEIN', 'labcorp'),
  ('hs_crp', 'HIGH SENSITIVITY CRP', 'labcorp'),
  ('esr', 'ESR', 'quest'),
  ('esr', 'ERYTHROCYTE SEDIMENTATION RATE', 'quest')
) AS t(slug, syn, src)
WHERE canonical_analytes.slug = t.slug
ON CONFLICT (synonym_text, source_type) DO NOTHING;

-- SYNONYMS: Nutrients & Iron
INSERT INTO analyte_synonyms (canonical_analyte_id, synonym_text, source_type)
SELECT id, syn, src FROM canonical_analytes
CROSS JOIN (VALUES
  ('ferritin', 'FERRITIN', 'quest'),
  ('ferritin', 'FERRITIN, SERUM', 'quest'),
  ('iron_saturation', 'IRON SATURATION', 'quest'),
  ('iron_saturation', 'IRON, % SATURATION', 'quest'),
  ('iron_saturation', 'TRANSFERRIN SATURATION', 'labcorp'),
  ('vitamin_d_25_oh', 'VITAMIN D, 25-HYDROXY', 'quest'),
  ('vitamin_d_25_oh', 'VITAMIN D (25-OH)', 'quest'),
  ('vitamin_d_25_oh', '25-OH VITAMIN D', 'labcorp'),
  ('vitamin_b12', 'VITAMIN B12', 'quest'),
  ('vitamin_b12', 'VITAMIN B12, SERUM', 'quest'),
  ('vitamin_b12', 'COBALAMIN', 'labcorp'),
  ('folate', 'FOLATE', 'quest'),
  ('folate', 'FOLATE, SERUM', 'quest'),
  ('folate', 'FOLIC ACID', 'labcorp'),
  ('magnesium', 'MAGNESIUM', 'quest'),
  ('magnesium', 'MAGNESIUM, SERUM', 'quest'),
  ('serum_iron', 'IRON', 'quest'),
  ('serum_iron', 'SERUM IRON', 'quest'),
  ('serum_iron', 'IRON, SERUM', 'labcorp'),
  ('tibc', 'TIBC', 'quest'),
  ('tibc', 'TOTAL IRON BINDING CAPACITY', 'quest'),
  ('uibc', 'UIBC', 'quest'),
  ('uibc', 'UNSATURATED IRON BINDING CAPACITY', 'quest')
) AS t(slug, syn, src)
WHERE canonical_analytes.slug = t.slug
ON CONFLICT (synonym_text, source_type) DO NOTHING;

-- SYNONYMS: CBC
INSERT INTO analyte_synonyms (canonical_analyte_id, synonym_text, source_type)
SELECT id, syn, src FROM canonical_analytes
CROSS JOIN (VALUES
  ('wbc', 'WBC', 'quest'),
  ('wbc', 'WHITE BLOOD CELLS', 'quest'),
  ('wbc', 'WHITE BLOOD CELL COUNT', 'labcorp'),
  ('rbc', 'RBC', 'quest'),
  ('rbc', 'RED BLOOD CELL COUNT', 'quest'),
  ('rbc', 'RED BLOOD CELLS', 'quest'),
  ('hemoglobin', 'HEMOGLOBIN', 'quest'),
  ('hemoglobin', 'HGB', 'quest'),
  ('hemoglobin', 'HB', 'quest'),
  ('hematocrit', 'HEMATOCRIT', 'quest'),
  ('hematocrit', 'HCT', 'quest'),
  ('mcv', 'MCV', 'quest'),
  ('mch', 'MCH', 'quest'),
  ('mchc', 'MCHC', 'quest'),
  ('rdw', 'RDW', 'quest'),
  ('rdw', 'RDW-CV', 'quest'),
  ('rdw', 'RDW, RBC', 'labcorp'),
  ('rdw', 'RED CELL DISTRIBUTION WIDTH', 'quest'),
  ('platelets', 'PLATELET COUNT', 'quest'),
  ('platelets', 'PLATELETS', 'quest'),
  ('platelets', 'PLT', 'quest'),
  ('mpv', 'MPV', 'quest'),
  ('mpv', 'MEAN PLATELET VOLUME', 'quest'),
  ('neutrophils', 'NEUTROPHILS', 'quest'),
  ('neutrophils', 'NEUT %', 'quest'),
  ('lymphocytes', 'LYMPHOCYTES', 'quest'),
  ('lymphocytes', 'LYMPHS %', 'quest'),
  ('monocytes', 'MONOCYTES', 'quest'),
  ('monocytes', 'MONO %', 'quest'),
  ('eosinophils', 'EOSINOPHILS', 'quest'),
  ('eosinophils', 'EOS %', 'quest'),
  ('basophils', 'BASOPHILS', 'quest'),
  ('basophils', 'BASO %', 'quest'),
  ('neutrophils_abs', 'NEUTROPHILS (ABSOLUTE)', 'quest'),
  ('lymphocytes_abs', 'LYMPHOCYTES (ABSOLUTE)', 'quest'),
  ('monocytes_abs', 'MONOCYTES (ABSOLUTE)', 'quest'),
  ('eosinophils_abs', 'EOSINOPHILS (ABSOLUTE)', 'quest'),
  ('basophils_abs', 'BASOPHILS (ABSOLUTE)', 'quest')
) AS t(slug, syn, src)
WHERE canonical_analytes.slug = t.slug
ON CONFLICT (synonym_text, source_type) DO NOTHING;

-- SYNONYMS: CMP electrolytes & proteins
INSERT INTO analyte_synonyms (canonical_analyte_id, synonym_text, source_type)
SELECT id, syn, src FROM canonical_analytes
CROSS JOIN (VALUES
  ('sodium', 'SODIUM', 'quest'),
  ('sodium', 'SODIUM, SERUM', 'quest'),
  ('potassium', 'POTASSIUM', 'quest'),
  ('potassium', 'POTASSIUM, SERUM', 'quest'),
  ('chloride', 'CHLORIDE', 'quest'),
  ('chloride', 'CHLORIDE, SERUM', 'quest'),
  ('co2', 'CO2', 'quest'),
  ('co2', 'CARBON DIOXIDE', 'quest'),
  ('co2', 'BICARBONATE', 'labcorp'),
  ('calcium', 'CALCIUM', 'quest'),
  ('calcium', 'CALCIUM, SERUM', 'quest')
) AS t(slug, syn, src)
WHERE canonical_analytes.slug = t.slug
ON CONFLICT (synonym_text, source_type) DO NOTHING;
