\set ON_ERROR_STOP 1
-- TASK-046 (V2-03c) fixture rows for 20261008000000, committed so the read
-- surface can be captured before and after the migration. One row per case,
-- each with its own owner. The JSON is shared verbatim with
-- claim-authority.test.ts, which asserts the TypeScript read gate
-- (visibleClaimProjection) produces the same expected preview and counts.
--
-- A case stores either an explicit "preview", or "claim_preview": overrides of
-- the fixture's claim_preview (a real claim-era preview, captured from
-- projectBasic), with "claim" shallow-merged into its claim reference.
-- "expected_preview" is "stored" (served as stored) or null.
CREATE TABLE claim_gate_fixture AS SELECT $claim_gate_cases${
  "canary": "Your markers are telling a gentle story about how your energy is settling",
  "floor": {
    "headline": "Your results",
    "cycle_context": {"estimated_cycle_day": 21, "estimated_cycle_phase": "luteal", "confidence": "medium", "explanation": ""},
    "questions_for_doctor": ["What should we recheck next time?"],
    "disclaimer": "This report is for educational purposes only and does not constitute medical advice.",
    "key_findings": [{"biomarker_slug": "ferritin", "status": "attention", "value": 9}],
    "top_findings": [],
    "summary_bullets": [],
    "safety_notes": [],
    "abnormal_flags": [],
    "flags": [],
    "warnings": [],
    "critical_findings": [],
    "what_to_do_next": [],
    "safety_findings": [{"biomarker_slug": "ferritin", "status": "attention", "value": 9}],
    "basic_interpretation": "Your results"
  },
  "claim_preview": {
    "source_path": "/trend_evidence/0",
    "content": {"biomarker_slug": "vitamin_d", "marker": "Vitamin D", "previous_value": 18, "current_value": 31, "delta": 13, "percent_change": 72.222, "unit": "ng/mL", "previous_date": "2026-03-01", "direction": "increased", "summary": "Vitamin D increased 18 → 31 ng/mL since 2026-03-01"},
    "kind": "trend",
    "preview_eligible": true,
    "confidence": null,
    "magnitude_normalized": 0.72222,
    "observed_at": null,
    "visibility_hint": "premium",
    "claim": {"claim_id": "trend:vitamin_d", "category": "factual_observation", "rule": "trend_evidence.significant_change", "policy_version": "v2-03c.1", "recommendation_authority": "none", "safety_authority": "none"}
  },
  "cases": [
    {"name": "legacy AI row: stored model preview and inflated counts", "source": "ai",
     "preview": {"source_path": "/pattern_signals/0", "kind": "cross_marker", "visibility_hint": "premium", "content": {"title": "Your markers are telling a gentle story about how your energy is settling"}},
     "locked": {"patterns": 2, "cross_report": 1, "lifestyle": 3},
     "expected_preview": null, "expected_locked": {"patterns": 0, "cross_report": 0, "lifestyle": 0}},
    {"name": "legacy row: a claim-shaped preview without a version is still legacy", "source": "ai",
     "claim_preview": {}, "locked": {"patterns": 0, "cross_report": 1, "lifestyle": 0},
     "expected_preview": null, "expected_locked": {"patterns": 0, "cross_report": 0, "lifestyle": 0}},
    {"name": "legacy deterministic row is gated the same way", "source": "deterministic",
     "preview": {"source_path": "/pattern_signals/0", "kind": "cross_marker", "visibility_hint": "premium", "content": {"title": "Your markers are telling a gentle story about how your energy is settling"}},
     "locked": {"patterns": 1, "cross_report": 0, "lifestyle": 0},
     "expected_preview": null, "expected_locked": {"patterns": 0, "cross_report": 0, "lifestyle": 0}},
    {"name": "claim era: authorized trend preview and its count", "source": "ai",
     "claim_preview": {}, "locked": {"patterns": 0, "cross_report": 1, "lifestyle": 0, "claim_policy_version": "v2-03c.1"},
     "expected_preview": "stored", "expected_locked": {"patterns": 0, "cross_report": 1, "lifestyle": 0}},
    {"name": "claim era: two locked claims and no preview stay two and none", "source": "ai",
     "preview": null, "locked": {"patterns": 0, "cross_report": 2, "lifestyle": 0, "claim_policy_version": "v2-03c.1"},
     "expected_preview": null, "expected_locked": {"patterns": 0, "cross_report": 2, "lifestyle": 0}},
    {"name": "claim era: the version cannot launder a model preview", "source": "ai",
     "preview": {"source_path": "/pattern_signals/0", "kind": "cross_marker", "visibility_hint": "premium", "content": {"title": "Your markers are telling a gentle story about how your energy is settling"}},
     "locked": {"patterns": 3, "cross_report": 1, "lifestyle": 2, "claim_policy_version": "v2-03c.1"},
     "expected_preview": null, "expected_locked": {"patterns": 3, "cross_report": 1, "lifestyle": 2}},
    {"name": "claim era: a preview claiming safety authority", "source": "ai",
     "claim_preview": {"claim": {"safety_authority": "deterministic_reference_range"}}, "locked": {"patterns": 0, "cross_report": 1, "lifestyle": 0, "claim_policy_version": "v2-03c.1"},
     "expected_preview": null, "expected_locked": {"patterns": 0, "cross_report": 1, "lifestyle": 0}},
    {"name": "claim era: a preview claiming recommendation authority", "source": "ai",
     "claim_preview": {"claim": {"recommendation_authority": "supplement"}}, "locked": {"patterns": 0, "cross_report": 1, "lifestyle": 0, "claim_policy_version": "v2-03c.1"},
     "expected_preview": null, "expected_locked": {"patterns": 0, "cross_report": 1, "lifestyle": 0}},
    {"name": "claim era: a preview from an unknown claim version", "source": "ai",
     "claim_preview": {"claim": {"policy_version": "v9"}}, "locked": {"patterns": 0, "cross_report": 1, "lifestyle": 0, "claim_policy_version": "v2-03c.1"},
     "expected_preview": null, "expected_locked": {"patterns": 0, "cross_report": 1, "lifestyle": 0}},
    {"name": "claim era: a preview of another category or rule", "source": "ai",
     "claim_preview": {"claim": {"category": "safety_alert", "rule": "analyte.reference_range_status"}}, "locked": {"patterns": 0, "cross_report": 1, "lifestyle": 0, "claim_policy_version": "v2-03c.1"},
     "expected_preview": null, "expected_locked": {"patterns": 0, "cross_report": 1, "lifestyle": 0}},
    {"name": "claim era: a floor-kind preview", "source": "ai",
     "claim_preview": {"kind": "floor"}, "locked": {"patterns": 0, "cross_report": 1, "lifestyle": 0, "claim_policy_version": "v2-03c.1"},
     "expected_preview": null, "expected_locked": {"patterns": 0, "cross_report": 1, "lifestyle": 0}},
    {"name": "unknown locked version", "source": "ai",
     "claim_preview": {}, "locked": {"patterns": 0, "cross_report": 1, "lifestyle": 0, "claim_policy_version": "v2-03c.0"},
     "expected_preview": null, "expected_locked": {"patterns": 0, "cross_report": 0, "lifestyle": 0}},
    {"name": "non-string locked version", "source": "ai",
     "claim_preview": {}, "locked": {"patterns": 0, "cross_report": 1, "lifestyle": 0, "claim_policy_version": 42},
     "expected_preview": null, "expected_locked": {"patterns": 0, "cross_report": 0, "lifestyle": 0}},
    {"name": "claim era: non-integer, negative and string counts are zero", "source": "ai",
     "locked": {"patterns": "7", "cross_report": -1, "lifestyle": 1.5, "claim_policy_version": "v2-03c.1"},
     "expected_preview": null, "expected_locked": {"patterns": 0, "cross_report": 0, "lifestyle": 0}},
    {"name": "locked is not an object", "source": "ai",
     "claim_preview": {}, "locked": 5,
     "expected_preview": null, "expected_locked": {"patterns": 0, "cross_report": 0, "lifestyle": 0}},
    {"name": "no preview or locked stored at all", "source": "ai",
     "expected_preview": null, "expected_locked": {"patterns": 0, "cross_report": 0, "lifestyle": 0}}
  ]
}$claim_gate_cases$::jsonb AS fixture;

