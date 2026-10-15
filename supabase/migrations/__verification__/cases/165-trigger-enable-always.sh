# shellcheck shell=bash
# A case of the migration harness. run.sh sources every cases/NNN-name.sh in
# lexical order in one shell; see its header. Not a standalone script.
#
# Numbered 165, between 160 and 170: trigger-enable-always.run.sh needs the
# amani database exactly as 160 leaves it (V2 through 20261011000003), before
# 170 applies 20261015110000 there. The later cases use their own databases.

# PK-03e-F (V2-03e-10): every safety trigger is ENABLE ALWAYS, checked with the
# post-deploy query factory/sql/verify-triggers-enable-always.sql, by replica-mode
# behaviour and by killing mutations.
source "$HERE/trigger-enable-always.run.sh"
