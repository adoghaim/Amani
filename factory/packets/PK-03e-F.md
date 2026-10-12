---
packet: PK-03e-F
title: "Trigger ENABLE ALWAYS verification"
phase: V2-03e
wave: A
tickets: [V2-03e-10]
depends_on: []
status: todo
gates: [G0, G3, G5]
branch: factory/pk-03e-f
pr: null
updated: 2026-10-11
---

# PK-03e-F — Trigger ENABLE ALWAYS verification

Phase **V2-03e**, wave **A** (may run in parallel with other wave-A packets of this phase once dependencies are merged).

## Before you start

1. Read `AGENTS.md`, `CLAUDE.md`, `NUTRIENT_GUIDELINES.md` and `factory/gates.md`. If you have Second Brain access, load it via `80 Skills/Load Project Context.md`; live repo evidence overrides it.
2. Confirm every packet in `depends_on` is `done` in `factory/status.json`. If not, stop and set this packet to `blocked` with the reason.
3. Search the repo for existing work on these tickets (the feature list may be ahead of or behind the code). Report what already exists in the PR description.
4. Branch from `main` as `factory/pk-03e-f`. One PR. Do not merge, deploy, `supabase db push` or `supabase functions deploy`.

## Tickets in this packet

### V2-03e-10 — Database trigger post-deploy verification: ENABLE ALWAYS (pre-production blocker)

Safety triggers (immutability, overwrite protection, projection, privileged-column triggers) must stay `ENABLE ALWAYS` after migrations and restores. Triggers in the default mode do not fire when `session_replication_role = replica`, which restore tools use. Add a verification query, a harness assertion, and a runbook step that runs after every `supabase db push` or restore.

**Acceptance criteria**

- [ ] A checked-in SQL query lists every safety trigger with `pg_trigger.tgenabled`; expected value `A` for each.
- [ ] Harness fixture: with `session_replication_role = replica`, a forbidden overwrite is still rejected.
- [ ] Harness fails if any listed safety trigger is not `A`.
- [ ] Runbook in factory gates documents the post-deploy check and the stop condition.

**Depends on:** none

**Risk / clinical safety:** Silent loss of database safety after a restore is the failure mode. The exact list of safety trigger names must be taken from the migrations, not guessed.

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
