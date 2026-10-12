---
packet: PK-04-B
title: "Female context API + validation"
phase: V2-04
wave: B
tickets: [V2-04-02]
depends_on: [PK-04-A]
status: todo
gates: [G0, G5]
branch: factory/pk-04-b
pr: null
updated: 2026-10-11
---

# PK-04-B — Female context API + validation

Phase **V2-04**, wave **B** (may run in parallel with other wave-B packets of this phase once dependencies are merged).

## Before you start

1. Read `AGENTS.md`, `CLAUDE.md`, `NUTRIENT_GUIDELINES.md` and `factory/gates.md`. If you have Second Brain access, load it via `80 Skills/Load Project Context.md`; live repo evidence overrides it.
2. Confirm every packet in `depends_on` is `done` in `factory/status.json`. If not, stop and set this packet to `blocked` with the reason.
3. Search the repo for existing work on these tickets (the feature list may be ahead of or behind the code). Report what already exists in the PR description.
4. Branch from `main` as `factory/pk-04-b`. One PR. Do not merge, deploy, `supabase db push` or `supabase functions deploy`.

## Tickets in this packet

### V2-04-02 — Female context API and validation

Read/write path for the profile with a Zod schema in `_shared/schemas/`, server-side sanitization (same approach as `sanitizeReportContext`), and a typed client hook. Unknown keys are stripped, values bounded.

**Acceptance criteria**

- [ ] Zod schema tests: valid inputs accepted, out-of-range and unknown keys rejected or stripped.
- [ ] Prompt-injection test: free-text fields cannot reach the model unbounded.
- [ ] Client hook handles 401/403/429/503 states.

**Depends on:** V2-04-01

**Risk / clinical safety:** This data feeds the model prompt. Treat every field as untrusted input.

## Required tests and evidence

Standard criteria that apply (from the backlog):

- [ ] G0 core gates green: `npm run lint`, `npm run typecheck`, `npm run validate:contrast`, `npm test`, `npm run build`, `npm run check:functions` (no new baseline exclusions).

Gates to pass (see `factory/gates.md`): **G0, G5**.

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
