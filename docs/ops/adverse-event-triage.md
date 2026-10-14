# Adverse-event triage: "Report a problem" (PK-HARM-01)

How problem reports about an interpretation are reviewed, when the clinical reviewer is
brought in, and how fast. Design decision D20 and the packet PK-HARM-01, owner-approved
2026-10-12/13.

**Status: DRAFT.** The response times and the escalation rules below are proposals for Adell
to approve. The help copy on the "Something here worried me" path is pending the clinical
reviewer (D7.9). Nothing here is live until the owner pushes
`supabase/migrations/20261015020000_interpretation_feedback.sql` and turns on
`features.interpretation_feedback` (docs/runtime-config.md).

## What she sees

The report header's More menu holds "Report a problem" (D19). It opens a chooser:

| Choice | Category stored | What happens next |
|---|---|---|
| A value is wrong | `value_wrong` | Optional note, then the row is stored. When `features.value_corrections` is on, PK-CORRECT-01's correction screen follows (not built in this packet). |
| The explanation is confusing or wrong | `explanation` | Optional note, then the row is stored. |
| Something here worried me | `worried` | First, where to get help: her clinician, or her local emergency number if she feels unwell now. Then an optional note. The row is stored with `clinical_review = true`. |
| Other | `other` | Optional note, then the row is stored. |

The note is optional, at most 1,000 characters, and carries a warning not to include anything
that identifies her. The app never promises a reply.

## Where the reports are

Table `public.interpretation_feedback`: `id`, `user_id`, `report_id`,
`interpretation_version_id` (the explanation that was on screen, when known), `category`,
`text`, `clinical_review`, `status`, `status_changed_at`, `created_at`.

- She can add rows for her own reports and read her own rows. She cannot edit or delete them.
- Nobody can change what she sent. The review moves `status` only, and the server stamps
  `status_changed_at`.
- Rows are erased with her report and with her account (delete-user-data).

The queue, in the Supabase SQL editor (the owner's session) or any service-role client:

```sql
select * from public.interpretation_feedback_review_queue;   -- open rows, "worried" first, oldest first
```

To look at the report and the explanation she saw, use `report_id` and
`interpretation_version_id`. The id is a row of `interpretation_versions` when a version was
on screen, otherwise the historical interpretation row (Owner Ruling 2). Open only what the
review needs: the report holds her health data.

Moving a row through the queue:

```sql
update public.interpretation_feedback set status = 'in_review' where id = '<id>';
update public.interpretation_feedback set status = 'escalated' where id = '<id>';
update public.interpretation_feedback set status = 'closed'    where id = '<id>';
```

| Status | Meaning |
|---|---|
| `new` | Not yet looked at. Every row starts here. |
| `in_review` | Someone is looking at it. |
| `escalated` | Sent to the clinical reviewer, or to the breach plan (below). |
| `closed` | Done. It leaves the queue; the row stays until her report or account is deleted. |

## Who reviews

| Role | Person | Does |
|---|---|---|
| Queue owner | Mohammed | Reads the queue on each working day, sorts rows, fixes or files engineering problems, escalates. |
| Clinical reviewer | [Pending] hire (D7.9) | Reviews every `clinical_review` row and any row escalated as clinical. Decides whether the explanation was clinically wrong or unsafe and what changes. |
| Decision maker | Adell | Approves fixes to clinical content, copy and the policy; decides anything that reaches the breach plan. |

Until a clinical reviewer is in place, `worried` rows go to Adell, who decides what to do with
them. Nobody on the team gives her clinical advice in reply.

## Response times (proposed; [Pending] Adell)

| Row | First look | Clinical reviewer |
|---|---|---|
| `worried` (`clinical_review = true`) | within 1 working day | within 2 working days of the first look |
| any row that reads as possible harm (below) | within 1 working day | within 2 working days of the first look |
| `value_wrong`, `explanation`, `other` | within 5 working days | only when escalated |

There is no alert yet: the queue is read by hand. An alert when a `worried` row arrives is a
follow-up ([Pending] the alert destination, owner action T6).

## Escalate to the clinical reviewer when

- the category is `worried`;
- the note says the explanation led her to stop, start or change a medicine, a supplement or a
  treatment, or to delay care;
- the note says the explanation contradicts what her clinician told her;
- the explanation she saw appears to break the nutrient policy
  (`supabase/functions/_shared/nutrient-policy.ts`): a dose, a banned supplement or prescriptive
  language;
- a value is wrong in a way that changed the explanation's message (a wrong unit, a misread
  decimal).

The clinical reviewer records the outcome in the queue (status) and in the team's issue
tracker, without copying her note or her values into the tracker.

## Engineering follow-up

- A misread value: file a parser issue with a synthetic reproduction. Never attach her file or
  her values.
- A wrong or confusing explanation: file it against the interpretation pipeline. A change to
  the nutrient policy goes in `_shared/nutrient-policy.ts` only, with its tests.
- Content that only the clinical reviewer can approve stays disabled until approved
  (clinical authority rule).

## Hand-off to the breach plan

Go to `docs/ops/breach-response-plan.md` at once when a report suggests that someone else's
data was shown to her, that her data reached someone it should not have, or that the note
itself contains another person's identifying details.

## Open questions

- [Pending] Adell: approve the response times above.
- [Pending] Clinical reviewer: the help copy on the "Something here worried me" path (D7.9).
- [Pending] Lawyer: whether any report must be passed to a regulator (for example, whether
  Amani's role means FDA adverse-event reporting applies; Amani is presented as educational).
- [Pending] Lawyer and Adell: whether, and how, the team may reply to her about a report.
- [Pending] Adell: how long a closed row is kept while her report and account exist.
