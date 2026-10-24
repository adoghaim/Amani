# HC1 — Reminders hidden until they work; cycle copy matches ruling D7.9

- Track: **honest-copy** · branch `factory/rv-honest-copy` (already created at origin/main 22027b2; packets on a track run in order and build on each other)
- Reserved migration range: 20261023155000-20261023159999
- Harness: do NOT run `gates harness` (db-security owns the lock this wave)
- Review lenses after you: correctness + tests, clinical authority (G4)
- Files this packet owns (others may touch nearby code concurrently): src/features/settings/sections/RemindersSection.tsx; index.html; src/pages/Landing* (copy only)
- Findings: F137, F136

## Decisions already made for you (follow them; deviations need evidence in your result)

1. F137: hide the reminders section behind the existing features.local_reminders flag (documented in docs/runtime-config.md; default off) until on-device reminders ship (PK-NOTIF-LOCAL), and show 'Saved' only when the save actually succeeded. Tests.
2. F136: change the index.html meta and Landing copy that promise cycle-phase scoring so they describe what the app actually does (e.g. 'asks for your cycle dates so results are read in context'), per owner ruling D7.9. Run the claims/language lint the recommendation names (jarvis claims lint) or tools/clinical/language-policy over the changed copy. Store listings → owner_actions.

## Findings (verbatim from the 2026-10-23 review of main@22027b2; line numbers refer to that commit)

### F137 — Settings shows five reminder switches that never send anything, and says 'Saved' even when the save failed

- Location: `src/features/settings/sections/RemindersSection.tsx:144` · severity low · category store-readiness · owner_action=False

**Evidence**

RemindersSection.tsx:100-125 offers Period, Fertile window, Ovulation, Lab and Intervention reminders, each described as 'Get notified when ...'. The code comment at :136-142 says nothing delivers them (no notification plugin, no sender), and :144 tells the user 'Reminders aren't sent yet.'

The section is always shown (sections/index.ts:35); it is not behind features.local_reminders.

Lines 76-87 ignore the { error } that supabase-js returns from update and insert, and :90 shows 'Saved' regardless.

google-play-submission.md:215 already lists reminders as something the listing must not claim. Features that visibly don't work are a completeness risk at App Review on both stores (Apple guideline 2.1).

**Recommendation**

Hide the section behind features.local_reminders until on-device reminders ship (PK-NOTIF-LOCAL), or remove it. Check the returned error before showing 'Saved'.

**Verifier's note**

Confirmed. RemindersSection.tsx:101-127 offers five 'Get notified...' toggles, the comment at :138-142 says nothing delivers them, and :144 shows 'Reminders aren't sent yet.' sections/index.ts:35 always mounts the section, and Settings.tsx:31 maps every section. local_reminders appears only in docs/runtime-config.md:92. The save code at :76-87 ignores the { error } returned by update and insert (supabase-js returns errors rather than throwing), so :90 shows 'Saved' even after a failure. This also goes against owner ruling D7.7 (roadmap-gap-review.md:239): 'Reminder toggles stay hidden until delivery exists.'

### F136 — Live and store copy promises cycle-phase scoring, but owner ruling D7.9 limits cycle claims to reviewed panels, and none of the 198 ranges is reviewed

- Location: `index.html:14` · severity medium · category compliance · owner_action=False

**Evidence**

The ruling:
- docs/designs/roadmap-gap-review.md:241: 'D7.9 ... Campaign cycle claims are limited to reviewed panels.'
- T2 (:318), re-checking the campaign copy, is still open.

Review status: in clinical/catalog/catalog.json, 198 of 198 ranges have evidence_grade 'unsourced' and reviewer null, and 35 are DISPUTED. I counted with python, and docs/clinical/AUDIT-QUEUE.md:7 says the same.

Yet production serves:
- index.html:14 meta description: 'scores them against where you are in your cycle'.
- The og and twitter descriptions at :33 and :38: 'read against your cycle'.
- Landing.tsx:67: 'Your labs, read against your cycle.'
- Landing.tsx:196: 'Results read with your cycle context'.

The prepared Play listing (google-play-submission.md:122) says 'scores your results against cycle-phase-aware ranges'.

App Review guideline 1.4.1 asks health apps to disclose methodology that can be validated.

**Recommendation**

Until a reviewer signs off a panel, describe what the app actually does, for example 'asks for your cycle dates so results are read in context'.

Run the jarvis claims lint, or an equivalent check, over index.html, Landing and both store listings, and close T2.

**Verifier's note**

Confirmed, and stronger than the finding states. D7.9 (roadmap-gap-review.md:241) limits campaign cycle claims to reviewed panels, and T2 (:318) is still unchecked. Counting clinical/catalog/catalog.json with python: 83 analytes and 198 ranges, all 198 unsourced with a null reviewer, 35 DISPUTED, 8 NEEDS_CONTEXT, 155 UNKNOWN. Beyond the finding: all 32 cycle-phase-specific ranges, for estradiol, FSH, LH and progesterone, are DISPUTED (30) or UNKNOWN (2). Those are exactly the ranges behind 'cycle-phase-aware ranges'. The live amanibiometrics.com index.html serves the :14, :33 and :38 descriptions, and the live main bundle contains 'Your labs, read against your cycle' and 'Results read with your cycle context' (Landing.tsx:67, :196). google-play-submission.md:122 says 'scores your results against cycle-phase-aware ranges'.

