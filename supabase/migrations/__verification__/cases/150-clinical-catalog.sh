# shellcheck shell=bash
# A case of the migration harness. run.sh sources every cases/NNN-name.sh in
# lexical order in one shell; see its header. Not a standalone script.
#
# Moved verbatim from run.sh. clinical-catalog.run.sh builds its own
# databases; CLINICAL_ONLY=1 run.sh runs it alone.

# TASK-041: isolated reference catalog, no user-data fixture.
source "$HERE/clinical-catalog.run.sh"
