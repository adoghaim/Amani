# TASK-042 — turn 4 implementation observations

Approach: The accepted implementation left the audit report stale, silently projected current dispositions back to UNKNOWN, and excluded candidates from the client but not frozen SQL. Its fallback audit checked only exclusion of phased values. This corrective turn makes the frozen status boundary explicit and tested, excludes candidates from SQL, checks fallback disagreement in both directions, and closes specimen-basis consistency without changing clinical values. This is implementation evidence, not independent review or clinical approval.

## Starting evidence and corrections to the previous report

Turn 4 began clean at `cf192522a6f5ac738137b0543ed1675590d7fed9`, on
`v2/02-clinical-audit`; original integration base is `4305728`.
The Lead committed the preceding work. Per the Lead's turn-4 ruling, the accepted
clinical suites were **37/37 local and 36/36 CI**, and the Lead ran the Docker
harness. Those are attributed prior-run results, not executions by this implementer
this turn. The earlier report's 34/3 and 33/3 results were obsolete.

Three test updates were authorized and committed before this turn: the blanket
UNKNOWN assertion in `audit.test.mjs` and the one in `catalog.test.mjs` became
exact disposition inventories; the shipping-DISPUTED rejection case became an
invalid-status rejection. Shipping disputes are now permitted by the amendment,
so the old assertions contradicted the required behavior. The previous statement
that existing tests were not edited was false. Only this turn's corrections remain
uncommitted; this implementer has made no commit.

## Boundaries

No external clinical source was retrieved or invented. No clinical value changed.
No evidence grade or value origin was promoted, no reviewer assigned, and no range
assigned SAFE or reviewed_evidence. Dormant magnesium remains historical drift
evidence only, never a candidate. No unmatched identity was equated.
No production access, merge, push, deployment, vault write or control-directory
write occurred. Docker, hosted CI, device QA and production verification have not
been run by this implementer. Turn-4 command results are recorded below separately from the attributed prior runs.


## Turn-4 implementation and observed evidence

- Inventory remains **83 analytes / 198 shipping ranges**, with **35 DISPUTED,
  eight NEEDS_CONTEXT and 155 UNKNOWN**. No status changed this turn. The queue
  is now **58 P0 / 102 P1 / 38 P2 / zero P3**. All eight reproductive-hormone
  fallbacks are P0; the three newly flagged rows retain UNKNOWN and explicit
  questions, preserving the Lead's exact 43-row divergence boundary.
- `FROZEN_V2_01_REVIEW_STATUS` explicitly names the frozen projection policy.
  The new test asserts the exact 43 differing range IDs, UNKNOWN in SQL, and
  equality of every other retained range field. Audit-only fields remain omitted;
  specimen remains the V2-01 null projection. This is a range-field parity test,
  not a claim that all analyte audit metadata is persisted.
- **V2-03 prerequisite: a new authorized migration must carry current review
  status into the database. `20261012000000` is frozen. Until that new migration
  ships, the database is not a source of audit truth and nothing may read audit
  status from it.** CF-10 repeats this gate and asks for the migration and consumer
  integration tests. Candidate persistence likewise needs a new design/migration.
- SQL now excludes candidate rows. A synthetic in-memory candidate with distinct
  endpoints passes validation and inventory checks; both generate and check read
  the real checked-in artifacts, perform zero writes, and match every frozen SQL
  byte and the full shipping queue. No candidate was added to the actual seed.
- The fallback comparison computes the actual interval union, preserving gaps,
  and compares against each individual phase as well. Five fallbacks exclude
  phased values. Progesterone context also fills gaps in the union; progesterone
  reference and LH reference equal their unions but remain wider than individual
  phase bands. An envelope-only check cannot detect that masking. All eight
  have a potential false-reassurance direction against a specific phase;
  the five narrower fallbacks also have a potential false-alarm direction.
  Each row states direction and consequence. Ordering puts false reassurance
  ahead of false-alarm-only concerns within P0, with vitamin D first.
