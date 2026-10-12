---
packet: PK-04-G
title: "Per-report snapshot + legacy mapping"
phase: V2-04
wave: C
tickets: [V2-04-10]
depends_on: [PK-04-B]
status: todo
gates: [G0, G3, G5]
branch: factory/pk-04-g
pr: null
updated: 2026-10-11
---

# PK-04-G — Per-report snapshot + legacy mapping

Phase **V2-04**, wave **C** (may run in parallel with other wave-C packets of this phase once dependencies are merged).

## Before you start

1. Read `AGENTS.md`, `CLAUDE.md`, `NUTRIENT_GUIDELINES.md` and `factory/gates.md`. If you have Second Brain access, load it via `80 Skills/Load Project Context.md`; live repo evidence overrides it.
2. Confirm every packet in `depends_on` is `done` in `factory/status.json`. If not, stop and set this packet to `blocked` with the reason.
3. Search the repo for existing work on these tickets (the feature list may be ahead of or behind the code). Report what already exists in the PR description.
4. Branch from `main` as `factory/pk-04-g`. One PR. Do not merge, deploy, `supabase db push` or `supabase functions deploy`.

## Tickets in this packet

### V2-04-10 — Per-report context snapshot and legacy context mapping

When a report is created or interpreted, bind a snapshot of the female context as of the blood-draw date to that report, so later profile edits do not rewrite history. Map existing `lab_reports.context` values (`birth_control`, `pregnant`, `postpartum`) into the new model without destroying the original.

**Acceptance criteria**

- [ ] Test: editing the profile after a report does not change that report's snapshot.
- [ ] Backfill is additive and idempotent; original `lab_reports.context` is preserved.
- [ ] Snapshot is server-written; clients cannot write it (grant test).

**Depends on:** V2-04-01, V2-04-02

**Risk / clinical safety:** History integrity, same principle as append-only interpretation versions.

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
