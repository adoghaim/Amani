# shellcheck shell=bash
# A case of the migration harness. run.sh sources every cases/NNN-name.sh in
# lexical order in one shell; see its header. Not a standalone script.
#
# Ported from the block PR #121 (PK-PL-C) appended to the single-file run.sh,
# where it was sourced last. factory-prepared.run.sh clones the fully migrated
# amani database (CREATE DATABASE pkplc_prepared TEMPLATE amani), so it runs
# after every migration case, and it drops the clone when done; it leaves amani
# unchanged. It needs psql_f, $HERE and $CONTAINER.

# PK-PL-C: rehearse the PREPARED-NOT-APPLIED production SQL (factory/sql/post-deploy
# and factory/sql/rollback) on a disposable clone of the fully migrated database.
source "$HERE/factory-prepared.run.sh"
