import { ArrowUp, ArrowDown, Minus } from 'lucide-react';
import { LabReport, Biomarker } from '../types';
import { Card } from './Card';

interface LabsTimelineProps {
  reports: LabReport[];
  biomarkersByReport: Record<string, Biomarker[]>;
}

const KEY_BIOMARKERS = ['ferritin', 'vitamin d', 'vitamin_d', 'tsh', 'hba1c', 'ldl', 'ldl-c'];

export function LabsTimeline({ reports, biomarkersByReport }: LabsTimelineProps) {
  const sortedReports = [...reports].sort(
    (a, b) => new Date(a.report_date).getTime() - new Date(b.report_date).getTime()
  );

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

        return (
          <Card key={report.id}>
            <div className="flex justify-between items-start mb-4">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">{formatDate(report.report_date)}</h3>
                {report.lab_name && (
                  <p className="text-sm text-gray-600">{report.lab_name}</p>
                )}
              </div>
              {daysSincePrevious !== null && (
                <span className="text-sm text-gray-600">
                  {daysSincePrevious} days since previous
                </span>
              )}
            </div>

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
