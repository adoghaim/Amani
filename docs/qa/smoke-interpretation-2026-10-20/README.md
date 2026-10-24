# October 17 interpretation smoke: investigation and regression evidence

Base: `96f636d`, on `fix/smoke-regeneration-and-analysis-consistency`.
Only code, synthetic fixtures and local tests were used. No production Supabase requests,
OpenAI requests, deployments, flag changes, merges or billing changes were made.
The original screenshots were inspected locally; they are not copied into the repository.

## A. Fallback and failed regeneration

The observed pair is an intentional degradation/history-protection path, with a diagnostic bug:
first generation saves a deterministic interpretation when no usable model answer exists;
regeneration refuses that same output because only a deep, policy-clean AI answer may append a
version. It leaves the selected interpretation, claim ledger and report history intact.
Previously every cause collapsed into `200 source:fallback` followed by
`503 error:regeneration_failed`. Without logs or a response reason, the October 17 upstream
cause cannot be recovered. A missing key or OpenAI failure is possible, not established.

What the checked-in code establishes:

- Free is allowed to generate and regenerate. With one of three lifetime claims used, an
  unclaimed draw is eligible for another complimentary analysis. A successful generation
  settles the claim and output atomically. A fallback spends nothing. An existing draw's
  claim is reused on regeneration, including after all three claims have been used.
- `report_date` is client-editable and is never entitlement evidence. This handler currently
  uses the stored file content hash, or a report-specific fallback if no file hash is available.
  Changing only `report_date` cannot create a new draw entitlement. Identical file re-uploads
  can share a claim; two differently encoded files from one draw can still count separately
  without retained accession evidence. This PR does not change draw identity.
- `FREEMIUM_POST_LIMIT_GENERATION` unset or `always` still generates deeply after exhaustion,
  but grants no new Full access. Any other value (including `on_demand`) skips that model
  spend on a new, unclaimed draw after exhaustion. It cannot explain a fallback at one claim.
- With Freemium disabled, or the database visibility switch off, Free fails the subscription
  gate with 402. Entitlement infrastructure failures return 503 `entitlement_unavailable`.
  Those are different from `regeneration_failed`.
- The daily generation limiter returns 429 (20 requests per day). Cost ledgers record spend;
  this handler has no automatic dollar-budget refusal. The explicit AI kill switch can pause
  model calls. None of these is a blanket ban on Free regeneration.
- The live source calls `gpt-4o-mini`, despite the older model description in `CLAUDE.md`.
  No model, token limit, clinical threshold or entitlement limit was changed here.

The response contract now preserves status, `error`, `retryable` and `ai_paused`, and adds:

| Fixed reason | Meaning |
|---|---|
| `introductory_access_exhausted` | Post-limit policy skipped deep generation |
| `report_unavailable` | Generation could not load the report |
| `no_analytes` | No parsed analytes |
| `ai_not_configured` | `OPENAI_API_KEY` absent |
| `ai_paused` | Owner's kill switch prevented the model call |
| `model_failed` | Model called but returned nothing usable |
| `floor_violation` | Regeneration failed the deterministic medical floor |
| `introductory_limit_reached` | Another request won the last claim at atomic commit |

