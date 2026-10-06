# Table disposition — turn 3

Lead amendments 1–3 authorize local authoring and rehearsal only. No production
application or real archive retirement is authorized by this implementation.

| Table | Disposition |
|---|---|
| `canonical_analytes` | Keep the 81 supplied identities, UUIDs, timestamps, extraction references and read contract. The catalog upsert is **precondition-only, never seeding**: the exact metadata snapshot must already exist. |
| `analyte_synonyms` | Keep existing tuples and IDs; insert only missing known tuples from the 224-row inventory. Unknown/misowned tuples refuse. |
| `biomarker_catalog` | Keep the 76 supplied metadata rows, UUIDs, timestamps and hook SELECT shape. The upsert is **precondition-only, never seeding**. Seed `all` projects to existing `both`. |
| `biomarker_definitions` | Move its 44 rows and original table identity to `clinical_archive`; restore on rollback. |
| `biomarker_reference_ranges` | Move its 23 rows with its FK to definitions intact; restore on rollback. |
| `biomarker_phase_ranges` | Move its 22 rows; restore on rollback. This table was created out of band and has no historical checked-in migration. |
| `lab_results` | Remains in `public`. Permit exactly `lab_results_biomarker_name_fkey` owned by `public.lab_results` and targeting the definitions table. Never drop or recreate this FK: its target follows the table OID into `clinical_archive`, then back to `public` on rollback. |
| `clinical_catalog_entries` | New 83-entry slug-keyed catalog preserving shipping keys/units. Archive on rollback after dropping its outgoing `registry_slug` FK to the live registry. |
| `clinical_ranges` | New 198-band projection with kind, provenance, population, phase, units and candidate discriminator. Archive on rollback with its internal catalog FKs intact. |
| `clinical_archive.task041_state` | Private hash/status and before/after snapshots; empty `archived_rows` explicitly records the wholly absent legacy case. Retained on rollback. |

The Lead verified production `lab_results` has zero rows and PostgreSQL is 17.6.
Those are supplied facts, not production observations by this implementer.
The harness deliberately includes three synthetic lab results, the exact
20260310054519 FK/RLS definitions, and the 20260402000000 tracing columns.
The forward and rollback guards still reject every other external FK or view
on the legacy tables. No constraint is weakened to permit archival.

Archive schema access is revoked from application roles; original table OIDs,
ACLs and RLS policies survive both moves. New public tables grant read-only
access to authenticated/service roles and enable RLS. Rollback refuses changed
rows, unexpected dependencies and name collisions; it deletes only synonyms
inserted by the forward operation. No table is dropped by forward or rollback.
The snapshot includes inbound constraints whose owning relation is outside the
tracked tables, so an archived table cannot invisibly constrain a live registry.

## Wholly absent legacy state and fresh-chain limitation

Amendment 3 B2 permits a second path only when all three legacy tables and the
archive are absent. It still requires the exact identity/catalog preconditions,
creates the same new projections, records state and skips archival. Replay and
rollback support both paths. One or two legacy tables present still refuse.
The hard-coded 44/23/22 counts and all 15 conflict preconditions remain unchanged
for the archival path; dormant-table edits require re-inventorying.

**The all-absent case is not a proof of a fresh migration-chain reset.**
`20260310054519_full_44_biomarker_panel_schema_v3.sql` creates definitions and reference
ranges, while no historical migration creates phase ranges. A fresh chain thus
reaches a partial legacy state and must still refuse under B2's explicit rule.
The Lead needs to reconcile the fresh-chain acceptance requirement with that
rule; this implementation does not silently authorize partial-state archival.

## V2-02 handoff

Identity/catalog tables are not catalog-driven seed destinations despite the
no-op upsert syntax. Future changes to them require an explicit migration and
new preconditions. Preserve range-only rheumatoid factor/ANA identities, the
five explicit differential unit factors, and refused blank-unit ratio joins.
No clinical source, value, applicability conclusion or conflict winner changes.

Queue `src/types/supabase.generated.ts`
for schema regeneration **after a separately authorized apply**. It is intentionally
unchanged now: generating moved-table types would imply a migration has happened.
No archive retirement in any real environment without separate owner GO.
