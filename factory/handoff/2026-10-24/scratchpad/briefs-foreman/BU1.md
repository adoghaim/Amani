# BU1 — Billing labels from the real entitlement; an honest deletion warning

- Track: **billing-ui** · branch `factory/rv-billing-ui` (already created at origin/main 22027b2; packets on a track run in order and build on each other)
- Reserved migration range: none — this track adds no migrations (if one is unavoidable, stop and put it under handoffs)
- Harness: do NOT run `gates harness` (db-security owns the lock this wave)
- Review lenses after you: correctness + tests
- Files this packet owns (others may touch nearby code concurrently): src/features/settings/sections/AccountSection.tsx; src/features/settings/sections/DeleteAccountSection.tsx; src/pages/Billing.tsx
- Findings: F047, F045

## Decisions already made for you (follow them; deviations need evidence in your result)

1. F047: drive the Settings and Billing labels from useSubscription().source and entitled, as Dashboard and SubscriptionStatus already do; stop reading users.subscription_status in the client. Tests for freemium off/on, Stripe, store and lapsed states.
2. F045: the in-app deletion warning says, when a Stripe subscription is live, that it is cancelled immediately and the remaining period is not refunded — match what delete-user-data actually does (read it); word the Android warning per the recommendation. Terms/Privacy wording is owner/lawyer work → owner_actions.

## Findings (verbatim from the 2026-10-23 review of main@22027b2; line numbers refer to that commit)

### F047 — With freemium off (production today), Settings shows every paying subscriber as 'Trial' and Billing shows lapsed customers as on a free trial

- Location: `src/features/settings/sections/AccountSection.tsx:30` · severity low · category billing-copy · owner_action=False

**Evidence**

With the flag off, AccountSection.tsx:30 prints userProfile.subscription_status. That column defaults to 'trial' (20260216193045_initial_schema.sql:72), is forced to 'trial' on insert and frozen on update (20260826000000_privileged_columns_client_compat.sql:94, :120), and is never written; SubscriptionStatus.tsx:9-14 says the same. Billing.tsx:315-326 uses the same column for users who are not active, so expired-trial and lapsed paying users see 'Status: Free Trial, Days Remaining: 0 days'. The 'Status: Expired' branch (:327-336) can never run, and :411 has the same test. The Oct 17 smoke fix (docs/qa/2026-10-17-smoke-fixes/README.md, item 2) fixed only the flag-on path. Verified by reading the code.

**Recommendation**

Drive both labels from useSubscription().source and entitled, as Dashboard and SubscriptionStatus already do. Then stop reading users.subscription_status in the client.

**Verifier's note**

Confirmed. With the flag off, AccountSection.tsx:30 prints users.subscription_status. That column defaults to 'trial', the clamp triggers force and freeze it (20260826000000:94, :120), and nothing on the server writes it; SubscriptionStatus.tsx:9-14 says the same. isActive excludes the trial (subscriptionSource.ts:68-75), so expired-trial and lapsed paying users reach Billing.tsx:315-326 and see 'Free Trial, 0 days', and the Expired branch (:327-336) cannot run. docs/qa/2026-10-17-smoke-fixes item 2 kept the flag-off behaviour on purpose, as a scope choice rather than a ruling that it is right. Wrong labels only; entitlement is unaffected.

### F045 — What account deletion tells users about billing does not match what it does

- Location: `src/features/settings/sections/DeleteAccountSection.tsx:125` · severity low · category billing-copy · owner_action=False

**Evidence**

delete-user-data cancels Stripe subscriptions immediately with stripe.subscriptions.cancel, with no proration or refund (delete-user-data/index.ts:133-147). The confirmation list (DeleteAccountSection.tsx:123-130) mentions only data. It never says a web subscription ends now and the unused period is lost, while Terms.tsx:199-200 says cancelling takes effect at the end of the paid period. For the stores: once the Google Play credential listed under factory/STATUS.md owner actions is set, store-teardown.ts:121 and :461-503 cancel Play subscriptions server-side (DEVELOPER_REQUESTED_STOP_PAYMENTS, which cannot be restored). Yet the server's 409 message (account-deletion.ts:112-117), the UI (DeleteAccountSection.tsx:146), Terms.tsx:229-230 and Privacy.tsx:453-456 all say deletion does not cancel it. Privacy.tsx:437 ('deletes your customer record at Stripe') is untrue for users who have the orphan portal customer from the first finding. Verified by reading the code and the copy.

**Recommendation**

When a Stripe subscription is live, add a line to the deletion warning saying it will be cancelled immediately and the remaining period is not refunded (or prorate the refund and say so). Have the 409 body say whether Play server-side cancellation is enabled, and word the Android warning, Terms and Privacy to match. Legal copy changes need owner approval.

**Verifier's note**

Confirmed but mostly latent. delete-user-data:133-147 calls stripe.subscriptions.cancel with no prorate or invoice_now, so the cancellation is immediate with no credit, while the confirmation list (DeleteAccountSection.tsx:123-130) mentions only data. Once a Play credential is set, account-deletion.ts:422-424 and store-teardown.ts:121 and :461-503 cancel Play subscriptions with DEVELOPER_REQUESTED_STOP_PAYMENTS, but the 409 message (account-deletion.ts:112-117), DeleteAccountSection.tsx:146, Terms and Privacy all say deletion does not cancel them. factory/STATUS.md still lists that credential as an unset owner action, so the Android copy is accurate today. The Privacy.tsx:437 mismatch depends on finding 0. This is copy accuracy only.

