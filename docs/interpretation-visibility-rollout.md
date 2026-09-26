# Interpretation visibility rollout (DARK)

TASK-031. No activation, deployment, merge, or production verification is implied
by these source changes. Each milestone below requires a separate owner GO.
Do not run a blanket `supabase db push` across the prepare/cutover boundary.

## Why the boundary changes

A legacy client selects `interpretations.json_output` directly. Storing a deep
Free payload there makes its bodies downloadable regardless of UI state. The
new facade selects one projection at read time. Neither row tier nor AI source
is a Full entitlement. Unknown stored depth requests regeneration on the new
endpoint; it is never inferred from source. Per the owner’s legacy rule, existing
`tier='plus'` rows are backfilled as deep; pre-tiering (`tier IS NULL`) rows
qualify as deep only with a nonempty string `overall_interpretation`. Remaining
rows stay unknown. This classifies availability, never the reader’s access.

SQL intentionally under-reveals relative to TypeScript. Full requires report
ownership, a public users row, and one of: a committed report/draw claim; an
enabled complimentary grant with null/future expiry; a non-deleted Stripe customer
and subscription with active status and future current_period_end; or an active
production IAP row with future expiry. Sandbox (even beta), grace, billing_retry,
Stripe trialing/past_due, missing/expired provider facts and SQL errors do not prove Full. A
separate provable Full source still suffices. The switch is the only intentional
bypass: explicit false reproduces today's full payload for the owning user.
Missing configuration is treated as protected, never OFF. Old binaries therefore
show Basic for Stripe trialing/past_due and IAP in_grace_period/billing_retry unless
another provable Full source exists; the TS-authoritative endpoint can return Full
for these states. Support must expect this intentional SQL under-reveal.

The new endpoint validates the user JWT, verifies report ownership with that JWT,
and runs the existing premium-first TS resolver. It then calls a service-only
projection-selecting RPC with the authenticated user ID and the resolved boolean.
That RPC enforces ownership again and returns only the selected body. No client
can invoke it or pass its own plan. This is necessary for TS-approved sandbox
beta/grace cases that the compatibility view deliberately under-reveals. There
is no endpoint query of private full storage and no raw-storage fallback.

## Milestones and rollback

1. **Owner GO: prepare** — apply only `20260926000000`. Adds Basic projection,
   stored depth, projection version and trusted draw ID to the existing table;
   backfills unknown legacy rows with floor-only content; installs the singleton
   visibility switch OFF, a legacy-writer projection trigger, stable service-only
   save/delete RPCs and commit v2. Client mutation grants are revoked. V1 remains
   callable. Rollback: leave additive schema in place, leave switch OFF; old
   writers remain supported by the trigger. Never restore authenticated writes.
2. **Owner GO: writers** — deploy generate-interpretation and delete-user-data,
   plus the three guard consumers. Deploying before prepare is invalid. Both
   generation write paths save Full and Basic in one transaction; ordinary saves
   use `save_interpretation`, claims use `commit_deep_access_v2`. Deletion uses
   `delete_interpretations`. Rollback before cutover may restore old functions;
   the compatibility trigger keeps their Basic projection fresh.
3. **Owner GO: cutover** — run the migration-boundary rehearsal in a disposable
   database first. Before cutover GO, use a preview project with the migrations and
   real user JWTs, with visibility switched ON, to run live PostgREST `select('*')` and
   `select('id, json_output, tier')` for exhausted Free and each Premium source.
   Assert the seven-column shape, Basic/Full selection, and cross-user denial;
   raw SQL alone is insufficient. Then apply `20260926000001` and `20260926000002`. The rename
   retains table OID, FK cascade, indexes, unique constraint and triggers. All
   private policies are replaced with service-only access. Function bodies for
   v1/save/delete are retargeted transactionally; v2 calls these stable functions.
   Stop on any unexpected rehearsal result. Rollback: keep the facade/private
   table and compatible writers, switch OFF. Do not redeploy an old direct-upsert
   or direct-delete handler after cutover.
4. **Owner GO: read endpoint** — deploy get-interpretation with gateway
   `verify_jwt=true`. No old client calls it. Validate TS sandbox+beta Full versus
   SQL Basic, and structured retryable failures. Rollback: withdraw the endpoint
   while old clients continue using the compatibility view.
