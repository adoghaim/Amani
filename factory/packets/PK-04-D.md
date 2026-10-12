---
packet: PK-04-D
title: "Pregnancy + postpartum fields"
phase: V2-04
wave: C
tickets: [V2-04-05, V2-04-06]
depends_on: [PK-04-B]
status: todo
gates: [G0, G4, G5]
branch: factory/pk-04-d
pr: null
updated: 2026-10-11
---

# PK-04-D — Pregnancy + postpartum fields

Phase **V2-04**, wave **C** (may run in parallel with other wave-C packets of this phase once dependencies are merged).

## Before you start

1. Read `AGENTS.md`, `CLAUDE.md`, `NUTRIENT_GUIDELINES.md` and `factory/gates.md`. If you have Second Brain access, load it via `80 Skills/Load Project Context.md`; live repo evidence overrides it.
2. Confirm every packet in `depends_on` is `done` in `factory/status.json`. If not, stop and set this packet to `blocked` with the reason.
3. Search the repo for existing work on these tickets (the feature list may be ahead of or behind the code). Report what already exists in the PR description.
4. Branch from `main` as `factory/pk-04-d`. One PR. Do not merge, deploy, `supabase db push` or `supabase functions deploy`.

## Tickets in this packet

### V2-04-05 — Pregnancy state and gestational age

Pregnancy state plus gestational age (weeks) or a date it can be derived from, with trimester derivation. Pregnancy context is required input for V2-05 pregnancy red flags.

**Acceptance criteria**

- [ ] Tests: gestational age bounds; trimester derivation; stale pregnancy state (past plausible term) is flagged for user confirmation, not silently assumed.
- [ ] Non-pregnant ranges are not applied as authoritative when pregnancy is set and no pregnancy range is approved (analyte goes NEEDS_CONTEXT).
- [ ] Pregnancy data is included in the deletion sweep.

**Depends on:** V2-04-01, V2-04-02

**Risk / clinical safety:** High clinical stakes. No pregnancy-specific interpretation without approved ranges/rules. Sensitive data under state health-privacy laws.

### V2-04-06 — Postpartum state, months postpartum, breastfeeding

Postpartum flag with months postpartum (derived from delivery date where given) and breastfeeding status.

**Acceptance criteria**

- [ ] Tests: months-postpartum derivation and bounds; breastfeeding only valid with plausible stage combinations (warn, do not block).
- [ ] Existing onboarding `postpartum` context maps into the new fields without loss (see V2-04-10).

**Depends on:** V2-04-01, V2-04-02

**Risk / clinical safety:** Same authority rule: postpartum-specific statements need approved sources.

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
