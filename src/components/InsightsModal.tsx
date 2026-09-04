import { X, AlertCircle, TrendingUp, TrendingDown, Minus, Sparkles, ArrowRight, CheckCircle2, Info } from 'lucide-react';
import { ErrorBoundary } from './ErrorBoundary';

interface Insight {
  summary: string;
  notable_changes: Array<{
    biomarker: string;
    change: string;
    possible_factors: string[];
  }>;
  questions_to_ask: string[];
  next_steps_general: string[];
}

interface InsightsModalProps {
  isOpen: boolean;
  onClose: () => void;
  insights: Insight | null;
  reportDates?: {
    previous: string;
    current: string;
    days_between: number;
  };
  loading?: boolean;
  error?: string;
}

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
  });
}

function ChangeIcon({ text }: { text?: string | null }) {
  // Defence in depth. The server now guarantees a non-empty string here
  // (_shared/lab-insights-output.ts), which is what protects the shipped native
  // builds that cannot be updated. This guard covers anything already cached on
  // a device from before that fix.
  const lower = (text ?? '').toLowerCase();
  if (lower.includes('increased') || lower.includes('rose') || lower.includes('higher') || lower.includes('went up')) {
    return <TrendingUp className="w-4 h-4 text-theme-flag-watch" />;
  }
  if (lower.includes('decreased') || lower.includes('fell') || lower.includes('lower') || lower.includes('went down') || lower.includes('dropped')) {
    return <TrendingDown className="w-4 h-4 text-theme-info" />;
  }
  return <Minus className="w-4 h-4 text-theme-neutral-400" />;
}

/**
 * Rendered instead of the insights body if anything in it throws.
 *
 * The app-wide ErrorBoundary is mounted at the root of App.tsx with no
 * per-route boundary, so before this existed a throw anywhere in this modal
 * took the whole app down to a "Something went wrong / Reload" screen. The
 * server now guarantees the shape (_shared/lab-insights-output.ts), which is
 * what protects already-shipped native builds — this is the second line, for
 * anything that guarantee does not cover.
 *
 * Scoped INSIDE the modal body deliberately, so the header and both close
 * buttons survive and the user can dismiss it. A boundary wrapped around the
 * whole modal would replace the chrome too and leave them stuck.
 */
function InsightsRenderError() {
  return (
    <div className="bg-theme-flag-low-bg border border-theme-flag-low-border rounded-xl p-4 flex items-start gap-3">
      <AlertCircle className="w-5 h-5 text-theme-flag-low flex-shrink-0 mt-0.5" />
      <div>
        <p className="font-medium text-theme-flag-low text-sm">Could not display these insights</p>
        <p className="text-sm text-theme-flag-low mt-1">
          Your lab results and history are unaffected. Close this and try again.
        </p>
      </div>
    </div>
  );
}

