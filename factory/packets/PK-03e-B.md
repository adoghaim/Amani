---
packet: PK-03e-B
title: "Remediation entitlement rules: $0, no counter, no active sub"
phase: V2-03e
wave: B
tickets: [V2-03e-03, V2-03e-04]
depends_on: [PK-03e-A]
status: in-progress
gates: [G0, G3, G5]
branch: factory/pk-03e-b
pr: null
updated: 2026-10-11
---

# PK-03e-B — Remediation entitlement rules: $0, no counter, no active sub

Phase **V2-03e**, wave **B** (may run in parallel with other wave-B packets of this phase once dependencies are merged).

## Before you start

1. Read `AGENTS.md`, `CLAUDE.md`, `NUTRIENT_GUIDELINES.md` and `factory/gates.md`. If you have Second Brain access, load it via `80 Skills/Load Project Context.md`; live repo evidence overrides it.
2. Confirm every packet in `depends_on` is `done` in `factory/status.json`. If not, stop and set this packet to `blocked` with the reason.
3. Search the repo for existing work on these tickets (the feature list may be ahead of or behind the code). Report what already exists in the PR description.
4. Branch from `main` as `factory/pk-03e-b`. One PR. Do not merge, deploy, `supabase db push` or `supabase functions deploy`.

## Tickets in this packet

### V2-03e-03 — $0 remediation that consumes no claim and no regeneration count

Eligible remediation regenerates without charging, without consuming another introductory claim, and without incrementing the ordinary regeneration counter (`regeneration_count`, max 3).

**Acceptance criteria**

- [ ] Tests: after remediation, claim ledger row count and `regeneration_count` are unchanged.
- [ ] No Stripe or IAP call is made on this path (fake port asserts zero billing calls).
- [ ] Ordinary (non-remediation) regeneration still increments the counter and still enforces the limit.

**Depends on:** V2-03e-01, V2-03e-02

**Risk / clinical safety:** Must not open a free-regeneration loophole: the remediation flag must be server-decided, never accepted from the request body.

### V2-03e-04 — Claimed legacy remediation does not need an active subscription

A valid historical claim survives a cancelled or lapsed subscription. The subscription guard is bypassed only for the remediation path and only when the evaluator says eligible.

**Acceptance criteria**

- [ ] Tests: cancelled Stripe customer with an eligible claim can remediate; same user without a claim gets the normal 402/upsell.
- [ ] Guard bypass is scoped to remediation; all other generation paths still return 402 `subscription_required`.
- [ ] Test covers IAP-expired and Stripe-cancelled states.

**Depends on:** V2-03e-02

**Risk / clinical safety:** A guard bypass is a classic entitlement hole. Reviewer must check the bypass cannot be reached from any other route.

## Required tests and evidence

Standard criteria that apply (from the backlog):

- [ ] G0 core gates green: `npm run lint`, `npm run typecheck`, `npm run validate:contrast`, `npm test`, `npm run build`, `npm run check:functions` (no new baseline exclusions).
- [ ] Migration harness `supabase/migrations/__verification__/run.sh` passes with new fixtures for this change (RLS cross-user denial, column grants, trigger behaviour).

Gates to pass (see `factory/gates.md`): **G0, G3, G5**.

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
