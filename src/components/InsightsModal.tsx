import { AlertCircle, Info } from 'lucide-react';
import { Modal } from './Modal';
import { ErrorBoundary } from './ErrorBoundary';
import { ClinicalObservation, ModelProse } from './ClinicalObservation';
import {
  authorizeModelProse, COMPARISON_CHANGES_EMPTY, COMPARISON_CHANGES_HEADING, describeMeasuredMovement, PRODUCT_DISCLAIMERS,
  type MovementClaim,
} from '../lib/scoring/insightCopy';
import { formatDate } from '../utils/formatters';

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
  /**
   * Claims issued from the two reports' own values (compareReports). The
   * model's text renders only where it resolves to one of these (owner R1).
   */
  claims?: readonly MovementClaim[];
}

/*
  V2-03b Stage 2, owner R1. The modal used to render the comparison model's
  summary, its per-marker "change" sentences, the factors it said a change
  "may have coincided with", and an amber arrow for every increase. None of it
  rested on authority. It now lists the measured changes the app computed from
  the two reports, and adds a model sentence only where that sentence is an
  authorized phrase of one of those claims. Causal factors resolve to no
  claim, so they never render.
*/
function ComparisonChanges({ insights, claims }: { insights: Insight; claims: readonly MovementClaim[] }) {
  const measured = claims
    .filter(c => c.fact.significance !== 'minor' && c.fact.previousValue !== c.fact.currentValue)
    .map(c => describeMeasuredMovement(c.fact));
  const shown = new Set(measured.map(m => m.text));
  const changes = Array.isArray(insights.notable_changes) ? insights.notable_changes : [];
  const proposed = [
    ...authorizeModelProse('insights.summary', insights.summary, claims),
    ...changes.flatMap(change => [
      ...authorizeModelProse('insights.notable_changes.change', change?.change, claims),
      ...authorizeModelProse('insights.notable_changes.possible_factors', change?.possible_factors, claims),
    ]),
  ].filter(p => !shown.has(p.language.text) && !!shown.add(p.language.text));

  return (
    <div data-model-surface="comparison" className="rounded-xl border border-theme-border-subtle bg-theme-background-tint p-5">
      <p className="text-sm font-semibold text-theme-text mb-3 uppercase tracking-wide">{COMPARISON_CHANGES_HEADING}</p>
      {measured.length + proposed.length === 0 ? (
        <p className="text-sm text-theme-neutral-600 leading-relaxed">{COMPARISON_CHANGES_EMPTY}</p>
      ) : (
        <ul className="space-y-2">
          {measured.map(language => (
            <li key={language.text} className="text-sm text-theme-neutral-700 leading-relaxed"><ClinicalObservation language={language} /></li>
          ))}
          {proposed.map(prose => (
            <li key={prose.language.text} className="text-sm text-theme-neutral-700 leading-relaxed"><ModelProse prose={prose} /></li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Rendered instead of the insights body if anything in it throws.
 *
 * The app-wide ErrorBoundary is mounted at the root of App.tsx with no
 * per-route boundary, so before this existed a throw anywhere in this modal
 * took the whole app down to a "Something went wrong / Reload" screen. The
 * server now guarantees the shape (_shared/lab-insights-output.ts), which is
 * what protects already-shipped native builds — this is the second line, for
 * anything that guarantee does not cover.
 *
 * Scoped INSIDE the modal body deliberately, so the header and both close
 * buttons survive and the user can dismiss it. A boundary wrapped around the
 * whole modal would replace the chrome too and leave them stuck.
 */
function InsightsRenderError() {
  return (
    <div className="bg-theme-flag-low-bg border border-theme-flag-low-border rounded-xl p-4 flex items-start gap-3">
      <AlertCircle className="w-5 h-5 text-theme-flag-low flex-shrink-0 mt-0.5" />
      <div>
        <p className="font-medium text-theme-flag-low text-sm">Could not display these insights</p>
        <p className="text-sm text-theme-flag-low mt-1">
          Your lab results and history are unaffected. Close this and try again.
        </p>
      </div>
    </div>
  );
}

export function InsightsModal({ isOpen, onClose, insights, reportDates, loading, error, claims = [] }: InsightsModalProps) {
  return (
    <Modal
      open={isOpen}
      onClose={onClose}
      title="Your health story"
      wide
      footer={(
        <button
          onClick={onClose}
          className="w-full py-2.5 min-h-[44px] rounded-xl bg-theme-text text-white text-sm font-medium hover:bg-theme-neutral-800 transition-colors"
        >
          Close
        </button>
      )}
    >
      {/*
        The header was white-and-muted text on a navy gradient that measured
        3.38:1 and 2.18:1 (review F066). The shared Modal's header is the
        surface colour with theme text, so the comparison line is ordinary muted
        text on the surface.
      */}
      <p className="text-theme-muted-text text-xs mb-5">
        {reportDates ? (
          <>
            Comparing {formatDate(reportDates.previous)} → {formatDate(reportDates.current)}
            <span className="ml-1">({reportDates.days_between} days)</span>
          </>
        ) : 'Comparing your two most recent reports'}
      </p>

      <div>
          {loading && (
            <div className="flex flex-col items-center justify-center py-16 gap-4">
              <div className="w-12 h-12 rounded-full border-3 border-theme-primary/20 border-t-theme-primary animate-spin" style={{ borderWidth: 3 }} />
              <div className="text-center">
                <p className="font-medium text-theme-neutral-800 mb-1">Generating insights</p>
                <p className="text-sm text-theme-neutral-500">Analyzing changes between your reports…</p>
              </div>
            </div>
          )}

          {error && !loading && (
            <div className="bg-theme-flag-low-bg border border-theme-flag-low-border rounded-xl p-4 flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-theme-flag-low flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-medium text-theme-flag-low text-sm">Could not generate insights</p>
                <p className="text-sm text-theme-flag-low mt-1">{error}</p>
              </div>
            </div>
          )}

          {insights && !loading && !error && (
            <ErrorBoundary fallback={<InsightsRenderError />}>
            <div className="space-y-6">

              <ComparisonChanges insights={insights} claims={claims} />

              {/*
                V2-03b Stage 2. questions_to_ask and next_steps_general are no
                longer rendered. Model-written doctor questions cannot be held
                to the discussion-prep premises (owner R2), and model next
                steps carry food, supplement and lifestyle advice with no
                Clinical Truth rule (owner R4).
              */}

              {/* Disclaimer */}
              <div className="flex items-start gap-3 bg-theme-neutral-50 border border-theme-neutral-200 rounded-xl px-4 py-3">
                <Info className="w-4 h-4 text-theme-neutral-400 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-theme-neutral-500 leading-relaxed italic"
                  data-language-category={PRODUCT_DISCLAIMERS.comparison.category}
                  data-language-source={PRODUCT_DISCLAIMERS.comparison.authority.kind}
                  data-language-cue={PRODUCT_DISCLAIMERS.comparison.cue}>
                  {PRODUCT_DISCLAIMERS.comparison.text}
                </p>
              </div>
            </div>
            </ErrorBoundary>
          )}
      </div>
    </Modal>
  );
}
