# TASK-048 / V2-03e — Turn 1: investigation of the paid-legacy regeneration path

Base `ca3754b`, branch `v2/03e-paid-legacy-regeneration`. Documentation only. I changed no behaviour, and nothing below has been run against a database.

## 0. Verdict

**The existing regeneration path overwrites the historical interpretation in place, so the STOP condition applies.** Every writer reachable from "Regenerate" ends in `INSERT … ON CONFLICT (lab_report_id) DO UPDATE` on the single `interpretations_private` row for the report. That replaces `json_output`, `json_output_basic`, provenance columns and `generated_at`, and keeps the row `id`. No history or version table exists. A non-destructive versioning mechanism (section 7) needs its own migration turn with the Docker harness before any $0 path is built.

Separately from the ruling, overwriting is **already reachable today** for legacy rows (section 2, Q6). The $0 path is not the only thing that can destroy them.

### Corrections to the brief (with evidence)

1. **"A paid/claimed legacy report serves `access: 'full'` + `stored_depth: 'deep'`" is only true for two kinds of viewer: someone who is Premium right now, or someone whose report holds an introductory claim.** `interpretation-read.ts:67` sets `full = premium || row.has_claim`. A **lapsed subscriber** reading a deep row from their subscription era gets `access: 'basic'`. That path is `interpretation-read.ts:84-88`, and the body is the legacy floor after quarantine. `FreemiumReportPanel.tsx:165` then shows *"See the full Premium analysis / Unlock Premium"*, which asks the customer to **buy again** what they already paid for. `freemiumCanRegenerate` also returns false for that state (`stored_depth === 'deep'`, `reportAccess.ts:90`). So there are two stranded states, not one.
2. **The CTA is hidden only on the flag-on client.** With `VITE_FREEMIUM_ACTIVE` off, `canRegenerate = report.regeneration_count < 3 && entitled` (`ReportView.tsx:1274-1276`). A currently entitled user (trial included) therefore **sees "Regenerate (N left)" on a quarantined legacy report**. Clicking it overwrites the legacy row in place (Q1).
3. **No durable record of a paid report exists for subscription-era rows.** `interpretations.tier` is documented as *"Descriptive only — never an access decision"* (`20260904000000_interpretations_tier_column.sql:55-56`). It was written as `plus` for **trial** and **complimentary** users as well:
   - with freemium inactive, `resolveTier` returns `plus` for every allowed entitlement (`tier.ts:183-193`);
   - `trial` is an allowed reason (`entitlement.ts:365`).

   The only durable report-level entitlement record in the schema is `introductory_deep_access_claims`.
4. **The contract's "paid claim" has nothing matching it in the code.** Stripe sells subscriptions only (`stripe-config.ts:23,34`, `mode: 'subscription'`), and no per-report purchase is recorded anywhere. The only claim ledger is the introductory one. "Consume no paid claim" is therefore satisfied by construction, provided the path does not touch Stripe. The live risk is the **introductory** claim (Q7).

## 1. Call graph (regenerate click → storage → read)