CREATE TABLE claim_gate_rows AS
SELECT e.n::int AS n, e.c->>'name' AS name, e.c->>'source' AS source,
  ('09200000-0000-4000-8000-'||lpad(e.n::text,12,'0'))::uuid AS user_id,
  ('09210000-0000-4000-8000-'||lpad(e.n::text,12,'0'))::uuid AS report_id,
  (f.fixture->'floor')
    || CASE WHEN e.c ? 'locked' THEN jsonb_build_object('locked',e.c->'locked') ELSE '{}'::jsonb END
    || CASE WHEN e.c ? 'preview' THEN jsonb_build_object('preview',e.c->'preview')
         WHEN e.c ? 'claim_preview' THEN jsonb_build_object('preview',(f.fixture->'claim_preview') || ((e.c->'claim_preview') - 'claim'::text)
           || jsonb_build_object('claim',(f.fixture->'claim_preview'->'claim') || COALESCE(e.c->'claim_preview'->'claim','{}'::jsonb)))
         ELSE '{}'::jsonb END AS basic,
  e.c AS spec
FROM claim_gate_fixture f CROSS JOIN LATERAL jsonb_array_elements(f.fixture->'cases') WITH ORDINALITY AS e(c,n);

INSERT INTO users(id) SELECT user_id FROM claim_gate_rows;
INSERT INTO lab_reports(id,user_id) SELECT report_id,user_id FROM claim_gate_rows;
-- The full body carries a Premium-only marker so a Full read is distinguishable.
INSERT INTO interpretations_private(lab_report_id,json_output,json_output_basic,stored_depth,projection_version,tier,interpretation_source)
SELECT report_id,basic || '{"locked_secret":"FULL_ONLY_CLAIM_GATE"}'::jsonb,basic,'deep',2,'free',source FROM claim_gate_rows;
-- Stored bodies at rest, so every later step can prove no row was rewritten.
CREATE TABLE claim_gate_rows_at_rest AS SELECT id,to_jsonb(i) AS row_data FROM interpretations_private i;
