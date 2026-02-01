import { Heart, Upload, MessageCircle, FileText } from 'lucide-react';
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
              <a href="/login">
                <Button variant="ghost" size="sm">
                  Log in
                </Button>
              </a>
              <a href="/signup">
                <Button size="sm">
                  Start free trial
                </Button>
              </a>
            </div>
          </div>
        </div>
      </nav>

      <section className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 pt-20 pb-16 text-center">
        <h1 className="text-5xl md:text-6xl font-bold text-theme-text mb-6 leading-tight">
          Understand your lab results — calmly.
        </h1>
        <p className="text-xl text-theme-muted-text mb-10 max-w-3xl mx-auto">
          Amani helps you make sense of hormone labs in context, so you can have better conversations with your doctor.
        </p>
        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <a href="/signup">
            <Button size="lg" className="w-full sm:w-auto">
              Start free trial
            </Button>
          </a>
          <a href="/login">
            <Button variant="secondary" size="lg" className="w-full sm:w-auto">
              Log in
            </Button>
          </a>
        </div>
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
              3. Get a clear, calm explanation
            </h3>
            <p className="text-theme-muted-text">
              Receive an educational breakdown with context, questions to ask your doctor, and supportive guidance.
            </p>
          </div>
        </div>
      </section>

      <section className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="bg-theme-surface rounded-2xl shadow-lg border border-theme-border p-8 text-center">
          <h2 className="text-3xl font-bold text-theme-text mb-4">
            Transparent pricing
          </h2>
          <div className="text-5xl font-bold text-theme-text mb-2">
            $24<span className="text-2xl text-theme-muted-text">/month</span>
          </div>
          <p className="text-lg text-theme-muted-text mb-6">
            30-day free trial • Cancel anytime
          </p>
          <ul className="text-left space-y-3 mb-8 max-w-md mx-auto">
            <li className="flex items-start gap-2">
              <span className="text-theme-primary mt-1">✓</span>
              <span className="text-theme-text">Unlimited lab report uploads</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-theme-primary mt-1">✓</span>
              <span className="text-theme-text">AI-powered educational explanations</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-theme-primary mt-1">✓</span>
              <span className="text-theme-text">Cycle-aware context</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-theme-primary mt-1">✓</span>
              <span className="text-theme-text">Questions to ask your doctor</span>
            </li>
          </ul>
          <a href="/signup">
            <Button size="lg" className="w-full sm:w-auto">
              Start your free trial
            </Button>
          </a>
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
              <a href="#" className="hover:text-theme-text transition-colors">Privacy</a>
              <a href="#" className="hover:text-theme-text transition-colors">Terms</a>
              <a href="#" className="hover:text-theme-text transition-colors">Contact</a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
