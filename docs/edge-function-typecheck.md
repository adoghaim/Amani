# Edge function type checking

From the repository root, run `npm run check:functions`. Its exact local command
is `bash docs/check-functions.sh npx --yes deno@2.1.4`. Node/npm fetch and run Deno
without requiring a global installation or adding a project dependency. The first
run requires network access to download Deno and remote module types.

Deno 2.1.4 is the Deno of the Supabase edge runtime that serves the functions
(`supabase/edge-runtime` v1.77.8, `deno/Cargo.toml`; every release since v1.70.0,
and the image Supabase CLI v2.122.0 runs), so the check sees the APIs and
TypeScript production has. When the runtime moves, change this pin, the
`deno-version` in `.github/workflows/ci.yml` and `integration-preview.yml`, and
`check:functions` together; `scripts/ci/workflow-hardening.test.ts` fails while
they differ.

For a standalone local installation, use `npm install --global deno@2.1.4`, then run
`bash docs/check-functions.sh deno`. CI installs Deno using the commit-pinned
`denoland/setup-deno` with `deno-version: 2.1.4` and runs that same command.
The script invokes `deno check --node-modules-dir=none --no-lock "${files[@]}"` in CI
and `npx --yes deno@2.1.4 check --node-modules-dir=none --no-lock "${files[@]}"` locally.
The flags resolve npm specifiers through Deno's global cache without modifying
the npm-managed node_modules directory or creating/updating a Deno lockfile.
Downloads populate external npm/Deno caches; no import map or runtime
configuration change is required.

The script discovers `supabase/functions/*/index.ts`,
`supabase/functions/_shared/*.ts` and one level of shared subdirectories,
`supabase/functions/_shared/*/*.ts` (today `_shared/schemas`), excludes
`*.test.ts` (owned by Vitest), and rejects an empty selection. It does not use
`**`, which needs `shopt -s globstar` and fails on bash 3.2 (macOS `/bin/bash`).
New matching files are checked automatically.
Diagnostics print directly and Deno's exit status fails CI on type errors.
Existing frontend and migration jobs are unchanged.

## Temporary baseline exclusions (#72)

The #72 baseline began at `0afaafa` (2026-09-14) with 26 errors across nine
files. RV-FN1 Part A fixed the types of six of them and removed their
exclusions: extract-biomarkers, parse-lab-report-ocr, lab-insights,
stripe-checkout, delete-user-data and `_shared/rate-limit-store.ts`
(`subscription-guard.ts` had been fixed earlier). The script now checks 71 of
the 73 discovered files. These are entry-point exclusions, not diagnostic
suppressions: Deno still checks transitive imports. A checked file importing a
baseline failure will fail the check. Excluded files are not protected against
additional errors until removed from the list.
`scripts/ci/check-functions.test.ts` fails if any other file is excluded, if a
discovered file is neither checked nor excluded, or if this table and the
script disagree.

Each remaining file, checked on its own with `--node-modules-dir=none --no-lock`:

| Excluded file | Baseline errors |
| --- | ---: |
| `supabase/functions/generate-interpretation/index.ts` | 1 |
| `supabase/functions/create-portal-session/index.ts` | 1 |

- **generate-interpretation** (RV-FN1 Part B, after GI1/GI2): TS2322 at
  `return result.success ? result.data : undefined;` in
  `sanitizeReportContext(raw: unknown): LabReportData["context"]`. The
  declared return type omits `undefined`, which the function returns.
- **create-portal-session** (RV-FN1 Part C, after owner decision O1): TS2322,
  `"2024-11-20.acacia"` is not assignable to `"2023-10-16"` at its
  `apiVersion`. The portal is the only Stripe user still on
  `npm:stripe@14.11.0`.

### One Stripe SDK per check

Every Stripe SDK version ships ambient `declare module 'stripe'` types. In one
`deno check` program they merge, and the first version loaded types every
Stripe file. Discovery is alphabetical, so un-excluding the portal while it is
on 14.11.0 would silently check stripe-checkout, stripe-webhook and
delete-user-data against v14. The checked files must import a single
`npm:stripe@x.y.z` version; `scripts/ci/check-functions.test.ts` enforces it.
Move the portal to the others' version before removing its exclusion.

### The stripe-version directive

stripe-node's types only reflect its latest API version; for an older pinned
`apiVersion` its README suggests a `@ts-ignore stripe-version-…` comment, and
Stripe notes an overridden `apiVersion` "might cause inaccurate Typescript
types". This repository uses `@ts-expect-error` instead, which fails (TS2578)
as soon as the mismatch is gone. It is the only suppression allowed in
non-test edge-function code, written on the line directly above the
`apiVersion` it covers, with the same version:

```ts
// @ts-expect-error stripe-version-2024-11-20.acacia: <reason>
```

delete-user-data carries the one directive today, so its pin keeps the wire
unchanged. If its pin is dropped, delete the directive with it.

Fix the types in a separately scoped change, then remove the corresponding
case entry in `docs/check-functions.sh`. Do not add exclusions for new errors.
To inspect the full baseline using Bash from the repository root (while the
portal is on 14.11.0 this run types the other Stripe files against v14, so read
their errors from a run without the portal):

```bash
files=()
for file in supabase/functions/*/index.ts supabase/functions/_shared/*.ts supabase/functions/_shared/*/*.ts; do
  [[ "$file" == *.test.ts ]] || files+=("$file")
done
npx --yes deno@2.1.4 check --node-modules-dir=none --no-lock "${files[@]}"
```
