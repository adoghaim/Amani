---
packet: PK-06-C
title: "Medications + interventions"
phase: V2-06
wave: B
tickets: [V2-06-03, V2-06-04]
depends_on: [PK-06-A]
status: todo
gates: [G0, G4, G5]
branch: factory/pk-06-c
pr: null
updated: 2026-10-11
---

# PK-06-C — Medications + interventions

Phase **V2-06**, wave **B** (may run in parallel with other wave-B packets of this phase once dependencies are merged).

## Before you start

1. Read `AGENTS.md`, `CLAUDE.md`, `NUTRIENT_GUIDELINES.md` and `factory/gates.md`. If you have Second Brain access, load it via `80 Skills/Load Project Context.md`; live repo evidence overrides it.
2. Confirm every packet in `depends_on` is `done` in `factory/status.json`. If not, stop and set this packet to `blocked` with the reason.
3. Search the repo for existing work on these tickets (the feature list may be ahead of or behind the code). Report what already exists in the PR description.
4. Branch from `main` as `factory/pk-06-c`. One PR. Do not merge, deploy, `supabase db push` or `supabase functions deploy`.

## Tickets in this packet

### V2-06-03 — Medication context

Structured medication context from onboarding medications and Tracker interventions of type Medication. Explanatory only; never used to recommend changes.

**Acceptance criteria**

- [ ] Tests: mapping from existing data; free text bounded; no dose fields are added.
- [ ] Prescriptive-language validator covers medication names in output.

**Depends on:** V2-06-01

**Risk / clinical safety:** Medication logging is not medication management (matches the Play health declaration). Do not add dose or schedule fields.

### V2-06-04 — Intervention context

Interventions the user logged (supplement, medication, lifestyle) with start/stop dates, linked to reports by date.

**Acceptance criteria**

- [ ] Tests: intervention timeline aligns to report draw dates; overlapping interventions handled.

**Depends on:** V2-06-01

**Risk / clinical safety:** Enables S2-07; must stay descriptive ("after X, Y moved") not causal.

## Required tests and evidence

Standard criteria that apply (from the backlog):

- [ ] G0 core gates green: `npm run lint`, `npm run typecheck`, `npm run validate:contrast`, `npm test`, `npm run build`, `npm run check:functions` (no new baseline exclusions).
- [ ] Medical guardrail suites stay green and unweakened: `supabase/functions/_shared/nutrient-policy.test.ts` and `src/lib/scoring/scoreBiomarker.test.ts`.

Gates to pass (see `factory/gates.md`): **G0, G4, G5**.

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
