# Neutral lab-flag floor: the owner's answer (reconciled 2026-10-16)

Status: **answered.** This closes the question in `lab-flag-floor-question.md` (Factory packet PK-PL-B,
branch `factory/pk-pl-b-lab-flag-floor`, retired 2026-10-16 after this reconciliation). No ranking
behaviour changes in this document; it records the ruling that the implementing packet must follow.

## The ruling (Owner Ruling 7, 2026-10-12, verbatim)

> withheld-marker ranking accepted for this merge, **not** for public launch — add a neutral
> **lab-flag floor** to priority/ranking before launch (factual: "the laboratory flagged this result
> outside its supplied reference interval"; no clinical interpretation authority; *withhold unsupported
> interpretation, not the laboratory's observable flag*)

Source: `amani-agent-control/tasks/TASK-049-v2-release-candidate-gate/OWNER-RULINGS-7-V2-MAIN-GO.md`
(the five held items, item 1).

## What that answers

The ruling selects **reading A** of the question (client ranking floor), with the wording constraint
and the authority constraint fixed:

- **Where:** priority/ranking on the client. A result the laboratory flagged outside its supplied
  reference interval is never hidden or outranked by unflagged content, even when Amani withholds its
  own status (V2-03 withholding) or Amani's band contains the value.
- **Wording:** factual only. "The laboratory flagged this result outside its supplied reference
  interval" (or the equivalent above/below form). Never Amani band language, never a clinical judgement,
  no thresholds or margins of Amani's own: the laboratory's printed bounds decide.
- **Authority:** none beyond the observable flag. Amani withholds unsupported interpretation; it does
  not withhold the laboratory's own flag.
- **Not selected:** reading B (renaming the server's `safety_alert` claim vocabulary) is not part of
  this ruling. The server path keeps its claim schema; no claim-policy version bump is implied.

## Left to the implementing packet (within the constraints above)

The ruling fixes the floor and its wording, not the three sub-choices the question listed. The packet
that builds the floor decides them and records the choice in its turn doc:

- A1: lab-only results rank after every Amani-flagged result (a true floor) or alongside borderline.
- A2: whether a lab-only result can occupy the "Primary finding" slot; if it can, it needs a new
  neutral primary sentence (the current one asserts the Amani band and would be false).
- A3: whether the floor also covers markers whose Amani band contains the value but whose lab interval
  does not.

Guardrail suites stay as they are: `scoreBiomarker`'s concern does not change; the floor is applied
where ranked surfaces are built (`buildTopFindings`, `buildFocusAreas`) from `labIntervalPlacement`.

## Launch gate

This is a **before public launch** item (Ruling 7). It is not done. It remains on the launch list
until a packet lands it on `main` with tests and the Factory ledger marks it done.
