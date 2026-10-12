import { lazy, Suspense } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../components/Button';
import { AmaniLogo } from '../components/AmaniLogo';
import { CycleMark } from '../components/CycleMark';
import { clientFreemiumActive } from '../lib/tier';
import { FREEMIUM_COPY } from '../lib/freemium/copy';

/*
  The old page opened with a centred headline over three equal icon columns —
  the most generic layout on the web, and it described the product instead of
  showing it. This version leads with a real reading: a specimen panel with an
  actual cycle day, actual biomarkers and an actual change since an earlier
  panel, so the thing Amani does is visible before anyone has read a word of copy.

  Asymmetric by default. Nothing here is centred except the legal note, which
  should read as a statement rather than a pitch.
*/

// Owner R3: the specimen's statements come from the clinical-language policy.
// Lazy, because the policy imports the clinical catalog (LandingSpecimen.tsx).
const LandingSpecimen = lazy(() => import('./LandingSpecimen'));

function Step({ n, title, body }: { n: string; title: string; body: string }) {
  return (
    <li className="grid grid-cols-[auto_1fr] gap-5 items-start">
      {/* Numbered because this genuinely is a sequence — you cannot interpret
          a panel before uploading one. */}
      <span className="font-mono text-sm text-theme-primary pt-1 tabular-nums">{n}</span>
      <div className="border-b border-theme-border-inner pb-7">
        <h3 className="text-lg mb-1.5">{title}</h3>
        <p className="text-theme-muted-text max-w-prose">{body}</p>
      </div>
    </li>
  );
}

