import { useState, useMemo, useEffect } from 'react';
import { ArrowUp, ArrowDown, Minus } from 'lucide-react';
import { Card } from './Card';
import { LabReport, Biomarker } from '../types';
import { COMPARE_SHIFTS_NOTE } from '../lib/scoring/insightCopy';
import { firstPartyEvents } from '../lib/firstPartyEventsClient';

interface CompareViewProps {
  reports: LabReport[];
  biomarkersByReport: Record<string, Biomarker[]>;
}

export function CompareView({ reports, biomarkersByReport }: CompareViewProps) {
  const sortedReports = useMemo(
    () => [...reports].sort((a, b) => new Date(a.report_date).getTime() - new Date(b.report_date).getTime()),
    [reports]
  );

  const [baselineId, setBaselineId] = useState('');
  const [followupId, setFollowupId] = useState('');

  useEffect(() => {
    const shouldAutoCompare = sessionStorage.getItem('showSecondLabComparison');
    if (shouldAutoCompare === 'true' && sortedReports.length === 2 && sortedReports[0] && sortedReports[1]) {
      setBaselineId(sortedReports[0].id);
      setFollowupId(sortedReports[1].id);
      sessionStorage.removeItem('showSecondLabComparison');

      setTimeout(() => {
        const element = document.getElementById('biggest-changes');
        if (element) {
          element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 500);
    }
  }, [sortedReports]);

  // PK-EXP5 funnel step, once per pair shown; off unless first_party_events is on.
  const comparing = Boolean(baselineId && followupId);
  useEffect(() => {
    if (comparing) void firstPartyEvents.track('compare_viewed');
  }, [comparing, baselineId, followupId]);

  const formatDate = (dateString: string): string => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  const comparison = useMemo(() => {
    if (!baselineId || !followupId) return null;

    const baselineBiomarkers = biomarkersByReport[baselineId] || [];
    const followupBiomarkers = biomarkersByReport[followupId] || [];

    const comparisons: Array<{
      name: string;
      baseline: { value: number; unit: string };
      followup: { value: number; unit: string };
      delta: number;
      percentChange: number;
    }> = [];

    baselineBiomarkers.forEach((baseBiomarker) => {
      const followupBiomarker = followupBiomarkers.find(
        (fb) => fb.name.toLowerCase().trim() === baseBiomarker.name.toLowerCase().trim()
      );

      if (followupBiomarker && baseBiomarker.unit === followupBiomarker.unit) {
        const delta = followupBiomarker.value - baseBiomarker.value;
        const percentChange =
          baseBiomarker.value !== 0 ? (delta / baseBiomarker.value) * 100 : 0;

        comparisons.push({
          name: baseBiomarker.name,
          baseline: { value: baseBiomarker.value, unit: baseBiomarker.unit },
          followup: { value: followupBiomarker.value, unit: followupBiomarker.unit },
          delta,
          percentChange,
        });
      }
    });

    return comparisons;
  }, [baselineId, followupId, biomarkersByReport]);

  const highlights = useMemo(() => {
    if (!comparison || comparison.length === 0) return [];
    // Rank by magnitude of percent change, fall back to absolute delta.
    const ranked = [...comparison].sort((a, b) => {
      const ap = Math.abs(a.percentChange);
      const bp = Math.abs(b.percentChange);
      if (bp !== ap) return bp - ap;
      return Math.abs(b.delta) - Math.abs(a.delta);
    });
    return ranked.slice(0, 5).map((c) => {
      const direction = c.delta === 0 ? 'no change' : c.delta > 0 ? 'increased' : 'decreased';
      const deltaStr = `${c.delta > 0 ? '+' : ''}${c.delta.toFixed(2)} ${c.followup.unit}`;
      const pctStr = `${c.percentChange >= 0 ? '+' : ''}${c.percentChange.toFixed(0)}%`;
      return `${c.name} ${direction} by ${deltaStr} (${pctStr})`;
    });
  }, [comparison]);

  if (sortedReports.length < 2) {
    return (
      <Card>
        <div className="text-center py-16">
          <div className="bg-theme-surface-2 rounded-full w-20 h-20 flex items-center justify-center mx-auto mb-4">
            <ArrowUp className="w-10 h-10 text-theme-primary" />
          </div>
          <h3 className="text-lg text-theme-text mb-2">Your progress will appear here</h3>
          <p className="text-sm text-theme-muted-text max-w-md mx-auto">
            Once you upload another lab report, you'll be able to see how your biomarkers shift over time.
          </p>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <h3 className="text-xl text-theme-text mb-6">Your progress</h3>
        <div className="grid grid-cols-2 gap-6 mb-6">
          <div>
            <label className="block text-sm font-medium text-theme-text mb-2">
              Earlier
            </label>
            <select
              value={baselineId}
              onChange={(e) => setBaselineId(e.target.value)}
              className="w-full px-4 py-2 border border-theme-border rounded-xl focus:outline-none focus:ring-2 focus:ring-theme-primary transition-all"
            >
              <option value="">Select earlier report</option>
              {sortedReports.map((report) => (
                <option key={report.id} value={report.id}>
                  {formatDate(report.report_date)}
                  {report.lab_name ? ` - ${report.lab_name}` : ''}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-theme-text mb-2">
              Later
            </label>
            <select
              value={followupId}
              onChange={(e) => setFollowupId(e.target.value)}
              className="w-full px-4 py-2 border border-theme-border rounded-xl focus:outline-none focus:ring-2 focus:ring-theme-primary transition-all"
            >
              <option value="">Select later report</option>
              {sortedReports.map((report) => (
                <option key={report.id} value={report.id}>
                  {formatDate(report.report_date)}
                  {report.lab_name ? ` - ${report.lab_name}` : ''}
                </option>
              ))}
            </select>
          </div>
        </div>

        {highlights.length > 0 && (
          <div className="mt-6 p-5 rounded-2xl border border-theme-primary/20 bg-gradient-to-br from-theme-surface-2 to-theme-cat-medication shadow-sm" id="biggest-changes">
            <p className="text-xs font-medium text-theme-muted-text mb-3">Here's what shifted between these labs</p>
            <h4 className="text-base font-semibold text-theme-text mb-3">Notable shifts</h4>
            <ul className="text-sm text-theme-text space-y-2 mb-4">
              {highlights.map((h, idx) => (
                <li key={idx} className="flex items-start gap-2">
                  <span className="text-theme-primary mt-0.5">•</span>
                  <span>{h}</span>
                </li>
              ))}
            </ul>
            <p className="text-xs text-theme-muted-text italic border-t border-theme-border pt-3">
              {COMPARE_SHIFTS_NOTE}
            </p>
          </div>
        )}

        {comparison && comparison.length > 0 && (
          <div className="mt-8">
            <div className="overflow-x-auto rounded-xl border border-theme-border">
              <table className="min-w-full divide-y divide-theme-border">
                <thead className="bg-theme-surface-2">
                  <tr>
                    <th className="px-6 py-4 text-left text-xs font-medium text-theme-muted-text tracking-wider">
                      Biomarker
                    </th>
                    <th className="px-6 py-4 text-left text-xs font-medium text-theme-muted-text tracking-wider">
                      Earlier
                    </th>
                    <th className="px-6 py-4 text-left text-xs font-medium text-theme-muted-text tracking-wider">
                      Later
                    </th>
                    <th className="px-6 py-4 text-left text-xs font-medium text-theme-muted-text tracking-wider">
                      Change
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-theme-surface divide-y divide-theme-border">
                  {comparison.map((comp, idx) => (
                    <tr key={idx} className="hover:bg-theme-surface-2/50 transition-colors">
                      <td className="px-6 py-4 text-sm font-medium text-theme-text">
                        {comp.name}
                      </td>
                      <td className="px-6 py-4 text-sm text-theme-muted-text">
                        {comp.baseline.value} {comp.baseline.unit}
                      </td>
                      <td className="px-6 py-4 text-sm text-theme-muted-text">
                        {comp.followup.value} {comp.followup.unit}
                      </td>
                      <td className="px-6 py-4 text-sm">
                        {comp.delta === 0 ? (
                          <div className="flex items-center gap-1 text-theme-muted-text">
                            <Minus className="w-4 h-4" />
                            <span>No change</span>
                          </div>
                        ) : comp.delta > 0 ? (
                          <div className="flex items-center gap-1 text-theme-warning">
                            <ArrowUp className="w-4 h-4" />
                            <span className="font-medium">
                              +{comp.delta.toFixed(2)} ({comp.percentChange.toFixed(0)}%)
                            </span>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1 text-theme-success">
                            <ArrowDown className="w-4 h-4" />
                            <span className="font-medium">
                              {comp.delta.toFixed(2)} ({comp.percentChange.toFixed(0)}%)
                            </span>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {comparison && comparison.length === 0 && baselineId && followupId && (
          <div className="text-center py-12 text-theme-muted-text">
            <p>No matching biomarkers found between these reports</p>
          </div>
        )}
      </Card>
    </div>
  );
}
