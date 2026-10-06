#!/usr/bin/env bash
# Sourced by run.sh; shares only the existing throwaway container, no remote DB.
# This case also runs independently via CLINICAL_ONLY=1 run.sh.
CLINICAL_TMP="$(mktemp -d)"
# Parse gate before any case (Lead turn 6): compile every DO body in every
# clinical SQL file with plpgsql's validator inside a rolled-back transaction,
# so a syntax error fails here, named by file, instead of mid-case.
docker exec "$CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q -c "CREATE DATABASE clinical_parse;"
(cd "$HERE/../../.." && node tools/clinical/sql-parse-guard.mjs && node tools/clinical/sql-parse-guard.mjs --compile-sql) \
  | docker exec -i "$CONTAINER" psql -U postgres -d clinical_parse -v ON_ERROR_STOP=1 -q
echo 'PASS: every clinical SQL DO body compiles (plpgsql validator) and no IF condition holds a bare CASE'
# Forward must refuse with the named classification and leave no archive behind.
clinical_refused() {
  local db="$1" label="$2" reason="$3" out
  if out=$(docker exec -i "$CONTAINER" psql -U postgres -d "$db" -v ON_ERROR_STOP=1 -q -f /tmp/clinical-forward.sql 2>&1); then
    echo "FAIL: $db accepted $label"; return 1
  fi
  if ! grep -q "$reason" <<<"$out"; then echo "FAIL: $db refused $label for the wrong reason: $out"; return 1; fi
  docker exec -i "$CONTAINER" psql -U postgres -d "$db" -v ON_ERROR_STOP=1 -q -c "DO \$\$ BEGIN
    IF to_regnamespace('clinical_archive') IS NOT NULL OR to_regclass('public.clinical_ranges') IS NOT NULL
      THEN RAISE EXCEPTION 'refused forward left state behind'; END IF; END \$\$;"
}
clinical_expect_mode() {
  local db="$1" mode="$2" actual
  actual=$(docker exec -i "$CONTAINER" psql -U postgres -d "$db" -v ON_ERROR_STOP=1 -tA -c 'SELECT mode FROM clinical_archive.task041_state;')
  if [ "$actual" != "$mode" ]; then echo "FAIL: $db recorded mode '$actual', expected '$mode'"; return 1; fi
}
clinical_case() {
  local db="$1"
  local missing_synonyms="$2"
  docker exec "$CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q -c "CREATE DATABASE $db;"
  clinical_psql() { docker exec -i "$CONTAINER" psql -U postgres -d "$db" -v ON_ERROR_STOP=1 "$@"; }
  for file in clinical-catalog.prelude.sql clinical-catalog.seed.sql clinical-catalog.verify.sql clinical-catalog.rollback.sql clinical-catalog.snapshot.sql clinical-catalog.fingerprint.sql; do
    docker cp "$HERE/$file" "$CONTAINER:/tmp/$file" >/dev/null
  done
  docker cp "$HERE/../20261006000000_clinical_catalog.sql" "$CONTAINER:/tmp/clinical-forward.sql" >/dev/null
  clinical_psql -q -f /tmp/clinical-catalog.prelude.sql -f /tmp/clinical-catalog.seed.sql
  if [ "$missing_synonyms" = yes ]; then
    # The 11 production-only synonyms are all TPO variants, identified exactly
    # by comparison with the accepted turn-1 seed (see reconciliation document).
    clinical_psql -q -c "DELETE FROM public.analyte_synonyms WHERE (synonym_text,source_type) IN (
      ('ANTI THYROID PEROXIDASE ANTIBODY','generic'),('ANTI-THYROID PEROXIDASE','generic'),
      ('ANTIMICROSOMAL AB','generic'),('MICROSOMAL ANTIBODY','generic'),
      ('PEROXIDASE ANTIBODIES, THYROID','quest'),('THYROID PEROXIDASE (TPO) ANTIBODIES','quest'),
      ('THYROID PEROXIDASE AB','quest'),('THYROID PEROXIDASE ANTIBODIES (TPO)','quest'),
      ('THYROPEROXIDASE ANTIBODY','labcorp'),('TPO','quest'),('TPO THYROID PEROXIDASE ANTIBODIES','quest'));"
  fi
  # The exact known FK is allowed; differently named or owned FKs are not.
  clinical_psql -q -c 'ALTER TABLE public.lab_results ADD CONSTRAINT fixture_unexpected_fkey FOREIGN KEY(biomarker_name) REFERENCES public.biomarker_definitions(name);'
  if clinical_psql -q -f /tmp/clinical-forward.sql >/dev/null 2>&1; then
    echo 'FAIL: accepted unexpected legacy FK'; return 1
  fi
  clinical_psql -q -c 'ALTER TABLE public.lab_results DROP CONSTRAINT fixture_unexpected_fkey;'
  clinical_psql -q -c 'CREATE TABLE public.fixture_wrong_owner(name text CONSTRAINT lab_results_biomarker_name_fkey REFERENCES public.biomarker_definitions(name));'
  if clinical_psql -q -f /tmp/clinical-forward.sql >/dev/null 2>&1; then
    echo 'FAIL: accepted known FK name on wrong table'; return 1
  fi
  clinical_psql -q -c 'DROP TABLE public.fixture_wrong_owner;'
  # Unclassifiable shapes (amendment 4): neither production nor chain nor absent.
  # Definitions + phase without reference ranges.
  clinical_psql -q -c 'ALTER TABLE public.biomarker_reference_ranges RENAME TO fixture_reference_saved;'
  clinical_refused "$db" 'definitions and phase without reference ranges' 'unclassifiable legacy state' || return 1
  clinical_psql -q -c 'ALTER TABLE public.fixture_reference_saved RENAME TO biomarker_reference_ranges;'
  # All three names present, but the phase "table" is a view.
  clinical_psql -q -c 'ALTER TABLE public.biomarker_phase_ranges RENAME TO fixture_phase_saved;
    CREATE VIEW public.biomarker_phase_ranges AS SELECT * FROM public.fixture_phase_saved;'
  clinical_refused "$db" 'phase ranges present as a view' 'not an ordinary table' || return 1
  clinical_psql -q -c 'DROP VIEW public.biomarker_phase_ranges;
    ALTER TABLE public.fixture_phase_saved RENAME TO biomarker_phase_ranges;'
  local before after
  before=$(clinical_psql -tA -f /tmp/clinical-catalog.snapshot.sql)
  # Unknown metadata must abort atomically before any archive is created.
  clinical_psql -q -c "BEGIN; UPDATE public.canonical_analytes SET unit='unexpected' WHERE slug='tsh'; COMMIT;"
  if clinical_psql -q -f /tmp/clinical-forward.sql >/dev/null 2>&1; then
    echo 'FAIL: accepted unexpected identity units'; return 1
  fi
  clinical_psql -q -c "DO \$\$ BEGIN IF to_regnamespace('clinical_archive') IS NOT NULL THEN RAISE EXCEPTION 'failed migration left archive'; END IF; END \$\$;
    UPDATE public.canonical_analytes SET unit='uIU/mL' WHERE slug='tsh';"
  # External legacy dependencies must also stop retirement.
  clinical_psql -q -c 'CREATE VIEW public.fixture_legacy_dependent AS SELECT * FROM public.biomarker_definitions;'
  if clinical_psql -q -f /tmp/clinical-forward.sql >/dev/null 2>&1; then
    echo 'FAIL: archived table with unexpected view dependency'; return 1
  fi
  clinical_psql -q -c 'DROP VIEW public.fixture_legacy_dependent;'
  clinical_psql -q -f /tmp/clinical-forward.sql -f /tmp/clinical-catalog.verify.sql >/dev/null
  clinical_psql -q -f /tmp/clinical-forward.sql -f /tmp/clinical-catalog.verify.sql >/dev/null
  clinical_expect_mode "$db" production || return 1
  # Reference for the chain case's direct comparison (amendment 4, harness item 2).
  clinical_psql -tA -f /tmp/clinical-catalog.fingerprint.sql > "$CLINICAL_TMP/$db.fingerprint"
  clinical_psql -q -c 'ALTER TABLE public.lab_results ADD CONSTRAINT fixture_unexpected_fkey FOREIGN KEY(biomarker_name) REFERENCES clinical_archive.biomarker_definitions(name);'
  if clinical_psql -q -f /tmp/clinical-catalog.rollback.sql >/dev/null 2>&1; then
    echo 'FAIL: rollback accepted unexpected archive FK'; return 1
  fi
  clinical_psql -q -c 'ALTER TABLE public.lab_results DROP CONSTRAINT fixture_unexpected_fkey;'
  clinical_psql -q -c 'CREATE VIEW public.fixture_archive_dependent AS SELECT * FROM clinical_archive.biomarker_definitions;'
  if clinical_psql -q -f /tmp/clinical-catalog.rollback.sql >/dev/null 2>&1; then
    echo 'FAIL: rollback accepted unexpected archive view'; return 1
  fi
  clinical_psql -q -c 'DROP VIEW public.fixture_archive_dependent;'
  # A changed range prevents both a replay and rollback from masking drift.
  clinical_psql -q -c "UPDATE public.clinical_ranges SET min=1.9 WHERE slug='magnesium' AND kind='amani_context';"
  for operation in /tmp/clinical-forward.sql /tmp/clinical-catalog.rollback.sql; do
    if clinical_psql -q -f "$operation" >/dev/null 2>&1; then
      echo "FAIL: $operation accepted intervening range write"; return 1
    fi
  done
  clinical_psql -q -c "UPDATE public.clinical_ranges SET min=1.8 WHERE slug='magnesium' AND kind='amani_context';"
  clinical_psql -q -f /tmp/clinical-catalog.rollback.sql
  clinical_psql -q -c "DO \$\$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='lab_results_biomarker_name_fkey'
      AND conrelid='public.lab_results'::regclass AND confrelid='public.biomarker_definitions'::regclass AND convalidated)
      THEN RAISE EXCEPTION 'lab_results FK not restored'; END IF;
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='clinical_archive.clinical_catalog_entries'::regclass
      AND confrelid='public.canonical_analytes'::regclass) THEN RAISE EXCEPTION 'archive constrains live registry'; END IF;
    BEGIN
      UPDATE public.lab_results SET biomarker_name='task041_missing' WHERE biomarker_name='tsh';
      RAISE EXCEPTION 'restored FK accepted invalid reference';
    EXCEPTION WHEN foreign_key_violation THEN NULL; END;
    END \$\$;"
  after=$(clinical_psql -tA -f /tmp/clinical-catalog.snapshot.sql)
  if [ "$before" != "$after" ]; then
    echo "FAIL: $db rollback changed data, IDs, columns, ACLs, policies, indexes or FKs"; return 1
  fi
  clinical_psql -q -c "DO \$\$ BEGIN
    IF to_regclass('public.clinical_ranges') IS NOT NULL OR to_regclass('clinical_archive.clinical_ranges') IS NULL
      THEN RAISE EXCEPTION 'new ranges not archived on rollback'; END IF;
    IF has_schema_privilege('authenticated','clinical_archive','USAGE') THEN RAISE EXCEPTION 'rollback archive exposed'; END IF;
    END \$\$;"
  echo "PASS: $db forward, replay, projections, extraction, privileges, refusal guards and exact rollback"
}
clinical_case clinical_snapshot no
clinical_case clinical_backfill yes

