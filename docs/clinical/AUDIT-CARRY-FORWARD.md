## Explicit carry-forward audit entries

These entries supplement the 198 range rows; they are not extra ranges or clinical evidence. Internal records used: TASK-042 contract §§0–7; TASK-041 synthesis, amendment 2 A7/A8 and `DEFINITIONS-CONFLICTS-OBSERVED.txt`; checked-in `docs/clinical/CONFLICTS.md`. The control-directory records were read only. None is an external clinical source.

### CF-01 — P0 — Vitamin D, first known correction; public-claim blocker

Shipping `vitamin_d_25_oh`: **50–80 ng/mL amani_context / 30–100 ng/mL lab_reference**, unchanged. The suspect claims are that 50 is a defensible lower bound of an “optimal” target, that 80 is a defensible upper target, and that 30–100 represents a valid laboratory interval for the intended population/assay. These claims have no attributable clinical support in this seed. Such labels may encourage supplementation or false reassurance; this task does not establish replacement thresholds or declare a specific measured value abnormal. Owner ruling R1 routes the correction through the internal track and makes it a **P0 blocker for any public claim**.

Open question: which retrieved 25-OH assay interval document and attributable clinical guidance support or refute each of the four endpoints and both labels for the intended population? Required artifacts: reporting-lab assay identity/specimen/interval sheet, clinical guidance actually read by the reviewer, and a named human adjudication record. No substitution from legacy `vitamin_d` is authorized.

### CF-02 — P0 — Dormant magnesium is drift evidence, never a candidate

Shipping magnesium remains **1.8–2.4 context / 1.7–2.5 reference mg/dL**. The retired `biomarker_definitions` row records **5.2–6.5 optimal / 4.2–6.8 clinical mg/dL**. Per the binding Lead A8/contract hazard statement, **serum magnesium near the 5.2–6.5 mg/dL band would be severe hypermagnesemia**. This is an attributed internal hazard statement, not a clinical source retrieved in this task. The dormant numbers must never seed forward or become a candidate merely because they exist. They are not a unit-conversion alternative. No dormant range or candidate was added to the catalog.

Open question: what original assay/specimen record explains the retired row, and which serum magnesium lab interval supports the shipping band? Required artifacts: archived row plus original laboratory method/specimen/interval documentation and human adjudication. Investigating the origin does not authorize candidate selection.

### CF-03 — P1 minimum — All 15 reproductive-hormone conflicts remain open

Both historical candidates are visible below, transcribed from `CONFLICTS.md`. Reference = `biomarker_reference_ranges`; phase = `biomarker_phase_ranges`. Shipping equals the reference-table candidate. That is precedence, never clinical correctness. Each row is an explicit open item for both kinds (30 range rows now DISPUTED), even where one pair of endpoints agrees. Progesterone ovulatory has no conflict in the supplied 15-item inventory; its ranges still require review in the 198-row queue.

