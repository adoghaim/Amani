# Fresh-user end-to-end proof (PK-03e-I)

The journey a brand-new user takes through V2, proven in **Chromium, WebKit and Firefox**, with every server step backed by Vitest and/or the migration harness.

```
new user -> upload lab -> extraction -> generation -> clinical authority -> save version
        -> read -> Basic/Premium projection -> trends -> regeneration -> deletion
```

## How to run

| Command | What it runs |
| --- | --- |
| `npm run test:e2e:journey` | `e2e/journey/fresh-user.spec.ts` in all three browsers against the **production build** (`vite build` + `vite preview`, flag on), talking only to the in-memory stand-in. |
| `E2E_REAL_SUPABASE=1 SUPABASE_URL=… SUPABASE_ANON_KEY=… npm run test:e2e:journey` | The same journey against a **local** Supabase stack. `e2e/server.mjs` accepts only `127.0.0.1`/`localhost`, so this mode can never reach a hosted project. Steps that need a privileged write the browser cannot make (granting Premium, and the regeneration that follows) are annotated `pending`, not passed. Names only; never commit values. |

Status of the real-stack run: **PENDING**. There is no local stack (Docker is down) and no test project, so it has never been run. Running it also needs the local stack's edge functions served with an OCR key (`OPENAI_API_KEY`), because extraction is server-side.

## What the stand-in is, and is not

There is no local stack, so `e2e/journey/fake-supabase.ts` answers the HTTP calls the web client makes (GoTrue, PostgREST, Storage, Edge Functions), in the wire shapes supabase-js expects. It mirrors only the boundaries the client depends on:

- REST reads and writes are scoped to the bearer token's user, as RLS does.
- Storage writes must sit under the caller's own `<user id>/` prefix.
- A plain insert of an existing id answers 409 (`23505`).

Any request it does not model is recorded and fails the test, so a new or changed client call cannot be answered by a guess.

The Edge Function answers come from the real pure server modules in `e2e/journey/server-model.ts`. The Deno handlers are thin wiring around these, so only their I/O is modelled:

| Function | Real modules used |
| --- | --- |
| `generate-interpretation` | `resolveEntitlement`, `decideIntroductoryAccess`, `buildTrendEvidence`, `shapeInterpretation`, `withClaimAuthority`, `projectBasic`, `isVersionable`, `versionIdentity`, `REQUEST_ID_REQUIRED` |
| `get-interpretation` | `readInterpretation`; `readSelected` mirrors `read_interpretation_for_server` |
| `delete-user-data` | `deleteUserAccount` |
| `interpretations` view | mirrors `read_compatible_interpretations` |

The OpenAI call is the one thing no module can supply. The model proposal is synthetic, and every free-text field in it is a canary (`MODEL_CANARY`). The journey asserts that the canary is stored on the server (so the check is non-vacuous) and never reaches the DOM.

Lab values, units and printed intervals mirror the claim-authority testkit: TSH 6 -> 9 uIU/mL and ferritin 25 -> 30 ng/mL, with synthetic 0-100 intervals. No clinical content is authored.

## Journey step -> proof

Browser = `e2e/journey/fresh-user.spec.ts` (test "fresh user: signup -> uploads -> Basic/Premium -> trends -> regeneration -> deletion", one `test.step` per row). Server proofs are existing suites unless marked new.

