# TASK-047 turn 1 — exposure measurement and proposed read quarantine

Approach: characterize the existing pure TypeScript compiler and actual read orchestrator with synthetic canaries, trace the deployed-by-migration SQL definitions and client consumers, then propose a separate authority boundary before customer serialization. The root cause is that confidentiality selection is being used as authority: legacy Basic sanitization retains some typed assertions and prose, while Full selection bypasses authority altogether. This turn changes only tests and this design; it does not implement or certify a fix.

Baseline: `b69f4b4893fce2d2f6f71a1c20561a162450f30e`, branch `v2/03d-legacy-read-quarantine`. No production data was queried. “Exposure” below means possible served content at this code baseline, not a count of affected production rows and not proof that the current client displays it. The existing client gate remains relevant.

## 1. Correction to CONTRACT §1

The Lead is correct about **projectBasic alone**: absent/invalid claim sets return null preview and all three counts zero, yet retain unauthorized safety assertions. The characterization's entire-output equality proves a lone `critical_findings` object survives as `{biomarker_slug:'x',critical:true,status:'discuss'}`. It also proves extracted `primary_concern.urgent` survives in `safety_findings`.

The claim that the overall read exposure is narrow is incorrect:

- Basic also retains bounded model `headline`, its `basic_interpretation` copy, and string `questions_for_doctor`. These are confidentiality exceptions, not evidence of clinical authority. Canary text `Amber paper boats` and `Violet paper boats` survives. A field's intended non-clinical purpose does not validate arbitrary text placed there.
- Typed `status:'normal'` and `critical:false` survive too. Stripping only abnormal/true flags would leave unsupported reassurance.
- Numeric values, reference limits, units, slugs, related slugs and cycle facts are type-filtered, not independently verified against measured data. Their shape alone cannot prove factual authority.
- The actual Basic reader does **not** call projectBasic: the service RPC selects/sanitizes stored `json_output_basic`; readInterpretation sanitizes it again and gates preview/counts. Both SQL and TS sanitizers allow `flagged_trends` wholesale. A stored `{flagged_trends:[{text:'Copper paper boats',critical:true}]}` survives the TS customer response. Recompiling that same body with projectBasic drops that field because no qualifying trend evidence exists. Thus full-to-Basic compilation and stored-Basic reads do not expose the same set.
- Paid/claimed deep rows and freemium-OFF reads return stored Full verbatim. `Indigo paper boats` in overall interpretation and `Silver paper boats` in primary concern survive the actual read orchestrator. Paid non-deep AI rows return the unsafe legacy floor with `generation_needed`; deterministic non-deep rows are returned whole.
- Source `fallback`/`deterministic` is a separate, pre-existing trust decision based on the database column. It preserves deterministic prose; a model JSON `source` field must not obtain this exemption.

These are server-boundary findings, not newly demonstrated browser leaks. ReportView's `modelProse` and marker prose go through `authorizeModelProse`; its primary headline uses policy language. Current client defense does not authorize the server payload.

### Exact measured Basic fixture output

`supabase/functions/_shared/legacy-read-characterization.test.ts` pins every key/value of one rich AI fixture, rather than using a forbidden-word scan:

| Output key | Measured value |
|---|---|
| headline, basic_interpretation | `Amber paper boats` |
| questions_for_doctor | `['Violet paper boats']` (object question removed) |
| disclaimer | existing server default; model disclaimer removed |
| cycle_context | day 7, phase follicular, confidence high, explanation empty |
| key_findings | `[{biomarker_slug:'x',value:12,unit:'mg/L',status:'normal',critical:false}]` |
| critical_findings | lone object `{biomarker_slug:'x',critical:true,status:'discuss'}` |
| safety_findings | `[{urgent:true,biomarker_slug:'x'}]` extracted from primary concern |
| top_findings, summary_bullets, safety_notes, abnormal_flags, flags, warnings, what_to_do_next | empty arrays |
| preview | null |
| locked | patterns=0, cross_report=0, lifestyle=0 |

No other keys survive this fixture. Finding explanations, primary concern container/prose, overall prose, original disclaimer and next-step prose are dropped. This is a bounded fixture measurement; the code's broader typed allowlist additionally admits previous/current values, reference_min/max, related_biomarkers, seven boolean flags and four status-key aliases. It does not establish clinical validity for any of them.

### Version handling and SQL comparison

There is no universal `claim_policy_version` field:

1. Full compiler uses `clinical_claims.policy_version` and **revalidates the entire claim set** through storedClaimSet.
2. Stored-Basic reader and SQL interpretation_claim_gate use `locked.claim_policy_version`; preview additionally needs `preview.claim.policy_version` and its expected category/rule/authority fields. Neither revalidates the Full claim set on that path.
3. Root `claim_policy_version` confers no authority.

