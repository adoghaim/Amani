-- Port of PR #52: claim and save are one transaction, service_role only.
-- The existing draw key prevents re-upload charges. The report key additionally
-- guarantees at most one claim per interpretation, even if evidence changes.
CREATE UNIQUE INDEX IF NOT EXISTS introductory_deep_access_claims_report_key
  ON introductory_deep_access_claims (report_id) WHERE report_id IS NOT NULL;

CREATE OR REPLACE FUNCTION commit_deep_access(
  p_user_id        uuid,
  p_report_id      uuid,
  p_blood_draw_id  text,
  p_evidence_tier  text,
  p_interpretation jsonb,
  p_source         text,
  p_tier           text,
  p_consume_credit boolean
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  outcome text := 'committed';
BEGIN
  -- The same lock as the trigger, held through BOTH writes. Under the default
  -- READ COMMITTED isolation, each following statement sees the last winner.
  PERFORM pg_advisory_xact_lock(hashtext('introductory_claim:' || p_user_id::text));

  -- Bind the report to the caller; lock it against deletion/ownership changes.
  PERFORM 1 FROM lab_reports
    WHERE id = p_report_id AND user_id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'report does not belong to user' USING ERRCODE = '23503';
  END IF;
  IF p_tier IS DISTINCT FROM 'plus' OR p_source IS DISTINCT FROM 'ai'
     OR p_interpretation IS NULL OR jsonb_typeof(p_interpretation) <> 'object' THEN
    RAISE EXCEPTION 'deep access requires a generated Plus interpretation'
      USING ERRCODE = '22023';
  END IF;

  -- A report maps to exactly one interpretation (UNIQUE lab_report_id).
  -- Check report identity too: changed file evidence cannot charge it twice.
  IF EXISTS (SELECT 1 FROM introductory_deep_access_claims
             WHERE user_id = p_user_id
               AND (blood_draw_id = p_blood_draw_id OR report_id = p_report_id)) THEN
    outcome := 'already_claimed';
  ELSE
    IF NOT p_consume_credit OR p_consume_credit IS NULL THEN
      RAISE EXCEPTION 'an unclaimed report must consume a credit'
        USING ERRCODE = '22023';
    END IF;
    -- TS FREE_INTRODUCTORY_DEEP_ACCESS_CLAIMS and the trigger must agree: 3.
    IF (SELECT count(*) FROM introductory_deep_access_claims
        WHERE user_id = p_user_id) >= 3 THEN
      RETURN 'limit_reached';
    END IF;
    INSERT INTO introductory_deep_access_claims
      (user_id, blood_draw_id, report_id, evidence_tier)
    VALUES (p_user_id, p_blood_draw_id, p_report_id, p_evidence_tier);
    -- Do not swallow constraint errors: malformed input is not exhaustion.
    -- Any failure of the interpretation write below rolls this insert back.
  END IF;

  INSERT INTO interpretations
    (lab_report_id, json_output, interpretation_source, tier, generated_at, disclaimer_version)
  VALUES
    (p_report_id, p_interpretation, p_source, p_tier, now(), '1.0')
  ON CONFLICT (lab_report_id) DO UPDATE
    SET json_output           = EXCLUDED.json_output,
        interpretation_source = EXCLUDED.interpretation_source,
        tier                  = EXCLUDED.tier,
        generated_at          = EXCLUDED.generated_at,
        disclaimer_version    = EXCLUDED.disclaimer_version;

  RETURN outcome;
END;
$$;

/*
  Only the service role may call this. `authenticated` must never reach a
  function that writes the credit ledger — the whole design keeps that table
  out of client hands.
*/
REVOKE ALL ON FUNCTION commit_deep_access(uuid, uuid, text, text, jsonb, text, text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION commit_deep_access(uuid, uuid, text, text, jsonb, text, text, boolean) FROM anon;
REVOKE ALL ON FUNCTION commit_deep_access(uuid, uuid, text, text, jsonb, text, text, boolean) FROM authenticated;
GRANT EXECUTE ON FUNCTION commit_deep_access(uuid, uuid, text, text, jsonb, text, text, boolean) TO service_role;

COMMENT ON FUNCTION commit_deep_access IS
  'Persists an interpretation and consumes an Introductory Deep Access credit in one transaction. Returns committed | already_claimed | limit_reached. service_role only.';
