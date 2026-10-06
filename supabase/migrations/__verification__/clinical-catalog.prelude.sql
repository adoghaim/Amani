-- Local synthetic DB, not a production dump. Identity/catalog data is supplied separately.
-- The phase-table DDL is a fixture: no checked-in migration defines that table.
-- Its 15 conflict rows come from the Lead inventory; remaining rows are sentinels.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon,authenticated,service_role;
CREATE TABLE IF NOT EXISTS canonical_analytes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text UNIQUE NOT NULL,
  display_name text NOT NULL,
  category text NOT NULL,
  subcategory text,
  unit text,
  is_core boolean NOT NULL DEFAULT false,
  is_ratio boolean NOT NULL DEFAULT false,
  affects_scoring boolean NOT NULL DEFAULT false,
  affects_recommendations boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE canonical_analytes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read canonical_analytes"
  ON canonical_analytes FOR SELECT
  TO authenticated
  USING (true);

-- analyte_synonyms: maps raw report labels to canonical slugs
CREATE TABLE IF NOT EXISTS analyte_synonyms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_analyte_id uuid NOT NULL REFERENCES canonical_analytes(id) ON DELETE CASCADE,
  synonym_text text NOT NULL,
  source_type text NOT NULL DEFAULT 'generic',
  created_at timestamptz DEFAULT now(),
  UNIQUE(synonym_text, source_type)
);

ALTER TABLE analyte_synonyms ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read analyte_synonyms"
  ON analyte_synonyms FOR SELECT
  TO authenticated
  USING (true);

CREATE INDEX IF NOT EXISTS idx_analyte_synonyms_text ON analyte_synonyms(synonym_text);
CREATE INDEX IF NOT EXISTS idx_analyte_synonyms_canonical_id ON analyte_synonyms(canonical_analyte_id);

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

CREATE TABLE public.biomarker_phase_ranges (LIKE public.biomarker_reference_ranges INCLUDING ALL);
INSERT INTO public.biomarker_phase_ranges (biomarker_name,phase,optimal_min,optimal_max,clinical_min,clinical_max)
VALUES
('estradiol','follicular',30,200,12,300),
('estradiol','luteal',60,200,12,250),
('estradiol','menstrual',20,80,12,100),
('estradiol','ovulatory',150,350,100,500),
('fsh','follicular',3,10,2,20),
('fsh','luteal',1,8,1,12),
('fsh','menstrual',3,10,2,20),
('fsh','ovulatory',6,20,5,30),
('lh','follicular',1,12,1,15),
('lh','luteal',1,10,1,15),
('lh','menstrual',1,10,1,15),
('lh','ovulatory',15,70,10,100),
('progesterone','follicular',0.1,1.0,0.1,1.5),
('progesterone','luteal',5.0,20.0,2.0,25.0),
('progesterone','menstrual',0.1,0.9,0.1,1.0);
-- Seven non-conflicting fixture rows to reach the observed count 22.
INSERT INTO public.biomarker_phase_ranges(biomarker_name,phase,optimal_min,optimal_max,clinical_min,clinical_max)
SELECT biomarker_name,phase,optimal_min,optimal_max,clinical_min,clinical_max FROM public.biomarker_reference_ranges r
WHERE (biomarker_name,phase) NOT IN (SELECT biomarker_name,phase FROM public.biomarker_phase_ranges)
ORDER BY biomarker_name,phase LIMIT 7;
ALTER TABLE public.biomarker_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.biomarker_reference_ranges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.biomarker_phase_ranges ENABLE ROW LEVEL SECURITY;
CREATE POLICY fixture_definitions_read ON public.biomarker_definitions FOR SELECT TO authenticated USING(true);
CREATE POLICY fixture_reference_read ON public.biomarker_reference_ranges FOR SELECT TO authenticated USING(true);
CREATE POLICY fixture_phase_read ON public.biomarker_phase_ranges FOR SELECT TO authenticated USING(true);
-- Representative dependency on extraction UUIDs: must survive both directions.
CREATE TABLE public.fixture_extraction_link(id uuid REFERENCES public.canonical_analytes(id));
