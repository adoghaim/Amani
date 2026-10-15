import { useId } from 'react';
import type { EstimatedPhase } from '../lib/cycleDayRule';
import { PHASE_LABEL } from '../lib/cyclePhase';
import { cycleRuleModel, dayCentrePercent, dayStartPercent, PHASE_PATTERN } from '../lib/cycleRuleModel';

/**
 * The report's cycle rule (DESIGN.md "Cycle rule", owner decision D10): a
 * straight rule for her cycle, with one tick on the day her blood was drawn.
 * It sits under the report header and answers "what did this number mean on
 * the day it was drawn". The ring (CycleDial) stays the dashboard's "today"
 * dial and the brand mark.
 *
 * Phase bands use the shipped phase tints AND their patterns, because the
 * phase tints are almost identical to the status tints (DESIGN.md):
 * period, dense diagonal; follicular, sparse diagonal; ovulation, fine dots;
 * luteal, cross-hatching. Every rule with bands carries the label
 * "estimate for a 28-day cycle". With no period start, the rule is empty with
 * one line saying why, never a guessed tick. No animation.
 */

const HEIGHT = 22;

const bandWidthPercent = (band: { fromDay: number; toDay: number }, spanDays: number) =>
  ((band.toDay - band.fromDay + 1) / spanDays) * 100;


/* Full class names, written out so Tailwind keeps them. */
/*
  The tints paint backgrounds, so they are bg-* on HTML boxes behind the
  pattern layer, never SVG fills: validate:contrast reads fill-* as text.
*/
const BAND_TINT: Record<EstimatedPhase, string> = {
  menstrual: 'bg-theme-phase-menstrual-bg',
  follicular: 'bg-theme-phase-follicular-bg',
  ovulatory: 'bg-theme-phase-ovulatory-bg',
  luteal: 'bg-theme-phase-luteal-bg',
};
const PATTERN_INK: Record<EstimatedPhase, { stroke: string; fill: string }> = {
  menstrual: { stroke: 'stroke-theme-phase-menstrual', fill: 'fill-theme-phase-menstrual' },
  follicular: { stroke: 'stroke-theme-phase-follicular', fill: 'fill-theme-phase-follicular' },
  ovulatory: { stroke: 'stroke-theme-phase-ovulatory', fill: 'fill-theme-phase-ovulatory' },
  luteal: { stroke: 'stroke-theme-phase-luteal', fill: 'fill-theme-phase-luteal' },
};
const PHASE_WORD: Record<EstimatedPhase, string> = {
  menstrual: 'Period',
  follicular: 'Follicular',
  ovulatory: 'Ovulation',
  luteal: 'Luteal',
};

function PhasePattern({ id, phase }: { id: string; phase: EstimatedPhase }) {
  const ink = PATTERN_INK[phase];
  const kind = PHASE_PATTERN[phase];
  switch (kind) {
    case 'dense-diagonal':
      return (
        <pattern id={id} data-pattern={kind} patternUnits="userSpaceOnUse" width="4" height="4" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="4" className={ink.stroke} strokeWidth="1.5" />
        </pattern>
      );
    case 'sparse-diagonal':
      return (
        <pattern id={id} data-pattern={kind} patternUnits="userSpaceOnUse" width="9" height="9" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="9" className={ink.stroke} strokeWidth="1.2" />
        </pattern>
      );
    case 'fine-dots':
      return (
        <pattern id={id} data-pattern={kind} patternUnits="userSpaceOnUse" width="4" height="4">
          <circle cx="2" cy="2" r="0.8" className={ink.fill} />
        </pattern>
      );
    case 'cross-hatch':
      return (
        <pattern id={id} data-pattern={kind} patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="6" className={ink.stroke} strokeWidth="1" />
          <line x1="0" y1="0" x2="6" y2="0" className={ink.stroke} strokeWidth="1" />
        </pattern>
      );
  }
}

