/*
  # Create Biomarker Catalog Table

  ## Summary
  Creates a new `biomarker_catalog` table as a reference/master list of all 44 supported
  biomarkers. This is distinct from the `biomarkers` table (which stores per-report results).

  ## New Table: `biomarker_catalog`
  - `id` — UUID primary key
  - `slug` — unique machine-readable identifier (e.g. 'estradiol', 'tsh')
  - `name` — human-readable display name
  - `category` — top-level category (hormones, thyroid, metabolic, cardiovascular, liver, kidney, inflammation, nutrients)
  - `subcategory` — sub-grouping within category (e.g. 'reproductive', 'androgen', 'lipids')
  - `unit` — measurement unit string
  - `sex_applicability` — 'female', 'male', or 'both'
  - `is_cycle_dependent` — true if reference ranges vary by menstrual phase
  - `is_fasting_sensitive` — true if test requires fasting

  ## Security
  - RLS enabled; public read-only access (catalog data, not user-owned)
  - No write access for authenticated users (catalog is managed by admins)

  ## Notes
  1. Seeded with all 44 biomarkers from the Amani panel
  2. Uses UPSERT on slug to be idempotent
*/

CREATE TABLE IF NOT EXISTS biomarker_catalog (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  slug               text        UNIQUE NOT NULL,
  name               text        NOT NULL,
  category           text        NOT NULL,
  subcategory        text        NOT NULL DEFAULT '',
  unit               text        NOT NULL DEFAULT '',
  sex_applicability  text        NOT NULL DEFAULT 'female' CHECK (sex_applicability IN ('female','male','both')),
  is_cycle_dependent boolean     NOT NULL DEFAULT false,
  is_fasting_sensitive boolean   NOT NULL DEFAULT false,
  created_at         timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE biomarker_catalog ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Biomarker catalog is publicly readable"
  ON biomarker_catalog
  FOR SELECT
  TO anon, authenticated
  USING (true);

INSERT INTO biomarker_catalog
  (slug, name, category, subcategory, unit, sex_applicability, is_cycle_dependent, is_fasting_sensitive)
VALUES
  ('estradiol','Estradiol','hormones','reproductive','pg/mL','female',true,false),
  ('progesterone','Progesterone','hormones','reproductive','ng/mL','female',true,false),
  ('fsh','FSH','hormones','reproductive','mIU/mL','female',true,false),
  ('lh','LH','hormones','reproductive','mIU/mL','female',true,false),
  ('total_testosterone','Total Testosterone','hormones','androgen','ng/dL','female',false,false),
  ('free_testosterone','Free Testosterone','hormones','androgen','pg/mL','female',false,false),
  ('shbg','Sex Hormone Binding Globulin','hormones','androgen','nmol/L','female',false,false),
  ('dheas','DHEA-S','hormones','adrenal','mcg/dL','female',false,false),
  ('prolactin','Prolactin','hormones','pituitary','ng/mL','female',false,false),
  ('amh','Anti-Mullerian Hormone','hormones','fertility','ng/mL','female',false,false),

  ('tsh','TSH','thyroid','thyroid','mIU/L','female',false,false),
  ('free_t3','Free T3','thyroid','thyroid','pg/mL','female',false,false),
  ('free_t4','Free T4','thyroid','thyroid','ng/dL','female',false,false),
  ('total_t4','Total T4','thyroid','thyroid','mcg/dL','female',false,false),
  ('reverse_t3','Reverse T3','thyroid','thyroid','ng/dL','female',false,false),
  ('tpo_antibodies','TPO Antibodies','thyroid','autoimmune','IU/mL','female',false,false),
  ('tg_antibodies','Thyroglobulin Antibodies','thyroid','autoimmune','IU/mL','female',false,false),

  ('fasting_glucose','Fasting Glucose','metabolic','glucose','mg/dL','female',false,true),
  ('hemoglobin_a1c','Hemoglobin A1c','metabolic','glucose','%','female',false,false),
  ('fasting_insulin','Fasting Insulin','metabolic','glucose','uIU/mL','female',false,true),
  ('c_peptide','C-Peptide','metabolic','glucose','ng/mL','female',false,true),

  ('total_cholesterol','Total Cholesterol','cardiovascular','lipids','mg/dL','female',false,true),
  ('hdl_cholesterol','HDL Cholesterol','cardiovascular','lipids','mg/dL','female',false,true),
  ('ldl_cholesterol','LDL Cholesterol','cardiovascular','lipids','mg/dL','female',false,true),
  ('triglycerides','Triglycerides','cardiovascular','lipids','mg/dL','female',false,true),
  ('non_hdl_cholesterol','Non-HDL Cholesterol','cardiovascular','lipids','mg/dL','female',false,true),
  ('apob','Apolipoprotein B','cardiovascular','lipids','mg/dL','female',false,false),
  ('lpa','Lipoprotein(a)','cardiovascular','lipids','mg/dL','female',false,false),

  ('ast','AST','liver','enzymes','U/L','female',false,false),
  ('alt','ALT','liver','enzymes','U/L','female',false,false),
  ('ggt','GGT','liver','enzymes','U/L','female',false,false),
  ('alkaline_phosphatase','Alkaline Phosphatase','liver','enzymes','U/L','female',false,false),
  ('bilirubin_total','Bilirubin, Total','liver','liver_function','mg/dL','female',false,false),

  ('creatinine','Creatinine','kidney','renal','mg/dL','female',false,false),
  ('bun','BUN','kidney','renal','mg/dL','female',false,false),
  ('egfr','eGFR','kidney','renal','mL/min/1.73m2','female',false,false),

  ('hs_crp','hs-CRP','inflammation','inflammation','mg/L','female',false,false),
  ('esr','ESR','inflammation','inflammation','mm/h','female',false,false),

  ('ferritin','Ferritin','nutrients','iron','ng/mL','female',false,false),
  ('iron_saturation','Iron Saturation','nutrients','iron','%','female',false,false),
  ('vitamin_d_25_oh','Vitamin D (25-OH)','nutrients','vitamins','ng/mL','female',false,false),
  ('vitamin_b12','Vitamin B12','nutrients','vitamins','pg/mL','female',false,false),
  ('folate','Folate','nutrients','vitamins','ng/mL','female',false,false),
  ('magnesium','Magnesium','nutrients','minerals','mg/dL','female',false,false)
ON CONFLICT (slug) DO UPDATE SET
  name               = EXCLUDED.name,
  category           = EXCLUDED.category,
  subcategory        = EXCLUDED.subcategory,
  unit               = EXCLUDED.unit,
  sex_applicability  = EXCLUDED.sex_applicability,
  is_cycle_dependent = EXCLUDED.is_cycle_dependent,
  is_fasting_sensitive = EXCLUDED.is_fasting_sensitive;
