# Jarvis — proposing A/B tests in PostHog

Jarvis proposes experiments; it never creates, launches, pauses or ends them. A proposal becomes an approval
file; the owner approves; the experiment is then created interactively (PostHog UI or MCP with write access in
an attended session). PostHog docs: https://posthog.com/docs/experiments/creating-an-experiment ,
running-time calculator: https://posthog.com/docs/experiments/sample-size-running-time

## Preconditions (check before proposing)

1. **Instrumentation exists.** The primary metric's event appears in `posthog.top_events_7d`. If not, the first
   proposal is the instrumentation change (as a factory packet / PR), not the experiment.
2. **The surface is flag-ready.** Experiments run on PostHog feature flags evaluated in the app. Web changes ship
   via Netlify; native (Capacitor) builds need the flag code shipped in a store release first, so native-only
   experiments carry release lead time. Note which platform(s) the test covers.
3. **Enough traffic.** Estimate the running time (below). If it exceeds ~6 weeks, propose a bigger change, a
   higher-traffic surface, or a qualitative test instead.
4. **No collision.** Not overlapping another running experiment on the same surface/metric (check flags list).

## Never experiment on

- Clinical content: interpretation text, biomarker flagging, ranges, safety warnings, nutrient language,
  claim-authority rules, legacy-interpretation quarantine. These are governed by the repo's medical guardrails,
  not by conversion.
- **Basic-tier content expansion.** Variants must not give Basic users more content than the shipped rule
  allows (Basic no-expansion rule), and locked counts must stay truthful.
- Pricing shown in iOS/Android apps without checking App Store / Google Play rules and the RevenueCat offering
  setup; any price test needs explicit owner sign-off and is `risk: high`.
- Anything that changes data collection or consent without a privacy review.

## Good candidate surfaces for Amani

Landing page hero and CTA; signup friction (fields, social login order); onboarding to first lab upload
(empty-state copy, sample report preview, upload-from-photo vs PDF prominence); paywall framing and timing
(after first interpretation vs at upload limit), plan ordering, trial messaging (web); re-engagement emails
(Resend) for users who signed up but never uploaded; Doctor-questions export as a premium preview.

## Proposal format (fill all fields)

```
Name:            <surface>-<change>-<yyyymm>
Hypothesis:      Because <evidence, cited>, we believe <change> for <audience> will <increase/decrease> <metric>
                 by about <MDE> because <mechanism>.
Variants:        control = current; test = <exact copy/design; for copy, run it through the clinical-language rules>
Audience:        <platform(s)>, <new users only / all>, exclusions (internal users, test accounts)
Split:           50/50 (default) unless justified
Primary metric:  one metric, e.g. signup -> first lab upload within 7 days (funnel) [event names]
Secondary:       e.g. upload -> first interpretation viewed; premium conversion within 30 days
Guardrails:      premium conversion not down, refund/cancel rate not up, support contacts, crash/error rate,
                 claims-lint clean, no Basic-content expansion
Sample size:     baseline p = <from data>, MDE = <relative %>, ~n per variant = <calc>, current eligible traffic
                 = <per week> -> estimated <N> weeks (confirm in PostHog's calculator before launch)
Duration rules:  run full weeks (minimum 2 weeks to cover weekday cycles); no early stopping on peeks; decide at
                 the planned end unless a guardrail breaks
Decision rule:   ship if primary metric wins with PostHog's reported significance/probability and no guardrail
                 regresses; otherwise keep control and record the learning
Rollback:        set flag to 0% / end experiment; no data migration involved
```

### Sample-size rule of thumb (for the note only; PostHog's calculator is authoritative)

For a conversion rate p and an absolute lift d, two-sided alpha 0.05 and 80% power:
`n per variant ≈ 16 · p · (1 − p) / d²`.
Example: p = 0.20, detect +4 points (d = 0.04): 16 × 0.16 / 0.0016 = **1,600 per variant**. If the surface sees
400 eligible users a week, that is ~8 weeks for two variants — too slow; test a bigger change or a higher-traffic
surface.

## Reviewing running experiments (daily)

For each running experiment report: days running vs planned, exposure balance (flag a sample-ratio mismatch if
the split is far from planned), primary metric and guardrails as PostHog reports them, and one of:
**keep running / ready to decide (propose experiment_end with the decision) / stop early (guardrail broke)**.
Experiments past their planned end with no decision, and flags at 100% for more than two weeks, go into
"What to do next" as cleanup.
