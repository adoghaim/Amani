/*
  # Record which tier an interpretation was written at

  `generate-interpretation` does not return the interpretation — it writes it to
  `interpretations.json_output` and every client reads it back from the row. So
  the row is the whole contract, and once Free exists there will be two kinds of
  row in this table: a deep AI interpretation and a deterministic one. Nothing
  currently distinguishes them beyond `interpretation_source`, which says
  ai/fallback and therefore conflates "Free user, metered" with "Plus user, the
  model failed".

  ## Why a column and not a field in json_output

  `_shared/nutrient-policy.ts` treats `json_output` as untrusted model prose:
  `sanitizeViolations()` filters every top-level string array in it, and
  `collectFreeformStrings()` walks every string through the medical-boundary
  validator. A `tier` field inside the payload would be scanned by that
  machinery. Upgrade copy placed there could be silently filtered, or — if it
  happened to name a nutrient — could fail validation and force the whole
  interpretation onto the fallback path.

  Tier is our metadata, not the model's output. It belongs outside the blob the
  medical validator polices.

  ## Nullable on purpose

  Every existing row predates tiering and was written for a subscriber or a
  trial user, i.e. what Free/Plus now calls Plus. NULL therefore reads as
  "written before tiering", and the client treats an absent tier as Plus-shaped
  — the same fail-open-on-shape rule as `normalizeTierForClient`.

  Deliberately NOT `NOT NULL DEFAULT 'plus'`: that would let a future code path
  which forgets to set the tier silently record every row as Plus, which is the
  fail-open direction on something we would rather notice.

  This column is descriptive, never an access decision. Entitlement is settled
  before the row is written, by `_shared/tier.ts` and
  `_shared/introductory-access.ts`.
*/

ALTER TABLE interpretations
  ADD COLUMN IF NOT EXISTS tier text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'interpretations_tier_check'
  ) THEN
    ALTER TABLE interpretations
      ADD CONSTRAINT interpretations_tier_check
      CHECK (tier IS NULL OR tier IN ('free', 'plus'));
  END IF;
END $$;

COMMENT ON COLUMN interpretations.tier IS
  'Tier this interpretation was generated at. NULL = written before Free/Plus existed, treated as plus. Descriptive only — never an access decision.';

/*
  No GRANT changes. `interpretations` already carries the RLS from
  20260216193045_initial_schema.sql, and only the service role writes this
  table. A user reading their own tier is correct and expected — the client
  shows "1 of 2 deep reports used".
*/