| Audit item | Phase | Reference optimal | Phase optimal | Reference clinical | Phase clinical | Specific question / required artifact |
|---|---|---|---|---|---|---|
| CF-03-estradiol-follicular | follicular | 30-250 | 30-200 | 20-400 | 12-300 | Which estradiol assay and collection-day definition support either follicular candidate for each kind? Obtain the originating method sheets and phase-specific population interval tables for both legacy tables, plus an attributable context-target rationale and human adjudication. |
| CF-03-estradiol-luteal | luteal | 50-300 | 60-200 | 30-500 | 12-250 | Which estradiol assay and collection-day definition support either luteal candidate for each kind? Obtain the originating method sheets and phase-specific population interval tables for both legacy tables, plus an attributable context-target rationale and human adjudication. |
| CF-03-estradiol-menstrual | menstrual | 20-80 | 20-80 | 10-200 | 12-100 | Which estradiol assay and collection-day definition support either menstrual candidate for each kind? Obtain the originating method sheets and phase-specific population interval tables for both legacy tables, plus an attributable context-target rationale and human adjudication. |
| CF-03-estradiol-ovulatory | ovulatory | 150-750 | 150-350 | 100-1000 | 100-500 | Which estradiol assay and collection-day definition support either ovulatory candidate for each kind? Obtain the originating method sheets and phase-specific population interval tables for both legacy tables, plus an attributable context-target rationale and human adjudication. |
| CF-03-fsh-follicular | follicular | 2-10 | 3-10 | 2-20 | 2-20 | Which fsh assay and collection-day definition support either follicular candidate for each kind? Obtain the originating method sheets and phase-specific population interval tables for both legacy tables, plus an attributable context-target rationale and human adjudication. |
| CF-03-fsh-luteal | luteal | 1-8 | 1-8 | 1-10 | 1-12 | Which fsh assay and collection-day definition support either luteal candidate for each kind? Obtain the originating method sheets and phase-specific population interval tables for both legacy tables, plus an attributable context-target rationale and human adjudication. |
| CF-03-fsh-menstrual | menstrual | 3-10 | 3-10 | 3-20 | 2-20 | Which fsh assay and collection-day definition support either menstrual candidate for each kind? Obtain the originating method sheets and phase-specific population interval tables for both legacy tables, plus an attributable context-target rationale and human adjudication. |
| CF-03-fsh-ovulatory | ovulatory | 2-15 | 6-20 | 2-30 | 5-30 | Which fsh assay and collection-day definition support either ovulatory candidate for each kind? Obtain the originating method sheets and phase-specific population interval tables for both legacy tables, plus an attributable context-target rationale and human adjudication. |
| CF-03-lh-follicular | follicular | 2-15 | 1-12 | 1-25 | 1-15 | Which lh assay and collection-day definition support either follicular candidate for each kind? Obtain the originating method sheets and phase-specific population interval tables for both legacy tables, plus an attributable context-target rationale and human adjudication. |
| CF-03-lh-luteal | luteal | 2-12 | 1-10 | 1-20 | 1-15 | Which lh assay and collection-day definition support either luteal candidate for each kind? Obtain the originating method sheets and phase-specific population interval tables for both legacy tables, plus an attributable context-target rationale and human adjudication. |
| CF-03-lh-menstrual | menstrual | 2-15 | 1-10 | 1-25 | 1-15 | Which lh assay and collection-day definition support either menstrual candidate for each kind? Obtain the originating method sheets and phase-specific population interval tables for both legacy tables, plus an attributable context-target rationale and human adjudication. |
| CF-03-lh-ovulatory | ovulatory | 20-80 | 15-70 | 15-100 | 10-100 | Which lh assay and collection-day definition support either ovulatory candidate for each kind? Obtain the originating method sheets and phase-specific population interval tables for both legacy tables, plus an attributable context-target rationale and human adjudication. |
| CF-03-progesterone-follicular | follicular | 0.1-0.9 | 0.1-1.0 | 0.1-1.5 | 0.1-1.5 | Which progesterone assay and collection-day definition support either follicular candidate for each kind? Obtain the originating method sheets and phase-specific population interval tables for both legacy tables, plus an attributable context-target rationale and human adjudication. |
| CF-03-progesterone-luteal | luteal | 5.0-25.0 | 5.0-20.0 | 3.0-30.0 | 2.0-25.0 | Which progesterone assay and collection-day definition support either luteal candidate for each kind? Obtain the originating method sheets and phase-specific population interval tables for both legacy tables, plus an attributable context-target rationale and human adjudication. |
| CF-03-progesterone-menstrual | menstrual | 0.1-0.9 | 0.1-0.9 | 0.1-1.5 | 0.1-1.0 | Which progesterone assay and collection-day definition support either menstrual candidate for each kind? Obtain the originating method sheets and phase-specific population interval tables for both legacy tables, plus an attributable context-target rationale and human adjudication. |

### CF-04 — P2 — RF and ANA extraction/product gap

`rheumatoid_factor` (0–14 IU/mL in both kinds) and `ana_screen` (null endpoints, empty unit, both kinds) have no registry identity and no extraction synonyms in the supplied catalog. They are unreachable through canonical lab ingestion. P2 is a product/identity review priority, not a clinical P0: no current ingestion exposure is established. Both kinds now carry NEEDS_CONTEXT; enabling ingestion needs a separate decision.

