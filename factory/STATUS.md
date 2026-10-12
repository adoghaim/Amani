# Factory status

Human-readable view of `status.json` (regenerate from it; the JSON is the record). As of 2026-10-11.

| Packet | Phase | Wave | Status | Depends on | PR |
|---|---|---|---|---|---|
| PK-03e-A Remediation server core: bridge + eligibility | V2-03e | A | in-progress | - | - |
| PK-03e-B Remediation entitlement rules: $0, no counter, no active sub | V2-03e | B | in-progress | PK-03e-A | - |
| PK-03e-C Remediation customer UI: state, CTA, failure/retry | V2-03e | B | in-progress | PK-03e-A | - |
| PK-03e-D Remediation three-browser + native proof | V2-03e | C | in-progress | PK-03e-B, PK-03e-C | - |
| PK-03e-E Account deletion deadlock fix | V2-03e | A | todo | - | - |
| PK-03e-F Trigger ENABLE ALWAYS verification | V2-03e | A | todo | - | - |
| PK-04-A Female context schema, RLS, grants | V2-04 | A | todo | PK-03e-E, PK-03e-F | - |
| PK-04-B Female context API + validation | V2-04 | B | todo | PK-04-A | - |
| PK-04-C Stage + cycle fields | V2-04 | C | todo | PK-04-B | - |
| PK-04-D Pregnancy + postpartum fields | V2-04 | C | todo | PK-04-B | - |
| PK-04-E Contraception, HRT, fertility goal | V2-04 | C | todo | PK-04-B | - |
| PK-04-G Per-report snapshot + legacy mapping | V2-04 | C | todo | PK-04-B | - |
| PK-04-I Deletion + privacy drafts for female context | V2-04 | C | todo | PK-04-A, PK-03e-E | - |
| PK-04-F Female health profile UI | V2-04 | D | todo | PK-04-C, PK-04-D, PK-04-E | - |
| PK-04-H Context-aware scoring + interpretation | V2-04 | D | todo | PK-04-G, PK-04-C | - |
| PK-04-J V2-04 end-to-end proof | V2-04 | E | todo | PK-04-F, PK-04-H | - |
| PK-05-A Safety rule schema + approved catalog | V2-05 | A | blocked | PK-04-A | - |
| PK-05-B Critical-value engine + unit sanity (pure, dark; may run alongside V2-04) | V2-05 | A | todo | PK-03e-E, PK-03e-F | - |
| PK-05-C Pregnancy red flags | V2-05 | B | blocked | PK-05-B, PK-04-D, PK-05-A | - |
| PK-05-D Pre-generation enforcement | V2-05 | B | todo | PK-05-B | - |
| PK-05-E Post-generation enforcement, safety pathway, audit | V2-05 | C | todo | PK-05-D | - |
| PK-06-A AmaniContext contract + builder | V2-06 | A | todo | PK-04-G | - |
| PK-06-B Age, life stage, symptoms | V2-06 | B | todo | PK-06-A | - |
| PK-06-C Medications + interventions | V2-06 | B | todo | PK-06-A | - |
| PK-06-D Biomarker series + personal baseline | V2-06 | B | todo | PK-06-A, PK-05-B | - |
| PK-06-E Wire AmaniContext + minimization | V2-06 | C | todo | PK-06-B, PK-06-C, PK-06-D | - |
| PK-S2-01 Ask Amani server | S2 | A | todo | PK-06-E, PK-05-E | - |
| PK-S2-05 Doctor questions expansion | S2 | A | todo | PK-06-E | - |
| PK-S2-06 Timeline 2.0 | S2 | A | todo | PK-06-D, PK-06-C | - |
| PK-S2-07 Intervention → outcome | S2 | A | todo | PK-06-C, PK-06-D | - |
| PK-S2-08 Longitudinal insights | S2 | A | todo | PK-06-D | - |
| PK-S2-09 Cross-marker patterns | S2 | A | todo | PK-06-D | - |
| PK-S2-10 Personal-baseline intelligence | S2 | A | todo | PK-06-D | - |
| PK-S2-02 Ask Amani client + tiering | S2 | B | todo | PK-S2-01 | - |
| PK-S2-03 Today / priority view | S2 | B | todo | PK-06-E, PK-05-E | - |
| PK-S2-04 Doctor Mode | S2 | B | todo | PK-06-E, PK-S2-05 | - |

**In progress:** PK-03e-A, PK-03e-B, PK-03e-C, PK-03e-D

**Blocked:** PK-05-A (Clinical rule content needs an approved clinical reviewer [Pending]); PK-05-C (Clinical rule content needs an approved clinical reviewer [Pending])

**Next suggested (dependencies met):** PK-03e-E, PK-03e-F