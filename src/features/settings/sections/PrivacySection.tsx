import { Link } from 'react-router-dom';
import { Card } from '../../../components/Card';
import { ShieldCheck, Lock } from 'lucide-react';
import { ConsentSettings } from '../../consent/ConsentSettings';

export function PrivacySection() {
  return (
    <Card className="border-theme-flag-ok-border bg-theme-flag-ok-bg/40">
      <div className="flex items-start gap-4">
        <div className="w-10 h-10 bg-theme-flag-ok-bg rounded-full flex items-center justify-center flex-shrink-0">
          <ShieldCheck className="w-5 h-5 text-theme-flag-ok" />
        </div>
        {/*
          Every statement here must also be true in src/pages/Privacy.tsx,
          and never promise more than it does. Lab data goes to OpenAI to be
          read and explained, and other companies run parts of the service,
          so "no third party can view your data" was false.
          Settings.test.tsx pins this card against Privacy.tsx.
        */}
        <div>
          <h2 className="text-lg text-theme-neutral-900 mb-1">
            Data Privacy & Security
          </h2>
          <p className="text-sm text-theme-neutral-600 leading-relaxed">
            Your health records are linked to your account. Database access rules stop
            other Amani users from seeing them, and data is encrypted in transit.
          </p>
          <p className="mt-2 text-sm text-theme-neutral-600 leading-relaxed">
            Some companies handle your data so Amani can work. To read and explain your
            labs, we send OpenAI your lab values, context you&rsquo;ve added such as cycle
            details and your profile, and sometimes images or text from the report itself.
            Supabase hosts your data, Netlify serves the website, Stripe, Apple, Google and
            RevenueCat handle payments, and Sentry receives error reports.
          </p>
          <p className="mt-2 text-sm text-theme-neutral-600 leading-relaxed">
            We don&rsquo;t sell your data, run ads, or use advertising trackers. There
            are no analytics trackers inside your account or the app; Google Analytics
            runs only on our public website pages, and only if you agree.
          </p>
          <div className="mt-3 flex items-center gap-2 text-xs text-theme-flag-ok font-medium">
            <Lock className="w-3.5 h-3.5" />
            <Link to="/privacy" className="underline hover:text-theme-text">
              See exactly what each company receives in the Privacy Policy
            </Link>
          </div>
          {/* PK-CONSENT-01 (D25): consent status and withdrawal. Nothing while features.consent_gate is off. */}
          <ConsentSettings />
        </div>
      </div>
    </Card>
  );
}
