/*
  # Full 44-Biomarker Women's Health Panel (v3)
  Drops and recreates all new tables cleanly, handles existing columns gracefully.
*/

-- =====================================================
-- BIOMARKER DEFINITIONS (full replacement)
-- =====================================================
DROP TABLE IF EXISTS biomarker_definitions CASCADE;

CREATE TABLE biomarker_definitions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                text UNIQUE NOT NULL,
  display_name        text NOT NULL,
  short_name          text NOT NULL DEFAULT '',
  category            text NOT NULL,
  unit                text NOT NULL,
  optimal_min         numeric,
  optimal_max         numeric,
  clinical_min        numeric,
  clinical_max        numeric,
  score_weight        numeric NOT NULL DEFAULT 1.0,
  sex_specific        boolean NOT NULL DEFAULT false,
  cycle_dependent     boolean NOT NULL DEFAULT false,
  description         text NOT NULL DEFAULT '',
  what_it_measures    text NOT NULL DEFAULT '',
  sort_order          integer NOT NULL DEFAULT 0
);

INSERT INTO biomarker_definitions (name,display_name,short_name,category,unit,optimal_min,optimal_max,clinical_min,clinical_max,score_weight,sex_specific,cycle_dependent,description,what_it_measures,sort_order) VALUES
('estradiol','Estradiol (E2)','E2','hormones','pg/mL',30,350,10,400,1.5,true,true,'Primary estrogen; drives follicular growth, bone health, mood, and cardiovascular function.','Estrogen levels in blood; varies dramatically across the menstrual cycle.',10),
('progesterone','Progesterone','Prog','hormones','ng/mL',0.1,25,0.1,30,1.5,true,true,'Produced after ovulation; essential for uterine health and cycle regulation.','Key indicator of whether ovulation occurred.',20),
('fsh','FSH','FSH','hormones','mIU/mL',3,10,2,25,1.5,true,true,'Stimulates follicle development; elevated may indicate diminished ovarian reserve.','Follicle-stimulating hormone.',30),
('lh','LH','LH','hormones','mIU/mL',2,15,1,100,1.2,true,true,'Triggers ovulation; LH surge indicates imminent egg release.','Luteinizing hormone.',40),
('testosterone_total','Total Testosterone','TT','hormones','ng/dL',15,70,10,100,1.2,true,false,'Includes both free and protein-bound testosterone.','Total testosterone in blood.',50),
('testosterone_free','Free Testosterone','FT','hormones','pg/mL',1.0,8.5,0.5,10,1.3,true,false,'Biologically active fraction correlating with androgenic effects.','Unbound testosterone.',60),
('shbg','SHBG','SHBG','hormones','nmol/L',40,120,18,200,1.0,true,false,'Protein that binds sex hormones; low SHBG increases free androgen availability.','Sex hormone-binding globulin.',70),
('dhea_s','DHEA-S','DHEA-S','hormones','mcg/dL',65,380,35,430,1.0,true,false,'Adrenal androgen precursor; marker of adrenal function.','Dehydroepiandrosterone sulfate.',80),
('prolactin','Prolactin','PRL','hormones','ng/mL',3,20,2,29,1.3,true,false,'Elevated levels can disrupt ovulation and cause irregular cycles.','Hormone associated with lactation.',90),
('amh','AMH','AMH','hormones','ng/mL',1.0,3.5,0.1,6.0,1.5,true,false,'Reliable marker of ovarian reserve; does not vary with cycle phase.','Anti-Müllerian hormone.',100),
('tsh','TSH','TSH','thyroid','mIU/L',1.0,2.5,0.4,4.0,2.0,false,false,'Master regulator of thyroid function; elevated TSH suggests thyroid underperformance.','Pituitary signal to the thyroid.',200),
('free_t3','Free T3','fT3','thyroid','pg/mL',3.0,4.0,2.3,4.2,1.8,false,false,'Active thyroid hormone governing metabolism, energy, mood, and temperature.','Biologically active thyroid hormone.',210),
('free_t4','Free T4','fT4','thyroid','ng/dL',0.9,1.7,0.8,1.8,1.5,false,false,'Inactive thyroid hormone converted to T3 in tissues.','Precursor thyroid hormone.',220),
('total_t4','Total T4','T4','thyroid','mcg/dL',5.5,11.0,4.5,12.0,1.0,false,false,'Includes both bound and free T4.','Total thyroxine.',230),
('reverse_t3','Reverse T3','rT3','thyroid','ng/dL',10,24,8,25,1.0,false,false,'Inactive T3 isomer; elevated in chronic stress or poor conversion.','Inactive T3 mirror.',240),
('tpo_antibodies','TPO Antibodies','TPO-Ab','thyroid','IU/mL',0,34,0,35,1.8,false,false,'Marker of autoimmune thyroid attack; elevated in Hashimoto''s.','Antibodies against thyroid peroxidase.',250),
('tgab','Thyroglobulin Antibodies','TgAb','thyroid','IU/mL',0,0.9,0,1.0,1.5,false,false,'Additional autoimmune thyroid marker.','Antibodies against thyroglobulin.',260),
('glucose_fasting','Fasting Glucose','Gluc','metabolic','mg/dL',72,90,70,99,1.8,false,false,'Blood sugar after overnight fast; elevated indicates insulin resistance or pre-diabetes.','Blood glucose in fasted state.',300),
('hba1c','Hemoglobin A1c','HbA1c','metabolic','%',4.6,5.4,4.0,5.6,2.0,false,false,'Reflects average blood sugar over 2-3 months.','Long-term blood sugar marker.',310),
('insulin','Fasting Insulin','Ins','metabolic','mcIU/mL',2,10,1,25,1.8,false,false,'Key marker for insulin resistance when elevated.','Pancreatic hormone regulating glucose uptake.',320),
('c_peptide','C-Peptide','C-Pep','metabolic','ng/mL',0.8,3.1,0.5,4.0,1.0,false,false,'Co-released with insulin; assesses insulin production.','Byproduct of insulin synthesis.',330),
('total_cholesterol','Total Cholesterol','TC','lipids','mg/dL',160,200,100,239,1.2,false,false,'Sum of all cholesterol fractions; context-dependent.','Total circulating cholesterol.',400),
('hdl','HDL Cholesterol','HDL','lipids','mg/dL',60,90,50,100,1.5,true,false,'Protective cholesterol; removes cholesterol from arteries.','High-density lipoprotein.',410),
('ldl','LDL Cholesterol','LDL','lipids','mg/dL',60,100,0,129,1.5,false,false,'Primary cardiovascular risk marker.','Low-density lipoprotein.',420),
('triglycerides','Triglycerides','TG','lipids','mg/dL',60,100,0,149,1.5,false,false,'Blood fat elevated by carbohydrates, alcohol, or insulin resistance.','Blood triglycerides.',430),
('non_hdl','Non-HDL Cholesterol','Non-HDL','lipids','mg/dL',80,130,0,159,1.2,false,false,'All atherogenic particles combined; more predictive than LDL alone.','Total cholesterol minus HDL.',440),
('apob','ApoB','ApoB','lipids','mg/dL',55,90,40,120,1.8,false,false,'One ApoB per atherogenic particle; best cardiovascular particle marker.','Apolipoprotein B.',450),
('lpa','Lipoprotein(a)','Lp(a)','lipids','nmol/L',0,75,0,125,1.3,false,false,'Genetically determined cardiovascular risk factor.','Lipoprotein(a).',460),
('ast','AST','AST','liver','U/L',10,25,10,40,1.3,false,false,'Liver enzyme also in muscle; elevated with liver inflammation.','Aspartate aminotransferase.',500),
('alt','ALT','ALT','liver','U/L',7,25,7,45,1.5,true,false,'Liver-specific enzyme; elevated with liver injury or fatty liver.','Alanine aminotransferase.',510),
('ggt','GGT','GGT','liver','U/L',8,20,8,45,1.2,true,false,'Sensitive to alcohol, bile duct issues, and medications.','Gamma-glutamyl transferase.',520),
('alkaline_phosphatase','Alkaline Phosphatase','ALP','liver','U/L',40,100,35,130,1.0,false,false,'Elevated with liver disease or bone disorders.','Liver/bone enzyme.',530),
('bilirubin_total','Bilirubin Total','Bili','liver','mg/dL',0.3,1.0,0.2,1.2,1.0,false,false,'Breakdown product of hemoglobin.','Hemoglobin breakdown product.',540),
('creatinine','Creatinine','Creat','kidney','mg/dL',0.5,0.9,0.5,1.1,1.5,true,false,'Muscle waste filtered by kidneys; elevated with kidney dysfunction.','Kidney filtration waste marker.',600),
('bun','BUN','BUN','kidney','mg/dL',7,18,6,20,1.2,false,false,'Elevated with dehydration or kidney dysfunction.','Urea nitrogen in blood.',610),
('egfr','eGFR','eGFR','kidney','mL/min',90,120,60,120,1.8,false,false,'Below 60 suggests chronic kidney disease.','Estimated kidney filtration rate.',620),
('hscrp','hs-CRP','hs-CRP','inflammation','mg/L',0,1.0,0,3.0,1.8,false,false,'Highly sensitive inflammation marker; elevated with cardiovascular risk or chronic inflammation.','Systemic inflammation marker.',700),
('esr','ESR','ESR','inflammation','mm/hr',0,15,0,20,1.2,true,false,'Broad inflammatory marker; less specific than hs-CRP.','Red blood cell sedimentation rate.',710),
('ferritin','Ferritin','Ferr','nutrients','ng/mL',30,150,13,150,1.8,true,false,'Most sensitive marker for iron deficiency even before anemia develops.','Iron storage protein.',800),
('iron_saturation','Iron Saturation','Fe Sat','nutrients','%',25,40,15,50,1.3,true,false,'Percentage of transferrin carrying iron; low reflects inadequate iron transport.','Iron transport saturation.',810),
('vitamin_d','Vitamin D 25-OH','Vit D','nutrients','ng/mL',50,80,30,100,1.8,false,false,'Critical for immune function, bone health, mood, and hormone signaling.','Circulating vitamin D status.',820),
('b12','Vitamin B12','B12','nutrients','pg/mL',400,900,200,900,1.5,false,false,'Essential for neurological function and red blood cell formation.','Cobalamin status.',830),
('folate','Folate','Fol','nutrients','ng/mL',10,20,5,20,1.3,false,false,'Critical for DNA synthesis and cell division.','Folate status.',840),
('magnesium','Magnesium','Mag','nutrients','mg/dL',5.2,6.5,4.2,6.8,1.3,false,false,'Involved in 300+ enzymatic reactions; commonly low with hormonal imbalances.','Intracellular magnesium.',850);