| # | Step | Browser proof (all 3 engines) | Server proof (Vitest / harness) |
| --- | --- | --- | --- |
| 1 | **New user** signs up at `/signup` and completes onboarding | Step 1. Exactly one `users` row (the trigger's row; the form's duplicate insert gets a 409), `onboarding_completed`, and a trial start set only through `start_trial_if_unset` | `src/lib/entitlement.test.ts`, `_shared/entitlement.test.ts` (`isOnboarded`, freemium resolution); privileged-column lock `20260823000000` (live on production) |
| 2 | **Upload lab**: an image to `lab-files` | Step 2-5. The file lands under `<uid>/` in storage, and a `lab_reports` row is created with the chosen date | Storage RLS migration `*_security_hardening_rls_audit_storage_rate_limits.sql` (live on production) |
| 3 | **Extraction** (server OCR, then client normalisation) | Step 2-5. `parse-lab-report-ocr` answers 200, and the report's `report_analytes` hold exactly the extracted rows | `src/utils/parser/parser.test.ts`, `src/utils/parser/aiRefinementGate.test.ts` |
| 4 | **Generation** (first; no `request_id`) | Step 2-5. One first-generation request. It spends introductory claim 1 of 3, and the stored body is `ai`/`deep` | `_shared/introductory-access.test.ts`, `_shared/response-shaping.test.ts`, `_shared/generation-cost.test.ts`; harness "three-claim upgrade and transactional deep access" (`claims-limit-three`, `commit-deep-access*.verify.sql`) |
| 5 | **Clinical authority** | Every step. `MODEL_CANARY` is stored in the full body but never reaches the DOM. The stored body carries `clinical_claims` and `claim_audit`, and Basic carries no model narrative keys | `_shared/claim-authority.test.ts`, `_shared/legacy-raw-access.test.ts`, `_shared/nutrient-policy.test.ts` (guardrail), `src/lib/scoring/scoreBiomarker.test.ts` (guardrail); harness `claim-policy-gate.*` |
| 6 | **Read** | Every step. The `get-interpretation` answer the page rendered has its `access`, `plan`, `stored_depth`, `complimentary` and `version` checked | `_shared/interpretation-read.test.ts`, `src/lib/freemium/interpretationAccess.test.ts`, `src/pages/ReportView.test.tsx` |
| 7 | **Trends** across two reports | Step "trends". The page shows "TSH has risen from 6 to 9 uIU/mL", and the server's `trend_evidence` names the prior report's date | `_shared/trend-evidence.test.ts`, `src/lib/scoring/healthStoryTrajectory.test.ts`; harness `flagged-trends.verify.sql` |
| 8 | **Basic projection** (introductory access exhausted) | Step "Basic projection". The fourth upload is read as `access: basic`, `plan: free`, `complimentary 3/3`, and shows the exhausted notice, the Premium preview and the locked cross-report count | `_shared/interpretation-visibility.test.ts`, `_shared/preview-selector.test.ts`, `src/lib/freemium/reportAccess.test.ts`; harness `deterministic-projection.verify.sql` |
| 9 | **Premium projection** (same report, Premium reader) | Step "Premium projection". The same stored report is read as `plan: premium`, `generation_needed` (a standard body for a full reader), the fuller-analysis offer appears, and the Basic upsell is gone | `_shared/interpretation-read.test.ts`, `_shared/entitlement.test.ts`, `_shared/subscription-guard.test.ts` |
| 10 | **Save version** (regeneration appends; the anchor is untouched) | Step "regeneration". The request carries a v4 `request_id` and the anchor stays `fallback`/`standard`. One version is appended with its own id; `regeneration_count` = 1 | `_shared/interpretation-version-write.handler.test.ts`, `src/lib/regenerationRequest.test.ts`; harness H048 / H048W (writer: append, idempotent retry, request reuse refused, history frozen, concurrency) |
| 11 | **Regeneration shows the new current version** | Step "regeneration". The re-read is served under `version.id` = the appended version with `historical_interpretation_id` = the anchor, `stored_depth: deep`, and the offer and Regenerate are gone | `_shared/interpretation-current-version.test.ts`; harness H048 readers (`interpretation-versions.read.sql`, regenerate-then-read from PK-03e-H) |
| 12 | **Deletion** signs the user out | Step "deletion". `delete-user-data` answers 200, the browser lands on `/` with no stored session, and `/app` redirects to `/login`. The stand-in holds no row, claim, interpretation thread, storage object or auth user for the account | `_shared/account-deletion.test.ts`, `_shared/account-deletion-sweep.test.ts`, `_shared/delete-user-data.erasure.test.ts`; harness "account erasure: ordered, atomic, deadlock-free" (live `20261011000000`) and "account erasure on the full V2 schema (PK-03e-K)" |

## Defects this journey found (not fixed: test-only packet)

1. **The Premium "Generate full Amani analysis" panel action cannot work on an anchored report.** `FreemiumReportPanel` `onGenerate` calls `ReportView.handleGenerate`, which sends `generate-interpretation` with no `request_id`. Since TASK-048 the handler answers `400 request_id_required` whenever the report already holds its anchor, so the click does nothing. The header "Regenerate (n left)" (`handleRegenerate`) works and is what the journey uses. This is pinned by `test.fail` "known defect: …" in the same spec, which fails today in all three browsers with exactly `{"error":"request_id_required"}`. It will turn red when the defect is fixed, so the marker can be removed.
2. **OCR extraction drops the printed reference interval and raw value text.** `parse-lab-report-ocr` returns `normalized_min`/`normalized_max`/`raw_value_text`. `NewReport` reads `normalized_reference_min`/`normalized_reference_max`/`value_text`. As a result, an OCR'd report is saved with null `reference_min`/`reference_max` (biomarkers), null `normalized_min`/`normalized_max` (report_analytes) and null raw value text. The page then shows "Your lab's range: Not provided on your report".
3. **The signup -> onboarding hand-off** can leave a blank page. This is the redirect race already quarantined in `e2e/smoke.spec.ts` (`@quarantine`, `specs/BACKLOG-1.0.7.md` item 11). The journey re-enters `/onboarding` by URL instead.
