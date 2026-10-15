# Factory status

Human-readable view of `status.json` (regenerate from it; the JSON is the record). As of 2026-10-15.

| Packet | Phase | Wave | Status | Depends on | PR |
|---|---|---|---|---|---|
| PK-03e-A Remediation server core: bridge + eligibility | V2-03e | A | superseded | - | - |
| PK-03e-B Remediation entitlement rules: $0, no counter, no active sub | V2-03e | B | superseded | PK-03e-A | - |
| PK-03e-C Remediation customer UI: state, CTA, failure/retry | V2-03e | B | superseded | PK-03e-A | - |
| PK-03e-D Remediation three-browser + native proof | V2-03e | C | superseded | PK-03e-B, PK-03e-C | - |
| PK-03e-E Account deletion deadlock fix | V2-03e | A | superseded | - | [#92](https://github.com/adoghaim/Amani/pull/92) (closed) |
| PK-03e-F Trigger ENABLE ALWAYS verification | V2-03e | A | done | - | [#125](https://github.com/adoghaim/Amani/pull/125) |
| PK-FIX-01a Truth fixes: Settings privacy and reminder copy, adults-only onboarding | PL | A | done | - | [#99](https://github.com/adoghaim/Amani/pull/99) |
| PK-STORE-01 Store-subscription teardown on account deletion (RevenueCat, Google Play cancel) | PL | A | done | - | [#102](https://github.com/adoghaim/Amani/pull/102) |
| PK-FIX-04 Deleting one report also removes its stored lab file | PL | A | done | - | [#103](https://github.com/adoghaim/Amani/pull/103) |
| PK-PL-A Pre-launch rulings: calm regeneration failures, no attempt lost on a no-write failure | PL | A | done | - | [#105](https://github.com/adoghaim/Amani/pull/105) |
| PK-FIX-06 Cycle day for any cycle length; no silent 28-day assumption | PL | A | done | - | [#106](https://github.com/adoghaim/Amani/pull/106) |
| PK-INT-01 Integration extension points (harness cases, deletion registry, Settings sections, header actions) | PL | A | done | - | [#107](https://github.com/adoghaim/Amani/pull/107) |
| PK-FIX-05 Parser: bind each printed range to its marker | PL | A | done | - | [#109](https://github.com/adoghaim/Amani/pull/109) |
| PK-FIX-02 UI truth fixes (neutral colors, wording, labels) | PL | A | done | - | [#110](https://github.com/adoghaim/Amani/pull/110) |
| PK-CFG-01 Runtime config: minimum app version, AI kill switch, feature flags | PL | A | done | - | [#111](https://github.com/adoghaim/Amani/pull/111) |
| PK-MINVER-01 Native minimum-version gate driven by runtime config | PL | A | done | - | [#112](https://github.com/adoghaim/Amani/pull/112) |
| PK-FIX-03 Billing truth: plan CTAs match checkout; optional promo codes | PL | A | done | - | [#113](https://github.com/adoghaim/Amani/pull/113) |
| PK-FIX-07 Page the all-reports value reads past the 1,000-row cap | PL | A | done | - | [#114](https://github.com/adoghaim/Amani/pull/114) |
| PK-FIX-01b Backend guards: Sentry PHI scrubbing, AI cost ledger, budget alerts, AI kill switch | PL | A | done | - | [#115](https://github.com/adoghaim/Amani/pull/115) |
| PK-DS-01 Result rows per DESIGN.md | PL | A | done | - | [#116](https://github.com/adoghaim/Amani/pull/116) |
| PK-SUPPLY-01 Supply-chain scanning and pinned edge-function imports | PL | A | done | - | [#117](https://github.com/adoghaim/Amani/pull/117) |
| PK-PRIV-01 Privacy pack + text-path redaction before OpenAI | PL | A | done | - | [#118](https://github.com/adoghaim/Amani/pull/118) |
| PK-CONSENT-01 Launch consent: health-data, AI-processing, 18+, consent ledger (flag off) | PL | A | done | - | [#119](https://github.com/adoghaim/Amani/pull/119) |
| PK-EXP5 First-party funnel events and signup attribution | PL | A | done | - | [#120](https://github.com/adoghaim/Amani/pull/120) |
| PK-PL-C Browser smoke on main, prepared post-deploy SQL, V2 post-deploy smoke script | PL | A | done | - | [#121](https://github.com/adoghaim/Amani/pull/121) |
| PK-PRICE-01 Pricing options analysis (docs only) | PL | A | done | - | [#122](https://github.com/adoghaim/Amani/pull/122) |
| PK-AIDIST-01 AI-assistant distribution design + MCP connector prototype (not deployed) | PL | A | done | - | [#123](https://github.com/adoghaim/Amani/pull/123) |
| PK-HARM-01 Adverse-event pathway (report a problem) + breach response plan | PL | A | done | - | [#124](https://github.com/adoghaim/Amani/pull/124) |
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

**Superseded by owner rulings:** PK-03e-A, PK-03e-B, PK-03e-C, PK-03e-D, PK-03e-E (V2-03e turn 10 removed the remediation flow; V2 `erase_reports` replaced PK-03e-E, PR #92 closed).

**Merged 2026-10-15 (merge train), backend deploy awaiting owner GO:** PK-03e-F, PK-STORE-01, PK-FIX-04, PK-PL-A, PK-INT-01, PK-CFG-01, PK-MINVER-01, PK-FIX-03, PK-FIX-01b, PK-SUPPLY-01, PK-PRIV-01, PK-CONSENT-01, PK-EXP5, PK-AIDIST-01, PK-HARM-01. Web publishes only when a commit authored by adoghaim lands on main (Netlify contributor limit).

**Blocked:** PK-05-A (Clinical rule content needs an approved clinical reviewer [Pending]); PK-05-C (Clinical rule content needs an approved clinical reviewer [Pending])

**Next suggested (dependencies met):** PK-04-A, PK-05-B

**Owner actions:**
- Netlify: approve mawadSur as a Git contributor or upgrade the plan; until then only a commit authored by adoghaim publishes main
- Backend deploy (owner GO): supabase db push (V2 migrations 20261006-20261011000003, then 20261013000000, 20261013040000, 20261013050000, 20261015010000, 20261015020000, 20261015040000, 20261015110000), then deploy the edge functions listed per packet; run factory/sql/verify-account-deletion-tables.sql before deploying delete-user-data
- Run factory/sql/verify-triggers-enable-always.sql after the push (runbook in factory/gates.md)
- Xcode Cloud: set workflow variables in App Store Connect (docs/xcode-cloud.md)
- Add "Browser smoke" to required checks on main (factory/gates.md)
- Answer [Pending] items in brain/open-questions.md (clinical reviewer for PK-05-A/C)
