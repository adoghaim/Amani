# shellcheck shell=bash
# A case of the migration harness. run.sh sources every cases/NNN-name.sh in
# lexical order in one shell; see its header. Not a standalone script.

# PK-PL-A: a regeneration that fails writes nothing, so it consumes no attempt
# (lab_reports.regeneration_count) and no credit (introductory claims).
source "$HERE/regeneration-no-write.run.sh"