```
ReportView.handleRegenerate                          src/pages/ReportView.tsx:1110
 ├─ guard: regeneration_count >= 3 → return          :1111
 ├─ guard: flag on → freemiumCanRegenerate(...)      :1112  (reportAccess.ts:88-91)
 │         flag off → entitled                       :1112
 ├─ client UPDATE lab_reports {status:'processing',
 │                regeneration_count:+1}             :1154-1157  (column grant: 20260501000000:24)
 └─ functions.invoke('generate-interpretation',
        {reportId, primary_canonical_slug})          :1158-1163
     generate-interpretation/index.ts  Deno.serve    :1271
      ├─ auth.getUser                                 :1296-1304
      ├─ enforceRateLimit 20/day ('generate-interpretation')  :1306-1310
      ├─ ownership (service read of lab_reports)      :1322-1338
      ├─ checkUserSubscription → generationVisibilityMode
      │     (switch read only for allowed+plan 'free')  :1340-1359; entitlement-response.ts:15-25
      ├─ resolveTier → 402 if gate block              :1360-1370; tier.ts:162-218
      ├─ load report, profile, analytes, prior report :1372-1452
      ├─ trend evidence ONLY if active                :1455-1459
      ├─ if active && tier free:
      │     content hash → blood_draw_id; decideIntroductoryAccess  :1525-1551; introductory-access.ts:165-211
      ├─ shouldGenerateDeepInterpretation             :1554-1558; response-shaping.ts:21-34
      ├─ tryOpenAI (validate → regenerate once → sanitize → null)  :1588-1610
      ├─ shapeInterpretation (AI or deterministic fallback)        :1612-1617; response-shaping.ts:81-99
      ├─ withClaimAuthority ONLY if active            :1624-1630; claim-authority.ts:285-296
      ├─ projectBasic / buildBasicProjection          :1631-1633
      ├─ if active && tier free: commitGeneratedInterpretation
      │     → RPC commit_deep_access_v2               :1651-1662, :1501-1522
      │        → commit_deep_access (claim INSERT? + UPSERT)   20260925000001:43-73 (retargeted 20260926000001:16-27)
      │        → save_interpretation(...,'deep',...)  20260926000000:181-195
      ├─ else RPC save_interpretation                 :1668-1684; 20260926000000:149-177
      ├─ service UPDATE lab_reports status 'ready'    :1687
      ├─ response {success, source, access, interpretation, preview, locked} (active) :1691-1698
      ├─ catch: 429 | status 'error' + 500            :1700-1725
      └─ finally: interpretation_generation_costs INSERT (active only)  :1726-1732
 ← flag on: refreshAccess() → get-interpretation      ReportView.tsx:1188
     get-interpretation/index.ts → readInterpretation (interpretation-read.ts:22-92)
       → RPC read_interpretation_for_server(user, report, premium)   20261012000003:154-165
           interpretation_read_quarantine(full, selected, source)    20261012000003:126-130
       → quarantineCustomerRead (TS, second layer)                  claim-authority.ts:385-388
 ← flag off: SELECT from view `interpretations`
       → read_compatible_interpretations() (also quarantined)       20261012000003:136-150
```

There are exactly two customer readers of interpretation storage: `read_interpretation_for_server` and `read_compatible_interpretations`, which backs the `interpretations` view. They have been redefined repeatedly; the definitions that matter are the latest ones in `20261012000003`. The only client reads of the view are `ReportView.tsx:454,505,545,642`.

## 2. The ten questions

### Q1. Does regeneration overwrite the existing historical row in place?
**Yes.** `save_interpretation` runs `INSERT … ON CONFLICT (lab_report_id) DO UPDATE SET json_output=…, json_output_basic=…, stored_depth=…, projection_version=…, blood_draw_id=COALESCE(…), interpretation_source=…, tier=…, generated_at=…, disclaimer_version=…` (`20260926000000:162-170`). A second `UPDATE … SET json_output_basic=p_basic, stored_depth=p_stored_depth` follows in the same transaction (`:174-175`). `commit_deep_access` does the same upsert (`20260925000001:64-73`), and `commit_deep_access_v2` then calls `save_interpretation` (`20260926000000:190-192`). `lab_report_id` is UNIQUE (`20260312070949:28`), so each report has one row and one body.

The client relies on this behaviour on purpose: *"`generate-interpretation` upserts on `lab_report_id` … a successful run replaces the row on its own"* (`ReportView.tsx:1144-1153`).

### Q2. Does it replace `json_output` / `json_output_basic`?
**Both.** It writes `json_output` from `p_interpretation` and `json_output_basic` from `p_basic`, at `:167` and again at `:174`. If a legacy writer changes `json_output` without supplying Basic, the trigger `prepare_interpretation_projection` replaces Basic with the floor and sets `stored_depth='unknown'` (`20260926000000:130-144`, later revisions `20260926000003:31`).

