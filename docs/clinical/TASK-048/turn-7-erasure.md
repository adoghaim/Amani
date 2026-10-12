# TASK-048 turn 7: turn 6 made provable; account-erasure deadlock closed

Base `45267a1`. Nothing in `src/**`, `get-interpretation/**`, readers, frozen
migrations, tiers, pricing, Stripe or CI changed. No copy.

## A. Harness stand-in gap

`__verification__/prelude.sql` now gives the `lab_reports` stand-in
`file_url text` (nullable) and `regeneration_count integer DEFAULT 0 NOT NULL`,
matching `20260216193045_initial_schema.sql:86,94`. The migration and controls
are unchanged.

Audit of every `lab_reports` column that §8 touches:

- `id`, `user_id`: already in the stand-in.
- `content_hash`: added by `20260925000003`.
- `file_url`: read by the evaluator; added this turn.
- `regeneration_count`: written by the `R-REGEN-COUNT` mutation; added this turn.

`rtext('lab_reports')` serializes whole rows, so it needs no particular column.
Every other fixture inserts into `lab_reports` with named columns. The one
positional insert (`clinical-catalog.prelude.sql`) targets its own table in its
own database, so neither addition can break an existing fixture.

`R-CLAIM-CONSUME` stays meaningful. Each corpus `claimed` user holds exactly one
claim (`legacy-quarantine.prelude.sql:18-19`), so the mutation's insert brings
that user to two, under the limit of three. Step 4's `H048R-NO-CLAIM-CHANGE`
fires on the first append, before any retry could reuse the draw id.

## B. Deno row types

`type ServiceClient = ReturnType<typeof createClient>` erased the schema
generics. It is now `ReturnType<typeof serviceClientShape>`, where
`serviceClientShape(url: string, key: string)` makes the same
`createClient(url, key)` call as the handler. It is a type-only helper that is
never called, so the routing tests, which inject `createClient`, are unaffected.
There is no `any` cast on rows.

**This has not been verified under Deno.** The sandbox denied `deno check`.

## C. Parity pin name

The comment in `interpretation-versions.remediation.sql:6` and the test's own
header now name `remediation-draw-parity.test.ts`. The turn-6 document is a
historical record and is left as written.

## D2. Unhashed-file narrowing (verification of the Lead's reading)

**Current code.** The only claim writer is `commit_deep_access`
(`20260925000001:57-59`), reached only through `commit_deep_access_v2` at
`generate-interpretation/index.ts` `commitDeepAccess`. Every insert carries
`report_id = p_report_id`. That path runs only inside
`active && tier === "free"`, after the hash is computed and persisted (the
`UPDATE … IS NULL` just above `deriveBloodDrawIdentity`).

**Not verified.** Claims written between the ledger (`20260903000000`) and the
`content_hash` column (`20260925000003`) predate hash persistence. Git history
was denied to me, so I could not read the writer from that window. Most such
claims still match by `report_id`.

The one case that fails closed is narrow:

- a claim from that window on another report of the same draw, and
- a report that still has no stored hash.

A production count settles it:

```sql
SELECT count(*)
FROM lab_reports r
JOIN introductory_deep_access_claims c
  ON c.user_id = r.user_id AND c.report_id IS DISTINCT FROM r.id
WHERE r.content_hash IS NULL
  AND coalesce(r.file_url, '') <> '';
```

## D1. Floor refusal

This applies the owner's version-success rule; it is not an independent choice.
A version becomes current only after it passes the deterministic safety
architecture. Ordinary generation persists anyway so that a customer is not
denied their own data. Here the customer keeps raw labs and a retry, so nothing
is persisted and the response is 503.

## E. `erase_reports` and the deadlock

### Root cause

`deleteDataTables` ran four calls through `Promise.all`:

- `delete_interpretations`, which deletes `lab_reports` and cascades into
  `biomarkers`, `report_items` and `report_analytes`;