5. **Owner GO: activation (separate work)** — wait for 1.0.6 on both testing
   tracks. Switch DB visibility ON, validate old 1.0.5 confidentiality, then set
   `FREEMIUM_ACTIVE=true`, then enable the web/client flag. A flagged-on Free
   request while DB visibility is OFF logs the mismatch and rechecks legacy
   entitlement before doing any ledger/model work. Config read errors yield 503.
   Rollback: unset server/client flags, then switch DB visibility OFF (restores
   the pre-freemium Full-for-owner behavior by explicit owner decision).

Every milestone requires evidence from the Lead; migration files are not evidence
of deployed state. Fable and Opus adversarial reviews remain required and are
outside the implementer's certification scope.

## Public contract inventory

View `public.interpretations` exposes exactly: `id`, `lab_report_id`, `json_output`,
`generated_at`, `disclaimer_version`, `interpretation_source`, `tier`. It is
SELECT-only for authenticated users; wildcard SELECT has no private alias.
`interpretations_private` is service-only. `interpretation_visibility_config`
is service-only. No realtime publication/channel is added.

Service-only RPCs (arguments in order):

- `save_interpretation(uuid user, uuid report, jsonb full, jsonb basic, text depth,
  text source, text tier, text draw DEFAULT NULL) -> void`.
- `commit_deep_access_v2(uuid user, uuid report, text draw, text evidence,
  jsonb full, text source, text tier, boolean consume, jsonb basic) -> text`:
  `committed | already_claimed | limit_reached`. V1's signature and atomic
  contract remain unchanged and callable, with a floor-only projection fallback.
- `delete_interpretations(uuid[] report_ids) -> void`.
- `read_interpretation_for_server(uuid user, uuid report, boolean premium) ->
  table(json_output jsonb, stored_depth text, has_claim boolean, tier text)`.

Authenticated `read_compatible_interpretations() -> table` has the view's exact
columns and enforces auth.uid ownership internally. Its EXECUTE grant is retained
because PostgreSQL checks function calls in a view against the querying role.
The SQL rehearsal revokes EXECUTE, expects view SELECT to fail with insufficient
privilege, restores it, then exercises both old query shapes. Lead must execute
that assertion before cutover; if SELECT works without it, remove the grant. The private
`interpretation_reader_is_full(uuid report, text draw) -> boolean` has no
client EXECUTE grant. Safety/floor and trigger helper functions are not public
client APIs.

New HTTP endpoint: `POST get-interpretation {reportId}` returns
`{access: full|basic|error|generation_needed, interpretation, stored_depth, preview,
locked:{patterns,cross_report,lifestyle}, plan, complimentary}`. Errors also carry
`code` and `retryable`. DB failures are HTTP 503 with
`code: entitlement_unavailable, retryable:true`; absent/foreign report is 404;
onboarding denial is 403. Missing interpretation or insufficient stored depth
is a successful `generation_needed` response, with Basic data when available.
`stored_depth` is deep/standard/unknown for a stored row, null when absent or on
policy errors. Missing floor keys in stored Full are logged and served to the
entitled reader, never converted into a persistent 503. The endpoint uses the
same atomic rate counter as siblings: 30 requests per user per UTC day, HTTP 429
`rate_limit_exceeded` thereafter. Authentication transport exceptions and counter
failures return structured retryable 503 with CORS headers.
Complimentary counts reflect the actual historical ledger for both plans. Reading
this attribution does not consume a claim; Premium generation still bypasses the
ledger entirely.

Activated generation retains success/source and adds access, interpretation,
preview and locked. Inactive success remains exactly `{success:true,source}`;
full stored json_output remains unchanged (new storage metadata is additive).
All four generation/extraction/comparison guard consumers opt into strict DB
read errors through `checkUserSubscription(..., strictReadErrors=true)`; the
fourth optional argument defaults false for existing callers. Lab-insights Free
returns HTTP 402 `{code:premium_required}` only after activation. The removed
FREE_FULL_COMPARISONS constant has no consumers; fullComparison is capped at 0.

