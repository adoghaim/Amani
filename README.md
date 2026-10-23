# Amani - Women's Health Lab Interpretation Platform

Amani is a supportive women's health AI assistant that provides calm, educational interpretations of lab results with cycle awareness.

## Key Features

- Lab report PDF upload and biomarker extraction
- AI-generated interpretations with menstrual cycle context
- Secure authentication and data storage
- Educational guidance while maintaining medical boundaries

## Important Guidelines

### Nutrient Discussion Rules

Amani follows strict guidelines for discussing nutrients and supplements to maintain appropriate medical boundaries:

- **Only evidence-based**: Nutrients are mentioned only when directly tied to specific lab values or reported symptoms
- **Consultative language**: All mentions use phrases like "Some clinicians may discuss..." or "You may want to ask your provider about..."
- **No prescriptive advice**: Never includes dosages, frequencies, timing, or brands
- **No alternative supplements**: Excludes herbal, adaptogenic, or hormone-modulating supplements

For complete details, see [NUTRIENT_GUIDELINES.md](./NUTRIENT_GUIDELINES.md)

## Project Structure

- `/src` - React frontend application
- `/supabase/functions` - Edge functions for biomarker extraction and interpretation generation
- `/supabase/migrations` - Database schema and migrations

## Documentation

- [NUTRIENT_GUIDELINES.md](./NUTRIENT_GUIDELINES.md) - Detailed nutrient discussion rules and validation logic
- [SETUP.md](./SETUP.md) - Setup and configuration instructions

## Software factory and Jarvis

- [`factory/`](./factory/README.md) is the AI software factory: one work packet per PR (`factory/packets/`), builder/tester/reviewer prompts, quality gates (`factory/gates.md`: lint, typecheck, unit tests, build, edge functions, Playwright e2e in Chromium/WebKit/Firefox, Android and iOS builds, database/RLS/trigger checks), and a status ledger (`factory/status.json`, `factory/STATUS.md`). From Claude Code in this repo run `/factory-status` to see what's ready and `/factory-run <packet-id>` (or `/factory-run` for the next ready packet). Agents open PRs; the owner approves every merge, and Supabase migrations/functions are never deployed to production by an agent. Web e2e runs in `.github/workflows/e2e.yml` (Browser smoke: the isolated Playwright suite in Chromium, WebKit and Firefox); `.github/workflows/native-build.yml` builds the Android app on every PR and the iOS simulator app on PRs that change `ios/**`, `package.json`, `package-lock.json` or `capacitor.config.ts`, with the emulator smoke opt-in.
- [`jarvis/`](./jarvis/README.md) is the daily admin and growth agent. It runs on a Claude subscription via Claude Code, reads GitHub, the factory ledger, PostHog (including A/B experiments) and the marketing/social/app-store accounts, and writes a morning report with what to do next. Setup: copy `jarvis/.env.example` to `jarvis/.env`, fill in at least `GITHUB_REPO` and the PostHog values, then run `bash jarvis/setup.sh`. See `jarvis/SETUP_ACCOUNTS.md` for creating accounts and keys. It is read-only by default; actions are proposals in `jarvis/approvals/pending/` that run only after owner approval via `jarvis/execute-approved.sh`.
