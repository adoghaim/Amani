# shellcheck shell=bash
# A case of the migration harness. run.sh sources every cases/NNN-name.sh in
# lexical order in one shell; see its header. Not a standalone script.
#
# Ported from the block PR #105 (PK-PL-A) appended to the single-file run.sh.
# regeneration-no-write.run.sh needs the full V2 chain that
# interpretation-versions.run.sh (case 160) leaves in the amani database
# (commit_deep_access_version and append_interpretation_version), and psql_f.
# Every mutation it makes runs inside a transaction that is never committed, so
# it leaves the amani database as it found it.

# PK-PL-A: a regeneration that fails writes nothing, so it consumes no attempt
# (lab_reports.regeneration_count) and no credit (introductory claims).
source "$HERE/regeneration-no-write.run.sh"
