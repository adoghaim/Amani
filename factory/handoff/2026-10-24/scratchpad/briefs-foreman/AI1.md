# AI1 — Validate lab-insights output, reasoning-model parameters, one model config, fixed client errors

- Track: **ai-calls** · branch `factory/rv-ai-calls` (already created at origin/main 22027b2; packets on a track run in order and build on each other)
- Reserved migration range: none — this track adds no migrations (if one is unavoidable, stop and put it under handoffs)
- Harness: do NOT run `gates harness` (db-security owns the lock this wave)
- Review lenses after you: correctness + tests, clinical authority (G4)
- Files this packet owns (others may touch nearby code concurrently): supabase/functions/lab-insights/**; supabase/functions/_shared/<new model config>; model-id + error lines in parse-lab-report-ocr and extract-biomarkers; docs/privacy/ai-processing.md
- Findings: F017, F131, F128, F033

## Decisions already made for you (follow them; deviations need evidence in your result)

1. Do NOT switch any model: replacements need an eval and owner sign-off. Do: one _shared module holding every OpenAI model id the app uses plus per-model request rules (reasoning models such as gpt-5*: no temperature, max_completion_tokens; chat models: as today); optional env-var overrides documented by name; wire lab-insights, parse-lab-report-ocr and extract-biomarkers to it with minimal edits. generate-interpretation's wiring is a handoff.
2. F131: stop sending temperature to gpt-5-mini in lab-insights now and use the token-limit parameter that model accepts; add a test for the request body.
3. F017: run findTextViolations over every string lab-insights returns; drop violating list items; blank (or fail with a fixed 502) a violating summary or change line — mirror the null contract; put the nutrient allow-list and the dosage/prescriptive bans in its prompt (import from nutrient-policy); bound or omit free-text intervention titles in the prompt. Pure _shared module + tests.
4. F033 (non-billing sites only): extract-biomarkers (~457-461, ~619-623), parse-lab-report-ocr (~341-345, ~483-486), lab-insights (~339-347): return fixed error codes/messages to clients as generate-interpretation does (~2101-2105), and log details through _shared/phi-scrub.ts. Billing functions belong to the billing tracks.
5. F128 docs: update MODEL_PRICES if it is keyed by model; add to docs/privacy/ai-processing.md a per-function model table with OpenAI's shutdown dates (gpt-5-mini 2026-12-11; gpt-4o and gpt-4o-mini 2027-01-14, per OpenAI's deprecations page fetched 2026-10-23) and the migration steps as owner actions.
6. Other tracks edit parse-lab-report-ocr (input validation, response shape) and extract-biomarkers (censored values) concurrently: keep your hunks to model ids, request params and error returns.

## Findings (verbatim from the 2026-10-23 review of main@22027b2; line numbers refer to that commit)

### F017 — lab-insights returns unvalidated AI text, including supplement and medication talk

- Location: `supabase/functions/lab-insights/index.ts:307` · severity low · category unvalidated-ai-output · owner_action=False

**Evidence**

lab-insights only normalizes the shape of the completion (parseLabInsightsCompletion/normalizeLabInsights, lab-insights-output.ts:99-153). validateInterpretationOutput and sanitizeViolations have exactly one caller, generate-interpretation (repo-wide grep), so their null contract is honoured there and nowhere else. factory/gates.md:106 requires every AI prose path to run validateInterpretationOutput. The prompt interpolates her tracked interventions (index.ts:194-198, 233-234), whose categories include 'supplement' and 'medication' (src/types/index.ts:353). It asks the model to 'Mention interventions as hypotheses' and to give 'General next steps' (239-241), with no allow-list, dosage or banned-supplement rules (217-255; gpt-5-mini at temperature 0.7). Current main shows the modal only through authorizeModelProse. release/1.0.6's InsightsModal renders summary, change, possible_factors, questions_to_ask and next_steps_general verbatim (git show release/1.0.6:src/components/InsightsModal.tsx), and lab-insights-output.ts:25-28 itself notes that shipped native builds cannot be updated.

**Recommendation**

Run findTextViolations over every returned string. Drop violating list items, and blank (or 502) a violating summary or change line, mirroring the null contract. Put the nutrient allow-list and the dosage/prescriptive bans into the prompt. Bound or omit free-text intervention titles in the prompt.

**Verifier's note**

The code facts hold. lab-insights/index.ts:194-241 puts tracked interventions (categories include supplement and medication) into the prompt and asks for 'possible factors' and 'general next steps'. It runs gpt-5-mini at temperature 0.7, and the output is only shape-normalized. validateInterpretationOutput and sanitizeViolations have one caller, generate-interpretation (grep). However, the finding misquotes gates.md:106, which covers only 'New AI prose paths', and lab-insights dates from 2026-01-25, before the gate. TASK-046 REPORT.md:154-155 records it as not under claim authority but premium- and render-gated. Main's InsightsModal renders only authorizeModelProse output and suppresses questions_to_ask/next_steps_general. Verbatim rendering exists only in 1.0.6, on owner test devices. This is a hardening item.

### F131 — lab-insights sends temperature 0.7 to gpt-5-mini, a reasoning model that does not accept it, so Compare insights probably fail on every call (since b5db3d5)

- Location: `supabase/functions/lab-insights/index.ts:278` · severity medium · category correctness · owner_action=False

**Evidence**

lab-insights/index.ts:266 sets model 'gpt-5-mini' and :278 sets 'temperature: 0.7'. git show b5db3d5 (2026-05-01) switched the model from gpt-4o-mini to gpt-5-mini and kept the temperature.

OpenAI's model page lists GPT-5 mini as a reasoning model ('Reasoning token support'). OpenAI's current docs (fetched with Context7 from developers.openai.com) say to remove temperature whenever reasoning effort is not 'none', and that 'temperature changes not supported for reasoning models'. This request sets no reasoning_effort, so it runs with the model's default reasoning.

A rejected request throws at :285, after the user's daily lab-insights quota has already been charged (enforceRateLimit at :120). The caller (Tracker.tsx:417) then shows the comparison's error line. Tests mock fetch, so nothing exercises the real request.

Not run against the live API: there is no key, and the hard rules forbid it.

**Recommendation**

Owner, read-only check: run select count(*) from ai_call_costs where function_name = 'lab-insights'. Cost rows are written only after an ok response, and the ledger has existed since the 2026-10-16 deploy. Or search the function logs for 'Error generating insights'.

Fix: drop temperature, or move to a model and effort that accept it, as part of the model migration. Add a test that pins the allowed request parameters for each model.

**Verifier's note**

Confirmed in code; I did not test against the live API (no key, and the rules forbid it). lab-insights/index.ts:266 sets model gpt-5-mini and :278 sets temperature 0.7, with no reasoning_effort. In git show b5db3d5 the model line changes from gpt-4o-mini to gpt-5-mini while temperature: 0.7 stays. The current OpenAI guide says the GPT-5 family (gpt-5, gpt-5-mini, gpt-5-nano) supports only minimal, low, medium and high effort, never none, and that temperature must be removed when effort is not none. That matches the well-known 400 'Only the default (1) value is supported' error for GPT-5 reasoning models. The daily quota is charged at :120 (enforceRateLimit) before the call. A non-ok response throws at :286 and becomes a 500 at :337-347; fetchWithBackoff retries only 429 and 5xx. Tracker.tsx:417-449 then shows the error line. The cost ledger is written only after an ok response. Real-world impact today is small: the roadmap records about 5 test users, and lab-insights is Premium-only when freemium is on.

### F128 — Every OpenAI model the app calls is being shut down (gpt-5-mini on 2026-12-11, gpt-4o and gpt-4o-mini on 2027-01-14) and there is no migration plan

- Location: `supabase/functions/parse-lab-report-ocr/index.ts:328` · severity high · category dependency · owner_action=False

**Evidence**

Models in the code: parse-lab-report-ocr/index.ts:328 uses 'gpt-4o' for photo and weak-PDF OCR, generate-interpretation/index.ts:1239 and extract-biomarkers/index.ts:444 use 'gpt-4o-mini', and lab-insights/index.ts:266 uses 'gpt-5-mini'.

OpenAI's deprecations page (GET https://developers.openai.com/api/docs/deprecations, raw HTML read 2026-10-23, saved at /private/tmp/claude-501/-Users-mawad-Desktop-Amani/2048ad66-9c99-4989-a05c-97d6d9e03a48/scratchpad/openai-dep/dep.html) says:
- '2026-10-14: GPT-4 series model deprecations ... removal from the API on January 14, 2027 ... GPT-4o (gpt-4o-2024-08-06, gpt-4o-2024-11-20) -> gpt-6-luna; GPT-4o mini (gpt-4o-mini-2024-07-18) -> gpt-6-luna'.
- '2026-06-11 ... Dec 11, 2026 gpt-5-mini-2025-08-07 -> gpt-5.6-terra'.

The model pages mark the gpt-4o, gpt-4o-mini and gpt-5-mini aliases Deprecated, with only those snapshots behind them.

After the shutdowns:
- Photos go only to OCR (NewReport.tsx:430-440, callOcrFallback). Camera and photo uploads, and the weak-PDF fallback, will drop to manual entry.
- Every interpretation will quietly become generateFallbackInterpretation.
- Compare insights will fail.

There is no migration plan and no model-eval suite: git grep for gpt-6, gpt-5.x and PK-EVAL only finds the lane list at docs/designs/roadmap-gap-review.md:258. The nutrient-policy and claim-authority suites only run against mocked model output. OpenAI's migration guide says to remove temperature and top_p when reasoning is on, and all four requests send temperature, so changing only the model string will break them.

**Recommendation**

Pick the replacements now and ship before 2026-12-11:
- Put the model ids in one _shared constant.
- Change the request parameters per the guide (drop temperature, use max_completion_tokens, or set reasoning_effort).
- Run the nutrient-policy and claim-authority suites, plus a synthetic golden-set eval of OCR and interpretation, against the new models.
- Update MODEL_PRICES, docs/privacy/ai-processing.md and the privacy and store disclosures.
- Deploy.

Also put someone on OpenAI's deprecation notices and track shutdown dates in the factory ledger.

**Verifier's note**

Confirmed. I fetched developers.openai.com/api/docs/deprecations again by GET; the copy is byte-identical to the saved dep.html. It lists gpt-4o-2024-08-06, gpt-4o-2024-11-20 and gpt-4o-mini-2024-07-18 for removal on 2027-01-14, and gpt-5-mini-2025-08-07 on 2026-12-11. The fresh model pages mark the gpt-4o, gpt-4o-mini and gpt-5-mini aliases Deprecated, and every snapshot behind them is Deprecated too. Code models: parse-lab-report-ocr/index.ts:328 (gpt-4o), extract-biomarkers:444 and generate-interpretation:1239 (gpt-4o-mini), lab-insights:266 (gpt-5-mini). All four requests send temperature (:334, :450, :1249, :278). What breaks: photos and camera captures go only through callOcrFallback (NewReport.tsx:404, 419, 430-475), which ends with 'Falling back to manual entry'. callOpenAIOnce returns null when the response is not ok, so the handler serves the deterministic fallback (:1175-1192, :1454-1500). lab-insights throws, which gives a 500. The current latest-model guide says GPT-6 Luna defaults to reasoning.effort medium and that temperature and top_p must be removed whenever effort is not none, so changing only the model string would break the requests. git grep finds no gpt-6 or gpt-5.x id, no deprecation plan and no eval or golden set; PK-EVAL-01 appears only in roadmap-gap-review.md:258. Side note: CLAUDE.md says interpretations use gpt-4o-2024-08-06, but the code uses gpt-4o-mini.

### F033 — Several edge functions return internal error text (OpenAI, Stripe, Postgres, RevenueCat) to the client

- Location: `supabase/functions/extract-biomarkers/index.ts:621` · severity low · category error-handling · owner_action=False

**Evidence**

extract-biomarkers throws `OpenAI API error: ${errorData}` containing the raw OpenAI response body (index.ts:457-461), then returns errorMessage(error) in its 500 response (:619-623). parse-lab-report-ocr does the same (:341-345, :483-486). lab-insights returns the message (:339-347), and stripe-checkout returns Stripe's message (:256-259). create-portal-session returns error.message and error.type (:105-115). delete-user-data returns step messages such as 'Deleting users row failed: <postgres message>' (:294-298). verify-iap-purchase returns up to 200 characters of RevenueCat's response body (:158-161, :273-276). generate-interpretation already returns a fixed message for exactly this reason (index.ts:2101-2105). Verification: code reading.

**Recommendation**

Return fixed error codes and messages to clients, as generate-interpretation does, and keep the detail in server logs, scrubbed through _shared/phi-scrub.ts.

**Verifier's note**

Verified each site. errorMessage() returns the raw e.message (_shared/errors.ts:4-8). extract-biomarkers puts the OpenAI body in its error (:457-461) and returns it (:619-623). parse-lab-report-ocr does the same (:341-345, :483-486). lab-insights returns the message (:339-347), stripe-checkout returns it (:256-259), and create-portal-session returns error.message and error.type (:105-115). delete-user-data step errors embed Postgres and storage messages (:178-230) and are returned at :294-298. verify-iap-purchase returns up to 200 characters of RevenueCat's body (:158-161, :273-276). generate-interpretation already returns a fixed message (:2101-2105). This is information disclosure to the caller only, so low.

