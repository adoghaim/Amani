# TASK-048 turn 5: guards that survive replica mode

Scope: the reviewers disagreed about `session_replication_role = replica` on
`eea21e6`. This turn settles it by building and mutating, not by argument. The
accepted foundation is otherwise unchanged.

## What changed

`supabase/migrations/20261012000004_interpretation_version_foundation.sql`

- `ENABLE ALWAYS` on the six guard triggers:
  `zz_guard_interpretation_history`, `guard_interpretation_history_truncate`,
  `guard_versions_mutation`, `guard_versions_truncate`,
  `guard_history_protection_mutation`, `guard_history_protection_truncate`.
- `remember_interpretation_history` is **deliberately left ORIGIN**, against the
  brief's list. Reasoning is below; the Lead may overrule it.
- `COMMENT ON FUNCTION delete_interpretations(uuid[])` states that it erases
  whole reports, including raw lab results. The name and behaviour are unchanged.

Harness (`supabase/migrations/__verification__/`)

- New `interpretation-versions.replica.sql`. As the harness superuser it enters
  replica mode, asserts the mode really is `replica`, and then tries these against
  a protected legacy row and an anchored version: direct overwrite, delete while
  the report exists, `TRUNCATE … CASCADE`, version update, version delete and
  protection delete. Every attempt must fail with `55000`. It runs on the fresh
  chain and on the upgraded database.
- Four new killing mutations. Each one puts a guard group back on plain `ENABLE`,
  which is the state before turn 5:
  `REPLICA-GUARD`, `REPLICA-TRUNCATE` (all three truncate guards, because
  CASCADE reaches every one of them), `REPLICA-VERSIONS` and `REPLICA-PROTECTION`.
  Each mutation must make the probe observe the destructive write **SUCCEED**.
- New `interpretation-versions.authority.sql` plus the optional single-layer
  controls. Details are in their own section below.
- `rollback.sql` clears the new comment, because `CREATE OR REPLACE` keeps
  comments. `run.sh` asserts that it is gone after rollback, and `verify.sql`
  asserts that it is present after forward.

## The empirical question, and what the harness can and cannot answer

Each mutation is the pre-fix catalog for one guard group. If a mutation is
killed with `observed SUCCESS`, the pre-fix guards really could be bypassed by
any role that can set the parameter. If a mutation survives, the hardening is
not load-bearing and Sonnet's position stands. **I could not run Docker, so I have
neither result. The Lead's harness run is the record.**

`H048-REPLICA-SET` also checks, for `anon`, `authenticated` and `service_role`,
that setting the parameter fails with `42501`. **This is vanilla
`postgres:15-alpine`, where `postgres` is a true superuser.** The harness cannot
say whether Supabase's hosted `postgres` role can set `session_replication_role`.
That role is the one used by the SQL editor and by data-fix scripts. Supabase's
restore guidance has historically used this idiom, which suggests it can, but that
is unverified vendor behaviour and I did not look it up. Sonnet's statement that
`service_role` and `authenticated` cannot set it is what `H048-REPLICA-SET`
tests. Fable's concern is the developer or `postgres` path. The ALWAYS hardening
closes that path for any role that can enter replica mode. It does not close it
for a role that can `ALTER TABLE … DISABLE TRIGGER` or drop the trigger: the table
owner or a superuser. That residual exists in every trigger-based design.

## Trade-off accepted for the six guards

`ENABLE ALWAYS` also fires during logical-replication apply. I judge that
acceptable, for these reasons:

- The repository creates no `SUBSCRIPTION` or `PUBLICATION`; I grepped
  `supabase/` for this. Supabase Realtime reads WAL through a slot and does not
  apply changes into a database that carries these triggers. Physical read
  replicas fire no triggers at all. Both are vendor facts I could not verify
  offline.
- If a subscriber with the same schema ever existed, origin-legal traffic would
  still apply. An origin `UPDATE` of a protected row cannot exist, because the
  origin guard rejects it. Report erasure is logged as the `lab_reports` delete
  followed by the cascaded child deletes, so on the subscriber the parent is
  already absent when the child delete arrives, and the guards' erasure branch
  admits it. A rejection would therefore mean the subscriber's protection state
  had diverged from the origin's. Halting is the right response to that: the
  alternative is silently overwriting history on a divergent copy. This is
  reasoning only; no replication was executed.
