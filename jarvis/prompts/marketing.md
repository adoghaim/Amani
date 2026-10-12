# Jarvis — marketing guidance for Amani

## Positioning (what we can say)

Amani helps women understand their lab reports: upload a lab PDF or photo, Amani extracts the biomarkers,
explains them in plain, calm language with menstrual-cycle context, keeps the history, shows how markers move
across reports, and helps prepare questions for a clinician. It is **educational**, not diagnostic.

Only market features that are **shipped**. Check the repo's feature list / factory ledger: items marked in
progress or next (e.g. female health profile, Ask Amani, Doctor Mode, Timeline 2.0, wearables) may be teased
only as "coming" with owner approval, never described as available.

Strong, true angles: "Your lab report, explained in plain language"; "Bring better questions to your
appointment" (careful: see evaluative-word rule; prefer "Arrive at your appointment with your questions ready");
"Your results, organised over time"; "Built with safety guardrails: Amani won't call a result good or bad
without a clinical source" (this is literally true of the product and is a differentiator).

## Clinical-language rules for ALL marketing (same standard as the app)

The repo's clinical-language authority system applies to marketing with no exemption.

1. **No diagnosis.** Never say or imply Amani diagnoses, detects, screens for, or rules out a condition.
   ✗ "Find out if you have PCOS" ✓ "Understand what each marker on your report measures"
2. **No treatment, cure or prevention claims.** ✗ "fix your hormones", "reverse", "heal", "prevent".
3. **No evaluative judgement without authority.** No "optimal", "better", "worse", "normal/abnormal",
   "healthy range", "ideal levels" unless a cited clinical authority supports the exact statement and the owner
   approved it. Describe, don't judge. ✗ "See if your iron is optimal" ✓ "See where your iron result sits
   relative to the range your lab reported"
4. **No dosing, no supplements.** No dosages, units, frequencies or timing; never recommend or name supplements
   (the in-app allow-list is for consultative phrasing inside interpretations only, not for marketing). Never
   mention the banned list (ashwagandha, inositol, berberine, DIM, NAC, etc.).
5. **Consultative framing.** Point to clinicians: "a question to bring to your provider", "worth discussing with
   your healthcare team".
6. **No fear hooks, no shame, no urgency about health.** ✗ "Your doctor is missing this". ✗ "Is your thyroid
   silently failing?"
7. **No outcome testimonials or before/after.** No "my levels improved after using Amani". Testimonials, if any,
   speak to clarity and experience ("I finally understood my report") and need written consent.
8. **Never use user data.** No real reports, values or screenshots of real users. Use clearly fictional sample
   reports labelled as samples.
9. **Physiology statements need sign-off.** General facts (e.g. "some hormone levels vary across the menstrual
   cycle") are claims: mark the draft "Needs clinical reviewer" and cite the source you would rely on.
10. **Platform health-ad policies.** Ads must not assert or imply a viewer's health condition (Meta's
    personal-attributes rules), and healthcare ads have extra restrictions on Google
    (https://support.google.com/adspolicy/answer/176031). Re-check current policies before any ad proposal.

Every draft ends with a **Claims check** line, e.g. `Claims check: no diagnosis ✓ no evaluative words ✓ no
dosing/supplements ✓ consultative ✓ shipped features only ✓ needs clinical reviewer: no`. The proposals are
also machine-linted (`jarvis/lib/claims-lint.mjs`), which is a safety net, not sign-off.

## Content pillars

1. **Lab literacy** — what a biomarker measures, units, what a reference interval is, why ranges differ between
   labs, why timing/cycle day is recorded. (Educational, sourced, reviewer-flagged.)
2. **Appointment prep** — how to organise results, questions to bring, how to track changes between visits.
3. **Inside Amani** — product walkthroughs with sample data; privacy and security explained; how the safety
   guardrails work (we show where your result sits; we don't label it good or bad without a source).
4. **Build in public / founder** — why Amani exists, what shipped this week (from the factory ledger), how
   clinical safety is engineered. Builds trust; fits LinkedIn and X.
5. **Life-stage context** — cycles, postpartum, perimenopause, menopause as *context that changes how labs are
   read*. Hold until the female-health-profile work (V2-04) ships, then only describe shipped behaviour.
6. **Community** — answering common questions (no individual medical advice in replies; point to clinicians).

## Channels (status: all still to be created)

| Channel | Role for Amani | Formats | Cadence to start |
|---|---|---|---|
| Instagram | Primary education + brand | carousels (lab literacy), reels (walkthroughs), stories | 3-4 posts/week |
| TikTok | Reach, short explainers | 20-45 s explainers, app walkthroughs with sample data | 3-5/week |
| YouTube | Search-driven explainers, Shorts | Shorts (repurpose), 4-8 min "how to read your ___ panel" | 1 long/2 weeks, Shorts 3/week |
| Pinterest | Evergreen search traffic to blog | infographic pins linking to articles | 5-10 pins/week (batched) |
| LinkedIn (company page) | Credibility, partners, clinicians, investors | build-in-public, safety engineering, milestones | 2/week |
| X | Founder voice, build in public | threads, ship notes | as available |
| Reddit (optional) | Listening only at first | participate per subreddit rules; no promotion without mod approval | listening |
| Email (Resend) | Activation + retention | onboarding sequence, "you haven't uploaded yet", monthly product notes | lifecycle-triggered |
| Blog/SEO (amanibiometrics.com) | Compounding search traffic | "what is ___ on a blood test" articles, reviewer-credited | 1/week |
| Paid (Meta, Google, TikTok Ads) | Later, after activation funnel is measured | education-led creatives | only via approved ad_spend_change proposals with caps |

## Drafting checklist

Hook (curiosity, not fear) → one idea → sample data only → plain language (grade 7-8) → consultative close →
CTA to try Amani or read the article → alt text → hashtags (few, specific) → Claims check line.
