import { useState } from 'react';
import { ArrowUp, ArrowDown, Minus, Sparkles, X } from 'lucide-react';
import { LabReport, Biomarker, Intervention } from '../types';
import { Card } from './Card';
import { Button } from './Button';

interface LabsTimelineProps {
  reports: LabReport[];
  biomarkersByReport: Record<string, Biomarker[]>;
  interventions?: Intervention[];
  onGenerateInsights?: (reportId: string, previousReportId: string | null) => void;
}

const KEY_BIOMARKERS = ['ferritin', 'vitamin d', 'vitamin_d', 'tsh', 'hba1c', 'ldl', 'ldl-c'];

const getCategoryColor = (category: string): string => {
  const colors: Record<string, string> = {
    supplement: 'bg-purple-100 text-purple-700 border-purple-200',
    diet: 'bg-green-100 text-green-700 border-green-200',
    exercise: 'bg-blue-100 text-blue-700 border-blue-200',
    medication: 'bg-red-100 text-red-700 border-red-200',
    sleep: 'bg-indigo-100 text-indigo-700 border-indigo-200',
    other: 'bg-gray-100 text-gray-700 border-gray-200',
  };
  return colors[category] || colors.other;
};

export function LabsTimeline({ reports, biomarkersByReport, interventions = [], onGenerateInsights }: LabsTimelineProps) {
  const sortedReports = [...reports].sort(
    (a, b) => new Date(a.report_date).getTime() - new Date(b.report_date).getTime()
  );

  const getActiveInterventions = (reportDate: string): Intervention[] => {
    const reportDateObj = new Date(reportDate);
    return interventions.filter((intervention) => {
      const startDate = new Date(intervention.start_date);
      const endDate = intervention.end_date ? new Date(intervention.end_date) : null;
      return startDate <= reportDateObj && (!endDate || endDate >= reportDateObj);
    });
  };

  const findBiomarker = (biomarkers: Biomarker[], name: string): Biomarker | undefined => {
    const normalized = name.toLowerCase().trim();
    return biomarkers.find((b) => b.name.toLowerCase().trim() === normalized);
  };

  const calculateDelta = (current: number, previous: number): { value: number; percent: number } => {
    const delta = current - previous;
    const percent = previous !== 0 ? (delta / previous) * 100 : 0;
    return { value: delta, percent };
  };

  const formatDate = (dateString: string): string => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  const getDaysSince = (currentDate: string, previousDate: string): number => {
    const current = new Date(currentDate);
    const previous = new Date(previousDate);
    const diffTime = Math.abs(current.getTime() - previous.getTime());
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  };

  if (sortedReports.length === 0) {
    return (
      <Card>
        <div className="text-center py-8 text-gray-600">
          <p>No lab reports yet. Upload your first lab report to start tracking.</p>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {sortedReports.map((report, index) => {
        const previousReport = index > 0 ? sortedReports[index - 1] : null;
        const currentBiomarkers = biomarkersByReport[report.id] || [];
        const previousBiomarkers = previousReport ? biomarkersByReport[previousReport.id] || [] : [];

        const daysSincePrevious = previousReport
          ? getDaysSince(report.report_date, previousReport.report_date)
          : null;

        const comparisons = KEY_BIOMARKERS.map((biomarkerName) => {
          const current = findBiomarker(currentBiomarkers, biomarkerName);
          const previous = previousReport ? findBiomarker(previousBiomarkers, biomarkerName) : null;

          if (!current) return null;

          let delta = null;
          if (previous) {
            delta = calculateDelta(current.value, previous.value);
          }

          return { biomarkerName: current.name, current, previous, delta };
        }).filter((c) => c !== null);

        const activeInterventions = getActiveInterventions(report.report_date);
        const displayedInterventions = activeInterventions.slice(0, 3);
        const remainingCount = activeInterventions.length - 3;

        return (
          <Card key={report.id}>
            <div className="flex justify-between items-start mb-4">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">{formatDate(report.report_date)}</h3>
                {report.lab_name && (
                  <p className="text-sm text-gray-600">{report.lab_name}</p>
                )}
              </div>
              <div className="flex items-center gap-2">
                {daysSincePrevious !== null && (
                  <span className="text-sm text-gray-600">
                    {daysSincePrevious} days since previous
                  </span>
                )}
                {onGenerateInsights && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => onGenerateInsights(report.id, previousReport?.id || null)}
                    disabled={!previousReport}
                    title={!previousReport ? 'Upload at least two labs to compare' : 'Generate AI insights'}
                  >
                    <Sparkles className="w-4 h-4" />
                  </Button>
                )}
              </div>
            </div>

            {activeInterventions.length > 0 && (
              <div className="mb-4">
                <p className="text-xs font-medium text-gray-600 mb-2">Active interventions:</p>
                <div className="flex flex-wrap gap-2">
                  {displayedInterventions.map((intervention) => (
                    <span
                      key={intervention.id}
                      className={`px-2 py-1 text-xs font-medium rounded border ${getCategoryColor(
                        intervention.category
                      )}`}
                    >
                      {intervention.title}
                    </span>
                  ))}
                  {remainingCount > 0 && (
                    <span className="px-2 py-1 text-xs font-medium rounded bg-gray-100 text-gray-700 border border-gray-200">
                      +{remainingCount} more
                    </span>
                  )}
                </div>
              </div>
            )}

            {comparisons.length > 0 && (
              <div className="space-y-3">
                <h4 className="text-sm font-medium text-gray-700">Key biomarkers</h4>
                {comparisons.map((comparison, idx) => {
                  const { biomarkerName, current, delta } = comparison!;
                  return (
                    <div key={idx} className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
                      <div className="flex-1">
                        <span className="text-sm font-medium text-gray-900">{biomarkerName}</span>
                        <div className="text-sm text-gray-600">
                          {current.value} {current.unit}
                        </div>
                      </div>
                      {delta && (
                        <div className="flex items-center gap-2">
                          {delta.value === 0 ? (
                            <div className="flex items-center gap-1 text-gray-600">
                              <Minus className="w-4 h-4" />
                              <span className="text-sm">No change</span>
                            </div>
                          ) : delta.value > 0 ? (
                            <div className="flex items-center gap-1 text-orange-600">
                              <ArrowUp className="w-4 h-4" />
                              <span className="text-sm font-medium">
                                +{delta.value.toFixed(1)} ({delta.percent.toFixed(0)}%)
                              </span>
                            </div>
                          ) : (
                            <div className="flex items-center gap-1 text-blue-600">
                              <ArrowDown className="w-4 h-4" />
                              <span className="text-sm font-medium">
                                {delta.value.toFixed(1)} ({delta.percent.toFixed(0)}%)
                              </span>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {comparisons.length === 0 && (
              <p className="text-sm text-gray-600">No key biomarkers tracked in this report</p>
            )}
          </Card>
        );
      })}
    </div>
  );
}
