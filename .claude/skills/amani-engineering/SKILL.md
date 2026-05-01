---
name: amani-engineering
description: Engineering practices for the Amani repo. Use when writing or modifying code in this codebase — covers behavioral rules (Karpathy four principles adapted), the load-bearing medical-boundary sync rule, parser-pipeline conventions, Capacitor native-bridging discipline, Supabase Edge Function patterns, TypeScript trust boundaries, React lazy + error-boundary expectations, and the verify loop that compensates for the absence of an automated test runner.
---

# Amani Engineering Skill

Behavioral and structural rules for working in this repo. The four behavioral principles come first (they apply to every change). The structural rules come second (they apply when the change touches a specific subsystem).

---

## I. Behavioral rules (apply to every change)

### 1. Think before coding
State assumptions out loud before writing code. If multiple interpretations exist, present them — don't pick silently. If a simpler approach exists, say so. If the task is unclear, stop and ask.

In this repo specifically: silent assumptions about lab formats, cycle phase, biomarker units, or what counts as "in range" can poison everything downstream. When the task touches `src/utils/parser/`, `src/lib/scoring/`, or `supabase/functions/generate-interpretation/`, surface the assumption *before* coding.

### 2. Simplicity first
Minimum code that solves the asked problem. No speculative features, no abstractions for single-use code, no error handling for impossible scenarios, no configurability that wasn't requested. If you wrote 200 lines and 50 would do, rewrite it.

Self-test: would a senior engineer call this overcomplicated? In Amani, the parser pipeline is the place this rule bites hardest — every "just in case" branch ages into a maintenance liability.

### 3. Surgical changes
Touch only what the request requires. Don't reformat adjacent code. Don't rename variables you weren't asked to rename. Don't refactor things that aren't broken. Match existing style, even if you'd write it differently.

Orphan rule: remove imports/vars/functions that *your* change made unused. Leave pre-existing dead code alone — flag it in the response, don't delete it.

Every changed line in the diff should trace back to the user's request.

### 4. Goal-driven execution — the verify loop
This repo has **no automated test runner**. Validation is `npm run lint`, `npm run typecheck`, `npm run build`, plus manual flow testing. After any non-trivial change, run all three and report results. For UI changes, run `npm run dev` and exercise the changed flow in a browser before reporting "done."

For multi-step tasks, write a numbered plan where each step has an explicit `verify:` line — the plan is not done until every verify passes.

---

## II. Load-bearing structural rules

### A. The medical-boundary rules (highest-stakes area in the repo)

`NUTRIENT_GUIDELINES.md` defines the human-readable spec: a 7-item allow-list of nutrients, banned prescriptive verbs (e.g. "take", "supplement with"), banned dosage units, and required consultative phrasing.

**Single source of truth: `supabase/functions/_shared/nutrient-policy.ts`.** That module exports the canonical allow-list, banned-supplement list, and the regexes for dosage units, prescriptive verbs, and dosing-frequency words. Both the system prompt (via `ALLOWED_NUTRIENTS_PROMPT_LIST` interpolation) and the runtime validator (`validateInterpretationOutput`) consume the same constants — they cannot drift.

**Runtime flow** in `generate-interpretation/index.ts`: every OpenAI response runs through `validateInterpretationOutput()`. On the first violation, the prompt is augmented with the specific violation list and the model is called again. If the second attempt still violates, `sanitizeViolations()` filters offending items out of the `what_you_can_do_now` and `what_to_do_next` arrays before persisting. Don't change this fail-closed flow without explicit user approval.

**Rules when working in this area:**
- Allow-list / banned-pattern changes go in `_shared/nutrient-policy.ts` only. Update `NUTRIENT_GUIDELINES.md` in the same commit so the spec doc matches.
- Never re-introduce hardcoded nutrient lists in the prompt or anywhere else. Always import from `_shared/nutrient-policy.ts`.
- Any change to medical-boundary text requires the edge function to be redeployed (`supabase functions deploy generate-interpretation`).

### B. Parser pipeline conventions (`src/utils/parser/`)

- **Adapter pattern is load-bearing.** Quest, LabCorp, Hone, generic — each is a distinct adapter selected by `sourceDetection`. Add new sources as adapters; do not bolt source-specific logic into shared helpers.
- **Confidence is part of the contract.** Every parsed biomarker carries `confidence: 'high' | 'medium' | 'low'` and a `parse_status` flag. Downstream code reads these. Don't drop them when adding new fields.
- **Physiological bounds gate scoring.** `checkPhysiologicalBounds()` rejects values outside biological possibility (parser bugs), distinct from reference-range scoring (statistical findings). Keep that distinction — values failing physiological bounds should never reach the scorer.
- **Pattern catalogs are data.** `patterns.ts` (BIOMARKER_PATTERNS, PHYSIOLOGICAL_BOUNDS, CATALOG_SLUG_ALIASES) is intentionally a flat data file. New analytes go as new entries with examples; don't restructure into class hierarchies.
- **Validate parser changes via `/dev/parser/:id`** before claiming a parser change works. Type-checking does not catch parser regressions.

