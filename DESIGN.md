---
# gstack: design-md-format=spec
name: Amani
description: Clinical-warm paper. Her lab's facts set cleanly on warm ivory, with Amani's reading and her own changes on top, each marked as whose it is.
colors:
  primary: "#95617C"
  primary-dark: "#7A4963"
  primary-light: "#E1C1D0"
  primary-faded: "#AD8197"
  on-primary: "#FFFFFF"
  accent: "#0D2033"
  background: "#FBF7F5"
  background-tint: "#F5F0F3"
  surface: "#FFFCFB"
  surface-2: "#EDE5EB"
  surface-hover: "#E7D8E2"
  text: "#0D2033"
  text-body: "#323F54"
  muted-text: "#4D5569"
  muted-text-2: "#606377"
  muted-text-3: "#716F82"
  pen: "#2A44B8"
  border: "#D2C6CF"
  border-subtle: "#E3DBE0"
  border-inner: "#EDE8EB"
  success: "#197F5C"
  warning: "#986600"
  warning-dark: "#7F4E00"
  danger: "#B94A5D"
  danger-dark: "#9E3247"
  neutral-50: "#F6F3F6"
  neutral-100: "#EEE8ED"
  neutral-200: "#DAD3D8"
  neutral-300: "#BBB1B9"
  neutral-400: "#736F7C"
  neutral-500: "#626071"
  neutral-600: "#4E4F63"
  neutral-700: "#333B4E"
  neutral-800: "#202E42"
  neutral-900: "#0D2033"
  flag-ok: "#077754"
  flag-ok-bg: "#E4EEE9"
  flag-ok-border: "#BCD6C9"
  flag-watch: "#905D00"
  flag-watch-bg: "#F3EBE1"
  flag-watch-border: "#DFCDB6"
  flag-low: "#B04356"
  flag-low-bg: "#F9E8EA"
  flag-low-border: "#EFC6CA"
  info: "#097099"
  info-bg: "#E3EDF4"
  info-border: "#BBD3E2"
  cat-medication: "#943E5D"
  cat-supplement: "#643E00"
  cat-diet: "#5F6E08"
  cat-exercise: "#10779F"
  cat-sleep: "#4F4498"
  cat-sleep-bg: "#E7E5F4"
  cat-sleep-border: "#C3BEE3"
  phase-menstrual: "#8D435E"
  phase-menstrual-bg: "#F5E8EB"
  phase-follicular: "#945843"
  phase-follicular-bg: "#F3E9E6"
  phase-ovulatory: "#955276"
  phase-ovulatory-bg: "#F4E8ED"
  phase-luteal: "#414379"
  phase-luteal-bg: "#E9EAF4"
typography:
  display:
    fontFamily: Fraunces Variable
    fontWeight: 600
    fontSize: 1.875rem
    lineHeight: 1.25
    letterSpacing: -0.015em
    fontVariation: "'opsz' 40"
  heading:
    fontFamily: Fraunces Variable
    fontWeight: 600
    fontSize: 1.5rem
    lineHeight: 1.25
    letterSpacing: -0.015em
    fontVariation: "'opsz' 40"
  subheading:
    fontFamily: Fraunces Variable
    fontWeight: 600
    fontSize: 1.125rem
    lineHeight: 1.35
    letterSpacing: -0.01em
    fontVariation: "'opsz' 40"
  body:
    fontFamily: Instrument Sans Variable
    fontWeight: 400
    fontSize: 1rem
    lineHeight: 1.6
  body-small:
    fontFamily: Instrument Sans Variable
    fontWeight: 400
    fontSize: 0.875rem
    lineHeight: 1.45
  label:
    fontFamily: Instrument Sans Variable
    fontWeight: 500
    fontSize: 0.875rem
    lineHeight: 1.4
    letterSpacing: 0
  caption:
    fontFamily: Instrument Sans Variable
    fontWeight: 400
    fontSize: 0.75rem
    lineHeight: 1.4
  mono:
    fontFamily: IBM Plex Mono
    fontWeight: 400
    fontFeature: tnum
  data-value:
    fontFamily: IBM Plex Mono
    fontWeight: 500
    fontSize: 1.0625rem
    fontFeature: tnum
