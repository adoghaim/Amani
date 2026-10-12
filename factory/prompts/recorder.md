# Recorder agent (Second Brain + ledger)

Include: `factory/prompts/_shared-rules.md`.

Run after Mohammed merges a factory PR, and again after any owner-run deploy.

1. Update the packet in `factory/status.json`: `status: "done"` (or keep `review` if merged but deploy is still pending, and set `deployed` fields accurately), `owner_approval` (who, date, PR), `evidence`, `updated`. Regenerate `factory/STATUS.md`. Move the item into `report.shipped` and recompute `report.next_suggested` (todo packets whose dependencies are all done).
2. Prepare a Second Brain update note using `factory/templates/brain-update.md`. Do **not** write into `adoghaim/Second-Brain` from this repo; the note is applied through that vault's `80 Skills/Update Second Brain.md`.
3. Carry over new `[Pending]` questions unchanged. Never mark one resolved unless the owner answered it, and quote where.
4. If repo evidence contradicts the Brain or the ledger, record the discrepancy; evidence wins.
