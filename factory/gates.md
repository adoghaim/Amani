# Definition of done (gates)

A packet is done only when every gate listed in its spec has evidence in the PR. "Could not run" is reported as **pending**, never as passed.

## G0 — Core CI (every PR)

Existing workflow `.github/workflows/ci.yml` (seen in the source snapshot; verify it is unchanged):

| Job | What it runs |
|---|---|
| `Lint, typecheck, build` | `npm ci`, `npm run lint`, `npm run typecheck`, `npm run validate:contrast`, `npm test`, `npm run build` |
| `Edge function typecheck` | `bash docs/check-functions.sh deno` (local: `npm run check:functions`). Baseline exclusions may only shrink. |
| `Migration behaviour (Postgres)` | `./supabase/migrations/__verification__/run.sh` (Docker). It runs every case in `__verification__/cases/` in lexical order; how to add one is in the header of `run.sh`. |
| `Migration order (D6)` | `.github/workflows/migration-order.yml`, on PRs into `main`: `node tools/ci/migration-order.mjs`. See "Migration order (D6)" below. |
| `Browser smoke` (`.github/workflows/e2e.yml`) | `npm run test:e2e:isolation`, then `npm run test:e2e` in Chromium, WebKit and Firefox against the synthetic, network-guarded fixture. Runs on every PR into `main` and every push to `main`. |

**Owner action (GitHub settings, not code):** PR #93 ruled that browser smoke becomes a required check once the CI upgrade (PR #96) is online. In *Settings → Branches → main* (or the ruleset that protects `main`), add **`Browser smoke`** to the required status checks, keeping `Lint, typecheck, build`, `Edge function typecheck`, `Migration behaviour (Postgres)` and every other check already required. Confirm the exact name from a recent PR's checks list first. The factory cannot and must not change repository settings.

Plus: Netlify deploy preview builds and loads. The `Vercel` check is ignored (expected failure).

Rules: no skipped or deleted tests to get green; snapshot updates must explain each diff; `npm test` count does not drop.

## Merge protocol (D4)

Foundation PRs carry the extension points other packets build on (PK-INT-01, PK-CFG-01). Packets that need them are stacked: their PR's base is the foundation branch, not `main`.

