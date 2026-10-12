# Product question for specs/BACKLOG-1.0.7.md

Prepared within TASK-042's allowed paths; the requested `specs/` path is outside
those paths and does not exist in this worktree. The Lead confirms transfer to the product backlog in the turn-4 ruling;
this implementer did not verify the control-repository commit. This file does not resolve the design question.

Should reproductive hormones be scored or classified without a cycle phase, or
should the app suppress that output until phase context is available?

Eight shipping fallback bands have potential phase-masking hazards: both kinds
for LH, estradiol, FSH and progesterone. Five also exclude values included in phase
bands. Progesterone and LH reference can mask phase-abnormal values even when
the fallback equals the full union. All eight are P0 audit items; see CF-09. The entire catalog LH ovulatory band lies above its fallback.
`getRangesForPhase` selects the fallback when phase is absent, and both
`scoreBiomarker` and `compareReports` consume it. See CF-09 in
[AUDIT-CARRY-FORWARD.md](AUDIT-CARRY-FORWARD.md) for exact bands and the verbatim
Lead exposure snapshot: latent, zero stored-report exposure at that snapshot,
not a 1.0.6 incident. This implementer did not query production.

Owner decision and assay/phase evidence are required before choosing behavior.
No endpoint or runtime behavior changed. D-001 release isolation remains binding
until 1.0.6 Phase A passes; production requires separate GO.

Lead reports transfer complete: according to the Lead's turn-4 confirmation, this entry was committed as item 10 in `specs/BACKLOG-1.0.7.md`, including the exposure snapshot and product question.
