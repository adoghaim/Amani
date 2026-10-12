---
description: Run one Amani software-factory work packet end to end (build, test, review, PR)
argument-hint: <packet-id, e.g. PK-03e-E> (blank = next ready packet)
---

You are running the Amani software factory for packet: $ARGUMENTS

1. Read `AGENTS.md`, `CLAUDE.md`, `factory/README.md`, `factory/gates.md` and `factory/prompts/_shared-rules.md`.
2. If no packet id was given, pick the first packet in `factory/status.json` whose state is `todo` and whose dependencies are all `done`, and say which one you picked.
3. Read `factory/packets/<id>.md`. Create a branch `factory/<id>-<short-slug>` from an up-to-date `main`.
4. Act as the builder (`factory/prompts/builder.md`): implement the packet's scope only.
5. Act as the tester (`factory/prompts/tester.md`): add or extend tests so every acceptance criterion is proven, then run the gates that apply (lint, typecheck, test, build, check:functions, e2e, native builds, SQL checks). Fix failures; do not weaken tests.
6. Act as the reviewer (`factory/prompts/reviewer.md`): review the diff against the clinical-authority rules and acceptance criteria. Loop back to step 4 if anything fails.
7. Update `factory/status.json` and `factory/STATUS.md` for this packet, and draft a brain update with `factory/templates/brain-update.md` (do not write into the Second-Brain vault).
8. Commit, push the branch, and open a pull request using `factory/templates/pr-body.md`. Never merge: Mohammed approves every merge. Never run `supabase db push` or `supabase functions deploy` against production.

Finish with a short summary: packet, branch, PR link, gates passed, anything blocked.