### Q3. Same interpretation ID or a new record/version?
**Same ID.** `id` is not in the `DO UPDATE SET` list, so the row keeps its primary key (`initial_schema.sql:111`) and its `lab_report_id`. No version, history, archive or `superseded` structure exists anywhere in `supabase/` or `src/`. I searched for `interpretation_(history|versions|archive)|historical_interpretation|superseded` and found only unrelated IAP and claim-authority matches.

### Q4. What happens to each attribute?

| Attribute | What happens on regeneration | Evidence |
|---|---|---|
| Claim-policy version | Overwritten. When `active`, the new body carries `clinical_claims.policy_version = "v2-03c.1"`, and Basic carries `locked.claim_policy_version`. The row that held the legacy body **becomes** a current-policy row under the same `id`. **When `active` is false, no claim set is written, so the regenerated AI row is itself quarantined on read.** | `index.ts:1624-1630`; `claim-authority.ts:30,349`; `20261012000003:71-73,126-130` |
| Provenance (`interpretation_source`, `tier`, `stored_depth`, `projection_version`, `disclaimer_version`) | All overwritten. On the Free ledger path a refused or failed commit writes `tier='free'`, **including on a report that holds a claim** whose model call failed (`committed=false → tier 'free'`). | `20260926000000:166-170`; `introductory-access.ts:316-317`; `index.ts:1661,1673` |
| `blood_draw_id` | `COALESCE(new, old)`: set when the Free path derived one, otherwise preserved. | `20260926000000:169` |
| Regeneration count | `lab_reports.regeneration_count` is incremented **by the client** before the invoke. The flag-on client restores it on any failure. The flag-off client restores it only on 429. **The server never reads or writes it.** | `ReportView.tsx:1154-1157, 1126-1130, 1175-1178`; `20260501000000:24` |
| Paid/claimed entitlement | An existing claim is untouched (`already_claimed`). An unclaimed Free-tier request with credit **INSERTs a new claim**. Stripe is untouched. | `20260925000001:43-59`; `introductory-access.ts:181-210` |
| Report linkage | Unchanged (`lab_report_id` is the conflict key). Claims use `report_id … ON DELETE SET NULL`, so a claim outlives its report. | `20260903000000:60` |
| Historical timestamps | `generated_at` is overwritten with `now()`, so the original generation time is **lost**. The table has no `created_at`. `lab_reports.status` goes `processing` → `ready` or `error`. | `20260926000000:165,170`; `initial_schema.sql:110-116`; `index.ts:1687,1716` |

### Q5. What server path authorizes regeneration today?
**None does.** Regeneration is not a separate concept on the server. `generate-interpretation` authorizes every request the same way:
1. JWT (`:1296-1304`)
2. rate limit, 20 per day (`:1306-1310`)
3. ownership (`:1322-1338`)
4. **current** subscription through `checkUserSubscription` → `generationVisibilityMode` → `resolveTier`, with a 402 on a block (`:1340-1370`)
5. for `active && tier === 'free'`, the introductory ledger (`:1525-1551`)

It never checks whether an interpretation already exists, never looks at `regeneration_count`, and never asks whether the stored row is legacy.

**The server half of the obstacle, stated plainly:**

- **Lapsed subscriber, subscription-era deep row, no claim:**
  - Flag on, switch ON → `tier: 'free'` → `findClaim` finds nothing. With credit left, the request is **charged an introductory claim** (`consumesCredit: true` → `commit_deep_access` INSERT). With credit exhausted, post-limit generation saves an AI body with `tier='free', stored_depth='deep'`, and the read path then serves **Basic** because neither `has_claim` nor `premium` holds.
  - Switch OFF → `generationVisibilityMode` returns `false` → the legacy entitlement is re-checked with freemium off → **402** (`:1356-1370`).
  - Flag off → 402.
- **Report holding an introductory claim, Free plan:** `existing_claim` → no credit consumed → deep generation → `already_claimed` → overwrite. That is $0 today, **but only when FREEMIUM_ACTIVE is true and the switch is ON**. With the switch OFF the same customer gets 402.
- **`active === false` (FREEMIUM_ACTIVE unset, or switch OFF on the Free path):** `withClaimAuthority` is skipped (`:1624-1630`). The new AI body has no `clinical_claims`, so `interpretation_has_current_claims` is false and **the regenerated row is quarantined on read**. The legacy prose is destroyed and replaced with another quarantined body. The customer sees the floor again.
- **Read side, even after a successful regeneration:** a lapsed customer reads Basic (`interpretation-read.ts:67`). A $0 generation alone would not restore the Full read for them.

