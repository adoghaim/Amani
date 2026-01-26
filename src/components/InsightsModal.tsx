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
      <div className="bg-white rounded-lg max-w-3xl w-full max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex justify-between items-center">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">Lab Insights</h2>
            {reportDates && (
              <p className="text-sm text-gray-600">
                Comparing {formatDate(reportDates.previous)} to {formatDate(reportDates.current)} ({reportDates.days_between} days)
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="px-6 py-6">
          {loading && (
            <div className="text-center py-8">
              <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-teal-600"></div>
              <p className="mt-4 text-gray-600">Generating insights...</p>
            </div>
          )}

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
              <div>
                <h3 className="font-medium text-red-900">Error</h3>
                <p className="text-sm text-red-700 mt-1">{error}</p>
              </div>
            </div>
          )}

          {insights && !loading && !error && (
            <div className="space-y-6">
              <div className="bg-teal-50 border border-teal-200 rounded-lg p-4">
                <h3 className="font-semibold text-teal-900 mb-2">Summary</h3>
                <p className="text-teal-800">{insights.summary}</p>
              </div>

              {insights.notable_changes && insights.notable_changes.length > 0 && (
                <div>
                  <h3 className="font-semibold text-gray-900 mb-3">Notable Changes</h3>
                  <div className="space-y-4">
                    {insights.notable_changes.map((change, idx) => (
                      <div key={idx} className="border-l-4 border-teal-500 pl-4">
                        <h4 className="font-medium text-gray-900">{change.biomarker}</h4>
                        <p className="text-gray-700 mt-1">{change.change}</p>
                        {change.possible_factors && change.possible_factors.length > 0 && (
                          <div className="mt-2">
                            <p className="text-sm font-medium text-gray-700">Possible factors:</p>
                            <ul className="text-sm text-gray-600 list-disc list-inside mt-1">
                              {change.possible_factors.map((factor, fidx) => (
                                <li key={fidx}>{factor}</li>
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
                  <h3 className="font-semibold text-gray-900 mb-3">Questions for Your Healthcare Provider</h3>
                  <ul className="space-y-2">
                    {insights.questions_to_ask.map((question, idx) => (
                      <li key={idx} className="flex items-start gap-2">
                        <span className="text-teal-600 font-semibold">•</span>
                        <span className="text-gray-700">{question}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {insights.next_steps_general && insights.next_steps_general.length > 0 && (
                <div>
                  <h3 className="font-semibold text-gray-900 mb-3">General Next Steps</h3>
                  <ul className="space-y-2">
                    {insights.next_steps_general.map((step, idx) => (
                      <li key={idx} className="flex items-start gap-2">
                        <span className="text-teal-600 font-semibold">{idx + 1}.</span>
                        <span className="text-gray-700">{step}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                <p className="text-sm text-amber-900">
                  <strong>Disclaimer:</strong> This information is for educational purposes only and is not medical advice.
                  Always consult with your healthcare provider before making any changes to your health routine.
                </p>
              </div>
            </div>
          )}
        </div>

        <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-6 py-4">
          <Button onClick={onClose} className="w-full">
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}
