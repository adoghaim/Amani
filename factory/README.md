# Amani software factory

This folder is how AI agents build Amani under owner control. Agents do the build work. **Mohammed approves every merge.** Nothing is deployed, pushed to the database, or released without a separate explicit owner GO.

> Status: draft. Items marked **to-verify** depend on repo details we could not see (for example the full `.github` folder, Playwright config, test Supabase project). Check them on first commit.

## The loop

```
backlog ticket ─► work packet (factory/packets/PK-*.md)
      │
      ▼
builder agent ── branch factory/pk-<id> ── one PR ──► CI gates (factory/gates.md)
      │                                                 │
      ▼                                                 ▼
tester agent adds/extends e2e + native proof     reviewer agent (adversarial)
      │                                                 │
      └──────────────► Mohammed reviews ◄───────────────┘
                              │ approve + merge (G5)
                              ▼
          owner GO for any Supabase migration / function deploy (manual)
                              │
                              ▼
       post-deploy checks (privileges, ENABLE ALWAYS triggers, probes)
                              │
                              ▼
     recorder agent prepares Second Brain update + updates status.json
```

## Files

| Path | What it is |
|---|---|
| `factory/packets/` | One spec per PR-sized packet: tickets, acceptance criteria, required tests, stop conditions. |
| `factory/status.json` | Machine-readable ledger of packet state. The record. The daily ("Jarvis") report reads it. |
| `factory/STATUS.md` | Human view of the ledger. |
| `factory/gates.md` | Definition of done: G0–G5. |
| `factory/prompts/` | Role prompts: builder, tester, reviewer, recorder, daily report. |
| `factory/templates/` | PR body, feature-request intake, Brain-update note. |
| `factory/sql/` | Read-only verification queries (privileges, trigger mode). |
| `factory/scripts/report.mjs` | Prints the daily report from `status.json` (no network). |
| `factory/e2e/` | Where web e2e runs and what real-backend e2e would still need. |
| `.github/workflows/native-build.yml` | Android build on every PR to main (+ optional emulator smoke), iOS simulator build (opt-in, macOS cost). Web e2e is `e2e.yml`. |

## Rules every agent follows

These come from `AGENTS.md` and `CLAUDE.md` and override anything in a packet:

1. **Code agent proves, Second Brain records.** Agents never write into `adoghaim/Second-Brain`; they prepare an update note.
2. **Live repo and runtime evidence override the Brain and this folder.** If a packet says "in-progress" but the code says done (or missing), report the discrepancy.
3. **Never silently resolve a `[Pending]`.** Ask, record, move on.
4. **No secrets** in code, PRs, logs, packets or the Brain. Variable names only.
5. **Consequential actions need explicit owner approval**: merges, `supabase db push`, `supabase functions deploy`, store submissions, live Stripe keys, flags such as `FREEMIUM_ACTIVE`.
6. **Clinical authority**: no diagnosis, no prescriptive advice, no doses, no invented ranges or thresholds. Marketing copy follows the same rules. `_shared/nutrient-policy.ts` is the single source of nutrient policy.
7. **Guardrail suites never go red**: `_shared/nutrient-policy.test.ts`, `src/lib/scoring/scoreBiomarker.test.ts`.
8. Netlify is the web host. The red `Vercel` status check is expected noise, never a merge blocker.

## Running a packet

1. Pick a packet from `status.json → report.next_suggested` (dependencies done).
2. Start a cloud coding agent with `factory/prompts/builder.md` + the packet file.
3. Builder opens a PR with `factory/templates/pr-body.md` and sets the packet to `review` in `status.json` in the same PR.
4. Tester (`prompts/tester.md`) adds e2e/native evidence if the packet requires G1/G2. Reviewer (`prompts/reviewer.md`) posts an adversarial review.
5. Mohammed merges or requests changes. After merge, the recorder (`prompts/recorder.md`) sets `done` and writes the Brain note.
6. If the PR includes migrations or edge functions: they are **not live** until Mohammed (or Adell, if delegated) runs the deploy. Then run `factory/sql/*.sql` and record results as evidence.

## Parallel work

Packets in the same phase and wave can run at the same time. Avoid running two packets that edit the same migration sequence or the same edge function at once; if they must, the second rebases after the first merges. Migration timestamps must be unique and later than `main`'s newest.
