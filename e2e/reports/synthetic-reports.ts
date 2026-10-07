// Synthetic V2-03 report fixtures. Every value is invented for the test; no
// patient, report or production row is represented. Values are chosen so the
// expected rendering follows from the catalog without any clinical judgement:
// progesterone 2.0 ng/mL, LH 30 and FSH 6 mIU/mL (cycle-dependent),
// TSH 2.0 uIU/mL (not cycle-dependent), estradiol 120 pg/mL with no
// lab-supplied interval.
export const syntheticUserId = '00000000-0000-4000-8000-000000000043';

export interface SyntheticReport {
  report: Record<string, unknown> & { id: string; report_date: string };
  biomarkers: Record<string, unknown>[];
  interpretation: Record<string, unknown>;
}

type Marker = [name: string, value: number, raw: string, unit: string, min: number | null, max: number | null];

function report(k: number, phase: string, markers: Marker[], reportDate = '2026-01-02'): SyntheticReport {
  const id = `00000000-0000-4000-a000-00000000000${k}`;
  const createdAt = `${reportDate}T00:00:00.000Z`;
  return {
    report: {
      id,
      user_id: syntheticUserId,
      file_url: null,
      report_date: reportDate,
      lab_name: 'Synthetic Fixture Lab',
      status: 'ready',
      estimated_cycle_phase: phase,
      estimated_cycle_day: null,
      regeneration_count: 0,
      lab_source: 'unknown',
      created_at: createdAt,
    },
    biomarkers: markers.map(([name, value, raw, unit, min, max], i) => ({
      id: `00000000-0000-4000-9000-0000000000${k}${i + 1}`,
      lab_report_id: id,
      name, value, raw_value_text: raw, unit,
      reference_min: min, reference_max: max,
      // Persisted upload-time flag; the page must not trust it for context.
      flagged: 'in_range',
      created_at: createdAt,
    })),
    interpretation: {
      id: `00000000-0000-4000-b000-00000000000${k}`,
      lab_report_id: id,
      json_output: { headline: 'Synthetic fixture panel', disclaimer: 'Synthetic fixture. Not medical advice.' },
      tier: null,
    },
  };
}

const PANEL: Marker[] = [
  ['progesterone', 2, '2.0', 'ng/mL', 0.2, 25],
  ['tsh', 2, '2.0', 'uIU/mL', 0.45, 4.5],
  ['estradiol', 120, '120', 'pg/mL', null, null],
  // An LH:FSH ratio of 5: the shape an ovulatory surge takes (V2-03 amendment 2, B3).
  ['lh', 30, '30', 'mIU/mL', 2.4, 12.6],
  ['fsh', 6, '6.0', 'mIU/mL', 3.5, 12.5],
];

export const missingPhaseReport = report(1, 'unknown', PANEL);
export const lutealPhaseReport = report(2, 'luteal', PANEL);

// Amendment 2 (B1). Unphased, these values trip the unchanged PCOS rule
// (LH:FSH > 2 plus total testosterone > 70) and the luteal-insufficiency
// rule's no-phase branch (progesterone < 1). HbA1c 6.0 trips a rule on an
// analyte that needs no context, so the insight panel itself still renders.
const PATTERN_PANEL: Marker[] = [
  ['lh', 30, '30', 'mIU/mL', null, null],
  ['fsh', 6, '6.0', 'mIU/mL', null, null],
  ['total_testosterone', 80, '80', 'ng/dL', null, null],
  ['progesterone', 0.5, '0.5', 'ng/mL', null, null],
  ['hemoglobin_a1c', 6, '6.0', '%', null, null],
];
export const patternMissingPhaseReport = report(3, 'unknown', PATTERN_PANEL);
export const patternFollicularReport = report(4, 'follicular', PATTERN_PANEL);

// Amendment 2 (B2). Two reports, so the trajectory surface renders: TSH 2.7
// (borderline against the unreviewed Amani band) then 2.0 (within it).
export const trajectoryPriorReport = report(5, 'unknown', [['tsh', 2.7, '2.7', 'uIU/mL', 0.45, 4.5]], '2025-12-01');
export const trajectoryCurrentReport = report(6, 'unknown', [['tsh', 2, '2.0', 'uIU/mL', 0.45, 4.5]]);