# B2's wholly absent legacy case, deliberately distinct from a full migration-chain replay.
clinical_absent_case() {
  local db=clinical_absent
  docker exec "$CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q -c "CREATE DATABASE $db;"
  clinical_psql() { docker exec -i "$CONTAINER" psql -U postgres -d "$db" -v ON_ERROR_STOP=1 "$@"; }
  # Use only the identity DDL portion of the prelude; no legacy or lab_results table.
  sed '/^CREATE TABLE biomarker_definitions (/,$d' "$HERE/clinical-catalog.prelude.sql" | clinical_psql -q
  clinical_psql -q -c 'CREATE TABLE public.fixture_extraction_link(id uuid REFERENCES public.canonical_analytes(id));'
  clinical_psql -q -f /tmp/clinical-catalog.seed.sql
  # Phase ranges alone (without the other two) is unclassifiable and must refuse.
  clinical_psql -q -c 'CREATE TABLE public.biomarker_phase_ranges(biomarker_name text, phase text);'
  clinical_refused clinical_absent 'phase ranges without definitions or reference ranges' 'unclassifiable legacy state' || return 1
  clinical_psql -q -c 'DROP TABLE public.biomarker_phase_ranges;'
  local before after archival absent
  before=$(clinical_psql -tAc "SELECT jsonb_build_object('registry',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.canonical_analytes t),'synonyms',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.analyte_synonyms t),'metadata',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.biomarker_catalog t));")
  clinical_psql -q -f /tmp/clinical-forward.sql -f /tmp/clinical-catalog.verify.sql >/dev/null
  clinical_psql -q -f /tmp/clinical-forward.sql -f /tmp/clinical-catalog.verify.sql >/dev/null
  clinical_expect_mode clinical_absent absent || return 1
  if [ "$(clinical_psql -tA -f /tmp/clinical-catalog.fingerprint.sql)" != "$(cat "$CLINICAL_TMP/clinical_snapshot.fingerprint")" ]; then
    echo 'FAIL: absent mode built different tables, grants or RLS than production mode'; return 1
  fi
  absent=$(clinical_psql -tAc "SELECT jsonb_build_object('entries',(SELECT jsonb_agg(to_jsonb(t) ORDER BY slug) FROM public.clinical_catalog_entries t),'ranges',(SELECT jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text) FROM public.clinical_ranges t));")
  archival=$(docker exec "$CONTAINER" psql -U postgres -d clinical_snapshot -tAc "SELECT jsonb_build_object('entries',(SELECT jsonb_agg(to_jsonb(t) ORDER BY slug) FROM clinical_archive.clinical_catalog_entries t),'ranges',(SELECT jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text) FROM clinical_archive.clinical_ranges t));")
  if [ "$absent" != "$archival" ]; then echo 'FAIL: absent and archival projections differ'; return 1; fi
  clinical_psql -q -f /tmp/clinical-catalog.rollback.sql
  after=$(clinical_psql -tAc "SELECT jsonb_build_object('registry',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.canonical_analytes t),'synonyms',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.analyte_synonyms t),'metadata',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.biomarker_catalog t));")
  if [ "$before" != "$after" ]; then echo 'FAIL: absent-state rollback changed identity rows'; return 1; fi
  clinical_psql -q -c "DO \$\$ BEGIN
    IF (SELECT status FROM clinical_archive.task041_state)<>'rolled_back'
      OR to_regclass('public.clinical_ranges') IS NOT NULL
      OR to_regclass('public.clinical_catalog_entries') IS NOT NULL
      OR to_regclass('clinical_archive.clinical_ranges') IS NULL
      OR to_regclass('clinical_archive.clinical_catalog_entries') IS NULL
      THEN RAISE EXCEPTION 'absent-state rollback failed'; END IF;
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='clinical_archive.clinical_catalog_entries'::regclass
      AND confrelid='public.canonical_analytes'::regclass) THEN RAISE EXCEPTION 'archive constrains live registry'; END IF;
    END \$\$;"
  echo 'PASS: wholly absent legacy state forward, replay, identical projections and rollback'
}
clinical_absent_case

