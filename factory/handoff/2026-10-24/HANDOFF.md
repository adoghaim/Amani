# Wave-1 handoff — 2026-10-24 (moving to a new computer)

Everything from the review-fix wave 1 (2026-10-23 review of `main@22027b2`) that lived only on the old machine is in this folder. **This branch is a handoff bundle, not a feature: never merge it into `main`.**

## State of the work
- **Merged earlier:** #154 graphify, #155 status, #156 RV-IA1.
- **Stacked PRs merged into their bases today** (with owner approval, "merge what you can together"): #162 → #152's branch (`285910c`), #175 → #174's branch (`d8aeac9`), #176 → #172's branch (`5a2a348`).
- **Open PRs into `main`, all gated:** #152 (incl. #162), #157–#161, #163–#174 (#172 incl. #176, #174 incl. #175), #177 (PC1).
- **PC1 = #177**: lands the production-applied `20261022180000_partner_code_counts.sql` byte-identical. This is what makes `supabase db push` work again. Its e2e run hit a full disk (ENOSPC) — rerun the default suite in Firefox and freemium in Chromium. **Never run `supabase migration repair --status reverted 20261022180000`.**
- **DB1–DB3 (db-security), not a PR:** branch `factory/rv-db-security` at `78fda44` (WIP). DB1 fix round 2 was cut off by Docker; staged findings for the next round are in `scratchpad/briefs-foreman/DB1.candidate.json` (`blocking_review_findings` = the blind verifier's round-1 MAJOR on anon storage UPDATE/DELETE probes + one MINOR; `resume_note`). DB2 and DB3 not built; briefs in `scratchpad/briefs-foreman/DB2.md`, `DB3.md`.
- **Integration (owner's choice: "Integration branch first", scope "All gated PRs"; DB1–DB3 out):** branch `factory/integration-wave1` at `be20038` = `origin/main` + #158, #173, #171 merged. Stopped before #160. Remaining order: #160, #159, #157, #163, #164, #166, #167, #168, #170, #169, #165, #152, #161, #172, #174, #177. Then a blind review of every conflict resolution (`git show --remerge-diff`), the full gates and the 3-browser e2e matrix on the combined tree, then one PR into `main` (GitHub marks each included PR merged). Script: `workflow-scripts/amani-wave1-integration-*.js` (args: the order list above; `main` = `25d09b7`).

## Owner actions still open (from the PR deploy notes)
Merges/deploys need explicit owner GO. Edge-function deploys after merge: generate-interpretation (#159, #161, #152/#162), verify-iap-purchase + iap-webhook (#164), parse-lab-report-ocr + extract-biomarkers (#165, #167), lab-insights (#167, #175), extract-biomarkers (#175), the four Stripe functions (#168, after turning on Stripe "limit customers to one subscription"). No PR adds a migration. Supabase Auth confirm-email + min length 8 (#166); Netlify Node 22 via `.nvmrc` (#173), `VITE_GA4_ID` per context (#169); clinical countersign of the 8 unit equivalences (#174) and of the critical-flag copy/markers (#161); device QA (PDF iOS 15–17, device lock, recovery links); GitHub Actions billing; 24 pre-existing dev `npm audit` findings.

## Contents
- `ledger.md` — the foreman ledger (append-only log of every dispatch and decision; UTC times). On the new machine copy it to `.foreman/ledger.md` (gitignored).
- `memory/` — Claude Code project memory. Copy to `~/.claude/projects/<sanitized new repo path>/memory/`.
- `scratchpad/bin/` — gate and landing scripts (`gates`, `with-lock`, `wt-setup`, `env.sh`, `land-prep`, `land-queue`, `land-push`, `gates-text`, `e2e-matrix`, `e2e-one`). They hardcode the old scratch path `/private/tmp/claude-501/-Users-mawad-Desktop-Amani/2048ad66-9c99-4989-a05c-97d6d9e03a48/scratchpad` and `AMANI_MAIN=/Users/mawad/Desktop/Amani`; on the new machine copy `scratchpad/` to a scratch dir and rewrite both, e.g. `grep -rl 2048ad66 . | xargs sed -i '' "s#<old>#<new>#g"`, and fix the Node path in `env.sh`. `ledger-entry.py` was lost in the reboot (needed only by `land-push` with packet ids).
- `scratchpad/briefs/` (`_protocol.md`, `_review-protocol.md`) and `scratchpad/briefs-foreman/` (packet briefs incl. DB1–DB3, PC1, `tracks.json`, `DB1.candidate.json`).
- `scratchpad/workflows/db-pc.js` — the db-security / PC1 workflow (args in `ledger.md`). `workflow-scripts/` — every workflow script of this phase.
- `scratchpad/pr/` — PR bodies (`pc1.md`).

## Machine notes
The old Mac ran out of disk (Docker's VM disk ~25 GB real); Docker hung twice. The harness (`gates harness`) needs Docker with real free space; the e2e matrix needs a few GB.
