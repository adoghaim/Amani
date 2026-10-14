# shellcheck shell=bash
# A case of the migration harness. run.sh sources every cases/NNN-name.sh in
# lexical order in one shell; see its header. Not a standalone script.
#
# Ported from the block PR #125 (PK-03e-F) appended to the single-file run.sh.
# trigger-enable-always.run.sh needs the full V2 chain that
# interpretation-versions.run.sh (case 160) leaves in the amani database, so it
# runs after it, last.

# PK-03e-F (V2-03e-10): every safety trigger is ENABLE ALWAYS, checked with the
# post-deploy query factory/sql/verify-triggers-enable-always.sql, by replica-mode
# behaviour and by killing mutations. Runs last: it needs the full V2 chain.
source "$HERE/trigger-enable-always.run.sh"