-- =====================================================
-- BIOMARKER REFERENCE RANGES (cycle-phase aware)
-- =====================================================
DROP TABLE IF EXISTS biomarker_reference_ranges CASCADE;

CREATE TABLE biomarker_reference_ranges (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  biomarker_name  text NOT NULL REFERENCES biomarker_definitions(name) ON DELETE CASCADE,
  phase           text NOT NULL CHECK (phase IN ('general','menstrual','follicular','ovulatory','luteal','pregnancy_t1','pregnancy_t2','pregnancy_t3')),
  optimal_min     numeric,
  optimal_max     numeric,
  clinical_min    numeric,
  clinical_max    numeric,
  notes           text,
  UNIQUE(biomarker_name, phase)
);

INSERT INTO biomarker_reference_ranges (biomarker_name,phase,optimal_min,optimal_max,clinical_min,clinical_max,notes) VALUES
('estradiol','menstrual',20,80,10,200,'Baseline estrogen'),
('estradiol','follicular',30,250,20,400,'Rising with follicle growth'),
('estradiol','ovulatory',150,750,100,1000,'Peak at LH surge'),
('estradiol','luteal',50,300,30,500,'Luteal support level'),
('estradiol','general',30,350,10,400,NULL),
('progesterone','menstrual',0.1,0.9,0.1,1.5,'Baseline low'),
('progesterone','follicular',0.1,0.9,0.1,1.5,'Pre-ovulatory low'),
('progesterone','ovulatory',1.0,3.0,0.5,5.0,'Beginning luteal rise'),
('progesterone','luteal',5.0,25.0,3.0,30.0,'Post-ovulatory peak - confirms ovulation'),
('progesterone','general',0.1,25.0,0.1,30.0,NULL),
('progesterone','pregnancy_t1',10,90,9,100,'First trimester'),
('progesterone','pregnancy_t2',25,90,17,150,'Second trimester'),
('progesterone','pregnancy_t3',50,350,38,400,'Third trimester'),
('fsh','menstrual',3,10,3,20,'Rises to recruit follicles'),
('fsh','follicular',2,10,2,20,'Drives follicle development'),
('fsh','ovulatory',2,15,2,30,'Secondary surge'),
('fsh','luteal',1,8,1,10,'Low in luteal phase'),
('fsh','general',3,10,2,25,NULL),
('lh','menstrual',2,15,1,25,'Baseline range'),
('lh','follicular',2,15,1,25,'Slowly rising'),
('lh','ovulatory',20,80,15,100,'LH surge'),
('lh','luteal',2,12,1,20,'Returns to baseline'),
('lh','general',2,15,1,100,NULL);