### Q6. What client path decides whether the regenerate CTA appears?
- **Flag on:** `canRegenerate = freemiumCanRegenerate(accessState, regeneration_count)` (`ReportView.tsx:1274-1275`). It returns false when `regeneration_count >= 3`, there is no state, or `access === 'error'`. Otherwise it returns true when `access === 'generation_needed'` or `stored_depth !== 'deep'` (`reportAccess.ts:88-91`). The header button at `:1375` also hides on `generation_needed` with no body. The `generation_needed` panel CTA is separate (`FreemiumReportPanel.tsx:84-98`, labelled "Generate full Amani analysis" when a body exists) and calls `handleGenerate`, which does **not** increment the count (`ReportView.tsx:1210-1239`).
  - Paid/claimed legacy deep row, viewer currently Premium or claimed → `full` + `deep` → **hidden**.
  - Lapsed subscriber → `basic` + `deep` → **hidden**, and the upgrade banner is shown.
  - Legacy row with `stored_depth` in `unknown`/`standard` and a Full viewer → `generation_needed` with the legacy floor as the body → **"Generate full Amani analysis" is shown**. That click overwrites the legacy row. A lapsed viewer's click on such a row (`basic` + non-deep, so `canRegenerate` is true) is charged an introductory claim if credit remains.
- **Flag off:** `report.regeneration_count < 3 && entitled` (`:1276`), regardless of legacy status (correction 2).

### Q7. Which billing / claim / regeneration counters are touched?

| Counter | Touched by today's regenerate | Evidence |
|---|---|---|
| `rate_limits` (`generate-interpretation`, 20/day/user) | Always, before any other check, failures included | `index.ts:1306-1310` |
| `introductory_deep_access_claims` | INSERT when `active && tier free && consumesCredit` (no claim yet, fewer than 3 used); limit trigger at 3 | `20260925000001:48-59`; `20260903000000:139` |
| `lab_reports.regeneration_count` | Client +1, restored on some failures; **not enforced server-side** (client-writable column) | `ReportView.tsx:1154-1157`; `20260501000000:24` |
| `interpretation_generation_costs` | One INSERT per `active` request with `claim_consumed`, `deep`, plan | `index.ts:1563-1568,1727-1732`; `20260925000002:2-13` |
| Stripe / IAP | Read only (entitlement); never written | `subscription-guard.ts:69-87` |
| `get-interpretation` rate limit (600/day) | One read after completion | `get-interpretation/index.ts:14,35-44` |
| OpenAI spend | Up to 2 model calls (validate-retry) | `index.ts:1150-1200` |

### Q8. Can an expired or inactive subscriber regenerate a report that already carries durable paid/claimed entitlement?
- **Claimed report (introductory claim):** yes at $0, **only** when FREEMIUM_ACTIVE and the switch are both ON. Even then the result goes through the destructive overwrite. With the switch OFF or flag off it gets 402.
- **Subscription-era report, no claim:** no. The outcome is 402 (flag off or switch OFF), a **new introductory claim charged**, or a Free-tier deep row that reads as Basic. Under the current read contract such a report carries **no** report-level entitlement after the subscription lapses (`interpretation-read.ts:67`; `20261012000003:158-163`). See section 8, hold H1.

