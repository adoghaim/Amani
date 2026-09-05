/*
  # commit_deep_access — one transaction for the interpretation and the credit

  `_shared/introductory-access.ts` states a contract that PostgREST cannot
  express:

      AI generation succeeds
             |
           BEGIN
             save interpretation
             insert claim, if this draw consumes one
           COMMIT
             |
      return the full interpretation

  Two supabase-js calls cannot do that. Between them sits a window where the
  premium interpretation is persisted and the credit is not — and an earlier
  draft of that module made exactly that mistake, treating a failed claim write
  as non-fatal. If the claim insert were broken for an hour, every Free user
  would keep receiving full AI interpretations because nothing recorded the
  spend. A broken ledger would silently become unlimited Plus.

  A plpgsql function is a single transaction, so this closes that window.

  ## Ordering inside the function

  The claim is attempted FIRST, before the interpretation is written. That is
  the whole point: a request that loses the race for the last credit must not
  leave a premium row behind. If the ledger refuses, we return `limit_reached`
  having written nothing, and the caller serves the Free result.

  ## Return values, not exceptions

  `already_claimed` and `limit_reached` are ordinary outcomes, not errors:

    committed        both writes landed, a credit was spent if one was due
    already_claimed  the draw was already claimed — a retry, a regeneration, or
                     the same-day collision the date-only evidence tier can
                     produce. The interpretation is still saved; no second
                     credit is spent.
    limit_reached    the ledger refused. NOTHING was persisted.

  Anything genuinely broken still raises, so the edge function surfaces an error
  the user can retry rather than a premium response with no ledger entry.

  ## SECURITY DEFINER

  Callable only by service_role — the edge function's identity. `authenticated`
  is explicitly denied EXECUTE, because this function writes the ledger and
  bypasses RLS by design. `search_path` is pinned, per the pattern in
  20260903000000.
*/

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
  IF p_consume_credit THEN
    BEGIN
      INSERT INTO introductory_deep_access_claims
        (user_id, blood_draw_id, report_id, evidence_tier)
      VALUES
        (p_user_id, p_blood_draw_id, p_report_id, p_evidence_tier);
    EXCEPTION
      WHEN unique_violation THEN
        -- Already claimed. Idempotent: save the interpretation, spend nothing.
        outcome := 'already_claimed';
      WHEN check_violation THEN
        /*
          The per-user limit trigger refused a third claim, or a constraint
          rejected the row. Return without writing the interpretation — this is
          the fail-closed path, and it is why the claim goes first.
        */
        RETURN 'limit_reached';
    END;
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