Open questions: should either identity enter ingestion, which exact assay would it name, and how should ANA qualitative/titer/pattern information replace a numeric assumption? Required artifacts: product decision, extraction-registry proposal, and laboratory reporting/method sheets. Neither identity nor any interval was invented here.

### CF-05 — P0 absolute-count unit joins; P0 RBC / P1 TSH spelling joins

The five shipping `_absolute` keys join registry `_abs` keys only with explicit arithmetic. `unit_conversions` remains [] in the seed: these factors live in the separate `unit_mapping` field, and are not automatically applied to measurements by this task.

| Registry slug | Shipping key | Shipping unit | Registry unit | Forward arithmetic | Reverse arithmetic |
|---|---|---|---|---|---|
| neutrophils_abs | neutrophils_absolute | cells/uL | K/uL | 1000 × 0.001 = 1 | 1 ÷ 0.001 = 1000 |
| lymphocytes_abs | lymphocytes_absolute | cells/uL | K/uL | 1000 × 0.001 = 1 | 1 ÷ 0.001 = 1000 |
| monocytes_abs | monocytes_absolute | cells/uL | K/uL | 1000 × 0.001 = 1 | 1 ÷ 0.001 = 1000 |
| eosinophils_abs | eosinophils_absolute | cells/uL | K/uL | 1000 × 0.001 = 1 | 1 ÷ 0.001 = 1000 |
| basophils_abs | basophils_absolute | cells/uL | K/uL | 1000 × 0.001 = 1 | 1 ÷ 0.001 = 1000 |
| tsh | tsh | mIU/L | uIU/mL | 1 × 1 = 1 | 1 ÷ 1 = 1 |
| rbc | rbc | M/uL | Million/uL | 1 × 1 = 1 | 1 ÷ 1 = 1 |

Arithmetic is checked offline by the added tests, including both endpoints of both bands. A7 described 52 stored measurements as cells/uL and the 1000x hazard as latent; no live data was queried here. Arithmetic correctness does not establish clinical correctness or prove runtime normalization.

Open question for each of the seven rows: does ingestion preserve the original unit and normalize exactly once at the explicit boundary? Required artifact: de-identified ingestion fixture with original unit, normalized result and round-trip assertion, plus the lab's unit legend. Never join by slug alone. The three refused ratio joins remain refused.

### CF-06 — P1 identity audit — 13 unmatched legacy names, no equivalence asserted

All remain archived and unmapped. Matching-looking spelling is not assay identity. The priority denotes identity-audit work; these are not seeded range rows.

| Legacy name | Open question | Required artifact |
|---|---|---|
| b12 | What exact assay/specimen did b12 name? | Original definitions row and laboratory assay identifier/method sheet |
| dhea_s | What exact assay/specimen did dhea_s name? | Original definitions row and laboratory assay identifier/method sheet |
| glucose_fasting | What assay and fasting/collection conditions did glucose_fasting name? | Original definitions row, assay identifier and collection protocol |
| hba1c | What assay/method and reporting scale did hba1c name? | Original definitions row and laboratory method/standardization sheet |
| hdl | Was hdl a direct assay or derived result, and with what unit? | Original definitions row and laboratory assay identifier/method sheet |
| hscrp | What assay sensitivity and reporting unit did hscrp name? | Original definitions row and laboratory assay identifier/method sheet |
| insulin | What assay and fasting state did insulin name? | Original definitions row, assay identifier and collection protocol |
| ldl | Was ldl directly measured or calculated, and by what method? | Original definitions row and laboratory assay/calculation sheet |
| non_hdl | What calculation and component units did non_hdl use? | Original definitions row and calculation specification |
| testosterone_free | Was testosterone_free directly measured or calculated? | Original definitions row and assay/calculation specification |
| testosterone_total | Which assay and population did testosterone_total name? | Original definitions row and laboratory assay/population sheet |
| tgab | What antibody assay and reporting unit did tgab name? | Original definitions row and laboratory assay identifier/method sheet |
| vitamin_d | Which vitamin D metabolite/fraction and assay did vitamin_d describe? | Original definitions row and assay identifier proving the metabolite/fraction; no assumed equivalence to vitamin_d_25_oh |

