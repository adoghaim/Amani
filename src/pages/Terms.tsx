/*
  ============================================================================
  DRAFT — NOT LEGAL ADVICE. NOT REVIEWED BY A LAWYER.

  Written from the code: pricing and billing intervals from
  src/stripe-config.ts and src/lib/iap-config.ts, the trial length from
  src/lib/entitlement.ts (7 days), and the medical boundaries from
  NUTRIENT_GUIDELINES.md and supabase/functions/_shared/nutrient-policy.ts.

  The commercially load-bearing clauses — limitation of liability, warranty
  disclaimer, indemnity, governing law, dispute resolution — are the ones a
  lawyer must write or approve. What is here is a placeholder that states an
  honest intent, not an enforceable allocation of risk. The auto-renewal
  disclosure below is shaped to App Store Review Guideline 3.1.2(a); confirm
  it against the current guideline text before submitting a build.

  A "governing law" jurisdiction is deliberately left unfilled rather than
  guessed at — see the note in that section.
  ============================================================================
*/

import { Heart, ArrowLeft } from 'lucide-react';
import { Link } from 'react-router-dom';
import { STRIPE_PRODUCTS } from '../stripe-config';

const LAST_UPDATED = '23 August 2026';

const monthly = STRIPE_PRODUCTS.find((p) => p.interval === 'month');
const yearly = STRIPE_PRODUCTS.find((p) => p.interval === 'year');

