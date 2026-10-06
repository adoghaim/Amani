#!/usr/bin/env bash
# Sourced by run.sh; shares only the existing throwaway container, no remote DB.
# This case also runs independently via CLINICAL_ONLY=1 run.sh.
clinical_case() {
  local db="$1"
  local missing_synonyms="$2"
  docker exec "$CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q -c "CREATE DATABASE $db;"
  clinical_psql() { docker exec -i "$CONTAINER" psql -U postgres -d "$db" -v ON_ERROR_STOP=1 "$@"; }
  for file in clinical-catalog.prelude.sql clinical-catalog.seed.sql clinical-catalog.verify.sql clinical-catalog.rollback.sql clinical-catalog.snapshot.sql; do
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
  # A chain with definitions/reference but no out-of-band phase table is partial.
  clinical_psql -q -c 'ALTER TABLE public.biomarker_phase_ranges RENAME TO fixture_phase_saved;'
  if clinical_psql -q -f /tmp/clinical-forward.sql >/dev/null 2>&1; then
    echo 'FAIL: accepted partial legacy state'; return 1
  fi
  clinical_psql -q -c 'ALTER TABLE public.fixture_phase_saved RENAME TO biomarker_phase_ranges;'
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
  local before after archival absent
  before=$(clinical_psql -tAc "SELECT jsonb_build_object('registry',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.canonical_analytes t),'synonyms',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.analyte_synonyms t),'metadata',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.biomarker_catalog t));")
  clinical_psql -q -f /tmp/clinical-forward.sql -f /tmp/clinical-catalog.verify.sql >/dev/null
  clinical_psql -q -f /tmp/clinical-forward.sql -f /tmp/clinical-catalog.verify.sql >/dev/null
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
