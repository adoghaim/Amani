# Privacy entry draft: "Report a problem" (PK-HARM-01)

**DRAFT for lawyer review.** Proposed text for the Privacy Policy (`src/pages/Privacy.tsx`) once
`features.interpretation_feedback` is turned on. Not yet in the app: the policy page changes only
after counsel approves the wording. It sits with the reproductive-data consent design under
EXP-6.

## Proposed entry

> **When you report a problem with a report.** If you use "Report a problem" on a report, we
> store what you chose (for example, "A value is wrong"), the note you write, if any, which
> report and which explanation it was about, and when you sent it. We use it to find and fix
> mistakes in how Amani reads lab reports and writes explanations. If you choose "Something here
> worried me", a member of our team, and our clinical reviewer, may look at the report and the
> explanation you saw so we can check it. Please don't put your name, date of birth or other
> details that identify you in the note. We don't use these reports for advertising and we don't
> share them, except with the service providers that store our data for us. Reports are deleted
> when you delete that lab report or your account.

## Facts the entry rests on (for counsel)

- Stored in `public.interpretation_feedback` in Amani's Supabase project: user id, report id,
  the explanation's id (when known), the category, the optional note (at most 1,000 characters),
  a review status and timestamps.
- She can read her own reports through the API but cannot edit or delete them one by one; they
  are deleted with the lab report (database cascade) and with the account (delete-user-data).
- Read by the team through a service-role review queue (`docs/ops/adverse-event-triage.md`).
- Not sent to OpenAI or any other vendor beyond the database host (Supabase).

## Open questions

- [Pending] Counsel: wording, and whether the note counts as consumer health data under
  Washington's My Health My Data Act or similar laws (consent and deletion rights).
- [Pending] Adell: whether a closed report is kept until the lab report or account is deleted,
  or deleted sooner.
