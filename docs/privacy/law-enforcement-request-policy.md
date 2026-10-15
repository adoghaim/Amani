# Law-enforcement and legal-request policy

> **DRAFT for lawyer review. This is not legal advice.** PK-PRIV-01 (EXP-6).
> A proposed internal policy and the outline of a public statement. It takes
> effect only when the owner and counsel adopt it. Items in **[brackets]** need
> an owner or counsel decision.

## 1. Principles

1. **Legal process only.** Amani discloses user data to a government agency or
   a private litigant only in response to valid, binding legal process served
   on Amani in a jurisdiction where it is enforceable. No voluntary disclosure,
   no informal requests, no sale or sharing with data brokers.
2. **Reproductive health is protected to the limit of the law.** Amani treats
   requests that seek information about menstrual cycles, pregnancy, pregnancy
   outcomes, contraception or reproductive care as presumptively objectionable.
   Where the law allows, Amani challenges such requests, including by relying
   on any applicable state shield law **[counsel to list the shield laws that
   apply to Amani and to requesters]**.
3. **Notice to the user.** Amani tells the affected user before disclosure,
   with enough time to seek counsel, unless a court order or statute prohibits
   notice. If a gag order expires, Amani notifies the user then.
4. **Narrowest response.** Amani produces only what the process compels, for
   the named account and the stated period. It refuses bulk, "reverse",
   geofence-style or keyword requests to the extent the law allows.
5. **Minimisation first.** The best protection is not holding data:
   threat-model.md section 4 and data-retention-schedule.md list what Amani can
   stop collecting or keep only on the device.
6. **Transparency.** Amani publishes a yearly count of requests received, by
   type, and how it responded **[owner: start date]**.

## 2. Handling a request

| Step | Who | What |
|---|---|---|
| 1. Intake | Whoever receives it | Forward immediately to **[legal contact address, owner to set]**. Do not reply to the requester, do not confirm whether an account exists, do not touch the data |
| 2. Authenticate | Counsel | Verify the issuing authority and the requester independently (call back through a published number); fake "emergency" requests are a known attack |
| 3. Classify | Counsel | Subpoena, court order, search warrant, preservation request, emergency request, civil discovery, foreign request. Identify the jurisdiction and whether it concerns reproductive health |
| 4. Assess | Counsel + owner | Is it valid and enforceable against Amani? Is it overbroad? Does a shield law apply? Is notice prohibited? |
| 5. Notify the user | Owner | Unless prohibited, using the account e-mail |
| 6. Object or comply | Counsel | Seek to narrow or quash where grounds exist. If compelled, produce the minimum set. Produce only from the live database, never by restoring a backup of a deleted account |
| 7. Record | Owner | Log the request, the decision, what was produced, and the dates, in a restricted register outside the product database |

### Preservation requests

A preservation request (for example under 18 U.S.C. §2703(f)) asks Amani to
keep data while process is obtained. Amani preserves only the named account,
for the statutory period, and does not extend it without a renewal **[counsel
to confirm the procedure, and how preservation interacts with a user's
deletion request]**.

### Emergency requests

Amani may disclose without process only where it believes in good faith that
an emergency involving danger of death or serious physical injury requires it,
and only the minimum needed. A request about a pregnancy or its outcome is not
by itself an emergency of this kind. Every emergency disclosure is reviewed by
counsel afterwards and counted in the transparency report.

## 3. What Amani holds, and what it does not

For counsel's reference when assessing a request (detail in
data-retention-schedule.md):

- **Holds:** account e-mail and profile; uploaded lab files and extracted
  results; interpretations; period, symptom, cycle and intervention logs;
  reminders; billing state; security and audit events. Infrastructure
  providers' server logs include IP addresses (Privacy.tsx).
- **Does not hold:** location history, contacts, device sensor data, message
  content, advertising identifiers (the app has no advertising or analytics
  SDKs, per `src/pages/Privacy.tsx`).
- **Deleted accounts:** deletion is immediate in the live database; copies may
  remain in provider backups until they roll off and at OpenAI under its
  retention terms (ai-processing.md). Amani does not restore deleted data to
  answer a request **[counsel to confirm this is defensible]**.

## 4. Requests served on vendors

Supabase (hosting), OpenAI, Sentry, Stripe, Apple, Google and RevenueCat may
receive process directly. **[Counsel: confirm each vendor's policy on notifying
the customer, and add contract terms requiring notice and minimal
disclosure where available.]** OpenAI zero data retention, if granted, removes
the OpenAI copy entirely.

## 5. Public statement (outline for the privacy policy)

- We require valid legal process before disclosing your data.
- We will tell you about a request unless we are legally prohibited.
- We challenge requests about reproductive health to the extent the law
  allows.
- We publish a yearly transparency report.
- The safest data is data we never hold: here is what you can keep off our
  servers **[after minimisation decisions]**.

## 6. [Pending] decisions

1. Legal contact address and who is on call.
2. Which shield laws Amani can invoke, and in which states it operates.
3. Whether to publish the full policy or a summary.
4. Transparency report start date and format.
5. The interaction between a preservation request and a user's deletion
   request received afterwards.