export function InsightsModal({ isOpen, onClose, insights, reportDates, loading, error }: InsightsModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-theme-surface rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden shadow-2xl flex flex-col">

        {/* Header */}
        <div className="bg-gradient-to-r from-theme-text to-theme-text-body px-6 py-5 flex-shrink-0">
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <Sparkles className="w-5 h-5 text-theme-primary" />
                <h2 className="text-lg text-white">Your health story</h2>
              </div>
              {reportDates ? (
                <p className="text-theme-muted-text-3 text-xs">
                  Comparing {formatDate(reportDates.previous)} → {formatDate(reportDates.current)}
                  <span className="ml-1 text-theme-muted-text-3">({reportDates.days_between} days)</span>
                </p>
              ) : (
                <p className="text-theme-muted-text-3 text-xs">Comparing your two most recent reports</p>
              )}
            </div>
            <button
              onClick={onClose}
              className="text-theme-muted-text-3 hover:text-white transition-colors ml-4 flex-shrink-0"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 px-6 py-6">

          {loading && (
            <div className="flex flex-col items-center justify-center py-16 gap-4">
              <div className="w-12 h-12 rounded-full border-3 border-theme-primary/20 border-t-theme-primary animate-spin" style={{ borderWidth: 3 }} />
              <div className="text-center">
                <p className="font-medium text-theme-neutral-800 mb-1">Generating insights</p>
                <p className="text-sm text-theme-neutral-500">Analyzing changes between your reports…</p>
              </div>
            </div>
          )}

          {error && !loading && (
            <div className="bg-theme-flag-low-bg border border-theme-flag-low-border rounded-xl p-4 flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-theme-flag-low flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-medium text-theme-flag-low text-sm">Could not generate insights</p>
                <p className="text-sm text-theme-flag-low mt-1">{error}</p>
              </div>
            </div>
          )}

          {insights && !loading && !error && (
            <ErrorBoundary fallback={<InsightsRenderError />}>
            <div className="space-y-6">

              {/* Summary */}
              <div className="rounded-xl bg-gradient-to-br from-theme-background-tint to-theme-flag-low border border-theme-border-subtle p-5">
                <p className="text-sm font-semibold text-theme-text mb-2 uppercase tracking-wide">What changed</p>
                <p className="text-theme-neutral-700 leading-relaxed text-sm">{insights.summary}</p>
              </div>

              {/* Notable changes */}
              {insights.notable_changes?.length > 0 && (
                <div>
                  <p className="text-xs font-bold text-theme-neutral-400 uppercase tracking-widest mb-3">Notable biomarker changes</p>
                  <div className="space-y-3">
                    {insights.notable_changes.map((change, idx) => (
                      <div key={idx} className="rounded-xl border border-theme-neutral-100 bg-theme-surface shadow-sm overflow-hidden">
                        <div className="flex items-center gap-3 px-4 py-3 border-b border-theme-neutral-50">
                          <ChangeIcon text={change.change} />
                          <span className="font-semibold text-theme-neutral-900 text-sm">{change.biomarker}</span>
                        </div>
                        <div className="px-4 py-3">
                          <p className="text-sm text-theme-neutral-600 leading-relaxed mb-3">{change.change}</p>
                          {change.possible_factors?.length > 0 && (
                            <div>
                              <p className="text-xs font-semibold text-theme-neutral-500 uppercase tracking-wide mb-2">
                                This may have coincided with
                              </p>
                              <ul className="space-y-1.5">
                                {change.possible_factors.map((factor, fidx) => (
                                  <li key={fidx} className="flex items-start gap-2">
                                    <ArrowRight className="w-3 h-3 text-theme-primary mt-1 flex-shrink-0" />
                                    <span className="text-xs text-theme-neutral-600 leading-relaxed">{factor}</span>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Questions to ask */}
              {insights.questions_to_ask?.length > 0 && (
                <div>
                  <p className="text-xs font-bold text-theme-neutral-400 uppercase tracking-widest mb-3">Questions for your provider</p>
                  <div className="space-y-2">
                    {insights.questions_to_ask.map((q, idx) => (
                      <div key={idx} className="flex items-start gap-3 p-3 rounded-lg bg-theme-neutral-50 hover:bg-theme-neutral-100 transition-colors">
                        <span className="text-xs font-bold text-theme-primary bg-theme-primary/10 rounded-full w-5 h-5 flex items-center justify-center flex-shrink-0 mt-0.5">
                          {idx + 1}
                        </span>
                        <p className="text-sm text-theme-neutral-700 leading-relaxed">{q}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Next steps */}
              {insights.next_steps_general?.length > 0 && (
                <div>
                  <p className="text-xs font-bold text-theme-neutral-400 uppercase tracking-widest mb-3">General next steps</p>
                  <div className="space-y-2">
                    {insights.next_steps_general.map((step, idx) => (
                      <div key={idx} className="flex items-start gap-3">
                        <CheckCircle2 className="w-4 h-4 text-theme-primary flex-shrink-0 mt-0.5" />
                        <p className="text-sm text-theme-neutral-700 leading-relaxed">{step}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Disclaimer */}
              <div className="flex items-start gap-3 bg-theme-neutral-50 border border-theme-neutral-200 rounded-xl px-4 py-3">
                <Info className="w-4 h-4 text-theme-neutral-400 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-theme-neutral-500 leading-relaxed italic">
                  This information is for educational purposes only and is not medical advice. Always consult your healthcare provider before making changes to your health routine.
                </p>
              </div>
            </div>
            </ErrorBoundary>
          )}
        </div>

        {/* Footer */}
        <div className="flex-shrink-0 border-t border-theme-neutral-100 px-6 py-4">
          <button
            onClick={onClose}
            className="w-full py-2.5 rounded-xl bg-theme-text text-white text-sm font-medium hover:bg-theme-neutral-800 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