rounded:
  sm: 4px
  md: 8px
  lg: 12px
  xl: 16px
  full: 9999px
spacing:
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 32px
  2xl: 48px
  touch-target: 44px
  gutter-phone: 16px
  gutter-tablet: 24px
  gutter-desktop: 32px
  card-padding: 24px
  page-header-gap: 28px
  content-max-width: 1280px
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    rounded: "{rounded.lg}"
    minHeight: "{spacing.touch-target}"
    boxShadow: 0 1px 2px rgba(13, 32, 51, 0.05)
  button-primary-hover:
    backgroundColor: "{colors.primary-dark}"
  button-secondary:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.text}"
    borderColor: "{colors.border}"
    rounded: "{rounded.lg}"
    minHeight: "{spacing.touch-target}"
  button-outline:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    borderColor: "{colors.border}"
    rounded: "{rounded.lg}"
    minHeight: "{spacing.touch-target}"
  button-ghost:
    backgroundColor: transparent
    textColor: "{colors.muted-text}"
    rounded: "{rounded.lg}"
    minHeight: "{spacing.touch-target}"
  button-danger:
    backgroundColor: "{colors.danger}"
    textColor: "{colors.on-primary}"
    rounded: "{rounded.lg}"
    minHeight: "{spacing.touch-target}"
  focus-ring:
    borderColor: "{colors.primary}"
    width: 2px
    offset: 2px
  input:
    backgroundColor: "{colors.surface}"
    borderColor: "{colors.border}"
    textColor: "{colors.text}"
    rounded: "{rounded.lg}"
    minHeight: "{spacing.touch-target}"
  input-error:
    borderColor: "{colors.flag-low}"
  card:
    backgroundColor: "{colors.surface}"
    borderColor: "{colors.border-inner}"
    rounded: "{rounded.xl}"
    padding: "{spacing.card-padding}"
  card-elevated:
    borderColor: "{colors.border-subtle}"
    boxShadow: 0 1px 2px rgba(13, 32, 51, 0.05), 0 4px 12px -6px rgba(13, 32, 51, 0.14)
  calm-notice:
    backgroundColor: "{colors.surface}"
    borderColor: "{colors.border-subtle}"
    iconColor: "{colors.primary}"
    titleColor: "{colors.text}"
    textColor: "{colors.text-body}"
    rounded: "{rounded.lg}"
  status-inside:
    textColor: "{colors.flag-ok}"
    backgroundColor: "{colors.flag-ok-bg}"
    borderColor: "{colors.flag-ok-border}"
    rounded: "{rounded.sm}"
  status-watch:
    textColor: "{colors.flag-watch}"
    backgroundColor: "{colors.flag-watch-bg}"
    borderColor: "{colors.flag-watch-border}"
    rounded: "{rounded.sm}"
  status-outside:
    textColor: "{colors.flag-low}"
    backgroundColor: "{colors.flag-low-bg}"
    borderColor: "{colors.flag-low-border}"
    rounded: "{rounded.sm}"
  lab-flag:
    textColor: "{colors.text}"
    borderColor: "{colors.text}"
    rounded: 3px
  amani-note:
    borderLeftColor: "{colors.primary}"
    borderLeftWidth: 3px
    labelColor: "{colors.primary-dark}"
    textColor: "{colors.text-body}"
  her-mark:
    textColor: "{colors.pen}"
  correction-strike:
    textColor: "{colors.muted-text-2}"
    decorationColor: "{colors.pen}"
    decorationThickness: 2px
  range-applies:
    backgroundColor: "{colors.phase-luteal-bg}"
    rounded: "{rounded.sm}"
  cycle-rule:
    height: 22px
    tickColor: "{colors.text}"
    rounded: "{rounded.sm}"
  more-menu:
    backgroundColor: "{colors.surface}"
    borderColor: "{colors.border-subtle}"
    rounded: "{rounded.lg}"
    itemMinHeight: "{spacing.touch-target}"
    boxShadow: 0 1px 2px rgba(13, 32, 51, 0.05), 0 4px 12px -6px rgba(13, 32, 51, 0.14)
  full-screen-gate:
    backgroundColor: "{colors.background}"
    textColor: "{colors.text}"
    paddingTop: 56px
  sample-banner:
    backgroundColor: "{colors.info-bg}"
    borderColor: "{colors.info-border}"
    textColor: "{colors.text}"
    rounded: "{rounded.lg}"
  nav-link:
    textColor: "{colors.muted-text}"
  nav-link-active:
    textColor: "{colors.text}"
    indicatorColor: "{colors.primary}"