-- =====================================================
-- LAB PANELS
-- =====================================================
DROP TABLE IF EXISTS lab_panels CASCADE;

CREATE TABLE lab_panels (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  slug        text UNIQUE NOT NULL,
  description text,
  biomarkers  text[] NOT NULL DEFAULT '{}'
);

INSERT INTO lab_panels (name,slug,description,biomarkers) VALUES
('Full Women''s Health Panel','full_womens','Comprehensive 44-biomarker panel.',
 ARRAY['estradiol','progesterone','fsh','lh','testosterone_total','testosterone_free','shbg','dhea_s','prolactin','amh','tsh','free_t3','free_t4','total_t4','reverse_t3','tpo_antibodies','tgab','glucose_fasting','hba1c','insulin','c_peptide','total_cholesterol','hdl','ldl','triglycerides','non_hdl','apob','lpa','ast','alt','ggt','alkaline_phosphatase','bilirubin_total','creatinine','bun','egfr','hscrp','esr','ferritin','iron_saturation','vitamin_d','b12','folate','magnesium']),
('Hormone Panel','hormone_panel','Core reproductive hormones.',ARRAY['estradiol','progesterone','fsh','lh','testosterone_total','testosterone_free','shbg','dhea_s','prolactin','amh']),
('Thyroid Panel','thyroid_panel','Full thyroid function.',ARRAY['tsh','free_t3','free_t4','total_t4','reverse_t3','tpo_antibodies','tgab']),
('Metabolic Panel','metabolic_panel','Glucose and insulin.',ARRAY['glucose_fasting','hba1c','insulin','c_peptide']),
('Cardiovascular Panel','cardiovascular_panel','Advanced lipid assessment.',ARRAY['total_cholesterol','hdl','ldl','triglycerides','non_hdl','apob','lpa','hscrp']);

