# Factory status

Human-readable view of `status.json` (regenerate from it; the JSON is the record). As of 2026-10-23.

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
| RV-DB1 Harness: Postgres 17, assertive case 010, full-chain replay and a grant audit | RV | 1 | in-progress | - | - |
| RV-DB2 RLS on the three public tables; revoke client writes on billing tables and anon access to user data | RV | 1 | todo | RV-DB1 | - |
| RV-DB3 has_consented means consent; interpreted reports stay immutable; lab file ownership | RV | 1 | todo | RV-DB2 | - |
| RV-CS1 Unit sanity: withhold Amani bands across unit mismatches | RV | 1 | in-progress | - | - |
| RV-CS2 Declared pregnancy withholds cycle context; scoring fails closed on bad inputs | RV | 1 | todo | RV-CS1 | - |
| RV-CS3 Censored results never become numbers | RV | 1 | todo | RV-CS2 | - |
| RV-IA1 Cycle phase and day only from explicit patient lines | RV | 1 | review | - | [#156](https://github.com/adoghaim/Amani/pull/156) |
| RV-IA2 Parser B12 boundaries; parse-error rows need her confirmation | RV | 1 | in-progress | RV-IA1 | - |
| RV-IB1 One extraction contract for OCR and AI refinement | RV | 1 | in-progress | - | - |
| RV-IB2 Keyboard- and screen-reader-usable upload flow | RV | 1 | todo | RV-IB1 | - |
| RV-NP1 Harden the nutrient validator with an adversarial corpus | RV | 1 | review | - | [#159](https://github.com/adoghaim/Amani/pull/159) |
| RV-AI1 Validate lab-insights output, reasoning-model parameters, one model config, fixed client errors | RV | 1 | review | - | [#167](https://github.com/adoghaim/Amani/pull/167) |
| RV-RS1 Dark critical-flag notice from the lab's own flags; report context keeps her symptoms | RV | 1 | in-progress | - | - |
| RV-RS2 Disclaimer whenever clinical content shows; no outside-band counts | RV | 1 | todo | RV-RS1 | - |
| RV-BS1 Stripe portal uses the real customer; deletion removes every customer and every file | RV | 1 | review | - | [#168](https://github.com/adoghaim/Amani/pull/168) |
| RV-BS2 Checkout: server price allow-list, server-built redirects, one subscription, tested webhook | RV | 1 | review | RV-BS1 | [#168](https://github.com/adoghaim/Amani/pull/168) |
| RV-BI1 Play pause keeps access until expiry; App Store records keyed consistently | RV | 1 | review | - | [#164](https://github.com/adoghaim/Amani/pull/164) |
| RV-BU1 Billing labels from the real entitlement; an honest deletion warning | RV | 1 | review | - | [#157](https://github.com/adoghaim/Amani/pull/157) |
| RV-WP1 Private source maps, production-only routes, security headers | RV | 1 | review | - | - |
| RV-WP2 Offline is not empty; error boundaries reset | RV | 1 | in-progress | RV-WP1 | - |
| RV-WP3 Accessible overlays, safe areas, Android back closes sheets first | RV | 1 | todo | RV-WP2 | - |
| RV-HC1 Reminders hidden until they work; cycle copy matches ruling D7.9 | RV | 1 | todo | - | - |
| RV-DL1 Device lock hardening | RV | 1 | review | - | [#163](https://github.com/adoghaim/Amani/pull/163) |
| RV-SP1 Committed Package.resolved matches Package.swift | RV | 1 | review | - | [#171](https://github.com/adoghaim/Amani/pull/171) |
| RV-AU1 Recovery links work in the app; OAuth-only accounts get a path; signup hardening; App Links | RV | 1 | review | - | [#166](https://github.com/adoghaim/Amani/pull/166) |
| RV-DP1 pdf.js 6.4.299 on the legacy build | RV | 1 | review | - | [#173](https://github.com/adoghaim/Amani/pull/173) |
| RV-DP2 Declared dependencies, an aligned test toolchain and a Node 22 pin | RV | 1 | review | RV-DP1 | [#173](https://github.com/adoghaim/Amani/pull/173) |
| RV-CI1 Native CI that can fail; the device-lock boundary test runs | RV | 1 | review | - | [#160](https://github.com/adoghaim/Amani/pull/160) |
| RV-CI2 Workflow hardening and Node 22 everywhere | RV | 1 | review | RV-CI1 | [#160](https://github.com/adoghaim/Amani/pull/160) |
| RV-CI3 E2E configs tell the truth | RV | 1 | review | RV-CI2 | [#160](https://github.com/adoghaim/Amani/pull/160) |
| RV-HY1 Untrack leftovers; ignore local state | RV | 1 | review | - | [#158](https://github.com/adoghaim/Amani/pull/158) |

**Superseded by owner rulings:** PK-03e-A, PK-03e-B, PK-03e-C, PK-03e-D, PK-03e-E (V2-03e turn 10 removed the remediation flow; V2 `erase_reports` replaced PK-03e-E, PR #92 closed).

**Merged 2026-10-15 (merge train #128); backend deployed 2026-10-16:** PK-03e-F, PK-STORE-01, PK-FIX-04, PK-PL-A, PK-INT-01, PK-CFG-01, PK-MINVER-01, PK-FIX-03, PK-FIX-01b, PK-SUPPLY-01, PK-PRIV-01, PK-CONSENT-01, PK-EXP5, PK-AIDIST-01, PK-HARM-01. Web publishes only when a commit authored by adoghaim lands on main (Netlify contributor limit).

**Blocked:** PK-05-A (Clinical rule content needs an approved clinical reviewer [Pending]); PK-05-C (Clinical rule content needs an approved clinical reviewer [Pending])

**Next suggested (dependencies met):** PK-04-A, PK-05-B

**Main review fixes (RV), wave 1 — paused by the owner on 2026-10-23.** Nothing in this phase is merged. Where each packet stands:

| Packet | Track | Status | Branch @ commit | State |
|---|---|---|---|---|
| RV-DB1 | db-security | in-progress | `factory/rv-db-security` @ `b03f619` | Built (F035, F124 partial). Reviews: 3 blocking findings open (1 security, 2 correctness); no fix applied yet. |
| RV-CS1 | clinical-scoring | in-progress | `factory/rv-clinical-scoring` @ `db14fb2` | Built (F013 partial: its server half is a generate-interpretation handoff). Reviews were cut off: needs verification. |
| RV-IA1 | ingest-cycle-parser | review | `factory/rv-ingest-cycle-parser` @ `5cf7d10` | PR #156: reviewed (correctness + clinical, G4 pass), gates green on current main; awaiting owner confirmation of PK-FIX-06 Q9. |
| RV-IA2 | ingest-cycle-parser | in-progress | `factory/rv-wip-ia2` @ `073a207` | Interrupted mid-build. B12 whole-word matching committed (35a4521); the unfinished F022 confirmation work is saved as wip/IA2-uncommitted.patch. |
| RV-IB1 | ingest-ocr-a11y | in-progress | `factory/rv-ingest-ocr-a11y` @ `4219016` | Built (F026 partial). Security review: recommend merge. Correctness review: 1 blocking finding open; no fix applied yet. |
| RV-NP1 | nutrient-policy | review | `factory/rv-nutrient-policy` @ `98eb8a0` | PR #159: blind verifier PASS_WITH_NOTES; gates and the full CI e2e matrix green on current main. |
| RV-RS1 | report-safety | in-progress | `factory/rv-wip-rs1` @ `7ed7625` | Interrupted before gating: both fixes committed (e3375cd F018, 7ed7625 F014); track branch not advanced; needs gates and verification. |
| RV-BU1 | billing-ui | review | `factory/rv-billing-ui` @ `c62caf4` | PR #157: blind verifier PASS_WITH_NOTES; gates and the full CI e2e matrix green on current main. |
| RV-WP1 | web-platform | review | `factory/rv-web-platform` @ `dec8bfe` | Built. Security and correctness reviews: recommend merge. |
| RV-WP2 | web-platform | in-progress | `factory/rv-wip-wp2` @ `979728b` | Interrupted mid-build. Unfinished work saved as wip/WP2-uncommitted.patch on top of a temporary WIP commit (0ad8e0d). |
| RV-DL1 | device-lock | review | `factory/rv-wip-dl1` @ `8a3ad77` | PR #163: blind verifier PASS_WITH_NOTES; every CI gate and the CI e2e matrix run on current main (results in the PR). |
| RV-CI1 | ci-workflows | review | `factory/rv-ci-workflows` @ `fc21c1d` | PR #160: blind verifier PASS_WITH_NOTES; gates and the full CI e2e matrix green on current main. |
| RV-CI2 | ci-workflows | review | `factory/rv-ci-workflows` @ `fc21c1d` | PR #160: blind verifier PASS_WITH_NOTES; gates and the full CI e2e matrix green on current main. |
| RV-HY1 | hygiene | review | `factory/rv-hygiene` @ `2c1d777` | PR #158: blind verifier PASS_WITH_NOTES; gates and the full CI e2e matrix green on current main. |

Not started (17): RV-DB2, RV-DB3, RV-CS2, RV-CS3, RV-IB2, RV-AI1, RV-RS2, RV-BS1, RV-BS2, RV-BI1, RV-WP3, RV-HC1, RV-SP1, RV-AU1, RV-DP1, RV-DP2, RV-CI3. Their track branches sit at 22027b2 or at the last built packet.

To resume: verify CI2, CS1, BU1, NP1; fix and re-verify DB1 (3 blocking) and IB1 (1 blocking); finish RS1, DL1, IA2 (`git apply wip/IA2-uncommitted.patch`), WP2 (`git apply wip/WP2-uncommitted.patch`); then build the rest track by track. Every RV branch is based on 22027b2, so integration merges onto current main and #152. generate-interpretation changes stay out of wave 1 (handoffs) until #152 lands with its true-floor fix.

**Owner actions:**
- Netlify: approve mawadSur as a Git contributor or upgrade the plan; production web is still 948dc95 until a commit authored by adoghaim lands on main (the backend it needs is live)
- Set secrets to enable the dark backend guards: AI_BUDGET_CHECK_SECRET (budget alerts), ANON_EVENT_IP_SALT_SECRET (pre-signup events), Sentry DSN, Google Play credentials (Play cancel on deletion)
- Run node scripts/smoke/v2-post-deploy.mjs --i-understand-this-hits-production with a test account; only after it passes apply factory/sql/post-deploy/retire-delete-interpretations.sql (header runbook)
- Xcode Cloud: set workflow variables in App Store Connect (docs/xcode-cloud.md)
- Add "Browser smoke" to required checks on main (factory/gates.md)
- Answer [Pending] items in brain/open-questions.md (clinical reviewer for PK-05-A/C)
- Review-fix wave 1 (phase RV) is paused, nothing from it is merged: 4 packets built and verified, 10 in progress (4 of them interrupted WIP), 17 not started. Branches factory/rv-*; resume notes in factory/STATUS.md.
- PR #152: Ruling 7 confirmed as a true lab-flag floor (2026-10-23). #152 needs a true-floor fix and handler tests (fallback_reason, model_failure) before it lands; deploy generate-interpretation before or with the web merge.
- PR #154 (graphify knowledge graph of the repo) is ready for review.
