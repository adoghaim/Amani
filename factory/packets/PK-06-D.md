---
packet: PK-06-D
title: "Biomarker series + personal baseline"
phase: V2-06
wave: B
tickets: [V2-06-06, V2-06-07]
depends_on: [PK-06-A, PK-05-B]
status: todo
gates: [G0, G4, G5]
branch: factory/pk-06-d
pr: null
updated: 2026-10-11
---

# PK-06-D — Biomarker series + personal baseline

Phase **V2-06**, wave **B** (may run in parallel with other wave-B packets of this phase once dependencies are merged).

## Before you start

1. Read `AGENTS.md`, `CLAUDE.md`, `NUTRIENT_GUIDELINES.md` and `factory/gates.md`. If you have Second Brain access, load it via `80 Skills/Load Project Context.md`; live repo evidence overrides it.
2. Confirm every packet in `depends_on` is `done` in `factory/status.json`. If not, stop and set this packet to `blocked` with the reason.
3. Search the repo for existing work on these tickets (the feature list may be ahead of or behind the code). Report what already exists in the PR description.
4. Branch from `main` as `factory/pk-06-d`. One PR. Do not merge, deploy, `supabase db push` or `supabase functions deploy`.

## Tickets in this packet

### V2-06-06 — Historical biomarker series

Per-canonical-slug, unit-normalized series across all of the user's reports (from `biomarkers` / `report_analytes`), with lab reference ranges preserved separately from catalog ranges.

**Acceptance criteria**

- [ ] Tests: series ordered by draw date; unit mismatches excluded or converted only with approved factors; patient-lab ranges preserved.
- [ ] Regression test for the TPO history case in `docs/tpo-history-audit.sql` (alias resolution).

**Depends on:** V2-06-01, V2-05-03

**Risk / clinical safety:** Mis-merged series produce false trends.

### V2-06-07 — Personal baseline

Compute a personal baseline per analyte when there are enough comparable points (rule owned by the owner/clinical reviewer), with explicit "not enough data" otherwise.

**Acceptance criteria**

- [ ] Tests: minimum-points rule; outlier handling documented; baseline never replaces lab or catalog ranges in safety decisions.

**Depends on:** V2-06-06

**Risk / clinical safety:** A personal baseline is not a clinical range. Language about it needs authority.

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
