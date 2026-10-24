## Packet
PC1: land the production-applied `partner_code_counts` migration on `main`, unchanged, with harness coverage. New packet (no RV ledger entry). It fixes `supabase db push`, which fails on `main` today.

## What already existed
`supabase db push` from `main` stops with "Remote migration versions not found in local migrations directory" for `20261022180000`. That migration (`partner_code_counts`, a service_role-only reporting view of signups, first reports and paid conversions per ref/promo code) was applied to production on 2026-10-22 from a local branch that was never pushed (`feat/partner-code-counts`, b60fe06). `supabase migration list` on 2026-10-24: every migration on `main` is applied, and `20261022180000` is remote-only. So production's history holds a version `main` lacks, and there is nothing else to push.

The CLI's suggested `supabase migration repair --status reverted 20261022180000` would be wrong: it records the migration as undone while the view exists in production.

## What changed
- `supabase/migrations/20261022180000_partner_code_counts.sql`: the owner's commit, cherry-picked. **Byte-identical to b60fe06** (diff 0 bytes, same sha256). It is applied in production, so it is frozen.
- `supabase/migrations/__verification__/cases/250-partner-code-counts.sh` (new): its own database, a prelude, then the real Stripe, IAP and first-party-events migrations in version order, then the frozen migration, with `ON_ERROR_STOP=1`. It checks that a replay is refused and the catalog snapshot is unchanged.
- `__verification__/partner-code-counts.prelude.sql` (new): Supabase roles, auth stub, default privileges, and `lab_reports` / `interpretation_versions` stubs with production grants.
- `__verification__/partner-code-counts.verify.sql` (new): view shape; `security_invoker` in reloptions; the ACL is exactly service_role SELECT; anon and authenticated refused (42501); a run-as-caller probe; counts over a synthetic fixture (upper-casing, smoke-test exclusions, Stripe statuses, deleted rows, sandbox IAP).
- `supabase/functions/_shared/partner-code-counts-harness.test.ts` (new): pins the migration's sha256 to b60fe06 and requires exactly one `ON_ERROR_STOP` case to apply and verify it.

## Acceptance criteria → proof
| Criterion | Test / artifact | Result |
|---|---|---|
| Migration file unchanged from what production ran | `git diff b60fe06 HEAD -- supabase/migrations/20261022180000_partner_code_counts.sql` empty; sha256 pin test (one appended byte turns it red) | pass |
| Lockdown proven: service_role SELECT only, invoker rights | Case 250 red under each of 10 builder migration mutations (grants to authenticated/anon, INSERT to service_role, REVOKE dropped, `security_invoker=false`, each filter dropped) and 8 database mutations; verifier reran 12 migration mutations (all red but one equivalent survivor: an existing CHECK already refuses empty codes) and 5 database mutations | pass |
| Counts match the view's definition | synthetic fixture in `partner-code-counts.verify.sql` | pass |
| Harness test exists for the migration | Vitest red with the case file moved aside, green at head | pass |

## Gates
<!-- GATES -->
- [x] **G3** database: no new migration; the applied one is landed unchanged. Full harness green (`run.sh`, case 250 PASS). Not run on Postgres 17 (this branch's harness is 15; the db-security track moves it to 17) — see handoffs.
- [x] **G4** clinical authority. The independent verifier wrote: "G4 clinical authority: pass — the change adds no clinical rule" (SQL harness fixtures and a pin test only).
- [ ] **G2** native: not applicable.
- [ ] **G5** owner approval (Mohammed merges)

Independent blind verifier (Opus, 2026-10-24) at `88cf9ab`: **PASS_WITH_NOTES**. It reran lint, typecheck, full test (3,352), build, migration order, the edge-function typecheck and the full harness. Notes: (1) the "client roles refused, by trying" block accepts any insufficient-privilege error, and because the view is `security_invoker` anon/authenticated are refused at `user_attribution` anyway, so that block does not isolate the view's own ACL; the exact-ACL assertion does. (2) `factory/sql/verify-privileges.sql` does not list `partner_code_counts` yet (factory/gates.md G3 step 2): that file is being rewritten by the db-security track, so the entry is handed off there.

Pending (could not run, and why):
- Production's live view, grants and history were not inspected; no production access was used. After merge, run `supabase migration list` (or `supabase db push --dry-run`) and confirm `20261022180000` shows on both sides.
- Case 250 on Postgres 17 and inside db-security's full-chain replay (case 240): cross-branch, handed off.

## Deploy notes — each needs owner GO
- Migrations to push: **none.** The migration is already in production. After merge, `supabase db push` should report the remote database is up to date. Do **not** run `supabase migration repair --status reverted 20261022180000`.
- Edge functions to deploy: none
- Secrets (names only): none
- `npm run cap:sync` / native rebuild needed: no

Handoffs to the db-security track (`factory/rv-db-security`):
- Case 240's full-chain replay must apply `20261022180000` after `20261015110000`; its dependencies all exist earlier in the chain. Nothing goes in `CHAIN_DEFERRED`.
- The grant audit must produce zero rows for `partner_code_counts` (a view, no anon/authenticated grant). Never list it in `CHAIN_KNOWN_VIOLATIONS`.
- Add `partner_code_counts` to `factory/sql/verify-privileges.sql` beside `funnel_daily`, expecting no client grant.
- This PR uses case number 250; db-security must not add another 250.

Owner decision (optional): the view counts only ref/promo, never `user_attribution.code` (the typed signup code). Any change is a new forward migration; the applied file stays frozen.

Note: the red `Vercel` check is expected and not a blocker. GitHub Actions jobs don't start (billing), so the CI checks on this PR aren't real results.

## Brain update
- Done: PC1. `main` now holds the production-applied `partner_code_counts` migration unchanged, with harness coverage of its lockdown and counts. `supabase db push` works from `main` again.
- Decisions: never `migration repair --status reverted` an applied migration; land the applied file unchanged instead. Migrations go to production only from `main`.
- New [Pending]: whether `partner_code_counts` should count `user_attribution.code`; db-security handoffs above.
