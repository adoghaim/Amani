# TASK-047 turn 4: restore the fresh harness configuration seed

Approach: inspection identifies missing seed data in the schema-only fresh database, not a claim-authority defect or a leaked authenticated role. Restore the configuration singleton only in that disposable database, assert switch updates and observed state before reads, and explicitly check both current and legacy OFF results. Runtime confirmation belongs to the Lead; no migration or corpus expectations are changed.

## Root-cause evidence and correction

`legacy-quarantine.run.sh` creates `quarantine_fresh`, pipes `pg_dump --schema-only` into it, then applies the quarantine migration and synthetic report fixtures. Neither the migration nor those fixtures inserts the configuration singleton. Its original INSERT is in `20260926000000_prepare_interpretation_visibility.sql` (the prepare migration), and schema-only copying omits its data. `psql_qfresh` explicitly connects with `-U postgres`; the first verification switch update precedes any authenticated role transition. The failure therefore occurs with an absent configuration row, before the later seeded `amani` branch is reached. The Lead's RLS hypothesis is not supported by this harness path. Runtime role/row counts cannot be measured here because Docker execution is prohibited.

The fresh setup now logs session_user/current_user and pre-seed count, requires `postgres` and zero rows, and inserts exactly `(true,false)`. Verification logs the actual role, UPDATE row count, requested state and observed state on both loop iterations. It aborts unless exactly one row changed and the observed state matches. These diagnostics let the Lead confirm or falsify the code-derived cause rather than infer it from a later output mismatch.

Both `legacy-quarantine.capture.sql` and `claim-policy-gate.capture.sql` had the same latent unchecked-update weakness. They run against the seeded `amani` database, with no SET ROLE in their blocks; the fresh failure does not establish either capture actually failed. Both now require the original singleton via INTO STRICT, check every update and observed value, and check restoration before commit. The parity export also now rejects a missing singleton instead of silently continuing.

## OFF controls and named mutations

- `OFF-current`: with the switch observed OFF, both authenticated view and direct compatibility RPC must return the exact fixture Full body for `current-authorized`, across Basic, paid and claimed owners. Mutation: in `read_compatible_interpretations`, replace `(SELECT enabled FROM public.interpretation_visibility_config WHERE singleton) IS FALSE` with `false`. The Basic current row must fail `FAIL OFF-current`, even though the switch setup succeeds.
- `OFF-legacy`: with the switch observed OFF, every legacy corpus case on those same surfaces/owner modes must equal its neutral Full oracle. Mutation: add `(SELECT enabled FROM public.interpretation_visibility_config WHERE singleton) IS FALSE OR` immediately before `p_source IN ('deterministic','fallback')` in `interpretation_read_quarantine`'s CASE predicate. ON remains unchanged; OFF legacy reads must fail `FAIL OFF-legacy`.
- Switch setup negative control: remove only the fresh harness singleton INSERT. Verification must fail `FAIL switch setup` with rows=0 before comparing customer bodies. For either capture script, an absent singleton must instead fail INTO STRICT before any captures are persisted. Mutation to test observed-state checks: replace `SET enabled=sw` with `SET enabled=true`; the OFF iteration must fail despite ROW_COUNT=1.

These new mutations are precisely named, not executed locally. Existing SQL-only mutations remain wired unchanged. Existing expectations, the 48-case corpus, migration, storage-byte controls, parity semantics and lifecycle remain intact. No historical JSON or policy/entitlement behavior was edited.

## Execution and outstanding gates

Focused five-file Vitest suite: 306 passed. Full Vitest: 1,679 passed across 75 files. Shell syntax and whitespace checks passed. Ordinary Vitest is not live PostgreSQL parity or proof that the OFF database branch executed.

Not run in this offline sandbox: Docker/PostgreSQL harness, actual role/count diagnostics, OFF database assertions, SQL mutations, migration lifecycle/storage-byte checks, live SQL/TypeScript parity, check:functions, browser suites, CI, independent review or adversarial review. Typecheck/lint/build/clinical checks were not repeated for this SQL/shell/documentation-only change; prior-turn results are not claimed as this tree's execution. Overall TASK-047 remains PARTIAL pending Lead runtime/review gates and the previously deferred raw/admin structural boundary. Paid-legacy remedy remains held for the owner. Governing inlined context and previous task reports were used; no Second Brain material was read remotely or written, and no pending policy decision was resolved.
