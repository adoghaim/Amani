# shellcheck shell=bash
# A case of the migration harness. run.sh sources every cases/NNN-name.sh in
# lexical order in one shell; see its header. Not a standalone script.
#
# PK-HARM-01: 20261015020000_interpretation_feedback.sql, "Report a problem
# with this interpretation" (D20) and its service-role review queue.
#
# Its own database, interpretation_feedback, with Supabase's roles, auth.uid()
# and default privileges, and stubs of the report tables the migration names
# (interpretation-feedback.prelude.sql). Uses nothing an earlier case leaves
# except the container; leaves the interpretation_feedback and
# interpretation_feedback_bare databases and /tmp/interpretation-feedback.*
# files, which no later case uses.
#
# Proves: the shape; the one-shot guard (a replay is refused and changes
# nothing); the prerequisite guard; RLS and the privilege matrix, by catalog
# and by trying as each role (the owner inserts and reads her own rows only,
# never edits or deletes; anon has nothing; service_role reads the queue,
# moves status, deletes); the 1,000-character cap and blank text refused; the
# explanation named must be one of the report's own; "Something here worried
# me" leads the queue; status changes are server-stamped and nothing she sent
# can be rewritten; both triggers are ENABLE ALWAYS and fire under
# session_replication_role = replica; erasure by report, by the
# delete-user-data sweep and by the auth identity.
# Details: interpretation-feedback.verify.sql.

FEEDBACK_MIGRATION=20261015020000_interpretation_feedback.sql

echo
echo "==> interpretation feedback: one-shot apply, RLS, grants, queue, erasure"
docker exec -e PGOPTIONS='-c client_min_messages=warning' "$CONTAINER" \
  psql -q -U postgres -d amani -c "CREATE DATABASE interpretation_feedback" >/dev/null

docker cp "$HERE/../$FEEDBACK_MIGRATION" "$CONTAINER:/tmp/$FEEDBACK_MIGRATION" >/dev/null
for file in interpretation-feedback.prelude.sql interpretation-feedback.verify.sql; do
  docker cp "$HERE/$file" "$CONTAINER:/tmp/$file" >/dev/null
done

psql_fb() { docker exec -i "$CONTAINER" psql -U postgres -d interpretation_feedback -v ON_ERROR_STOP=1 "$@"; }

psql_fb -q -f /tmp/interpretation-feedback.prelude.sql
psql_fb -q -f "/tmp/$FEEDBACK_MIGRATION" >/dev/null

# One-shot: a replay must fail at the guard, inside the migration's own
# transaction, and leave the catalog exactly as it was.
fb_snapshot() {
  psql_fb -tA -c "SELECT string_agg(x, E'\n' ORDER BY x) FROM (
      SELECT 'column:' || table_name || '.' || column_name || ':' || data_type AS x FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name LIKE 'interpretation_feedback%'
      UNION ALL SELECT 'policy:' || policyname FROM pg_policies WHERE tablename = 'interpretation_feedback'
      UNION ALL SELECT 'trigger:' || tgname || ':' || tgenabled::text FROM pg_trigger
       WHERE tgrelid = 'public.interpretation_feedback'::regclass AND NOT tgisinternal
      UNION ALL SELECT 'grant:' || table_name || ':' || grantee || ':' || privilege_type
        FROM information_schema.role_table_grants WHERE table_name LIKE 'interpretation_feedback%') s"
}
fb_snap0=$(fb_snapshot)
if fb_replay=$(psql_fb -q -f "/tmp/$FEEDBACK_MIGRATION" 2>&1); then
  echo "FAIL: $FEEDBACK_MIGRATION applied a second time" >&2
  exit 1
fi
if ! grep -q 'PK-HARM-01 interpretation feedback is already applied; this migration is one-shot' <<<"$fb_replay"; then
  echo "FAIL: $FEEDBACK_MIGRATION replay was refused for an unexpected reason: $fb_replay" >&2
  exit 1
fi
if [ "$(fb_snapshot)" != "$fb_snap0" ]; then
  echo "FAIL: the refused replay of $FEEDBACK_MIGRATION changed the catalog" >&2
  exit 1
fi
# Not vacuous: the snapshot covers both triggers and all five policies.
if [ "$(grep -c '^trigger:' <<<"$fb_snap0")" != 2 ] || [ "$(grep -c '^policy:' <<<"$fb_snap0")" != 5 ]; then
  echo "FAIL: the interpretation feedback snapshot does not cover the triggers and policies" >&2
  exit 1
