# Setting up Amani's business accounts and Jarvis credentials

Links were checked against the vendors' official docs in October 2026. Platforms change their access programs
often: where a review or approval is involved, **check the current docs** before relying on any timeline here.
No durations below are guesses; where a vendor publishes one it is quoted with its source.

## Ground rules for every account

1. **Owned by the business, not a person.** Use a shared brand mailbox (e.g. `social@amanibiometrics.com`) as
   the login/recovery email, store credentials in a password manager, and turn on 2-factor auth everywhere.
2. **Same identity everywhere:** name "Amani" (or "Amani Biometrics"), handle reserved consistently (decide one,
   e.g. `@amanibiometrics`), same logo, bio, link `https://amanibiometrics.com`, category "Health/Wellness app" or
   "Software/App" — not "Medical" or "Doctor".
3. **Bios follow the clinical-language rules** (prompts/marketing.md): educational, no diagnosis/treatment claims.
4. **Credentials go only into `jarvis/.env`** on the machine running Jarvis. Never into the repo, chat or the
   Second Brain (variable names only).
5. **Read first, publish later.** Day-1 Jarvis needs only read access. Publishing scopes are requested later,
   when you decide to let Jarvis execute approved posts.

## What is needed when

| Service | Day-1 read-only report | Later (publishing / ads) | Review / approval involved |
|---|---|---|---|
| Claude Code login | **Required** | – | – |
| GitHub (`gh`) | **Required** | – | – |
| PostHog | **Required** | Experiments/flags write via attended session | – |
| Stripe | Recommended | – | – |
| RevenueCat | Recommended | – | – |
| Netlify | Recommended | – | – |
| Supabase (read-only role) | Recommended | – | owner runs SQL manually (factory G3 gate) |
| App Store Connect API | Recommended | – | – |
| Google Play Developer API | Recommended | – | – |
| Search Console / GA4 | Recommended (Search Console) | – | – |
| Slack webhook / Resend (report delivery) | Optional | Resend for approved marketing email | domain verification |
| Instagram + Facebook Page | When created | Content publishing | Meta App Review only for Advanced Access (see below) |
| TikTok | When created | Content Posting API | TikTok audit to post publicly |
| YouTube | When created | Uploads | quota; audit only to raise quota |
| Pinterest | When created | Pin creation | Pinterest app access review |
| LinkedIn Page | When created | Posting | Community Management API approval |
| X | Optional (paid reads) | Posting | pay-per-use billing |
| Reddit | Optional | – | Reddit approval required for API access |
| Meta Ads / Google Ads / TikTok Ads | When campaigns exist | Spend changes (approval-gated) | Google Ads developer-token access level |

---

## Day-1 (read-only reporting)

### Claude Code (subscription)
1. Install: https://code.claude.com/docs/en/setup
2. `claude auth login` and choose the Claude subscription account (not Console/API).
   Headless machine: `claude setup-token` → `CLAUDE_CODE_OAUTH_TOKEN`. Docs: https://code.claude.com/docs/en/authentication
3. `claude auth status` should show a subscription auth method. Do not set `ANTHROPIC_API_KEY`.

