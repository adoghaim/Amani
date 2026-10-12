# shellcheck shell=bash
# A case of the migration harness. run.sh sources every cases/NNN-name.sh in
# lexical order in one shell; see its header. Not a standalone script.
#
# Moved verbatim from run.sh. interpretation-versions.run.sh runs after the
# TASK-047 and TASK-041 cases (140, 150), as its own header requires.

# TASK-048: non-destructive persistence foundation, the ordinary version writer
# (§8, turn 10), erasure and (§10) the reader cutover to the selected version.
source "$HERE/interpretation-versions.run.sh"