- **Foundation PRs merge first**, in the order of the pinned queue issue (#104), **with a merge commit, not squash**, and **with delete-branch-on-merge**. The first line of a foundation PR body says so: `Foundation PR: merge first, with a merge commit (not squash) and delete-branch-on-merge.`
- Why a merge commit: the stacked children are built on the foundation branch's own commits. A merge commit puts those commits on `main`, so when the foundation branch is deleted GitHub retargets each child to `main` and the child shows only its own changes. A squash merge puts a different commit on `main`: every child then carries the whole foundation diff again, in its review and in its merge, and conflicts wherever the foundation changed after the child branched.
- A stacked PR's body starts: `Stacked: blocked until <base packet> merges (foundation PRs merge with a merge commit, not squash, with delete-branch-on-merge).` It is not merged before its base.
- **The factory rebases the children**, never the owner: when a foundation PR changes in review, and after it merges, the factory rebases each stacked child onto the new base and re-runs its gates.

## Migration order (D6)

- Every migration a PR adds must have a version **newer than `main`'s newest migration**, and its own version: no two added files share one.
- CI enforces it at merge: the `Migration order (D6)` job fails a PR into `main` whose added migration is not newer than the newest on `main` as `main` is when the job runs. When `main` gains a migration after the job last ran, re-run the job (or update the branch) before merging.
- On a failure, renumber the PR's own migration to a version after `main`'s newest (rename the file; keep its contents). The factory renumbers on request. Never edit, rename or renumber a migration that is already on `main`, and never reuse a version that production has recorded.
- Stacked PRs are checked when GitHub retargets them to `main`.

## Store builds (D7.4)

- **Store builds are cut from an approved, pinned SHA, never "from main".** The owner names the commit; the build, its `npm run cap:sync` and every native gate run on exactly that SHA, and the PR or release note records it.
- A pinned release candidate is never rewritten by the factory (owner ruling on PR #93). A fix after the pin is a new commit and a new pin, approved again.
- The first public-launch store build contains the native minimum-version gate (EXP-8, PK-MINVER-01), so later breaking backend changes can be gated.

## Integration preview (D11)

`.github/workflows/integration-preview.yml` runs daily (and on demand): it merges every open `wave:*` PR in queue order (#104) onto a scratch commit of `main`, runs lint, typecheck, test, build, `check:functions` and the migration harness on the result, and comments conflicts and failing gates on #104. It never pushes. It is an early warning, not a merge gate: each PR's own G0 checks still decide.

## G1 — Web end-to-end in three browsers

- Playwright specs for the packet's user flow pass in **Chromium, WebKit and Firefox** (`npm run test:e2e`; in CI, workflow `e2e.yml`, job "Browser smoke").
- The suite is isolated: `e2e/server.mjs` serves the app with no env files and no inherited `VITE_*` values (`npm run test:e2e:isolation` proves it), so specs use synthetic data and mocked network and never reach a backend. Real-backend e2e needs a **non-production Supabase project**, which does not exist yet [Pending]; production is never used.
- Evidence: Playwright HTML report + traces uploaded as artifacts; screenshots for UI changes.

## G2 — Native builds and smoke

- `npm run cap:sync` (runs `BUILD_TARGET=native vite build && npx cap sync`).
- **Android:** `cd android && ./gradlew assembleDebug` succeeds (JDK 21, SDK 36, as in `native-grade.md`); CI runs it on every PR (workflow `native-build.yml`). Optional: emulator smoke (app launches, login screen renders, packet screen reachable) via the `android-emulator` job.
- **iOS:** `xcodebuild` simulator build with signing disabled succeeds (macOS runner; opt-in because of cost). Signed archives and store uploads are **owner-only** and outside the factory.
- Device-only checks (edge-to-edge on Android 15+, purchases, App Links) stay on the release QA checklist; the factory reports them as pending.

## G3 — Database: migrations, RLS, grants, triggers

For any packet that adds or changes `supabase/migrations/`:

1. Harness fixtures added to `supabase/migrations/__verification__/`, run by a new case file in `__verification__/cases/` (see the header of `run.sh`), covering: cross-user RLS denial, column grants, trigger behaviour, idempotency/race where relevant. A new user-owned table is also registered in `supabase/functions/_shared/user-data-registry.ts`; `account-deletion-sweep.test.ts` fails until it is.
2. `factory/sql/verify-privileges.sql` expectations updated for new tables.
3. **Trigger mode:** every safety trigger is `ENABLE ALWAYS` (`pg_trigger.tgenabled = 'A'`), asserted in the harness and checked after deploy with `factory/sql/verify-triggers-enable-always.sql`. Reason: triggers in the default mode (`O`) do not fire when `session_replication_role = replica`, which restore tooling uses.
4. No blanket `supabase db push` across an owner-GO boundary (see `docs/interpretation-visibility-rollout.md`). Never hand-reapply a migration (replay hazard documented there).

**Manual deploy caveat.** Netlify deploys only the web app. Migrations and edge functions are deployed by hand: `supabase db push` and `supabase functions deploy <name>`. A merged PR is **not** a deployed backend. The PR must list exactly which migrations/functions need deploying; the owner runs them after GO; then the post-deploy checks below run and their output is attached to the ledger.

**Post-deploy checklist (owner or delegated lead):**
- [ ] `verify-privileges.sql` shows only intended grants (anon none; authenticated as designed).
- [ ] `verify-triggers-enable-always.sql` returns zero rows whose `status` starts with `FAIL` (see the runbook below).
- [ ] Function probe: `OPTIONS /functions/v1/<name>` answers 200/204 for each deployed function.
- [ ] Ledger `deployed.supabase` updated with date and who ran it.

**Runbook: trigger-mode check (V2-03e-10, PK-03e-F). Run after every `supabase db push`, every restore (PITR, dump/reload, `pg_restore`) and every manual data fix.**

1. Run `factory/sql/verify-triggers-enable-always.sql` read-only against the target database, as the owner, from the SQL editor or `psql`. Use no `--linked` CLI command and no service key in a script. It is one `SELECT` and writes nothing.
2. Expected result once `20261013000000` is applied: the 12 `safety` rows show `expected_mode = A`, `actual_mode = A`, `status = ok`; `remember_interpretation_history` (`origin-owner-ruling`) shows `O`, `O`, `ok`. It stays ORIGIN by the owner's TASK-048 turn-5 ruling; do not "fix" it. The two `origin-by-design` rows (`iap_subscriptions_set_updated_at`, `auth.users.on_auth_user_created`) show `O` and `ok`, or `note: absent in this database`.
   Later migrations add rows that appear only once their migration has created its table, and then must show `ok`: `20261013040000` (PK-CFG-01, 8 `safety` rows on `app_public_config`, `app_server_config`, `app_config_audit`), `20261015010000` (PK-EXP5, 4 `safety` rows on `app_events`, `user_attribution`), `20261015020000` (PK-HARM-01, 2 `safety` rows on `interpretation_feedback`), `20261015040000` (PK-CONSENT-01, 2 `safety` rows on `consent_records`, plus the upload gate `lab_reports_require_consent` as `origin-gate`, `O`, `O`), `20261015110000` (PK-FIX-04, `zz_record_lab_file_cleanup`, `safety`). The upload gate is listed in the mode it shipped in (ORIGIN); whether it should be `ENABLE ALWAYS` is an open owner ruling, and changing it is a reviewed forward migration plus its row in the query.
   Between V2's `20261010000000` and `20261013000000` the six pre-V2 safety triggers (users clamps, claim limit, claim immutability, `protect_report_content_hash`, `prepare_interpretation_projection`) report `FAIL: safety trigger not ENABLE ALWAYS`. That is the known pre-fix state, and `20261013000000` is the fix.
3. **Stop condition:** if any row's `status` starts with `FAIL` (`safety trigger not ENABLE ALWAYS`, `mode differs from expected ORIGIN`, `trigger missing` or `unclassified trigger`), stop the rollout. Do not run further migrations, do not deploy functions, and do not reopen writes after a restore. Report the rows to the owner. The fix is a reviewed forward migration (`ALTER TABLE public.<t> ENABLE ALWAYS TRIGGER <name>;`, or classifying a new trigger in the query and in `supabase/migrations/__verification__/trigger-enable-always.run.sh`). Never fix it ad hoc in production.
4. Restores: run a data load as `postgres`. `protect_report_content_hash` exempts only `postgres` and `service_role`, so a replica-mode load run as another role that writes `content_hash` fails loudly with `42501`; that is intended. Never use `ALTER TABLE ... DISABLE TRIGGER` to get past a safety trigger: it disables even `ENABLE ALWAYS` triggers. Run step 1 again after any restore.
5. Attach the query output to the ledger entry for the deploy or restore.

The migration harness runs the same file. `trigger-enable-always.run.sh` (sourced by `__verification__/cases/170-trigger-enable-always.sh`, which runs after case 160 because it needs the full V2 chain in the amani database) fails when any listed trigger's mode differs from expected, when one is missing, or when a trigger in `public` is unclassified. It also proves that with `session_replication_role = replica` a forbidden overwrite (claim ledger, privileged user columns, `content_hash`) is still rejected, with one killing mutation per pre-V2 safety trigger. It defines `tea_check_classified`, which the cases for later migrations (180 runtime config, 200 first-party events, 210 interpretation feedback, 220 consent records) call in their own databases: every trigger their migration creates is reported `ok` in its listed mode, none is unclassified, and the query FAILs each one when its mode is flipped or it is dropped. Case 230 does the same for the PK-FIX-04 recorder on the amani database.

**V2 post-deploy smoke (PR #93 runbook step 8).** After steps 1-7, the owner runs `node scripts/smoke/v2-post-deploy.mjs --i-understand-this-hits-production` with `SMOKE_SUPABASE_URL`, `SMOKE_SUPABASE_ANON_KEY`, `SMOKE_TEST_EMAIL` and `SMOKE_TEST_PASSWORD` set (names only here; the email must contain `smoke`). Prepare the disposable account first: one synthetic report with no interpretation, entitled to a deep AI generation. It checks first generation, regeneration, returned version identity, old interpretation not overwritten, and account deletion, then deletes the account and prints a pass/fail table (exit 0 only if every row is PASS). Agents never run it against production.

**Prepared, not applied (PR #93 "Later").** These live outside `supabase/migrations` so no `db push` can apply them early. Each header holds its own runbook, and `supabase/migrations/__verification__/factory-prepared.run.sh` (sourced by `__verification__/cases/250-factory-prepared.sh`) rehearses both on a disposable clone of the fully migrated harness database.
- `factory/sql/post-deploy/retire-delete-interpretations.sql`: makes `delete_interpretations` raise. Move it into `supabase/migrations` with a fresh timestamp **only after** the V2 `delete-user-data` is confirmed live (runbook step 5 plus a passing step-8 deletion). Applying it earlier breaks account deletion for everyone, because the deployed function still calls the old name.
- `factory/sql/rollback/20261011000003-revoke-commit-deep-access-version.sql`: the forward-only rollback for `20261011000003`, which revokes service `EXECUTE` on `commit_deep_access_version`. It never relaxes the history guard. Free anchored regeneration then fails closed, and Plus regeneration and readers are unaffected.

**Data-only restore caveat (ops).** Source: `docs/clinical/TASK-048/turn-5-replica-hardening.md`, never executed. A **data-only** restore into an already-migrated schema fires the history recorder (`remember_interpretation_history`) as `interpretations_private` rows load, before `interpretation_history_protection`'s own data loads. The protection rows then conflict on their primary key. A full `pg_dump`/`pg_restore` is not affected, because triggers are created post-data. So for ops: restore with a full dump. Do not do a data-only restore into a migrated schema, and do not disable or re-mode the history triggers to make one work (they are `ENABLE ALWAYS` on purpose). If a data-only restore ever becomes necessary, it needs its own rehearsed procedure and owner GO first. After any restore, run `factory/sql/verify-triggers-enable-always.sql`.

## G4 — Clinical authority

- Guardrail suites green and not weakened: `_shared/nutrient-policy.test.ts`, `src/lib/scoring/scoreBiomarker.test.ts`.
- New AI prose paths run `validateInterpretationOutput` and handle the `sanitizeViolations()` → `null` contract by falling back to the deterministic interpretation.
- No new range, threshold or safety rule without an approved source and reviewer recorded in the catalog. Missing authority → `NEEDS_CONTEXT`/suppressed, not guessed.
- Basic tier no-expansion and truthful locked counts hold.
- Safety findings are deterministic, visible in every tier, and cannot be removed by model output.
- Any user-facing or marketing copy avoids diagnosis, prescription and unauthorized evaluative words.
- Reviewer agent signs off G4 explicitly in the review.

## G5 — Owner approval

- Mohammed approves and merges. Agents never merge.
- Deploys, flag changes, store submissions and live billing changes each need their own explicit GO, recorded in the ledger (`owner_approval`, `deployed`).