export function Landing() {
  const freemium = clientFreemiumActive();
  const copy = FREEMIUM_COPY.landing;
  return (
    <div className="min-h-dvh bg-theme-background">
      <nav className="border-b border-theme-border-inner">
        <div className="max-w-6xl mx-auto px-5 sm:px-8 h-16 flex items-center justify-between">
          <span className="flex items-center gap-2.5">
            <AmaniLogo size="sm" />
          </span>
          <div className="flex items-center gap-2">
            <Link to="/login">
              <Button variant="ghost" size="sm">Log in</Button>
            </Link>
            <Link to="/signup">
              <Button size="sm">{freemium ? copy.navCta : 'Start free trial'}</Button>
            </Link>
          </div>
        </div>
      </nav>

      {/* ── Hero ───────────────────────────────────────────────── */}
      <section className="max-w-6xl mx-auto px-5 sm:px-8 pt-14 pb-20 lg:pt-24 lg:pb-28">
        <div className="grid lg:grid-cols-[1.05fr_1fr] gap-14 lg:gap-20 items-center">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.16em] text-theme-primary mb-5">
              Hormone &amp; blood panels
            </p>
            <h1 className="text-[2.6rem] sm:text-5xl lg:text-[3.4rem] leading-[1.04] mb-6">
              Your labs, read against your cycle.
            </h1>
            {/* Owner R3: differentiate by context, not judgement. The old line,
                "normal on day 3 and worrying on day 21", was a clinical judgement. */}
            <p className="text-lg text-theme-text-body mb-9 max-w-[38ch]">
              Hormone results can mean different things at different points in the menstrual
              cycle. Amani asks for the missing context instead of guessing.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 mb-5">
              <Link to="/signup" className="sm:w-auto">
                <Button size="lg" className="w-full sm:w-auto">{freemium ? copy.heroCta : 'Start your free 7-day trial'}</Button>
              </Link>
              <Link to="/login" className="sm:w-auto">
                <Button variant="outline" size="lg" className="w-full sm:w-auto">Log in</Button>
              </Link>
            </div>
            <p className="text-sm text-theme-muted-text-2">
              {freemium ? copy.heroNote : 'No card to start. Then $9.99 a month, or $99.99 a year.'}
            </p>
          </div>

          {/* Specimen panel — the product, not a picture of the product. */}
          <div className="relative">
            <div className="rounded-2xl border border-theme-border bg-theme-surface p-6 sm:p-7 shadow-theme-lg">
              <div className="flex items-center gap-4 pb-5 mb-5 border-b border-theme-border-inner">
                <svg viewBox="0 0 100 100" className="w-16 h-16 shrink-0" role="img" aria-label="Cycle day 21 of 28, luteal phase">
                  <circle cx="50" cy="50" r="41" fill="none" stroke="#E1C1D0" strokeWidth="8" />
                  <circle
                    cx="50" cy="50" r="41" fill="none" stroke="#95617C" strokeWidth="8"
                    strokeLinecap="round" strokeDasharray="257.6" strokeDashoffset="64.4"
                    transform="rotate(-90 50 50)"
                  />
                  <text x="50" y="47" textAnchor="middle" className="font-mono" fontSize="21" fill="#0D2033">21</text>
                  <text x="50" y="63" textAnchor="middle" className="font-mono" fontSize="9" fill="#716F82" letterSpacing="1">OF 28</text>
                </svg>
                <div>
                  <p className="font-display text-xl text-theme-accent leading-tight">Luteal phase</p>
                  <p className="text-sm text-theme-muted-text-2 mt-0.5">
                    Quest Diagnostics &middot; drawn 14 March
                  </p>
                </div>
              </div>

              {/* Fallback holds the panel's height so nothing shifts when it loads. */}
              <Suspense fallback={<div className="min-h-[15rem]" aria-hidden="true" />}>
                <LandingSpecimen />
              </Suspense>
            </div>
          </div>
        </div>
      </section>

      {/* ── How it works ───────────────────────────────────────── */}
      <section className="border-t border-theme-border-inner bg-theme-background-tint">
        <div className="max-w-6xl mx-auto px-5 sm:px-8 py-20">
          <div className="grid lg:grid-cols-[1fr_1.45fr] gap-12 lg:gap-20">
            <div>
              <h2 className="text-3xl mb-3">How it works</h2>
              <p className="text-theme-muted-text max-w-[34ch]">
                Three steps, about two minutes. Your results stay yours.
              </p>
            </div>
            <ol className="space-y-7">
              <Step
                n="01"
                title="Upload the panel"
                body="A PDF from your portal or a photo of the printout. Quest, LabCorp and Hone are read directly; anything else is parsed generically."
              />
              <Step
                n="02"
                title="Say where you are"
                body="Cycle dates and anything you have noticed — sleep, energy, a new supplement. Amani asks for this context instead of guessing it."
              />
              <Step
                n="03"
                title="Get it in plain language"
                body="Each result beside the interval your laboratory printed, what changed since last time, and questions you could bring to your next appointment."
              />
            </ol>
          </div>
        </div>
      </section>

      {/* ── Pricing ────────────────────────────────────────────── */}
      <section className="max-w-6xl mx-auto px-5 sm:px-8 py-20">
        <div className="mb-10">
          <h2 className="text-3xl mb-3">Pricing</h2>
          <p className="text-theme-muted-text max-w-[42ch]">
            {freemium ? copy.pricingBody : (
              <>
                One plan, billed monthly or yearly. Seven days free first, and you can cancel
                from inside the app.
              </>
            )}
          </p>
        </div>

        <div className="grid sm:grid-cols-2 gap-5 max-w-3xl">
          {/* Emphasis on the recommended tier comes from colour and weight, not
              from making the card taller than its neighbour. */}
          <div className="rounded-2xl border border-theme-border bg-theme-surface p-7 flex flex-col">
            <p className="font-mono text-xs uppercase tracking-[0.14em] text-theme-muted-text-3 mb-4">Monthly</p>
            <p className="mb-7">
              <span className="text-4xl text-theme-text tabular-nums font-medium">$9.99</span>
              <span className="text-theme-muted-text-2 text-sm ml-1">/month</span>
            </p>
            <Link to="/signup" className="mt-auto">
              <Button variant="outline" className="w-full">{freemium ? copy.cardCta : 'Start free trial'}</Button>
            </Link>
          </div>

          <div className="rounded-2xl border-2 border-theme-primary bg-theme-surface p-7 flex flex-col relative">
            <span className="absolute -top-3 left-7 bg-theme-accent text-white font-mono text-[10px] uppercase tracking-[0.12em] px-2.5 py-1 rounded">
              Best value
            </span>
            <p className="font-mono text-xs uppercase tracking-[0.14em] text-theme-primary mb-4">Yearly</p>
            <p className="mb-7">
              <span className="text-4xl text-theme-text tabular-nums font-medium">$99.99</span>
              <span className="text-theme-muted-text-2 text-sm ml-1">/year</span>
            </p>
            <Link to="/signup" className="mt-auto">
              <Button className="w-full">{freemium ? copy.cardCta : 'Start free trial'}</Button>
            </Link>
          </div>
        </div>

        <ul className="grid sm:grid-cols-2 gap-x-10 gap-y-3 mt-10 max-w-3xl">
          {[
            'Unlimited lab panels',
            'Results read with your cycle context',
            'Trends across every past panel',
            'Questions to take to your doctor',
          ].map(f => (
            <li key={f} className="flex items-baseline gap-3 text-theme-text-body border-b border-theme-border-inner pb-3">
              <CycleMark className="w-3.5 h-3.5 text-theme-primary shrink-0 translate-y-0.5" />
              {f}
            </li>
          ))}
        </ul>
      </section>

      {/* ── Boundary ───────────────────────────────────────────── */}
      <section className="border-t border-theme-border-inner">
        <div className="max-w-6xl mx-auto px-5 sm:px-8 py-14">
          <div className="max-w-[62ch]">
            <h2 className="font-mono text-xs uppercase tracking-[0.16em] text-theme-muted-text-3 mb-3">
              What Amani is not
            </h2>
            <p className="text-theme-text-body">
              Amani is educational. It does not diagnose, prescribe, or replace your
              clinician — it helps you walk into the appointment knowing what to ask.
              Anything that concerns you belongs in front of a licensed provider.
            </p>
          </div>
        </div>
      </section>

      <footer className="border-t border-theme-border-inner">
        <div className="max-w-6xl mx-auto px-5 sm:px-8 py-10 flex flex-col sm:flex-row justify-between items-center gap-5">
          <AmaniLogo size="sm" />
          <div className="flex gap-7 text-sm text-theme-muted-text-2">
            <Link to="/privacy" className="hover:text-theme-text transition-colors">Privacy</Link>
            <Link to="/terms" className="hover:text-theme-text transition-colors">Terms</Link>
            <Link to="/contact" className="hover:text-theme-text transition-colors">Contact</Link>
            <Link to="/delete-account" className="hover:text-theme-text transition-colors">Delete account</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
