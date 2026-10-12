# TASK-047 turn 6: property boundary and independent render proof

Approach: the remaining defect is incomplete proof coverage, not a missing raw-storage adapter. The SQL readers already quarantine the selected body before transmission, and the application has no raw-table reference outside the generated type. Add privilege, transmitted-canary and static-reference assertions at those boundaries, then test the real ReportView with both a quarantined response and an explicitly unquarantined fixture. No production logic, migration behavior, corpus expectations or stored JSON changes.

## Evidence and dimensions

The amended exposure description remains correct: the old Basic path sanitized a stored Basic body rather than calling projectBasic; Full and switch-OFF paths also needed quarantine. Prior characterization and read tests remain unchanged. This turn does not repeat the original exposure measurement or claim live database evidence.

8a now checks SELECT on the private table and EXECUTE on all five quarantine helpers for both anon and authenticated, including effective inherited/PUBLIC privileges. Existing reader ACL assertions remain, with an additional anon service-reader check. Service/admin direct SQL privileges remain outside application rendering under the Lead's explicit proof-8 decision.

8b derives every `paper boats` canary from each legacy corpus row's Full and Basic JSON; no corpus field or expectation was added. A missing canary fails rather than silently making the assertion vacuous. Both the view and compatibility RPC are checked across Basic/paid/claimed owners and switch ON/OFF; the service RPC is checked across those owners and both premium decisions. These checks occur on actual transmitted JSON, before TypeScript or rendering. Existing exact-body comparisons still apply. Deterministic/fallback and current rows retain their existing positive controls.

8c scans every regular file in src and supabase/functions, including literal references in comments and test files. Only the exact generated Supabase type file and directories named migrations, __verification__, and node_modules are excluded. Findings identify relative path and one-based line. The Vitest test runs automatically with npm test. Temporary mutation fixtures prove both scanned roots and the declared generated/harness exclusions. This is a literal-reference guard; it does not claim to detect deliberately obfuscated, dynamically assembled table names.

M10 adds two browser tests to the existing opt-in freemium suite. The server test calls the actual quarantine and checks absence in the body before any browser rendering; the bypass test sends the raw synthetic legacy body verbatim, and verifies the endpoint response still contains it. Both open the real ReportView and check page-wide canary and safety-cue absence. Measured report movement proves readiness; the bypass case additionally requires an admissible model-referenced measured movement to render. The tests do not confuse legitimate lab observations with unauthorized clinical content.

## Named mutations for Lead execution

- M8a-table: before verification, `GRANT SELECT ON public.interpretations_private TO authenticated;` (repeat for anon). Expect `M8a: no customer raw-table or quarantine-helper access`. Restore privileges afterward.
- M8a-helper: grant EXECUTE on each of interpretation_claim_nonempty(jsonb), interpretation_claim_finite(jsonb), interpretation_claim_canonical(jsonb), interpretation_has_current_claims(jsonb), interpretation_read_quarantine(jsonb,jsonb,text) to each customer role independently. Each grant must fail M8a; restore between mutations.
- M8b-view: in read_compatible_interpretations only, remove the outer interpretation_read_quarantine call, retaining its selected CASE expression. Leave TypeScript, corpus and expectations untouched. Expect `FAIL M8b: view` on a legacy row.
- M8b-service: make that same SQL-only wrapper removal in read_interpretation_for_server only. Expect `FAIL M8b: service RPC`. Restore the migration between reader mutations. Neither requires a TS change.
- M8b-existing: the harness already replaces interpretation_read_quarantine with SELECT p_selected. Its expected failure marker now names M8b, which fails before the previous exact-body check. No mutation behavior changed.
- M8c: plant `client.from('interpretations_private')` on line 2 of src/probe.ts and line 3 of supabase/functions/probe/index.ts. The executed temporary-fixture control detects exactly those two locations. In the live tree, the first test must fail with those findings. No live-tree mutation was left behind.
- M10-server: replace quarantineCustomerRead's legacy return with its input. The quarantined-browser-case pre-render body assertion must fail, even if the client still hides everything. Existing server Vitest controls also fail.
- M10-client: bypass authorizeModelProse for ReportView's summary by rendering interpretation.summary_bullets directly in its summary list instead of modelProse.summary/ModelProse. The raw-fixture browser case must expose modelCanaries[1] and fail page-wide absence; the quarantined case has no raw summary to expose. This is a client-only mutation, with server quarantine untouched.

Only M8c's temporary-fixture mutations were executed locally. SQL and browser mutations are named, not claimed executed.

## Handoff gates

Local: focused Vitest 189 passed; npm test 1,681 passed in 76 files; typecheck and build passed; lint completed with zero errors and nine warnings. Clinical generated-artifact checks and all 58 clinical tests passed. SQL static guard, shell syntax and diff whitespace checks passed. Browser code is typechecked, not runtime-proven.

Lead must run the Docker migration harness (including ACLs, corpus canaries, byte identity, new-policy invariance and live SQL/TS parity), both per-reader SQL mutations above, check:functions, and `npx playwright test --config=e2e/freemium/playwright.config.ts`, plus the client/server mutations and other required browser suites. Exact-tree independent and adversarial reviews and CI remain outstanding. No production authorization is implied. The proof-8 interpretation remains explicitly subject to those reviewers. No Second Brain material was written or pending owner policy resolved.
