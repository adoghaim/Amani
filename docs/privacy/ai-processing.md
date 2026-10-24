# AI processing: what Amani sends to OpenAI

> **DRAFT for lawyer review. This is not legal advice.** PK-PRIV-01 (EXP-6).
> Function behaviour is taken from the code on this branch (main at 948dc95
> plus this packet's redaction). Statements about OpenAI's terms are the
> drafter's understanding at the time of writing and are marked
> **[lawyer to confirm]** against the current OpenAI API data-usage policy and
> any signed agreement.

## 1. Calls that leave Amani

All four calls go from a Supabase edge function to
`https://api.openai.com/v1/chat/completions` with the server-side secret
`OPENAI_API_KEY`. The client never calls OpenAI directly. The user's email,
password, auth token and user id are not sent in any of them.

| Function | When it runs | Model in code | What is sent | Redacted by this packet? |
|---|---|---|---|---|
| `extract-biomarkers` | The on-device parser read a PDF but its result looks unreliable, so the model checks the work | `gpt-4o-mini` by default; secret `OPENAI_MODEL_EXTRACTION` overrides | The **full text extracted from the report** plus extraction instructions | **Yes.** `redactLabText(text)` runs before the prompt is built |
| `parse-lab-report-ocr` | A photo is uploaded, or a PDF the parser cannot read is rendered to images | `gpt-4o` (vision) by default; secret `OPENAI_MODEL_OCR` overrides | The **page images** (at most 10 per call, `MAX_IMAGES`) plus instructions | **No.** Pixels cannot be redacted server-side without sending them to an OCR engine first. See section 4 |
| `generate-interpretation` | The user asks for an interpretation of a report | `gpt-4o-mini` by default; secret `OPENAI_MODEL_INTERPRETATION` overrides | Biomarker names, values, units, reference ranges and statuses; report date; cycle day/phase notes; report context (symptoms, pregnant, postpartum, birth control); the optional profile block (preferred first name, age range, sex at birth, reproductive status, health goals, things to keep in mind); deterministic primary context and trend evidence against a prior report | **Yes**, the whole user message passes through `redactLabText` on every attempt (first and stricter retry). The "Preferred name" line is deliberately kept (see [Pending] 1) |
| `lab-insights` | The user compares two reports | `gpt-5-mini` by default; secret `OPENAI_MODEL_LAB_INSIGHTS` overrides | Report dates, the most notable biomarker changes (name, previous and current value, unit, delta), cycle phase/day for both reports, and the title, category and dates of tracked interventions active in the window | **Yes**, the whole user message passes through `redactLabText` |

What the redaction removes and keeps is documented in
`supabase/functions/_shared/lab-text-redaction.ts` and proven by
`lab-text-redaction.test.ts`: names, dates of birth, record / accession /
specimen / requisition / member / account numbers, addresses, phone numbers,
e-mail addresses and SSNs go; biomarker names, values, units, flags, ranges,
dates of service, age and sex stay. It is pattern-based minimisation, not
de-identification: an unlabelled name printed outside a patient block is not
caught, and the CEO plan records that as an accepted, tracked risk.

### What the model's answer becomes

- `extract-biomarkers` and `parse-lab-report-ocr` return result rows that are
  stored in `report_analytes` / `report_items`. The OCR answer includes a
  `source_snippet` copied from the image, which can contain identifiers.
  `extract-biomarkers` rows carry a `source_snippet` the function reads from
  the redacted text: one printed line from the result's label, at most 200
  characters, or `null` unless exactly one line matches. The model does not
  write it.
- `generate-interpretation` output is validated by
  `_shared/nutrient-policy.ts`, regenerated once on violation, sanitised, and
  replaced by the deterministic fallback when sanitising fails closed. It is
  stored as an interpretation version.
- `lab-insights` output is parsed by `_shared/lab-insights-output.ts`, then
  every string in it is checked against the same nutrient policy
  (`_shared/lab-insights-policy.ts`, review F017): violating list items and
  changes are dropped, and a violating summary refuses the whole answer with a
  fixed 502. The prompt also carries the allow-list and the dosage and
  prescriptive-verb bans, and sends tracked-intervention titles only when they
  are short, plain and policy-clean (never for medications). The result is
  returned to the client.
- The three non-billing AI functions (`extract-biomarkers`,
  `parse-lab-report-ocr`, `lab-insights`) return a fixed error message to the
  client; OpenAI's response body and other internal text are logged only through
  `_shared/phi-scrub.ts` (review F033).

## 1a. Models, shutdown dates and migration

Every model id and its request rules live in
`supabase/functions/_shared/openai-models.ts` (review F128, F131). Reasoning
models (gpt-5*, gpt-6*, o-series) get `max_completion_tokens` and no
`temperature`; chat models keep `max_tokens` and `temperature`. An id can be
replaced without a code change by setting a function secret (names only):
`OPENAI_MODEL_OCR`, `OPENAI_MODEL_EXTRACTION`, `OPENAI_MODEL_INTERPRETATION`,
`OPENAI_MODEL_LAB_INSIGHTS`. All four functions read theirs;
`generate-interpretation` does from RV-MM1 on, once that function is redeployed.
A reasoning model's effort is set the same way, per function:
`OPENAI_REASONING_EFFORT_OCR`, `OPENAI_REASONING_EFFORT_EXTRACTION`,
`OPENAI_REASONING_EFFORT_INTERPRETATION`, `OPENAI_REASONING_EFFORT_LAB_INSIGHTS`,
each one of `none`, `minimal`, `low`, `medium`, `high`, `xhigh` or `max`. Unset,
the default, no `reasoning_effort` is sent and the model's own default applies;
a chat model never gets the field. The table below is also
`OPENAI_MODEL_SHUTDOWNS` in the module, and a test keeps the two equal.

| Function | Use key | Model today | OpenAI shutdown (deprecations page, read 2026-10-23, re-checked 2026-10-24) | OpenAI's suggested replacement |
|---|---|---|---|---|
| `parse-lab-report-ocr` | `ocr` | `gpt-4o` | 2027-01-14 | `gpt-6-luna` |
| `extract-biomarkers` | `extraction` | `gpt-4o-mini` | 2027-01-14 | `gpt-6-luna` |
| `generate-interpretation` | `interpretation` | `gpt-4o-mini` | 2027-01-14 | `gpt-6-luna` |
| `lab-insights` | `labInsights` | `gpt-5-mini` | 2026-12-11 | `gpt-5.6-terra` |

The table follows the code. Cost estimates: `MODEL_PRICES` in
`_shared/ai-cost-ledger.ts` is keyed by model prefix and prices the three ids
above and both suggested replacements, at OpenAI's list prices (pricing page,
standard tier, read 2026-10-24; USD per 1M input / output tokens): `gpt-4o`
2.50 / 10.00, `gpt-4o-mini` 0.15 / 0.60, `gpt-5-mini` 0.25 / 2.00, `gpt-6-luna`
0.10 / 0.50, `gpt-5.6-terra` 2.00 / 12.00. The owner confirms the figures
**[Pending]**. A model it does not list is priced at the highest listed rate
until a row is added.

