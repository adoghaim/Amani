\set ON_ERROR_STOP 1
-- Runs after 20260926000000 (prepare) and BEFORE 20260926000003, so the rows
-- below carry the prepare-era floor-only Basic that 000003 must repair.
-- The deterministic fixture is shared verbatim with interpretation-visibility.test.ts.
CREATE TABLE deterministic_prompt_fixture AS SELECT $deterministic_fixture${
  "headline": "1 value outside reference range. Ferritin is the most notable finding.",
  "summary_bullets": ["Of 12 analytes reviewed: 1 out of range."],
  "top_findings": [
    {
      "biomarker_slug": "ferritin",
      "title": "Ferritin",
      "status": "discuss",
      "explanation": "Your Ferritin result was 9 ng/mL."
    }
  ],
  "pattern_signals": [
    {
      "title": "Nutrient cluster",
      "confidence": "medium",
      "explanation": "DETERMINISTIC_PATTERN",
      "related_biomarkers": ["ferritin", "hemoglobin"]
    }
  ],
  "overall_interpretation": "DETERMINISTIC_OVERALL",
  "cycle_context": {
    "estimated_cycle_day": null,
    "estimated_cycle_phase": "unknown",
    "confidence": "low",
    "explanation": "Cycle timing was not available for this report."
  },
  "questions_for_doctor": ["What does my ferritin mean?"],
  "disclaimer": "Educational",
  "trend_evidence": [
    {
      "biomarker_slug": "vitamin_d",
      "marker": "Vitamin D",
      "previous_value": 18,
      "current_value": 31,
      "delta": 13,
      "percent_change": 72.222,
      "unit": "ng/mL",
      "previous_date": "2026-03-01",
      "direction": "increased",
      "summary": "Vitamin D increased 18 → 31 ng/mL since 2026-03-01"
    },
    {
      "biomarker_slug": "tsh",
      "marker": "TSH",
      "previous_value": 2,
      "current_value": 2.6,
      "delta": 0.6,
      "percent_change": 30,
      "unit": "mIU/L",
      "previous_date": "2026-03-01",
      "direction": "increased",
      "summary": "TSH increased 2 → 2.6 mIU/L since 2026-03-01"
    },
    {
      "biomarker_slug": "ferritin",
      "marker": "Ferritin",
      "previous_value": 20,
      "current_value": 9,
      "delta": -11,
      "percent_change": -55,
      "unit": "ng/mL",
      "previous_date": "2026-03-01",
      "direction": "decreased",
      "summary": "Ferritin decreased 20 → 9 ng/mL since 2026-03-01"
    }
  ]
}$deterministic_fixture$::jsonb AS payload;

INSERT INTO users(id) VALUES ('09000000-0000-4000-8000-000000000050');
INSERT INTO lab_reports(id,user_id)
SELECT ('09100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  '09000000-0000-4000-8000-000000000050'::uuid FROM generate_series(50,54) n;
-- 50 fallback, 51 deterministic, 52 ai, 53 NULL source: legacy-writer inserts, so
-- the prepare trigger computes a floor-only Basic (narrative stripped) for all four.
INSERT INTO interpretations(lab_report_id,json_output,tier,interpretation_source)
SELECT ('09100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid, payload, 'free',
  CASE n WHEN 50 THEN 'fallback' WHEN 51 THEN 'deterministic' WHEN 52 THEN 'ai' ELSE NULL END
FROM deterministic_prompt_fixture CROSS JOIN generate_series(50,53) n;
-- 54: a TS writer already stored a narrative-bearing Basic with its own preview.
INSERT INTO interpretations(lab_report_id,json_output,json_output_basic,tier,interpretation_source)
SELECT '09100000-0000-4000-8000-000000000054', payload,
  interpretation_floor(payload) || jsonb_build_object('overall_interpretation',payload->'overall_interpretation',
    'pattern_signals',payload->'pattern_signals','preview','"TS_SELECTED_PREVIEW"'::jsonb),
  'free','fallback'
FROM deterministic_prompt_fixture;
DO $$ BEGIN
  IF (SELECT count(*) FROM interpretations WHERE lab_report_id::text LIKE '09100000-0000-4000-8000-00000000005%'
      AND NOT json_output_basic ? 'overall_interpretation') <> 4 THEN
    RAISE EXCEPTION 'FAIL: deterministic fixture did not start floor-only';
  END IF;
END $$;
\echo 'deterministic fixture installed with prepare-era floor-only Basic'
