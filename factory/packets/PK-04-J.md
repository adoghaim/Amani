---
packet: PK-04-J
title: "V2-04 end-to-end proof"
phase: V2-04
wave: E
tickets: [V2-04-13]
depends_on: [PK-04-F, PK-04-H]
status: todo
gates: [G0, G1, G2, G5]
branch: factory/pk-04-j
pr: null
updated: 2026-10-11
---

# PK-04-J — V2-04 end-to-end proof

Phase **V2-04**, wave **E** (may run in parallel with other wave-E packets of this phase once dependencies are merged).

## Before you start

1. Read `AGENTS.md`, `CLAUDE.md`, `NUTRIENT_GUIDELINES.md` and `factory/gates.md`. If you have Second Brain access, load it via `80 Skills/Load Project Context.md`; live repo evidence overrides it.
2. Confirm every packet in `depends_on` is `done` in `factory/status.json`. If not, stop and set this packet to `blocked` with the reason.
3. Search the repo for existing work on these tickets (the feature list may be ahead of or behind the code). Report what already exists in the PR description.
4. Branch from `main` as `factory/pk-04-j`. One PR. Do not merge, deploy, `supabase db push` or `supabase functions deploy`.

## Tickets in this packet

### V2-04-13 — V2-04 end-to-end proof

Full flow: set profile → upload fixture report → see context-aware result → edit profile → old report unchanged. Web in three browsers; Android emulator and iOS simulator smoke.

**Acceptance criteria**

- [ ] Playwright specs pass in Chromium, WebKit, Firefox with evidence attached.
- [ ] Android `assembleDebug` + emulator smoke and iOS simulator build pass (G2).

**Depends on:** V2-04-09, V2-04-11

**Risk / clinical safety:** Use synthetic lab fixtures only; never real patient files.

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
