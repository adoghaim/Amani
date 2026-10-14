# shellcheck shell=bash
# A case of the migration harness. run.sh sources every cases/NNN-name.sh in
# lexical order in one shell; see its header. Not a standalone script.
#
# Moved verbatim from run.sh. legacy-quarantine.run.sh needs the databases
# and /tmp files that 070 to 130 leave behind.

# TASK-047: read-time legacy authority; all SQL and parity gates are mandatory.
source "$HERE/legacy-quarantine.run.sh"
