# BS1 — Stripe portal uses the real customer; deletion removes every customer and every file

- Track: **billing-stripe** · branch `factory/rv-billing-stripe` (already created at origin/main 22027b2; packets on a track run in order and build on each other)
- Reserved migration range: 20261023140000-20261023144999
- Harness: do NOT run `gates harness` (db-security owns the lock this wave)
- Review lenses after you: correctness + tests, security + privacy
- Files this packet owns (others may touch nearby code concurrently): supabase/functions/create-portal-session/**; supabase/functions/delete-user-data/**; supabase/functions/_shared/account-deletion*.ts; supabase/functions/_shared/<new stripe modules>
- Findings: F038, F029, F094, F036

## Decisions already made for you (follow them; deviations need evidence in your result)

1. Portal: resolve the customer the way delete-user-data does (stripe_customers where user_id = caller and deleted_at is null, then legacy users.stripe_customer_id). Never create a customer in the portal; with none, return a fixed 'no web subscription' error the UI handles.
2. delete-user-data: collect both ids, then cancel and delete each distinct customer; keep the existing deletion gate/409 semantics for live subscriptions (read the code and its tests first).
3. F036: page the storage list until a short page comes back, list once more, and refuse to delete the auth user while any object remains.
4. F033 sites here: create-portal-session (~105-115) and delete-user-data (~294-298): fixed client errors, details logged through _shared/phi-scrub.ts.
5. Extract decision logic into _shared modules behind ports with Vitest fakes (pattern: get-interpretation/index.test.ts). Add a network-mocked browser test of 'Manage via Stripe' if cheap.
6. Owner actions: find and delete subscription-less orphan customers in live Stripe; list users.stripe_customer_id values in production; redeploy create-portal-session and delete-user-data.

## Findings (verbatim from the 2026-10-23 review of main@22027b2; line numbers refer to that commit)

### F038 — Manage via Stripe opens the billing portal for a new, empty Stripe customer, so web subscribers cannot cancel or update their card in the app

- Location: `supabase/functions/create-portal-session/index.ts:55` · severity high · category billing-correctness · owner_action=False

**Evidence**

Reviewed main at 22027b2. Local main matches origin/main (git ls-remote), so pulling would have changed nothing. create-portal-session/index.ts:45-49 reads users.stripe_customer_id. When that is null, :55-87 creates a NEW Stripe customer (metadata supabase_user_id), writes it back with the service role, and :91-96 opens the portal for it. Checkout keeps the real customer somewhere else: stripe-checkout/index.ts:128-133 and :147-159 read and insert stripe_customers (metadata userId). `git grep stripe_customer_id` shows that create-portal-session:81 is the only writer anywhere. Migration 20260823000000:36 says 'Stripe webhook only', but stripe-webhook/index.ts never writes users. So every subscriber created by stripe-checkout who presses 'Manage via Stripe' (Billing.tsx:113-166, reached only when source==='stripe') gets a portal with no subscription, invoices or card. Later visits reuse the same orphan customer. Users are told they can cancel in the app: Terms.tsx:210-213, PricingPage.tsx:76, freemium/copy.ts:112, Billing.tsx:373. Side effect: the orphan customer (email and user id) survives account deletion, because delete-user-data/index.ts:116-131 returns only the stripe_customers id. That contradicts Privacy.tsx:437 ('deletes your customer record at Stripe'). This logic has been in place since Feb 2026 (git log). The function is deployed: an unauthenticated GET returns gateway 401, not NOT_FOUND. No test covers it. Verified by reading the code and git grep.

**Recommendation**

Look up the customer in stripe_customers (user_id = caller, deleted_at IS NULL), and fall back to users.stripe_customer_id only when that is absent. Never create a customer in the portal function; if there is none, return a 'no web subscription' error. Owner: list the users.stripe_customer_id values in production, confirm they are orphans with no subscriptions, delete them in Stripe, null the column, and tell current web subscribers how to cancel in the meantime. Add a unit test that pins the lookup. Make account deletion delete every customer id it finds.

**Verifier's note**

Confirmed on 22027b2. Local main matches origin/main per git ls-remote, so a pull would change nothing. create-portal-session/index.ts:45-96 reads only users.stripe_customer_id; when it is null it creates a new customer, saves it with the service role (the clamp trigger in 20260826000000:114 skips that write because auth.uid() is NULL), and opens the portal for that new customer. stripe-checkout:128-159 stores the real customer only in stripe_customers. git grep shows the portal function is now the only writer of users.stripe_customer_id: the retired create-checkout-session, which wrote both, was deleted in 5157701 on 2026-07-09. stripe-webhook never writes users. Billing.tsx:138-166 calls the function for source 'stripe', and every such user has a stripe_customers row because the stripe_user_subscriptions view joins it. So every web subscriber gets an empty portal. delete-user-data:116-131 returns the stripe_customers id first, so an orphan customer is never deleted at Stripe, which contradicts Privacy.tsx:437. No test, doc or owner ruling covers this. docs/designs/roadmap-gap-review.md:228 (2026-10-12) reports 0 production Stripe customers, so no live subscriber is affected yet and the owner clean-up step is probably moot. It is still a launch blocker for web billing, because Terms.tsx:210-213 promises in-app cancellation.

### F029 — The billing portal creates a second Stripe customer for web subscribers, and account deletion never removes it

- Location: `supabase/functions/create-portal-session/index.ts:55` · severity medium · category deletion · owner_action=False

**Evidence**

stripe-checkout records the customer mapping only in stripe_customers (stripe-checkout/index.ts:128-159). create-portal-session reads only users.stripe_customer_id (create-portal-session/index.ts:45-55). When that column is null, it creates a new Stripe customer carrying the user's email and supabase_user_id metadata and saves it there (:57-82). Grep shows create-portal-session is the only writer of users.stripe_customer_id. As a result, every web subscriber who opens Billing (src/pages/Billing.tsx:147) gets a second, empty customer, and the portal they see is for that empty customer, not the one that holds their subscription. At deletion, getStripeCustomerId returns the stripe_customers id first (delete-user-data/index.ts:116-131). Only that customer is cancelled and deleted (:133-157), and deleteLocalStripeRecords then nulls users.stripe_customer_id (:167), the only pointer to the portal-created customer. That customer, with the user's email and user id, stays in Stripe after the account is erased. Verification: code reading and grep; Stripe was not queried.

**Recommendation**

In create-portal-session, resolve the customer the way delete-user-data does (stripe_customers first, then the legacy column), and create one only when neither exists, writing it to stripe_customers. In delete-user-data, collect both ids and cancel and delete each distinct customer. Owner: search Stripe for subscription-less customers whose supabase_user_id metadata belongs to deleted accounts, and delete them.

**Verifier's note**

Verified by reading the code. stripe-checkout reads and writes only stripe_customers (index.ts:128-159). create-portal-session reads only users.stripe_customer_id (:45-55); when it is null, it creates a new customer carrying the email and supabase_user_id metadata and writes it there (:57-82). Grep over the functions and migrations shows no other writer and no sync trigger. Billing.tsx renders the manage button for source 'stripe' (subscriptionSource.ts:82-84), and active non-native users reach create-portal-session (Billing.tsx:118-147). Every web subscriber is therefore sent to a portal for an empty customer, so they cannot manage or cancel the real subscription there. delete-user-data returns the stripe_customers id first (:116-131), deletes only that customer (account-deletion.ts:427-432), then nulls the legacy pointer (:167), which orphans the portal-created customer in Stripe. Production currently has 0 Stripe customers, so this is latent but certain at launch.

### F094 — create-portal-session has no tests and opens an empty Stripe customer for current web subscribers

- Location: `supabase/functions/create-portal-session/index.ts:45` · severity high · category correctness · owner_action=False

**Evidence**

The function reads only the legacy users.stripe_customer_id (index.ts:45-55). When that is null it creates a new Stripe customer, writes it to users (57-82) and opens the billing portal for it (91-96). stripe-checkout records customers only in stripe_customers (stripe-checkout/index.ts:128-133, 147-159). No other code in supabase/functions writes users.stripe_customer_id (grep), and delete-user-data/index.ts:117 calls stripe_customers 'current' and the users column 'legacy'. So an active web subscriber who taps 'Manage via Stripe' (Billing.tsx:110, 147) gets a portal for a brand-new customer with no subscription to cancel or update, and later visits reuse that empty customer. Account deletion erases only the stripe_customers customer (delete-user-data/index.ts:116-131), so the portal-created customer survives erasure; it holds the user's email and supabase_user_id metadata (create-portal-session/index.ts:58-63). Coverage: none of the 208 tracked test/spec files mentions create-portal-session, it is excluded from the Deno type check (docs/check-functions.sh:21), and no e2e spec reaches the Manage path. Verified by reading the three functions and Billing.tsx; not run against Stripe.

**Recommendation**

Resolve the customer the way delete-user-data does: stripe_customers first, then the legacy column. Never create a customer for an existing subscriber. Add a handler test with injected Supabase/Stripe fakes, using the technique in get-interpretation/index.test.ts, plus a browser test of Manage via Stripe. Find and delete any orphaned customers already created.

**Verifier's note**

Confirmed by reading. create-portal-session reads only users.stripe_customer_id (index.ts:45-55); when it is null it creates a customer, links it and opens the portal for it (:57-96). stripe-checkout writes only stripe_customers (:128-159). A grep finds no function, webhook or migration trigger that writes users.stripe_customer_id. Billing.tsx:105-166 sends source 'stripe' to this function. So an active web subscriber gets an empty portal with no subscription to cancel. Erasure resolves one id, preferring stripe_customers (delete-user-data/index.ts:116-131), and account-deletion.ts:427-431 deletes only that customer, so the portal-created customer survives in Stripe with the user's email and user id. No tracked test mentions the function. It is excluded from the Deno check (check-functions.sh:21). SELECT on the column is still granted to authenticated (only UPDATE and INSERT were revoked). Not run against Stripe.

### F036 — Account deletion removes at most 1,000 stored lab files because it makes one unpaginated storage list call

- Location: `supabase/functions/delete-user-data/index.ts:177` · severity low · category deletion · owner_action=False

**Evidence**

deleteStorageFiles calls storage.from('lab-files').list(userId, { limit: 1000 }) once and removes only what that single page returns (delete-user-data/index.ts:177-182). There is no offset loop, and nothing checks that the prefix is empty before deleteAuthUser runs (:228-231). Any objects past the first page outlive the account, and once the account is gone no one can trigger their cleanup. Uploads are flat <uid>/<ms>.<ext> objects (src/pages/NewReport.tsx:554-558), so this only affects heavy uploaders. Verification: code reading.

**Recommendation**

Page with an offset until a short page comes back, then list once more and refuse to delete the auth user while any object remains.

**Verifier's note**

Verified. deleteStorageFiles makes one list(userId, { limit: 1000 }) call and removes only that page (delete-user-data:177-182). There is no pagination loop, and deleteAuthUser runs afterwards (:228-231) with no check that the prefix is empty. Uploads are flat <uid>/<ts>.<ext> files (NewReport.tsx:558). It only affects accounts with more than 1,000 objects, which is improbable, so low.

