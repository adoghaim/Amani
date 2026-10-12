# TASK-048 — Turn 2: historical payment evidence and persistence design

Base: `029182da420f0298d6d078bbdd8173b6ee31158c`. Investigation and proposed design only; no schema or runtime changes. The existing upserts replace the historical body, metadata and generation time. The approach is to separate immutable storage, current-version selection and remediation eligibility, and to return the missing historical-payment evidence contract for owner decision before implementing a migration. **The destructive regeneration defect remains open.**

## 1. Historical payment cannot reliably be established from the retained model

This is a conclusion about the checked-in schema and writers, not an assertion about records in a production database or records recoverable from a provider. No provider or production data was accessed.

| Evidence | What is retained | Why it cannot establish the required historical join |
|---|---|---|
| `20260217130956_wispy_sky.sql:36-84`; `stripe-webhook/index.ts:246-305` | Customer-to-user association; one subscription snapshot per customer, status, price, current period, payment-card descriptors | The webhook fetches only the latest subscription (`limit: 1`) and upserts on `customer_id`. Renewals replace period/status/subscription fields. There is no historical paid interval or subscription invoice ledger here. A price/card/status does not establish settled payment for a past interval. |
| `20260217130956_wispy_sky.sql:110-124`; `stripe-webhook/index.ts:176-230` | Orders have amounts, payment status, checkout/payment-intent IDs | The writer takes this branch only for a paid **one-time** checkout; subscription checkouts call subscription sync instead. Orders have neither a report binding nor a subscription coverage interval. Their existence does not prove this report's subscription entitlement. |
| `20260430000000_add_stripe_idempotency.sql:22-26`; `20260811000000_stripe_event_claim_lease.sql` | Event ID/type, delivery lease/completion timestamps | No invoice body, amount, user/subscription linkage or covered service interval. Completion means handler completion, not proof of payment. The lease migration explicitly treats pre-lease records as attempts rather than successful completion. |
| `20260821000000_add_iap_subscriptions.sql:24-70`; `_shared/iap-verification.ts:487-499,534-549` | One normalized row per store subscription; status, expiry, environment and raw provider payload | `persistIapSubscription` replaces status, expiry and **raw** on update. Raw may contain useful evidence for an individual event, but is not retained event history or a required normalized proof of paid service at the report instant. `created_at` is ingestion time, not an established paid-period start. |
| `20260907000000_iap_event_ordering.sql:40-47`; `20260913000000_iap_event_claim_lease.sql` | Latest event high-water mark and delivery lease ledger | Ordered delivery prevents stale snapshots winning; it does not preserve previous snapshots, purchase amounts or past paid intervals. |
| `20260914000000_complimentary_entitlements.sql:40-54`; `20260821000000_add_iap_subscriptions.sql:59-60`; `20260216193045_initial_schema.sql:72-73` | Explicit complimentary rows, IAP sandbox/production, profile trial fields; Stripe has a `trialing` enum | These distinguish some current access categories. They do not establish a complete past payment timeline. Absence of a complimentary/trial record is not evidence of payment. The Stripe snapshot does not retain discount/settled-invoice history; IAP raw is overwritten. |
| `20260903000000_introductory_deep_access_claims.sql:56-80` | Durable user + blood-draw claim, optional report link, claim timestamp | This is independently usable under H1 route 1. Its legitimacy does **not** depend on billing proof or a currently active subscription. |

The report-side timestamp is also limited: `save_interpretation` overwrites `generated_at` (`20260926000000_prepare_interpretation_visibility.sql:162-175`), as does `commit_deep_access` (`20260925000001_commit_deep_access_rpc.sql:64-73`). It is the stored output's generation time, not an immutable history of every generation. Do not substitute upload time or client-editable `report_date` to repair missing historical evidence.

**Decision already supplied by H1:** unknown payment attribution fails closed. Neither Premium now, `tier`, depth, legacy prose, a version row, a processed webhook nor a non-trial-looking snapshot establishes a durable historical remediation right. A currently entitled subscriber's ordinary rights remain separate.

**Data-policy question for owner/Lead:** what authoritative provider evidence and report-generation attribution may be reconciled into a durable report-specific paid proof, and who approves that reconciliation? Required decisions include treatment of zero-cost promotional periods and later refunds/revocations. This turn neither classifies those cases nor creates a paid-proof table with invented semantics. If records cannot establish the report's generation instant and genuinely paid coverage, the answer stays unknown. No bulk AI generation is involved in evidence reconciliation, and none is authorized here.

