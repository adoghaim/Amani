# DB1 — Harness: Postgres 17, assertive case 010, full-chain replay and a grant audit

- Track: **db-security** · branch `factory/rv-db-security` (already created at origin/main 22027b2; packets on a track run in order and build on each other)
- Reserved migration range: 20261023100000-20261023109999
- Harness: this track owns `gates harness` this wave
- Review lenses after you: correctness + tests, security + privacy
- Files this packet owns (others may touch nearby code concurrently): supabase/migrations/__verification__/**; factory/sql/verify-privileges.sql
- Findings: F127, F100, F125, F095, F035, F124

## Decisions already made for you (follow them; deviations need evidence in your result)

1. You are the ONLY track allowed to run `gates harness` this wave (single-slot lock; a full run takes several minutes).
2. D6 forbids editing migrations already on main. F124's recommendation needs owner sign-off to guard the two early files; that sign-off has NOT been given. Build the full-chain replay WITHOUT editing any existing migration: e.g. a harness case that applies every checked-in migration in version order to an empty Postgres with the Supabase stand-ins, using an explicit, documented deferral list for the known pre-baseline files (apply each right after the migration that creates its target table), and failing on any other error or any NEW out-of-order file. Describe the guard-the-files variant under owner_actions.
3. Over the replayed real chain, assert (F035/F095): every public table has RLS enabled; anon holds no write grants; authenticated holds writes only where a policy serves them (explicit allow-list in the case); lab-files bucket public=false and cross-user storage access denied; Stripe/IAP tables not client-writable; cross-user denial for every user-owned table. Violations that the next packet (DB2: lab_panels, derived_metric_definitions, insight_rules, stripe_* grants, anon grants) will fix go in an explicit known-violations list that DB2 empties. Never weaken an assertion to get green.
4. F127: pin the harness Postgres to production's major (17; production is 17.6) in ONE variable in run.sh, with a server_version check that fails loudly on drift. Check ci.yml before dropping PG15 from anything CI relies on.
5. F100/F125: rewrite case 010 and the complimentary-entitlements verify files as ON_ERROR_STOP assertion blocks with the expected SQLSTATE per refusal (pattern: claims-limit-three.verify.sql, lab-file-cleanup.verify.sql) plus the complimentary_entitlements RLS probe from the recommendation.
6. Mutation-prove every new assertion: temporarily break the schema (disable RLS on complimentary_entitlements, add an any-row policy, drop a CHECK, grant anon INSERT) and show red, then restore and show green. Record each in proof.
7. If the replay makes privileged_columns_test.sql runnable, wire it in.

## Findings (verbatim from the 2026-10-23 review of main@22027b2; line numbers refer to that commit)

### F127 — The harness tests Postgres 15, but production runs Postgres 17.6

- Location: `supabase/migrations/__verification__/run.sh:53` · severity low · category ci-gate · owner_action=False

**Evidence**

run.sh:51-53 starts `postgres:15-alpine`, and ci.yml:111 runs it unchanged. Production is Postgres 17.6: supabase/.temp/postgres-version:1 is '17.6.1.063' for linked project eyfvqdnczorscwveaadv, and docs/clinical/TABLE-DISPOSITION.md:49 says the Lead verified 'PostgreSQL is 17.6'. Versions 16 and 17 changed behaviour this harness checks around: the MAINTAIN privilege is now part of GRANT ALL and appears in ACL text, and a restricted search_path applies during maintenance operations. A future migration that behaves differently on 17 would pass this gate. Verified: a scratch copy of run.sh with only the image (postgres:17-alpine, 17.11) and the container name changed passes at 22027b2 (25/25 cases, 187 PASS lines, exit 0, 3m34s), so switching is safe today.

**Recommendation**

Pin the harness to production's major version, postgres:17-alpine or ideally the matching supabase/postgres 17.6.1.x image, in a single variable in run.sh. Have the harness check the expected server_version so that version drift fails loudly.

**Verifier's note**

direct command output

### F100 — Harness case 010 only prints several constraint checks; the hashed draw-key guard is never asserted

- Location: `supabase/migrations/__verification__/introductory-claims.verify.sql:1` · severity low · category test-quality · owner_action=False

**Evidence**

introductory-claims.verify.sql:1 and complimentary-entitlements.verify.sql:1 set ON_ERROR_STOP 0 and only echo their results. cases/010-introductory-claims.sh:35 and :67 pipe the output through grep -v '^$' and compare nothing, so every step labelled 'must be refused' passes whether or not the statement fails. Claim immutability and the claim limit are asserted elsewhere (trigger-enable-always.replica.sql:80-87; claims-limit-three.verify.sql:15-21). The following are asserted nowhere (grep over __verification__), so dropping any of them leaves the harness green:
- introductory_deep_access_claims_draw_id_is_sha256 (20260903000000_introductory_deep_access_claims.sql:79-80), which keeps readable accession numbers out of the table;
- the evidence_tier check (:69-70);
- complimentary_entitlements_reason_check (20260914000000_complimentary_entitlements.sql:49-50);
- RLS being enabled on complimentary_entitlements;
- its erasure cascade.

**Recommendation**

Rewrite both files with ON_ERROR_STOP 1 and DO blocks that RAISE on the wrong outcome, as every later case does (lab-file-cleanup.verify.sql, for example). Assert the expected SQLSTATE for each refusal.

**Verifier's note**

Confirmed. Both verify files set ON_ERROR_STOP 0 and only echo. Case 010 pipes them through grep -v '^$' (:35, :67). psql exits 0 on statement errors when ON_ERROR_STOP is off, so every 'must be refused' step passes either way. A grep of __verification__ finds no assertion for draw_id_is_sha256, the evidence_tier check, complimentary_entitlements_reason_check, relrowsecurity on complimentary_entitlements, or its erasure cascade. Case 010 does assert claim erasure, the complimentary grants and that no write policy exists, and the claim limit and immutability are asserted elsewhere. The constraints exist in deployed migrations, so this is misleading green evidence rather than a product defect; lowered to low.

### F125 — Case 010 only prints its refusal checks: RLS off, an any-row policy and removed CHECKs on paid-access tables still pass the whole harness

- Location: `supabase/migrations/__verification__/complimentary-entitlements.verify.sql:1` · severity medium · category ci-gate · owner_action=False

**Evidence**

complimentary-entitlements.verify.sql:1 and introductory-claims.verify.sql:1 set `\set ON_ERROR_STOP 0` and only echo results. cases/010-introductory-claims.sh:35 and :67 pipe them through grep -v '^$'. The case then asserts only grants, no write policy, the erasure count and the concurrency count, and prints 'PASS: ... every constraint fired.' (:114). Verified with killing mutations on a scratch copy of 22027b2 and the full run.sh: M2 removes `ALTER TABLE complimentary_entitlements ENABLE ROW LEVEL SECURITY` (20260914000000_complimentary_entitlements.sql:56); M4 changes its own-row policy to USING (true) (:71); M3 neutralises its reason CHECK (:49-50); M1b neutralises the claim ledger's evidence_tier CHECK (20260903000000_introductory_deep_access_claims.sql:69-76). Result: EXIT CODE 0, 25/25 cases, 187 PASS lines; the log prints '    rls enabled: false' and then the PASS line. Control: neutralising the draw-id SHA-256 CHECK (20260903000000:80) is killed by case 040 (commit-deep-access.verify.sql:65-66, 'invalid identity was accepted', exit 3), so the method can detect a missing assertion. No *.test.* file asserts RLS on complimentary_entitlements. Today's migration is correct. The gap is that a regression letting any signed-in user read every complimentary grant (user_id, reason, note, granted_by) would ship green, while ci.yml:101-107 presents this job as the permanent guard for these tables.

**Recommendation**

Rewrite both verify files as ON_ERROR_STOP=1 assertion blocks, as in claims-limit-three.verify.sql: catch the expected check_violation or unique_violation for each refusal and RAISE if the write succeeds. Add a complimentary_entitlements RLS probe: relrowsecurity is true, and as authenticated with request.jwt.claim.sub set, exactly the caller's row is visible. Re-run M1b, M2, M3 and M4 to confirm each is now killed, and stop printing 'every constraint fired' until it is actually asserted.

**Verifier's note**

direct command output

### F095 — Migration harness never applies the 35 migrations before 20260823010000, so base-table RLS, lab-files storage policies and the Stripe/IAP tables have no executable test

- Location: `supabase/migrations/__verification__/prelude.sql:11` · severity high · category test-coverage · owner_action=False

**Evidence**

Method: I mapped every docker cp and migration variable in cases/*.sh and *.run.sh; no step applies migrations by glob. All 35 migrations from 20260823010000 on are applied by some case, so G3 holds for recent packets. The 35 earlier migrations are never applied; cases run on hand-written stand-in tables (prelude.sql:11-32). Those 35 files contain 120 CREATE POLICY and 38 ENABLE ROW LEVEL SECURITY statements plus 13 storage.objects policy references (counted). Among them:
- user-table policies (20260224062147_security_hardening_rls_audit_storage_rate_limits.sql:40-253);
- the lab-files bucket made private, and its folder policies (20260224062147:262-300; 20260216195036_add_lab_files_storage_bucket.sql:15-50);
- period and symptom log RLS (20260307054419, 16 policies);
- the Stripe tables and the stripe_user_subscriptions entitlement view (20260217130956_wispy_sky.sql:142-159);
- Stripe idempotency and the claim lease (20260430000000, 20260811000000);
- iap_subscriptions and its write lock (20260821000000, 20260821010000);
- the lab_reports column lock (20260501000000), the signup trigger (20260308131250) and the trial deferral (20260521000000);
- the users column REVOKEs (20260823000000); only its successor clamp, 20260826000000, is asserted (TEA-USERS-* in trigger-enable-always.replica.sql:61-75).
lab-file-cleanup.verify.sql:11-13 writes its own lab_reports RLS policy before asserting HFX04-CROSS-USER-DELETE, so that check proves the fixture's policy, not production's. supabase/tests/privileged_columns_test.sql (pgTAP, plan(28)) says 'Run with: supabase test db', and no workflow, npm script or harness file runs it (grep). verification-harness.test.ts checks only case naming and order; nothing maps migrations to cases, so G3 relies on review. factory/sql/verify-privileges.sql runs only by hand after a deploy.

**Recommendation**

Add a CI job or harness case that applies the full real chain on a Supabase local stack (supabase db reset provides the real auth and storage schemas). Assert cross-user denial for every user-owned table and for lab-files storage objects, plus bucket public=false and the Stripe/IAP write locks. Run supabase test db in CI. Add a test that fails when a migration is neither referenced by a case nor listed on an explicit legacy allowlist.

**Verifier's note**

Reproduced. None of the first 35 migration timestamps appears in cases/*.sh, *.run.sh or run.sh; the only hit is a comment at clinical-catalog.run.sh:228. Every later migration is referenced. The counts reproduce: 120 CREATE POLICY, 38 ENABLE RLS and 13 storage.objects references. prelude.sql:11-32 builds stand-in tables. lab-file-cleanup.verify.sql:11-13 creates its own lab_reports policy before HFX04-CROSS-USER-DELETE. git grep finds supabase/tests/privileged_columns_test.sql referenced only by itself. factory/sql/verify-privileges.sql checks grants on a fixed table list, with no policies and no storage. migration-order.mjs and verification-harness.test.ts do not map migrations to cases. G3 (gates.md:69) applies only to packets that change migrations, and no doc accepts the gap. RLS is the stated PHI boundary, so high stands, although no live RLS defect is shown.

### F035 — No automated RLS/grant check runs over the real migration chain, and the chain does not apply cleanly to an empty database

- Location: `supabase/migrations/20260115202339_add_interpretation_source.sql:19` · severity low · category missing · owner_action=False

**Evidence**

Applying supabase/migrations/*.sql in order to an empty postgres:15 fails on the first file, 20260115202339_add_interpretation_source.sql:19 ('relation "interpretations" does not exist'). It also fails on 20260126021208_add_cycle_events.sql ('relation "public.users" does not exist'), because both run before 20260216193045_initial_schema.sql. The other 68 migrations apply. The verification harness avoids this by building stand-in tables (supabase/migrations/__verification__/prelude.sql:11-32), and factory/sql/verify-privileges.sql:12-20 checks a fixed list of tables that leaves out the three tables without RLS. Nothing asserts across the board that every public table has RLS and that anon holds no write privilege. That gap is how lab_panels, derived_metric_definitions and insight_rules survived.

**Recommendation**

Make the chain apply from empty: move or guard the two pre-baseline files, or squash them into a baseline. Then add a CI or harness step that applies the whole chain with Supabase default privileges and fails if any public table lacks RLS, or if anon or authenticated holds a write grant that no policy is meant to serve.

**Verifier's note**

Reproduced exactly. From empty, 20260115202339_add_interpretation_source.sql fails at :19 with 'relation "interpretations" does not exist', and 20260126021208_add_cycle_events.sql fails with 'relation "public.users" does not exist'. The other 68 apply. The harness (__verification__/run.sh and cases/*) applies individual migrations over stand-in preludes (prelude.sql:11-32), never the whole chain. verify-privileges.sql:12-20 is a fixed table list, and no gate asserts RLS or anon write grants across public. The chain failure breaks local `supabase start` and db reset, and config.toml has no [db] override. Low.

### F124 — The checked-in migration chain cannot be applied to an empty database, and no gate replays it

- Location: `supabase/migrations/20260115202339_add_interpretation_source.sql:19` · severity medium · category ci-gate · owner_action=False

**Evidence**

20260115202339_add_interpretation_source.sql:19 runs `ALTER TABLE interpretations ADD COLUMN interpretation_source ...`, and 20260126021208_add_cycle_events.sql:135 runs `ALTER TABLE public.users ADD COLUMN default_cycle_length ...`. Both tables are only created later, at 20260216193045_initial_schema.sql:65 (users) and :110 (interpretations). Verified by applying all 70 files in version order, one transaction each, to an empty postgres:15-alpine (15.19) and postgres:17-alpine (17.11) with minimal Supabase stand-ins (anon/authenticated/service_role, auth.users, auth.uid(), storage.buckets/objects/foldername, default privileges): the first file fails with 'ERROR: relation "interpretations" does not exist'. Carrying on past failures, only 20260126021208 also fails ('relation "public.users" does not exist', line 146). With the three files dated before initial_schema skipped, the other 67 apply with zero errors on both versions. The effects of the two failing files are re-applied later by 20260216194325_20260126021208_add_cycle_events.sql (identical except for the trailing newline) and 20260312070949_add_interpretation_source_and_unique_constraint.sql. No gate notices this. The harness applies no file from 20260115202339 to 20260823000000 (35 of 70) and stands in for them with hand-written stubs (__verification__/prelude.sql:1). The project's own design note says 'A stubbed schema run is useful but does not prove fresh-chain application' (docs/clinical/TASK-048/turn-2-persistence-design.md:81). No workflow invokes the Supabase CLI (no db reset or start). supabase/tests/privileged_columns_test.sql:8 ('Run with: supabase test db') is run by no workflow, and it needs a local stack built from this chain. Production is unaffected because these versions are already recorded there. What breaks: supabase db reset/start, Supabase branching, and db push to any new staging or disaster-recovery project all stop at the first file. Another agent's scratchpad apply.log shows the same two failures independently.

**Recommendation**

With owner sign-off (these are applied migrations), guard the two early files so they do nothing when their target table does not exist yet, for example by wrapping the ALTERs in `IF to_regclass('public.interpretations') IS NOT NULL` and `IF to_regclass('public.users') IS NOT NULL`. Production has both versions recorded and will never re-run them, so this changes nothing there. Then add a harness case, e.g. cases/005-full-chain-replay.sh, that applies every checked-in migration in version order, one transaction each, to an empty database with the Supabase stand-ins, and fails on the first error. That would block the next non-replayable migration and make privileged_columns_test.sql runnable.

**Verifier's note**

direct command output