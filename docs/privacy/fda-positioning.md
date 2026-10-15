# FDA positioning memo: general wellness vs clinical decision support

> **DRAFT for lawyer review. This is not legal advice, and it is not a
> regulatory opinion.** PK-PRIV-01 (EXP-6). It describes what the app does
> today (main at 948dc95) and maps it against the FDA framework as the drafter
> understands it. Every citation is marked **[lawyer to confirm the current
> version]**, because FDA revises these guidances; the drafter understands that
> FDA issued revised General Wellness and Clinical Decision Support guidances
> in January 2026, and the regulatory counsel should check the analysis below
> against those texts. A regulatory specialist, not the factory, decides the
> position.

## 1. Question

Is any Amani software function a *device* under section 201(h) of the Federal
Food, Drug, and Cosmetic Act, and if so, does it fall under an exclusion
(section 520(o)) or an FDA enforcement-discretion policy?

## 2. What Amani does (facts from the code)

| Function | Code | Notes for the analysis |
|---|---|---|
| Upload a lab report; extract results (on-device parser, AI extraction, AI OCR) | `src/utils/parser/`, `extract-biomarkers`, `parse-lab-report-ocr` | Transfer, conversion and display of lab data |
| Show each result against **the lab's printed reference range**, with a status word | `src/lib/scoring/scoreBiomarker.ts` | Compares a value with the range the lab supplied |
| Add **menstrual-cycle context** (estimated cycle day and phase) to hormone results | `src/utils/cyclePredictor.ts`, `lab_reports` | Contextual information; if it changes the status shown, it is analysis |
| Group results by body system; per-system scores | `groupBySystem.ts`, `health_scores` table | A numeric score per system is closer to analysis than display |
| Deterministic **patterns** across markers (thyroid antibodies with thyroid function, glucose regulation markers, lipids, AMH, ferritin with haemoglobin) with "worth discussing with your provider" wording | `generate-interpretation/index.ts` | Names conditions ("autoimmune thyroid conditions", "PCOS", "iron insufficiency") as possibilities |
| AI-written educational interpretation, policy-validated, no dosing, no prescriptive verbs | `generate-interpretation`, `_shared/nutrient-policy.ts` | Patient-specific explanation |
| Compare two reports and summarise changes | `lab-insights` | Trend information |
| Period, symptom and intervention tracking; reminders typed `period`, `fertile_window`, `ovulation` | `period_logs`, `symptom_logs`, `reminders` | Fertility-window prediction is a regulated intended use when it is for contraception or conception |
| "Questions for your doctor" | interpretation output | Supports communication with a clinician |

## 3. Framework [lawyer to confirm each]

1. **Device definition** — FD&C Act §201(h): an instrument, including
   software, intended for the diagnosis, cure, mitigation, treatment or
   prevention of disease, or to affect the structure or function of the body.
   Intended use is judged from labeling, marketing and in-app copy.
2. **General wellness exclusion** — §520(o)(1)(B) and FDA's guidance *General
   Wellness: Policy for Low Risk Devices*. Covers low-risk products intended
   (a) for maintaining or encouraging a general state of health without
   reference to a disease, or (b) for promoting a healthy lifestyle where it is
   well understood that this may reduce the risk or impact of certain chronic
   diseases. It does not cover functions that identify or name a specific
   disease in the user.
3. **Lab-data display** — §520(o)(1)(D) excludes software for transferring,
   storing, converting formats or displaying clinical laboratory test data and
   findings, **unless** the function is intended to interpret or analyze those
   data.
4. **Clinical decision support** — §520(o)(1)(E) and FDA's *Clinical Decision
   Support Software* guidance. The exclusion needs all four criteria; criterion
   3 requires that the software support or provide recommendations **to a
   health care professional**. Amani is used by patients, so the CDS exclusion
   is not available for its patient-facing functions.
5. **Enforcement discretion** — FDA's *Policy for Device Software Functions and
   Mobile Medical Applications* describes patient-facing functions FDA does not
   intend to regulate, including functions that help patients organise and
   track their health information, give easy access to information about their
   health conditions, or help them communicate with their providers.
6. **Multiple-function products** — FDA's *Multiple Function Device Products*
   guidance: a device function does not make the whole app a device, and
   non-device functions are assessed separately.
7. **Fertility and contraception** — software intended to predict fertile days
   for contraception is a regulated device (FDA has authorised such software as
   a medical device). Fertility-window reminders marketed for avoiding or
   achieving pregnancy would be assessed under that precedent.

## 4. Analysis (drafter's view, for counsel)

- **Low risk / likely non-device:** upload, extraction and display of the lab's
  own results and range (§520(o)(1)(D)); period and symptom tracking; questions
  for the doctor; general education.
- **Grey zone — interpretation and analysis:** showing a status word against
  the lab's own range is close to display. Re-scoring a hormone result
  against cycle-phase context, per-system scores, and multi-marker patterns
  that name possible conditions are "interpret or analyze" functions. As a
  patient-facing product they cannot use the CDS exclusion, so the positioning
  relies on (a) education framing with no diagnosis, (b) the enforcement-
  discretion categories for patient information, and (c) low risk.
- **Higher risk to avoid without a regulatory pathway:** any statement that a
  user *has* a condition; any treatment or dose recommendation (already blocked
  by `nutrient-policy.ts`); any risk score for a named disease; any fertility
  or contraception claim for the fertile-window and ovulation reminders;
  urgency or triage language.

## 5. Recommended positioning for discussion

1. Describe Amani as **educational lab-report organisation and explanation for
   the user to discuss with her clinician**, not as diagnosis or decision
   support.
2. Keep the provenance rule in DESIGN.md: the lab's facts shown as the lab's;
   Amani's reading marked as Amani's.
3. Keep patterns phrased as "can be seen with" and "worth discussing", never
   "you have" or "indicates"; keep the existing clinical-copy guards and the
   nutrient policy.
4. Add, with counsel's wording, a statement that cycle predictions and fertile-
   window reminders are **not for contraception or conception planning**.
5. Review whether per-system numeric scores should stay user-visible.
6. Marketing, App Store and Play listing copy follow the same rules; FDA
   judges intended use from all labeling, including ads.
7. Re-run this memo before launching any feature that adds a new analysis
   (V2-04 female context, trend alerts, retest-due reminders).

## 6. Related regimes (outside FDA) [lawyer]

FTC Act section 5 and the FTC Health Breach Notification Rule (health claims
and breach duties); state consumer-health-data laws (threat-model.md); Apple
App Store guideline 1.4.1 and 5.1.x on medical apps and health data; Google
Play health-apps policy.

## 7. [Pending] questions

1. Counsel's view of cycle-phase re-scoring of hormone results under the
   current General Wellness and CDS guidances.
2. Whether `health_scores` per-system scores are acceptable.
3. Required disclaimer wording for fertile-window and ovulation reminders.
4. Whether a pre-submission (Q-Sub) meeting with FDA is warranted before V2-04.
