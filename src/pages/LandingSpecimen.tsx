import { formatInterval } from '../lib/scoring/amaniContext';
import {
  CUE_STYLE, describeMeasuredMovement, labIntervalObservation, labIntervalStatement,
} from '../lib/scoring/insightCopy';
import { ClinicalObservation } from '../components/ClinicalObservation';

/*
  V2-03b Stage 2, owner R3: marketing has no clinical-language exemption. The
  landing specimen used to say "Ferritin is low" in red beside its own printed
  interval of 15–150 ng/mL, which 18 ng/mL is within, and "Everything else sits
  where it should for day 21" with an amber TSH inside its interval. Every
  statement and every bar colour below now comes from the policy, from the
  same numbers the row prints, exactly as the report page would state them for
  a real result.

  Loaded lazily by Landing: the policy imports the clinical catalog, which
  would otherwise more than double the eagerly loaded entry chunk.
*/
interface SpecimenMarker {
  name: string; subject: string; value: number; unit: string;
  min: number; max: number; note?: string;
  /** Decorative placement of the value on the row's bar. */
  pos: number; width: number;
}

const SPECIMEN: SpecimenMarker[] = [
  { name: 'Ferritin', subject: 'ferritin', value: 18, unit: 'ng/mL', min: 15, max: 150, pos: 2, width: 7 },
  { name: 'Estradiol', subject: 'estradiol', value: 142, unit: 'pg/mL', min: 26, max: 165, note: 'luteal', pos: 71, width: 9 },
  { name: 'TSH', subject: 'TSH', value: 4.12, unit: 'mIU/L', min: 0.45, max: 4.5, pos: 87, width: 8 },
];

// A fictional earlier panel, stated only as a measured change.
const FERRITIN_OCTOBER = 41;

/** One biomarker row. `pos` and `width` place the marker on the bar; its
 *  colour is the policy's cue for the value against the interval the row prints. */
function SpecimenRow({ marker }: { marker: SpecimenMarker }) {
  const placement = labIntervalObservation(marker.name, marker.value, marker.min, marker.max);
  const range = `${formatInterval(marker.min, marker.max)} ${marker.unit}${marker.note ? ` · ${marker.note}` : ''}`;
  return (
    <div className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-2 items-baseline" data-specimen-row={marker.subject}>
      <div>
        <span className="text-sm font-medium text-theme-text">{marker.name}</span>
        <span className="block font-mono text-[11px] text-theme-muted-text-3 mt-0.5" data-specimen-interval>{range}</span>
      </div>
      <div className="text-right">
        <span className="font-mono text-base text-theme-text tabular-nums" data-specimen-value>{marker.value}</span>
        <span className="block font-mono text-[10px] text-theme-muted-text-3">{marker.unit}</span>
      </div>
      <div className="col-span-2 h-1 rounded-full bg-theme-surface-2 relative overflow-hidden">
        <span
          className={`absolute inset-y-0 rounded-full ${placement ? CUE_STYLE[placement.cue].dot : CUE_STYLE.neutral.dot}`}
          data-language-cue={placement?.cue ?? 'neutral'}
          style={{ left: `${marker.pos}%`, width: `${marker.width}%` }}
        />
      </div>
    </div>
  );
}

/** The specimen's statements: her interval as printed, and the measured change. */
function SpecimenStatements() {
  const ferritin = SPECIMEN[0]!;
  const statements = [
    labIntervalStatement(ferritin.subject, ferritin.value, ferritin.min, ferritin.max),
    describeMeasuredMovement({
      displayName: ferritin.name, previousValue: FERRITIN_OCTOBER, currentValue: ferritin.value,
      unit: ferritin.unit, significance: 'significant',
    }, 'direction'),
  ].filter((s): s is NonNullable<typeof s> => s !== null);
  return (
    <p className="mt-6 pt-5 border-t border-theme-border-inner text-sm text-theme-text-body" data-testid="specimen-statements">
      {statements.map((s, i) => <span key={i}>{i > 0 && ' '}<ClinicalObservation language={s} /></span>)}
    </p>
  );
}

export default function LandingSpecimen() {
  return (
    <>
      <div className="space-y-4">
        {SPECIMEN.map(marker => <SpecimenRow key={marker.subject} marker={marker} />)}
      </div>
      <SpecimenStatements />
    </>
  );
}
