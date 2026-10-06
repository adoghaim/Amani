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
  # A changed range prevents both a replay and rollback from masking drift.
  clinical_psql -q -c "UPDATE public.clinical_ranges SET min=1.9 WHERE slug='magnesium' AND kind='amani_context';"
  for operation in /tmp/clinical-forward.sql /tmp/clinical-catalog.rollback.sql; do
    if clinical_psql -q -f "$operation" >/dev/null 2>&1; then
      echo "FAIL: $operation accepted intervening range write"; return 1
    fi
  done
  clinical_psql -q -c "UPDATE public.clinical_ranges SET min=1.8 WHERE slug='magnesium' AND kind='amani_context';"
  clinical_psql -q -f /tmp/clinical-catalog.rollback.sql
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
