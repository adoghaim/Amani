# Breach response plan

**DRAFT for lawyer review. Not legal advice.** Written by the engineering factory (PK-HARM-01)
from public summaries of the rules. Every legal statement below, every deadline and every
threshold must be checked by counsel before this plan is relied on. Where the plan and counsel
disagree, counsel wins. Where the plan and an owner ruling disagree, Adell decides.

Amani holds reproductive and other health data: lab reports, extracted values, cycle logs,
symptoms and AI explanations. Treat any unauthorized access to, or disclosure of, that data as a
possible breach until counsel says otherwise.

## Roles

| Role | Person | Responsibility |
|---|---|---|
| Decision maker | Adell (product owner) | Declares an incident and a breach, approves every notification, approves spending (forensics, counsel). |
| Coordinator | Mohammed | Runs the response: containment, evidence, the timeline, vendor contacts, drafts of every notice, the incident log. |
| Counsel | [Pending] lawyer | Decides which laws apply, who must be told and by when; reviews every notice before it goes out. |
| Clinical reviewer | [Pending] hire | Advises when the data involved could lead to harm (for example, a person acting on someone else's results). |

If Adell cannot be reached within 4 hours of a suspected breach, Mohammed contains and
preserves evidence (steps 1 and 2) without waiting. No notification goes out without Adell.

## Which rules may apply (to be confirmed by counsel)

### FTC Health Breach Notification Rule (16 CFR Part 318)

Amani is a direct-to-consumer app, not a HIPAA covered entity or business associate as far as the
team knows ([Pending] counsel to confirm). The FTC rule covers vendors of personal health records
(PHR) and PHR-related entities that are not covered by HIPAA. As amended in 2024 (effective
29 July 2024), it covers health apps that draw health information from more than one source, and
a "breach of security" includes an unauthorized disclosure the user did not authorize, not only a
hack.

Who must be told, and when (public summary of the rule; counsel to verify):

| Who | When | How |
|---|---|---|
| Each affected person | Without unreasonable delay, and no later than 60 calendar days after the breach is discovered | Email (if she gave it as a contact method), plus one of text message, in-app message or an electronic banner; or first-class mail. Substitute notice (website or media) where contact details are out of date for 10 or more people. |
| The FTC, 500 or more people | At the same time as the notice to individuals, and within 60 calendar days of discovery | The FTC's online notification form. |
| The FTC, fewer than 500 people | Within 60 calendar days after the end of the calendar year in which the breach was discovered (a yearly log) | The FTC's online notification form. |
| Prominent media | When 500 or more residents of one state (or D.C., or a territory) are affected: within 60 calendar days of discovery | Press release or media notice in that state. |

A breach is treated as discovered on the first day it is known, or would reasonably have been
known, to anyone at Amani or its service providers. A service provider must tell Amani within
60 calendar days of its own discovery.

What each notice to individuals must say (per the amended rule; counsel to verify):

1. What happened, including the date of the breach and the date it was discovered, if known.
2. The types of health information involved (for example, lab values, cycle history, diagnoses
   mentioned in a report).
3. The full name or identity of any third party that acquired the data, if known.
4. Steps she can take to protect herself.
5. What Amani is doing to investigate, limit the harm and prevent it happening again.
6. How to contact Amani: at least two of a toll-free number, an email address, a website, an
   in-app channel or a postal address.

Violations carry civil penalties per violation, adjusted for inflation each year ([Pending]
counsel: current figure).

### State breach-notification laws (summary; counsel to verify)

Every U.S. state, D.C. and the territories have a breach-notification law. Many treat medical or
health information as covered personal information, and several set deadlines shorter than the
FTC's. Counsel decides which states apply from where affected users live. Examples to check
first (figures from public summaries, to be verified):

| State | Individuals | Regulator |
|---|---|---|
| California (Civ. Code 1798.82) | Most expedient time possible, without unreasonable delay; medical and health insurance information are covered | Sample notice to the Attorney General when more than 500 residents are notified |
| Colorado (C.R.S. 6-1-716) | No later than 30 days after determining a breach occurred | Attorney General when 500 or more residents |
| Florida (Fla. Stat. 501.171) | No later than 30 days | Department of Legal Affairs when 500 or more residents |
| Washington (RCW 19.255.010) | No later than 30 days | Attorney General when more than 500 residents |
| Texas (Bus. & Com. Code 521.053) | No later than 60 days | Attorney General no later than 30 days when 250 or more residents |
| New York (Gen. Bus. Law 899-aa) | Most expedient time possible | Attorney General, Department of State and State Police |

Also for counsel: Washington's My Health My Data Act and similar consumer-health-data laws
(Nevada, Connecticut) may bear on reproductive data; and non-U.S. users (if any) may bring other
regimes (for example the GDPR's 72-hour regulator notice). [Pending] counsel.

Plan to the **shortest** deadline that applies, not the FTC's 60 days.

## Timeline

T0 is the moment anyone at Amani, or a vendor, first has reason to believe a breach may have
happened.

| When | Step | Owner |
|---|---|---|
| T0 | Open the incident log (below). Tell Adell. | Whoever noticed |
| T0 + 1 hour | **Contain** (step 1). | Mohammed |
| T0 + 4 hours | **Preserve evidence** (step 2). | Mohammed |
| T0 + 24 hours | First assessment to Adell: what data, whose, how many, still happening or not. Adell decides whether to call counsel and declare a breach. | Mohammed, Adell |
| T0 + 48 hours | Counsel engaged; vendors contacted where they are involved (step 3). | Adell, Mohammed |
| T0 + 10 days | Scope settled: the list of affected people and states. Notices drafted. | Mohammed, counsel |
| Shortest legal deadline, target 30 days | Notices sent to individuals, regulators and media as counsel directs (step 4). | Adell approves, Mohammed sends |
| After | Post-incident review; fixes tracked to completion (step 5). | Mohammed |

## Step 1: contain

- Revoke the exposed access: rotate the affected keys and secrets (by name, for example
  `OPENAI_API_KEY`, the Stripe secret keys, the Supabase service role key), sign out affected
  sessions, disable the affected function or flag (`features.*`, or the AI kill switch).
- Do not delete data, accounts, logs or storage objects while containing: they are evidence.
- Every production change in this step is an owner action and goes in the incident log with the
  time and who did it.

## Step 2: preserve evidence

- Export the logs before they age out of the vendor's retention window: Supabase API, Auth,
  Postgres and Edge Function logs; Netlify deploy and function logs; Stripe and RevenueCat event
  logs; OpenAI usage. [Pending] confirm each vendor's log retention on Amani's plans.
- Record the deployed versions: the git commit on Netlify, the edge function versions, the
  migration history.
- Keep exports in one restricted location with a hash and a note of who exported what and when
  (chain of custody). Never copy health data into chat, email, tickets or the Second Brain.
- Write down the facts as they are learned, with times, in the incident log. Opinions and
  guesses are marked as such.

## Step 3: vendors

Contact the vendor when its system is involved, or when evidence needs its help. Use the
account's support route so the request is tied to Amani's account. [Pending] confirm each
contact below and record the account identifiers (names only, never secrets).

| Vendor | What it holds or does for Amani | Contact |
|---|---|---|
| Supabase | Database, auth, storage (lab files), edge functions, logs | Dashboard support ticket (project `eyfvqdnczorscwveaadv`); security reports to security@supabase.io ([Pending] confirm) |
| OpenAI | Generates interpretations from extracted values | Help center support from the organization account; security issues through OpenAI's published security and disclosure channels ([Pending] confirm the current route) |
| Stripe | Web subscriptions and payment records | Dashboard support; security@stripe.com ([Pending] confirm) |
| RevenueCat | In-app subscription records | Dashboard support ([Pending] confirm the security contact) |
| Netlify | Hosts the web app | Dashboard support ([Pending] confirm the security contact) |

Ask each vendor: what it saw, from when to when, which records, and whether it has notified
anyone. Note that a vendor that discovers a breach on its side must tell Amani (FTC rule: within
60 days), and Amani's own clock may already be running from that moment.

## Step 4: notify

Counsel decides who is notified. Adell approves every notice. Templates below are drafts.

### To an affected person (email, plus an in-app message)

> Subject: Important information about your Amani data
>
> We are writing to tell you about a security incident that involved some of your information
> in Amani.
>
> **What happened.** On [date], we learned that [plain description]. It happened between
> [date] and [date].
>
> **What information was involved.** [The types of information: for example, the lab values
> from reports you uploaded, your cycle dates.] [If known: the name of the party that obtained
> it.]
>
> **What we are doing.** We [contained it how], we are working with [counsel / investigators],
> and we have [changes made so it does not happen again].
>
> **What you can do.** [Specific steps.] If you are worried about anything in your health
> information, your clinician is the right person to talk to.
>
> **How to reach us.** [Two or more: email, toll-free number, in-app, postal address.]

### To the FTC

Use the FTC's online Health Breach Notification form. Have ready: the number of people affected,
the dates of the breach and of discovery, the types of data, a description, the steps taken,
and the contact person (Mohammed, with Adell as the decision maker).

### To the media (500 or more residents of one state)

> Amani, a lab-results app, is notifying [number] people in [state] that some of their health
> information was [accessed / disclosed] without authorization between [date] and [date]. The
> information involved [types]. Amani has [steps taken]. People who were affected are being
> notified directly. Questions: [contact].

### To a state regulator

Use the regulator's own form where it has one; otherwise a letter with the same facts as the
notice to individuals, the number of residents notified, and a copy of that notice.

## Step 5: after

- A written review within 2 weeks of closing: timeline, cause, what worked, what did not, and
  the fixes, each with an owner.
- Fixes ship as normal PRs with tests. Nothing about the incident's people or data goes into the
  repository.
- Update this plan with anything counsel corrected.

## Incident log (copy for each incident)

```
Incident: <short name>            Declared by: <Adell>        Status: open | contained | closed
T0 (first sign):                  Discovered by:
Data involved (types only):       People affected (count):     States:
Timeline (time, what, who):
Containment actions:
Evidence exported (what, where, hash, by whom):
Vendors contacted (who, when, reference):
Counsel advice (date, summary):
Notifications (who, when, how, approved by):
```

## Open questions

- [Pending] Counsel: confirm that the FTC Health Breach Notification Rule, and not HIPAA, governs
  Amani; confirm every deadline and threshold above; list the states and other regimes that apply.
- [Pending] Counsel: review the notice templates.
- [Pending] Adell: name a backup decision maker for when Adell is unreachable.
- [Pending] Mohammed: confirm every vendor contact and each vendor's log retention on Amani's plans.
