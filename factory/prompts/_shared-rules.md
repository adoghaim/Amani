# Shared rules (included by every factory prompt)

You are working in the `adoghaim/Amani` repository: a women's health lab-interpretation app (Vite + React + TypeScript, Capacitor iOS/Android, Supabase Postgres + Edge Functions, Netlify web hosting, Stripe + RevenueCat).

Before doing anything:
1. Read `AGENTS.md`, `CLAUDE.md`, `NUTRIENT_GUIDELINES.md`, `factory/README.md`, `factory/gates.md`, and your packet file.
2. If you have Second Brain access, load it via `80 Skills/Load Project Context.md`. Live repo and runtime evidence override the Brain and the packet. Report any discrepancy.

Hard rules:
- Never merge, deploy, run `supabase db push`, run `supabase functions deploy`, change Netlify settings, set flags (for example `FREEMIUM_ACTIVE`), touch live Stripe/IAP, or submit to a store. These need explicit owner approval and are done by the owner.
- Never use production data or real patient files. Use synthetic fixtures.
- No secrets in code, logs, PRs or notes. Names only (for example `OPENAI_API_KEY`).
- Never silently resolve a `[Pending]`. If you need an answer only the owner can give, stop that part and add a question.
- Clinical authority: Amani is educational. No diagnosis, no prescriptive advice, no doses, frequencies, timing or brands. No new range, threshold, or evaluative statement (better, worse, optimal, normal, worrying) without an approved source. AI prose that cannot be mapped to an authorized fact is suppressed. Safety is decided deterministically, never by the model. Basic tier never gains replacement content. Legacy interpretations stay quarantined; interpretation versions are append-only.
- Nutrient/supplement policy lives only in `supabase/functions/_shared/nutrient-policy.ts`. The guardrail suites `_shared/nutrient-policy.test.ts` and `src/lib/scoring/scoreBiomarker.test.ts` must never be weakened or allowed to fail.
- Server logic: pure `_shared/*.ts` module behind an injected actions port, Vitest with fakes, thin Deno handler. Native plugins only through `src/lib/native.ts`. Tailwind theme tokens and `lucide-react` only.
- Never add an exclusion to `docs/check-functions.sh`.
- The failing `Vercel` status check is expected noise. Judge by `Lint, typecheck, build`, `Edge function typecheck`, `Migration behaviour (Postgres)`, the factory e2e jobs and the Netlify preview.
- Report honestly: anything you could not run is "pending", with the reason.
