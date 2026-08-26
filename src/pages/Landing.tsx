import { Heart, Upload, MessageCircle, FileText, CheckCircle } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '../components/Button';

export function Landing() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-theme-background to-theme-surface-2">
      <nav className="bg-theme-surface border-b border-theme-border shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center gap-2">
              <Heart className="w-6 h-6 text-theme-primary fill-theme-primary" />
              <span className="text-xl font-semibold text-theme-text">Amani</span>
            </div>
            <div className="flex items-center gap-4">
              <Link to="/login">
                <Button variant="ghost" size="sm">
                  Log in
                </Button>
              </Link>
              <Link to="/signup">
                <Button size="sm">
                  Start free trial
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </nav>

      <section className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 pt-20 pb-16 text-center">
        <div className="inline-flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-full px-4 py-1.5 mb-6">
          <CheckCircle className="w-4 h-4 text-emerald-600" />
          <span className="text-emerald-700 text-sm font-semibold">7-day free trial — no credit card required to sign up</span>
        </div>
        <h1 className="text-5xl md:text-6xl font-bold text-theme-text mb-4 leading-tight">
          Understand your lab results.
        </h1>
        <p className="text-2xl text-theme-text mb-6 font-medium">
          Clear explanations with real context.
        </p>
        <p className="text-lg text-theme-muted-text mb-10 max-w-3xl mx-auto">
          Amani helps you make sense of hormone labs in context, so you can have better conversations with your doctor.
        </p>
        <div className="flex flex-col sm:flex-row gap-4 justify-center mb-4">
          <Link to="/signup">
            <Button size="lg" className="w-full sm:w-auto">
              Start your free 7-day trial
            </Button>
          </Link>
          <Link to="/login">
            <Button variant="secondary" size="lg" className="w-full sm:w-auto">
              Log in
            </Button>
          </Link>
        </div>
        <p className="text-sm text-theme-muted-text">
          Free for 7 days, then $9.99/mo or $99.99/yr. Cancel anytime.
        </p>
      </section>

      <section className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <h2 className="text-3xl font-bold text-center text-theme-text mb-12">
          How it works
        </h2>
        <div className="grid md:grid-cols-3 gap-8">
          <div className="text-center">
            <div className="w-16 h-16 bg-theme-primary/10 rounded-full flex items-center justify-center mx-auto mb-4">
              <Upload className="w-8 h-8 text-theme-primary" />
            </div>
            <h3 className="text-xl font-semibold text-theme-text mb-2">
              1. Upload labs
            </h3>
            <p className="text-theme-muted-text">
              Upload your lab results as a PDF or image. We keep your data secure and private.
            </p>
          </div>
          <div className="text-center">
            <div className="w-16 h-16 bg-theme-primary/10 rounded-full flex items-center justify-center mx-auto mb-4">
              <MessageCircle className="w-8 h-8 text-theme-primary" />
            </div>
            <h3 className="text-xl font-semibold text-theme-text mb-2">
              2. Add a bit of context
            </h3>
            <p className="text-theme-muted-text">
              Tell us about your cycle, symptoms, and health situation so we can provide personalized insights.
            </p>
          </div>
          <div className="text-center">
            <div className="w-16 h-16 bg-theme-primary/10 rounded-full flex items-center justify-center mx-auto mb-4">
              <FileText className="w-8 h-8 text-theme-primary" />
            </div>
            <h3 className="text-xl font-semibold text-theme-text mb-2">
              3. Get clear explanations
            </h3>
            <p className="text-theme-muted-text">
              Receive an educational breakdown with context, questions to ask your doctor, and guidance on next steps.
            </p>
          </div>
        </div>
      </section>

      <section className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="bg-theme-surface rounded-2xl shadow-lg border border-theme-border p-8 text-center">
          <div className="inline-flex items-center gap-2 bg-rose-50 border border-rose-200 rounded-full px-4 py-1.5 mb-5">
            <span className="w-2 h-2 rounded-full bg-rose-500 inline-block"></span>
            <span className="text-rose-700 text-sm font-semibold tracking-wide uppercase">Founders Launch</span>
          </div>
          <h2 className="text-3xl font-bold text-theme-text mb-6">
            Simple, transparent pricing
          </h2>

          <div className="grid sm:grid-cols-2 gap-6 mb-8 text-left max-w-xl mx-auto">
            <div className="bg-gray-50 rounded-xl p-5 border border-gray-200">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Monthly</p>
              <p className="text-sm text-gray-400 line-through mb-0.5">$19.99/mo</p>
              <p className="text-3xl font-bold text-gray-900">$9.99<span className="text-base font-normal text-gray-500">/mo</span></p>
            </div>
            <div className="bg-gray-50 rounded-xl p-5 border border-rose-300 relative">
              <span className="absolute -top-2.5 right-4 bg-gray-900 text-white text-xs font-semibold px-2.5 py-0.5 rounded-full">Best Value</span>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Yearly</p>
              <p className="text-sm text-gray-400 line-through mb-0.5">$199.99/yr</p>
              <p className="text-3xl font-bold text-gray-900">$99.99<span className="text-base font-normal text-gray-500">/yr</span></p>
            </div>
          </div>

          <div className="inline-flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-full px-4 py-1.5 mb-5">
            <CheckCircle className="w-4 h-4 text-emerald-600" />
            <span className="text-emerald-700 text-sm font-semibold">7-day free trial included</span>
          </div>

          <ul className="text-left space-y-3 mb-6 max-w-md mx-auto">
            <li className="flex items-start gap-2">
              <CheckCircle className="w-4 h-4 text-theme-primary mt-0.5 shrink-0" />
              <span className="text-theme-text">Unlimited lab report uploads</span>
            </li>
            <li className="flex items-start gap-2">
              <CheckCircle className="w-4 h-4 text-theme-primary mt-0.5 shrink-0" />
              <span className="text-theme-text">AI-powered educational explanations</span>
            </li>
            <li className="flex items-start gap-2">
              <CheckCircle className="w-4 h-4 text-theme-primary mt-0.5 shrink-0" />
              <span className="text-theme-text">Cycle-aware context</span>
            </li>
            <li className="flex items-start gap-2">
              <CheckCircle className="w-4 h-4 text-theme-primary mt-0.5 shrink-0" />
              <span className="text-theme-text">Questions to ask your doctor</span>
            </li>
          </ul>
          <Link to="/signup">
            <Button size="lg" className="w-full sm:w-auto mb-3">
              Start your free 7-day trial
            </Button>
          </Link>
          <p className="text-sm text-theme-muted-text">
            Free for 7 days, then $9.99/mo or $99.99/yr. Cancel anytime.
          </p>
        </div>
      </section>

      <section className="bg-theme-surface-2 py-16">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-6">
            <h3 className="text-lg font-semibold text-theme-text mb-2">
              Important: This is educational only
            </h3>
            <p className="text-theme-text">
              Amani provides educational information and does not diagnose conditions or provide medical advice.
              Always consult with a licensed healthcare provider about your health concerns.
            </p>
          </div>
        </div>
      </section>

      <footer className="bg-theme-surface border-t border-theme-border py-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col md:flex-row justify-between items-center gap-4">
            <div className="flex items-center gap-2">
              <Heart className="w-5 h-5 text-theme-primary fill-theme-primary" />
              <span className="text-theme-text font-semibold">Amani</span>
            </div>
            <div className="flex gap-6 text-sm text-theme-muted-text">
              <Link to="/privacy" className="hover:text-theme-text transition-colors">Privacy</Link>
              <Link to="/terms" className="hover:text-theme-text transition-colors">Terms</Link>
              <Link to="/contact" className="hover:text-theme-text transition-colors">Contact</Link>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