# Amendment 4 mode `chain`: what a fresh checked-in migration chain produces.
# 20260310054519 creates definitions (44) and reference ranges (23); no migration
# creates the phase table. Build exactly that: the prelude minus the out-of-band
# phase table and minus the fixture-only RLS policies, plus the chain's own index.
clinical_chain_case() {
  local db=clinical_chain
  docker exec "$CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q -c "CREATE DATABASE $db;"
  clinical_psql() { docker exec -i "$CONTAINER" psql -U postgres -d "$db" -v ON_ERROR_STOP=1 "$@"; }
  sed '/^CREATE TABLE public.biomarker_phase_ranges/,/^CREATE POLICY fixture_phase_read/d' "$HERE/clinical-catalog.prelude.sql" | clinical_psql -q
  clinical_psql -q -c 'CREATE INDEX IF NOT EXISTS idx_brr_name ON public.biomarker_reference_ranges(biomarker_name);'
  clinical_psql -q -f /tmp/clinical-catalog.seed.sql
  clinical_psql -q -c "DO \$\$ BEGIN
    IF to_regclass('public.biomarker_phase_ranges') IS NOT NULL
      OR (SELECT count(*) FROM public.biomarker_definitions)<>44
      OR (SELECT count(*) FROM public.biomarker_reference_ranges)<>23
      THEN RAISE EXCEPTION 'chain fixture does not match the checked-in chain shape'; END IF; END \$\$;"
  # A dev database is not evidence: drift that production mode refuses must be
  # accepted here, and rows chain mode seeds must be removed again on rollback.
  clinical_psql -q -c "UPDATE public.canonical_analytes SET unit='dev-drift' WHERE slug='tsh';
    DELETE FROM public.biomarker_catalog WHERE slug=(SELECT min(slug) FROM public.biomarker_catalog);
    DELETE FROM public.biomarker_reference_ranges WHERE biomarker_name='lh' AND phase='general';"
  # Lead turn-6 ruling: chain mode still refuses a seeded synonym whose owner
  # disagrees with the seed (it would silently keep a wrong extraction mapping).
  clinical_psql -q -c "UPDATE public.analyte_synonyms SET canonical_analyte_id=(SELECT id FROM public.canonical_analytes WHERE slug='rdw')
    WHERE synonym_text='HS-CRP' AND source_type='quest';"
  clinical_refused "$db" 'a seeded synonym owned by the wrong analyte' 'conflicting synonym owner' || return 1
  clinical_psql -q -c "UPDATE public.analyte_synonyms SET canonical_analyte_id=(SELECT id FROM public.canonical_analytes WHERE slug='hs_crp')
    WHERE synonym_text='HS-CRP' AND source_type='quest';"
  # Extra synonyms are allowed and survive; missing ones are seeded. Removing the
  # rdw identity (and, by cascade, its 4 synonyms) makes the forward insert one
  # new canonical_analytes row, the only path on which rollback deletes identity.
  clinical_psql -q -c "INSERT INTO public.analyte_synonyms(canonical_analyte_id,synonym_text,source_type)
      SELECT id,'FIXTURE DEV-ONLY SYNONYM','generic' FROM public.canonical_analytes WHERE slug='tsh';
    DELETE FROM public.fixture_extraction_link WHERE id=(SELECT id FROM public.canonical_analytes WHERE slug='rdw');
    DELETE FROM public.canonical_analytes WHERE slug='rdw';"
  local before after before_ids seeded_id applied_ids
  before=$(clinical_psql -tA -f /tmp/clinical-catalog.snapshot.sql)
  before_ids=$(clinical_psql -tAc 'SELECT string_agg(id::text, $$,$$ ORDER BY id) FROM public.canonical_analytes;')
  clinical_psql -q -f /tmp/clinical-forward.sql
  seeded_id=$(clinical_psql -tAc "SELECT id FROM public.canonical_analytes WHERE slug='rdw';")
  applied_ids=$(clinical_psql -tAc "SELECT string_agg(id::text, \$\$,\$\$ ORDER BY id) FROM public.canonical_analytes WHERE id<>'$seeded_id';")
  if [ -z "$seeded_id" ] || [ "$applied_ids" != "$before_ids" ]; then
    echo 'FAIL: chain forward did not add exactly one identity row (rdw)'; return 1
  fi
  # Restore the extraction link to the new identity so verify sees all 81; it is
  # also the first outside FK that must stop rollback deleting that identity.
  clinical_psql -q -c "INSERT INTO public.fixture_extraction_link VALUES('$seeded_id');"
  clinical_psql -q -f /tmp/clinical-forward.sql -f /tmp/clinical-catalog.verify.sql >/dev/null
  clinical_psql -q -f /tmp/clinical-forward.sql -f /tmp/clinical-catalog.verify.sql >/dev/null
  clinical_expect_mode "$db" chain || return 1
  clinical_psql -q -c "DO \$\$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.analyte_synonyms s JOIN public.canonical_analytes a ON a.id=s.canonical_analyte_id
      WHERE a.slug='tsh' AND s.synonym_text='FIXTURE DEV-ONLY SYNONYM') THEN RAISE EXCEPTION 'chain mode dropped an extra synonym'; END IF;
    IF (SELECT count(*) FROM public.analyte_synonyms s JOIN public.canonical_analytes a ON a.id=s.canonical_analyte_id WHERE a.slug='rdw')<>4
      THEN RAISE EXCEPTION 'chain mode did not seed the missing rdw synonyms'; END IF; END \$\$;"
  clinical_psql -q -c "DO \$\$ BEGIN
    IF (SELECT absent_legacy FROM clinical_archive.task041_state)<>ARRAY['biomarker_phase_ranges']
      OR (SELECT archived_rows ? 'biomarker_phase_ranges' FROM clinical_archive.task041_state)
      OR to_regclass('clinical_archive.biomarker_phase_ranges') IS NOT NULL
      THEN RAISE EXCEPTION 'chain mode did not record the absent phase table'; END IF;
    IF (SELECT count(*) FROM public.biomarker_catalog)<>(SELECT jsonb_array_length(payload->'metadata') FROM public.fixture_clinical_seed)
      THEN RAISE EXCEPTION 'chain mode did not seed the catalog by slug'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.canonical_analytes WHERE slug='tsh' AND unit='dev-drift')
      THEN RAISE EXCEPTION 'chain mode overwrote existing identity rows'; END IF; END \$\$;"
  # Direct comparison, not two separate assertions: the new tables' content,
  # columns, constraints, indexes, comments, grants, privileges and RLS policies.
  local chain_print
  chain_print=$(clinical_psql -tA -f /tmp/clinical-catalog.fingerprint.sql)
  for reference in clinical_snapshot clinical_backfill; do
    if [ "$chain_print" != "$(cat "$CLINICAL_TMP/$reference.fingerprint")" ]; then
      echo "FAIL: chain mode built different tables, grants or RLS than production mode ($reference)"; return 1
    fi
  done
  # Dedicated canonical_analytes rollback fixture (Lead turn 6). An outside FK to
  # the seeded identity must refuse rollback, whether it would block the delete
  # (the extraction link) or silently cascade from it (an ON DELETE CASCADE
  # consumer). A refused rollback must leave the applied state untouched.
  clinical_rollback_refused() {
    local label="$1" out
    if out=$(clinical_psql -q -f /tmp/clinical-catalog.rollback.sql 2>&1); then
      echo "FAIL: rollback deleted a seeded identity referenced by $label"; return 1
    fi
    if ! grep -q 'references a canonical_analytes row seeded by the forward' <<<"$out"; then
      echo "FAIL: rollback refused $label for the wrong reason: $out"; return 1
    fi
    clinical_psql -q -c "DO \$\$ BEGIN
      IF (SELECT status FROM clinical_archive.task041_state)<>'applied'
        OR NOT EXISTS (SELECT 1 FROM public.canonical_analytes WHERE id='$seeded_id')
        OR to_regclass('public.clinical_ranges') IS NULL
        THEN RAISE EXCEPTION 'refused rollback changed state'; END IF; END \$\$;"
  }
  clinical_rollback_refused 'the extraction link' || return 1
  clinical_psql -q -c "DELETE FROM public.fixture_extraction_link WHERE id='$seeded_id';
    CREATE TABLE public.fixture_identity_consumer(analyte_id uuid REFERENCES public.canonical_analytes(id) ON DELETE CASCADE);
    INSERT INTO public.fixture_identity_consumer VALUES('$seeded_id');"
  clinical_rollback_refused 'an ON DELETE CASCADE consumer' || return 1
  clinical_psql -q -c 'DROP TABLE public.fixture_identity_consumer;'
  clinical_psql -q -f /tmp/clinical-catalog.rollback.sql
  if [ "$(clinical_psql -tAc "SELECT count(*) FROM public.canonical_analytes WHERE id='$seeded_id' OR slug='rdw';")" != 0 ] ||
    [ "$(clinical_psql -tAc 'SELECT string_agg(id::text, $$,$$ ORDER BY id) FROM public.canonical_analytes;')" != "$before_ids" ]; then
    echo 'FAIL: chain rollback did not delete exactly the seeded rdw identity'; return 1
  fi
  after=$(clinical_psql -tA -f /tmp/clinical-catalog.snapshot.sql)
  if [ "$before" != "$after" ]; then
    echo "FAIL: $db rollback changed data, IDs, columns, ACLs, policies, indexes or FKs"; return 1
  fi
  clinical_psql -q -c "DO \$\$ BEGIN
    IF (SELECT status FROM clinical_archive.task041_state)<>'rolled_back'
      OR to_regclass('public.biomarker_phase_ranges') IS NOT NULL
      OR to_regclass('clinical_archive.biomarker_phase_ranges') IS NOT NULL
      OR to_regclass('public.biomarker_definitions') IS NULL
      OR to_regclass('public.biomarker_reference_ranges') IS NULL
      OR to_regclass('public.clinical_ranges') IS NOT NULL
      THEN RAISE EXCEPTION 'chain rollback did not reverse exactly the forward'; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='lab_results_biomarker_name_fkey'
      AND conrelid='public.lab_results'::regclass AND confrelid='public.biomarker_definitions'::regclass AND convalidated)
      THEN RAISE EXCEPTION 'lab_results FK not restored'; END IF;
    END \$\$;"
  echo 'PASS: chain mode (fresh checked-in chain) forward, replay, production-identical tables/grants/RLS and exact rollback'
}
clinical_chain_case
rm -rf "$CLINICAL_TMP"
