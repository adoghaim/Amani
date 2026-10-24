#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
shopt -s nullglob

# Discovery: every function's index.ts, every _shared module, and one level of
# _shared subdirectories (_shared/schemas). One level on purpose: `**` needs
# globstar, which bash 3.2 (macOS /bin/bash) rejects. No freemium exclusion.
files=()
discovered=0
excluded=0
for file in supabase/functions/*/index.ts supabase/functions/_shared/*.ts supabase/functions/_shared/*/*.ts; do
  [[ "$file" == *.test.ts ]] && continue
  discovered=$((discovered + 1))
  # #72 baseline, down to two files (RV-FN1 Part A). Remove an entry once its
  # types are fixed; never add one to hide a new failure. The errors and owners
  # are in docs/edge-function-typecheck.md; scripts/ci/check-functions.test.ts
  # fails on any other exclusion.
  case "$file" in
    supabase/functions/generate-interpretation/index.ts|\
    supabase/functions/create-portal-session/index.ts)
      printf 'Baseline exclusion: %s\n' "$file"
      excluded=$((excluded + 1))
      continue
      ;;
  esac
  files+=("$file")
done

if (( ${#files[@]} == 0 )); then
  printf 'No edge function files selected; refusing an empty check.\n' >&2
  exit 1
fi
printf 'Discovered %s files; checking %s; baseline exclusions %s.\n' \
  "$discovered" "${#files[@]}" "$excluded"

# CI supplies deno; npm supplies npx --yes deno@2.1.4 without adding a dependency.
if (( $# == 0 )); then
  set -- deno
fi
exec "$@" check --node-modules-dir=none --no-lock "${files[@]}"
