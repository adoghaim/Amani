# shellcheck shell=bash
# A case of the migration harness. run.sh sources every cases/NNN-name.sh in
# lexical order in one shell; see its header. Not a standalone script.
#
# Numbered 185, after 170 and 180: its prelude changes the amani users stub and
# applies 20261013000000, so it runs after the cases that check amani is as V2
# left it (lab-file-cleanup.run.sh re-runs the H048 no-consumption check). 170
# adds zz_record_lab_file_cleanup to amani; the query classifies it
# (safety-after-v2). The cases from 190 on use their own databases.

# PK-03e-F (V2-03e-10): every safety trigger is ENABLE ALWAYS, checked with the
# post-deploy query factory/sql/verify-triggers-enable-always.sql, by replica-mode
# behaviour and by killing mutations.
source "$HERE/trigger-enable-always.run.sh"
