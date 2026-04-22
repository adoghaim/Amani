# Amani Build Skills

This file captures how we want to build Amani as a product and codebase.

## Product Principles

- Keep the tone calm, clear, and supportive.
- Stay educational. Do not diagnose, prescribe, or imply certainty beyond the data.
- Make insights traceable to user input, lab values, cycle context, or known business rules.
- Prefer features that help users prepare for better clinician conversations.

## App Architecture

- Keep route-level UI in `apps/web/src/pages` and reusable UI in `apps/web/src/components`.
- Put shared types and cross-app helpers in `packages/shared` when both web and mobile can use them.
- Keep parsing, scoring, personalization, and insight logic in `lib/` or `utils/`, not inside JSX-heavy components.
- Add database changes through timestamped files in `supabase/migrations`.
- Keep edge functions focused on one job each: extract, interpret, bill, or maintain account state.

## Frontend Standards

- Use TypeScript everywhere.
- Follow existing naming: PascalCase for components and pages, camelCase for helpers, kebab-case only where external tooling expects it.
- Match the surrounding file style before reformatting. The web app currently leans semicolon-free; the mobile app still has semicolons in places.
- Build explicit loading, empty, and error states for async flows.
- Reuse shared definitions before creating duplicate biomarker, subscription, or Supabase types.

## AI, Data, and Safety

- Follow `NUTRIENT_GUIDELINES.md` for any interpretation or nutrient-related change.
- Never hardcode secrets or service credentials in app code.
- Respect Supabase RLS assumptions and avoid bypass patterns in client code.
- Validate AI output on the server side whenever user-facing health guidance is generated.

## Delivery Workflow

- Keep changes small and easy to review.
- Before merging web changes, run `npm run lint --workspace=@amani/web` and `npm run typecheck --workspace=@amani/web`.
- There is no automated test suite yet, so every PR should include clear manual QA notes for the affected web, mobile, or Supabase flow.
- For UI work, include screenshots or a short screen recording when behavior changes.
