// Synthetic V2-03 report fixtures. Every value is invented for the test; no
// patient, report or production row is represented. Values are chosen so the
// expected rendering follows from the catalog without any clinical judgement:
// progesterone 2.0 ng/mL (cycle-dependent), TSH 2.0 uIU/mL (not cycle-dependent),
// estradiol 120 pg/mL with no lab-supplied interval.
export const syntheticUserId = '00000000-0000-4000-8000-000000000043';

export interface SyntheticReport {
  report: Record<string, unknown> & { id: string };
  biomarkers: Record<string, unknown>[];
  interpretation: Record<string, unknown>;
}

function report(k: number, phase: string): SyntheticReport {
  const id = `00000000-0000-4000-a000-00000000000${k}`;
  const biomarker = (n: number, name: string, value: number, raw: string, unit: string, min: number | null, max: number | null) => ({
    id: `00000000-0000-4000-9000-0000000000${k}${n}`,
    lab_report_id: id,
    name, value, raw_value_text: raw, unit,
    reference_min: min, reference_max: max,
    // Persisted upload-time flag; the page must not trust it for context.
    flagged: 'in_range',
    created_at: '2026-01-02T00:00:00.000Z',
  });
  return {
    report: {
      id,
      user_id: syntheticUserId,
      file_url: null,
      report_date: '2026-01-02',
      lab_name: 'Synthetic Fixture Lab',
      status: 'ready',
      estimated_cycle_phase: phase,
      estimated_cycle_day: null,
      regeneration_count: 0,
      lab_source: 'unknown',
      created_at: '2026-01-02T00:00:00.000Z',
    },
    biomarkers: [
      biomarker(1, 'progesterone', 2, '2.0', 'ng/mL', 0.2, 25),
      biomarker(2, 'tsh', 2, '2.0', 'uIU/mL', 0.45, 4.5),
      biomarker(3, 'estradiol', 120, '120', 'pg/mL', null, null),
    ],
    interpretation: {
      id: `00000000-0000-4000-b000-00000000000${k}`,
      lab_report_id: id,
      json_output: { headline: 'Synthetic fixture panel', disclaimer: 'Synthetic fixture. Not medical advice.' },
      tier: null,
    },
  };
}

export const missingPhaseReport = report(1, 'unknown');
export const lutealPhaseReport = report(2, 'luteal');