- direct deletes on those same three child tables.

Those are concurrent writers on one graph, taking locks in opposite orders.

### Migration `20261011000001_erase_reports.sql`

- It is one-shot and requires `20261011000000`.
- `erase_reports(uuid[])` is service-only, `SECURITY DEFINER`, with
  `search_path=pg_catalog,public`.
- It locks the rows in deterministic order (`ORDER BY id FOR UPDATE`) and then
  deletes them. The cascade removes children, history, protection, versions and
  pointers. The claim keeps its row with `report_id` set to NULL: erasure is not
  a refund.
- `delete_interpretations` is unchanged and still callable; only its `COMMENT`
  changed. The comment keeps the `ERASES WHOLE REPORTS` prefix that
  `H048-ERASURE-RPC-COMMENT` pins.

### `delete-user-data`

It now awaits `erase_reports` once, for all of the user's report ids, before
anything else. The rest of the function is unchanged.

**Why the per-report child deletes were removed rather than kept as no-ops.**
All three child tables are `ON DELETE CASCADE` from `lab_reports`
(`20260216193045:100`, `20260310071546:39`, `20260312194342:95`). By the time
`erase_reports` has returned, they would match zero rows, so they add no
coverage. Keeping them would only add round trips and a second writer on the
graph whose ordering every future edit must preserve; that was the original
defect. A report inserted after the id list is read is still removed by the
unchanged user-keyed `lab_reports` sweep, through the same cascade.

### Proof

**TypeScript** (`_shared/delete-user-data.erasure.test.ts`, 6 tests): it
executes the real `deleteDataTables` from source against a recording fake whose
RPC settles on a later macrotask. It pins:

- `erase_reports` is the first write and settles before any other query starts;
- the only deletes are the unchanged user-keyed sweep;
- there are no `delete_interpretations` references and no `Promise.all(` calls;
- a user with no reports makes no erasure call;
- a failed erasure stops deletion.

A negative control runs the old shape and shows the recorder seeing three child
deletes start before the RPC settles.

**SQL** (`interpretation-versions.erase-reports.sql`, `interpretation-versions.run.sh` §9):

- Out-of-order refusal, in a database with no foundation and in one with the
  foundation but no wrapper.
- Fresh chain; no write; one-shot replay; coexistence. Only
  `function:erase_reports(uuid[])` changes, plus `delete_interpretations`'
  comment.
- Whole-graph erasure for a two-report user in both flag states, with
  raw-result stand-ins in production FK shape.
- No refund, no orphans, other users byte-identical, and a retry is a no-op.
- The old name still erases the graph.
- Both RPCs: service only, `42501` for `anon`/`authenticated`.
- Rollback restores the catalog and the comment exactly; re-forward is exact.

Mutations: `E-PARTIAL`, `E-REFUND`, `E-LOCK-ORDER`, `E-GRANT-AUTHENTICATED`,
`E-GRANT-ANON` and `E-OLD-NAME-GRANT`.

**What the SQL harness cannot show.** A deadlock needs two connections, and this
harness runs on a single connection. The lock order is therefore pinned
statically (`H048E-LOCK-ORDER`), and the caller's ordering is proven in the
TypeScript test. No deadlock reproduction is claimed.

### Debt

Once `delete-user-data` is deployed against `erase_reports`, a later migration
makes `delete_interpretations` raise and point callers to `erase_reports`. It is
dropped once no deployed caller remains. `erase-reports-rollback.sql` is a
pre-use rehearsal only: after that deploy it would break account deletion.

## Gates not run by me

| Gate | Status |
| --- | --- |
| Docker harness: `run.sh`, §8 and §9 | **None of the new SQL has been executed.** |
| `deno check` of `generate-interpretation/index.ts` (target: the baseline's 3 errors) | Not run (denied). |
| `deno check` of `delete-user-data/index.ts` (target: the baseline's 1 error) | Not run (denied). |
| Browsers | Not run. |
