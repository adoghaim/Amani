import { X, AlertCircle } from 'lucide-react';
import { Button } from './Button';

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

export function InsightsModal({ isOpen, onClose, insights, reportDates, loading, error }: InsightsModalProps) {
  if (!isOpen) return null;

  const formatDate = (dateString: string): string => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-theme-surface rounded-2xl max-w-3xl w-full max-h-[90vh] overflow-y-auto shadow-2xl">
        <div className="sticky top-0 bg-gradient-to-r from-theme-surface-2 to-pink-50 border-b border-theme-border px-8 py-6 flex justify-between items-center rounded-t-2xl">
          <div>
            <h2 className="text-2xl font-semibold text-theme-text">Your health story so far</h2>
            {reportDates && (
              <p className="text-sm text-theme-muted-text mt-1">
                Since your last labs on {formatDate(reportDates.previous)} ({reportDates.days_between} days ago)
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="text-theme-muted-text hover:text-theme-text transition-colors"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="px-8 py-8">
          {loading && (
            <div className="text-center py-12">
              <div className="inline-block animate-spin rounded-full h-10 w-10 border-b-2 border-theme-primary"></div>
              <p className="mt-4 text-theme-muted-text">Generating insights...</p>
            </div>
          )}

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-5 flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-theme-danger flex-shrink-0 mt-0.5" />
              <div>
                <h3 className="font-medium text-red-900">Error</h3>
                <p className="text-sm text-red-700 mt-1">{error}</p>
              </div>
            </div>
          )}

          {insights && !loading && !error && (
            <div className="space-y-8">
              <div className="bg-gradient-to-br from-theme-surface-2 to-pink-50 border border-theme-border rounded-xl p-5">
                <h3 className="font-semibold text-theme-text mb-3">What's happening</h3>
                <p className="text-theme-text leading-relaxed">{insights.summary}</p>
              </div>

              {insights.notable_changes && insights.notable_changes.length > 0 && (
                <div>
                  <h3 className="font-semibold text-theme-text mb-3">Since your last labs</h3>
                  <p className="text-sm text-theme-muted-text mb-4">These changes stood out during this window:</p>
                  <div className="space-y-5">
                    {insights.notable_changes.map((change, idx) => (
                      <div key={idx} className="border-l-4 border-theme-primary pl-5 py-1">
                        <h4 className="font-medium text-theme-text">{change.biomarker}</h4>
                        <p className="text-theme-muted-text mt-2 leading-relaxed">{change.change}</p>
                        {change.possible_factors && change.possible_factors.length > 0 && (
                          <div className="mt-3">
                            <p className="text-sm font-medium text-theme-text">This change may have coincided with:</p>
                            <ul className="text-sm text-theme-muted-text space-y-1 mt-2">
                              {change.possible_factors.map((factor, fidx) => (
                                <li key={fidx} className="flex items-start gap-2">
                                  <span className="text-theme-primary mt-1">•</span>
                                  <span>{factor}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {insights.questions_to_ask && insights.questions_to_ask.length > 0 && (
                <div>
                  <h3 className="font-semibold text-theme-text mb-4">Key Takeaways for your provider</h3>
                  <ul className="space-y-3">
                    {insights.questions_to_ask.map((question, idx) => (
                      <li key={idx} className="flex items-start gap-3">
                        <span className="text-theme-primary font-semibold">•</span>
                        <span className="text-theme-muted-text leading-relaxed">{question}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {insights.next_steps_general && insights.next_steps_general.length > 0 && (
                <div>
                  <h3 className="font-semibold text-theme-text mb-4">General Next Steps</h3>
                  <ul className="space-y-3">
                    {insights.next_steps_general.map((step, idx) => (
                      <li key={idx} className="flex items-start gap-3">
                        <span className="text-theme-primary font-semibold">{idx + 1}.</span>
                        <span className="text-theme-muted-text leading-relaxed">{step}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-5">
                <p className="text-sm text-amber-900 leading-relaxed">
                  <strong>Disclaimer:</strong> This information is for educational purposes only and is not medical advice.
                  Always consult with your healthcare provider before making any changes to your health routine.
                </p>
              </div>
            </div>
          )}
        </div>

        <div className="sticky bottom-0 bg-theme-surface-2 border-t border-theme-border px-8 py-5 rounded-b-2xl">
          <Button onClick={onClose} className="w-full">
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}