No model was switched in this packet. After the shutdown dates, photo and
weak-PDF OCR fall back to manual entry, every interpretation becomes the
deterministic fallback, and Compare insights fail, so the migration below has to
land before **2026-12-11**.

### Migration steps (owner actions; none can be done by the factory)

1. Choose a replacement per function and sign off the choice.
2. Run the synthetic eval, `scripts/model-eval/README.md`: it sends the same
   synthetic reports through each function's own request code with today's
   model and the candidate, runs the nutrient-policy validator, the claim
   authority and the medical floor on the real model output, and reports per
   function whether the candidate is BLOCKING or what it measured. It checks
   deterministic guardrails only; the clinical quality of candidate prose is
   for the clinical reviewer.
3. Confirm the `MODEL_PRICES` figures for the chosen models
   (`_shared/ai-cost-ledger.ts`; both suggested replacements are listed).
4. Set the matching `OPENAI_MODEL_*` secret on the Supabase project; it takes
   effect once the function that reads it is deployed. The request parameters
   follow the id automatically; set an `OPENAI_REASONING_EFFORT_*` secret only if
   the eval shows one is needed, and confirm the latency fits each function's
   timeout (`lab-insights` allows 18 s per attempt).
5. Update the model names in the privacy policy and store disclosures (section 5,
   question 3), then deploy the functions that read the secret.
