/*
  # Add Biomarker Definitions and Derived Metrics Tables

  ## Overview
  Expands the Amani biomarker system from 9 to 44 biomarkers, mirroring a
  comprehensive health panel. Adds derived metric storage and insight flags.

  ## New Tables

  ### biomarker_definitions
  A reference table (seeded with data) containing canonical definitions for
  all 44 supported biomarkers:
  - id, name (unique canonical key), display_name
  - category: hormones | thyroid | metabolic | lipids | liver | kidney | nutrients | inflammation
  - unit (standard unit)
  - optimal_range_min / optimal_range_max: tightest "optimal" window
  - clinical_range_min / clinical_range_max: standard lab reference range
  - sex_specific: boolean (true = female-specific interpretation may apply)
  - description: plain English explanation

  ### derived_metrics
  Stores computed metrics (HOMA-IR, Trig:HDL ratio, etc.) per lab report:
  - id, lab_report_id (FK), name, value, interpretation (text)
  - created_at

  ### insight_flags
  Stores rule-triggered clinical insight flags per lab report:
  - id, lab_report_id (FK), rule_id, severity (info | caution | discuss)
  - title, description, biomarkers_involved (text[])
  - created_at

  ## Security
  - RLS enabled on derived_metrics and insight_flags
  - Access controlled via lab_report ownership check
  - biomarker_definitions is public read (reference data)
*/

-- -------------------------------------------------------
-- biomarker_definitions (reference / seed table)
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS biomarker_definitions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text UNIQUE NOT NULL,
  display_name    text NOT NULL,
  category        text NOT NULL CHECK (category IN ('hormones','thyroid','metabolic','lipids','liver','kidney','nutrients','inflammation')),
  unit            text NOT NULL,
  optimal_range_min  numeric,
  optimal_range_max  numeric,
  clinical_range_min numeric,
  clinical_range_max numeric,
  sex_specific    boolean NOT NULL DEFAULT false,
  description     text NOT NULL DEFAULT ''
);

-- Seed biomarker definitions
INSERT INTO biomarker_definitions (name, display_name, category, unit, optimal_range_min, optimal_range_max, clinical_range_min, clinical_range_max, sex_specific, description) VALUES

-- HORMONES
('estradiol',     'Estradiol (E2)',              'hormones',     'pg/mL',   30,    350,   10,    400,  true,  'Primary female sex hormone; varies widely across the menstrual cycle.'),
('progesterone',  'Progesterone',                'hormones',     'ng/mL',   0.1,   25,    0.1,   30,   true,  'Rises sharply after ovulation; low in follicular phase.'),
('lh',            'LH (Luteinizing Hormone)',     'hormones',     'mIU/mL',  2,     15,    1,     100,  true,  'Triggers ovulation; surges mid-cycle.'),
('fsh',           'FSH (Follicle Stimulating)',   'hormones',     'mIU/mL',  3,     10,    2,     25,   true,  'Stimulates egg development; elevated FSH can indicate diminished ovarian reserve.'),
('amh',           'AMH (Anti-Mullerian)',         'hormones',     'ng/mL',   1.0,   3.5,   0.1,   6.0,  true,  'Marker of ovarian reserve; declines with age.'),
('testosterone_total', 'Testosterone (Total)',    'hormones',     'ng/dL',   15,    70,    10,    100,  true,  'Total testosterone; includes bound and free forms.'),
('testosterone_free',  'Testosterone (Free)',     'hormones',     'pg/mL',   1.0,   8.5,   0.5,   10,   true,  'Biologically active fraction of testosterone.'),
('dhea_s',        'DHEA-S',                       'hormones',     'mcg/dL',  65,    380,   35,    430,  true,  'Adrenal androgen precursor; declines with age.'),
('cortisol',      'Cortisol (AM)',                'hormones',     'mcg/dL',  10,    20,    6,     23,   false, 'Stress hormone; highest in the morning.'),
('prolactin',     'Prolactin',                    'hormones',     'ng/mL',   3,     20,    2,     29,   true,  'Elevated prolactin can disrupt ovulation and menstrual cycles.'),
('insulin',       'Fasting Insulin',              'hormones',     'mcIU/mL', 2,     10,    1,     25,   false, 'Key marker for insulin resistance when elevated alongside glucose.'),
('shbg',          'SHBG',                         'hormones',     'nmol/L',  40,    120,   18,    200,  true,  'Binds sex hormones; low SHBG increases free androgen availability.'),

