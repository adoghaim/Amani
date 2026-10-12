---
packet: PK-05-B
title: "Critical-value engine + unit sanity (pure, dark; may run alongside V2-04)"
phase: V2-05
wave: A
tickets: [V2-05-02, V2-05-03]
depends_on: [PK-03e-E, PK-03e-F]
status: todo
gates: [G0, G4, G5]
branch: factory/pk-05-b
pr: null
updated: 2026-10-11
---

# PK-05-B — Critical-value engine + unit sanity (pure, dark; may run alongside V2-04)

Phase **V2-05**, wave **A** (may run in parallel with other wave-A packets of this phase once dependencies are merged).

## Before you start

1. Read `AGENTS.md`, `CLAUDE.md`, `NUTRIENT_GUIDELINES.md` and `factory/gates.md`. If you have Second Brain access, load it via `80 Skills/Load Project Context.md`; live repo evidence overrides it.
2. Confirm every packet in `depends_on` is `done` in `factory/status.json`. If not, stop and set this packet to `blocked` with the reason.
3. Search the repo for existing work on these tickets (the feature list may be ahead of or behind the code). Report what already exists in the PR description.
4. Branch from `main` as `factory/pk-05-b`. One PR. Do not merge, deploy, `supabase db push` or `supabase functions deploy`.

## Tickets in this packet

### V2-05-02 — Deterministic critical-value engine

Pure `_shared` module that evaluates a report's analytes against approved rules and returns safety findings. No model call, no network.

**Acceptance criteria**

- [ ] Table-driven tests per rule: just below, at, and just above threshold; missing unit; missing value.
- [ ] Same input always gives the same output (determinism test).
- [ ] Engine output includes the rule id and version for audit.

**Depends on:** V2-05-01 (schema; can build against test rules)

**Risk / clinical safety:** False negatives are the dangerous direction. Ties and boundary semantics must be explicit per rule.

### V2-05-03 — Unit-sanity validation

Before scoring or safety evaluation, check that each analyte's unit is one the catalog knows and that the value is physiologically plausible for that unit. Mismatches are flagged to the user for review and block interpretation of that analyte rather than converting silently.

**Acceptance criteria**

- [ ] Tests: common unit confusions (for example mg/dL vs mmol/L for glucose, ng/mL vs nmol/L) are detected using the catalog's units.
- [ ] Implausible values route to the existing review step, not to scoring.
- [ ] Parser snapshot tests still pass or are updated with explained diffs.

**Depends on:** Clinical analyte catalog (done)

**Risk / clinical safety:** Wrong-unit interpretation is a real harm path. Conversions are only allowed where the catalog defines an approved factor.

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
