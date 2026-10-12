---
packet: PK-04-F
title: "Female health profile UI"
phase: V2-04
wave: D
tickets: [V2-04-09]
depends_on: [PK-04-C, PK-04-D, PK-04-E]
status: todo
gates: [G0, G1, G2, G5]
branch: factory/pk-04-f
pr: null
updated: 2026-10-11
---

# PK-04-F — Female health profile UI

Phase **V2-04**, wave **D** (may run in parallel with other wave-D packets of this phase once dependencies are merged).

## Before you start

1. Read `AGENTS.md`, `CLAUDE.md`, `NUTRIENT_GUIDELINES.md` and `factory/gates.md`. If you have Second Brain access, load it via `80 Skills/Load Project Context.md`; live repo evidence overrides it.
2. Confirm every packet in `depends_on` is `done` in `factory/status.json`. If not, stop and set this packet to `blocked` with the reason.
3. Search the repo for existing work on these tickets (the feature list may be ahead of or behind the code). Report what already exists in the PR description.
4. Branch from `main` as `factory/pk-04-f`. One PR. Do not merge, deploy, `supabase db push` or `supabase functions deploy`.

## Tickets in this packet

### V2-04-09 — First-class female health profile UI (onboarding + settings)

Profile screens in onboarding and Settings to view and edit all V2-04 fields, with "prefer not to say" everywhere, plain-language help text, and safe-area handling on native. Reuse Tailwind theme tokens and lucide icons only.

**Acceptance criteria**

- [ ] Component tests for each field group and validation messages.
- [ ] Playwright: create, edit and clear the profile in Chromium, WebKit and Firefox.
- [ ] Native: renders without overlap on Android 15+ edge-to-edge and iOS safe areas (screenshots).
- [ ] Contrast validation passes.

**Depends on:** V2-04-02, V2-04-03, V2-04-04, V2-04-05, V2-04-06, V2-04-07, V2-04-08

**Risk / clinical safety:** Fix the known onboarding issues while here only if scoped: "Under 18" age option conflicts with 18+ terms (owner decision).

## Required tests and evidence

Standard criteria that apply (from the backlog):

- [ ] G0 core gates green: `npm run lint`, `npm run typecheck`, `npm run validate:contrast`, `npm test`, `npm run build`, `npm run check:functions` (no new baseline exclusions).
- [ ] Native build proof: `npm run cap:sync` then Android `./gradlew assembleDebug` succeeds; iOS simulator build when the packet touches native-visible UI (gate G2).
- [ ] Playwright proof of the user flow in Chromium, WebKit and Firefox against the Netlify preview or a local build.

Gates to pass (see `factory/gates.md`): **G0, G1, G2, G5**.

Write tests first where practical. New server logic goes in a pure `supabase/functions/_shared/*.ts` module behind an injected actions port, tested with Vitest fakes; the Deno handler stays thin.

## PR must include

- Summary, tickets closed, and which acceptance criteria are proven by which test file.
- Commands run and their results (lint, typecheck, contrast, test, build, check:functions, and any e2e/native/harness runs).
- Evidence links: Playwright traces/screenshots, native build logs, harness output.
- Deploy notes: migrations to push, edge functions to deploy, secrets by **name only**, Capacitor sync needed. Mark each as **needs owner GO**.
- Anything you could not run (for example no Docker, no macOS runner) listed as **pending** — never claimed as passed.
- A short "Brain update" block (what changed, decisions made, new [Pending] questions) for the recorder.

## Stop conditions

- A guardrail suite would have to be weakened or a test deleted to pass.
- A clinical threshold, range or rule is needed that has no approved source. Do not invent it; add a [Pending] question.
- The change needs a new baseline exclusion in `docs/check-functions.sh`.
- Any step would touch production data, secrets or live billing.