-- =====================================================
-- LAB RESULTS
-- =====================================================
DROP TABLE IF EXISTS lab_results CASCADE;

CREATE TABLE lab_results (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lab_report_id         uuid NOT NULL REFERENCES lab_reports(id) ON DELETE CASCADE,
  biomarker_name        text NOT NULL REFERENCES biomarker_definitions(name),
  value                 numeric NOT NULL,
  unit                  text NOT NULL,
  lab_ref_min           numeric,
  lab_ref_max           numeric,
  amani_status          text NOT NULL DEFAULT 'unknown' CHECK (amani_status IN ('optimal','normal','borderline_low','borderline_high','out_of_range_low','out_of_range_high','unknown')),
  lab_status            text NOT NULL DEFAULT 'unknown' CHECK (lab_status IN ('in_range','borderline_low','borderline_high','out_of_range_low','out_of_range_high','unknown')),
  cycle_phase           text CHECK (cycle_phase IN ('menstrual','follicular','ovulatory','luteal','pregnancy_t1','pregnancy_t2','pregnancy_t3','unknown')),
  extraction_confidence text CHECK (extraction_confidence IN ('high','medium','low')),
  created_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE(lab_report_id, biomarker_name)
);

ALTER TABLE lab_results ENABLE ROW LEVEL SECURITY;
CREATE POLICY "lr_select" ON lab_results FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM lab_reports WHERE lab_reports.id=lab_results.lab_report_id AND lab_reports.user_id=auth.uid()));
CREATE POLICY "lr_insert" ON lab_results FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM lab_reports WHERE lab_reports.id=lab_results.lab_report_id AND lab_reports.user_id=auth.uid()));
CREATE POLICY "lr_update" ON lab_results FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM lab_reports WHERE lab_reports.id=lab_results.lab_report_id AND lab_reports.user_id=auth.uid())) WITH CHECK (EXISTS (SELECT 1 FROM lab_reports WHERE lab_reports.id=lab_results.lab_report_id AND lab_reports.user_id=auth.uid()));
CREATE POLICY "lr_delete" ON lab_results FOR DELETE TO authenticated USING (EXISTS (SELECT 1 FROM lab_reports WHERE lab_reports.id=lab_results.lab_report_id AND lab_reports.user_id=auth.uid()));

-- =====================================================
-- DERIVED METRIC DEFINITIONS
-- =====================================================
DROP TABLE IF EXISTS derived_metric_definitions CASCADE;

