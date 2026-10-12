# Definition of done (gates)

A packet is done only when every gate listed in its spec has evidence in the PR. "Could not run" is reported as **pending**, never as passed.

## G0 — Core CI (every PR)

Existing workflow `.github/workflows/ci.yml` (seen in the source snapshot; verify it is unchanged):

| Job | What it runs |
|---|---|
| `Lint, typecheck, build` | `npm ci`, `npm run lint`, `npm run typecheck`, `npm run validate:contrast`, `npm test`, `npm run build` |
| `Edge function typecheck` | `bash docs/check-functions.sh deno` (local: `npm run check:functions`). Baseline exclusions may only shrink. |
| `Migration behaviour (Postgres)` | `./supabase/migrations/__verification__/run.sh` (Docker) |

Plus: Netlify deploy preview builds and loads. The `Vercel` check is ignored (expected failure).

Rules: no skipped or deleted tests to get green; snapshot updates must explain each diff; `npm test` count does not drop.

## G1 — Web end-to-end in three browsers

- Playwright specs for the packet's user flow pass in **Chromium, WebKit and Firefox** (workflow `factory-e2e.yml`, job `web-e2e`).
- Run against a local production build (`npm run build && npm run preview`) or the Netlify preview, pointed at a **non-production Supabase project** with synthetic users and synthetic lab fixtures. **to-verify:** which test project exists; production is never used.
- Evidence: Playwright HTML report + traces uploaded as artifacts; screenshots for UI changes.

## G2 — Native builds and smoke

- `npm run cap:sync` (runs `BUILD_TARGET=native vite build && npx cap sync`).
- **Android:** `cd android && ./gradlew assembleDebug` succeeds (JDK 21, SDK 36, as in `native-grade.md`). Optional: emulator smoke (app launches, login screen renders, packet screen reachable) via the `android-emulator` job.
- **iOS:** `xcodebuild` simulator build with signing disabled succeeds (macOS runner; opt-in because of cost). Signed archives and store uploads are **owner-only** and outside the factory.
- Device-only checks (edge-to-edge on Android 15+, purchases, App Links) stay on the release QA checklist; the factory reports them as pending.

## G3 — Database: migrations, RLS, grants, triggers

For any packet that adds or changes `supabase/migrations/`:

1. Harness fixtures added to `supabase/migrations/__verification__/` covering: cross-user RLS denial, column grants, trigger behaviour, idempotency/race where relevant.
2. `factory/sql/verify-privileges.sql` expectations updated for new tables.
3. **Trigger mode:** every safety trigger is `ENABLE ALWAYS` (`pg_trigger.tgenabled = 'A'`), asserted in the harness and checked after deploy with `factory/sql/verify-triggers-enable-always.sql`. Reason: triggers in the default mode (`O`) do not fire when `session_replication_role = replica`, which restore tooling uses.
4. No blanket `supabase db push` across an owner-GO boundary (see `docs/interpretation-visibility-rollout.md`). Never hand-reapply a migration (replay hazard documented there).

**Manual deploy caveat.** Netlify deploys only the web app. Migrations and edge functions are deployed by hand: `supabase db push` and `supabase functions deploy <name>`. A merged PR is **not** a deployed backend. The PR must list exactly which migrations/functions need deploying; the owner runs them after GO; then the post-deploy checks below run and their output is attached to the ledger.

**Post-deploy checklist (owner or delegated lead):**
- [ ] `verify-privileges.sql` shows only intended grants (anon none; authenticated as designed).
- [ ] `verify-triggers-enable-always.sql` returns zero rows in its "problems" query.
- [ ] Function probe: `OPTIONS /functions/v1/<name>` answers 200/204 for each deployed function.
- [ ] Ledger `deployed.supabase` updated with date and who ran it.

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
