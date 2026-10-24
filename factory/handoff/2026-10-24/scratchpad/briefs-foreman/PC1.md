# PC1 — Land the already-applied partner_code_counts migration on main, with harness coverage

Track: partner-codes. Branch `factory/rv-partner-code-counts` (already created by the lead: origin/main 25d09b7 + cherry-pick of the owner's commit b60fe06 as 1953a29). Seat: opus.

## Why
`supabase db push` from main fails: "Remote migration versions not found in local migrations directory" for `20261022180000`. The owner applied `supabase/migrations/20261022180000_partner_code_counts.sql` to production on 2026-10-22 from a local-only branch (`feat/partner-code-counts`, commit b60fe06, never pushed, no PR). Production's migration history therefore holds a version main does not have. The fix is to land the file on main exactly as applied — NOT `supabase migration repair --status reverted` (that would record it reverted while the view exists in production).

## Decisions (already made — do not revisit)
1. **The migration file is frozen.** It is applied in production, so rule D6 applies in spirit: the SQL file must stay byte-identical to b60fe06 (`git diff b60fe06 HEAD -- supabase/migrations/20261022180000_partner_code_counts.sql` must be empty). No new migration in this packet. If the file is wrong, report it under handoffs/concerns; do not change it.
2. The view is reporting-only: `security_invoker = true`, `REVOKE ALL ... FROM PUBLIC, anon, authenticated, service_role; GRANT SELECT ... TO service_role`. Coverage must prove that, not change it.
3. No web or edge-function code. No dashboard/runtime change.

## What to do
- Add verification-harness coverage the repo's conventions require for a new migration (look at how `20261015010000_first_party_events.sql` is covered: `supabase/migrations/__verification__/cases/220-first-party-events.sh`, `first-party-events.verify.sql`, and the migration→case map test in `supabase/functions/_shared/verification-harness.test.ts` or wherever main enforces that every migration is named by a case). A new case (the next free number) plus a verify SQL that asserts, on a chain applied in order from empty:
  - the view exists and `security_invoker` is on (check `pg_class.reloptions`);
  - anon and authenticated hold no privilege on it (SELECT refused 42501 under `SET ROLE`); service_role holds SELECT only;
  - a seeded synthetic fixture (synthetic ids/codes only) yields the expected counts per code_type/code: signups from `user_attribution`, anon visitors from `app_events.props`, first_reports via `interpretation_versions`→`lab_reports`, paid via an active Stripe subscription or non-sandbox IAP; codes are upper-cased; `SMOKETEST%` codes and `smoketest-%` anon ids are excluded;
  - psql runs with ON_ERROR_STOP=1 and the case fails loudly (follow case 220's pattern).
- Mutation checks (temporary, in your worktree only, restored): e.g. GRANT SELECT TO authenticated, the smoke-test filter dropped, security_invoker off — each must turn the case red. Apply mutations to a scratch copy fed to the harness; never commit them.
- Gates: lint, typecheck, full test, build, migorder, functions, and `gates harness` (Docker required; the harness lock serializes with the db-security track — retry on exit 99 as usual).

## Files this packet owns
- `supabase/migrations/__verification__/cases/<new>-partner-code-counts.sh`
- `supabase/migrations/__verification__/partner-code-counts.verify.sql`
- any map/list in `supabase/functions/_shared/verification-harness.test.ts` (or equivalent) that must name the new migration/case
- NOT `factory/STATUS.md` / `factory/status.json` (the lead writes the ledger).

## Out of scope / handoffs
- The db-security track (branch `factory/rv-db-security`, DB1–DB3) rewrites the harness (Postgres 17, full-chain replay case 240, grant audit). It is based on an older main and re-merges main at landing; whichever lands second adds this migration to its lists. Describe under handoffs what case 240's replay and grant audit will need for this view.

## Acceptance
- Migration file byte-identical to b60fe06.
- New case red under each mutation, green at head; full harness green.
- All gates above pass.
