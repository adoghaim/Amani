import { AlertTriangle } from 'lucide-react';
import { CUE_STYLE, type SafetyWarning } from '../lib/scoring/insightCopy';

/*
  The safety channel's renderer, separate from every observation renderer.
  It takes only SafetyWarning values, which only an approved deterministic
  rule can produce (insightCopy.evaluateSafetyRules), and renders their text
  untouched: no band filter, review state or neutralizer is applied here.
  With no approved rule today it renders nothing. A warning about a value she
  has not confirmed (F022) still renders, with one added line saying so.
*/
export function SafetyWarnings({ warnings }: { warnings: readonly (SafetyWarning & { unconfirmed?: boolean })[] }) {
  if (warnings.length === 0) return null;
  return (
    <section aria-label="Safety warnings" className="space-y-2">
      {warnings.map(w => {
        const style = CUE_STYLE[w.cue];
        return (
          <div key={`${w.authority.ruleId}:${w.text}`} role="alert"
            data-language-category={w.category} data-language-source={w.authority.kind} data-language-cue={w.cue}
            data-safety-rule={w.authority.ruleId}
            className={`rounded-2xl border px-5 py-4 flex items-start gap-3 ${style.bg} ${style.border}`}>
            <AlertTriangle aria-hidden="true" className={`w-5 h-5 shrink-0 mt-0.5 ${style.text}`} />
            <div className="min-w-0">
              <p className={`text-sm font-semibold leading-relaxed ${style.text}`}>{w.text}</p>
              {w.unconfirmed && (
                <p className={`mt-1 text-xs ${style.text}`}>You haven't confirmed this value. Check it against your report.</p>
              )}
            </div>
          </div>
        );
      })}
    </section>
  );
}