fi
echo "    replay refused at the one-shot guard; catalog unchanged"

# Without the interpretation version foundation the migration refuses to start.
docker exec -e PGOPTIONS='-c client_min_messages=warning' "$CONTAINER" \
  psql -q -U postgres -d amani -c "CREATE DATABASE interpretation_feedback_bare" >/dev/null
if fb_bare=$(docker exec -i "$CONTAINER" psql -U postgres -d interpretation_feedback_bare -v ON_ERROR_STOP=1 -q \
  -f "/tmp/$FEEDBACK_MIGRATION" 2>&1); then
  echo "FAIL: $FEEDBACK_MIGRATION applied without the interpretation version foundation" >&2
  exit 1
fi
if ! grep -q 'Apply the interpretation version foundation (20261010000000) before PK-HARM-01' <<<"$fb_bare"; then
  echo "FAIL: $FEEDBACK_MIGRATION was refused for an unexpected reason without its prerequisites: $fb_bare" >&2
  exit 1
fi
echo "    refused without its prerequisites"

psql_fb -q -f /tmp/interpretation-feedback.verify.sql

# factory/gates.md G3: every trigger this migration creates is classified in the
# post-deploy query factory/sql/verify-triggers-enable-always.sql, checked here where
# the migration is applied (tea_check_classified: trigger-enable-always.run.sh, case 170).
tea_check_classified INTERPRETATION-FEEDBACK psql_fb \
  'public|interpretation_feedback|interpretation_feedback_before_insert|safety|A|A|ok|20261015020000' \
  'public|interpretation_feedback|interpretation_feedback_before_update|safety|A|A|ok|20261015020000'

# Deploy order (PK-HARM-01 review): the owner's read-only preflight,
# factory/sql/verify-account-deletion-tables.sql, run here for real. This
# database holds only the prelude's stubs, so the tables it lacks are first
# stubbed (never interpretation_feedback, which the migration created); then
# the preflight must return zero rows, and with interpretation_feedback gone
# (renamed inside a rolled-back transaction, as on a project the migration has
# not reached) exactly that table and its migration.
docker cp "$HERE/../../../factory/sql/verify-account-deletion-tables.sql" \
  "$CONTAINER:/tmp/verify-account-deletion-tables.sql" >/dev/null
fb_missing=$(psql_fb -tA -F'|' -f /tmp/verify-account-deletion-tables.sql)
if grep -q '^interpretation_feedback|' <<<"$fb_missing"; then
  echo "FAIL: the deletion preflight reports interpretation_feedback missing after its migration" >&2
  exit 1
fi
# (psql_fb is docker exec -i, which would swallow a loop's stdin: build one batch.)
fb_stubs=""
while IFS='|' read -r fb_table _; do
  [ -n "$fb_table" ] || continue
  fb_stubs+="CREATE TABLE public.\"$fb_table\" (id uuid, user_id uuid); "
done <<<"$fb_missing"
if [ -n "$fb_stubs" ]; then psql_fb -q -c "$fb_stubs" </dev/null >/dev/null; fi
if [ -n "$(psql_fb -tA -f /tmp/verify-account-deletion-tables.sql)" ]; then
  echo "FAIL: the deletion preflight reports a table missing once every table exists" >&2
  exit 1
fi
fb_early=$(psql_fb -tA -F'|' -c "BEGIN" -c "ALTER TABLE public.interpretation_feedback RENAME TO interpretation_feedback_hidden" \
  -f /tmp/verify-account-deletion-tables.sql -c "ROLLBACK")
if [ "$(grep -v '^$' <<<"$fb_early" | grep -vE '^(BEGIN|ALTER TABLE|ROLLBACK)$')" != "interpretation_feedback|20261015020000" ]; then
  echo "FAIL: the deletion preflight did not name interpretation_feedback and 20261015020000 before the migration: $fb_early" >&2
  exit 1
fi
echo "    deletion preflight: zero rows with every table; names interpretation_feedback|20261015020000 without it"

echo
echo "PASS: interpretation feedback: one-shot replay, prerequisites, RLS and grants by role, 1,000-character cap, explanation identity, review queue order, server-stamped status, ENABLE ALWAYS triggers under replica, erasure, deletion deploy preflight."
