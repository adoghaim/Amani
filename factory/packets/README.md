# Work packets

One file per PR-sized packet. Generated from the backlog; the ledger of record is `../status.json`.

| Packet | Phase | Wave | Tickets | Depends on | Gates |
|---|---|---|---|---|---|
| [PK-03e-A](PK-03e-A.md) Remediation server core: bridge + eligibility | V2-03e | A | V2-03e-01, V2-03e-02 | - | G0, G3, G4, G5 |
| [PK-03e-B](PK-03e-B.md) Remediation entitlement rules: $0, no counter, no active sub | V2-03e | B | V2-03e-03, V2-03e-04 | PK-03e-A | G0, G3, G5 |
| [PK-03e-C](PK-03e-C.md) Remediation customer UI: state, CTA, failure/retry | V2-03e | B | V2-03e-05, V2-03e-06, V2-03e-07 | PK-03e-A | G0, G3, G4, G5 |
| [PK-03e-D](PK-03e-D.md) Remediation three-browser + native proof | V2-03e | C | V2-03e-08 | PK-03e-B, PK-03e-C | G0, G1, G2, G5 |
| [PK-03e-E](PK-03e-E.md) Account deletion deadlock fix | V2-03e | A | V2-03e-09 | - | G0, G3, G5 |
| [PK-03e-F](PK-03e-F.md) Trigger ENABLE ALWAYS verification | V2-03e | A | V2-03e-10 | - | G0, G3, G5 |
| [PK-04-A](PK-04-A.md) Female context schema, RLS, grants | V2-04 | A | V2-04-01 | PK-03e-E, PK-03e-F | G0, G3, G5 |
| [PK-04-B](PK-04-B.md) Female context API + validation | V2-04 | B | V2-04-02 | PK-04-A | G0, G5 |
| [PK-04-C](PK-04-C.md) Stage + cycle fields | V2-04 | C | V2-04-03, V2-04-04 | PK-04-B | G0, G4, G5 |
| [PK-04-D](PK-04-D.md) Pregnancy + postpartum fields | V2-04 | C | V2-04-05, V2-04-06 | PK-04-B | G0, G4, G5 |
| [PK-04-E](PK-04-E.md) Contraception, HRT, fertility goal | V2-04 | C | V2-04-07, V2-04-08 | PK-04-B | G0, G4, G5 |
| [PK-04-G](PK-04-G.md) Per-report snapshot + legacy mapping | V2-04 | C | V2-04-10 | PK-04-B | G0, G3, G5 |
| [PK-04-I](PK-04-I.md) Deletion + privacy drafts for female context | V2-04 | C | V2-04-12 | PK-04-A, PK-03e-E | G0, G3, G5 |
| [PK-04-F](PK-04-F.md) Female health profile UI | V2-04 | D | V2-04-09 | PK-04-C, PK-04-D, PK-04-E | G0, G1, G2, G5 |
| [PK-04-H](PK-04-H.md) Context-aware scoring + interpretation | V2-04 | D | V2-04-11 | PK-04-G, PK-04-C | G0, G4, G5 |
| [PK-04-J](PK-04-J.md) V2-04 end-to-end proof | V2-04 | E | V2-04-13 | PK-04-F, PK-04-H | G0, G1, G2, G5 |
| [PK-05-A](PK-05-A.md) Safety rule schema + approved catalog | V2-05 | A | V2-05-01 | PK-04-A | G0, G3, G4, G5 |
| [PK-05-B](PK-05-B.md) Critical-value engine + unit sanity (pure, dark; may run alongside V2-04) | V2-05 | A | V2-05-02, V2-05-03 | PK-03e-E, PK-03e-F | G0, G4, G5 |
| [PK-05-C](PK-05-C.md) Pregnancy red flags | V2-05 | B | V2-05-04 | PK-05-B, PK-04-D, PK-05-A | G0, G4, G5 |
| [PK-05-D](PK-05-D.md) Pre-generation enforcement | V2-05 | B | V2-05-05 | PK-05-B | G0, G3, G4, G5 |
| [PK-05-E](PK-05-E.md) Post-generation enforcement, safety pathway, audit | V2-05 | C | V2-05-06, V2-05-07, V2-05-08 | PK-05-D | G0, G1, G3, G4, G5 |
| [PK-06-A](PK-06-A.md) AmaniContext contract + builder | V2-06 | A | V2-06-01 | PK-04-G | G0, G5 |
| [PK-06-B](PK-06-B.md) Age, life stage, symptoms | V2-06 | B | V2-06-02, V2-06-05 | PK-06-A | G0, G4, G5 |
| [PK-06-C](PK-06-C.md) Medications + interventions | V2-06 | B | V2-06-03, V2-06-04 | PK-06-A | G0, G4, G5 |
| [PK-06-D](PK-06-D.md) Biomarker series + personal baseline | V2-06 | B | V2-06-06, V2-06-07 | PK-06-A, PK-05-B | G0, G4, G5 |
| [PK-06-E](PK-06-E.md) Wire AmaniContext + minimization | V2-06 | C | V2-06-08 | PK-06-B, PK-06-C, PK-06-D | G0, G4, G5 |
| [PK-S2-01](PK-S2-01.md) Ask Amani server | S2 | A | S2-01 | PK-06-E, PK-05-E | G0, G4, G5 |
| [PK-S2-05](PK-S2-05.md) Doctor questions expansion | S2 | A | S2-05 | PK-06-E | G0, G4, G5 |
| [PK-S2-06](PK-S2-06.md) Timeline 2.0 | S2 | A | S2-06 | PK-06-D, PK-06-C | G0, G1, G2, G5 |
| [PK-S2-07](PK-S2-07.md) Intervention → outcome | S2 | A | S2-07 | PK-06-C, PK-06-D | G0, G4, G5 |
| [PK-S2-08](PK-S2-08.md) Longitudinal insights | S2 | A | S2-08 | PK-06-D | G0, G4, G5 |
| [PK-S2-09](PK-S2-09.md) Cross-marker patterns | S2 | A | S2-09 | PK-06-D | G0, G4, G5 |
| [PK-S2-10](PK-S2-10.md) Personal-baseline intelligence | S2 | A | S2-10 | PK-06-D | G0, G4, G5 |
| [PK-S2-02](PK-S2-02.md) Ask Amani client + tiering | S2 | B | S2-02 | PK-S2-01 | G0, G1, G2, G5 |
| [PK-S2-03](PK-S2-03.md) Today / priority view | S2 | B | S2-03 | PK-06-E, PK-05-E | G0, G1, G4, G5 |
| [PK-S2-04](PK-S2-04.md) Doctor Mode | S2 | B | S2-04 | PK-06-E, PK-S2-05 | G0, G1, G2, G4, G5 |

Later items (L-01..L-08) have no packet yet. They need an owner decision first; use `factory/templates/feature-request.md`.