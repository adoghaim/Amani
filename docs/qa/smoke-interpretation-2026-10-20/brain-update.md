# Second Brain update report — Amani, 2026-10-20

Prepared in the code repository for the recorder. The vault was not modified or pulled:
its working tree contains owner/session edits, so its operational claims remain unverified.

## Verified this session

- **[Confirmed 2026-10-20]** The resumed fix branch starts from `96f636d`. Code inspection
  establishes that Free with one of three claims used is eligible for another draw, a
  fallback consumes no claim, and failed regeneration preserves history. The old production
  response pair does not identify its upstream cause. Sources: `introductory-access.ts`,
  `regeneration-availability.ts`, the generation handler and their fake-backed tests.
- **[Confirmed 2026-10-20]** This branch adds fixed fallback/refusal diagnostics and smoke
  reporting; it does not change tier policy, claim limits or draw identity. The actual
  handler calls `gpt-4o-mini`; `CLAUDE.md`'s older model description is stale.
- **[Confirmed 2026-10-20]** The synthetic smoke panel now leads with Vitamin D/LDL lab
  findings, explicitly shows ferritin/TSH within their supplied lab ranges, and names Vitamin D
  throughout the primary/story/first-upload model request. Neutral lab-only findings survive
  Amani withholding. Sources: `smokePanel.test.ts`, upload regression, and committed Playwright
  consistency/context-suppression tests and screenshots.
- **[Confirmed 2026-10-20]** Locally passed: lint, typecheck, contrast, 3,073 unit tests in
  158 files, production build with synthetic build variables, configured function typecheck,
  clinical catalog checks/57 node tests, pinned imports, offline release automation and the
  full disposable-Postgres migration rehearsal. All 186 selected Playwright tests passed across
  Chromium, WebKit and Firefox, and the env-isolation canary passed in a disposable staged-source
  checkout. See the adjacent report for the direct-handler baseline limitation.

## Implementation decisions (within the existing owner ruling)

- Apply Owner Ruling 7 to client finding/focus ranking: lab flags precede band-only results;
  lab-only findings may be primary, including when inside an Amani band. Preserve the
  previous primary within the lab-flagged set, otherwise use existing severity. No concern
  score, endpoint, claim-policy version or clinical authority was changed.
- Keep shipped status/error fields compatible and add `fallback_reason`/`reason` plus
  `model_failure`; do not claim that a deterministic fallback proves the AI deployment.

## Still unverified

- **[Pending]** Original production fallback cause and current secret/flag/provider state.
  Needs owner-run smoke after a separately approved function deploy; no production requests
  or configuration inspection were performed here.
- **[Pending]** Independent G4 review, owner merge/deploy approval, Netlify preview and CI
  results, clinical reviewer decisions on ferritin/TSH/Vitamin D comparison bands, native QA.
  No existing launch or clinical Pending is closed by this report.
- **[Pending]** The direct handler check still has four diagnostics also present at
  `96f636d`; its existing configured exclusion remains. New shared modules pass the ratchet.

## Deploy state and next actions

Nothing merged, deployed, synced to native projects, or released. No new migrations or
secret names. Owner reviews the PR and clinical questions first; after separate GO the
backend change needs `generate-interpretation` deployed and the web needs the usual Netlify
build. Then use a disposable Premium account and an eligible Free account to collect fresh
runtime evidence. The smoke deletes the account after write attempts.
