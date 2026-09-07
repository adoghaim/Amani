/*
  ============================================================================
  DRAFT — NOT LEGAL ADVICE. NOT REVIEWED BY A LAWYER.

  This policy was written from the code: the schema in
  supabase/migrations/, the onboarding fields in src/features/onboarding/,
  the OpenAI calls in supabase/functions/generate-interpretation/ and
  parse-lab-report-ocr/, the Sentry configuration in src/lib/observability/, the
  RevenueCat calls in src/lib/iap.ts and
  supabase/functions/_shared/iap-verification.ts, and the deletion protocol in
  supabase/functions/_shared/account-deletion.ts. It is accurate to what the
  app does as of the date below.

  It is NOT a substitute for review by a privacy lawyer, which must happen
  before launch. Amani handles reproductive and other sensitive health data,
  which several US state laws (Washington My Health My Data, Nevada SB 370)
  and the GDPR treat as a special category with its own consent and notice
  requirements. Those obligations are not addressed here.

  Whenever the data flows change — a new subprocessor, a new field, a new
  place data is sent — this file changes with them.
  ============================================================================
*/

import { ArrowLeft } from 'lucide-react';
import { AmaniLogo } from '../components/AmaniLogo';
import { Link } from 'react-router-dom';

const LAST_UPDATED = '7 September 2026';

