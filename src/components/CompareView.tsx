import { useState, useMemo } from 'react';
import { ArrowUp, ArrowDown, Minus } from 'lucide-react';
import { Card } from './Card';
import { LabReport, Biomarker } from '../types';

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

  if (sortedReports.length < 2) {
    return (
      <Card>
        <div className="text-center py-8 text-gray-600">
          <p>Upload at least two lab reports to compare results</p>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Before/After Comparison</h3>
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Baseline (Earlier)
            </label>
            <select
              value={baselineId}
              onChange={(e) => setBaselineId(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-teal-500"
            >
              <option value="">Select baseline report</option>
              {sortedReports.map((report) => (
                <option key={report.id} value={report.id}>
                  {formatDate(report.report_date)}
                  {report.lab_name ? ` - ${report.lab_name}` : ''}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Follow-up (Later)
            </label>
            <select
              value={followupId}
              onChange={(e) => setFollowupId(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-teal-500"
            >
              <option value="">Select follow-up report</option>
              {sortedReports.map((report) => (
                <option key={report.id} value={report.id}>
                  {formatDate(report.report_date)}
                  {report.lab_name ? ` - ${report.lab_name}` : ''}
                </option>
              ))}
            </select>
          </div>
        </div>

        {comparison && comparison.length > 0 && (
          <div className="mt-6">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Biomarker
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Baseline
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Follow-up
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Change
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {comparison.map((comp, idx) => (
                    <tr key={idx}>
                      <td className="px-4 py-3 text-sm font-medium text-gray-900">
                        {comp.name}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600">
                        {comp.baseline.value} {comp.baseline.unit}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600">
                        {comp.followup.value} {comp.followup.unit}
                      </td>
                      <td className="px-4 py-3 text-sm">
                        {comp.delta === 0 ? (
                          <div className="flex items-center gap-1 text-gray-600">
                            <Minus className="w-4 h-4" />
                            <span>No change</span>
                          </div>
                        ) : comp.delta > 0 ? (
                          <div className="flex items-center gap-1 text-orange-600">
                            <ArrowUp className="w-4 h-4" />
                            <span className="font-medium">
                              +{comp.delta.toFixed(2)} ({comp.percentChange.toFixed(0)}%)
                            </span>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1 text-blue-600">
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
          <div className="text-center py-8 text-gray-600">
            <p>No matching biomarkers found between these two reports</p>
          </div>
        )}
      </Card>
    </div>
  );
}
