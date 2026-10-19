
import { ArrowUp, ArrowDown, Minus, Sparkles } from 'lucide-react';
import { LabReport, Biomarker, Intervention } from '../types';
import { formatDate } from '../utils/formatters';
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
    // Fixed order, never cycled. These five hues were validated for
    // colour-vision separation and contrast against the #FBF7F5 ground —
    // separation comes from lightness variation as much as hue. Each always
    // renders with its text label, which is what lets the lighter supplement
    // tone sit below 3:1 legally.
    supplement: 'bg-theme-surface text-theme-cat-supplement border-theme-cat-supplement/30',
    diet:       'bg-theme-surface text-theme-cat-diet border-theme-cat-diet/30',
    exercise:   'bg-theme-surface text-theme-cat-exercise border-theme-cat-exercise/30',
    medication: 'bg-theme-surface text-theme-cat-medication border-theme-cat-medication/30',
    sleep:      'bg-theme-surface text-theme-cat-sleep border-theme-cat-sleep/30',
    other:      'bg-theme-surface-2 text-theme-muted-text border-theme-border',
  };
  return colors[category] ?? colors.other ?? 'bg-theme-surface-2 text-theme-muted-text border-theme-border';
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

  const getQuickHighlights = (items: Array<{ biomarkerName: string; current: Biomarker; previous: Biomarker | null; delta: { value: number; percent: number } | null }>) => {
    const ranked = items
      .filter((i) => i.delta !== null)
      .sort((a, b) => Math.abs((b.delta?.percent ?? 0)) - Math.abs((a.delta?.percent ?? 0)))
      .slice(0, 2);
    return ranked.map((i) => {
      const d = i.delta!;
      const dir = d.value === 0 ? 'no change' : d.value > 0 ? 'up' : 'down';
      return `${i.biomarkerName}: ${dir} ${d.value > 0 ? '+' : ''}${d.value.toFixed(1)} (${d.percent.toFixed(0)}%)`;
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
        <div className="text-center py-12 text-theme-muted-text">
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

        const comparisons = KEY_BIOMARKERS.flatMap((biomarkerName) => {
          const current = findBiomarker(currentBiomarkers, biomarkerName);
          const previous = previousReport ? findBiomarker(previousBiomarkers, biomarkerName) ?? null : null;

          if (!current) return [];

          let delta = null;
          if (previous) {
            delta = calculateDelta(current.value, previous.value);
          }

          return [{ biomarkerName: current.name, current, previous, delta }];
        });

        const quickHighlights = getQuickHighlights(comparisons);

        const activeInterventions = getActiveInterventions(report.report_date);
        const displayedInterventions = activeInterventions.slice(0, 3);
        const remainingCount = activeInterventions.length - 3;

        return (
          <Card key={report.id}>
            <div className="flex justify-between items-start mb-6">
              <div>
                <h3 className="text-lg text-theme-text">{formatDate(report.report_date)}</h3>
                {report.lab_name && (
                  <p className="text-sm text-theme-muted-text">{report.lab_name}</p>
                )}
              </div>
              <div className="flex items-center gap-3">
                {daysSincePrevious !== null && (
                  <span className="text-sm text-theme-muted-text">
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
                    <span className="inline-flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-theme-accent" />
                      <span className="hidden sm:inline">Insights</span>
                    </span>
                  </Button>
                )}
              </div>
            </div>

            {index === 0 && sortedReports.length === 1 && (
              <div className="mb-6 bg-gradient-to-r from-theme-surface-2 to-theme-cat-medication border border-theme-border rounded-xl p-4 shadow-sm">
                <p className="text-sm font-medium text-theme-text">This is your baseline. Everything builds from here.</p>
                <p className="text-xs text-theme-muted-text mt-2">
                  Upload another lab report to see how your biomarkers change over time.
                </p>
              </div>
            )}

            {quickHighlights.length > 0 && (
              <div className="mb-6 bg-theme-surface-2 border border-theme-border rounded-xl p-4 shadow-sm">
                <p className="text-xs font-medium text-theme-muted-text mb-2">What stood out</p>
                <ul className="text-sm text-theme-text list-disc list-inside space-y-1.5">
                  {quickHighlights.map((h, i) => (
                    <li key={i}>{h}</li>
                  ))}
                </ul>
              </div>
            )}

            {activeInterventions.length > 0 && (
              <div className="mb-6">
                <p className="text-xs font-medium text-theme-muted-text mb-2">Active during this period:</p>
                <div className="flex flex-wrap gap-2">
                  {displayedInterventions.map((intervention) => (
                    <span
                      key={intervention.id}
                      className={`px-3 py-1.5 text-xs font-medium rounded-lg border ${getCategoryColor(
                        intervention.category
                      )}`}
                    >
                      {intervention.title}
                    </span>
                  ))}
                  {remainingCount > 0 && (
                    <span className="px-3 py-1.5 text-xs font-medium rounded-lg bg-theme-surface-2 text-theme-muted-text border border-theme-border">
                      +{remainingCount} more
                    </span>
                  )}
                </div>
              </div>
            )}

            {comparisons.length > 0 && (
              <div className="space-y-3">
                <h4 className="text-sm font-medium text-theme-text">Key biomarkers</h4>
                {comparisons.map((comparison, idx) => {
                  const { biomarkerName, current, delta } = comparison!;
                  return (
                    <div key={idx} className="flex items-center justify-between py-3 border-b border-theme-border last:border-0">
                      <div className="flex-1">
                        <span className="text-sm font-medium text-theme-text">{biomarkerName}</span>
                        <div className="text-sm text-theme-muted-text">
                          {current.value} {current.unit}
                        </div>
                      </div>
                      {/*
                        Direction is not valence (PK-FIX-02): both directions use
                        the same neutral ink, never amber for up and green for
                        down. The arrow and the sign carry the direction.
                      */}
                      {delta && (
                        <div className="flex items-center gap-2">
                          {delta.value === 0 ? (
                            <div className="flex items-center gap-1 text-theme-muted-text">
                              <Minus className="w-4 h-4" />
                              <span className="text-sm">No change</span>
                            </div>
                          ) : delta.value > 0 ? (
                            <div className="flex items-center gap-1 text-theme-text">
                              <ArrowUp className="w-4 h-4" />
                              <span className="text-sm font-medium">
                                +{delta.value.toFixed(1)} ({delta.percent.toFixed(0)}%)
                              </span>
                            </div>
                          ) : (
                            <div className="flex items-center gap-1 text-theme-text">
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
              <p className="text-sm text-theme-muted-text">No key biomarkers tracked in this report</p>
            )}
          </Card>
        );
      })}
    </div>
  );
}
