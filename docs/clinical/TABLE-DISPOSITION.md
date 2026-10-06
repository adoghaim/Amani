# Table disposition — turn 5 (amendment 4)

Lead amendments 1–4 authorize local authoring and rehearsal only. No production
application or real archive retirement is authorized by this implementation.

## What runs where: the mode taxonomy

The forward migration classifies the database **before reading or writing
anything**, records the mode in `clinical_archive.task041_state.mode`, and
records which legacy tables were missing in `absent_legacy`. Replay and rollback
read that record, so rollback reverses exactly what the forward did.

| Mode | Legacy tables present | Where it is expected | What the forward asserts | What it archives |
|---|---|---|---|---|
| `production` | definitions, reference ranges, phase ranges — all three | Production. **The only mode permitted to run against production.** | Row counts 44/23/22; the 15-row phase conflict inventory; the magnesium and eGFR definitions conflicts; exact snapshot equality of `canonical_analytes` and `biomarker_catalog` against the supplied seed; every synonym known and correctly owned; no unexpected FK or view on the legacy tables. | All three. |
| `chain` | definitions and reference ranges; phase ranges **absent** | A clean developer database built from the checked-in migration chain (`20260310054519` creates two tables; no migration creates the phase table). | Only that the two present tables are ordinary tables with no unexpected FK or view dependency. **Nothing about their contents**: no row counts, no conflict inventories, no identity/catalog snapshot equality, no synonym check. | The two that exist. `absent_legacy = {biomarker_phase_ranges}`; rollback never tries to restore it. |
| `absent` | none | Retained from turn 3 (the wholly absent case). | Exact identity/catalog snapshot equality and synonym check, as in `production`. | Nothing. |
| *(refuse)* | anything else | — | — | — |

Refused, with the failing classification named in the error message: the phase
table without the other two; definitions plus phase without reference ranges;
any one or two tables in any other combination; any legacy name present as a
view, foreign table, partitioned table or other non-ordinary relation; an
existing `clinical_archive` schema without applied state; or already-present
`clinical_catalog_entries` / `clinical_ranges`. A refusal aborts the transaction,
so no `clinical_archive` is left behind (the harness asserts this).

**The new tables are mode-independent.** `clinical_catalog_entries`,
`clinical_ranges`, their constraints, comments, grants, RLS and policies are
built by the same statements from the same payload in every mode. The harness
asserts this by comparing a fingerprint of the applied tables in the `chain` and
`absent` databases directly against the two `production` databases.

## Per table

| Table | Disposition |
|---|---|
| `canonical_analytes` | Keep the 81 supplied identities, UUIDs, timestamps, extraction references and read contract. In mode `production` (and `absent`) the upsert is **precondition-only, never seeding**: the exact metadata snapshot must already exist, so the `ON CONFLICT DO NOTHING` insert is a no-op. Only in mode `chain` can it insert missing slugs; rollback deletes exactly those rows by ID and refuses if anything outside the tracked tables references them. |
| `analyte_synonyms` | Keep existing tuples and IDs; insert only missing known tuples from the 224-row inventory. In `production`/`absent` unknown or misowned tuples refuse; `chain` asserts nothing about them. Rollback deletes only tuples inserted by the forward. |
| `biomarker_catalog` | Keep the 76 supplied metadata rows, UUIDs, timestamps and hook SELECT shape. In mode `production` the upsert is **precondition-only, never seeding**. Only mode `chain` can seed missing slugs; rollback deletes them. Seed `all` projects to existing `both`. |
| `biomarker_definitions` | `production` and `chain`: move its rows and original table identity to `clinical_archive`; restore on rollback. Row count asserted (44) only in `production`. |
| `biomarker_reference_ranges` | `production` and `chain`: move its rows with its FK to definitions intact; restore on rollback. Row count asserted (23) only in `production`. |
| `biomarker_phase_ranges` | `production` only: move its 22 rows; restore on rollback. Created out of band; no checked-in migration defines it, which is exactly why mode `chain` exists. |
| `lab_results` | Remains in `public`. Permit exactly `lab_results_biomarker_name_fkey` owned by `public.lab_results` and targeting the definitions table. Never drop or recreate this FK: its target follows the table OID into `clinical_archive`, then back to `public` on rollback. Same in `production` and `chain`. |
| `clinical_catalog_entries` | New 83-entry slug-keyed catalog preserving shipping keys/units. Identical in every mode. Archive on rollback after dropping its outgoing `registry_slug` FK to the live registry. |
| `clinical_ranges` | New 198-band projection with kind, provenance, population, phase, units and candidate discriminator. Identical in every mode. Archive on rollback with its internal catalog FKs intact. |
| `clinical_archive.task041_state` | Private hash, status, **mode**, **absent_legacy**, and before/after/archived snapshots. Retained on rollback. |

The Lead verified production `lab_results` has zero rows and PostgreSQL is 17.6,
and verified the 44/23/22 production row counts and the chain's 44/23/absent
shape (amendment 4). Those are supplied
facts, not production observations by this implementer. The harness includes
three synthetic lab results, the exact 20260310054519 FK/RLS definitions, and
the 20260402000000 tracing columns. The forward and rollback guards reject every
other external FK or view on whichever legacy tables are present. No constraint
is weakened to permit archival.

Archive schema access is revoked from application roles; original table OIDs,
ACLs and RLS policies survive both moves. New public tables grant read-only
access to authenticated/service roles and enable RLS. Rollback refuses changed
rows, unexpected dependencies and name collisions; it deletes only rows the
forward inserted. No table is dropped by forward or rollback.

## V2-02 handoff

In mode `production`, identity/catalog tables are **not** catalog-driven seed
destinations despite the upsert syntax: the upserts are precondition-only, never
seeding. Do not assume production `canonical_analytes` or `biomarker_catalog`
follow `clinical/catalog/catalog.json`; future changes to them require an
explicit migration and new preconditions. Preserve range-only rheumatoid
factor/ANA identities, the five explicit differential unit factors, and refused
blank-unit ratio joins. No clinical source, value, applicability conclusion or
conflict winner changes.

`src/types/supabase.generated.ts` will be **stale after any authorized apply**
(the legacy tables leave `public`, two new tables arrive) and must be
regenerated then. It is intentionally unchanged now: regenerating it would imply
the move has happened. No archive retirement in any real environment without
separate owner GO.