6. Track OpenAI's deprecation notices and the dates above in the factory ledger.

## 2. OpenAI's retention, and zero data retention (ZDR)

Drafter's understanding **[lawyer to confirm]**:

- OpenAI states that API inputs and outputs are not used to train its models
  unless the customer opts in.
- By default, API content may be retained for up to 30 days for abuse and
  misuse monitoring, then deleted, unless the law requires longer. In 2025 a US
  court preservation order in litigation against OpenAI affected the retention
  of some API content for customers without ZDR; the lawyer should confirm
  whether any such obligation is still in force.
- **Zero data retention** is offered to approved customers for eligible
  endpoints: content is not stored at rest for abuse monitoring. It requires an
  application to OpenAI and approval; it is not a setting Amani can turn on in
  code. Some features (for example stored responses, files, or certain tools)
  are not eligible. All four calls send `store: false`. OpenAI says Chat
  Completions are stored by default for new accounts, so whether calls made
  before that setting was deployed were stored depends on the account
  **[lawyer to confirm]**.
- OpenAI offers a Data Processing Addendum and, for eligible customers, a
  Business Associate Agreement. Amani is likely not a HIPAA covered entity, so a
  BAA may not be needed, but the DPA should be signed.

### Owner actions (each needs the owner; none can be done by the factory)

1. Sign OpenAI's DPA for the organisation that owns `OPENAI_API_KEY`.
2. Apply for ZDR for the Chat Completions endpoint, including vision input,
   and record the answer and its date in the ledger.
3. Confirm that the API project behind `OPENAI_API_KEY` has no data-sharing
   or training opt-in enabled.
4. Update `src/pages/Privacy.tsx` with the lawyer once ZDR is granted or
   denied. The current copy says OpenAI "is retained only for a limited period
   for abuse monitoring", and that the text sent "typically includes your name
   and date of birth"; after this packet deploys the text path no longer
   carries labelled identifiers, but the image path still does, so the copy
   stays accurate (it overstates the text path) until the lawyer revises it.

## 3. If ZDR is denied: fallbacks

| Fallback | Effect | Cost |
|---|---|---|
| A. Keep redaction (this packet) and disclose 30-day retention | Labelled identifiers no longer reach OpenAI on the text path; health values still do | None beyond copy; residual risk is the image path and unlabelled names |
| B. Route the image path through on-device OCR, then the redacted text path | Images never leave the device | Native work (threat-model.md 6.3 option 1) |
| C. Use a provider that offers zero retention by default for health workloads (e.g. a cloud-hosted model under a healthcare agreement) | Removes the OpenAI copy | Vendor change, re-validation of the nutrient-policy guardrail and the interpretation eval |
| D. Explicit per-use AI consent (PK-CONSENT-01) and a "no AI" mode that serves the deterministic interpretation only | User controls the exposure | Product: the deterministic interpretation is shorter |
| E. Pseudonymise the remaining quasi-identifiers: send cycle day but not report date; age range only | Lower linkability | Small loss of context in prose |

The drafter's suggestion for discussion: A immediately, D as part of the
consent design already required (D7.1), and B before a public launch that
promotes photo upload. **[Pending, owner + lawyer]**

## 4. The image path

`parse-lab-report-ocr` sends the images as `data:` URLs. Redaction would need
the text, which is what OCR produces, so redaction would have to run after the
exposure it is meant to prevent. The options (on-device OCR, on-device crop or
blur, a separate OCR processor with suitable terms, ZDR, or pausing photo
upload) are compared in threat-model.md section 6.3. This packet changes
nothing on that path.

## 5. Questions for the lawyer

1. Is sending lab values and reproductive context to OpenAI under a DPA and
   30-day retention acceptable under the consumer-health-data laws that apply,
   with the consent the app collects today?
2. Does the "Preferred name" line (the user's first name, entered voluntarily
   and used once in the greeting) need to be removed or separately consented?
3. Must the privacy policy name each model, or is "OpenAI" enough?
4. What should the privacy policy say about the image path until it is
   redacted or moved on-device?