## 2. Proposed persistence contract (independent of payment)

The approved side-table direction is implementable in principle. The following is a design, not executed SQL or a passed gate.

- Keep `interpretations_private` as the historical source. Do not rewrite, relabel, strip, stamp, reserialize or copy new metadata into it. Freeze protected source rows at the database boundary, regardless of owner, tier, claim, switch or generating caller.
- Add a service-only `interpretation_versions` relation with a new UUID identity, `lab_report_id`, `historical_interpretation_id`, optional `parent_version_id`, server generation/commit timestamps, full and Basic bodies, source, depth, projection/disclaimer versions, and new-version policy/provenance. Use composite foreign keys/unique keys to enforce that historical source, parent version and report belong together; separate valid UUID foreign keys alone allow cross-report grafting.
- Append successful outputs only. No pending, failed or deterministic-fallback interpretation row. Attempts, if operationally recorded later, must be outside this relation and confer no rights. H4 failure must leave versions, historical data, claims and ordinary allowance unchanged.
- Add a service-only current-selection relation keyed by report, referencing a version **of that report**. The pointer changes atomically with an authorized append, never before it. Historical and regenerated identities/timestamps stay separate. Do not select `MAX(generated_at)` or use array ordering as implicit authority.
- Use a unique request identity scoped to the report and a locked report/current-selection transaction to make retries idempotent. An expected-current-version comparison rejects concurrent stale commits; a loser must not overwrite a winner. This is concurrency control, not a new lifetime remediation quota.
- Revoke table access from PUBLIC, anon and authenticated, enable RLS with no customer policies, and explicitly grant only the service operations needed. Do not grant service UPDATE/DELETE/TRUNCATE on versions. Use a narrowly granted append RPC with fixed search path and default PUBLIC EXECUTE revoked. Validate ownership, parent binding, full/Basic policy relationships and eligibility again at commit. Service ownership of a request must come from verified auth, never from a body-supplied user ID.
- A version's existence is storage evidence only. No trigger inserts introductory claims, changes tier, grants access, increments `regeneration_count` or touches billing.

### Database protection against the live destructive path

The guard must run on the underlying private table, including direct service writes and SECURITY DEFINER upserts; patching only `save_interpretation` misses other/future writers. Classify from **OLD**, using the same source/current-claims semantics as quarantine: AI/unrecognized or null source without current claims is protected; deterministic/fallback handling must match the existing classifier. Freeze all protected row columns, including IDs, source and provenance, so a two-step relabel-then-overwrite fails.

Protection must persist across future classifier changes: establish a separate service-private protection identity for existing legacy sources without modifying them, and protect newly inserted legacy rows as well. Record protection in the same transaction as insertion. Do not recompute away an existing protection merely because a future policy predicate changes. Database enforcement must reject UPDATE, deletion/reinsertion used as replacement, and TRUNCATE; revoke broad service privileges and ensure the guard also covers existing definer writers. Database owners/superusers that can disable triggers remain an administrative trust boundary, not a customer-write capability.

There is a concrete deletion integration constraint: reports are deleted directly in `ReportView.tsx:1243` and `Reports.tsx:234`; the original interpretation FK uses `ON DELETE CASCADE` (`20260216193045_initial_schema.sql:112`). Account deletion explicitly invokes `delete_interpretations` before deleting reports (`delete-user-data/index.ts:143-180`). An unconditional DELETE-blocking trigger breaks those flows; an unrestricted delete RPC lets a generation writer delete and reinsert.

Proposed resolution is to preserve existing user erasure semantics through a narrowly authorized deletion operation that deletes the report and its complete version/history graph atomically, while disallowing interpretation-only replacement. This needs a concrete privilege/call-site design and proof before DDL; do not implement a caller-settable `skip_immutability` flag or rely only on trigger depth. Functions/client paths are closed this turn, so any necessary deletion wiring requires a later scoped change. This is not a proposal to retain data after user erasure or a claim that erasure is forbidden by H3.

## 3. Current-selection and read contract