### Q9. Can a free legacy report accidentally qualify?
Yes, through any of these predicates if the implementation reaches for them:
1. **`access === 'full'` on a flag-off read.** With freemium off, `readInterpretation` calls `readSelected(true)` and returns `access: 'full'` for **every** owned row, free ones included (`interpretation-read.ts:40-51`). Eligibility must never be derived from the flag-off `access`.
2. **`stored_depth === 'deep'` alone.** Post-limit Free generation persists `tier='free', stored_depth='deep'` (`response-shaping.ts:84-90` with `index.ts:1554-1558,1673`). A legacy free row can therefore be deep.
3. **`tier IN ('plus', NULL)`.** That set includes trial and complimentary rows (correction 3). Using it widens eligibility unless the owner rules that it should (H1).
4. **Any client-supplied flag.** A `remediation: true` body field must never be trusted. The server re-derives eligibility inside the write transaction.
5. **Blood-draw matching.** A claim also covers a re-upload with the same `blood_draw_id` (`20261012000003:162-163`; `index.ts:1486`). That is the **existing** entitlement contract, so it does not widen eligibility. Legacy rows from before `20260926000000` have `blood_draw_id = NULL` and match only by `report_id`.

### Q10. What happens on generation failure or retry?
- **Model fails** (HTTP, schema, nutrient policy, or sanitize returning `null`): `tryOpenAI` returns `null`, and the **deterministic fallback is persisted** through the same overwrite with `source='fallback', stored_depth='standard'`, returning 200 (`index.ts:1602-1617`). The legacy prose is destroyed even on "failure". The deterministic body passes quarantine as trusted floor (`claim-authority.ts:386`), the row reads as `generation_needed` for a Full viewer, and the "Generate full" CTA reappears. On the Free ledger path the row is additionally relabelled `tier='free'` (Q4).
- **Persist fails** (RPC error): it is a single SQL function, so the transaction rolls back and the row is unchanged. `status='error'` is written, followed by a 500 (`:1677-1683`, `:1714-1720`).
- **Rejected before work** (401/402/403/404/429/503): nothing is written to the interpretation. A 429 does not write `status='error'` (`:1707-1712`). The other throws do.
- **Flag-on client:** `failFreemium` restores `status` and `regeneration_count`. A 402 **opens the paywall**, which would be wrong for a paid customer. A 429 shows the daily-limit notice. Anything else shows `regenerateErrorTitle/Body`, whose body reads *"Your current analysis is unchanged"* (`ReportView.tsx:1126-1142`; `copy.ts:83-85`). On a quarantined report that copy is misleading, because no analysis is displayed.
- **Flag-off client:** errors write `status='error'`; the count is restored only on 429 (`:1168-1186,1194`). The poll timeout compare-and-sets `error` (`:464-484`).
- **Old prose is never re-served on failure today,** and only because both readers quarantine it (`20261012000003:126-130,141,157`; `interpretation-read.ts:51,69`). Any new selection logic must keep that property (proof 8).
- **No automatic regeneration of legacy rows exists today.** Flag on, the auto-generate effect fires only when `generation_needed` **and** `interpretation === null` (`ReportView.tsx:613-619`). The quarantined floor is non-null, so it does not fire. Flag off, the effect requires `interpretation === null` (`:492`). Upload-time generation runs from `NewReport.tsx:753` for new reports only. No SQL migration calls a model.

## 3–6. Summary of persistence, entitlement, counters and failure

The detail is in Q1–Q10. The conditions that bind the implementation:
- **Persistence:** destructive. The STOP condition applies.
- **Entitlement:** the only durable report-level grant is the introductory claim. "Paid" for subscription-era rows needs an owner ruling (H1).
- **Counters:** the $0 path must bypass the subscription gate, the ledger and `regeneration_count`. The 20/day rate limit stays as the abuse bound. Recording costs is fine.
- **Failure:** the existing "failure" persists the deterministic fallback over the row. The remediation path must persist **nothing** unless a validated, claim-authorized deep AI body exists.

## 7. Schema implications and a non-destructive design

Two candidates. **I recommend Option A.** This is a schema decision for the Lead, and it goes through its own migration and Docker-proof turn.