CREATE TABLE derived_metric_definitions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text UNIQUE NOT NULL,
  display_name    text NOT NULL,
  formula_note    text,
  unit            text NOT NULL DEFAULT '',
  optimal_min     numeric,
  optimal_max     numeric,
  inputs_required text[] NOT NULL DEFAULT '{}'
);

INSERT INTO derived_metric_definitions (name,display_name,formula_note,unit,optimal_min,optimal_max,inputs_required) VALUES
('HOMA_IR','HOMA-IR','(Fasting Glucose x Fasting Insulin) / 405','',0,1.0,ARRAY['glucose_fasting','insulin']),
('TG_HDL_RATIO','Triglyceride : HDL Ratio','Triglycerides / HDL','',0,2.0,ARRAY['triglycerides','hdl']),
('NON_HDL','Non-HDL Cholesterol','Total Cholesterol - HDL','mg/dL',80,130,ARRAY['total_cholesterol','hdl']),
('FREE_ANDROGEN_INDEX','Free Androgen Index','(Total Testosterone / SHBG) x 100','%',0,5.0,ARRAY['testosterone_total','shbg']),
('FT3_FT4_RATIO','Free T3 : Free T4 Ratio','Free T3 / Free T4','',0.2,0.3,ARRAY['free_t3','free_t4']);

-- =====================================================
-- DERIVED METRIC RESULTS
-- =====================================================
DROP TABLE IF EXISTS derived_metric_results CASCADE;
DROP TABLE IF EXISTS derived_metrics CASCADE;

CREATE TABLE derived_metric_results (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lab_report_id   uuid NOT NULL REFERENCES lab_reports(id) ON DELETE CASCADE,
  metric_name     text NOT NULL REFERENCES derived_metric_definitions(name),
  value           numeric NOT NULL,
  status          text NOT NULL DEFAULT 'unknown' CHECK (status IN ('optimal','borderline','out_of_range','unknown')),
  interpretation  text NOT NULL DEFAULT '',
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE(lab_report_id, metric_name)
);

ALTER TABLE derived_metric_results ENABLE ROW LEVEL SECURITY;
CREATE POLICY "dmr_select" ON derived_metric_results FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM lab_reports WHERE lab_reports.id=derived_metric_results.lab_report_id AND lab_reports.user_id=auth.uid()));
CREATE POLICY "dmr_insert" ON derived_metric_results FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM lab_reports WHERE lab_reports.id=derived_metric_results.lab_report_id AND lab_reports.user_id=auth.uid()));
CREATE POLICY "dmr_delete" ON derived_metric_results FOR DELETE TO authenticated USING (EXISTS (SELECT 1 FROM lab_reports WHERE lab_reports.id=derived_metric_results.lab_report_id AND lab_reports.user_id=auth.uid()));

-- =====================================================
-- INSIGHT RULES
-- =====================================================
DROP TABLE IF EXISTS insight_rules CASCADE;

CREATE TABLE insight_rules (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id               text UNIQUE NOT NULL,
  title                 text NOT NULL,
  category              text NOT NULL,
  severity              text NOT NULL CHECK (severity IN ('info','caution','discuss')),
  description_template  text NOT NULL,
  biomarkers_involved   text[] NOT NULL DEFAULT '{}',
  active                boolean NOT NULL DEFAULT true
);

INSERT INTO insight_rules (rule_id,title,category,severity,description_template,biomarkers_involved) VALUES
('autoimmune_thyroid_pattern','Possible Autoimmune Thyroid Pattern','thyroid','discuss','TPO antibodies elevated (>100 IU/mL) with TSH above optimal range. Clinicians commonly evaluate this combination in the context of autoimmune thyroid conditions such as Hashimoto''s thyroiditis.',ARRAY['tpo_antibodies','tsh']),
('insulin_resistance_pattern','Metabolic / Insulin Resistance Pattern','metabolic','discuss','Multiple metabolic markers outside optimal range. This cluster may reflect insulin resistance and is worth a focused discussion with your provider.',ARRAY['glucose_fasting','insulin','triglycerides','hdl']),
('possible_luteal_insufficiency','Possible Luteal Phase Insufficiency','hormones','caution','Progesterone is below the expected range for the luteal phase. Adequate progesterone after ovulation supports uterine lining health and cycle regularity.',ARRAY['progesterone']),
('possible_iron_deficiency','Iron Deficiency Pattern','nutrients','discuss','Ferritin and/or iron saturation are below optimal. Iron deficiency can present before anemia develops.',ARRAY['ferritin','iron_saturation']),
('possible_pcos_pattern','Possible PCOS-Related Pattern','hormones','discuss','Elevated androgens (testosterone or DHEA-S) with low SHBG, or elevated LH:FSH ratio, are patterns clinicians commonly evaluate in the context of PCOS.',ARRAY['testosterone_total','dhea_s','shbg','lh','fsh']);

