import { X, AlertCircle, TrendingUp, TrendingDown, Minus, Sparkles, MessageSquare, ArrowRight, CheckCircle2, Info } from 'lucide-react';

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

function ChangeIcon({ text }: { text: string }) {
  const lower = text.toLowerCase();
  if (lower.includes('increased') || lower.includes('rose') || lower.includes('higher') || lower.includes('went up')) {
    return <TrendingUp className="w-4 h-4 text-amber-500" />;
  }
  if (lower.includes('decreased') || lower.includes('fell') || lower.includes('lower') || lower.includes('went down') || lower.includes('dropped')) {
    return <TrendingDown className="w-4 h-4 text-blue-500" />;
  }
  return <Minus className="w-4 h-4 text-gray-400" />;
}

export function InsightsModal({ isOpen, onClose, insights, reportDates, loading, error }: InsightsModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden shadow-2xl flex flex-col">

        {/* Header */}
        <div className="bg-gradient-to-r from-[#2A1F23] to-[#4a3040] px-6 py-5 flex-shrink-0">
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <Sparkles className="w-5 h-5 text-[#E8B4BD]" />
                <h2 className="text-lg font-semibold text-white">Your Health Story</h2>
              </div>
              {reportDates ? (
                <p className="text-[#c4adb2] text-xs">
                  Comparing {formatDate(reportDates.previous)} → {formatDate(reportDates.current)}
                  <span className="ml-1 text-[#a08890]">({reportDates.days_between} days)</span>
                </p>
              ) : (
                <p className="text-[#c4adb2] text-xs">Comparing your two most recent reports</p>
              )}
            </div>
            <button
              onClick={onClose}
              className="text-[#c4adb2] hover:text-white transition-colors ml-4 flex-shrink-0"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 px-6 py-6">

          {loading && (
            <div className="flex flex-col items-center justify-center py-16 gap-4">
              <div className="w-12 h-12 rounded-full border-3 border-[#C97C8B]/20 border-t-[#C97C8B] animate-spin" style={{ borderWidth: 3 }} />
              <div className="text-center">
                <p className="font-medium text-gray-800 mb-1">Generating insights</p>
                <p className="text-sm text-gray-500">Analyzing changes between your reports…</p>
              </div>
            </div>
          )}

          {error && !loading && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-medium text-red-900 text-sm">Could not generate insights</p>
                <p className="text-sm text-red-700 mt-1">{error}</p>
              </div>
            </div>
          )}

          {insights && !loading && !error && (
            <div className="space-y-6">

              {/* Summary */}
              <div className="rounded-xl bg-gradient-to-br from-[#fdf6f7] to-rose-50 border border-[#e8dce0] p-5">
                <p className="text-sm font-semibold text-[#2A1F23] mb-2 uppercase tracking-wide">What changed</p>
                <p className="text-gray-700 leading-relaxed text-sm">{insights.summary}</p>
              </div>

              {/* Notable changes */}
              {insights.notable_changes?.length > 0 && (
                <div>
                  <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">Notable biomarker changes</p>
                  <div className="space-y-3">
                    {insights.notable_changes.map((change, idx) => (
                      <div key={idx} className="rounded-xl border border-gray-100 bg-white shadow-sm overflow-hidden">
                        <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-50">
                          <ChangeIcon text={change.change} />
                          <span className="font-semibold text-gray-900 text-sm">{change.biomarker}</span>
                        </div>
                        <div className="px-4 py-3">
                          <p className="text-sm text-gray-600 leading-relaxed mb-3">{change.change}</p>
                          {change.possible_factors?.length > 0 && (
                            <div>
                              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                                This may have coincided with
                              </p>
                              <ul className="space-y-1.5">
                                {change.possible_factors.map((factor, fidx) => (
                                  <li key={fidx} className="flex items-start gap-2">
                                    <ArrowRight className="w-3 h-3 text-[#C97C8B] mt-1 flex-shrink-0" />
                                    <span className="text-xs text-gray-600 leading-relaxed">{factor}</span>
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
                  <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">Questions for your provider</p>
                  <div className="space-y-2">
                    {insights.questions_to_ask.map((q, idx) => (
                      <div key={idx} className="flex items-start gap-3 p-3 rounded-lg bg-gray-50 hover:bg-gray-100 transition-colors">
                        <span className="text-xs font-bold text-[#C97C8B] bg-[#C97C8B]/10 rounded-full w-5 h-5 flex items-center justify-center flex-shrink-0 mt-0.5">
                          {idx + 1}
                        </span>
                        <p className="text-sm text-gray-700 leading-relaxed">{q}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Next steps */}
              {insights.next_steps_general?.length > 0 && (
                <div>
                  <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">General next steps</p>
                  <div className="space-y-2">
                    {insights.next_steps_general.map((step, idx) => (
                      <div key={idx} className="flex items-start gap-3">
                        <CheckCircle2 className="w-4 h-4 text-[#C97C8B] flex-shrink-0 mt-0.5" />
                        <p className="text-sm text-gray-700 leading-relaxed">{step}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Disclaimer */}
              <div className="flex items-start gap-3 bg-gray-50 border border-gray-200 rounded-xl px-4 py-3">
                <Info className="w-4 h-4 text-gray-400 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-gray-500 leading-relaxed italic">
                  This information is for educational purposes only and is not medical advice. Always consult your healthcare provider before making changes to your health routine.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex-shrink-0 border-t border-gray-100 px-6 py-4">
          <button
            onClick={onClose}
            className="w-full py-2.5 rounded-xl bg-[#2A1F23] text-white text-sm font-medium hover:bg-[#3d2d32] transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