The latest readers are `20261009000000_legacy_read_quarantine.sql:136-170`; the edge applies another authority boundary in `_shared/interpretation-read.ts`. Preserve their ownership checks and the quarantine sequence.

1. Bind the authenticated user to the report before selecting any source/version. A foreign user's report returns no data or eligibility evidence.
2. Resolve the explicit current selection and take **all** body/source/depth/provenance/identity/time fields from that one version. A missing, foreign, corrupt or no-longer-authorized selection cannot supply clinical prose.
3. Reapply current claim-authority, language and safety architecture, then the appropriate entitlement projection. `interpretation_has_current_claims` is a necessary structural authority check, **not proof that model generation and clinical-language validation ran**. A service-created marker cannot replace V2-03b/03c processing. New output must pass that pipeline even with the entitlement switch OFF.
4. Derive Full/Basic access independently. Introductory claim coverage follows today's owned report-or-trusted-blood-draw matching. A historical-paid route cannot be added until its evidence contract exists. Do not set `has_claim=true` to represent payment: use a distinct server-owned entitlement result once that route is implemented.
5. With no usable selected version, continue to quarantine the historical body through the existing reader. Raw lab results remain independent. Failure must not select raw historical prose as a fallback.
6. Return explicit historical-source identity and selected-version identity/generation time in a new typed server response; never present the new version under the old interpretation ID/time. The compatibility view must likewise emit a coherent selected identity/body, and its callers require regression coverage. Do not union history into the customer view.

For a foundations-only migration, leave both existing readers unchanged and grant **no** customer visibility into the new store. Assert their complete outputs remain identical. Reader cutover is a later coordinated server/client change, after policy and entitlement proofs, with no temporary raw-version endpoint.

## 4. Separate remediation evaluator

Proposed input is authenticated user plus report ID. The server loads ownership, protected legacy source and trusted claim linkage; it does not accept depth, payment or blood-draw proof from the client.

| Condition | Remediation result |
|---|---|
| Missing/foreign report or no legacy source | Not available; no information about another user's entitlement |
| Existing claim for that user and report, or same trusted blood draw under the existing claim contract | Eligible by existing claim, including lapsed/no subscription |
| Independently proven historical paid coverage under a future approved evidence contract | Eligible by paid proof; this branch has no safe implementation with today's retained model |
| No claim and payment attribution unknown, including deep/plus/current-Premium/trial/complimentary/promotional-looking rows | No durable remediation right inferred; ordinary current entitlement evaluated separately |

Check eligibility both before generation and at commit. Fail closed on lookup errors. Never call the introductory claim acquisition path, `commit_deep_access_v2`, Stripe, or the ordinary regeneration counter. Existing legitimate same-draw claim reuse is not a new grant; an untrusted client-supplied same-draw value must not qualify.

Only an explicit user request starts generation. A committed authorized replacement is served as a replacement. A failed generation persists no version and keeps retry available under unchanged eligibility. The exact approved initial and failure copy remains reserved for `src/lib/freemium/copy.ts` in a later turn; no copy is added or changed here.

## 5. Migration gate: STOP, return design

No migration or Docker harness is authored this turn. The historical-paid evidence contract is unresolved, and the deletion/immutability integration must be concretely settled rather than hidden by a trigger exception. Billing uncertainty alone does not prevent an independently scoped claim-only storage foundation; however, such a foundation must not be reported as completing the paid/claimed requirement. Return these design dependencies to the Lead/owner before selecting that reduced scope or writing DDL. No production behavior is changed by this document.

Required migration/proof sequence once settled:

1. In separate disposable databases, run the real fresh chain and upgrade from the pre-migration head with synthetic existing rows. A stubbed schema run is useful but does not prove fresh-chain application. Snapshot every existing historical row and existing reader output first.
2. Apply the migration transactionally. Reapply according to an explicit replay contract (either supported no-op with structural assertions or a deliberate atomic rejection). Do not claim replay merely because `IF NOT EXISTS` hid a wrong schema.
3. Compare full rows and `convert_to(json_output::text,'UTF8')` / Basic bytes before and after; compare nullable fields without coercion. JSONB has already discarded original input whitespace/key order, so this proves byte identity of the **stored representation**, not recovery of the original model wire bytes. Never claim `jsonb = jsonb` alone is byte proof.
4. Exercise actual roles and actual RPCs, both readers, both switches, concurrent commits, failed generation/commit and deletion workflows. Assert persisted switch state is different in the two cases. Execute killing mutations below in isolated transactions/databases.
5. Rollback rehearsal: before any app cutover or version writes, remove only new schema/ACL objects and restore changed definitions from captured baseline; verify historical fingerprints/read parity. After version writes, operational rollback disables new serving/generation but **retains** versions and protection; do not drop customer replacement data or restore destructive writers. Exact rollback SQL must accompany the eventual migration and be independently run.