### Option A (recommended) — append-only, service-only `interpretation_versions`
- **Table.** Columns:
  - `id uuid PK`
  - `lab_report_id uuid NOT NULL REFERENCES lab_reports ON DELETE CASCADE`
  - `supersedes_interpretation_id uuid NOT NULL REFERENCES interpretations_private(id) ON DELETE CASCADE`
  - `json_output jsonb NOT NULL`, `json_output_basic jsonb NOT NULL`
  - `stored_depth text CHECK (stored_depth = 'deep')`
  - `interpretation_source text CHECK (= 'ai')`
  - `tier text`
  - `claim_policy_version text NOT NULL`
  - `entitlement_basis text CHECK IN ('introductory_claim','premium_viewer')`, extended only by an owner ruling on H1
  - `generated_at timestamptz NOT NULL DEFAULT now()`
  - `requested_by uuid NOT NULL`
  - `UNIQUE (lab_report_id)` for v1 (one remediation per report)
  - `CHECK (public.interpretation_has_current_claims(json_output))` and `CHECK (claim_policy_version = json_output->'clinical_claims'->>'policy_version')`, so the database refuses a non-current body.
- **Access.** RLS on, service-only policy, `REVOKE ALL FROM PUBLIC, anon, authenticated`. Not published to realtime. No view. It inherits the confidentiality boundary of `interpretations_private` (`20260926000001:3-12`) and is added to `legacy-raw-access-guard.ts`'s list.
- **Writer `save_interpretation_remediation(...)`.** SECURITY DEFINER, service_role only. Inside one transaction it does the following, fail-closed:
  1. `FOR UPDATE` on the report and the private row
  2. verify ownership
  3. verify the private row is **legacy**: `NOT (source IN ('deterministic','fallback') OR interpretation_has_current_claims(json_output))`
  4. verify `stored_depth = 'deep'`
  5. verify the basis: a claim exists for (user, `report_id`) or (user, `row.blood_draw_id`), the same predicate as `has_claim`; or the premium decision passed in from TS, mirroring `read_interpretation_for_server`'s `p_premium`
  6. verify no version exists yet
  7. INSERT

  It **never writes `interpretations_private`**. It does not touch `introductory_deep_access_claims`, Stripe or `lab_reports.regeneration_count`.
- **Readers.** Both customer readers select **one whole tuple**: the version when one exists, otherwise the private row. Columns must never be mixed across the two sources. The result still passes through `interpretation_read_quarantine`, so a version without current claims would still be quarantined. `read_interpretation_for_server` gains a `remediation` column (`available | regenerated | null`) computed with the same predicate as the writer. The server is the single source of eligibility, and the client never computes it.
- **Ordinary writers.** `save_interpretation` and `commit_deep_access` must **refuse** to upsert over a report that has a version, or over a legacy deep row that meets the remediation predicate. Otherwise the flag-off "Regenerate" (correction 2) would still destroy the historical row, or the readers would silently ignore the write. Refusing returns an error the client turns into "use the remediation CTA". Whether to also protect **ineligible** legacy rows (legacy free) is a retention question; see H3.
- **Why A.** It meets the owner's letter, *"do not overwrite or 'upgrade' the historical interpretation in place"*: the legacy row keeps its `id`, bytes, `generated_at` and provenance. Proof 5 reuses the harness's existing at-rest snapshot pattern (`claim_gate_rows_at_rest`, `quarantine_storage_before` FULL JOIN on `interpretations_private`) unchanged.

### Option B — archive-on-update trigger
A `BEFORE UPDATE` trigger on `interpretations_private` copies `OLD` verbatim into a service-only `interpretation_history` when `OLD` is legacy AI. The existing writers then overwrite as they do now.
- **For:** it covers every writer, readers are unchanged, and the diff is smaller.
- **Against:** the row `id` that held the legacy body now holds the new one, which contradicts "do not … upgrade in place" and "never present the new as the original". Every existing at-rest harness proof changes meaning. It creates a second PHI store that grows with each ordinary regeneration.

### Common to both
- **Retention.** Report deletion and account deletion must remove versions and history: FK `ON DELETE CASCADE` to `lab_reports`, plus `delete_interpretations` extended. Retaining more health data in total is a confidentiality question; see H3.
- **No backfill.** The migration creates structure only. No `INSERT … SELECT` of generated content, and no model calls.