---

# Amani

## Overview

**Creative North Star:** her lab's page, read with her. Amani never redraws the lab's report. It sets the lab's facts cleanly on warm paper and adds its reading on top, with every mark showing whose it is: the lab's, Amani's or hers.

**Memorable thing:** "Your labs, read against your cycle." This is the owner's answer and the live landing headline. Every choice below should serve it.

**Product context:** a women's health app for lab results, for women in the US whose results reach the patient portal before anyone explains them.
- She uploads a report. Amani places each value beside the range her lab printed, reads hormones against the cycle day of the test, and gives her questions to take to her clinician.
- Peers: Function Health, InsideTracker, Clue, Oura.
- Project type: a mobile-first web app, also shipped as iOS and Android apps through Capacitor.

**Mode per surface:**
- **Operate:** onboarding, consent, upload, Settings, export, cancel.
- **Read:** the report, the visit summary, Show your clinician mode.
- **Persuade:** the marketing landing page. It is the only place photography belongs.

**Reference sites** (researched 2026-10-13): functionhealth.com, insidetracker.com, helloclue.com, ouraring.com.

**Key characteristics:**
- Warm ivory paper with navy ink, calm on a phone at 10 pm.
- Every number set in a data face with tabular figures.
- The cycle day first, with a tick on the day her blood was drawn.
- Her lab's printed ranges kept and highlighted, never replaced.
- No red counts, no scores, no photography inside the app.

## Colors

**Strategy:** Committed. Lunar mauve is the one brand hue. Navy carries all text, and ivory is the ground. Status and cycle phase have their own tinted families, and nothing else adds colour.

**Light or dark:** light only, by decision. The use scene is a phone in the evening after a results notification, or her phone turned toward a clinician in an exam room. Both want paper, not a dark screen. There are no dark-mode tokens.

**Roles:**
- **Ink** (`text`, `text-body`, the muted ramp): every word and the lab's facts. Text ramps from navy toward mauve so faint text still reads as Amani.
- **Mauve** (`primary`, `primary-dark`): actions, focus rings, the active nav indicator, and the margin bar on Amani's notes.
  - It is never body text on a tint (it falls below 4.5:1 there) and never a status.
  - Link text uses `primary-dark`.
- **Pen** (`pen`, new): only for what she wrote, kept or corrected: corrected values, her notes, kept questions, dates she entered. It is never used for Amani's or the lab's words.
- **Status** (`flag-ok`, `flag-watch`, `flag-low`, each with `-bg` and `-border`): a short word ("inside", "below", "above") with an icon, after the range. Each foreground is solved against its own tint.
- **Info** (`info`, `info-bg`, `info-border`): informational states such as the sample banner. Never a result status.
- **Cycle phases** (`phase-*`, `phase-*-bg`): the cycle narrative, lightest at ovulation and deepest through the luteal phase.
  - The phase tints are almost identical to the status tints (OKLab dE 0.0055 between menstrual and low), so a phase band always carries a pattern as well as its tint, and phase tints are never used as status.
  - The patterns: period, dense diagonal hatching; follicular, sparse diagonal; ovulation, fine dots; luteal, cross-hatching.