-- THYROID
('tsh',           'TSH (Thyroid Stimulating)',    'thyroid',      'mIU/L',   1.0,   2.5,   0.4,   4.0,  false, 'Master regulator of thyroid function; high TSH suggests hypothyroidism.'),
('free_t4',       'Free T4 (Thyroxine)',          'thyroid',      'ng/dL',   0.9,   1.7,   0.8,   1.8,  false, 'Inactive thyroid hormone converted to T3 in tissues.'),
('free_t3',       'Free T3 (Triiodothyronine)',   'thyroid',      'pg/mL',   3.0,   4.0,   2.3,   4.2,  false, 'Active thyroid hormone; governs metabolism and energy.'),
('reverse_t3',    'Reverse T3',                   'thyroid',      'ng/dL',   10,    24,    8,     25,   false, 'Inactive T3 isomer; elevated in chronic stress or illness.'),
('tpo_antibodies','TPO Antibodies',               'thyroid',      'IU/mL',   0,     34,    0,     35,   false, 'Marker of autoimmune thyroid disease (Hashimoto''s).'),
('tgab',          'Thyroglobulin Antibodies',     'thyroid',      'IU/mL',   0,     0.9,   0,     1.0,  false, 'Additional marker of autoimmune thyroid involvement.'),

-- METABOLIC
('glucose_fasting','Fasting Glucose',             'metabolic',    'mg/dL',   72,    90,    70,    99,   false, 'Blood sugar after overnight fast; elevated suggests insulin resistance or diabetes.'),
('hba1c',         'HbA1c',                        'metabolic',    '%',       4.6,   5.4,   4.0,   5.6,  false, 'Reflects average blood sugar over 2–3 months.'),

-- LIPIDS
('total_cholesterol','Total Cholesterol',         'lipids',       'mg/dL',   160,   200,   100,   239,  false, 'Sum of all cholesterol fractions; context-dependent.'),
('ldl',           'LDL Cholesterol',              'lipids',       'mg/dL',   60,    100,   0,     129,  false, 'Low-density lipoprotein; primary cardiovascular risk marker.'),
('hdl',           'HDL Cholesterol',              'lipids',       'mg/dL',   60,    90,    50,    100,  true,  'Protective cholesterol; higher is generally better for women.'),
('triglycerides', 'Triglycerides',                'lipids',       'mg/dL',   60,    100,   0,     149,  false, 'Blood fat; elevated levels raise cardiovascular and metabolic risk.'),
('apob',          'ApoB',                         'lipids',       'mg/dL',   55,    90,    40,    120,  false, 'Apolipoprotein B; each atherogenic particle carries one ApoB.'),
('lpA',           'Lp(a)',                        'lipids',       'nmol/L',  0,     75,    0,     125,  false, 'Genetically determined cardiovascular risk factor.'),

-- LIVER
('alt',           'ALT (Liver Enzyme)',            'liver',        'U/L',     7,     25,    7,     45,   true,  'Liver-specific enzyme; elevated with liver inflammation or injury.'),
('ast',           'AST (Liver Enzyme)',            'liver',        'U/L',     10,    25,    10,    40,   false, 'Liver enzyme also found in muscle; elevated with liver or muscle damage.'),
('ggt',           'GGT',                          'liver',        'U/L',     8,     20,    8,     45,   true,  'Liver/biliary marker; sensitive to alcohol and certain medications.'),
('total_bilirubin','Total Bilirubin',              'liver',        'mg/dL',   0.3,   1.0,   0.2,   1.2,  false, 'Breakdown product of hemoglobin; elevated with liver or blood conditions.'),
('albumin',       'Albumin',                      'liver',        'g/dL',    4.0,   5.0,   3.5,   5.0,  false, 'Protein made by the liver; low levels reflect poor nutrition or liver disease.'),

-- KIDNEY
('creatinine',    'Creatinine',                   'kidney',       'mg/dL',   0.5,   0.9,   0.5,   1.1,  true,  'Muscle waste product filtered by kidneys; elevated with kidney dysfunction.'),
('egfr',          'eGFR',                         'kidney',       'mL/min',  90,    120,   60,    120,  false, 'Estimated glomerular filtration rate; below 60 suggests kidney dysfunction.'),
('bun',           'BUN (Blood Urea Nitrogen)',     'kidney',       'mg/dL',   7,     18,    6,     20,   false, 'Waste product filtered by kidneys; elevated with dehydration or kidney issues.'),
('uric_acid',     'Uric Acid',                    'kidney',       'mg/dL',   2.5,   5.0,   2.5,   6.0,  true,  'Byproduct of purine metabolism; elevated levels associated with gout and metabolic syndrome.'),