Pure contracts: `selectPremiumPreview` takes findings, floorKeys, floorPaths,
floorContentFingerprints, abnormalOrSafetyPaths and ineligiblePaths as in the
memo; returns preview and locked counts. `buildBasicProjection(full, findings?)`
returns an allowlisted payload and validates the floor. `FindingMetadata` adds
optional server-classified `preview_eligible`. Cross-marker previews need at least two distinct linked markers, none abnormal;
trend/lifestyle previews need at least one linked marker, none abnormal. A trend
requires numeric delta or previous/current comparison evidence. Global prior-report
context alone does not reclassify a narrative. Owner vocabulary in `_shared/tier.ts`:
NORMAL = reassuring/normal/in_range/within_range/optimal, BORDERLINE = monitor,
ABNORMAL = attention/discuss. Explicit boolean abnormal/safety flags also count.
The SQL migration copy is guarded by the TypeScript parity test. Ineligible
previews still count as locked candidates; only the selected preview is subtracted.
Unknown legacy provenance yields no preview. Whole primary_concern and
overall_interpretation remain locked; explicit safety flags and follow-ups plus
required floor keys remain visible. Patterns touching abnormal markers become
floor catalog entries, but only their flags, not narrative bodies, enter Basic.
Projection version 2 distinguishes this repair from the earlier unreleased logic;
prepare backfill, legacy trigger, and save RPC all write version 2. The short Basic interpretation reuses the visible floor headline, never
a truncated locked narrative. `readInterpretation(actions)` is the injected authoritative policy port.

## Verification and stop conditions

Run focused Vitest suites for preview-selector, interpretation-visibility,
interpretation-read, entitlement-response, finding-metadata, subscription-guard,
response-shaping, introductory-access, generation-cost and src/lib/tier, then
`npm test -- --no-cache`, lint, typecheck, build and the function ratchet.
The ratchet's existing glob includes the new shared modules and endpoint; the
guard is already included. No additional exclusion is introduced.

The Lead runs `bash supabase/migrations/__verification__/run.sh` with Docker.
Added fixtures exercise writers before and after cutover, relation identity,
FK cascade, preserved trigger/index, grants/RLS, exact old SELECT shapes, switch
OFF/ON, each SQL Full source, expiry/soft deletion, sandbox+beta/grace/retry,
missing-profile rejection, ownership/mutation denial, claim Full, retro-unlock,
legacy floor-only backfill and atomic projection failure. Missing-profile
ownership of an extant report is impossible under the FK, so that assertion
calls the SQL reader directly. These are stop conditions, not a source-only
certification. SQL SELECT shape tests do not substitute for live PostgREST or
physical old-binary checks.

Docker, network, and production calls are prohibited in the implementer sandbox;
no local Deno executable is available. The implementation report records which
local commands ran and keeps
unexecuted SQL, Deno, device, and review evidence pending for the Lead.

## Production privilege checks (Lead, after every migration)

Immediately after each prepare/cutover/comment migration, run this exact query.
It checks effective privileges (including PUBLIC/inherited/default grants), not
only ACL text. Do not proceed to the next owner GO if any unexpected grant appears.
At prepare, `interpretations` is still the legacy table; at cutover it is the view.
The config must deny every listed anon/authenticated privilege. After cutover the
view must allow only authenticated SELECT; anon must have none.

```sql
SELECT c.relname, c.relkind, r.role_name, p.privilege,
       has_table_privilege(r.role_name, c.oid, p.privilege) AS granted
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
CROSS JOIN (VALUES ('anon'), ('authenticated')) AS r(role_name)
CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'),
                   ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) AS p(privilege)
WHERE n.nspname='public'
  AND c.relname IN ('interpretation_visibility_config', 'interpretations', 'interpretations_private')
ORDER BY c.relname, r.role_name, p.privilege;
```

The harness already installs permissive anon/authenticated/service_role default
privileges in run.sh before prepare, making these REVOKE assertions load-bearing.
The repair adds authenticated config SELECT denial, shared prompt-fixture SQL/TS
key-set parity, actual legacy backfill/depth/version checks, and the view EXECUTE
necessity check. These SQL stop conditions remain for the Lead's Docker run.
`generate-interpretation/index.ts` remains in the existing Deno baseline exclusion:
the repair sandbox skips Deno, so it cannot establish a passing ratchet with that
file included. No exclusion is added or broadened.
