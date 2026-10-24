---
name: ruling-7-true-floor-pr152
description: "Owner decision 2026-10-23 — PR #152's lab-flag ranking must be a true floor, not a ceiling; how #152 lands"
metadata:
  node_type: memory
  type: project
  originSessionId: 2048ad66-9c99-4989-a05c-97d6d9e03a48
  modified: 2026-10-23T18:25:18.256Z
---

Mohammed (repo owner, merge owner) decided on 2026-10-23 that Owner Ruling 7's lab-flag rule is a **true floor**: lab-only flags (value outside the lab's printed range, no Amani flag) stay visible in the headline, top findings and focus areas, but rank after every Amani-flagged result, and a lab-only flag becomes the Primary finding only when nothing on the report is Amani-flagged. adoghaim's PR #152 (head f5ff442) implemented a ceiling instead (any lab flag takes the Primary slot, even over cycle/pregnancy-withheld markers), which an independent G4 review failed.

**Why:** the ceiling let e.g. HDL 61 (lab 40–60) displace a ferritin 17 Amani flag, and LH 30 (ovulatory surge, no phase) become primary; it was outside the options recorded in docs/factory/lab-flag-floor-decision.md, and the October fix did not need it.

**How to apply:** fix #152 on a new branch stacked on #152 (never push to adoghaim's branch): true-floor ranking in src/lib/insights/buildInsightSummary.ts (~543, ~694) and buildFocusAreas.ts (~282-300); add the handler tests the correctness review asked for (HTTP bodies carry fallback_reason on 200 fallbacks and model_failure on 200/503); restore DISPUTED/Amani-band Primary-finding browser assertions; re-review, then land #152 + fix before the generate-interpretation fixes stacked on it. Deploy generate-interpretation before or with the web merge (owner GO). No amendment to the decision doc is needed — the floor is what it already records. Related: [[amani-review-fix-wave-plan]].
