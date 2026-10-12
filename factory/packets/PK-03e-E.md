---
packet: PK-03e-E
title: "Account deletion deadlock fix"
phase: V2-03e
wave: A
tickets: [V2-03e-09]
depends_on: []
status: todo
gates: [G0, G3, G5]
branch: factory/pk-03e-e
pr: null
updated: 2026-10-11
---

# PK-03e-E — Account deletion deadlock fix

Phase **V2-03e**, wave **A** (may run in parallel with other wave-A packets of this phase once dependencies are merged).

## Before you start

1. Read `AGENTS.md`, `CLAUDE.md`, `NUTRIENT_GUIDELINES.md` and `factory/gates.md`. If you have Second Brain access, load it via `80 Skills/Load Project Context.md`; live repo evidence overrides it.
2. Confirm every packet in `depends_on` is `done` in `factory/status.json`. If not, stop and set this packet to `blocked` with the reason.
3. Search the repo for existing work on these tickets (the feature list may be ahead of or behind the code). Report what already exists in the PR description.
4. Branch from `main` as `factory/pk-03e-e`. One PR. Do not merge, deploy, `supabase db push` or `supabase functions deploy`.

## Tickets in this packet

### V2-03e-09 — Account erasure / deletion reliability fix (pre-production blocker)

Account deletion can deadlock when a user has several reports. Reproduce it, then make the delete deterministic: one ordered server-side path (ideally a single SQL function with a fixed lock order) that also respects the immutability and overwrite-protection triggers (for example `ON DELETE SET NULL` being an UPDATE).

**Acceptance criteria**

- [ ] Harness reproduces the deadlock before the fix (failing fixture) and passes after it with a multi-report user (at least 5 reports, claims and interpretation versions).
- [ ] Concurrent delete + regenerate on the same user does not deadlock (or fails cleanly and retries).
- [ ] `_shared/account-deletion.ts` tests still pass; deletion still cancels Stripe, deletes the Stripe customer and the Auth identity, and propagates errors.
- [ ] Every PHI table, including any new V2 tables, is swept (test lists them).

**Depends on:** none

**Risk / clinical safety:** Store-review and privacy blocker (in-app deletion must work). Deletion must never report success when rows remain.

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