A fallback uses `fallback_reason`; a refused regeneration uses `reason`. For `model_failed`,
`model_failure` distinguishes `http_<status>`, `timeout`, `network_error`, `truncated` and
`output_rejected` (empty, invalid JSON/schema, or unsafe output rejected by policy).
Only fixed codes are exposed; upstream bodies are neither returned nor logged by this path.
`finish_reason:length` is treated as incomplete output per the
[OpenAI Chat Completions contract](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/retrieve).
The HTTP/body distinction follows [Supabase's function status guidance](https://supabase.com/docs/guides/functions/status-codes).
No external service supplied clinical evidence.

### Smoke account and owner-only follow-up

Use a disposable, onboarded account with consent if the gate is enabled. Premium (internal
`plus`) is the simplest AI/versioning probe. Also run Free with fewer than three claims used
for the complimentary-claim path; one used is valid. Under a post-limit on-demand policy,
use an available credit or a report covered by an existing claim. Do not change entitlement
or production flags just to make a smoke pass.

The target must have parsed analytes, no interpretation, and not be processing. Uploading in
the app normally starts generation, so a successfully analyzed upload is already unsuitable;
opening the report may also trigger generation. Prepare an ungenerated synthetic target and
avoid leaving its report page open during the owner-run probe. The script only selects
existing reports; it does not fabricate or modify clinical data. Its comments and
`factory/gates.md` describe the required state.

The smoke no longer calls a fallback an AI success. It reports the plan/claim count, timings,
fixed failure codes and an actionable hint; expected eligibility/AI-pause preconditions are BLOCKED,
missing-key/read/upstream failures FAIL, and every non-PASS exits nonzero. Permanent fallback preconditions
skip the guaranteed-failing regeneration. Transient model failures can still exercise a
regeneration. Account deletion remains the final check whenever the run wrote anything.
Older deployed functions are explicitly reported as lacking diagnostic codes.

Owner checklist (names only; no secret values were inspected):

- Ensure `OPENAI_API_KEY` is set for `generate-interpretation`, valid, funded, and authorized
  for `gpt-4o-mini`. A supplied but invalid key returns `model_failure:http_401`; quota or
  provider throttling may return `http_429`.
- Verify existing `FREEMIUM_ACTIVE`, `FREEMIUM_POST_LIMIT_GENERATION`,
  `interpretation_visibility_config.enabled` and `app_server_config.ai_kill_switch` match
  the intended rollout. The pause reader caches for five minutes. Keep the web
  `VITE_FREEMIUM_ACTIVE` setting consistent with the backend.
- `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are the standard runtime
  configuration, not new manually introduced secrets. No new secret names are required.
- After review/merge and separate owner GO: deploy **only `generate-interpretation`** for
  these backend changes; the web changes need the usual Netlify build. No migration is
  added. Native distribution would need the normal web asset sync/rebuild, not native
  source changes. No deploy or sync was performed here.
- The owner may rerun `scripts/smoke/v2-post-deploy.mjs` with the existing explicit production
  flag and `SMOKE_SUPABASE_URL`, `SMOKE_SUPABASE_ANON_KEY`, `SMOKE_TEST_EMAIL`,
  `SMOKE_TEST_PASSWORD`. **It deletes the disposable account after writes.** Agents must not
  execute that production command. A fresh response/log is required to establish the
  original runtime cause; this investigation cannot retrospectively do so.

## B. One primary finding and two clearly named comparisons

The old deterministic headline enumerated Amani-band differences in input order, so ferritin
and TSH led even though their supplied lab intervals contained their values. The nutrient
focus rule named the entire category "Iron markers" whenever any iron marker appeared.
The health story reused that category title, independently of the selected Vitamin D primary.
The server also invited "optimal" language and preserved a model's conflicting overall text.
First upload generation did not send the primary pin that manual regeneration already sent.

Changes:

- Apply Owner Ruling 7's neutral lab-flag floor in the client finding/focus ranking, using
  existing `labIntervalPlacement` and the laboratory's supplied bounds only. Every lab
  flag stays visible even for withheld Amani interpretation or a value inside its Amani band.
  The floor is a true floor (owner ruling, 2026-10-23; A1's first option in
  [the owner's ruling](../../factory/lab-flag-floor-decision.md)): a lab-only finding ranks
  after every Amani-flagged result in top findings and focus areas, and takes the Primary
  finding slot only when nothing on the report is Amani-flagged. A lab flag on an
  Amani-flagged result changes its wording, never its rank; a marker Amani withholds for
  cycle or pregnancy context never lets its lab flag outrank an Amani-flagged one. Tied
  lab-only findings are ordered by catalog position, then slug, so the upload-time pin and
  the page agree whatever the row order. Amani concern scores remain untouched. This does
  not close the launch item before merge/review.
- For the specified synthetic panel, the headline names Vitamin D 24 and LDL 112 as
  below/above their respective lab ranges, and Vitamin D (Amani-flagged too) is primary. Ferritin 18 and TSH 2.85 are explicitly within their lab ranges.
  Tests also cover Vitamin D 25, as visible in the supplied screenshot.
- Show lab placement on collapsed biomarker cards beside the printed ranges. Explain that
  Amani's comparison band is separate and still under clinical review. System counts remain
  explicitly counts outside **Amani bands**, with a matching explanatory introduction.
- Use "Nutrients" for mixed iron/non-iron categories; name the exact primary marker in the
  health story and align its focus area by marker. First upload sends the same deterministic
  primary pin as the report page/manual regeneration.
- Ground prompt and deterministic/stored overall text in the selected primary and exact
  lab placement. Numeric movement is described without judging improvement or deterioration.
  The server's existing 8% classifier margin still determines internal claim statuses; it
  no longer words a measured value's position against the printed lab range.
- Preserve nutrient validation/retry/fail-closed sanitization, the medical floor, claim
  authority, Basic no-expansion, append-only history and legacy quarantine. The web continues
  to suppress unauthorized model prose; prompt instructions alone never grant authority.
  Already-stored versions are not rewritten. Their raw contradictory model prose remains
  suppressed by the existing web rendering policy.

### Clinical-review question — deliberately unresolved

The catalog already flags evidence gaps for ferritin's 30–150 ng/mL Amani band and TSH's
1–2.5 mIU/L Amani band. For a woman aged 35–44, what reviewed assay/specimen/context evidence
supports showing those bands and prioritizing their differences when the printed lab ranges
contain 18 and 2.85? Vitamin D's 50–80 ng/mL Amani band also needs reviewed endpoint/context
support. Does the reviewer want these bands retained, context-qualified, or withheld?
No clinical answer is inferred here. Catalog values, scoring thresholds, units, evidence
status, and the server claim vocabulary are unchanged. The neutral lab floor does not
establish clinical urgency or authorize treatment advice.

## Verification

Final gate results and remaining release gates are recorded below after execution. All
browser data are invented fixtures with a reserved `.invalid` backend and enforced network
guards. [Summary screenshot](summary.png) and [expanded report screenshot](report.png) are generated by the committed Playwright consistency
test, with real fonts loaded from this worktree's own `npm ci` installation.

Key proofs:

- `src/lib/insights/smokePanel.test.ts`: both Vitamin D values, withheld primary, and a lab flag
  inside an Amani band kept visible but ranked after an Amani-flagged finding, without changing
  concern scores. `src/lib/insights/labFlagFloor.test.ts`: the true floor, its Primary-slot rule
  and the deterministic tie order.
- `supabase/functions/_shared/generation-pipeline.smoke.test.ts`: executes real source through
  prompt construction, response/schema/policy validation and shaping with a fake upstream.
  Tests missing key, pause, exhaustion, HTTP failures, timeout, network, truncation,
  invalid/schema-rejected output, nutrient rejection, and contradictory overall model prose.
- `generation-outcome.test.ts`: every fallback reason against the actual depth/pause/shaping
  decision, not an independent copy of that policy.
- Existing handler/version/entitlement suites: no writes or credit consumption on a refused
  regeneration, success at one used claim, atomic settlement, immutable history and cached
  request-id retries.
- Smoke-script network fakes: fallback never PASS; clear codes, old deployment, timing,
  skipped invalid targets and account cleanup. No live account or network is used.
- Existing page-wide unit/browser clinical-language checks remain active. Tests were updated
  to assert lab facts on newly lab-led surfaces rather than deleting those assertions.

Local execution on 2026-10-20:

| Gate | Result |
|---|---|
| `npm ci` | PASS; worktree-local dependencies, no lockfile changes |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS; 0 errors, 9 existing hook/refresh warnings |
| `npm run validate:contrast` | PASS |
| `npm test` | PASS: 158 files, 3,073 tests; both medical guardrail suites included |
| `npm run test:e2e -- --workers=3` | PASS: 186 tests across Chromium, WebKit and Firefox; no skipped selected tests |
| `npm run test:e2e:isolation` | PASS: served-module canary in a disposable checkout of the staged source; both HTTP 200, synthetic env present, inherited/file canaries absent, cleanup verified |
| `npm run build` | PASS with synthetic Supabase build variables |
| `npm run check:functions` | PASS: 53 checked / 61 discovered; 8 existing baseline exclusions unchanged |
| `npm run clinical:check` | PASS: 83 catalog entries, 198 ranges, policy byte identity |
| `npm run clinical:test:ci` | PASS: 57 tests |
| `npm run check:pinned-imports` | PASS: 119 sources, no unpinned remote imports |
| `bash tools/release/check.sh` | PASS; offline automation checks, not a release |
| `./supabase/migrations/__verification__/run.sh` | PASS in disposable Docker Postgres, through case 990; container cleaned up |

Additional direct `deno check` of `generate-interpretation/index.ts` still reports the same
four existing diagnostics as `96f636d`: rate-limit-store RPC/client generics, optional report
context return, and the consent-port client shape. Both baseline and working source were
checked with `--node-modules-dir=none --no-lock`. This extra check is not reported as passed;
the configured ratchet still excludes that handler, and no exclusion was added. Pure new
shared modules are included in the passing configured check, and the real handler/model
pipeline is exercised by the Vitest source-execution harness.

Independent reviewer G4 sign-off, owner merge/deploy GO, production smoke with the new codes,
and device/store QA remain pending. This single-agent session provides implementation and
local evidence, not an independent review or clinical approval. No native files or migrations
changed. The original production root cause and live secret/flag state remain unverified.