## 8. Eligibility, and holds for the owner

**Recommended v1 predicate** (no widening; mirrors the read contract that exists today). The server evaluates it, and it is re-checked inside the write transaction:

```
legacy(row)  := row.interpretation_source NOT IN ('deterministic','fallback')
                AND NOT interpretation_has_current_claims(row.json_output)
eligible     := legacy(row) AND row.stored_depth = 'deep' AND no version yet
                AND ( claim exists for (user, report_id) or (user, row.blood_draw_id)   -- durable claim
                      OR viewer.plan = 'premium' (flag-on TS decision) )              -- already Full on every report
```

**Holds — owner decides, not me:**
- **H1: lapsed subscription-era rows.** These are deep rows with `tier` of `plus` or `NULL`, no claim, and a subscription that has since expired. The ruling's words ("already paid for … not require a currently active premium subscription") point at them. The code holds **no durable proof** that they were paid: trial and complimentary rows look identical (correction 3). The current read contract gives them Basic, so including them is an **entitlement expansion beyond current code**. It needs a ruling on (a) whether `tier IN ('plus', NULL) AND stored_depth='deep'` counts as "durable paid entitlement", trial and complimentary included, and (b) whether the regenerated version then reads as **Full** for a lapsed viewer, which would change `read_interpretation_for_server`'s `full` selection for that one row. Until the owner rules, these customers keep seeing the upsell banner on a report they paid for. That is the state the ruling calls unacceptable, so H1 blocks production but not v1.
- **H2: failure-state copy.** The ruling requires "an appropriate retry state" but approves no wording. The existing `regenerateErrorBody` (*"Your current analysis is unchanged"*) is misleading on a quarantined report. Options are to reuse `errorTitle/errorBody` or to have the owner approve a new string.
- **H3: retention scope.** Should the non-destructive protection cover **only** remediation-eligible rows, or **all** legacy AI rows, including legacy free rows that the ordinary path overwrites today?
- **H4: whether "deep" requires AI success.** I recommend that a remediation which ends in the model failing persists **nothing** and shows retry, rather than persisting a deterministic version that would end eligibility and swap the deep entitlement for a standard one. That is product behaviour, so it needs owner confirmation.
- **Copy placement.** The approved string must enter through the policy layer. `FREEMIUM_COPY.report` in `src/lib/freemium/copy.ts` is the existing home for report-state copy, and `src/lib/scoring/insightCopy` owns clinical sentences (standing rule 2, `optimalWording.test.ts:228-244`). The Lead should name which module is "the policy layer" for this string. Either way, it ships as a single exported constant with an exact-string test.

## 9. Recommended implementation plan (after the schema decision)

| Turn | Scope | Gates |
|---|---|---|
| **T2: migration** | Option A table, `save_interpretation_remediation`, reader changes (whole-tuple selection plus a `remediation` column), refusal guards in `save_interpretation`/`commit_deep_access`, delete coverage. Structure only. | Docker harness: fresh replay and upgrade replay, rollback, byte-identity snapshot, ACL checks, and the SQL proofs in section 10 with switch ON **and** OFF |
| **T3: server** | Pure `_shared/legacy-remediation.ts` (eligibility decision plus ordering, behind an injected actions port, no Deno or Stripe imports). Thin `regenerate-legacy-interpretation` edge function, or a `remediation` branch at the top of `generate-interpretation`. Either way it skips `checkUserSubscription`'s 402 gate, `decideIntroductoryAccess` and the ledger. It **forces** `withClaimAuthority` and trend evidence whatever `FREEMIUM_ACTIVE` or the switch say. It requires AI success (H4). It persists through the remediation RPC only, and never calls `save_interpretation`. Rate limit stays. Cost row `claim_consumed=false`. `get-interpretation` surfaces `remediation` from the RPC. | Vitest on the pure module with fakes, `check:functions`, nutrient-policy suite |
| **T4: client** | `ReportView` and `FreemiumReportPanel` render the approved copy plus "Regenerate interpretation" iff the server says `remediation: 'available'`. A separate handler that **never** writes `regeneration_count` or `status`, never opens the paywall, and calls `refreshAccess` after it finishes. Failure shows the H2 copy with retry while lab values keep rendering. Flag-off "Regenerate" routes eligible rows to the remediation handler. | Vitest, lint/typecheck/build, Playwright spec with synthetic fixtures |

