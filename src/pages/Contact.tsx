/*
  ============================================================================
  DRAFT — pending review.

  The addresses below (support@ / privacy@ amanibiometrics.com) are the ones
  referenced from Privacy.tsx and Terms.tsx. They must actually deliver mail
  before launch: Apple requires a working support contact for App Store
  review, and a privacy policy that names an unreachable address is worse
  than one that names none.

  This is deliberately a page of addresses rather than a contact form —
  a form would collect health details into a new store, with its own
  retention and access questions, which is not something to add casually to
  an app that handles this data.
  ============================================================================
*/

import { ArrowLeft, Mail, ShieldCheck, LifeBuoy, AlertTriangle } from 'lucide-react';
import { AmaniLogo } from '../components/AmaniLogo';
import { Link } from 'react-router-dom';

const LAST_UPDATED = '23 August 2026';

export function Contact() {
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
            Draft — pending review
          </h2>
          <p className="text-theme-text text-sm">
            This page is published in draft alongside our{' '}
            <Link to="/privacy" className="underline hover:text-theme-primary-dark">
              Privacy Policy
            </Link>{' '}
            and{' '}
            <Link to="/terms" className="underline hover:text-theme-primary-dark">
              Terms
            </Link>
            , which are awaiting legal review.
          </p>
        </div>

        <h1 className="text-4xl font-bold text-theme-text mb-2">Contact us</h1>
        <p className="text-theme-muted-text mb-10">
          A real person reads these. Last updated {LAST_UPDATED}.
        </p>

        <div className="space-y-6">
          <div className="bg-theme-surface border border-theme-border rounded-xl p-6">
            <div className="flex items-start gap-4">
              <div className="w-11 h-11 bg-theme-primary/10 rounded-full flex items-center justify-center shrink-0">
                <LifeBuoy className="w-5 h-5 text-theme-primary" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-theme-text mb-1">Support</h2>
                <p className="text-theme-text-body text-sm mb-3">
                  Anything about using Amani: a report that would not upload, a biomarker read
                  incorrectly, a billing question, or a bug. If it is an extraction problem, tell
                  us which lab the report came from and which value looks wrong — that is usually
                  enough for us to reproduce it.
                </p>
                <a
                  href="mailto:support@amanibiometrics.com"
                  className="inline-flex items-center gap-2 text-theme-primary-dark font-medium text-sm hover:underline"
                >
                  <Mail className="w-4 h-4" />
                  support@amanibiometrics.com
                </a>
              </div>
            </div>
          </div>

          <div className="bg-theme-surface border border-theme-border rounded-xl p-6">
            <div className="flex items-start gap-4">
              <div className="w-11 h-11 bg-theme-primary/10 rounded-full flex items-center justify-center shrink-0">
                <ShieldCheck className="w-5 h-5 text-theme-primary" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-theme-text mb-1">
                  Privacy and your data
                </h2>
                <p className="text-theme-text-body text-sm mb-3">
                  Requests to access, correct, or delete your data, questions about how your
                  health information is handled, or anything else covered by our{' '}
                  <Link to="/privacy" className="text-theme-primary-dark underline">
                    Privacy Policy
                  </Link>
                  . If you have found a security problem, this is the right address — please tell
                  us before telling anyone else.
                </p>
                <a
                  href="mailto:privacy@amanibiometrics.com"
                  className="inline-flex items-center gap-2 text-theme-primary-dark font-medium text-sm hover:underline"
                >
                  <Mail className="w-4 h-4" />
                  privacy@amanibiometrics.com
                </a>
              </div>
            </div>
          </div>

          <div className="bg-theme-surface-2 border border-theme-border rounded-xl p-6">
            <h2 className="text-lg font-semibold text-theme-text mb-2">
              You can delete your data yourself
            </h2>
            <p className="text-theme-text-body text-sm">
              You do not need to email us to leave. Open{' '}
              <strong className="text-theme-text">Settings &rarr; Delete My Data</strong> in the
              app and everything goes: your uploaded files, your lab reports and biomarkers, your
              interpretations, your period and symptom logs, your profile, and your login. Any
              active web subscription is cancelled as part of the same process. If you subscribed
              through the App Store or Google Play, cancel that in your device&rsquo;s
              subscription settings — we cannot do it for you.
            </p>
          </div>

          <div className="bg-theme-flag-low-bg border border-theme-flag-low-border rounded-xl p-6">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-theme-flag-low shrink-0 mt-0.5" />
              <div>
                <h2 className="text-lg font-semibold text-theme-text mb-1">
                  We cannot help with a medical emergency
                </h2>
                <p className="text-theme-text text-sm">
                  This inbox is not monitored around the clock and we are not clinicians. If you
                  are having a medical emergency, call your local emergency number or go to an
                  emergency department. For questions about your own results, speak to the
                  provider who ordered them — Amani is educational only and does not diagnose
                  conditions or give medical advice.
                </p>
              </div>
            </div>
          </div>
        </div>
      </main>

      <footer className="bg-theme-surface border-t border-theme-border py-8">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-wrap gap-6 text-sm text-theme-muted-text">
          <Link to="/" className="hover:text-theme-text transition-colors">Home</Link>
          <Link to="/privacy" className="hover:text-theme-text transition-colors">Privacy</Link>
          <Link to="/terms" className="hover:text-theme-text transition-colors">Terms</Link>
        </div>
      </footer>
    </div>
  );
}
