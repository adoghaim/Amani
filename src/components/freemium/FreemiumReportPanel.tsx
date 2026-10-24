import { AlertCircle, Loader2, Lock, RefreshCw, Sparkles } from 'lucide-react';
import type { InsightSummary } from '../../lib/insights/buildInsightSummary';
import { selectTrajectoryBullets } from '../YourTrajectoryCard';
import { Button } from '../Button';
import { ComplimentaryCounter } from './ComplimentaryCounter';
import {
  basicInterpretationText,
  previewText,
  type InterpretationAccessResult,
  type PremiumPreview,
} from '../../lib/freemium/interpretationAccess';
import {
  authorizeModelProse, describeMeasuredMovement, movementClaimsByKey,
  type AuthorizedModelProse, type MovementClaim, type ValidatedMovementLanguage,
} from '../../lib/scoring/insightCopy';
import { ClinicalObservation, ModelProseText } from '../ClinicalObservation';
import {
  FREEMIUM_COPY,
  LOCKED_CROSS_REPORT_LABEL,
  lockedLifestyleLabel,
  lockedPatternsLabel,
} from '../../lib/freemium/copy';

const COPY = FREEMIUM_COPY.report;

interface FreemiumReportPanelProps {
  /** Latest `get-interpretation` answer; null until the first one lands. */
  state: InterpretationAccessResult | null;
  /** A generation request is in flight. */
  generating: boolean;
  /** Existing deterministic floor, used only to avoid repeating visible changes. */
  floorSummary?: InsightSummary | null;
  /**
   * True when this report's result for the slug, or her result on the line's
   * prior date (null: any earlier one), was printed as a limit ('<8'). Such a
   * Basic changes line states a placeholder, so it never renders (F021).
   */
  censoredTrend?: (slug: string, previousDate: string | null) => boolean;
  /** The last generate request was refused with 402 (Premium required). */
  premiumRequired?: boolean;
  /** `useSubscription().plan`; the counter is only for Free accounts. */
  plan: 'premium' | 'free' | undefined;
  /**
   * `useSubscription().complimentary.used`, or null when it is not known. A
   * fallback only: the figure get-interpretation returned with `state` wins,
   * because it was read after this report's claim and the hook's was not.
   */
  complimentaryUsed: number | null;
  onRetry: () => void;
  onGenerate: () => void;
  onOpenPaywall: () => void;
}

/**
 * The flag-on, access-specific part of a report. The floor — lab values, flags,
 * history and the deterministic summary — is rendered by ReportView for every
 * state and is never behind anything here.
 *
 *   full              → nothing extra (the counter, for a Free account's claim)
 *   basic             → Basic interpretation, one Premium Preview, locked cards
 *   error             → retryable error. Never a paywall, never "Free".
 *   generation_needed → the generate action
 */
