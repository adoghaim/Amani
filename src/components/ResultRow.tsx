import { ArrowDown, ArrowUp, Minus } from 'lucide-react';
import {
  CUE_STYLE, drawDayPhaseNote, LAB_FLAG_PREFIX, labIntervalObservation, NO_LAB_INTERVAL, PRINTED_INTERVALS_LABEL,
  SEVERAL_LAB_INTERVALS,
} from '../lib/scoring/insightCopy';
import {
  applicableRangeIndex, PHASE_PATTERN_STYLE, PHASE_TINT_CLASS, printedLabFlag, printedRanges, rangePhaseOf,
} from '../lib/resultRow';
import type { ReportAnalyte } from '../types';
import type { LabelledRange } from '../utils/parser/types';

export interface ResultRowProps {
  analyte: Pick<ReportAnalyte,
    'raw_name' | 'display_name' | 'raw_value_text' | 'value_numeric' | 'unit' | 'raw_reference_range'
    | 'normalized_min' | 'normalized_max' | 'normalized_operator' | 'normalized_operator_value'
    | 'source_snippet' | 'parse_status'> & { reference_candidates?: LabelledRange[] | null };
  /** The report's estimated phase on the draw day; null or 'unknown' means no cycle context. */
  cyclePhase: string | null;
}

const PLACEMENT_ICON = { below: ArrowDown, above: ArrowUp, within: Minus } as const;

function placementOf(text: string | undefined): keyof typeof PLACEMENT_ICON | null {
  if (!text) return null;
  if (text.startsWith('Below')) return 'below';
  if (text.startsWith('Above')) return 'above';
  if (text.startsWith('Within')) return 'within';
  return null;
}

/*
  One report result row (DESIGN.md Components, "Result row"; PK-DS-01).
  Order: the test name; the value in the data face with the lab's own flag
  exactly as printed; every range the lab printed, the one for her draw day
  highlighted in its phase's patterned tint; then the status word with its
  icon. No leading badge, no count, no score.

  Release invariant 1 still holds: the status states placement only against
  the one interval her lab printed for this marker, with no margin, and its
  wording is the owner-pinned placement text.
*/
export function ResultRow({ analyte, cyclePhase }: ResultRowProps) {
  const label = analyte.display_name || analyte.raw_name;
  const placement = labIntervalObservation(
    label,
    analyte.value_numeric,
    analyte.normalized_min,
    analyte.normalized_max,
    analyte.normalized_operator,
    analyte.normalized_operator_value,
  );
  const ranges = printedRanges(analyte.raw_reference_range, analyte.reference_candidates);
  const applies = applicableRangeIndex(ranges, cyclePhase);
  const phase = rangePhaseOf(cyclePhase);
  const valueText = analyte.raw_value_text ?? (analyte.value_numeric != null ? String(analyte.value_numeric) : null);
  const labFlag = printedLabFlag(analyte.source_snippet, valueText, analyte.unit);
  const style = CUE_STYLE[placement?.cue ?? 'neutral'];
  const where = placementOf(placement?.text);
  const Icon = where ? PLACEMENT_ICON[where] : null;
  const isUnmapped = analyte.parse_status === 'unmapped';
  const statusText = placement?.text ?? (ranges.length > 1 ? SEVERAL_LAB_INTERVALS : NO_LAB_INTERVAL);

  return (
    <div className="py-3 px-3" data-testid="result-row">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="min-w-0 text-sm font-medium text-theme-text break-words">
          {label}
          {isUnmapped && <span className="ml-2 text-xs text-theme-muted-text-2">(unmapped)</span>}
        </p>
        <p className="flex items-baseline gap-2 flex-shrink-0">
          <span className="font-mono text-[1.0625rem] font-medium text-theme-text" data-testid="result-value">{valueText}</span>
          {analyte.unit && <span className="font-mono text-xs text-theme-muted-text">{analyte.unit}</span>}
          {labFlag && (
            <span
              className="inline-flex items-center px-1 font-mono text-xs font-medium text-theme-text border border-theme-text rounded-[3px]"
              data-testid="lab-flag"
            >
              <span className="sr-only">{LAB_FLAG_PREFIX}</span>
              {labFlag}
            </span>
          )}
        </p>
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
        {ranges.length > 0 && (
          <ul className="flex flex-wrap items-center gap-x-2 gap-y-1.5" aria-label={PRINTED_INTERVALS_LABEL} data-testid="lab-intervals">
            {ranges.map((r, i) => {
              const highlighted = i === applies && phase !== null;
              return (
                <li
                  key={`${r.label ?? ''}|${r.interval}|${i}`}
                  className={`text-xs text-theme-text-body rounded-sm px-1.5 py-0.5 ${highlighted ? `${PHASE_TINT_CLASS[phase]} text-theme-text` : ''}`}
                  style={highlighted ? PHASE_PATTERN_STYLE[phase] : undefined}
                  data-applies={highlighted ? 'true' : undefined}
                  data-phase={highlighted ? phase : undefined}
                >
                  {r.label && <span>{r.label} </span>}
                  <span className="font-mono">{r.interval}</span>
                  {analyte.unit && ranges.length === 1 && <span className="font-mono"> {analyte.unit}</span>}
                  {highlighted && (
                    <span className="font-medium">{` · ${drawDayPhaseNote(phase)}`}</span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <span className={`inline-flex items-center gap-1 text-xs font-medium ${style.text}`} data-testid="result-status">
          {Icon && <Icon className="w-3.5 h-3.5" aria-hidden="true" />}
          <span
            data-language-category={placement?.category}
            data-language-source={placement?.authority.kind}
            data-language-cue={placement?.cue}
          >
            {statusText}
          </span>
        </span>
      </div>
    </div>
  );
}
