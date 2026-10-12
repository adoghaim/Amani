---
packet: PK-03e-A
title: "Remediation server core: bridge + eligibility"
phase: V2-03e
wave: A
tickets: [V2-03e-01, V2-03e-02]
depends_on: []
status: in-progress
gates: [G0, G3, G4, G5]
branch: factory/pk-03e-a
pr: null
updated: 2026-10-11
---

# PK-03e-A — Remediation server core: bridge + eligibility

Phase **V2-03e**, wave **A** (may run in parallel with other wave-A packets of this phase once dependencies are merged).

## Before you start

1. Read `AGENTS.md`, `CLAUDE.md`, `NUTRIENT_GUIDELINES.md` and `factory/gates.md`. If you have Second Brain access, load it via `80 Skills/Load Project Context.md`; live repo evidence overrides it.
2. Confirm every packet in `depends_on` is `done` in `factory/status.json`. If not, stop and set this packet to `blocked` with the reason.
3. Search the repo for existing work on these tickets (the feature list may be ahead of or behind the code). Report what already exists in the PR description.
4. Branch from `main` as `factory/pk-03e-a`. One PR. Do not merge, deploy, `supabase db push` or `supabase functions deploy`.

## Tickets in this packet

### V2-03e-01 — Legacy paid/claimed regeneration bridge

Server path that lets an eligible legacy report receive a new interpretation under current policy. It writes a new append-only interpretation version and selects it as current; the historical legacy interpretation stays stored and quarantined, never overwritten. Ordering and policy live in a pure `supabase/functions/_shared/*.ts` module behind an injected actions port; the Deno handler is thin wiring.

**Acceptance criteria**

- [ ] Vitest with fakes: a successful remediation creates exactly one new version and marks it current; the legacy row is byte-identical afterwards.
- [ ] Repeating the same request identity returns the existing version (idempotent) and creates no second successful version.
- [ ] A destructive overwrite attempt is rejected at the database boundary (harness fixture, flag on and off).
- [ ] New version carries current provenance; legacy version still renders only as quarantined.

**Depends on:** Accepted V2-03e persistence foundation

**Risk / clinical safety:** Data-loss risk if any path updates the legacy row. Must reuse the existing overwrite-protection triggers, not bypass them with service-role writes.

### V2-03e-02 — Legacy remediation eligibility evaluator

Pure evaluator that decides whether a legacy report qualifies for special remediation. Eligibility is restricted to provable rows in `introductory_deep_access_claims`. It never infers historical payment from Stripe history, timestamps, tier columns or anything client-writable.

**Acceptance criteria**

- [ ] Unit tests: eligible only when a committed claim row for that user and report/draw exists; every other case (no claim, other user's claim, Stripe history only, `tier='plus'` only) is ineligible.
- [ ] Evaluator is pure (no Deno/Stripe imports) and returns a reason code for each ineligible case.
- [ ] No client-writable column is an input (asserted by test listing inputs).

**Depends on:** none

**Risk / clinical safety:** Money-adjacent. Over-granting gives free paid AI; under-granting strands paying users. The historical billing ledger is explicitly out of scope (see L-07).

## Required tests and evidence

Standard criteria that apply (from the backlog):

- [ ] Clinical-authority rules hold: no new evaluative wording (better/worse/optimal/normal) without an authority source; AI prose that cannot be mapped to an authorized fact is suppressed; Basic tier gains no new content; locked counts count only authorized withheld content.
- [ ] G0 core gates green: `npm run lint`, `npm run typecheck`, `npm run validate:contrast`, `npm test`, `npm run build`, `npm run check:functions` (no new baseline exclusions).
- [ ] Medical guardrail suites stay green and unweakened: `supabase/functions/_shared/nutrient-policy.test.ts` and `src/lib/scoring/scoreBiomarker.test.ts`.
- [ ] Migration harness `supabase/migrations/__verification__/run.sh` passes with new fixtures for this change (RLS cross-user denial, column grants, trigger behaviour).

Gates to pass (see `factory/gates.md`): **G0, G3, G4, G5**.

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