### C. Capacitor native bridging — never import `@capacitor/*` in components

All native plugin access goes through `src/lib/native.ts`, which guards every call with `Capacitor.isNativePlatform()`. `src/lib/capacitor-stubs/` provides build-time stubs so the web build runs without a native runtime.

If you need a new native capability, add it to `src/lib/native.ts` with a platform guard and a web fallback (or explicit "web not supported" return). Never import a Capacitor plugin directly in a page or component — the web build will break.

The Android back-button handler (`AndroidBackHandler` in `App.tsx`) treats `/app`, `/login`, `/signup`, `/` as exit-on-back routes. Adding a new top-level route? Decide explicitly whether it's exit-on-back and update the handler.

### D. Supabase Edge Functions (Deno)

- **Validate request bodies at the trust boundary.** Untrusted input (from the client, from OpenAI, from Stripe) gets validated before use. Use Zod schemas; infer types via `z.infer<typeof Schema>` rather than declaring parallel interfaces.
- **Stripe webhook discipline.** Read raw body via `req.text()`, verify with `Stripe.constructEventAsync` + `Stripe.createSubtleCryptoProvider()` (Deno needs Web Crypto), and dedupe by `event.id`. Never JSON-parse before signature verification. Do not disable JWT verification on any function except provider-signed webhooks.
- **Secrets via `Deno.env.get()` only.** Never hardcode `OPENAI_API_KEY` or Stripe secrets. Never put server secrets in `.env` (which is client-exposed via Vite) — they belong in Supabase function secrets.
- **Shared code in `supabase/functions/_shared/`.** Don't cross-import between functions; that breaks per-function deploy isolation.

### E. TypeScript trust boundaries

- **Zod at boundaries, plain TS inside.** Validate at: parser output, OpenAI responses, Stripe webhook bodies, Supabase RPC results when the schema isn't generated. Don't pay the runtime cost validating data you control.
- **Generated Database types over hand-maintained partials.** `src/lib/supabase.ts` currently has a hand-maintained `Database` covering only `users` and `stripe_user_subscriptions`. When you add table types, prefer regenerating via `supabase gen types typescript` over extending the partial by hand.
- **Narrow with type guards, never assert.** `function isQuestReport(x): x is QuestReport` over `as QuestReport`. Assertions silently mask the failure modes — in this no-test codebase, that's where bugs hide.

### F. React patterns

- **Lazy routes need error boundaries.** Every `React.lazy()` route should be wrapped in an Error Boundary so a failed chunk doesn't blank the authenticated shell. If you add a new lazy route and there's no boundary, add one.
- **Memoize at expensive boundaries only.** Reflexive `useMemo` on cheap derivations is noise. The places memoization actually pays off here are scoring/grouping outputs and parser-debugger renders.
- **One context only.** Auth state lives in `src/contexts/AuthContext.tsx`. Don't add new top-level contexts — push state down or into a hook unless it's truly app-wide.
- **Function components only.** No class components.

### G. Conventions

- TypeScript everywhere. PascalCase.tsx for components/pages, camelCase.ts for utilities, useSomething.ts for hooks.
- Tailwind utilities + theme tokens from `tailwind.config.js`. No one-off CSS.
- Icons from `lucide-react` only. Don't add UI/icon libraries.
- Generated mobile files in `android/` and `ios/` — only edit for genuinely platform-specific changes; otherwise use `npm run cap:sync`.
- Default to no comments. Add one only when the *why* is non-obvious (hidden constraint, subtle invariant, workaround for a specific bug). Don't explain *what* the code does.

---

## III. The pre-PR checklist

Before reporting work as done:

1. `npm run lint` — clean
2. `npm run typecheck` — clean
3. `npm run build` — clean
4. **If the change touched `src/utils/parser/`:** load `/dev/parser/:id` against a representative report and confirm output matches expectations.
5. **If the change touched `supabase/functions/generate-interpretation/` or `_shared/nutrient-policy.ts`:** confirm the policy module, the prompt's interpolated allow-list, and `NUTRIENT_GUIDELINES.md` are mutually consistent. Confirm the edge function has been redeployed if behavior changed.
6. **If the change is UI:** run `npm run dev` and exercise the golden path + one edge case in a browser. If you can't test the UI, say so — don't claim success.
7. **If the change touched native code or Capacitor plugins:** `npm run cap:sync` and confirm the relevant platform builds.

If any step fails, don't paper over it. Investigate the root cause.