## 10. Proofs, each with the mutation that must make it fail

| # | Proof (where) | Mutation that must turn it red |
|---|---|---|
| 1 | Paid/claimed legacy report renders the **exact** approved copy and CTA (component test plus Playwright, asserting the full string, not a substring) | Change one character of the copy constant; make the panel ignore `remediation: 'available'` |
| 2 | Free legacy report (deep `tier='free'`, no claim; and standard) gets `remediation: null`, no CTA, and the writer raises (SQL plus TS) | Drop the claim/premium clause from the predicate; derive eligibility from `stored_depth='deep'` alone; derive it from the flag-off `access === 'full'` |
| 3 | Claims count, `regeneration_count` and `introductory_deep_access_claims` rows are identical before and after success **and** failure (SQL snapshot plus Vitest spy on the port) | Route the remediation through `commit_deep_access_v2`; increment `regeneration_count` in the handler; call `decideIntroductoryAccess` |
| 4 | Claimed Free-plan user with no subscription, with switch OFF **and** ON → success, not 402 | Reinstate the `resolveTier` gate or `generationVisibilityMode` in the remediation path |
| 5 | `interpretations_private` row for the report is **byte-identical** (`to_jsonb` and `convert_to(json_output::text)`) after success, model failure, persist failure and 402/429 (Docker) | Make the remediation writer call `save_interpretation`; let the trigger rewrite Basic; Option B's in-place update |
| 6 | Version row carries `clinical_claims.policy_version = 'v2-03c.1'` and passes `interpretation_has_current_claims`; the legacy row still fails it and has no `clinical_claims` key (SQL plus TS parity) | Skip `withClaimAuthority` when `active` is false; drop the table CHECK; stamp the legacy row |
| 7 | Response and UI never present the version as the original: version `generated_at` > legacy `generated_at`; no field, label or copy carries the legacy `id`/`generated_at` as the version's; the legacy row's `generated_at` is unchanged | Copy legacy `generated_at` into the version; reuse the legacy `id` |
| 8 | On model failure, persist failure and network failure: lab values render, the served body is the quarantined floor (a canary phrase from the legacy prose is absent from the DOM and the response), retry is offered, no paywall | Fall back to selecting `i.json_output` when the version is absent without quarantine; persist the deterministic fallback; open the paywall on 402 |
| 9 | No code path writes a version without a user action: the migration contains no INSERT into versions; the auto-generate effects never call the remediation handler (spy); no cron or trigger calls it | Add the remediation call to the `generation_needed` auto effect; add an `INSERT … SELECT` to the migration |
| 10 | TASK-047 quarantine unchanged for every ineligible row: rerun the 48-case corpus and the `legacy-quarantine.*` harness with switch ON and OFF, and assert both directions (current-authorized plus OFF → Full; legacy plus OFF → floor) | Bypass `interpretation_read_quarantine` on the version branch; let the version branch match ineligible rows |
| + | Readers never mix columns across the version and the private row | Select `v.json_output` together with `i.interpretation_source` |
| + | Concurrency: two concurrent remediation requests produce exactly one version, and the loser is a clean retryable failure | Remove the `FOR UPDATE` or the `UNIQUE (lab_report_id)` |

## 11. Gates in this turn
- No migration, function or client code was changed, so no SQL, Deno or browser gate applies to this turn's diff.
- **SKIPPED (backup implementer policy; for the Lead):** Docker harness, `npm run check:functions`, Playwright, and any live or `psql` confirmation of the behaviours above. Everything here comes from static reading at `ca3754b`. The persistence behaviour in Q1–Q4 in particular must be **demonstrated** by the T2 harness (proof 5 run against today's `save_interpretation` should go red), not taken from this document.
