/*
  ============================================================================
  Public account-deletion instructions.

  Google Play requires a URL that explains how to delete an account and what
  gets deleted, reachable WITHOUT signing in — a reviewer, or someone who has
  lost access to their account, has to be able to read it. That is why this is
  a public route and why it does not link to /app/settings, which would bounce
  a signed-out visitor to the login screen.

  The in-app path is the real mechanism; this page only describes it. Every
  claim below is checked against `supabase/functions/delete-user-data/` and
  `_shared/account-deletion.ts` — if that flow changes, this page has to change
  with it, because an inaccurate deletion disclosure is a compliance problem in
  its own right.
  ============================================================================
*/

import { ArrowLeft, Mail, Trash2, AlertTriangle, CreditCard } from 'lucide-react';
import { AmaniLogo } from '../components/AmaniLogo';
import { Link } from 'react-router-dom';

/**
 * What `deleteDataTables` and the surrounding steps actually remove, in
 * language a person can check against their own account. Grouped rather than
 * listed table-by-table: "interventions" means nothing to a user, "things you
 * logged" does.
 */
const DELETED = [
  'Your Amani account and sign-in identity',
  'Every lab report you uploaded, and the original PDF or photo files',
  'All extracted biomarker values, reference ranges and flags',
  'All AI and rule-based interpretations of your results',
  'Your cycle records, period logs, symptom logs and anything else you tracked',
  'Notification preferences and reminders',
  'Your billing records with us, and your customer record at our payment processor',
];

export function DeleteAccount() {
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

        <div className="flex items-center gap-3 mb-3">
          <Trash2 className="h-6 w-6 text-theme-text" />
          <h1 className="text-2xl sm:text-3xl text-theme-text">
            Delete your Amani account and data
          </h1>
        </div>
        <p className="text-theme-muted-text mb-10">
          Amani (<span className="text-theme-text">amanibiometrics.com</span>, published by Amani)
          is a women&rsquo;s health app that interprets lab results in the context of your
          menstrual cycle. You can delete your account and everything in it from inside the app.
        </p>

        <section className="mb-10">
          <h2 className="text-lg text-theme-text mb-4">How to delete your account</h2>
          <ol className="space-y-3">
            {[
              'Sign in to Amani, on the web or in the mobile app.',
              'Open Settings.',
              'Scroll to Delete My Data.',
              'Follow the confirmation steps.',
            ].map((step, i) => (
              <li key={i} className="flex gap-3 text-theme-text">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-theme-primary/10 text-theme-primary-dark text-sm flex items-center justify-center font-medium">
                  {i + 1}
                </span>
                <span className="pt-0.5">{step}</span>
              </li>
            ))}
          </ol>
          <p className="text-theme-muted-text text-sm mt-4">
            Deletion is immediate and permanent. There is no recovery period and no way for us to
            restore an account once it has been deleted.
          </p>
        </section>

        <section className="mb-10">
          <h2 className="text-lg text-theme-text mb-4">What gets deleted</h2>
          <ul className="space-y-2">
            {DELETED.map((item) => (
              <li key={item} className="flex gap-3 text-theme-text">
                <span aria-hidden="true" className="text-theme-primary mt-1">&bull;</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
          <p className="text-theme-muted-text text-sm mt-4">
            Nothing is retained for analytics or model training. We may keep minimal transaction
            records where tax or accounting law requires it; those contain no health data.
          </p>
        </section>

        {/*
          Two store-subscription facts, both load-bearing and easy to get wrong.
          Step 0 of the deletion flow REFUSES to proceed while a live App Store
          or Play subscription exists, because neither store lets a server
          cancel one — so "we don't cancel it for you" understates it. And
          Stripe subscriptions ARE cancelled automatically (step 2), which the
          user should know so they don't cancel twice or worry they were missed.
        */}
        <section className="mb-10">
          <div className="bg-theme-flag-watch-bg border border-theme-flag-watch-border rounded-xl p-5">
            <div className="flex items-start gap-3">
              <CreditCard className="h-5 w-5 text-theme-text flex-shrink-0 mt-0.5" />
              <div>
                <h2 className="text-base font-semibold text-theme-text mb-2">
                  If you subscribe through the App Store or Google Play
                </h2>
                <p className="text-theme-text text-sm mb-3">
                  Apple and Google do not allow an app to cancel a subscription bought through
                  their stores. So deletion will stop and ask you to cancel first if you have a
                  live App Store or Google Play subscription. Cancel it in your Apple or Google
                  subscription settings, then come back and delete your account.
                </p>
                <p className="text-theme-text text-sm">
                  Subscriptions purchased on the web are different: those are cancelled
                  automatically as part of deleting your account, and you do not need to do
                  anything separately.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/*
          themilkytech@gmail.com is deliberate and temporary. The
          amanibiometrics.com mailbox does not exist yet, and a compliance page
          that names a bouncing address is worse than one that names none —
          Google or a locked-out user emails it, nothing arrives, and the
          deletion path we just promised does not work. This is the same address
          already given to Google Play, so the two stay consistent.

          Swap to support@ or privacy@amanibiometrics.com once domain mail is
          live, and check Contact.tsx, Privacy.tsx and Terms.tsx at the same
          time — they all still name unreachable addresses.
        */}
        <section className="mb-10">
          <h2 className="text-lg text-theme-text mb-3">If you cannot sign in</h2>
          <p className="text-theme-text mb-3">
            If you have lost access to your account and cannot reach Settings, email us from the
            address associated with your Amani account and ask us to delete it. Writing from that
            address lets us identify the account without asking you for more personal information
            than necessary.
          </p>
          <a
            href="mailto:themilkytech@gmail.com"
            className="inline-flex items-center gap-2 text-theme-primary-dark underline underline-offset-2 hover:text-theme-accent"
          >
            <Mail className="h-4 w-4" />
            themilkytech@gmail.com
          </a>
        </section>

        <div className="bg-theme-flag-low-bg border border-theme-flag-low-border rounded-xl p-5 flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-theme-flag-low flex-shrink-0 mt-0.5" />
          <p className="text-sm text-theme-flag-low">
            Deleting your Amani account does not delete lab results held by the laboratory or
            clinic that produced them. Amani only removes the copy you uploaded to us.
          </p>
        </div>

        <p className="text-theme-muted-text text-sm mt-10">
          See also our{' '}
          <Link to="/privacy" className="underline hover:text-theme-primary-dark">
            Privacy Policy
          </Link>{' '}
          and{' '}
          <Link to="/terms" className="underline hover:text-theme-primary-dark">
            Terms
          </Link>
          .
        </p>
      </main>
    </div>
  );
}
