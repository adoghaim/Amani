#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
shopt -s nullglob

files=()
discovered=0
excluded=0
for file in supabase/functions/*/index.ts supabase/functions/_shared/*.ts; do
  [[ "$file" == *.test.ts ]] && continue
  discovered=$((discovered + 1))
  # #72 baseline at 0afaafa: 26 errors in these nine files. Remove entries
  # as their types are fixed; do not broaden the list to hide new failures.
  # Counts and limitations are documented in docs/edge-function-typecheck.md.
  case "$file" in
    supabase/functions/extract-biomarkers/index.ts|\
    supabase/functions/parse-lab-report-ocr/index.ts|\
    supabase/functions/generate-interpretation/index.ts|\
    supabase/functions/create-portal-session/index.ts|\
    supabase/functions/lab-insights/index.ts|\
    supabase/functions/_shared/subscription-guard.ts|\
    supabase/functions/stripe-checkout/index.ts|\
    supabase/functions/delete-user-data/index.ts|\
    supabase/functions/_shared/rate-limit-store.ts)
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

# CI supplies deno; npm supplies npx --yes deno@2 without adding a dependency.
if (( $# == 0 )); then
  set -- deno
fi
exec "$@" check --node-modules-dir=none --no-lock "${files[@]}"
