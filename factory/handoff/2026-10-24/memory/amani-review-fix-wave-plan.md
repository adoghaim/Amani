---
name: amani-review-fix-wave-plan
description: "Review-fix wave 1 (phase RV) for Amani — all code packets are open PRs #157–#176 as of 2026-10-24; DB1–DB3 blocked on Docker; what is left and how to resume"
metadata:
  node_type: memory
  type: project
  originSessionId: 2048ad66-9c99-4989-a05c-97d6d9e03a48
  modified: 2026-10-24T11:03:44.636Z
---

Wave 1 fixes findings from the 2026-10-23 full review of main@22027b2. State of record is the factory ledger (`factory/status.json` / `factory/STATUS.md`): each landing PR updates its own RV-* entry.

As of 2026-10-24 ~06:10 EDT:
- **Merged:** #154 graphify, #155 status, #156 RV-IA1.
- **Open, gated, waiting for owner merge (20):** #157–#176. Stacks: #162 → #152's branch (merge into #152 first); #175 → #174; #176 (PX1, inclusive comparators, annotate-only) → #172. #160 merges with/after #173 and #171. #176's goal (Quest eGFR `> OR = 60` withheld) needs #175 too.
- **Not started:** DB1–DB3 (db-security), blocked: Docker Desktop stuck on its error dialog; `docker version` hangs (check with a 15 s bound — an empty server version means down). Owner was freeing disk (95% full) and restarting Docker on 2026-10-24 ~07:00 EDT.
- **`supabase db push` fails (2026-10-24):** production holds `20261022180000_partner_code_counts.sql` (service_role-only reporting view), applied 2026-10-22 from the owner's unpushed local branch `feat/partner-code-counts` (b60fe06). `supabase migration list`: every main migration is applied; that one is remote-only, so there is nothing to push. Fix = packet PC1: branch `factory/rv-partner-code-counts` (1953a29 = origin/main + cherry-pick, file byte-identical) + harness case; never `migration repair --status reverted`. Brief: `$S/briefs-foreman/PC1.md`.
- **Relaunch when Docker answers:** `Workflow({scriptPath: "$S/workflows/db-pc.js", args: <same args as run wf_fd9dc78f-521 in .foreman/ledger.md>})`: two tracks, db-security (DB1 fix-first from b03f619 using DB1.candidate.json blocking findings, then DB2, DB3) and partner-codes (PC1), opus builders + blind opus verifiers. The run wf_fd9dc78f-521 BLOCKED at the docker precheck with no changes; the precheck is now bounded to 15 s. Then land each via `$S/bin/land-queue` / `land-push` as before. (`$S` = this session's scratchpad; if the session id changes, the scratchpad scripts may be gone — rebuild from the ledger.)
- No PR has a migration. Edge-function deploys after merge: generate-interpretation (#159, #161, #162 with #152), verify-iap-purchase + iap-webhook (#164), parse-lab-report-ocr + extract-biomarkers (#165, #167), lab-insights (#167, #175), extract-biomarkers (#175), Stripe four (#168).
- Every PR got full local gates + the CI e2e matrix (3 browsers, 2 workers, no retries); GitHub Actions don't start (billing), so PR CI checks are not real results.
- Overlapping PRs: whoever merges second re-merges main and reruns gates + e2e.

**Why:** owner asked to "Push up the prs, make sure the smoke tests and end to end test are working properly" and to "fan out more agents ... around 7".

**How to apply when resuming:**
- Reconcile: `gh pr list`, `.foreman/ledger.md` in the main checkout (gitignored, UTC times), and the scratchpad scripts `$S/bin/{land-prep,land-queue,land-push,gates-text,e2e-matrix,e2e-one}` (second e2e slot = port 4273 rewrite, run-only).
- Owner decisions still open: Docker for the DB track; device QA (PDF on iOS 15–17 — probable live pdf.js `for await` bug on iOS < 27); clinical countersign of the 8 unit equivalences (#174) and critical-flag copy/markers (#161, incl. the `CRIT` = hematocrit ambiguity); Stripe one-subscription setting before #168 deploys; symptoms-to-OpenAI on the generate-interpretation redeploy (#161); Supabase Auth confirm-email + min length 8 (#166); full dev `npm audit` (24 pre-existing); Actions billing.
- Merges, deploys, `supabase db push`/`functions deploy` all need owner GO.

Related: [[ruling-7-true-floor-pr152]].
