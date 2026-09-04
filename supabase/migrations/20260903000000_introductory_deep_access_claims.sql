/*
  # Introductory Deep Access claim ledger

  Amani Free gives every user 2 lifetime full-AI interpretations before Plus is
  required. This is where that is counted.

  ## Why a ledger and not a counter

  The obvious shape is `users.deep_access_credits_remaining`, decremented on
  use. It was rejected. A mutable counter has to defend, separately, against:
  a retry after a network failure decrementing twice; a regeneration of the same
  report costing a second credit; a user deleting and re-uploading a report to
  reset themselves; two concurrent requests both reading `2` and both spending
  the last credit; and — the one this codebase has actually been bitten by — a
  client writing the column directly. `20260823000000_lock_users_privileged_columns.sql`
  exists because Postgres' default GRANT on `users` left `subscription_status`
  and `trial_start_date` client-writable, which bought unlimited AI generations
  billed to our OpenAI key.

  An append-only ledger gets all of that from a unique constraint and a GRANT:

    used credits = count(*) where user_id = ...

  Idempotent by construction, auditable after the fact, and with no "remaining"
  field for anyone to write.

  ## Identity

  `blood_draw_id` is the SHA-256 of a canonical key built by
  `_shared/blood-draw-identity.ts` from server-extracted evidence — accession
  id, else lab + collection datetime, else lab + collection date, else file
  hash, else the report id. It is hashed rather than stored readable because
  the strongest tier embeds a specimen identifier, which does not belong in a
  table in cleartext. `evidence_tier` keeps the audit trail without it.

  `lab_reports.report_date` is never an input: it is client-writable by design
  (users correct it), so entitlement must not depend on it.

  ## Deliberate FK behaviours

  - `report_id ... ON DELETE SET NULL` — deleting the report must NOT return the
    credit, or "delete and re-upload" becomes an infinite free tier. The claim
    outlives the report it was spent on.
  - `user_id ... ON DELETE CASCADE` — account deletion removes claims. Required
    for GDPR erasure; `delete-user-data` also sweeps the table explicitly.

  ## Enforcement

  The 2-claim limit is enforced HERE, not only in the edge function. Two
  concurrent uploads of two different draws would both read `count = 1` in the
  application and both believe they hold the last credit. The trigger takes a
  per-user transaction-scoped advisory lock before counting, which serializes
  claim inserts per user and makes the third one fail rather than race through.
*/

CREATE TABLE IF NOT EXISTS introductory_deep_access_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blood_draw_id text NOT NULL,
  report_id uuid REFERENCES lab_reports(id) ON DELETE SET NULL,
  evidence_tier text NOT NULL,
  claimed_at timestamptz NOT NULL DEFAULT now(),

  -- The idempotency guarantee. One claim per draw, per user, forever.
  CONSTRAINT introductory_deep_access_claims_user_draw_key
    UNIQUE (user_id, blood_draw_id),

  -- Mirrors EvidenceTier in _shared/blood-draw-identity.ts.
  CONSTRAINT introductory_deep_access_claims_evidence_tier_check
    CHECK (evidence_tier IN (
      'accession',
      'lab_collection_datetime',
      'lab_collection_date',
      'content_hash',
      'unidentified'
    )),

  -- A hex SHA-256 and nothing else. Rejects a readable key written by mistake.
  CONSTRAINT introductory_deep_access_claims_draw_id_is_sha256
    CHECK (blood_draw_id ~ '^[0-9a-f]{64}$')
);

CREATE INDEX IF NOT EXISTS introductory_deep_access_claims_user_id_idx
  ON introductory_deep_access_claims (user_id);

/*
  Hard limit, held at the boundary the application cannot race past.

  `pg_advisory_xact_lock` is keyed on the user, so concurrent claim inserts for
  one user serialize while different users proceed in parallel. The lock is
  released at commit or rollback — no unlock path to leak.
*/
CREATE OR REPLACE FUNCTION enforce_introductory_claim_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  claim_count integer;
  claim_limit constant integer := 2;  -- FREE_INTRODUCTORY_DEEP_ACCESS_CLAIMS
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('introductory_claim:' || NEW.user_id::text));

  /*
    A re-claim of a draw the user already holds is idempotent, not a limit
    breach. Without this, a retry by a user who has spent both credits raises
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

DROP TRIGGER IF EXISTS enforce_introductory_claim_limit_trigger
  ON introductory_deep_access_claims;

CREATE TRIGGER enforce_introductory_claim_limit_trigger
  BEFORE INSERT ON introductory_deep_access_claims
  FOR EACH ROW
  EXECUTE FUNCTION enforce_introductory_claim_limit();

/*
  Claims are immutable — with exactly one exception.

  `report_id ... ON DELETE SET NULL` is implemented as an UPDATE on this table,
  so a blanket UPDATE-rejecting trigger does not merely protect the ledger: it
  makes `DELETE FROM lab_reports` fail for any user who holds a claim, i.e. it
  breaks report deletion outright. Caught by applying this migration to a real
  Postgres before shipping it.

  So the trigger permits precisely that one transition — `report_id` going from
  non-null to null with every other column unchanged — and rejects everything
  else. Editing `blood_draw_id`, `user_id`, `evidence_tier` or `claimed_at` to
  recover a spent credit stays impossible.
*/
CREATE OR REPLACE FUNCTION reject_introductory_claim_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.id           IS NOT DISTINCT FROM OLD.id
 AND NEW.user_id      IS NOT DISTINCT FROM OLD.user_id
 AND NEW.blood_draw_id IS NOT DISTINCT FROM OLD.blood_draw_id
 AND NEW.evidence_tier IS NOT DISTINCT FROM OLD.evidence_tier
 AND NEW.claimed_at   IS NOT DISTINCT FROM OLD.claimed_at
 AND NEW.report_id    IS NULL
 AND OLD.report_id    IS NOT NULL
  THEN
    -- The FK nulling out a deleted report. The claim itself is untouched.
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'introductory_deep_access_claims rows are immutable'
    USING ERRCODE = 'check_violation';
END;
$$;

DROP TRIGGER IF EXISTS reject_introductory_claim_update_trigger
  ON introductory_deep_access_claims;

CREATE TRIGGER reject_introductory_claim_update_trigger
  BEFORE UPDATE ON introductory_deep_access_claims
  FOR EACH ROW
  EXECUTE FUNCTION reject_introductory_claim_mutation();

ALTER TABLE introductory_deep_access_claims ENABLE ROW LEVEL SECURITY;

/*
  Users may read their own claims — the client shows "1 of 2 deep reports
  used", and that number must come from the ledger rather than a client guess.
  No write policy exists, so RLS denies every write from a user session.
*/
DROP POLICY IF EXISTS "Users can read own introductory claims"
  ON introductory_deep_access_claims;

CREATE POLICY "Users can read own introductory claims"
  ON introductory_deep_access_claims
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

/*
  Second lock, at the GRANT level, following
  `20260821010000_lock_iap_subscriptions_writes.sql`. RLS alone would leave one
  over-broad policy — or RLS being switched off — between a client and a
  self-granted credit. Every row here is worth money.
*/
REVOKE ALL ON TABLE introductory_deep_access_claims FROM anon;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE introductory_deep_access_claims FROM authenticated;

GRANT SELECT ON TABLE introductory_deep_access_claims TO authenticated;