export function CycleRule({ report }: {
  report: { estimated_cycle_day?: unknown; estimated_cycle_phase?: unknown; average_cycle_length?: unknown };
}) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const model = cycleRuleModel(report);
  const headingId = `cycle-rule-heading-${uid}`;

  return (
    <section aria-labelledby={headingId} className="mb-8" data-cycle-rule={model.state}>
      <h2 id={headingId} className="font-mono text-[11px] uppercase tracking-[0.14em] text-theme-muted-text-2 mb-2">
        Your cycle on the draw day
      </h2>
      <div className="relative rounded-sm overflow-hidden border border-theme-border bg-theme-surface-2" style={{ height: HEIGHT }}>
        {model.state === 'placed' && model.bands.map(band => (
          <div
            key={band.phase}
            className={`absolute inset-y-0 ${BAND_TINT[band.phase]}`}
            style={{ left: `${dayStartPercent(band.fromDay, model.spanDays)}%`, width: `${bandWidthPercent(band, model.spanDays)}%` }}
            data-band-tint={band.phase}
            aria-hidden="true"
          />
        ))}
        <svg width="100%" height={HEIGHT} role="img" aria-label={model.ariaLabel} className="absolute inset-0 block">
          {model.state === 'placed' && model.bands.length > 0 && (
            <defs>
              {model.bands.map(band => (
                <PhasePattern key={band.phase} id={`${uid}-${band.phase}`} phase={band.phase} />
              ))}
            </defs>
          )}
          {model.state === 'placed' && model.bands.map(band => (
            <rect
              key={band.phase}
              x={`${dayStartPercent(band.fromDay, model.spanDays)}%`} y="0"
              width={`${bandWidthPercent(band, model.spanDays)}%`} height={HEIGHT}
              fill={`url(#${uid}-${band.phase})`}
              data-band={band.phase}
            />
          ))}
          {model.state === 'placed' && (
            <line
              x1={`${dayCentrePercent(model.tickDay, model.spanDays)}%`}
              x2={`${dayCentrePercent(model.tickDay, model.spanDays)}%`}
              y1="0" y2={HEIGHT}
              className="stroke-theme-text" strokeWidth="2"
              data-tick-day={model.tickDay}
              data-tick-percent={dayCentrePercent(model.tickDay, model.spanDays).toFixed(4)}
            />
          )}
        </svg>
      </div>

      {model.state === 'empty' ? (
        <p className="text-xs text-theme-muted-text-2 mt-2" data-cycle-rule-why>{model.why}</p>
      ) : (
        <>
          <div className="flex justify-between text-[11px] text-theme-muted-text-3 font-mono tabular-nums mt-1" aria-hidden="true">
            <span>Day 1</span>
            <span>Day {model.spanDays}</span>
          </div>
          <p className="text-sm text-theme-text mt-1">
            Blood drawn on cycle day <span className="font-mono tabular-nums">{model.tickDay}</span>
            {model.phase && model.estimateLabel && (
              <span className="text-theme-muted-text-2" data-cycle-rule-estimate>
                {' '}· {PHASE_LABEL[model.phase]}, {model.estimateLabel}
              </span>
            )}
          </p>
          {model.bands.length > 0 && (
            <ul className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-[11px] text-theme-muted-text-2" aria-label="Cycle rule key">
              {model.bands.map(band => (
                <li key={band.phase} className="inline-flex items-center gap-1.5">
                  <span className={`inline-block rounded-sm ${BAND_TINT[band.phase]}`} aria-hidden="true">
                    <svg width="14" height="10" className="block">
                      <rect width="14" height="10" fill={`url(#${uid}-${band.phase})`} />
                    </svg>
                  </span>
                  {PHASE_WORD[band.phase]}, days {band.fromDay}–{band.toDay}
                </li>
              ))}
            </ul>
          )}
          {model.note && <p className="text-xs text-theme-muted-text-2 mt-1" data-cycle-rule-note>{model.note}</p>}
        </>
      )}
    </section>
  );
}
