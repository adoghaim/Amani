import type { ComputedDerivedMetric } from '../utils/derivedMetrics';

const METRIC_META: Record<string, { label: string; description: string; optimalLow: number; optimalHigh: number; unit: string }> = {
  HOMA_IR: {
    label: 'HOMA-IR',
    description: 'Homeostatic Model Assessment of Insulin Resistance. Calculated from fasting glucose × fasting insulin.',
    optimalLow: 0, optimalHigh: 1.0, unit: '',
  },
  Triglyceride_HDL_ratio: {
    label: 'Triglyceride : HDL Ratio',
    description: 'A surrogate marker for metabolic and cardiovascular health. Lower is generally more favorable.',
    optimalLow: 0, optimalHigh: 2.0, unit: '',
  },
  Free_Androgen_Index: {
    label: 'Free Androgen Index (FAI)',
    description: 'Estimates biologically active testosterone. Calculated as (Total Testosterone / SHBG) × 100.',
    optimalLow: 0, optimalHigh: 5.0, unit: '%',
  },
  ApoB_ratio: {
    label: 'ApoB : LDL Ratio',
    description: 'Reflects the density of atherogenic particles relative to cholesterol mass. Closer to 1.0 is typical.',
    optimalLow: 0.7, optimalHigh: 1.0, unit: '',
  },
  T3_T4_ratio: {
    label: 'Free T3 : Free T4 Ratio',
    description: 'Reflects the conversion efficiency of inactive T4 to active T3. Typical range is 0.20–0.30.',
    optimalLow: 0.2, optimalHigh: 0.3, unit: '',
  },
};

function getStatusColor(value: number, low: number, high: number) {
  if (value >= low && value <= high) return { dot: 'bg-theme-flag-ok', text: 'text-theme-flag-ok', badge: 'bg-theme-flag-ok-bg border-theme-flag-ok-border', label: 'Within Amani band' };
  const pctOutside = Math.abs(value > high ? (value - high) / high : (low - value) / (low || 1));
  if (pctOutside < 0.3) return { dot: 'bg-theme-flag-watch', text: 'text-theme-flag-watch', badge: 'bg-theme-flag-watch-bg border-theme-flag-watch-border', label: 'Borderline' };
  return { dot: 'bg-theme-flag-watch', text: 'text-theme-flag-watch', badge: 'bg-theme-flag-watch-bg border-theme-flag-watch-border', label: 'Outside Amani band' };
}

interface Props {
  metrics: ComputedDerivedMetric[];
}

export function DerivedMetricsPanel({ metrics }: Props) {
  if (metrics.length === 0) return null;

  return (
    <div className="bg-theme-surface rounded-2xl border border-theme-border p-6">
      <div className="mb-5">
        <h2 className="text-lg text-theme-text">Derived metrics</h2>
        <p className="text-sm text-theme-muted-text-2 mt-1">
          Calculated from combinations of your biomarker values for deeper insight.
        </p>
      </div>
      <div className="space-y-4">
        {metrics.map(metric => {
          const meta = METRIC_META[metric.name];
          if (!meta) return null;
          const status = getStatusColor(metric.value, meta.optimalLow, meta.optimalHigh);

          return (
            <div key={metric.name} className={`rounded-xl border p-4 ${status.badge}`}>
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <div className={`w-2 h-2 rounded-full shrink-0 ${status.dot}`} />
                    <h3 className="text-sm text-theme-text">{meta.label}</h3>
                  </div>
                  <p className="text-xs text-theme-muted-text-2 mb-3">{meta.description}</p>
                  <p className="text-sm text-theme-text">{metric.interpretation}</p>
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-2xl font-bold text-theme-text">
                    {metric.value}{meta.unit}
                  </div>
                  <div className={`text-xs font-medium mt-1 ${status.text}`}>{status.label}</div>
                  <div className="text-xs text-theme-muted-text-3 mt-0.5">
                    Amani band: {meta.optimalLow}–{meta.optimalHigh}{meta.unit}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <p className="text-xs text-theme-muted-text-3 mt-4 italic">
        Derived metrics are educational calculations and not diagnostic values. Always discuss with your healthcare provider.
      </p>
    </div>
  );
}
