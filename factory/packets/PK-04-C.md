---
packet: PK-04-C
title: "Stage + cycle fields"
phase: V2-04
wave: C
tickets: [V2-04-03, V2-04-04]
depends_on: [PK-04-B]
status: todo
gates: [G0, G4, G5]
branch: factory/pk-04-c
pr: null
updated: 2026-10-11
---

# PK-04-C — Stage + cycle fields

Phase **V2-04**, wave **C** (may run in parallel with other wave-C packets of this phase once dependencies are merged).

## Before you start

1. Read `AGENTS.md`, `CLAUDE.md`, `NUTRIENT_GUIDELINES.md` and `factory/gates.md`. If you have Second Brain access, load it via `80 Skills/Load Project Context.md`; live repo evidence overrides it.
2. Confirm every packet in `depends_on` is `done` in `factory/status.json`. If not, stop and set this packet to `blocked` with the reason.
3. Search the repo for existing work on these tickets (the feature list may be ahead of or behind the code). Report what already exists in the PR description.
4. Branch from `main` as `factory/pk-04-c`. One PR. Do not merge, deploy, `supabase db push` or `supabase functions deploy`.

## Tickets in this packet

### V2-04-03 — Reproductive stage, perimenopause and menopause

A single reproductive-stage field (for example: cycling, pregnant, postpartum, perimenopause, menopause, not specified) as the top-level switch, with dedicated perimenopause and menopause states.

**Acceptance criteria**

- [ ] Stage enum is exhaustive and covered by tests; `not specified` is the default and triggers no assumptions.
- [ ] Stage transitions are validated (for example pregnancy fields cleared or archived when stage leaves pregnant).
- [ ] Scoring treats unknown stage exactly as today (no behaviour change without context).

**Depends on:** V2-04-01, V2-04-02

**Risk / clinical safety:** Stage-specific ranges require clinical authority. Without an approved range, the analyte stays NEEDS_CONTEXT rather than getting an Amani score.

### V2-04-04 — Cycle status, cycle length, LMP, cycle day and phase

Capture whether and how the user cycles (regular, irregular, not cycling, unknown), typical cycle length, and LMP. Derive cycle day and phase at the blood-draw date using the existing `src/utils/cyclePredictor.ts`, not a new predictor.

**Acceptance criteria**

- [ ] Tests: cycle day/phase derived from LMP + length at the draw date match `cyclePredictor` outputs for fixtures, including irregular and missing data.
- [ ] Missing or irregular cycle data keeps cycle-dependent hormones unscored (existing cycle-dependent hormone protection still holds).
- [ ] Cycle length bounds validated server-side.

**Depends on:** V2-04-01, V2-04-02

**Risk / clinical safety:** A wrong phase silently changes hormone interpretation. Prefer "unknown" over a guessed phase.

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
