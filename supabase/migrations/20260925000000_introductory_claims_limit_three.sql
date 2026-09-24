-- TS FREE_INTRODUCTORY_DEEP_ACCESS_CLAIMS and the DB limit must agree: 3.
CREATE OR REPLACE FUNCTION enforce_introductory_claim_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  claim_count integer;
  claim_limit constant integer := 3;  -- FREE_INTRODUCTORY_DEEP_ACCESS_CLAIMS
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('introductory_claim:' || NEW.user_id::text));

  /*
    A re-claim of a draw the user already holds is idempotent, not a limit
    breach. Without this, a retry by a user who has spent all credits raises
    "limit reached" from here before the unique constraint is ever evaluated,
    and the caller records `limit_reached` for what is really `already_claimed`.
    Both are harmless no-ops, but the ledger's whole point is being able to
    explain itself afterwards. Let the unique constraint answer instead.
  */
  IF EXISTS (
    SELECT 1 FROM introductory_deep_access_claims
     WHERE user_id = NEW.user_id
       AND blood_draw_id = NEW.blood_draw_id
  ) THEN
    RETURN NEW;
  END IF;

  SELECT count(*) INTO claim_count
    FROM introductory_deep_access_claims
   WHERE user_id = NEW.user_id;

  IF claim_count >= claim_limit THEN
    RAISE EXCEPTION
      'introductory deep access limit reached for user % (% of %)',
      NEW.user_id, claim_count, claim_limit
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

