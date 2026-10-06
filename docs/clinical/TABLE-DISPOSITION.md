# Table disposition — turn 2 authoring approved

Amendments 1 A1–A6 and 2 A7–A11 resolve the questions in the original proposal
below. Authorization covers local authoring/rehearsal only, not production.

Implementation refinements required by those rulings:

- `clinical_catalog_entries` supplies 83 slug-keyed catalog identities and the
  explicit legacy key/unit mapping. `clinical_ranges` references this table,
  including a composite FK tying endpoints to their shipping units. The optional
  `registry_slug` references `canonical_analytes.slug` only for evidenced unit
  mappings. This keeps `rheumatoid_factor` and `ana_screen` range-only without
  inventing extraction identities. Three blank-unit ratios also refuse the
  registry-unit join; their existing registry rows remain available to extraction.
- All 81 supplied canonical identities, 224 synonym tuples and 76 metadata rows
  are preserved. Existing UUIDs/timestamps are not generated from snapshots.
  Exact identity/catalog preconditions make those upserts no-ops; only missing
  known synonyms can be inserted. Unknown/conflicting live tuples abort.
- The seed uses `all`; projection to the existing catalog translates it to `both`.
  Defaults and sex applicability are explicitly unreviewed metadata.
- The archive schema blocks application schema access while retaining original
  table ACLs and OIDs. Thus rollback restores legacy table access exactly without
  reconstructing grants. FK dependencies within the retired set remain intact;
  external foreign keys and dependent views cause refusal before retirement.
- An archive state row captures complete before/after reference rows. Replay
  and rollback refuse intervening row writes; rollback also refuses new synonym
  FK consumers or new catalog FK/view consumers. Only inserted synonyms are
  removed. New tables are archived on rollback; no table is dropped. A replay
  after rollback is deliberately refused and needs an explicit new migration.
- Disputed alternatives use an explicit candidate discriminator in addition to
  slug/population/phase/kind. They persist but never enter the legacy client.

The historical proposal follows for context; its pending questions are answered
by the Lead amendments above, not by an implementer decision.

---

# Proposed table disposition — Lead approval required

Contract §4 explicitly says “implementer proposes, Lead approves before
migration.” This is the concrete proposal for that approval. No migration has
been authored or applied yet.

1. Keep `canonical_analytes` and `analyte_synonyms` as extraction tables. Preserve
   UUIDs, foreign keys, existing synonyms, source types and public read contracts.
   Upsert identities by slug and synonyms by their existing unique key after
   verifying that an existing synonym does not belong to a different slug.
   Abort on unrecognized rows or identity conflicts; never delete them to force
   counts to match. Carry source registry metadata explicitly in the JSON seed.
2. Create one `clinical_ranges` table keyed by `(slug, population, phase, kind)`
   with nullable phase made unique through a normalized key. Include all required
   provenance columns with NOT NULL on grade/status/version and checks on enums,
   paired endpoints, source requirements, and positive versions. A null source
   and date mean genuinely unknown, not the transcription date. Use slug as FK
   to canonical identity, with no name-based joins.
3. Retire all three legacy clinical tables by moving them to a dedicated archive
   schema, keeping their data and dependencies intact for rollback, and revoking
   application access. Do not drop tables and do not leave active duplicate
   clinical sources in public. Abort if unexpected dependencies prevent safe
   retirement. Preserve the old candidate values in the archive as well as the
   conflict inventory. Do not seed either candidate over the shipping dictionary.
4. Keep `biomarker_catalog` as a table to preserve UUIDs and the existing hook's
   shape. Seed its metadata by slug, with an explicit translation from seed
   `all` to its existing `both` discriminator if needed. Snapshot rows before
   updating; no deletion of unmatched entries. Its current 76-row production
   snapshot is needed to preserve metadata not present in the checked-in seed.
5. Generate the forward SQL from the same validated seed and compare its bytes
   in `clinical:check`. Include a catalog version/hash. Make the migration atomic
   and fail on unexpected prior state. Record rollback snapshots of changed
   identity/catalog rows and inserted IDs in the archive schema, with application
   grants revoked. Rollback restores exact old rows/UUIDs and table locations;
   it must refuse to erase intervening writes or newly referenced inserted IDs.
   Archive the new range table on rollback instead of dropping it.
6. Rehearse forward application, repeated application, metadata and synonym
   lookup preservation, SQL/client numeric equality, privileges and rollback in
   an isolated Docker database through the existing run.sh harness. Compare
   pre/post-rollback snapshots. No production command belongs in the harness.

## Decisions needed before SQL generation

- The base dictionary actually exports **83** entries, while the contract says
  79. Preserve all 83 (current implementation), or supply an amended scope.
  Removing four would violate value identity.
- Five shipping keys end in `_absolute`, while canonical registry slugs end in
  `_abs`. Proposed resolution: retain registry `_abs` and add an explicit
  `legacy_key` compatibility mapping to the seed/client generator. No mapping
  has been silently applied. It changes the fixed seed schema and needs approval.
- The two additional dictionary analytes `rheumatoid_factor` and `ana_screen`
  have no identity in the checked-in registry seed. Preserve their shipping
  ranges; supply or approve identity metadata without guessing clinical facts.
- Local registry migrations contain 81 identities and **213** synonym tuples.
  The Lead reports 224 production synonyms. Supply a sanitized snapshot of those
  identities/synonyms and the 76 catalog metadata rows to establish the missing
  metadata and eleven additional synonyms. Historical SQL is not a live snapshot.
- Confirm retirement by archive-schema move for the three old range tables and
  keeping `biomarker_catalog` as a seeded table.

The seed currently retains unresolved identities under `identity_only` and the
original registry row under `registry_identity`. `extraction_synonyms` preserves
source type and exact text separately from the legacy client `aliases`, because
merging them into the legacy alias map would change the public API's behavior.
