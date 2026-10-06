# Clinical range conflicts — TASK-041

Inventory supplied by the Lead from production on 2026-10-06 in
`CONFLICTS-OBSERVED.txt`; production was not queried in this offline task.
`reference` means `biomarker_reference_ranges`; `phase` means
`biomarker_phase_ranges`. Values are copied as supplied, not clinically evaluated.

All 15 analyte/phase pairs exist in the shipping dictionary at `2fd9433`.
The shipping values equal the reference-table candidates for these rows.
Under contract §5, those shipping values are transcribed with UNKNOWN review
status and unsourced evidence. This does not establish clinical validity or
approve an “optimal” label. Both historical candidates remain documented here.
No row in this supplied inventory requires DISPUTED fallback; no candidates
were silently resolved through clinical judgment. All remain V2-02 audit work.

| Slug | Phase | Reference optimal | Phase optimal | Reference clinical | Phase clinical | Mechanical disposition (context / reference) |
|---|---|---|---|---|---|---|
| estradiol | follicular | 30-250 | 30-200 | 20-400 | 12-300 | Shipping dictionary: 30-250 / 20-400; UNKNOWN |
| estradiol | luteal | 50-300 | 60-200 | 30-500 | 12-250 | Shipping dictionary: 50-300 / 30-500; UNKNOWN |
| estradiol | menstrual | 20-80 | 20-80 | 10-200 | 12-100 | Shipping dictionary: 20-80 / 10-200; UNKNOWN |
| estradiol | ovulatory | 150-750 | 150-350 | 100-1000 | 100-500 | Shipping dictionary: 150-750 / 100-1000; UNKNOWN |
| fsh | follicular | 2-10 | 3-10 | 2-20 | 2-20 | Shipping dictionary: 2-10 / 2-20; UNKNOWN |
| fsh | luteal | 1-8 | 1-8 | 1-10 | 1-12 | Shipping dictionary: 1-8 / 1-10; UNKNOWN |
| fsh | menstrual | 3-10 | 3-10 | 3-20 | 2-20 | Shipping dictionary: 3-10 / 3-20; UNKNOWN |
| fsh | ovulatory | 2-15 | 6-20 | 2-30 | 5-30 | Shipping dictionary: 2-15 / 2-30; UNKNOWN |
| lh | follicular | 2-15 | 1-12 | 1-25 | 1-15 | Shipping dictionary: 2-15 / 1-25; UNKNOWN |
| lh | luteal | 2-12 | 1-10 | 1-20 | 1-15 | Shipping dictionary: 2-12 / 1-20; UNKNOWN |
| lh | menstrual | 2-15 | 1-10 | 1-25 | 1-15 | Shipping dictionary: 2-15 / 1-25; UNKNOWN |
| lh | ovulatory | 20-80 | 15-70 | 15-100 | 10-100 | Shipping dictionary: 20-80 / 15-100; UNKNOWN |
| progesterone | follicular | 0.1-0.9 | 0.1-1.0 | 0.1-1.5 | 0.1-1.5 | Shipping dictionary: 0.1-0.9 / 0.1-1.5; UNKNOWN |
| progesterone | luteal | 5.0-25.0 | 5.0-20.0 | 3.0-30.0 | 2.0-25.0 | Shipping dictionary: 5.0-25.0 / 3.0-30.0; UNKNOWN |
| progesterone | menstrual | 0.1-0.9 | 0.1-0.9 | 0.1-1.5 | 0.1-1.0 | Shipping dictionary: 0.1-0.9 / 0.1-1.5; UNKNOWN |

## General definitions inventory (amendment 2 A8)

Source: Lead-supplied `DEFINITIONS-CONFLICTS-OBSERVED.txt` and amendment 2,
read offline. Of 44 definitions, the Lead reports 29 matching, two differing,
and 13 unmatched names. The two differences below are never projected from the
legacy definitions table; the entire table is archived intact.

| Name | Shipping optimal / clinical | Definitions optimal / clinical | Unit evidence | Disposition |
|---|---|---|---|---|
| magnesium | 1.8–2.4 / 1.7–2.5 | 5.2–6.5 / 4.2–6.8 | Both say mg/dL; no conversion inferred | Shipping stands, UNKNOWN; dormant definition archived only; V2-02 audit queue |
| egfr | 90–200 / 60–200 | 90–120 / 60–120 | Shipping mL/min/1.73m2; definitions mL/min | Shipping stands, UNKNOWN; no unit equivalence inferred; V2-02 audit queue |

The following 13 unmatched names remain archived without a guessed mapping:
`b12`, `dhea_s`, `glucose_fasting`, `hba1c`, `hdl`, `hscrp`, `insulin`, `ldl`,
`non_hdl`, `testosterone_free`, `testosterone_total`, `tgab`, `vitamin_d`.
In particular, no assay identity is inferred for `vitamin_d`.

`rheumatoid_factor` and `ana_screen` keep their shipping ranges but have no
canonical extraction identity in the supplied snapshot. No identity is created;
both are product gaps queued for V2-02 (amendment 1 A3).

## Candidate representation

A future alternative is a range with `candidate_id` and `review_status: DISPUTED`.
Candidates retain both endpoints and provenance in the seed and SQL table;
they never enter `projectEntries` or the legacy `optimal` alias. Candidate IDs
are unique within slug/population/phase/kind, and the reserved ID `shipping`
cannot label a disputed alternative. Shipping pairs remain explicit and complete.
No current inherited range has been changed to a disputed candidate.