### CF-07 — P1 metadata audit — “female on 76 entries” claim versus seed evidence

The brief describes `sex_applicability: "female"` on 76 entries. **The actual base seed has 76 metadata entries: 44 female and 32 all, with seven additional analytes having null applicability/no metadata row.** The top-level and nested metadata counts agree. All 76 provenance strings warn that female was the `biomarker_catalog` column default, not reviewed applicability evidence. Thus 76 is the unreviewed metadata count, not the literal female-value count. No applicability value was changed to fit the brief. The default is not population evidence or grounds to label all 198 ranges female-adult; modifiers do not infer reviewed eligibility from it.

Open questions: does the Lead confirm the corrected 44 female / 32 all / seven absent inventory? For each of the 76 metadata entries, what assay-specific population record establishes sex, age and pregnancy applicability? Required artifacts: laboratory population interval tables and named human review, reconciled against the actual intended product population. No default was promoted to an approval.

### CF-08 — P0 — Additional definitions conflict: eGFR

Shipping eGFR **90–200 context / 60–200 reference mL/min/1.73m2** versus retired definitions **90–120 / 60–120 mL/min**. Both are visible historical observations. No indexed/unindexed unit equivalence or conversion is asserted; no candidate was seeded.

Open question: which equation, body-surface-area convention, age scope and reporting ceiling explain each record? Required artifacts: both originating lab/equation specifications and a human adjudication of the unit and ceiling discrepancies.

### CF-09 — P0 — Five unphased reproductive-hormone self-contradictions

These are shipping fallback bands, not new candidates. All five are now DISPUTED.
The conflict is mechanically established inside the dictionary; it does not establish
which endpoint is clinically correct. No value changed.

| Explicit audit item | Unphased band | Span of same-kind phase bands | Internal contradiction / question |
|---|---|---|---|
| lh/general/unphased/amani_context | 2–15 mIU/mL | 2–80 | The entire LH ovulatory surge band 20–80 sits wholly outside its own fallback. Should an absent phase suppress scoring? |
| estradiol/general/unphased/amani_context | 30–350 pg/mL | 20–750 | Both ends exclude values included in phase bands. Should an absent phase suppress scoring? |
| estradiol/general/unphased/lab_reference | 10–400 pg/mL | 10–1000 | Upper endpoint excludes values included in phase bands. Should an absent phase suppress classification? |
| fsh/general/unphased/amani_context | 3–10 mIU/mL | 1–15 | Both ends exclude values included in phase bands. Should an absent phase suppress scoring? |
| fsh/general/unphased/lab_reference | 2–25 mIU/mL | 1–30 | Both ends exclude values included in phase bands. Should an absent phase suppress classification? |

Local code observation: `getRangesForPhase` in `src/lib/biomarkers/catalog.generated.ts`
returns the phase-specific band only for a truthy, present phase, otherwise the fallback.
`src/lib/scoring/scoreBiomarker.ts` and `src/lib/scoring/compareReports.ts` consume it.
The phase span above is the minimum/maximum envelope of catalog bands, not a proposed
replacement interval. An LH value of 40 is inside the catalog ovulatory band but above
the fallback; this internal comparison does not independently establish clinical normality.

Lead-provided exposure fact, quoted verbatim from TASK-042 amendment 1 A (2026-10-06),
not queried or independently verified by this offline implementer:

> **Current exposure is zero, and I checked rather than assumed.** All 18 production `lab_reports` carry a non-null `estimated_cycle_phase`, so no stored report reaches the fallback today, and the stored hormone values are modest (estradiol 45–178, FSH 4.8–6.1, LH 5.8–6.4) rather than surge values. So this is **latent, like the 1000x unit hazard — not a 1.0.6 incident.** It becomes live the first time a report arrives without a phase, which the nullable column permits.

Required artifacts for each item: originating assay/phase-specific population interval
sheets, an owner decision on missing-phase scoring versus suppression, and a de-identified
missing-phase regression fixture. No clinical source has been retrieved. The product
question is prepared in `docs/clinical/BACKLOG-1.0.7-HANDOFF.md` for the Lead's backlog.