export function FreemiumReportPanel({
  state, generating, floorSummary, censoredTrend, premiumRequired = false, plan, complimentaryUsed, onRetry, onGenerate,
  onOpenPaywall,
}: FreemiumReportPanelProps) {
  const used = state?.complimentary?.used ?? complimentaryUsed;
  // A Basic report consumed no claim, so it gets the remaining/exhausted line only.
  const counter = plan === 'free' && used !== null
    && !(state?.access === 'full' && state.complimentary === null)
    ? <ComplimentaryCounter used={used} hideUsage={state?.access === 'basic'} />
    : null;

  if (generating) {
    return (
      <div className="rounded-2xl border border-theme-border-subtle bg-theme-surface px-6 py-5 flex items-center gap-4">
        <Loader2 className="w-5 h-5 text-theme-primary animate-spin" />
        <p className="text-sm font-semibold text-theme-text">{COPY.generating}</p>
      </div>
    );
  }

  if (!state) return null;

  if (state.access === 'error') return <AccessErrorNotice state={state} onRetry={onRetry} />;

  // generate-interpretation answered 402: the entry point to Premium, not another generate button.
  if (premiumRequired && state.access === 'generation_needed') return upgradeBanner(onOpenPaywall);

  if (state.access === 'generation_needed') {
    const hasBody = state.interpretation !== null;
    return (
      <div className="rounded-2xl border border-theme-border-subtle bg-theme-surface p-5 space-y-3">
        <p className="text-sm font-semibold text-theme-text">
          {hasBody ? COPY.generateFullTitle : COPY.generateTitle}
        </p>
        {!hasBody && <p className="text-xs text-theme-muted-text-2">{COPY.generateBody}</p>}
        <Button size="sm" onClick={onGenerate}>
          <Sparkles className="w-3.5 h-3.5 mr-1.5" />
          {hasBody ? COPY.generateFullCta : COPY.generateCta}
        </Button>
      </div>
    );
  }

  if (state.access === 'full') return counter;

  // Owner R1, wording only: which fields Basic receives is unchanged. Model
  // prose in them renders only where it resolves to a claim this page issued
  // from her own measured changes; the rest is suppressed, not relabelled.
  const claimsByKey = movementClaimsByKey(floorSummary?.deltaMap ?? []);
  const claims = [...claimsByKey.values()];
  const basicText = authorizeModelProse('basic.basic_interpretation', basicInterpretationText(state.interpretation), claims);
  const trends = basicTrendLines(state.interpretation, floorSummary, censoredTrend);
  const preview = state.preview ? authorizedPreview(state.preview, claimsByKey, claims) : null;
  const locked: { key: string; label: string }[] = [
    ...(state.locked.patterns > 0 ? [{ key: 'patterns', label: lockedPatternsLabel(state.locked.patterns) }] : []),
    ...(state.locked.cross_report > 0 ? [{ key: 'cross_report', label: LOCKED_CROSS_REPORT_LABEL }] : []),
    ...(state.locked.lifestyle > 0 ? [{ key: 'lifestyle', label: lockedLifestyleLabel(state.locked.lifestyle) }] : []),
  ];

  return (
    <section className="space-y-4" aria-label={COPY.basicHeading}>
      {basicText.length > 0 && (
        <div className="rounded-2xl border border-theme-border-subtle bg-theme-surface p-5" data-model-surface="basic_interpretation">
          <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-theme-muted-text-3 mb-2">{COPY.basicHeading}</p>
          <p className="text-sm text-theme-text-body leading-relaxed"><ModelProseText items={basicText} /></p>
        </div>
      )}

      {trends.length > 0 && (
        <div className="rounded-2xl border border-theme-border-subtle bg-theme-surface p-5">
          <h2 className="text-sm font-semibold text-theme-text mb-2">{COPY.changesHeading}</h2>
          <ul className="space-y-2">
          {trends.map(line => (
            <li key={line.slug} className="text-sm text-theme-text-body">{line.text}</li>
          ))}
          </ul>
        </div>
      )}

      {counter}

      {preview && (
        <div className="rounded-2xl border border-theme-primary/30 bg-theme-surface p-5" data-model-surface="preview">
          <p className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-theme-primary mb-2">
            <Sparkles className="w-3 h-3" />
            {COPY.previewLabel}
          </p>
          <p className="text-sm text-theme-text-body leading-relaxed">
            {preview.kind === 'measured' ? <ClinicalObservation language={preview.language} /> : <ModelProseText items={preview.prose} />}
          </p>
        </div>
      )}

      {locked.map(card => (
        <button
          key={card.key}
          type="button"
          onClick={onOpenPaywall}
          className="w-full text-left rounded-2xl border border-theme-border bg-theme-surface-2 px-5 py-4 flex items-center justify-between gap-3 hover:border-theme-primary transition-colors"
        >
          <span className="flex items-center gap-3">
            <Lock className="w-4 h-4 text-theme-muted-text shrink-0" />
            <span className="text-sm font-medium text-theme-text">{card.label}</span>
          </span>
          <span className="text-xs text-theme-muted-text-2 shrink-0">{COPY.lockedHint}</span>
        </button>
      ))}

      {upgradeBanner(onOpenPaywall)}
    </section>
  );
}

/**
 * The Premium Preview, as Amani may state it. A trend preview whose slug and
 * both values agree with one of her own measured-change claims is stated as
 * that claim. Any other preview is model or narrative content and keeps only
 * the sentences that resolve to a claim. Null: nothing may render.
 */