Executed tests cover missing, null, numeric, object and future versions; all are legacy in the relevant marker location, nulling preview/counts while leaving flags. A current set version with malformed claims also fails Full validation. The split-marker canary has a future Full set but current Basic count marker: projectBasic gives zero while servedBasic gives patterns=9. A current Basic marker is not sufficient evidence that the underlying Full row passed policy.

SQL source evidence: `20261012000002_claim_policy_basic_gate.sql` only merges preview/locked; its compatibility Full/OFF branch returns `i.json_output`. `20260927000001_basic_cycle_context.sql` defines both read sanitizers and the latest server RPC, including untouched flagged_trends. For equivalent stored Basic inputs, SQL is designed to match TS sanitizeBasicProjection + servedBasic (same legacy flag/prose survival). Neither is equivalent to recomputing projectBasic from Full. SQL malformed/future marker tests use explicit JSON types and known-version equality, so inspection predicts the same zero counts. **No SQL was executed here; runtime equality is pending the Lead's harness.** Do not call a text inspection or TS reimplementation of SQL a parity proof.

## 2. Five paths, classified before implementation

| Path | Raw legacy returned today? | Claim authority today | Entitlement | Customer-renderable? | Existing structural protection and gap |
|---|---|---|---|---|---|
| Authenticated Basic, get-interpretation | Not whole raw Full; partially sanitized stored Basic | Preview/count marker only; no legacy safety authority | TS entitlement + RPC premium/claim selection | Yes, response.interpretation feeds client | Ownership read, service-only RPC, Basic allowlist stop cross-owner/Full access. No raw-vs-renderable payload type; retained fields are untrusted. |
| Paid/claimed customer | Yes, deep Full; deterministic non-deep whole; AI non-deep floor | Full body none; top-level preview/count separately gated | Existing premium/claim logic | Yes | Ownership/entitlement are structural, **claim boundary absent**. OFF returns Full regardless of depth. |
| Compatibility view/direct authenticated RPC | Yes for Full or visibility OFF; Basic partial raw channels otherwise | Basic preview/count only | SQL full-reader decision and visibility switch | Yes; ReportView direct view queries at lines 454, 505, 545, 642 | Definer binds auth.uid; private table inaccessible to authenticated; view has no raw alias. But selected json_output itself is unsafe. |
| Edge/internal projection RPC | Yes for premium/claimed; sanitized Basic otherwise | RPC has no claim gate; caller only gates preview/count | Server-derived premium boolean + DB claim | Intended intermediate, but its json_output flows straight to customer | Service-role EXECUTE grant and ownership predicate are real access controls. “Internal” non-renderability is **documentary only**: same Record payload and direct passthrough. |
| Service-role/admin private-table access | Yes, both historical columns | None | No customer entitlement on administrative storage access | Must not be; representation currently reusable | Private table grants/RLS exclude customer roles; service retains ALL. No type/serialization boundary prevents a future service caller from returning raw JSON. |

The only application caller of read_interpretation_for_server is get-interpretation. Its `maybeSingle` TypeScript generic supplies a shape, not runtime proof. ReportView has independent compatibility reads, so changing only this edge endpoint cannot close the exposure.

## 3. Proposed design for Lead approval — no behavior implemented

### Authority before entitlement selection

Add a read-only, source-aware classification/quarantine layer. Inputs are persisted provenance plus Full policy data and the selected existing representation. Treat missing, unknown/future, malformed, or invalid current claim sets as legacy. Do not infer authority from tier, age, a Basic marker alone, a claimed report, or model flags. Preserve the existing current-policy path byte-for-byte in served output; do not retrofit new-policy claim issuance or change its accepted rules.

The database can inspect Full authority locally without transmitting Full to a Basic caller. Expose a customer projection RPC whose body is already quarantined, with a versioned transport discriminant **outside** interpretation JSON. Retain existing ownership and entitlement predicates exactly. Compatibility view must call the same SQL authority/quarantine functions on both selected branches, including switch-OFF. The switch controls entitlement, not whether legacy prose is authoritative. This is a proposed implementation of the inlined owner ruling, not an instruction to flip any switch or deploy.

TypeScript needs the same pure legacy transform for projection helpers and read orchestration; it must not infer trust from a client-controlled/JSON-body marker. Separate the transport row from the payload. The endpoint adapter should validate the expected response shape and pass a customer projection type; unknown response format fails closed instead of falling back to raw content. Do not gate current Basic twice: servedBasic strips its policy marker, so a second visibleClaimProjection zeros valid counts. Keep the policy decision outside the served payload or gate exactly once, with an idempotence fixture for the legacy transform.

