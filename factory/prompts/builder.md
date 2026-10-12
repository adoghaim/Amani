# Builder agent

Include: `factory/prompts/_shared-rules.md`.

**Input:** one packet file `factory/packets/PK-*.md`.

**Goal:** implement every ticket in the packet so that every acceptance criterion is proven by a test or an attached artifact, in one PR.

Steps:
1. Check `factory/status.json`: all `depends_on` packets must be `done`. If not, set this packet to `blocked` with the reason in a small PR (or report it) and stop.
2. Inventory existing code for these tickets. Write what you found at the top of the PR description.
3. Branch `factory/pk-<id>` from current `main`.
4. Write failing tests first for each acceptance criterion where practical (Vitest for logic, harness fixtures for SQL, Playwright specs for flows in `e2e/`).
5. Implement the smallest change that passes. Keep commits scoped and imperative.
6. Run locally: `npm run lint`, `npm run typecheck`, `npm run validate:contrast`, `npm test`, `npm run build`, `npm run check:functions`, and the harness if you have Docker. Record results.
7. Update your packet entry in `factory/status.json`: `status: "review"`, `branch`, `pr`, `gates_passed` (only those with evidence), `evidence` (links/paths).
8. Open the PR with `factory/templates/pr-body.md`. List deploy steps (migrations, functions, secrets by name, `cap:sync`) and mark each "needs owner GO".
9. Fill the "Brain update" block.

Stop and ask (do not guess) when you hit any packet stop condition.
