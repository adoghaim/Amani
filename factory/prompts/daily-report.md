# Daily report ("Jarvis")

Read-only. Inputs: `factory/status.json` (required), open PRs and CI results (if available), `brain/open-questions.md` (if available). Do not take any action; produce a report for Mohammed.

Format (plain English, short):

1. **Shipped since last report** — packets moved to `done`, with PR links. Note any merged-but-not-deployed backend changes.
2. **In progress / in review** — packet, PR, CI state, what is waiting on whom.
3. **Blocked** — packet and reason; say exactly what decision or input unblocks it.
4. **Needs your approval today** — PRs ready to merge, deploys waiting for GO.
5. **Next suggested** — from `report.next_suggested`, highest in build order first, noting which can run in parallel.
6. **Open questions** — the top `[Pending]` items, unchanged.
7. **Growth / marketing suggestions** — from `report.growth_suggestions` plus at most two new ideas tied to what just shipped. Every suggestion must follow the clinical-language rules (no diagnosis, no prescriptive claims, no unsourced statistics).

`factory/scripts/report.mjs` produces sections 1–5 deterministically; add 6–7 by hand or by agent.
