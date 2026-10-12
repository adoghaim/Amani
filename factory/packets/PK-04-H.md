---
packet: PK-04-H
title: "Context-aware scoring + interpretation"
phase: V2-04
wave: D
tickets: [V2-04-11]
depends_on: [PK-04-G, PK-04-C]
status: todo
gates: [G0, G4, G5]
branch: factory/pk-04-h
pr: null
updated: 2026-10-11
---

# PK-04-H — Context-aware scoring + interpretation

Phase **V2-04**, wave **D** (may run in parallel with other wave-D packets of this phase once dependencies are merged).

## Before you start

1. Read `AGENTS.md`, `CLAUDE.md`, `NUTRIENT_GUIDELINES.md` and `factory/gates.md`. If you have Second Brain access, load it via `80 Skills/Load Project Context.md`; live repo evidence overrides it.
2. Confirm every packet in `depends_on` is `done` in `factory/status.json`. If not, stop and set this packet to `blocked` with the reason.
3. Search the repo for existing work on these tickets (the feature list may be ahead of or behind the code). Report what already exists in the PR description.
4. Branch from `main` as `factory/pk-04-h`. One PR. Do not merge, deploy, `supabase db push` or `supabase functions deploy`.

## Tickets in this packet

### V2-04-11 — Use female context in scoring and interpretation

Feed the snapshot into `scoreBiomarker`, range selection and the generation prompt. Ranges move from NEEDS_CONTEXT to scored only when context is present and an approved range exists for it.

**Acceptance criteria**

- [ ] `scoreBiomarker.test.ts` extended: each stage/phase combination for cycle-dependent analytes, plus missing-context cases that must stay unscored.
- [ ] Prompt fixtures updated; claim authority still filters every generated statement.
- [ ] Basic tier gains no new content (no-expansion test).
- [ ] Snapshot fixtures for SQL/TS parity where a SQL copy exists.

**Depends on:** V2-04-10, V2-04-03, V2-04-04

**Risk / clinical safety:** This is where context changes clinical output. Requires clinical review of any new range or rule before merge.

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
