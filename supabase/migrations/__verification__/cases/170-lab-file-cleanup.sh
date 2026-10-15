# shellcheck shell=bash
# A case of the migration harness. run.sh sources every cases/NNN-name.sh in
# lexical order in one shell; see its header. Not a standalone script.
#
# Runs after 160: lab-file-cleanup.run.sh builds on the erasure chain.

# PK-FIX-04: report deletion records the stored lab file (20261015110000).
source "$HERE/lab-file-cleanup.run.sh"
