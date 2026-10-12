---
packet: PK-04-A
title: "Female context schema, RLS, grants"
phase: V2-04
wave: A
tickets: [V2-04-01]
depends_on: [PK-03e-E, PK-03e-F]
status: todo
gates: [G0, G3, G5]
branch: factory/pk-04-a
pr: null
updated: 2026-10-11
---

# PK-04-A — Female context schema, RLS, grants

Phase **V2-04**, wave **A** (may run in parallel with other wave-A packets of this phase once dependencies are merged).

## Before you start

1. Read `AGENTS.md`, `CLAUDE.md`, `NUTRIENT_GUIDELINES.md` and `factory/gates.md`. If you have Second Brain access, load it via `80 Skills/Load Project Context.md`; live repo evidence overrides it.
2. Confirm every packet in `depends_on` is `done` in `factory/status.json`. If not, stop and set this packet to `blocked` with the reason.
3. Search the repo for existing work on these tickets (the feature list may be ahead of or behind the code). Report what already exists in the PR description.
4. Branch from `main` as `factory/pk-04-a`. One PR. Do not merge, deploy, `supabase db push` or `supabase functions deploy`.

## Tickets in this packet

### V2-04-01 — Female health context data model: migration, RLS, grants

New owned table(s) for female health context, keyed to `auth.users`, with RLS on `auth.uid()`, column-level grants, and server-stamped timestamps. Decide (owner) whether the profile keeps effective-dated history or only current state; the design must support a per-report snapshot either way.

**Acceptance criteria**

- [ ] Migration applies cleanly in the harness from full history.
- [ ] RLS: user A cannot select, insert, update or delete user B's rows (harness fixture).
- [ ] Effective-privilege query shows anon has nothing; authenticated has only the intended columns.
- [ ] Enumerated columns use CHECK constraints or enums; free text is length-capped.

**Depends on:** V2-03e blockers closed (V2-03e-09, V2-03e-10)

**Risk / clinical safety:** Reproductive data (pregnancy, LMP, fertility) is highly sensitive. Retention and consent policy is an open owner question; do not ship to production before it is answered.

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