- Under replica mode, Postgres's own FK cascades (ORIGIN triggers) do not fire.
  `DELETE FROM lab_reports` in replica mode therefore leaves child rows behind
  whatever we do. That is Postgres behaviour, not something this change creates.

## Why `remember_interpretation_history` stays ORIGIN

`remember_interpretation_history` records nothing destructive; it records rows
in the protection table. If it were ALWAYS and both tables were ever logically
replicated, the subscriber would see this sequence: the replicated
`interpretations_private` insert fires the recorder, which inserts the
protection row, and then the replicated protection-row insert arrives and
violates the primary key. Apply would halt on ordinary, legitimate traffic. That
is a new failure, and it would come with no protection gain:

- The six guards are ALWAYS. In replica mode the row guard still protects any
  row that the live classifier calls legacy, or that anchors a version.
- The only thing lost is the durable record for a row **inserted or rewritten
  while in replica mode**. If that row is later accepted by a changed classifier,
  and anchors no version, it is unprotected. That needs a replica-mode data fix
  **and** a later classifier change.
- That residual is executed rather than asserted. `H048-REPLICA-REMEMBER-ORIGIN`
  inserts a legacy row in replica mode and checks that no protection row was
  recorded. `H048-REPLICA-UNRECORDED-OVERWRITE` then checks that its overwrite is
  still refused with `55000`. The probe ends with `H048-REPLICA-ENABLEMENT`, which
  pins the trigger states at six `A` and one `O`. That check runs after the
  behavioural probes so that a reverted trigger is caught by behaviour first.

If the Lead prefers ALWAYS on the recorder as well, it is one line. The
enablement pin and the residual control would then need to flip with it.

## Single-layer authority controls (the optional item)

They fitted without touching the existing oracle. `authority.sql` accepts
either layer's rejection: `22023` from the append check or `23514` from the
table CHECK. It requires that no version is created for an empty body or a
legacy body.

- `AUTHORITY-CHECK-ONLY` (survive): the append check is removed, so the CHECK
  alone refuses (`23514`).
- `AUTHORITY-FUNCTION-ONLY` (survive): the CHECK is dropped, so the append check
  alone refuses (`22023`).
- `AUTHORITY-BOTH` (kill): both are removed, which is the existing
  `V048_M_AUTHORITY`, and the probe observes SUCCESS.

The existing `AUTHORITY` kill against `verify.sql` and its `22023` oracle are
unchanged.

## `delete_interpretations` rename plan (for the functions turn)

This belongs to the turn that also fixes the account-deletion deadlock in
`delete-user-data`. It is not done here, because `supabase/functions/**` is
closed.

1. Add `erase_reports(p_report_ids uuid[])` with today's body: service-only,
   `SECURITY DEFINER`, deletes `lab_reports`, cascades.
2. Point `delete-user-data` at `erase_reports`. Fix the deadlock in the same
   change by erasing all of the user's reports in one call, in a deterministic
   `ORDER BY id` lock order.
3. Deploy the function, then make `delete_interpretations` raise and point the
   caller to `erase_reports`. Do not alias it: a name that promises
   interpretation-only deletion must not keep erasing raw results. Drop it in a
   later migration once no deployed caller references it.
4. Mutation: a caller that "clears an interpretation to regenerate" through the
   old name must fail, and raw results must remain.

## Pre-existing observation (not introduced this turn)

A **data-only** restore into an already-migrated schema fires the recorder when
`interpretations_private` rows load, before the protection table's own data
loads. The protection table's data would then conflict on its primary key. A full
`pg_dump`/`pg_restore` is not affected, because triggers are created post-data.
This was not executed.

## Gates I could not run

Docker harness: `run.sh` and `interpretation-versions.run.sh`. This includes all
four replica mutations, the three authority controls, the fresh chain, the
rollback-comment check, `check:functions` (Deno), browsers. **None of the SQL
added this turn has been executed.** Its syntax and behaviour are unproven until
the Lead runs the harness.