- **Categories** (`cat-*`): intervention labels in the timeline, always spelled out, never bare swatches.

**Enforcement:**
- Every key maps to `theme.<key>` in `tailwind.config.js` (for example `bg-theme-primary`, `text-theme-pen`). `pen` is the one key to add there.
- `npm run validate:contrast` fails the build when a token used as text drops below 4.5:1 on the surface it sits on.

## Typography

Three faces, each with one job. All are bundled from Fontsource under OFL-1.1, because the native wrapper blocks external font loading.

- **Fraunces Variable** (`display`, `heading`, `subheading`): headings h1 to h3 only, never body.
  - It is set at 600 on the optical-size axis (opsz 40), with tight tracking and balanced wrapping. Its warmth comes from optical size, so weight stays restrained.
  - Fraunces is on gstack's overused-display list. It stays because it is the owner's shipped brand. Amani's distinct face comes from the data type and the cycle marks, not the headline face.
- **Instrument Sans Variable** (`body`, `body-small`, `label`, `caption`): every word read as interface, including Amani's notes.
  - Labels are sentence case at weight 500: no tracked capitals, no kickers above headings, no italics.
- **IBM Plex Mono** (`mono`, `data-value`): every value, unit, range, date in a table and cycle day, always with tabular figures (`.font-mono` or `.tnum`) so readings line up down a column.
  - Its unambiguous 0/O and 1/l matter when the number is a test result.
  - In running sentences only the numeral takes the data face ("Day 22"), not the words around it.
- **Scale:** a page title (`display`) is a clear step above a section (`heading`), which is a clear step above a subsection (`subheading`). Body is 1rem with line height 1.6.
- **Proposed, pending the owner (risk 4):** Atkinson Hyperlegible Next (OFL-1.1, verified on Google Fonts and Fontsource) for interface text, so I/l/1 and O/0 never blur in test names and units such as "HbA1c" or "mIU/mL".
  - This changes the shipped brand and needs a re-bundle, so it is not adopted until the owner decides.
  - The preview page compares both faces.

## Layout

- **Phone first:** one column at 375px with `gutter-phone` side gutters. `gutter-tablet` applies from 640px and `gutter-desktop` from 1024px, all centred within `content-max-width`.
- Layouts hold at 200% text size and at 375px width. Native safe areas are respected (`.safe-top`, `.safe-bottom`).
- **Page headers** (`PageHeader`) open every /app page: one title, an optional one-line description, and the page's primary action on the right on wide screens. `page-header-gap` separates the header from the content.
- **Read surfaces** (visit summary, Show your clinician mode) are one continuous sheet on `surface`. Rows are separated by spacing and hairlines, not cards.
- **Operate surfaces** use flat lists for Settings (in the fixed D25 order) and single-purpose screens for gates.
- **Report order:**
  1. Title, draw date and cycle day.
  2. The primary action and More.
  3. The notices slot.
  4. The cycle rule.
  5. Amani's reading.
  6. The result rows.
- Nothing is centred as a whole screen. Gates and notices are left-aligned, and gates sit in the top third.

## Elevation & Depth

- Surfaces are flat by default. Elevation means priority, so most cards and lists use a hairline border (`border-inner`) and no shadow.
- `card-elevated`, the More menu and buttons use the tinted shadows (`shadow-theme-sm`, `shadow-theme`, `shadow-theme-lg`). The shadows are offset and softly blurred in the navy ink, never neutral black and never a zero-offset glow.
- Modals sit on a 40% black scrim with a light blur, the one translucent layer in the system.

## Shapes