For a genuine raw consumer, use a separate service-only storage reader with a non-renderable wrapper (private member/opaque handle, no json_output or spreadable payload property, throwing toJSON). The only extraction operation must be internal to the quarantine/projection module. Use a separate customer response serializer accepting only the customer projection type, plus runtime rejection of a raw wrapper. Do not expose a raw route merely for this task; the private administrative table can remain available under existing grants. The customer RPC itself should no longer return raw legacy bodies. Tests must fail if the endpoint directly serializes a raw wrapper; TypeScript branding alone is insufficient. A service credential can inherently read storage; this boundary prevents accidental application plumbing, not a malicious privileged administrator.

### What legacy preserves or refuses

- Preserve trusted outer report metadata (id, report id, dates, disclaimer version, source, tier); do not copy arbitrary model metadata fields.
- Preserve existing deterministic source floor only on authenticated database provenance, as already permitted by the owner. Keep Basic selection no wider than before. Test spoofing a JSON source field, and unknown/null source.
- For AI/unknown legacy, remove all model clinical narrative, flags/statuses (including false/normal/reassuring), recommendation fields, derived safety_findings and flagged_trends. Do not just add the existing abnormal-only strip. Headline becomes the existing neutral policy/default text; questions are empty unless separately authorized, basic_interpretation follows that neutral default. No new clinical copy is authored.
- Typed numbers/slugs in historical model JSON are not validated measurements. Do not relabel or promote them as verified. Initial implementation can omit unverified finding/cycle values and retain neutral required-field defaults. Actual report measurements remain on the independently loaded lab-data path. If retaining a measured fact is required, validate against a trusted source, retain only a fact already present in the selected projection, and test mismatch rejection. Do not re-run interpretation or manufacture safety claims.
- Legacy preview is null and all locked counts are zero. Never run the preview selector on remaining legacy material. No replacement is promoted when another item is withheld. Do not mint clinical_claims, claim_audit or a current policy marker for quarantined content.
- A separately authorized fact may be preserved only with an actual independently validated provenance contract. This task must not invent one for legacy rows. No new clinical rule, threshold, evidence grade or SAFE status.

Default shell text and required empty structure are not a new insight. No Basic key is added. Test visibility as containment of clinical content/items and unchanged entitlement, not object-key count (required defaults are not claims). For Basic, filter the already selected stored Basic; do not recompile from Full or fill missing fields with other historical model items.

### SQL is necessary

A TS-only fix leaves the directly granted compatibility RPC/view callable by authenticated clients and used by ReportView. interpretation_claim_gate currently touches only preview/locked, and is bypassed altogether on Full/OFF. Therefore a new branch-only migration is required in a later turn; frozen migrations stay untouched.

Avoid a superficial version-only SQL check that disagrees with storedClaimSet. Port its validation contract (known version, exact rederived trend claims, safety-fact/authority equality, invalid entries fail closed) or introduce a shared equivalent validator verified against it. Account for object key order, JSON numeric semantics, missing vs null, duplicate claims and array ordering; JSONB structural equality must agree with contentFingerprint's semantics on admitted JSON fixtures. Do not widen acceptance merely to make SQL simpler. Test valid current rows before/after at the exact response boundary, not just storage.

Use a single synthetic JSON corpus consumed by Vitest and loaded by psql, with expected customer projections for Full/Basic/deterministic and expected trust classifications. Compare canonical JSON outputs from the **real database functions** to TS outputs. Include inconsistent Full/Basic markers and invalid current sets. Static vocabulary/source comparisons are supplementary only.

## 4. Ten required future proofs and named killing mutations

These are a test design, not claims of completed quarantine proof. Today's characterization intentionally asserts unsafe behavior and must be replaced by regression assertions when implementation lands. Every future control must first exercise a route where removing quarantine really exposes its canary.

