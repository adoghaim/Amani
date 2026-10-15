# shellcheck shell=bash
# A case of the migration harness. run.sh sources every cases/NNN-name.sh in
# lexical order in one shell; see its header. Not a standalone script.
#
# Numbered 990 so it stays last: it rehearses on a clone of the FULLY migrated
# database, so every migration case has to have run before it.

# PK-PL-C: rehearse the PREPARED-NOT-APPLIED production SQL (factory/sql/post-deploy
# and factory/sql/rollback) on a disposable clone of the fully migrated database.
source "$HERE/factory-prepared.run.sh"
