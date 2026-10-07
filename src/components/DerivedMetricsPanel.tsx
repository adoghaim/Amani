import type { ComputedDerivedMetric } from '../utils/derivedMetrics';
import { CUE_STYLE, derivedMetricObservation, PRODUCT_DISCLAIMERS } from '../lib/scoring/insightCopy';
import { ClinicalObservation } from './ClinicalObservation';

/*
  Which calculations render, and the band each is drawn against. Keys that
  match no computed metric name (four of five today) never render; that is
  pre-existing and unchanged here. V2-03b: descriptions say only how a value
  is calculated. "Lower is generally more favorable" and "Closer to 1.0 is
  typical" were judgements no reviewed rule authorizes.
*/
const METRIC_META: Record<string, { label: string; optimalLow: number; optimalHigh: number; unit: string }> = {
  HOMA_IR: { label: 'HOMA-IR', optimalLow: 0, optimalHigh: 1.0, unit: '' },
  Triglyceride_HDL_ratio: { label: 'Triglyceride : HDL Ratio', optimalLow: 0, optimalHigh: 2.0, unit: '' },
  Free_Androgen_Index: { label: 'Free Androgen Index (FAI)', optimalLow: 0, optimalHigh: 5.0, unit: '%' },
  ApoB_ratio: { label: 'ApoB : LDL Ratio', optimalLow: 0.7, optimalHigh: 1.0, unit: '' },
  T3_T4_ratio: { label: 'Free T3 : Free T4 Ratio', optimalLow: 0.2, optimalHigh: 0.3, unit: '' },
};

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
          Calculated from combinations of your biomarker values.
        </p>
      </div>
      <div className="space-y-4">
        {metrics.map(metric => {
          const meta = METRIC_META[metric.name];
          if (!meta) return null;
          const observation = derivedMetricObservation({
            displayName: meta.label, value: metric.value, unit: meta.unit, bandMin: meta.optimalLow, bandMax: meta.optimalHigh,
          });
          const style = CUE_STYLE[observation.label.cue];

          return (
            <div key={metric.name} className={`rounded-xl border p-4 ${style.bg} ${style.border}`}>
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <div className={`w-2 h-2 rounded-full shrink-0 ${style.dot}`} />
                    <h3 className="text-sm text-theme-text">{meta.label}</h3>
                  </div>
                  <p className="text-xs text-theme-muted-text-2 mb-3">Calculated as {metric.formulaNote}.</p>
                  <p className="text-sm text-theme-text"><ClinicalObservation language={observation.sentence} /></p>
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-2xl font-bold text-theme-text">
                    {metric.value}{meta.unit}
                  </div>
                  <div className={`text-xs font-medium mt-1 ${style.text}`}><ClinicalObservation language={observation.label} /></div>
                  <div className="text-xs text-theme-muted-text-3 mt-0.5">{observation.band}</div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <p className="text-xs text-theme-muted-text-3 mt-4 italic"
        data-language-category={PRODUCT_DISCLAIMERS.derivedMetrics.category}
        data-language-source={PRODUCT_DISCLAIMERS.derivedMetrics.authority.kind}>
        {PRODUCT_DISCLAIMERS.derivedMetrics.text}
      </p>
    </div>
  );
}
