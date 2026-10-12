---
packet: PK-03e-D
title: "Remediation three-browser + native proof"
phase: V2-03e
wave: C
tickets: [V2-03e-08]
depends_on: [PK-03e-B, PK-03e-C]
status: in-progress
gates: [G0, G1, G2, G5]
branch: factory/pk-03e-d
pr: null
updated: 2026-10-11
---

# PK-03e-D — Remediation three-browser + native proof

Phase **V2-03e**, wave **C** (may run in parallel with other wave-C packets of this phase once dependencies are merged).

## Before you start

1. Read `AGENTS.md`, `CLAUDE.md`, `NUTRIENT_GUIDELINES.md` and `factory/gates.md`. If you have Second Brain access, load it via `80 Skills/Load Project Context.md`; live repo evidence overrides it.
2. Confirm every packet in `depends_on` is `done` in `factory/status.json`. If not, stop and set this packet to `blocked` with the reason.
3. Search the repo for existing work on these tickets (the feature list may be ahead of or behind the code). Report what already exists in the PR description.
4. Branch from `main` as `factory/pk-03e-d`. One PR. Do not merge, deploy, `supabase db push` or `supabase functions deploy`.

## Tickets in this packet

### V2-03e-08 — Three-browser remediation proof

End-to-end proof of the whole customer workflow (quarantined legacy report → explanation → CTA → success, and the failure → retry path) in Chromium, WebKit and Firefox, plus a native smoke on Android emulator and iOS simulator.

**Acceptance criteria**

- [ ] Playwright specs for success and failure paths pass in all three browsers.
- [ ] Evidence (trace or video + screenshots) attached to the PR.
- [ ] Android emulator and iOS simulator smoke: the remediation screen renders and the CTA reaches the server (G2).

**Depends on:** V2-03e-03, V2-03e-04, V2-03e-05, V2-03e-06, V2-03e-07

**Risk / clinical safety:** Needs a seeded non-production Supabase project with a legacy report and a claim row. Never run against production users.

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