export function Privacy() {
  return (
    <div className="min-h-screen bg-theme-background">
      <nav className="bg-theme-surface border-b border-theme-border shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center h-16">
            <Link to="/" className="flex items-center gap-2">
              <AmaniLogo size="sm" />
            </Link>
          </div>
        </div>
      </nav>

      <main className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <Link
          to="/"
          className="inline-flex items-center text-theme-muted-text hover:text-theme-text mb-8 transition-colors text-sm"
        >
          <ArrowLeft className="h-4 w-4 mr-1.5" />
          Back to home
        </Link>

        <div className="bg-theme-flag-watch-bg border border-theme-flag-watch-border rounded-xl p-5 mb-10">
          <h2 className="text-base font-semibold text-theme-text mb-1">
            Draft — pending legal review
          </h2>
          <p className="text-theme-text text-sm">
            This policy accurately describes what Amani does with your data today, but it has
            not yet been reviewed by a lawyer. We are publishing it in draft so you can see
            exactly how your health information is handled before you share any. If anything
            here is unclear or looks wrong to you, please{' '}
            <Link to="/contact" className="underline hover:text-theme-primary-dark">
              tell us
            </Link>
            .
          </p>
        </div>

        <h1 className="text-4xl font-bold text-theme-text mb-2">Privacy Policy</h1>
        <p className="text-theme-muted-text mb-10">Last updated {LAST_UPDATED}</p>

        <div className="space-y-10 text-theme-text-body leading-relaxed">
          <section>
            <h2 className="text-xl font-semibold text-theme-text mb-3">The short version</h2>
            <ul className="space-y-2 list-disc pl-5">
              <li>
                Amani stores your lab results, the health context you give us, and the
                explanations we generate. That is sensitive information and we treat it that
                way.
              </li>
              <li>
                We send your lab values — and, for photo uploads, the images of your lab
                reports — to OpenAI so they can be read and explained. This is the one place
                your health data leaves our own infrastructure for a non-storage purpose.
              </li>
              <li>
                We do not sell your data, run ads, or use advertising or analytics trackers. We
                do use an error-monitoring service, configured so that it cannot record what is
                on your screen.
              </li>
              <li>
                You can delete everything from Settings, and that deletion is real — it removes
                your files, your records, and your login.
              </li>
              <li>
                <strong className="text-theme-text">Amani is not a HIPAA covered entity.</strong>{' '}
                See below for what that means for you.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-theme-text mb-3">Who we are</h2>
            <p>
              Amani is a direct-to-consumer app that reads lab reports and explains them in
              plain language. It is operated from amanibiometrics.com and distributed as an iOS
              and Android app. For any privacy question, write to{' '}
              <a
                href="mailto:privacy@amanibiometrics.com"
                className="text-theme-primary-dark underline"
              >
                privacy@amanibiometrics.com
              </a>
              .
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-theme-text mb-3">
              Amani is not a HIPAA covered entity
            </h2>
            <p className="mb-3">
              HIPAA applies to health plans, healthcare clearinghouses, and healthcare providers
              who bill electronically — and to their business associates. Amani is none of
              these. We are a consumer app you choose to give your own lab results to, not a
              provider treating you and not a service working on a provider&rsquo;s behalf.
            </p>
            <p>
              This matters, so we would rather be blunt about it than leave it vague: the health
              information you put into Amani{' '}
              <strong className="text-theme-text">is not protected by HIPAA</strong>. It is
              protected by this policy, by the security measures described below, and by
              whatever consumer privacy law applies where you live. If you would rather your lab
              results stayed only inside your provider&rsquo;s patient portal, that is a
              completely reasonable choice, and you should not upload them here.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-theme-text mb-3">What we collect</h2>
            <p className="mb-4">
              Everything below except the account and operational records is optional — you
              decide what to give us, and Amani works (less well) without it.
            </p>

            <h3 className="font-semibold text-theme-text mt-5 mb-2">Account</h3>
            <p>
              Your email address, and a password that is hashed and stored by our authentication
              provider — we never see or store the password itself. If you sign in with Google
              or Apple instead, we receive the account identifier and email address that
              provider gives us.
            </p>

            <h3 className="font-semibold text-theme-text mt-5 mb-2">
              Health context you enter during onboarding or in Settings
            </h3>
            <p>
              A preferred name, age range, sex at birth, reproductive status (including whether
              you are pregnant, trying to conceive, postpartum, or using birth control), health
              goals, symptoms you want kept in mind, supplements or medications you are taking,
              and any known conditions you tell us about. Also your typical cycle length and
              period length.
            </p>

            <h3 className="font-semibold text-theme-text mt-5 mb-2">Lab reports</h3>
            <p>
              The PDF or photo you upload, the name of the lab and the date of the report, and
              every biomarker we extract from it — the test name, value, unit, and reference
              range. Alongside each report we store the cycle context you give it: your last
              period start date, average cycle length, the cycle day and phase we estimate from
              those, and the symptoms and context you attach to that specific report.
            </p>

            <h3 className="font-semibold text-theme-text mt-5 mb-2">Cycle and symptom tracking</h3>
            <p>
              Period logs, symptom logs, cycle events, and any interventions you record such as
              starting a supplement or changing a medication.
            </p>

            <h3 className="font-semibold text-theme-text mt-5 mb-2">What we generate</h3>
            <p>
              The interpretations, scores, and trend analyses Amani produces from your data are
              stored alongside it so you can come back to them.
            </p>

            <h3 className="font-semibold text-theme-text mt-5 mb-2">Subscription</h3>
            <p>
              Your subscription status, when your trial started, and the identifiers our payment
              processors give us for your customer and subscription records.{' '}
              <strong className="text-theme-text">
                Card numbers never reach Amani&rsquo;s servers
              </strong>{' '}
              — they go directly to Stripe on the web, or to Apple or Google in the mobile apps.
            </p>

            <h3 className="font-semibold text-theme-text mt-5 mb-2">Operational records</h3>
            <p>
              Security audit events and rate-limit counters tied to your account, and diagnostic
              records of how a lab report was parsed, which we use to fix extraction bugs. When
              something in the app crashes we receive an error report describing what failed —
              see Sentry below for what those reports deliberately exclude. Our hosting and
              infrastructure providers keep standard server logs, which include IP addresses.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-theme-text mb-3">
              What we do with it
            </h2>
            <p className="mb-3">
              We use your data to run the product you signed up for: extracting biomarkers from
              the reports you upload, scoring them against reference ranges and where you are in
              your cycle, generating educational explanations, tracking changes across reports,
              managing your account and subscription, and keeping the service secure.
            </p>
            <p>
              We do not sell your personal information. We do not share it with advertisers or
              data brokers. We do not use it to build profiles for anyone else. The app contains
              no advertising SDKs and no product-analytics SDKs — the only third-party code in it
              that reports anything back about your session is the error monitoring and the
              in-app purchase processing described below.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-theme-text mb-3">
              Who else touches your data
            </h2>
            <p className="mb-4">
              Amani is built on other companies&rsquo; infrastructure. These are all of them,
              and exactly what each one receives.
            </p>

            <div className="space-y-5">
              <div className="bg-theme-surface border border-theme-border rounded-xl p-5">
                <h3 className="font-semibold text-theme-text mb-1">Supabase — hosting your data</h3>
                <p className="text-sm">
                  Provides our database, file storage, login system, and server functions. All
                  of the data described above lives on Supabase infrastructure. They act as our
                  processor and do not use your data for their own purposes.
                </p>
              </div>

              <div className="bg-theme-surface border border-theme-border rounded-xl p-5">
                <h3 className="font-semibold text-theme-text mb-1">OpenAI — reading and explaining your labs</h3>
                <p className="text-sm mb-2">
                  This is the part you should read closely. To produce an interpretation we send
                  OpenAI the biomarker names, values, units, and reference ranges from your
                  report, the cycle context attached to that report, and a short profile block
                  containing your preferred first name, age range, sex at birth, reproductive
                  status, health goals, and the symptoms you asked us to keep in mind.
                </p>
                <p className="text-sm mb-2">
                  Your report itself may also be sent to OpenAI, by one of two routes.{' '}
                  <strong className="text-theme-text">Images</strong> are sent when you upload a
                  photo, and also when you upload a PDF our own parser cannot read confidently
                  &mdash; in that case we render its pages to images and send those to be read.
                  Separately,{' '}
                  <strong className="text-theme-text">the text we extracted</strong> from a
                  report may be sent when our parser did read it but the result looks
                  unreliable, so the model can check our work. Either way, what is sent contains
                  whatever your lab printed, which typically includes your name and date of
                  birth.
                </p>
                <p className="text-sm mb-2">
                  If you use the Tracker to log something you are taking or doing &mdash; a
                  supplement, a medication, a diet or sleep change &mdash;{' '}
                  <strong className="text-theme-text">
                    the name and category of that entry are sent to OpenAI
                  </strong>{' '}
                  when you ask for insights comparing two reports. That is what lets us say
                  whether a marker moved during a window when you were taking something. Only
                  entries active during the window being compared are included, and only their
                  name, category and dates &mdash; not any notes you attached.
                </p>
                <p className="text-sm">
                  We do not send OpenAI your email address or your password. The supplements and
                  conditions you entered during onboarding are also not sent &mdash; those are a
                  separate profile field from anything you log in the Tracker. OpenAI states that
                  data submitted through its API is not used to train its models and is retained
                  only for a limited period for abuse monitoring; we rely on that commitment but
                  we do not control it.
                </p>
              </div>

              <div className="bg-theme-surface border border-theme-border rounded-xl p-5">
                <h3 className="font-semibold text-theme-text mb-1">Stripe — payment on the web</h3>
                <p className="text-sm">
                  Handles subscriptions purchased on the website. Stripe receives your email and
                  payment details directly and gives us back a customer identifier and a
                  subscription status. Stripe never receives your health data.
                </p>
              </div>

              <div className="bg-theme-surface border border-theme-border rounded-xl p-5">
                <h3 className="font-semibold text-theme-text mb-1">
                  Apple and Google — payment in the mobile apps
                </h3>
                <p className="text-sm">
                  Subscriptions bought inside the iOS or Android app are processed by Apple or
                  Google under their own terms and privacy policies. We receive a transaction
                  identifier and an entitlement status, relayed to us by RevenueCat below.
                  Neither receives your health data from us.
                </p>
              </div>

              <div className="bg-theme-surface border border-theme-border rounded-xl p-5">
                <h3 className="font-semibold text-theme-text mb-1">
                  RevenueCat — running purchases in the mobile apps
                </h3>
                <p className="text-sm mb-2">
                  The iOS and Android apps contain the RevenueCat SDK. It drives the store
                  purchase sheet, restores purchases you already own, and is how our server
                  learns that you are subscribed. It receives the account identifier Amani
                  generated for you — a random id, used as your purchase profile so a renewal
                  can be matched back to your account — along with the store transaction and
                  subscription identifiers, which product you bought, whether that subscription
                  is active, expired, paused, or retrying a payment, and the device and app
                  details its SDK collects, such as the app version, operating system version, a
                  device identifier, and your store country.
                </p>
                <p className="text-sm">
                  <strong className="text-theme-text">
                    RevenueCat never receives your lab values, biomarkers, symptoms, cycle data,
                    or interpretations
                  </strong>{' '}
                  — none of that is ever passed to it. We also do not give it your email address
                  or any of the profile details you entered during onboarding. Our server reads
                  your subscription status back from RevenueCat to decide whether your account is
                  entitled; nothing about your health travels in either direction.
                </p>
              </div>

              <div className="bg-theme-surface border border-theme-border rounded-xl p-5">
                <h3 className="font-semibold text-theme-text mb-1">Sentry — error monitoring</h3>
                <p className="text-sm mb-2">
                  Receives a report when something in the app crashes or throws an error, so we
                  can fix it. A report contains the error, the code path that produced it, and
                  the page you were on.
                </p>
                <p className="text-sm">
                  It is deliberately configured not to see your health data. Session replay —
                  the feature that records what is on screen — is switched off, because this app
                  displays lab results. Console logs are excluded from reports, because our
                  parser logs the text it reads out of your lab file. Every report is passed
                  through a scrubber before it is sent: authentication tokens and query strings
                  are stripped from URLs, report and account identifiers in a web address are
                  replaced with a placeholder, email addresses are removed, and the on-screen
                  labels of whatever you tapped are dropped from the record of your actions. Your
                  account is not identified to Sentry, and the option to attach identifying
                  request data is disabled.
                </p>
              </div>

              <div className="bg-theme-surface border border-theme-border rounded-xl p-5">
                <h3 className="font-semibold text-theme-text mb-1">Netlify — serving the website</h3>
                <p className="text-sm">
                  Hosts and delivers amanibiometrics.com. As with any web host, its servers see
                  the IP address and request metadata of visitors. Your health data is not stored
                  there.
                </p>
              </div>
            </div>

            <p className="mt-5">
              We will also disclose data if we are legally required to — for example in response
              to a valid court order — or where necessary to protect someone&rsquo;s safety. If
              Amani is ever acquired, your data would transfer with the business, and we would
              tell you before that happened.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-theme-text mb-3">How we protect it</h2>
            <p className="mb-3">
              Everything you send to and from Amani travels over an encrypted connection (TLS).
              Data at rest is encrypted at the infrastructure level by our hosting provider.
            </p>
            <p className="mb-3">
              Access to your records is enforced in the database itself: every table carrying
              health data has row-level security policies that scope rows to the account that
              owns them, so one user&rsquo;s query cannot reach another user&rsquo;s data even
              if the app code were wrong. Uploaded lab files live in a private storage bucket,
              in a folder keyed to your account, and are not reachable by public URL.
            </p>
            <p>
              To be honest about the limits: we do not apply an additional layer of
              application-level encryption to individual health records, we hold no security
              certification such as SOC 2 or ISO 27001, and no system is perfectly secure. If we
              ever discover a breach affecting your data, we will notify you.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-theme-text mb-3">
              How long we keep it, and how to delete it
            </h2>
            <p className="mb-3">
              We keep your data for as long as your account exists. We do not currently apply an
              automatic expiry to old reports — an eight-year-old lab result is often the most
              useful one you have — so deletion is in your hands.
            </p>
            <p className="mb-3">
              You can delete everything from{' '}
              <strong className="text-theme-text">Settings &rarr; Delete My Data</strong>. That
              is not a soft delete or a deactivation. It runs a single ordered process that:
            </p>
            <ol className="space-y-2 list-decimal pl-5 mb-3">
              <li>cancels any active Stripe subscription, so you stop being billed;</li>
              <li>deletes your customer record at Stripe;</li>
              <li>deletes our local copies of your billing records;</li>
              <li>deletes every lab file you uploaded from storage;</li>
              <li>
                deletes your lab reports, biomarkers, interpretations, period and symptom logs,
                cycle events, interventions, reminders, notification preferences, audit records,
                and your profile row;
              </li>
              <li>
                deletes your login identity last, so that if any earlier step fails you can sign
                back in and retry rather than being locked out of a half-deleted account.
              </li>
            </ol>
            <p className="mb-3">
              Two limits you need to know about.{' '}
              <strong className="text-theme-text">
                If you subscribed through the App Store or Google Play, deleting your Amani
                account does not cancel that subscription
              </strong>{' '}
              — only Apple and Google can, and you must cancel it in your device&rsquo;s
              subscription settings. And our payment processors retain transaction records for
              as long as tax and financial regulations require, independently of us.
            </p>
            <p>
              Data already sent to OpenAI is subject to OpenAI&rsquo;s own retention period and
              is not something we can reach in to delete.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-theme-text mb-3">Your choices</h2>
            <p className="mb-3">
              You can view and change your profile and health context at any time in Settings.
              You can delete individual lab reports without deleting your account. You can
              delete your entire account as described above.
            </p>
            <p>
              Depending on where you live you may have additional rights — to access a copy of
              your data, to correct it, to have it deleted, to object to certain processing, or
              to withdraw consent. Write to{' '}
              <a
                href="mailto:privacy@amanibiometrics.com"
                className="text-theme-primary-dark underline"
              >
                privacy@amanibiometrics.com
              </a>{' '}
              and we will honour those requests regardless of whether the law where you live
              requires it.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-theme-text mb-3">Children</h2>
            <p>
              Amani is not intended for anyone under 18, and we do not knowingly collect data
              from children. If you believe a child has given us information, contact us and we
              will delete it.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-theme-text mb-3">Changes to this policy</h2>
            <p>
              If we change how your data is handled — particularly if we add a company that
              receives it — we will update this page and change the date at the top. For
              material changes affecting health data we will tell you in the app rather than
              relying on you to notice.
            </p>
          </section>

          <section className="bg-theme-surface-2 border border-theme-border rounded-xl p-5">
            <h2 className="text-lg font-semibold text-theme-text mb-2">
              A reminder about what Amani is
            </h2>
            <p className="text-sm">
              Amani provides educational information. It does not diagnose conditions and does
              not provide medical advice. Always consult a licensed healthcare provider about
              your health concerns.
            </p>
          </section>
        </div>
      </main>

      <footer className="bg-theme-surface border-t border-theme-border py-8">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-wrap gap-6 text-sm text-theme-muted-text">
          <Link to="/" className="hover:text-theme-text transition-colors">Home</Link>
          <Link to="/terms" className="hover:text-theme-text transition-colors">Terms</Link>
          <Link to="/contact" className="hover:text-theme-text transition-colors">Contact</Link>
        </div>
      </footer>
    </div>
  );
}
