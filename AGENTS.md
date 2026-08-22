# Repository Guidelines

## Project Structure & Module Organization

Amani is a Vite React TypeScript application with Capacitor mobile targets and Supabase backend resources.

- `src/` contains the web app. Route-level screens live in `src/pages/`, shared UI in `src/components/`, hooks in `src/hooks/`, context providers in `src/contexts/`, and domain logic in `src/lib/` and `src/utils/`.
- `src/lib/scoring/`, `src/lib/biomarkers/`, `src/lib/insights/`, and `src/lib/personalization/` hold health interpretation logic. Keep medical-boundary changes aligned with `NUTRIENT_GUIDELINES.md`.
- `supabase/functions/` contains Edge Functions; `supabase/migrations/` contains database schema changes.
- `android/` and `ios/` are Capacitor platform projects. Do not edit generated mobile files unless the change is platform-specific.

## Build, Test, and Development Commands

- `npm install` installs dependencies from `package-lock.json`.
- `npm run dev` starts the local Vite development server.
- `npm run build` creates a production build in `dist/`.
- `npm run preview` serves the production build locally.
- `npm run lint` runs ESLint over the repository.
- `npm run typecheck` runs TypeScript without emitting files.
- `npm run cap:sync` builds the web app and syncs Capacitor assets to native projects.

## Coding Style & Naming Conventions

Use TypeScript for app code and React function components for UI. Follow existing naming: `PascalCase.tsx` for components and pages, `camelCase.ts` for utilities, hooks named `useSomething.ts`, and domain modules grouped by feature. Prefer Tailwind utility classes and theme colors from `tailwind.config.js` over one-off CSS values. Keep code lint-clean under the configured TypeScript, React Hooks, and React Refresh ESLint rules.

## Testing Guidelines

Vitest is configured (`vitest.config.ts`); `npm test` runs four suites totalling 32 tests and executes in CI between typecheck and build. Before opening a PR, run `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build`. For parser, scoring, Supabase, or health-interpretation changes, add focused tests and document manual validation steps in the PR. For server logic, follow the existing pattern: put ordering and policy in a pure `supabase/functions/_shared/*.ts` module behind an injected actions port so it can be tested with fakes, and keep the Deno handler a thin wiring layer.

## Commit & Pull Request Guidelines

Recent history uses short imperative or descriptive commits such as `Updated build.gradle` and `Fix Android Supabase env embedding`. Keep commits scoped and clear. PRs should include a concise summary, linked issue if applicable, verification commands, screenshots for UI changes, and notes for Supabase migrations, Edge Function secrets, or Capacitor sync requirements.

## Deployment

The web app is hosted on **Netlify** (`amani-biometrics`, custom domain `amanibiometrics.com`), which builds a deploy preview for every PR. It is **not** hosted on Vercel — a leftover Vercel GitHub integration still posts a failing `Vercel` status check on PRs, and that failure is expected noise, not a merge blocker. Judge PRs by the `Lint, typecheck, build` CI check and the Netlify preview. Supabase migrations and Edge Functions deploy separately and manually (`supabase db push`, `supabase functions deploy <name>`); Netlify never deploys anything under `supabase/`.

## Security & Configuration Tips

Use `.env` for Vite variables such as `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, and optional Stripe keys. Store Edge Function secrets such as `OPENAI_API_KEY` in Supabase, not in source control. Never commit user health data, lab files, API keys, or local build artifacts.
