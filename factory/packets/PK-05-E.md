---
packet: PK-05-E
title: "Post-generation enforcement, safety pathway, audit"
phase: V2-05
wave: C
tickets: [V2-05-06, V2-05-07, V2-05-08]
depends_on: [PK-05-D]
status: todo
gates: [G0, G1, G3, G4, G5]
branch: factory/pk-05-e
pr: null
updated: 2026-10-11
---

# PK-05-E — Post-generation enforcement, safety pathway, audit

Phase **V2-05**, wave **C** (may run in parallel with other wave-C packets of this phase once dependencies are merged).

## Before you start

1. Read `AGENTS.md`, `CLAUDE.md`, `NUTRIENT_GUIDELINES.md` and `factory/gates.md`. If you have Second Brain access, load it via `80 Skills/Load Project Context.md`; live repo evidence overrides it.
2. Confirm every packet in `depends_on` is `done` in `factory/status.json`. If not, stop and set this packet to `blocked` with the reason.
3. Search the repo for existing work on these tickets (the feature list may be ahead of or behind the code). Report what already exists in the PR description.
4. Branch from `main` as `factory/pk-05-e`. One PR. Do not merge, deploy, `supabase db push` or `supabase functions deploy`.

## Tickets in this packet

### V2-05-06 — Post-generation safety enforcement

After generation, verify the model output did not remove, soften or contradict any deterministic finding. On conflict, drop the conflicting prose (or fall back) and keep the deterministic warning.

**Acceptance criteria**

- [ ] Tests with adversarial fixtures: model says "nothing to worry about" next to a critical finding → prose suppressed, warning kept.
- [ ] Validator runs alongside `validateInterpretationOutput`; `null` contract handled the same way.

**Depends on:** V2-05-05

**Risk / clinical safety:** The model is never the authority on safety.

### V2-05-07 — Dedicated safety-authority pathway in claims and UI

Add safety as its own claim category with its own authority, rendering component and copy rules. Safety warnings use calm, non-diagnostic language with a clear "contact a clinician" or emergency instruction as approved.

**Acceptance criteria**

- [ ] Claim-category tests: safety statements can only originate from the engine.
- [ ] UI renders safety findings first and in every tier; Playwright check in three browsers.
- [ ] Copy approved by owner; passes clinical-language policy.

**Depends on:** V2-05-05, V2-05-06

**Risk / clinical safety:** Wording must avoid diagnosis while still being clear about urgency.

### V2-05-08 — Safety audit trail and versioning

Persist each safety evaluation (rule ids and versions, inputs, outcome) with the interpretation version it belongs to, append-only.

**Acceptance criteria**

- [ ] Harness: safety records are immutable once written; deletion sweep removes them with the user.
- [ ] Changing a rule version does not rewrite past evaluations.

**Depends on:** V2-05-02, V2-03e-01

**Risk / clinical safety:** Needed to answer "why did Amani show this?" for support and review.

## Required tests and evidence

Standard criteria that apply (from the backlog):

- [ ] Clinical-authority rules hold: no new evaluative wording (better/worse/optimal/normal) without an authority source; AI prose that cannot be mapped to an authorized fact is suppressed; Basic tier gains no new content; locked counts count only authorized withheld content.
- [ ] G0 core gates green: `npm run lint`, `npm run typecheck`, `npm run validate:contrast`, `npm test`, `npm run build`, `npm run check:functions` (no new baseline exclusions).
- [ ] Medical guardrail suites stay green and unweakened: `supabase/functions/_shared/nutrient-policy.test.ts` and `src/lib/scoring/scoreBiomarker.test.ts`.
- [ ] Migration harness `supabase/migrations/__verification__/run.sh` passes with new fixtures for this change (RLS cross-user denial, column grants, trigger behaviour).
- [ ] Playwright proof of the user flow in Chromium, WebKit and Firefox against the Netlify preview or a local build.

Gates to pass (see `factory/gates.md`): **G0, G1, G3, G4, G5**.

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