function authorizedPreview(
  preview: PremiumPreview, claimsByKey: ReadonlyMap<unknown, MovementClaim>, claims: readonly MovementClaim[],
): { kind: 'measured'; language: ValidatedMovementLanguage } | { kind: 'prose'; prose: AuthorizedModelProse[] } | null {
  const content = preview.content;
  if (content && typeof content === 'object' && !Array.isArray(content)) {
    const entry = content as Record<string, unknown>;
    const claim = typeof entry.biomarker_slug === 'string' ? claimsByKey.get(entry.biomarker_slug) : undefined;
    if (claim && entry.previous_value === claim.fact.previousValue && entry.current_value === claim.fact.currentValue
      && (entry.unit ?? '') === claim.fact.unit) {
      return { kind: 'measured', language: describeMeasuredMovement(claim.fact) };
    }
  }
  const prose = authorizeModelProse('basic.preview', Object.values(previewText(preview) ?? {}), claims);
  return prose.length > 0 ? { kind: 'prose', prose } : null;
}

/** Only a rendered trajectory bullet containing the same two values replaces
 * this line. Headlines, priority cards and boundary-only text do not. */
function basicTrendLines(
  payload: Record<string, unknown> | null, floor?: InsightSummary | null,
  censoredTrend?: FreemiumReportPanelProps['censoredTrend'],
) {
  const seen = new Set<string>();
  const visible = floor ? selectTrajectoryBullets(floor.biggestChanges, floor.primaryFinding) : [];
  const raw = payload?.flagged_trends;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap(entry => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
    const line = entry as Record<string, unknown>;
    const slug = line.biomarker_slug;
    if (typeof slug !== 'string' || seen.has(slug)) return [];
    seen.add(slug);
    // F021: stored trend evidence may predate generation skipping censored results.
    if (censoredTrend?.(slug, typeof line.previous_date === 'string' ? line.previous_date : null)) return [];
    if (visible.some(b => b.key === slug && b.values
      && b.values.previous === line.previous_value && b.values.current === line.current_value
      && b.values.unit === line.unit)) return [];
    const value = (v: unknown) => typeof v === 'number' && Number.isFinite(v) ? String(v) : '—';
    const marker = typeof line.marker === 'string' ? line.marker : slug;
    const unit = typeof line.unit === 'string' ? ` ${line.unit}` : '';
    const direction = typeof line.direction === 'string' ? ` · ${line.direction}` : '';
    const date = typeof line.previous_date === 'string' ? ` · ${line.previous_date}` : '';
    return [{ slug, text: `${marker}: ${value(line.previous_value)} → ${value(line.current_value)}${unit}${direction}${date}` }];
  });
}

function upgradeBanner(onOpenPaywall: () => void) {
  return (
    <div className="rounded-2xl border border-theme-border bg-theme-surface px-5 py-4 flex flex-wrap items-center justify-between gap-3">
      <div>
        <p className="text-sm font-semibold text-theme-text">{COPY.upgradeTitle}</p>
        <p className="text-xs text-theme-muted-text-2 mt-0.5">{COPY.upgradeBody}</p>
      </div>
      <Button size="sm" onClick={onOpenPaywall}>{COPY.upgradeCta}</Button>
    </div>
  );
}

/**
 * A retryable error. As the whole panel it stands in for a body that could not
 * be read; `inline` is the non-blocking form ReportView shows above a body the
 * user is already reading (a failed refresh or regenerate), which stays put.
 * Never a paywall, never "Free". Without `onRetry` it is a notice only: the
 * server said trying again cannot help (PK-PL-A).
 */
export function AccessErrorNotice({ state, onRetry, inline = false, title, body }: {
  state: InterpretationAccessResult | null;
  onRetry?: () => void;
  inline?: boolean;
  title?: string;
  body?: string;
}) {
  const rateLimited = state?.code === 'rate_limit_exceeded';
  return (
    <div
      role={inline ? 'status' : 'alert'}
      className={`rounded-2xl border border-theme-flag-watch-border bg-theme-flag-watch-bg ${inline ? 'px-4 py-3' : 'p-5'} space-y-3`}
    >
      <div className="flex items-start gap-3">
        <AlertCircle className="w-4 h-4 text-theme-flag-watch flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-semibold text-theme-flag-watch">{title ?? COPY.errorTitle}</p>
          <p className="text-xs text-theme-flag-watch mt-1 leading-relaxed">
            {rateLimited ? COPY.errorRateLimited : body ?? COPY.errorBody}
          </p>
        </div>
      </div>
      {!rateLimited && onRetry && (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
          {COPY.retry}
        </Button>
      )}
    </div>
  );
}