- **Controls** (buttons, inputs, notices, menus): `rounded.lg`.
- **Cards and lists:** `rounded.xl`.
- **Status tags, the range highlight and the cycle rule:** `rounded.sm`.
- **The lab's printed flag:** a 3px square badge, so it reads as printed rather than as an app chip.
- **Switches and progress dots:** `rounded.full`.
- **Nested shapes:** the inner radius equals the outer radius minus the gap.

## Components

Every control is at least `touch-target` (44px) tall with a visible label. Every component defines its loading, empty, error and long-content states, not only the happy path.

- **Button** (`button-*`): one solid primary per screen, in mauve.
  - **Hover:** the primary darkens to `primary-dark`.
  - **Focus-visible:** a 2px mauve ring with a 2px offset on the ground.
  - **Active:** the press scales to 0.98, off under reduced motion.
  - **Disabled:** 50% opacity.
  - **Sizes:** the small size keeps a 44px tap area even when it looks smaller. Today `sm` is about 32px and `md` about 40px tall, and both are fixed under this rule.
- **Input** (`input`, `input-error`): label above, hint or error below, linked with `aria-describedby`. Measurements use the data face (`numeric`).
- **Calm notice** (`calm-notice`, D7): three lines.
  - Content: what happened; what's safe ("Your reports and results are saved"); what to do next (one button).
  - It has an Info icon in mauve and is announced politely (`aria-live="polite"`).
  - It is never rose or error-coloured. `Alert` stays for genuine errors.
- **Full-screen gate** (`full-screen-gate`, D24): one layout for the update block, the lock screen, the consent steps, the under-18 exit and the AI-consent exit.
  - Content: the Amani logo; progress dots where steps apply; one heading (focus moves to it on open); one sentence; an optional "What this means"; one primary button; at most one quiet secondary link.
  - It never shows a cycle day or any health value. The lock screen especially.
- **Report header and More menu** (`more-menu`, D19): one primary action ("Generate full Amani analysis" when available, otherwise "Prepare for your visit") and a labelled More button.
  - The menu holds Prepare for your visit, Regenerate (N left), Report a problem and Delete report. Delete is last, behind its confirmation.
- **Notices slot** (R22): an ordered list of notices above the explanation, each a calm notice or nothing. Examples: "This explanation was written before you corrected a value" with Refresh explanation (R19); the pause notice (D12); regeneration failures.
- **Cycle rule** (`cycle-rule`): a straight rule for her cycle with one tick on the day her blood was drawn and patterned phase bands.
  - Phases are labelled "estimate for a 28-day cycle" (D10).
  - When no period is logged, the rule is empty with one line saying why. It never shows a guessed tick or a phase.
  - It is used on the report and under each cycle-dependent hormone.
  - The cycle ring (`CycleMark`, `CycleDial`) stays the brand mark and the dashboard's "today" dial. The ring answers "where am I today"; the rule answers "what did this number mean on the day it was drawn".
- **Result row:**
  - The test name, then the value in `data-value`.
  - Then every range the lab printed. When a lab prints several labelled ranges, the one matching her draw day gets the `range-applies` highlight in that phase's tint.
  - Then the status word with its icon. The lab's own flag (`lab-flag`, for example "L") stays exactly as printed.
  - No counts of results outside the range, and no scores.
- **Provenance:** every value and sentence shows whose it is.
  - **The lab**, in ink.
  - **Amani** (`amani-note`), behind a mauve margin bar labelled "Amani's reading".
  - **Her** (`her-mark`), in pen, labelled "You corrected this value", "My notes" or "(you entered)".
  - **A correction** keeps the misread value visible with `correction-strike` next to her value, everywhere it appears: report, trends, compare, visit summary, export.