-- =====================================================
-- INSIGHT RULE RESULTS
-- =====================================================
DROP TABLE IF EXISTS insight_rule_results CASCADE;
DROP TABLE IF EXISTS insight_flags CASCADE;

CREATE TABLE insight_rule_results (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lab_report_id       uuid NOT NULL REFERENCES lab_reports(id) ON DELETE CASCADE,
  rule_id             text NOT NULL REFERENCES insight_rules(rule_id),
  severity            text NOT NULL CHECK (severity IN ('info','caution','discuss')),
  title               text NOT NULL,
  description         text NOT NULL,
  biomarkers_involved text[] NOT NULL DEFAULT '{}',
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE(lab_report_id, rule_id)
);

ALTER TABLE insight_rule_results ENABLE ROW LEVEL SECURITY;
CREATE POLICY "irr_select" ON insight_rule_results FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM lab_reports WHERE lab_reports.id=insight_rule_results.lab_report_id AND lab_reports.user_id=auth.uid()));
CREATE POLICY "irr_insert" ON insight_rule_results FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM lab_reports WHERE lab_reports.id=insight_rule_results.lab_report_id AND lab_reports.user_id=auth.uid()));
CREATE POLICY "irr_delete" ON insight_rule_results FOR DELETE TO authenticated USING (EXISTS (SELECT 1 FROM lab_reports WHERE lab_reports.id=insight_rule_results.lab_report_id AND lab_reports.user_id=auth.uid()));

-- =====================================================
-- HEALTH SCORES
-- =====================================================
DROP TABLE IF EXISTS health_scores CASCADE;

CREATE TABLE health_scores (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lab_report_id         uuid NOT NULL REFERENCES lab_reports(id) ON DELETE CASCADE UNIQUE,
  overall_score         numeric NOT NULL DEFAULT 100,
  hormone_score         numeric NOT NULL DEFAULT 100,
  thyroid_score         numeric NOT NULL DEFAULT 100,
  metabolic_score       numeric NOT NULL DEFAULT 100,
  cardiovascular_score  numeric NOT NULL DEFAULT 100,
  liver_score           numeric NOT NULL DEFAULT 100,
  kidney_score          numeric NOT NULL DEFAULT 100,
  inflammation_score    numeric NOT NULL DEFAULT 100,
  nutrient_score        numeric NOT NULL DEFAULT 100,
  score_breakdown       jsonb NOT NULL DEFAULT '{}',
  created_at            timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE health_scores ENABLE ROW LEVEL SECURITY;
CREATE POLICY "hs_select" ON health_scores FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM lab_reports WHERE lab_reports.id=health_scores.lab_report_id AND lab_reports.user_id=auth.uid()));
CREATE POLICY "hs_insert" ON health_scores FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM lab_reports WHERE lab_reports.id=health_scores.lab_report_id AND lab_reports.user_id=auth.uid()));
CREATE POLICY "hs_update" ON health_scores FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM lab_reports WHERE lab_reports.id=health_scores.lab_report_id AND lab_reports.user_id=auth.uid())) WITH CHECK (EXISTS (SELECT 1 FROM lab_reports WHERE lab_reports.id=health_scores.lab_report_id AND lab_reports.user_id=auth.uid()));
CREATE POLICY "hs_delete" ON health_scores FOR DELETE TO authenticated USING (EXISTS (SELECT 1 FROM lab_reports WHERE lab_reports.id=health_scores.lab_report_id AND lab_reports.user_id=auth.uid()));

-- INDEXES
CREATE INDEX IF NOT EXISTS idx_lr_report ON lab_results(lab_report_id);
CREATE INDEX IF NOT EXISTS idx_lr_name ON lab_results(biomarker_name);
CREATE INDEX IF NOT EXISTS idx_dmr_report ON derived_metric_results(lab_report_id);
CREATE INDEX IF NOT EXISTS idx_irr_report ON insight_rule_results(lab_report_id);
CREATE INDEX IF NOT EXISTS idx_hs_report ON health_scores(lab_report_id);
CREATE INDEX IF NOT EXISTS idx_brr_name ON biomarker_reference_ranges(biomarker_name);