| # | Proof and execution boundary | Named mutation that must fail it |
|---|---|---|
| 1 | Legacy lone-object critical flag and each flag/status alias, arrays/nested/outside-floor shapes: both server responses omit assertions; page shows no claim. | M1: return the pre-quarantine selected body for the lone-object safety branch. Raw fixture must positively contain critical=true. |
| 2 | Canary headline/question/prose and historical stored preview absent from all legacy Basic customer bodies; preview=null. | M2: bypass the whole new customer authority stage and return selected stored Basic, including canary preview. Bypassing only the new safety strip cannot test preview already suppressed by V2-03c. |
| 3 | Legacy rejected catalog items and populated stored locked counts yield exactly zero. | M3: copy stored locked counts into response after quarantine, bypassing existing and new preview/count gates. Test positive raw nonzero counts first. |
| 4 | Clinical-content containment relative to previous entitlement selection for every path/tier/source/switch state; no added Basic keys or cross-owner data. | M4: for Basic fill one omitted field from Full (a Full-only canary); or treat claimed=false as true. Each variant must be detected. |
| 5 | Candidate A removed with eligible-looking B behind it leaves preview null; no reselection. | M5: invoke selectPremiumPreview on the surviving historical catalog after dropping A and assign its result. Fixture must demonstrate selector would choose B. |
| 6 | Capture BOTH stored JSONB columns as ordered per-row UTF-8 encoded jsonb::text bytes before migration and before reads; compare after migration and after all reads. Include current, legacy, malformed rows and unrelated owners. | M6: add UPDATE that removes one legacy key from json_output, then independently from json_output_basic; each breaks the captured-byte assertion. JSONB cannot recover pre-ingest original source formatting; assert exact stored serialization bytes, not invented original JSON bytes. |
| 7 | Valid current-policy customer responses and raw columns match baseline on all tiers/sources/depths, including previews/counts and Full/OFF. Positive authorized safety/trend controls remain nonempty. | M7: classify every row as legacy, or apply visibleClaimProjection twice to already served Basic; either loses a positive current control. |
| 8 | Authenticated/anon cannot call raw reader/private table; customer RPC never returns raw canary; TS compile rejection and runtime serializer rejection of raw wrapper. | M8a: grant raw RPC EXECUTE/private SELECT to authenticated. M8b: serialize the raw wrapper or return raw from customer RPC. Both independent boundaries need a failing control. |
| 9 | Same corpus through actual SQL quarantine/classification and actual TS functions gives equal canonical results. Includes missing/null/numeric/object/future/current-invalid versions and inconsistent markers. | M9: SQL treats unknown version as current, or preserves critical_findings while TS drops it. Mutate SQL only; parity must fail in Docker. |
| 10 | Two independent controls: server body clean even with client gate replaced by identity; client still rejects a deliberately injected raw canary with normal gate. Preserve positive policy-authorized language. | M10a: bypass server quarantine (raw response assertion fails even with working UI). M10b: bypass authorizeModelProse/client gate (injected-raw browser assertion fails even with correct server). A clean-server UI test alone cannot prove client defense. |

Coverage matrix to enumerate in the shared corpus: five paths; free/unclaimed, claimed, premium; switch on/off; deep/standard/unknown; ai/unknown/null/fallback/deterministic plus spoofed JSON provenance; every finding and safety key; lone object/array/string/null/nested forms; normal/borderline/abnormal flags plus false; absent/malformed/future/current-invalid/current-valid policy; divergent Full/Basic markers; populated/missing preview/counts; unauthorized owner. Pairwise coverage is not a claim of exhaustive combinations: include explicit high-risk intersections (OFF+legacy, claimed+legacy, Basic+lone-object, Basic+flagged_trends, Basic+future-Full/current-Basic).

## 5. Approval and remaining evidence

Turn 1 is investigation only. Lead design approval precedes behavior changes. No independent or adversarial review was performed by this implementer, and no acceptance criterion is self-certified. Owner ruling already authorizes legacy quarantine; any proposal to retain unvalidated legacy prose as clinically authorized, expand entitlement, or change clinical policy must be held for the owner.

Lead-only gates remain: Docker migration harness and SQL runtime parity, database byte-identity captures, check:functions, deterministic browser suites and env-isolation canary, exact-committed-head independent/adversarial reviews, CI. This environment prohibits network, Docker and localhost binding. No deployment, production-data access, switch change, commit, push or vault write occurred.

Second Brain handoff (not a vault update): confirmed locally on 2026-10-08, at the baseline above, TypeScript characterization demonstrates the wider legacy read exposure; SQL source predicts the same stored-Basic gap and Full bypass, runtime unverified. No project decision changed and no Pending item was closed. Local Brain notes were read as historical context only; synchronization was intentionally skipped because network and vault writes are forbidden. The supplied owner ruling and live code outrank that stale local snapshot. Next actions: approve/refine this design, implement TS and structural boundary, implement/rehearse SQL in a later turn, execute the ten mutation controls and independent reviews before any production consideration.

## 6. Local turn-1 verification results

- `npx vitest run supabase/functions/_shared/legacy-read-characterization.test.ts`: 19/19 passed.
- `npm test`: final run 1,626/1,626 tests, 74/74 files passed (80.04 s).
- `npm run typecheck`: passed (app, clinical tools and E2E TypeScript; not the Deno function gate).
- `npm run lint`: passed with nine existing warnings, zero errors. Shared function tests are ignored by this command; `npx eslint --no-ignore supabase/functions/_shared/legacy-read-characterization.test.ts` separately passed.
- `npm run clinical:check`: passed; 83 catalog entries, 83 analytes / 198 ranges, movement-policy byte identity.
- `npm run build`: passed (21.64 s).
- `git diff --check`: passed. This checks tracked diff whitespace, not untracked artifact contents.

These are local execution results, not independent review or release certification. No mutation experiments were executed in turn 1; the table specifies future killing mutations. Storage-byte identity and current-policy response identity under the proposed quarantine remain unproven because the quarantine is intentionally not implemented.