- **Correction check** (R23): when a corrected value is more than 10 times higher or lower than what Amani read, one confirm step asks before saving: "That's very different from what we read (X). Is that what your report says?"
- **Visit summary and Show your clinician mode** (D6, D11, D21, D28): one sheet, in this order:
  1. Questions to discuss (kept ones in pen, printed first).
  2. My notes (pen).
  3. Draw date and cycle day ("CD22 · last period started 16 Sep (you entered)").
  4. Values outside her lab's range.
  5. All values.
  6. Changes since the last report.
  7. The disclaimer and provenance footer.
  - Clinician mode is the same content, full screen, with larger type and no app menus.
- **Settings rows** (D25): Account, Health profile, Reminders, Privacy & security, Your data, with Delete my data last.
  - **Reminders** say when notifications are off at the phone level, with a link to the phone's settings (D14).
  - **The Face ID lock** row says screenshots are blocked on Android while the lock is on (R15).
- **Export row** (D27, R20, R21):
  1. "Preparing your file… You can leave this page."
  2. "Your file is ready. Download (available for 24 hours)."
  3. After expiry: "This file has expired. Prepare a new one."
  - A failure shows the calm notice with Try again.
- **Sample banner** (`sample-banner`, D26): fixed "Sample, not your results" with Upload your own.
- **Reminders card** (D14): one yes/no card after her first report. The phone's permission prompt appears only on Yes.
- **Promo code** (D17, D29): a "Have a promo or referral code?" link above every signup route opens one labelled field. It accepts [A-Za-z0-9._-] up to 64 characters and confirms with "Code saved: KEY".

## Do's and Don'ts

- **Do:**
  - Lead each report with the draw date and the cycle day, the numeral in the data face.
  - Show every range the lab printed and highlight the one that applies.
  - Mark who said it: the lab in ink, Amani behind the mauve bar, her in pen.
  - Give every control a 44px tap area and a visible label.
  - Pair every status colour with a word and an icon.
- **Don't:**
  - Use mauve as text on a tint, for status, or for decoration.
  - Count results outside the range, or score her health.
  - Show a phase when no period is logged, or a cycle day on a gate or lock screen.
  - Use a phase tint without its pattern, or next to a status tint without one.
  - Nest cards, centre whole screens, add photography inside the app, or put a pill label or kicker above a heading.
  - Use the catalog's tempting entries: a heart icon, a progress ring as decoration, a health score, red badge counts.

## Motion

- **Approach:** minimal-functional.
- **Easing:** enter ease-out, exit ease-in, move ease-in-out.
- **Duration:** colour and shadow changes run 150 to 200ms; nothing runs longer.
- **The one authored moment:** the 0.98 press on a button, so a tap feels answered on a phone. There is no other animation, by decision (D23), and the global reduced-motion rule turns every transition off.

## Decisions Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-10-13 | Initial design system created | /design-consultation codified the shipped brand (palette, Fraunces, Instrument Sans, IBM Plex Mono, light only) after category research (Function Health, InsideTracker, Clue, Oura) and an independent Claude design voice |
| 2026-10-13 | Memorable thing: "Your labs, read against your cycle." | The owner's answer; it is the live landing headline |
| 2026-10-13 | Provenance on every value (lab ink, Amani's margin bar, her pen) | Adopted from the outside voice; corrections, stale explanations, notes and clinician mode follow one rule |
| 2026-10-13 | New `pen` colour token | Her own marks need a colour no other voice uses; it clears 7.5:1 on the ground |
| 2026-10-13 | Cycle rule for the draw day; the ring stays for today | The report's question is what a number meant on the day it was drawn |
| 2026-10-13 | Phase bands always patterned | Shipped phase tints match the status tints (OKLab dE 0.0055) |
| 2026-10-13 | Her lab's ranges highlighted, never replaced; no counts or scores | Matches "invent no ranges" and keeps the first read calm |
| 2026-10-13 | 44px minimum on every control | D23; Button sm and md and the Modal close fall short today |
| 2026-10-13 | Proposed, pending the owner: Atkinson Hyperlegible Next for interface text | Disambiguates I/l/1 and O/0 in test names and units; changes the shipped brand |