### GitHub
1. `gh auth login` on the Jarvis machine (https://cli.github.com/manual/gh_auth_login), or
2. a fine-grained PAT limited to `adoghaim/Amani` with read-only Contents, Metadata, Pull requests, Actions →
   `GH_TOKEN`; a second read-only PAT for the GitHub MCP → `GITHUB_MCP_PAT`.
   Docs: https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens

### PostHog
1. In PostHog, note the project ID and region (US: `https://us.posthog.com`, EU: `https://eu.posthog.com`).
2. Create a personal API key with the **MCP Server** preset scoped to the Amani project
   (https://app.posthog.com/settings/user-api-keys?preset=mcp_server) or a key with read scopes only.
   Docs: https://posthog.com/docs/api/personal-api-keys , MCP: https://posthog.com/docs/model-context-protocol/faq
3. Set `POSTHOG_HOST`, `POSTHOG_PROJECT_ID`, `POSTHOG_PERSONAL_API_KEY`, and the three event names
   (`POSTHOG_SIGNUP_EVENT`, `POSTHOG_ACTIVATION_EVENT`, `POSTHOG_PREMIUM_EVENT`) to match the app.
4. If the app is not instrumented yet (no PostHog SDK appears in the repo's `package.json` as copied), the report
   will say so. Capacitor SDK docs: https://posthog.com/docs/libraries/capacitor

### Stripe (restricted, read-only)
Dashboard → Developers → API keys → **Create restricted key**: Read on Subscriptions, Customers, Invoices,
Events; None on everything else → `STRIPE_RESTRICTED_KEY` (`rk_live_…`).
Docs: https://docs.stripe.com/keys/restricted-api-keys

### RevenueCat
Project settings → API keys → new **secret key, API v2**, read-only permissions where offered →
`REVENUECAT_API_V2_KEY`; project ID → `REVENUECAT_PROJECT_ID`.
Docs: https://www.revenuecat.com/docs/projects/authentication , API v2: https://www.revenuecat.com/docs/api-v2

### Netlify
User settings → Applications → Personal access tokens → new token with an expiry → `NETLIFY_AUTH_TOKEN`;
site `amani-biometrics` → Site configuration → Site ID → `NETLIFY_SITE_ID`.
Docs: https://docs.netlify.com/api-and-cli-guides/api-guides/get-started-with-api/
(Netlify PATs are not read-only scoped; keep this token only on the Jarvis machine.)

### Supabase (count-only, read-only)
1. Review `jarvis/sql/supabase-readonly-role.sql`, check the table names, set a strong password, run it in the
   SQL editor of project `eyfvqdnczorscwveaadv` (manual; not a migration).
2. Build the connection string with user `jarvis_readonly` (Project → Connect) → `SUPABASE_READONLY_DB_URL`.
3. Never use the `service_role` key for Jarvis. Docs: https://supabase.com/docs/guides/database/postgres/roles ,
   https://supabase.com/docs/guides/api/api-keys

### App Store Connect API
Users and Access → Integrations → App Store Connect API → generate a team key with the least-privileged role that
can read customer reviews (check the current role list) → download the `.p8` once (store outside the repo,
`chmod 600`) → `ASC_ISSUER_ID`, `ASC_KEY_ID`, `ASC_PRIVATE_KEY_PATH`; app's Apple ID → `ASC_APP_ID`.
Docs: https://developer.apple.com/documentation/appstoreconnectapi/creating-api-keys-for-app-store-connect-api ,
https://developer.apple.com/help/app-store-connect/get-started/app-store-connect-api

### Google Play Developer API
1. Google Cloud project → enable "Google Play Android Developer API" → create a service account
   (https://cloud.google.com/iam/docs/service-accounts-create) → JSON key.
2. Play Console → Users and permissions → invite the service account email with view-only app permissions
   (reviews / app information).
3. `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` (path), `GOOGLE_PLAY_PACKAGE_NAME`.
   Docs: https://developers.google.com/android-publisher/getting_started . Install/rating history: Play Console
   monthly reports (https://support.google.com/googleplay/android-developer/answer/6135870) — not wired yet.

### Search Console and GA4 (one service account)
1. Search Console: add a **Domain property** for `amanibiometrics.com` (https://support.google.com/webmasters/answer/34592),
   then Settings → Users and permissions → add the service account email as a restricted user.
   API: https://developers.google.com/webmaster-tools
2. GA4 (optional if PostHog covers web analytics): create a property (https://support.google.com/analytics/answer/9304153),
   add the service account as Viewer, enable the Google Analytics Data API in the Cloud project.
   API: https://developers.google.com/analytics/devguides/reporting/data/v1
3. `GOOGLE_SERVICE_ACCOUNT_JSON`, `SEARCH_CONSOLE_SITE_URL=sc-domain:amanibiometrics.com`, `GA4_PROPERTY_ID`.

### Report delivery
- Slack: create an app with an incoming webhook into a private channel → `SLACK_WEBHOOK_URL`.
  Docs: https://docs.slack.dev/messaging/sending-messages-using-incoming-webhooks/
- Email via Resend: verify the sending domain (https://resend.com/docs/dashboard/domains/introduction), create a
  **sending-access** API key restricted to that domain (https://resend.com/docs/dashboard/api-keys/introduction)
  → `RESEND_API_KEY`, `REPORT_EMAIL_FROM`, `REPORT_EMAIL_TO`, `REPORT_DELIVERY=file,email`.

---

## Social and marketing accounts (all still to be created)

Suggested order: Meta (Facebook Page + Instagram) → TikTok → YouTube → LinkedIn Page → Pinterest → X → ads accounts.

### Meta: Facebook Page, Instagram professional account, Meta Business
1. Create a Facebook Page for Amani (https://www.facebook.com/pages/create) from an admin's personal profile
   (Meta requires a personal profile to administer Pages; add a second admin for continuity).
2. Create/claim a **business portfolio** in Meta Business Suite (https://www.facebook.com/business/tools/meta-business-suite)
   and add the Page.
3. Create the Instagram account, switch it to a **professional (Business)** account in the Instagram app, and
   connect it to the Facebook Page / business portfolio.
4. Developer app: https://developers.facebook.com/ → create an app (Business type) connected to the business
   portfolio → `META_APP_ID`, `META_APP_SECRET`. Platform overview: https://developers.facebook.com/docs/instagram-api/overview
5. **Read token (day-1 for social):** with Facebook Login for Business, get a user token with
   `pages_show_list`, `pages_read_engagement`, `instagram_basic`, `instagram_manage_insights`; exchange for a
   long-lived user token, then fetch the long-lived **Page** token from `/{user-id}/accounts`
   (https://developers.facebook.com/docs/facebook-login/guides/access-tokens/get-long-lived) →
   `META_PAGE_ACCESS_TOKEN`, `META_PAGE_ID`, `META_IG_BUSINESS_ACCOUNT_ID`, `META_GRAPH_VERSION` (v26.0 is the
   latest listed as of Oct 2026).
6. **Publishing (later):** Instagram content publishing needs `instagram_content_publish` (Facebook Login path) or
   `instagram_business_content_publish` (Instagram Login path)
   (https://developers.facebook.com/docs/instagram-platform/content-publishing). Media must be on a public URL;
   accounts are limited to 100 API-published posts per 24 h (same page). **Access level:** Meta's overview says
   *Advanced Access* (which requires App Review and Business Verification) is needed when the app serves accounts
   you don't own or manage; for Amani's own accounts used by people with a role on the app, Standard Access may be
   enough — confirm in the current docs before submitting anything.
   App Review: https://developers.facebook.com/documentation/instagram-platform/app-review ,
   Business Verification: https://developers.facebook.com/docs/development/release/business-verification/
   Some Pages also require Page Publishing Authorization before publishing (same content-publishing page).
7. **Meta Ads (later):** create an ad account in the business portfolio → `META_AD_ACCOUNT_ID` (`act_…`);
   a system-user token with `ads_read` → `META_ADS_ACCESS_TOKEN`
   (Insights API: https://developers.facebook.com/docs/marketing-api/insights). Check Meta's health-related ad
   policies before any campaign.

### TikTok
1. Create the TikTok account with the brand mailbox and switch it to a Business account in the app; TikTok for
   Business: https://www.tiktok.com/business/en/
2. Developer app at https://developers.tiktok.com/ (Login Kit: https://developers.tiktok.com/doc/login-kit-overview)
   → `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`; authorize the Amani account with `user.info.basic`,
   `user.info.stats`, `video.list` → `TIKTOK_ACCESS_TOKEN`, `TIKTOK_REFRESH_TOKEN`, `TIKTOK_OPEN_ID`
   (user info API: https://developers.tiktok.com/doc/tiktok-api-v2-get-user-info).
3. **Publishing (later):** Content Posting API with `video.publish`
   (https://developers.tiktok.com/doc/content-posting-api-get-started). Per TikTok's docs, content posted by
   **unaudited** clients is restricted to private viewing; making posts public requires passing TikTok's audit.
   App review guidelines: https://developers.tiktok.com/doc/app-review-guidelines . Timeline: check current docs.
4. **TikTok Ads (later):** TikTok API for Business (https://business-api.tiktok.com/portal/docs) → developer app,
   advertiser authorization → `TIKTOK_BUSINESS_APP_ID`, `TIKTOK_BUSINESS_SECRET`, `TIKTOK_BUSINESS_ACCESS_TOKEN`,
   `TIKTOK_ADVERTISER_ID`. Confirm the API version path used by `collectors/tiktok.mjs`.

### YouTube
1. Create a channel under a Brand Account owned by the brand Google account (https://support.google.com/youtube/answer/1646861).
2. Google Cloud: enable YouTube Data API v3, create an API key restricted to that API → `YOUTUBE_API_KEY`;
   channel ID → `YOUTUBE_CHANNEL_ID`. Docs: https://developers.google.com/youtube/v3/getting-started
   (default quota: 10,000 units/day plus separate small allocations for search and uploads, per that page).
3. **Uploads/analytics (later):** OAuth client of type Desktop app
   (https://developers.google.com/youtube/v3/guides/auth/installed-apps) → `YOUTUBE_OAUTH_CLIENT_ID`,
   `YOUTUBE_OAUTH_CLIENT_SECRET`, refresh token → `YOUTUBE_OAUTH_REFRESH_TOKEN`. YouTube Analytics API:
   https://developers.google.com/youtube/analytics . Raising quota requires a compliance audit:
   https://developers.google.com/youtube/v3/guides/quota_and_compliance_audits

### Pinterest
1. Create a Pinterest **business account** (https://help.pinterest.com/en/business/article/get-a-business-account),
   claim `amanibiometrics.com`.
2. Developer app (https://developers.pinterest.com/docs/getting-started/set-up-app/), request access; Pinterest's
   docs say requests are reviewed each business day and trial access comes first, with an upgrade path for
   broader access (https://developers.pinterest.com/docs/getting-started/connect-app/).
3. OAuth with `user_accounts:read`, `pins:read` (add `pins:write`, `boards:write` later) →
   `PINTEREST_ACCESS_TOKEN`, `PINTEREST_REFRESH_TOKEN`, `PINTEREST_APP_ID`, `PINTEREST_APP_SECRET`.

### LinkedIn company page
1. Create the LinkedIn Page (https://www.linkedin.com/help/linkedin/answer/a543852) from an admin's profile.
2. Developer app at https://www.linkedin.com/developers/ ; verify it with the Page.
3. Request the **Community Management API** product. LinkedIn grants a Development tier first, and Standard tier
   requires an upgrade application with a screencast
   (https://learn.microsoft.com/en-us/linkedin/marketing/community-management/community-management-overview).
4. OAuth (https://learn.microsoft.com/en-us/linkedin/shared/authentication/authorization-code-flow) →
   `LINKEDIN_ACCESS_TOKEN`; org ID → `LINKEDIN_ORGANIZATION_ID`; pick a supported `LINKEDIN_API_VERSION` (YYYYMM).

### X (Twitter)
1. Create the brand account; developer console at https://console.x.com (getting access:
   https://docs.x.com/x-api/getting-started/getting-access).
2. X API is **pay-per-use** (https://docs.x.com/x-api/getting-started/pricing), so the collector is off by default
   (`X_ENABLE_COLLECTOR=false`). App bearer token → `X_BEARER_TOKEN`; user-context keys only for approved posting
   later (https://docs.x.com/fundamentals/authentication/overview).

### Reddit (optional)
Reddit closed self-service Data API access: all API access now needs Reddit's approval, and commercial use needs
explicit written approval (Responsible Builder Policy:
https://support.reddithelp.com/hc/en-us/articles/42728983564564-Responsible-Builder-Policy ; Data API Terms:
https://redditinc.com/policies/data-api-terms). Recommendation: create a brand account for manual community
participation within each subreddit's rules; no Jarvis collector until approval exists.

### Google Ads
1. Create a Google Ads **manager account** (https://support.google.com/google-ads/answer/7459399) and the Amani
   client account under it (https://ads.google.com/home/).
2. Developer token: manager account → API Center (https://developers.google.com/google-ads/api/docs/get-started/dev-token).
   Tokens start at test-account access; production access needs an application. Access levels and the review
   times Google lists are on https://developers.google.com/google-ads/api/docs/api-policy/access-levels
   (when checked in Oct 2026 it listed Test, Explorer, Basic and Standard levels, with 10 business days shown for
   Standard). Read-only reporting fits the lower production levels; confirm on that page.
3. OAuth client + refresh token for a user with access to the account
   (https://developers.google.com/google-ads/api/docs/oauth/overview) → `GOOGLE_ADS_CLIENT_ID`,
   `GOOGLE_ADS_CLIENT_SECRET`, `GOOGLE_ADS_REFRESH_TOKEN`; `GOOGLE_ADS_CUSTOMER_ID`, `GOOGLE_ADS_LOGIN_CUSTOMER_ID`
   (manager ID); `GOOGLE_ADS_API_VERSION` per https://developers.google.com/google-ads/api/docs/release-notes .
4. Review Google's healthcare ad policy first: https://support.google.com/adspolicy/answer/176031

### Email marketing (Resend)
Verify `amanibiometrics.com` (SPF/DKIM) in Resend; create Contacts/Segments (Resend replaced Audiences with
Contacts + Segments: https://resend.com/docs/dashboard/contacts/introduction) → `RESEND_SEGMENT_ID`.
Marketing sends are always `email_send` proposals approved by the owner; include unsubscribe handling and consent.

---

## After each account exists

Add its variables to `jarvis/.env`, run `./run-daily.sh --collect-only` to confirm the collector says `ok`, then
let the next morning's report pick it up.
