# Synthetic model eval (owner-run)

RV-MM1. OpenAI shuts down the models the four AI edge functions call:
`gpt-5-mini` (lab-insights) on **2026-12-11**, and `gpt-4o` / `gpt-4o-mini`
(OCR, extraction, interpretation) on **2027-01-14**
([deprecations](https://developers.openai.com/api/docs/deprecations), read
2026-10-24). The suggested replacements are `gpt-5.6-terra` for lab-insights
and `gpt-6-luna` for the other three. This eval sends the same synthetic
reports through each function's own request code with today's model (the
baseline) and with a candidate, and says per use whether the candidate is
ineligible (BLOCKING) or what it measured next to the baseline. Choosing a
model is the owner's decision; the eval names no winner.

It is run by the owner only, on their own machine, with an eval-only OpenAI
key. It never runs in CI: there is no npm script or workflow for it, CI's
Vitest config does not include `*.eval.ts`, and the run refuses when `CI` is
set. It never reads `OPENAI_API_KEY`.

## What it sends

- Only the committed synthetic fixtures in `fixtures/`. Every case says
  `synthetic: true` and names the repository file its values were copied from
  (`copiedFrom`); `fixtures.test.ts` proves each copy. No variable or argument
  can add an input. Never put real or de-identified reports here: an accuracy
  check on real reports is EXP-7, a separate track.
- Only `POST https://api.openai.com/v1/chat/completions`. Anything else throws
  and fails the run. Nothing talks to Supabase.
- Every request is built by the functions' own code, read from their source:
  the model from `resolveOpenAiModel` with the candidate in that use's secret,
  the limits from `chatCompletionParams` with each function's numbers, JSON
  mode, `store: false`, the reasoning effort secret and the per-attempt
  timeout, all as the function sends them. Interpretation runs through the real
  `produceInterpretation` pipeline, retry and fallback included.

## Variables (names only; never paste the key anywhere)

| Variable | Meaning |
|---|---|
| `AMANI_EVAL_OPENAI_API_KEY` | An eval-only OpenAI key, for a real run |
| `AMANI_EVAL_DRY_RUN=1` | No key and no network: build, check and write every request |
| `AMANI_EVAL_CANDIDATES` | Optional. `use=model[@effort]`, comma-separated, e.g. `labInsights=gpt-6-luna,interpretation=gpt-6-luna@low`. Uses: `ocr`, `extraction`, `interpretation`, `labInsights`. Efforts: `none minimal low medium high xhigh max` (reasoning models only). Default: every use, with its suggested replacement |
| `AMANI_EVAL_REPEATS` | Calls per case and model, 1 to 10 (default 3) |
| `AMANI_EVAL_MAX_CALLS` | Request cap for the run, retries included (default 200) |
| `AMANI_EVAL_OUT_DIR` | Where the full JSON goes (default: a new OS temp directory). A directory inside the repository is refused |

## Run it

From the repository root, after `npm ci`:

1. Dry run first. It needs no key and sends nothing; it renders the OCR pages,
   builds every request, checks each against its target, prints the plan (calls
   and worst-case cost) and writes the requests to `report.json`:

   ```
   AMANI_EVAL_DRY_RUN=1 npx vitest run -c scripts/model-eval/vitest.eval.config.ts
   ```

   The OCR pages are rendered with Chromium. Without it, OCR is SKIPPED and the
   other uses still run; install it with `npx playwright install chromium`.

2. Real run, with the eval-only key set in your shell for this command only:

   ```
   AMANI_EVAL_OPENAI_API_KEY=... npx vitest run -c scripts/model-eval/vitest.eval.config.ts
   ```

   Before the first call it prints how many calls it plans (and refuses if that
   is over `AMANI_EVAL_MAX_CALLS`) and the worst-case cost at list prices. It
   makes one call at a time; the default plan is 144 calls.

On Windows use your shell's way of setting a variable for one command (for
example `$env:AMANI_EVAL_DRY_RUN = '1'` in PowerShell, then remove it).

## Reading the result

stdout holds one table, one row per use and model (baseline first), and the
path of `report.json`; no model text and no key. The full record, with the
synthetic answers and the request bodies (images elided, rendered pages saved
next to it), is in `report.json`.

- **BLOCKING** (ineligible) for a use and model when any call got a 4xx, an
  attempt timed out, an answer was cut off (`finish_reason: "length"`) or empty,
  an interpretation broke the medical floor or its served payload failed the
  nutrient-policy validator, an extraction or OCR answer parsed to zero rows, or
  a value was neither printed on the fixture nor the documented `<X`
  placeholder (half the limit).
- **INCOMPLETE**: some calls got no answer after the function's own retries
  (5xx or network). Re-run before deciding anything.
- **SKIPPED**: OCR without Chromium.
- **ELIGIBLE**: nothing blocked; read the metrics against the baseline row.
  `checks` counts, per use: interpretation answers served (`ai`), schema and
  policy failures, retries, answers the policy discarded (`sanitize-null`, the
  user gets the deterministic interpretation); lab-insights parses, violating
  strings and refusals (her 502); extraction and OCR rows found, value, value
  text, unit and range matches, extra rows, OCR source snippets and cycle
  metadata against what is printed (`inferred` = metadata nobody printed).
  `reasoning/cap` is the largest reasoning-token count against the output
  limit sent. When the baseline gave no answer at all (for example after its
  shutdown) the table says so and the candidate's metrics stand alone.

Any BLOCKING or INCOMPLETE verdict, any refused request and any refusal fails
the run.

## What it does not prove

- Clinical quality. It checks only deterministic guardrails (schema, nutrient
  policy, medical floor, lab-insights' policy) and extraction fidelity against
  the printed synthetic page. Whether a candidate's prose is clinically sound is
  for the clinical reviewer.
- Real photos (glare, shadows, handwriting, phone cameras) or real report
  layouts: the pages are rendered synthetic text, clean and slightly degraded.
- Load, rate limits or latency under production traffic: calls are sequential.
- Cost: the estimates use the list prices in `_shared/ai-cost-ledger.ts`; the
  owner confirms those.

## Switching a model, and rolling back

The code defaults do not change. Each function reads its own secret:
`OPENAI_MODEL_OCR`, `OPENAI_MODEL_EXTRACTION`, `OPENAI_MODEL_INTERPRETATION`,
`OPENAI_MODEL_LAB_INSIGHTS`, and optionally
`OPENAI_REASONING_EFFORT_OCR|EXTRACTION|INTERPRETATION|LAB_INSIGHTS`.

1. Record the sign-off for the model (and effort) chosen per use. If
   lab-insights moves to `gpt-5.6-terra` (list price 8x the input and 6x the
   output of `gpt-5-mini`), review `ai_monthly_budget_usd` first.
2. Deploy the function first: a secret works only once the function that reads
   it is live (generate-interpretation reads its secret from RV-MM1 on).
3. Set the secret on the Supabase project (dashboard or `supabase secrets set`).
4. Confirm: new rows in `ai_call_costs` carry the new `model`, error rates stay
   flat, and `scripts/smoke/v2-post-deploy.mjs` passes.
5. Roll back by unsetting the secret: the function returns to its default.

Do this for lab-insights before 2026-12-11 and for OCR, extraction and
interpretation before 2027-01-14, with margin.