export function Terms() {
  return (
    <div className="min-h-screen bg-theme-background">
      <nav className="bg-theme-surface border-b border-theme-border shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center h-16">
            <Link to="/" className="flex items-center gap-2">
              <Heart className="w-6 h-6 text-theme-primary fill-theme-primary" />
              <span className="text-xl font-semibold text-theme-text">Amani</span>
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
            These terms describe how Amani actually works and what we are promising, but they
            have not yet been reviewed by a lawyer. The sections on liability and disputes in
            particular are placeholders. We are publishing them in draft rather than leaving the
            link dead.
          </p>
        </div>

        <h1 className="text-4xl font-bold text-theme-text mb-2">Terms of Service</h1>
        <p className="text-theme-muted-text mb-10">Last updated {LAST_UPDATED}</p>

        <div className="space-y-10 text-theme-text-body leading-relaxed">
          <section className="bg-theme-flag-low-bg border border-theme-flag-low-border rounded-xl p-5">
            <h2 className="text-lg font-semibold text-theme-text mb-2">
              Read this first: Amani is not medical care
            </h2>
            <p className="mb-3">
              Amani is an educational tool. It explains what the numbers on your lab report
              generally mean and helps you prepare for a conversation with a clinician.{' '}
              <strong className="text-theme-text">
                It does not diagnose conditions, does not treat them, and does not give medical
                advice.
              </strong>{' '}
              It is not a medical device and it has not been evaluated by any regulator.
            </p>
            <p className="mb-3">
              Nothing Amani tells you is a reason to start, stop, or change a medication,
              supplement, or treatment. Only a licensed healthcare provider who knows your full
              situation can tell you that. Never delay seeking care, or disregard advice you
              have been given, because of something you read here.
            </p>
            <p>
              <strong className="text-theme-text">
                If you think you are having a medical emergency, call your local emergency
                number or go to an emergency department now.
              </strong>{' '}
              Amani is not monitored and cannot help you.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-theme-text mb-3">Agreeing to these terms</h2>
            <p>
              By creating an account or using Amani you agree to these terms and to our{' '}
              <Link to="/privacy" className="text-theme-primary-dark underline">
                Privacy Policy
              </Link>
              . If you do not agree, do not use the service. You must be at least 18 years old
              to use Amani.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-theme-text mb-3">What Amani does</h2>
            <p>
              You upload a lab report as a PDF or a photo. Amani extracts the biomarkers from
              it, scores them against reference ranges and against where you are in your
              menstrual cycle, and generates a plain-language explanation along with questions
              worth asking your doctor. It tracks how your results change over time and lets you
              log periods and symptoms alongside them.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-theme-text mb-3">
              Accuracy, and where it breaks
            </h2>
            <p className="mb-3">
              Amani reads your report automatically, and automatic reading of a scanned document
              is imperfect. A value can be misread, a unit can be misinterpreted, a reference
              range can be picked up from the wrong row, and a test can be missed entirely. The
              explanations are generated by an AI model and can be wrong or incomplete even when
              the extraction was correct.
            </p>
            <p>
              <strong className="text-theme-text">
                Always check what Amani shows you against the original report from your lab
              </strong>
              , and treat your lab and your clinician as the source of truth. If you spot an
              extraction error, tell us — it helps us fix the parser for everyone.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-theme-text mb-3">Your account</h2>
            <p>
              You are responsible for keeping your login credentials secure and for what happens
              under your account. Give us accurate information. Tell us promptly if you think
              someone else has access. One account per person; do not share it, since the whole
              product is built around one person&rsquo;s history.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-theme-text mb-3">
              Subscriptions, trial, and renewal
            </h2>

            <div className="bg-theme-surface border border-theme-border rounded-xl p-5 mb-4">
              <ul className="space-y-2 text-sm">
                <li>
                  <strong className="text-theme-text">What you get:</strong> Amani — full access,
                  including unlimited lab report uploads and AI-generated explanations.
                </li>
                <li>
                  <strong className="text-theme-text">Free trial:</strong> 7 days, no payment
                  card required to sign up.
                </li>
                <li>
                  <strong className="text-theme-text">Price and period:</strong>{' '}
                  {monthly ? `$${monthly.price.toFixed(2)} per month` : 'monthly'} or{' '}
                  {yearly ? `$${yearly.price.toFixed(2)} per year` : 'yearly'}, in US dollars.
                </li>
                <li>
                  <strong className="text-theme-text">Renewal:</strong> subscriptions renew
                  automatically at the end of each period, at the same price, until you cancel.
                </li>
                <li>
                  <strong className="text-theme-text">Cancelling:</strong> any time, effective at
                  the end of the period you have already paid for.
                </li>
              </ul>
            </div>

            <p className="mb-3">
              Prices shown in the app may differ by country or store, and any promotional price
              applies only for the period stated at the time you subscribe.
            </p>

            <h3 className="font-semibold text-theme-text mt-5 mb-2">If you subscribed on the web</h3>
            <p>
              Payment is processed by Stripe. Manage or cancel your subscription from the Billing
              screen in the app, which opens the Stripe customer portal.
            </p>

            <h3 className="font-semibold text-theme-text mt-5 mb-2">
              If you subscribed inside the iOS or Android app
            </h3>
            <p className="mb-3">
              Payment is charged to your Apple or Google account at confirmation of purchase.
              The subscription renews automatically unless you turn off auto-renew at least 24
              hours before the end of the current period, and your account is charged for
              renewal within 24 hours of the end of that period.
            </p>
            <p>
              <strong className="text-theme-text">
                Cancel in your device&rsquo;s subscription settings, not in Amani.
              </strong>{' '}
              We cannot cancel an App Store or Google Play subscription for you, and deleting
              your Amani account will not cancel it either. Any unused portion of a free trial
              is forfeited when you buy a subscription.
            </p>

            <h3 className="font-semibold text-theme-text mt-5 mb-2">Refunds</h3>
            <p>
              For web subscriptions, contact us and we will deal with it fairly. For purchases
              made through the App Store or Google Play, refunds are handled by Apple or Google
              under their own policies — we have no ability to issue them.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-theme-text mb-3">Your data stays yours</h2>
            <p>
              The lab reports and health information you upload remain yours. You give us only
              the permission we need to run the service for you: to store your files, extract
              and score biomarkers, generate interpretations, and send the necessary data to the
              providers listed in the{' '}
              <Link to="/privacy" className="text-theme-primary-dark underline">
                Privacy Policy
              </Link>
              . We do not use your health data to train AI models, and we do not sell it. You
              can delete all of it from Settings at any time.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-theme-text mb-3">Acceptable use</h2>
            <p className="mb-3">Do not:</p>
            <ul className="space-y-2 list-disc pl-5">
              <li>upload lab reports belonging to someone else without their consent;</li>
              <li>use Amani to provide medical care or advice to other people;</li>
              <li>
                attempt to access another user&rsquo;s data, probe our security, or interfere
                with the service;
              </li>
              <li>
                scrape, resell, or redistribute Amani&rsquo;s content or use it to build a
                competing product;
              </li>
              <li>upload malware or anything unlawful.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-theme-text mb-3">Ending things</h2>
            <p>
              You can stop using Amani and delete your account at any time from Settings. We may
              suspend or close an account that breaches these terms, or stop offering the service
              — if we ever shut down, we will give you notice and a way to get your data out
              first.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-theme-text mb-3">
              Warranties and liability
            </h2>
            <p className="mb-3">
              Amani is provided as it is. We work hard to make the extraction and the
              explanations correct, but we cannot promise the service will be uninterrupted,
              error-free, or accurate in every case, and we make no warranty that it is fit for
              any particular purpose.
            </p>
            <p className="mb-3">
              To the fullest extent the law allows, Amani is not liable for indirect or
              consequential losses arising from your use of the service, and our total liability
              is limited to the amount you paid us in the twelve months before the claim.
            </p>
            <p className="text-sm bg-theme-flag-watch-bg border border-theme-flag-watch-border rounded-lg p-4">
              <strong className="text-theme-text">Draft note:</strong> nothing in this section is
              intended to limit liability for death or personal injury caused by negligence,
              for fraud, or for anything else that cannot lawfully be excluded — and some
              jurisdictions do not allow these exclusions at all. This clause must be written by
              a lawyer before launch.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-theme-text mb-3">
              Governing law and disputes
            </h2>
            <p className="text-sm bg-theme-flag-watch-bg border border-theme-flag-watch-border rounded-lg p-4">
              <strong className="text-theme-text">Draft note:</strong> the governing jurisdiction
              and the dispute-resolution mechanism are deliberately left blank rather than
              guessed at. They depend on where Amani is legally established, which is not
              something that can be inferred from the codebase. A lawyer must complete this
              section before launch.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-theme-text mb-3">Changes to these terms</h2>
            <p>
              We may update these terms. If a change is material we will tell you in the app
              before it takes effect, and the date at the top will change. Continuing to use
              Amani after that means you accept the new terms.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-theme-text mb-3">Contact</h2>
            <p>
              Questions about these terms go to{' '}
              <a
                href="mailto:support@amanibiometrics.com"
                className="text-theme-primary-dark underline"
              >
                support@amanibiometrics.com
              </a>
              , or through the{' '}
              <Link to="/contact" className="text-theme-primary-dark underline">
                contact page
              </Link>
              .
            </p>
          </section>
        </div>
      </main>

      <footer className="bg-theme-surface border-t border-theme-border py-8">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-wrap gap-6 text-sm text-theme-muted-text">
          <Link to="/" className="hover:text-theme-text transition-colors">Home</Link>
          <Link to="/privacy" className="hover:text-theme-text transition-colors">Privacy</Link>
          <Link to="/contact" className="hover:text-theme-text transition-colors">Contact</Link>
        </div>
      </footer>
    </div>
  );
}
