# Amani

Amani is a women's health lab interpretation platform built as a TypeScript monorepo. The product combines a React web app, an Expo mobile app, shared domain utilities, and Supabase-backed database and edge functions.

## Monorepo Layout

- `apps/web` - Vite + React web experience
- `apps/mobile` - Expo React Native client
- `packages/shared` - shared types, Supabase helpers, and utilities
- `supabase/functions` - edge functions for extraction, interpretation, billing, and account actions
- `supabase/migrations` - schema and data migrations

## Local Development

Install dependencies from the repo root:

```bash
npm install
```

Start the web app:

```bash
npm run dev:web
```

Start the mobile app:

```bash
npm run dev:mobile
```

Build the web app:

```bash
npm run build:web
```

Quality checks for the web app:

```bash
npm run lint --workspace=@amani/web
npm run typecheck --workspace=@amani/web
```

## Configuration

Create `apps/web/.env` or `apps/web/.env.local` with:

```bash
EXPO_PUBLIC_SUPABASE_URL=...
EXPO_PUBLIC_SUPABASE_ANON_KEY=...
VITE_STRIPE_PUBLISHABLE_KEY=...
```

Create `apps/mobile/.env` from `apps/mobile/.env.example` with:

```bash
EXPO_PUBLIC_SUPABASE_URL=...
EXPO_PUBLIC_SUPABASE_ANON_KEY=...
```

The mobile app now reads these values through `apps/mobile/app.config.ts` and `expo-constants`, so they no longer need to be hardcoded in the client. The Supabase anon key is public client config, but it should still come from environment-driven app config rather than source edits.

Set Supabase edge function secrets in the Supabase dashboard:

- `OPENAI_API_KEY`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`

## Product Guardrails

Amani is educational, not diagnostic. Features that generate explanations must stay calm, supportive, and medically bounded. Nutrient or supplement discussion must follow [NUTRIENT_GUIDELINES.md](./NUTRIENT_GUIDELINES.md).

## Mobile Native Delivery

From `apps/mobile`, native builds and store submissions now use EAS:

```bash
npm run eas:build:ios
npm run eas:build:android
npm run eas:submit:ios
npm run eas:submit:android
```

EAS profiles live in `apps/mobile/eas.json`. Before production submission, set a real iOS bundle identifier, Android package name, and the required App Store Connect / Google Play credentials for the Expo project.

## Additional Docs

- [SETUP.md](./SETUP.md) - current setup notes and environment details
- [NUTRIENT_GUIDELINES.md](./NUTRIENT_GUIDELINES.md) - AI safety rules for nutrient discussion
- [skills.md](./skills.md) - build principles and implementation best practices for this app
