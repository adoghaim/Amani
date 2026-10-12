---
packet: PK-06-E
title: "Wire AmaniContext + minimization"
phase: V2-06
wave: C
tickets: [V2-06-08]
depends_on: [PK-06-B, PK-06-C, PK-06-D]
status: todo
gates: [G0, G4, G5]
branch: factory/pk-06-e
pr: null
updated: 2026-10-11
---

# PK-06-E — Wire AmaniContext + minimization

Phase **V2-06**, wave **C** (may run in parallel with other wave-C packets of this phase once dependencies are merged).

## Before you start

1. Read `AGENTS.md`, `CLAUDE.md`, `NUTRIENT_GUIDELINES.md` and `factory/gates.md`. If you have Second Brain access, load it via `80 Skills/Load Project Context.md`; live repo evidence overrides it.
2. Confirm every packet in `depends_on` is `done` in `factory/status.json`. If not, stop and set this packet to `blocked` with the reason.
3. Search the repo for existing work on these tickets (the feature list may be ahead of or behind the code). Report what already exists in the PR description.
4. Branch from `main` as `factory/pk-06-e`. One PR. Do not merge, deploy, `supabase db push` or `supabase functions deploy`.

## Tickets in this packet

### V2-06-08 — Wire AmaniContext into generation and insights, with data minimization

`generate-interpretation` and `lab-insights` read AmaniContext instead of ad hoc context. Send the model only the fields the task needs (minimization), and update the privacy disclosure draft if the payload changes.

**Acceptance criteria**

- [ ] Tests: prompt payload snapshot shows only whitelisted fields.
- [ ] No behaviour regression in existing interpretation fixtures.
- [ ] Remove the matching baseline exclusion in `docs/check-functions.sh` if the touched file's types are fixed (never add one).

**Depends on:** V2-06-02, V2-06-03, V2-06-04, V2-06-05, V2-06-06

**Risk / clinical safety:** More context to the model means more PHI to a processor. Minimize.

## Required tests and evidence

Standard criteria that apply (from the backlog):

- [ ] Clinical-authority rules hold: no new evaluative wording (better/worse/optimal/normal) without an authority source; AI prose that cannot be mapped to an authorized fact is suppressed; Basic tier gains no new content; locked counts count only authorized withheld content.
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
