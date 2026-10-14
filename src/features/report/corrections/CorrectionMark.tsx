import { CORRECTED_VALUE_LABEL, originalDisplay, type ValueCorrectionMark } from '../../../lib/corrections/provenance';

/**
 * DESIGN.md "Provenance" (D20): a value she corrected is hers, in pen,
 * labelled "You corrected this value", with the misread value kept visible and
 * struck through (`correction-strike`) next to it. Used everywhere a value
 * appears: report, trends, compare (and, when they land, the visit summary
 * and the export).
 *
 * The caller sets her value itself in pen (`text-theme-pen`). A screen reader
 * hears "You corrected this value. The original reading was 150 ng/mL";
 * the strike is not announced on its own.
 */
export function CorrectionMark({ mark, className = '' }: { mark: ValueCorrectionMark; className?: string }) {
  return (
    <span data-correction-mark className={`inline-flex flex-wrap items-baseline gap-x-1.5 text-xs ${className}`}>
      <span className="text-theme-pen">{CORRECTED_VALUE_LABEL}</span>
      <span className="sr-only">. The original reading was</span>
      <del
        data-correction-original
        className="font-mono tabular-nums text-theme-muted-text-2 line-through decoration-theme-pen decoration-2"
      >
        {originalDisplay(mark)}
      </del>
    </span>
  );
}