## 6. Required killing mutations (planned, not executed)

| Invariant | Canary / mutation that must fail |
|---|---|
| Universal history protection | Disable the DB protection guard, then call real `save_interpretation`, `commit_deep_access`, v2 wrapper and direct service UPDATE with a unique replacement string on paid, free, null-source legacy rows, switch ON and OFF. Each protected write must raise and bytes remain unchanged. |
| No laundering or replacement escape | First relabel source/current claims or change IDs, then overwrite; try service DELETE + INSERT, TRUNCATE, existing deletion RPC misuse. Remove the relevant guard/ACL to make the refusal assertion fail. Separately prove authorized report/account deletion still works. |
| Append-only versions | Grant UPDATE/DELETE/TRUNCATE or remove mutation guard; attempt to change a committed version and require denial. |
| Parent/report isolation | Remove composite relationship enforcement; insert a version or pointer joining user A's report to user B's source/version; require rejection. |
| No new customer visibility | Grant raw table SELECT or a permissive RPC; test anon and two authenticated users, direct tables, view and RPC, with a distinctive raw canary. None may retrieve the new store before cutover. |
| No entitlement widening | Replace claim/proven-paid predicate with `tier`, depth, active snapshot, pointer existence or always-true. Free/trial/complimentary/unknown-payment fixtures must remain ineligible. |
| Durable claim without subscription | Add a current-subscription prerequisite; claimed lapsed/no-subscription fixtures must lose their expected success and turn the test red. |
| No consumption | Route commit through claim acquisition or increment ordinary count; exact ledger/counter snapshots must change and fail. |
| Current authority only | Omit authority/language/safety processing, accept a malformed claim set, or accept deterministic fallback as success; require no committed version. SQL structural checks and pure server pipeline spies are separate proofs. |
| Failure is atomic | Inject failure after append but before pointer update; allow partial commit; require no new version/pointer or entitlement/counter mutation. Model-null, timeout and policy rejection must never invoke append. |
| Identity/read coherence | Mix historical ID/time/source with version body; response/view assertions must fail. Remove read quarantine; historical canary must become detectable and fail. |
| Concurrency/idempotence | Remove request uniqueness or expected-current check; race two requests and duplicate delivery; require one coherent committed selection, no duplicate for the same request and unchanged history. |
| No automatic generation | Add version inserts to migration or invoke generation from read/auto effects; zero-version post-migration assertion and user-action spies must fail. |
| Real switch directions | Make switch setter a no-op; assert database state before each ON/OFF read. Legacy stays quarantined both ways; current-authorized + OFF retains authorized Full behavior. |
| Forward/fresh/replay/rollback | Deliberately drop a prerequisite, alter an existing row during DDL, or make rollback destructive; chain execution, fingerprint and schema comparisons must fail. |

These are proposed executable test obligations, not a claim that mutation testing or SQL proof has run.

## 7. Handoff and evidence limits

The task's no-network restriction supersedes the Supabase skill's online documentation checks and the Brain load procedure's pull step. Local Brain context was read without syncing and not treated as current operational evidence. No Brain, control-directory, source or frozen-migration files were changed. No production state or launcher separation was verified.

Second Brain handoff only: confirmed from this checkout on 2026-10-09 that Stripe/IAP writers replace subscription snapshots and existing interpretation writers replace generation time/content; source evidence is above. Owner decisions are the inlined H1–H4 rulings, not new decisions here. Pending: provider reconciliation policy, concrete erasure-safe immutability implementation, migration proof and all runtime remediation behavior. No vault update was made.

Testing results are in the implementer report. Existing tests exercise the current implementation, not the proposed schema. Docker/SQL forward, fresh-chain, replay, rollback, byte-identity and mutation proofs were not run; neither were Deno, browser, build, lint, typecheck or independent review. No new tests are represented as release evidence.