- The check uses every strict numeric difference. No clinical materiality cutoff
  was invented. Luteal progesterone 2 falls below both catalog luteal minima yet
  passes both fallbacks: an internal inconsistency example, not independently
  established clinical normality. No replacement band is proposed.
- Each of the 30 conflict range rows now says whether its own endpoints differ
  or its dispute is family-level. The supplied inventory contains six same-kind
  agreements across six analyte/phase pairs; all six explicitly say the other
  kind differs. Both kinds remain DISPUTED as directed. CF-03 gives the same
  distinction per row, without resolving any conflict.
- Specimen UNKNOWN and an UNKNOWN-prefixed basis now imply each other. Tests
  reject both inconsistent directions with range/analyte bases held equal.
- The stale test title was corrected. Ruling C required one additional narrow
  update to the old convergence test: its requirement that a candidate appear
  in SQL now asserts identical SQL payloads with/without that candidate, while
  checking the candidate remains in the seed. It was not skipped or removed.
- The backlog handoff now explicitly attributes item 10's committed transfer
  to the Lead's turn-4 confirmation; this implementer did not verify that commit.

## Commands observed this turn

| Exact command | Observed result |
|---|---|
| `node --test tools/clinical/audit-amendment.test.mjs` | 13 passed, zero failed |
| `npm run clinical:generate` | Passed; 83 entries / 198 queue rows; frozen outputs unchanged |
| `npm run clinical:test` | Final: 42 passed, zero failed, zero skipped |
| `npm run clinical:test:ci` | Final: 41 passed, zero failed, zero skipped |
| `npm test` | 1,212 passed across 52 files |
| `npm run clinical:check` | Passed; client, frozen SQL and audit queue match |
| `node tools/clinical/sql-parse-guard.mjs` | Passed; static guard only |
| `npm run typecheck` | Passed, including application importers and clinical checkJs |
| `npm run lint` | Passed; zero errors, nine existing React Hook warnings |
| `npm run build` | Passed; existing Browserslist data warning; no update attempted |
| `npm run clinical:lint && npm run clinical:typecheck` | Passed after the convergence-test update |
| `git diff --exit-code 4305728 -- src supabase` | Passed; both trees byte-identical to integration base |
| `git diff --check` | Passed |

An additional read-only Python comparison against `git show
4305728:clinical/catalog/catalog.json` asserted all 198 original range fields
except the previously authorized review_status changes remain identical, along
with slugs, canonical units and conversions. No value or citation field changed.

Initial turn-4 runs: clinical local 41 passed / one failed and CI 40 passed / one
failed, both from the superseded candidate-in-SQL assertion described above.
The first clinical typecheck found a string/number inference issue in a new test
loop; explicit object fields fixed it. Final results above follow those fixes.
No Docker harness, database execution, hosted CI, device/runtime QA, production
verification or Edge Function check was run this turn. The Lead's prior Docker
run is attributed above; a run against this uncommitted turn remains the Lead's
responsibility. No independent review or clinical certification is claimed.

## Evidence versus inference; report-only Second Brain handoff

Local observations: counts, interval arithmetic, exact field comparisons, frozen
artifact identity and command results above. Specimen/population/modifier
hypotheses, priority and potential clinical consequences remain offline triage
judgments. Source requests remain unanswered. Production exposure, prior Docker
execution and the backlog transfer are attributed Lead statements, not locally
verified facts. No external clinical source was retrieved and no clinical value
changed.

The local vault snapshot is dated 2026-09-22 and was read without syncing under
the offline boundary; it cannot establish current release/production state.
Proposed handoff: record these local implementation observations with their
commands, keep clinical validity and V2-03 persistence pending, and obtain Lead
Docker execution plus independent review before proceeding to human evidence
collection. No vault material, project decision or Pending item was changed.
D-001 release isolation and separate production GO remain binding.
