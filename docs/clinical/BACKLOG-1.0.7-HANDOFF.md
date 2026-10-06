# Product question for specs/BACKLOG-1.0.7.md

Prepared within TASK-042's allowed paths; the requested `specs/` path is outside
those paths and does not exist in this worktree. Lead action: transfer this entry
into the product backlog. This file does not resolve the design question.

Should reproductive hormones be scored or classified without a cycle phase, or
should the app suppress that output until phase context is available?

Five shipping fallback bands contradict their own phase-specific bands: LH
amani_context; estradiol amani_context and lab_reference; FSH amani_context and
lab_reference. The entire catalog LH ovulatory band lies above its fallback.
`getRangesForPhase` selects the fallback when phase is absent, and both
`scoreBiomarker` and `compareReports` consume it. See CF-09 in
[AUDIT-CARRY-FORWARD.md](AUDIT-CARRY-FORWARD.md) for exact bands and the verbatim
Lead exposure snapshot: latent, zero stored-report exposure at that snapshot,
not a 1.0.6 incident. This implementer did not query production.

Owner decision and assay/phase evidence are required before choosing behavior.
No endpoint or runtime behavior changed. D-001 release isolation remains binding
until 1.0.6 Phase A passes; production requires separate GO.

Lead reports transfer complete: this entry is recorded as item 10 in `specs/BACKLOG-1.0.7.md`, including the exposure snapshot and product question.