-- NUTRIENTS
('ferritin',      'Ferritin',                     'nutrients',    'ng/mL',   30,    150,   13,    150,  true,  'Iron storage protein; low ferritin is the most sensitive marker for iron deficiency.'),
('vitamin_d',     'Vitamin D (25-OH)',             'nutrients',    'ng/mL',   50,    80,    30,    100,  false, 'Fat-soluble vitamin; below 30 is considered deficient.'),
('b12',           'Vitamin B12',                  'nutrients',    'pg/mL',   400,   900,   200,   900,  false, 'Essential for nerve and red blood cell health.'),
('folate',        'Folate (RBC)',                  'nutrients',    'ng/mL',   10,    20,    5,     20,   false, 'B-vitamin critical for cell division and DNA synthesis.'),
('magnesium',     'Magnesium (RBC)',               'nutrients',    'mg/dL',   5.2,   6.5,   4.2,   6.8,  false, 'Intracellular magnesium; more accurate than serum levels.'),
('zinc',          'Zinc',                         'nutrients',    'mcg/dL',  80,    120,   56,    134,  false, 'Essential mineral for immune function and hormone synthesis.'),
('iron',          'Serum Iron',                   'nutrients',    'mcg/dL',  70,    150,   60,    170,  true,  'Circulating iron; best interpreted alongside ferritin and TIBC.'),

-- INFLAMMATION
('hscrp',         'hs-CRP (High Sensitivity)',    'inflammation', 'mg/L',    0,     1.0,   0,     3.0,  false, 'Sensitive inflammation marker; elevated with cardiovascular risk or chronic inflammation.'),
('homocysteine',  'Homocysteine',                 'inflammation', 'mcmol/L', 6,     10,    5,     15,   false, 'Amino acid; elevated levels associated with cardiovascular and cognitive risk.')

ON CONFLICT (name) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  category = EXCLUDED.category,
  unit = EXCLUDED.unit,
  optimal_range_min = EXCLUDED.optimal_range_min,
  optimal_range_max = EXCLUDED.optimal_range_max,
  clinical_range_min = EXCLUDED.clinical_range_min,
  clinical_range_max = EXCLUDED.clinical_range_max,
  sex_specific = EXCLUDED.sex_specific,
  description = EXCLUDED.description;

-- -------------------------------------------------------
-- derived_metrics
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS derived_metrics (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lab_report_id   uuid NOT NULL REFERENCES lab_reports(id) ON DELETE CASCADE,
  name            text NOT NULL,
  value           numeric NOT NULL,
  interpretation  text NOT NULL DEFAULT '',
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE(lab_report_id, name)
);

ALTER TABLE derived_metrics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own derived metrics"
  ON derived_metrics FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM lab_reports
      WHERE lab_reports.id = derived_metrics.lab_report_id
        AND lab_reports.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert own derived metrics"
  ON derived_metrics FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM lab_reports
      WHERE lab_reports.id = derived_metrics.lab_report_id
        AND lab_reports.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete own derived metrics"
  ON derived_metrics FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM lab_reports
      WHERE lab_reports.id = derived_metrics.lab_report_id
        AND lab_reports.user_id = auth.uid()
    )
  );

-- -------------------------------------------------------
-- insight_flags
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS insight_flags (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lab_report_id        uuid NOT NULL REFERENCES lab_reports(id) ON DELETE CASCADE,
  rule_id              text NOT NULL,
  severity             text NOT NULL CHECK (severity IN ('info','caution','discuss')),
  title                text NOT NULL,
  description          text NOT NULL,
  biomarkers_involved  text[] NOT NULL DEFAULT '{}',
  created_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE(lab_report_id, rule_id)
);

ALTER TABLE insight_flags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own insight flags"
  ON insight_flags FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM lab_reports
      WHERE lab_reports.id = insight_flags.lab_report_id
        AND lab_reports.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert own insight flags"
  ON insight_flags FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM lab_reports
      WHERE lab_reports.id = insight_flags.lab_report_id
        AND lab_reports.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete own insight flags"
  ON insight_flags FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM lab_reports
      WHERE lab_reports.id = insight_flags.lab_report_id
        AND lab_reports.user_id = auth.uid()
    )
  );

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_derived_metrics_lab_report_id ON derived_metrics(lab_report_id);
CREATE INDEX IF NOT EXISTS idx_insight_flags_lab_report_id ON insight_flags(lab_report_id);
