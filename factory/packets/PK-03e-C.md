---
packet: PK-03e-C
title: "Remediation customer UI: state, CTA, failure/retry"
phase: V2-03e
wave: B
tickets: [V2-03e-05, V2-03e-06, V2-03e-07]
depends_on: [PK-03e-A]
status: in-progress
gates: [G0, G3, G4, G5]
branch: factory/pk-03e-c
pr: null
updated: 2026-10-11
---

# PK-03e-C — Remediation customer UI: state, CTA, failure/retry

Phase **V2-03e**, wave **B** (may run in parallel with other wave-B packets of this phase once dependencies are merged).

## Before you start

1. Read `AGENTS.md`, `CLAUDE.md`, `NUTRIENT_GUIDELINES.md` and `factory/gates.md`. If you have Second Brain access, load it via `80 Skills/Load Project Context.md`; live repo evidence overrides it.
2. Confirm every packet in `depends_on` is `done` in `factory/status.json`. If not, stop and set this packet to `blocked` with the reason.
3. Search the repo for existing work on these tickets (the feature list may be ahead of or behind the code). Report what already exists in the PR description.
4. Branch from `main` as `factory/pk-03e-c`. One PR. Do not merge, deploy, `supabase db push` or `supabase functions deploy`.

## Tickets in this packet

### V2-03e-05 — Legacy remediation customer state (UI)

Clear in-app state explaining that the earlier interpretation is no longer displayed under current safeguards, without implying it was wrong or unsafe, and without showing the quarantined text.

**Acceptance criteria**

- [ ] Component test: quarantined legacy report renders the explanation state, never the legacy prose.
- [ ] Copy passes the client clinical-language policy (no evaluative claims about the old interpretation).
- [ ] Screenshots for web, iOS-size and Android-size viewports attached to the PR.

**Depends on:** V2-03e-01 response contract

**Risk / clinical safety:** Wording risk: must not alarm users or suggest the earlier content was medically dangerous. Owner approves final copy.

### V2-03e-06 — "Regenerate interpretation" CTA

Call to action shown only to eligible legacy users that starts the $0 remediation. Ineligible users see the normal path (upgrade or standard regeneration).

**Acceptance criteria**

- [ ] CTA visible only when the server says eligible (client never decides eligibility).
- [ ] Double-click/retry sends the same request identity (idempotent).
- [ ] Loading, success and error states covered by component tests.

**Depends on:** V2-03e-02, V2-03e-03

**Risk / clinical safety:** Do not let the client show the CTA from local guesses; that leaks the eligibility model and confuses support.

### V2-03e-07 — Remediation failure and retry state

If regeneration fails, no version is created, nothing is consumed, and the user can retry. Error copy is honest and non-technical.

**Acceptance criteria**

- [ ] Test: injected model/DB failure leaves version count, claim ledger and counter unchanged.
- [ ] Retry after failure succeeds and produces exactly one version.
- [ ] Retryable 503 and 429 responses map to the retry state, not to "upload failed".

**Depends on:** V2-03e-01

**Risk / clinical safety:** Partial commits are the main risk; the write must be one transaction (single Postgres function), per the existing atomic-commit contract.

## Required tests and evidence

Standard criteria that apply (from the backlog):

- [ ] Clinical-authority rules hold: no new evaluative wording (better/worse/optimal/normal) without an authority source; AI prose that cannot be mapped to an authorized fact is suppressed; Basic tier gains no new content; locked counts count only authorized withheld content.
- [ ] G0 core gates green: `npm run lint`, `npm run typecheck`, `npm run validate:contrast`, `npm test`, `npm run build`, `npm run check:functions` (no new baseline exclusions).
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
