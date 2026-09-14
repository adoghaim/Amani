# Edge function type checking

From the repository root, run `npm run check:functions`. Its exact local command
is `bash docs/check-functions.sh npx --yes deno@2`. Node/npm fetch and run Deno 2
without requiring a global installation or adding a project dependency. The first
run requires network access to download Deno and remote module types.

For a standalone local installation, use `npm install --global deno@2`, then run
`bash docs/check-functions.sh deno`. CI installs Deno using
`denoland/setup-deno@v2` with `deno-version: v2.x` and runs that same command.
The script invokes `deno check --node-modules-dir=none --no-lock "${files[@]}"` in CI
and `npx --yes deno@2 check --node-modules-dir=none --no-lock "${files[@]}"` locally.
The flags resolve npm specifiers through Deno's global cache without modifying
the npm-managed node_modules directory or creating/updating a Deno lockfile.
Downloads populate external npm/Deno caches; no import map or runtime
configuration change is required.

The script discovers `supabase/functions/*/index.ts` and
`supabase/functions/_shared/*.ts`, excludes `*.test.ts` (owned by Vitest), and
rejects an empty selection. New matching files are checked automatically.
Diagnostics print directly and Deno's exit status fails CI on type errors.
Existing frontend and migration jobs are unchanged.

## Temporary baseline exclusions (#72)

The lead's full check at `0afaafa` on 2026-09-14 found 26 errors across nine
files using `--node-modules-dir=auto`. QA must recheck the selected files with
`--node-modules-dir=none --no-lock`; the previous passing result does not prove
this resolution mode passes. The ratchet selects 18 of the 27 discovered files, including all IAP
and Stripe webhook code. These are entry-point exclusions, not diagnostic
suppressions: Deno still checks transitive imports. A checked file importing a
baseline failure will fail the check. Excluded files are not protected against
additional errors until removed from the list.

| Excluded file | Baseline errors |
| --- | ---: |
| `supabase/functions/extract-biomarkers/index.ts` | 7 |
| `supabase/functions/parse-lab-report-ocr/index.ts` | 6 |
| `supabase/functions/generate-interpretation/index.ts` | 3 |
| `supabase/functions/create-portal-session/index.ts` | 3 |
| `supabase/functions/lab-insights/index.ts` | 2 |
| `supabase/functions/_shared/subscription-guard.ts` | 2 |
| `supabase/functions/stripe-checkout/index.ts` | 1 |
| `supabase/functions/delete-user-data/index.ts` | 1 |
| `supabase/functions/_shared/rate-limit-store.ts` | 1 |

Fix the types in a separately scoped change, then remove the corresponding
case entry in `docs/check-functions.sh`. Do not add exclusions for new errors.
To inspect the full baseline using Bash from the repository root:

```bash
files=()
for file in supabase/functions/*/index.ts supabase/functions/_shared/*.ts; do
  [[ "$file" == *.test.ts ]] || files+=("$file")
done
npx --yes deno@2 check --node-modules-dir=none --no-lock "${files[@]}"
```
