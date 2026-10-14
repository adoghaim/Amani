#!/usr/bin/env bash
#
# Prints the migration-harness case files in run order, one absolute path per
# line: cases/NNN-name.sh in lexical byte order (LC_ALL=C), whatever the
# caller's locale. run.sh sources them in exactly this order.
#
#   list-cases.sh <cases-dir>
#
# Fails, printing nothing on stdout, when the directory is missing or holds no
# case, when any entry is not a regular file named NNN-name.sh (three digits, a
# hyphen, lowercase letters, digits and hyphens), or when two cases share a
# number. A misnamed case must stop the run, never be skipped silently. Dot
# files (an editor's or Finder's) are ignored. Works on bash 3.2.
# Tested by supabase/functions/_shared/verification-harness.test.ts.

set -euo pipefail

dir=${1:?usage: list-cases.sh <cases-dir>}
if [ ! -d "$dir" ]; then
  echo "FAIL: no case directory at $dir" >&2
  exit 1
fi
dir=$(cd "$dir" && pwd)

out=''
seen=' '
while IFS= read -r path; do
  name=${path##*/}
  case "$name" in .*) continue ;; esac
  if [ ! -f "$path" ] || [[ ! "$name" =~ ^[0-9]{3}-[a-z0-9][a-z0-9-]*\.sh$ ]]; then
    echo "FAIL: cases/$name is not a NNN-name.sh file; rename it so the harness runs it" >&2
    exit 1
  fi
  number=${name%%-*}
  case "$seen" in
    *" $number "*)
      echo "FAIL: two cases share the number $number; give each case its own" >&2
      exit 1
      ;;
  esac
  seen="$seen$number "
  out="$out$path"$'\n'
done < <(find "$dir" -mindepth 1 -maxdepth 1 | LC_ALL=C sort)

if [ -z "$out" ]; then
  echo "FAIL: no cases in $dir" >&2
  exit 1
fi
printf '%s' "$out"
