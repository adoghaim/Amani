# RS1 — Dark critical-flag notice from the lab's own flags; report context keeps her symptoms

- Track: **report-safety** · branch `factory/rv-report-safety` (already created at origin/main 22027b2; packets on a track run in order and build on each other)
- Reserved migration range: 20261023130000-20261023134999
- Harness: do NOT run `gates harness` (db-security owns the lock this wave)
- Review lenses after you: clinical authority (G4), correctness + tests
- Files this packet owns (others may touch nearby code concurrently): src/lib/safety/* (new); src/lib/scoring/insightCopy.ts (SAFETY_RULES only); src/pages/ReportView.tsx (notice); supabase/functions/_shared/schemas/context.ts; runtime-config flag registry
- Findings: F014, F018

## Decisions already made for you (follow them; deviations need evidence in your result)

1. F014 interim only — NOT the PK-05-B engine (that needs approved thresholds; PK-05-A is blocked). Read factory/packets/PK-05-B.md and do not mark it done. Build a pure, deterministic module that recognizes only the lab's own explicit critical/panic markers (find how the parser captures printed lab flags; e.g. 'HH', 'LL', 'CRIT', 'critical', 'panic', 'alert' — never ordinary H/L), with a rule id and version for audit, table-driven tests and a determinism test.
2. Render a deterministic notice in every tier that model output cannot remove, worded along the lines of: 'Your lab marked this result as critical. Contact your clinician promptly. If you feel unwell, call your local emergency number.' No diagnosis or advice beyond that. Ship it DARK behind a new runtime-config feature flag that defaults off, using the repo's flag process (docs/runtime-config.md, tools/ci/feature-flags-lint.mjs). The copy and the flag flip need clinical/owner GO → owner_actions. Put the copy through the clinical language-policy checks.
3. insightCopy.ts: PR #152 edits ~175 and ~735; SAFETY_RULES is ~1091. ReportView.tsx: PR #152 adds lines near ~1636 — place the notice away from that hunk.
4. F018: in _shared/schemas/context.ts accept 'unsure' (mapped to undefined) and validate fields independently so one bad field cannot drop her symptoms; add a contract test that feeds NewReport's literal context object through the schema. The deployed generate-interpretation picks this up from _shared → functions_to_deploy.

## Findings (verbatim from the 2026-10-23 review of main@22027b2; line numbers refer to that commit)

### F014 — No critical-value or urgent-care pathway exists anywhere (PK-05-B)

- Location: `src/lib/scoring/insightCopy.ts:1091` · severity high · category missing · owner_action=True

**Evidence**

SAFETY_RULES is Object.freeze([]) (insightCopy.ts:1091), and the comment at 1072-1082 states that Amani has no deterministic safety or critical-value rule. <SafetyWarnings> (ReportView.tsx:1582) therefore always renders nothing. The server ranks results by deviation only and says so (generate-interpretation/index.ts:183-186). Its safety_alert claims only gate projection and carry no user-facing text (claim-authority.ts:66-75). extract-biomarkers' sanity checks only lower confidence (extract-biomarkers/index.ts:627-645). The prompt says 'Do not create urgency unless clearly warranted' (index.ts:1136). Current clients render model prose only as authorized movement phrases, so even a model-written urgency line cannot reach the page. Emergency wording exists only on Terms/Contact and inside the feature-flagged report-a-problem flow (src/features/report/problem/problemReport.ts:36). factory/STATUS.md lists PK-05-B as todo and PK-05-A as blocked on a clinical reviewer [Pending]. Verified by code reading and grep for panic/critical/urgent/emergency across src and supabase/functions.

**Recommendation**

Build PK-05-B before launch. An interim that needs no Amani thresholds: route the lab's own printed critical/panic flags (the parser already captures printed lab flags) through the safety channel with a deterministic 'contact your clinician promptly / call your local emergency number' notice that shows in every tier. Analyte thresholds need the clinical reviewer.

**Verifier's note**

Verified. SAFETY_RULES = Object.freeze([]) (insightCopy.ts:1091), and the comment at 1072-1082 states that no deterministic safety or critical-value rule exists, so <SafetyWarnings> (ReportView.tsx:1582) is always empty. grep for panic/critical/urgent/emergency/911 across src and supabase/functions finds only Terms/Contact copy, problemReport.ts:36 and code comments. extract-biomarkers applySanityChecks only sets confidence and needs_review (627-645). Printed lab flags are limited to H/L/HH/LL/A/High/Low and shown in neutral ink with no urgency copy (resultRow.ts:107). STATUS.md lists PK-05-B as todo and PK-05-A as blocked on the [Pending] clinical reviewer. This is a legitimate missing pre-launch safety pathway, and the interim of routing printed lab critical flags needs no Amani thresholds.

### F018 — Every upload's report context fails the server schema, so her symptoms are dropped

- Location: `supabase/functions/_shared/schemas/context.ts:10` · severity low · category data-flow · owner_action=False

**Evidence**

NewReport hard-codes birth_control, pregnant and postpartum as 'unsure' (NewReport.tsx:160-162) and writes them alongside her selected top_symptoms (579-585). LabReportContextSchema accepts only 'yes' | 'no' for those fields (context.ts:9-11). safeParse therefore fails, and sanitizeReportContext returns undefined (generate-interpretation/index.ts:1289-1292). Verified with zod 3.25.76, the version the edge function pins (probe ctx.ts): the exact object NewReport writes fails all three enums, so report.context is undefined. As a result the 'Reported symptoms' note (index.ts:651-654) and every pregnant/postpartum/birth-control branch (627-657) never run. No test covers this schema (grep). The mismatch dates from 861ed5c (2026-04-29, client) and b5db3d5 (2026-05-01, schema).

**Recommendation**

Accept 'unsure' (mapped to undefined), and validate fields independently so one bad field cannot discard her symptoms. Add a contract test that feeds NewReport's literal context object through the schema.

**Verifier's note**

Verified with zod 3.25.76 on a copy of schemas/context.ts. NewReport's literal context {birth_control/pregnant/postpartum:'unsure', top_symptoms:[...]} fails with invalid_enum_value on all three fields, so sanitizeReportContext (index.ts:1289-1292) returns undefined and her symptoms are discarded. No test covers the schema, and the origin commits 861ed5c and b5db3d5 are confirmed. Downgraded to low: top_symptoms is read only by the server prompt and fallback note (grep), and current clients suppress both. The pregnant/postpartum/birth-control branches could never fire anyway, because the client hard-codes 'unsure'. The remaining user-facing effect is that the picker's 'helps personalize your insights' copy (NewReport.tsx:1399) is untrue.

