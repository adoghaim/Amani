// Synthetic V2-03 report fixtures. Every value is invented for the test; no
// patient, report or production row is represented. Values are chosen so the
// expected rendering follows from the catalog without any clinical judgement:
// progesterone 2.0 ng/mL, LH 30 and FSH 6 mIU/mL (cycle-dependent),
// TSH 2.0 mIU/L (not cycle-dependent), estradiol 120 pg/mL with no
// lab-supplied interval.
export const syntheticUserId = '00000000-0000-4000-8000-000000000043';

export interface SyntheticReport {
  report: Record<string, unknown> & { id: string; report_date: string };
  biomarkers: Record<string, unknown>[];
  interpretation: Record<string, unknown>;
  /** Full-lab-panel rows (report_analytes). Absent: none. */
  analytes?: Record<string, unknown>[];
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
  ['tsh', 2, '2.0', 'mIU/L', 0.45, 4.5],
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
export const trajectoryPriorReport = report(5, 'unknown', [['tsh', 2.7, '2.7', 'mIU/L', 0.45, 4.5]], '2025-12-01');
export const trajectoryCurrentReport = report(6, 'unknown', [['tsh', 2, '2.0', 'mIU/L', 0.45, 4.5]]);

// Amendment 4 (R2). Vitamin D 40 ng/mL trips the unchanged vitamin D rule,
// whose frozen title is "Vitamin D Below Optimal", against a NEEDS_CONTEXT band.
export const vitaminDReport = report(7, 'unknown', [['vitamin_d_25_oh', 40, '40', 'ng/mL', 30, 100]]);

// Amendment 5. An out-of-band primary marker that moved toward the band: TSH
// 9 then 6, both above the lab interval, so the primary finding is abnormal
// and the health story's theme sentence renders. R1 makes this
// 'changed_still_high', which used to fall through to "is unchanged".
export const movedPriorReport = report(8, 'unknown', [['tsh', 9, '9.0', 'mIU/L', 0.45, 4.5]], '2025-12-01');
export const movedCurrentReport = report(9, 'unknown', [['tsh', 6, '6.0', 'mIU/L', 0.45, 4.5]]);

/*
  V2-03b Stage 2. One report pair that renders every migrated surface: TSH
  6 -> 9 and ferritin 25 -> 20 outside unreviewed Amani bands (pill, systems,
  headline, movement, trajectory, focus areas, story, doctor questions), HbA1c
  6.0 and ferritin 20 matching pattern rules, HOMA-IR from glucose 95 and insulin
  12, and one lab-panel row 0.5 above its lab's upper bound, inside the 8% margin
  the page used to label "Borderline". The model's headline and primary concern
  carry every claim class on purpose: none of it may render.
*/
const STAGE2_PANEL: Marker[] = [
  ['tsh', 9, '9.0', 'mIU/L', 0.45, 4.5],
  ['ferritin', 20, '20', 'ng/mL', 15, 150],
  ['hemoglobin_a1c', 6, '6.0', '%', 4, 5.6],
  ['fasting_glucose', 95, '95', 'mg/dL', 70, 99],
  ['fasting_insulin', 12, '12', 'uIU/mL', 2, 20],
];
const stage2Current = report(0, 'unknown', STAGE2_PANEL, '2026-02-02');
export const stage2ModelNextSteps = [
  'Eat more iron-rich foods such as spinach because your ferritin is low.',
  'Take 2000 IU of vitamin D daily with breakfast.',
  'Walk for 30 minutes after meals to lower your HbA1c.',
  'Ask your doctor whether an iron supplement makes sense.',
  'Retest TSH in 6 weeks.',
];
export const stage2CurrentReport: SyntheticReport = {
  ...stage2Current,
  interpretation: {
    ...stage2Current.interpretation,
    json_output: {
      headline: 'Your thyroid has worsened and is worth discussing with your doctor urgently.',
      primary_concern: {
        title: 'Thyroid is the top priority', summary: 'This is abnormal and concerning.',
        why_it_matters: 'You should seek care.', canonical_slug: 'tsh',
      },
      summary_bullets: [], pattern_signals: [],
      // Owner R4: personalized food, supplement, dose and lifestyle advice in every next-step bucket. None may render.
      what_you_can_do_now: stage2ModelNextSteps.slice(0, 3), what_to_do_next: stage2ModelNextSteps.slice(3),
      disclaimer: 'Synthetic fixture. Not medical advice.',
    },
  },
  analytes: [{
    id: '00000000-0000-4000-c000-000000000001', lab_report_id: stage2Current.report.id,
    raw_name: 'Sodium', display_name: 'Sodium', value_numeric: 145.5, raw_value_text: '145.5', unit: 'mmol/L',
    normalized_min: 136, normalized_max: 145, normalized_operator: null, normalized_operator_value: null,
    raw_reference_range: '136-145', parse_status: 'mapped', canonical_slug: 'sodium', is_core: false,
    confidence_score: 'high', normalization_status: 'mapped', source_format: 'text',
  }],
};
export const stage2PriorReport = report(0, 'unknown', [
  ['tsh', 6, '6.0', 'mIU/L', 0.45, 4.5], ['ferritin', 25, '25', 'ng/mL', 15, 150],
], '2026-01-05');
// report(0) twice would share ids; give the prior pair its own.
stage2PriorReport.report.id = '00000000-0000-4000-a000-000000000099';
stage2PriorReport.biomarkers.forEach((b, i) => { b['id'] = `00000000-0000-4000-9000-00000000099${i + 1}`; b['lab_report_id'] = stage2PriorReport.report.id; });
stage2PriorReport.interpretation['lab_report_id'] = stage2PriorReport.report.id;
stage2PriorReport.interpretation['id'] = '00000000-0000-4000-b000-000000000099';

/*
  Turn 13 (owner R1). The Stage-2 pair again, with every model field the page
  reads filled with model-shaped prose that carries no forbidden word, and
  three sentences that are authorized phrases of the report's own measured
  changes, one placed on the wrong marker's card. The list must equal
  MODEL_CANARIES in src/lib/scoring/modelProse.testkit.ts (asserted in Vitest).
*/
export const modelCanaries = [
  'Your thyroid looks well balanced for this time of the month.',
  'This combination usually reflects how busy life has been lately.',
  'Many women see this after travel, so it may settle by itself.',
  'Your iron picture fits a pattern of heavier cycles.',
  'This panel gives a calm overall picture of your metabolism.',
  'Your glucose handling looks typical for someone your age.',
  'The luteal phase explains most of what is visible here.',
  'A gentle reset of routine often helps with numbers like these.',
] as const;
export const tshIncreased = 'Your TSH increased from your previous result.';
export const ferritinDecreased = 'Your Ferritin decreased from your previous result.';
const c = modelCanaries;
export const modelProseCurrentReport: SyntheticReport = {
  ...stage2CurrentReport,
  report: { ...stage2CurrentReport.report, estimated_cycle_phase: 'luteal', estimated_cycle_day: 21 },
  interpretation: {
    ...stage2CurrentReport.interpretation,
    json_output: {
      headline: c[0],
      summary_bullets: [c[1], tshIncreased, 'Your thyroid health has worsened.', `${tshIncreased} ${c[2]}`],
      pattern_signals: [
        { title: c[2], confidence: 'high', explanation: c[3], related_biomarkers: ['tsh'] },
        { title: c[5], confidence: 'medium', explanation: ferritinDecreased, related_biomarkers: ['ferritin'] },
      ],
      cycle_context: { estimated_cycle_day: 3, estimated_cycle_phase: 'menstrual', confidence: 'high', explanation: c[4] },
      biomarkers: [{
        name: 'tsh', user_value: '9', unit: 'uIU/mL', reference_range: '0.45-4.5', status_label: 'out_of_range',
        plain_english_meaning: c[5], timing_notes: c[6], common_non_alarm_reasons: [c[7], tshIncreased],
        when_clinicians_follow_up: [ferritinDecreased],
      }],
      what_you_can_do_now: stage2ModelNextSteps.slice(0, 3), what_to_do_next: stage2ModelNextSteps.slice(3),
      disclaimer: c[0],
    },
  },
};

// Turn 8: upper-bound direction and independent laboratory interval on an otherwise empty panel.
export const higherIsBetterReport = report(1, 'unknown', [['hdl_cholesterol', 95, '95', 'mg/dL', 40, 60]]);

export const egfrHigherIsBetterReport = report(1, 'unknown', [['egfr', 205, '205', 'mL/min/1.73m²', 40, 60]]);

// October smoke regression, entirely synthetic; the reported panel, not a patient row.
export const smokePanelReport = report(1, 'unknown', [
  ['ferritin', 18, '18', 'ng/mL', 16, 154],
  ['tsh', 2.85, '2.85', 'uIU/mL', 0.4, 4.5],
  ['vitamin_d_25_oh', 24, '24 L', 'ng/mL', 30, 100],
  ['ldl_cholesterol', 112, '112 H', 'mg/dL', null, 100],
]);

// Owner ruling 2026-10-23: Ruling 7 is a true floor. Synthetic: ferritin 17 is
// inside its lab's 15-150 but below the Amani band (Amani-flagged); HDL 61 is
// above its lab's 40-60 but inside its Amani band, a lab-only flag.
export const labFloorReport = report(1, 'unknown', [
  ['ferritin', 17, '17', 'ng/mL', 15, 150],
  ['hdl_cholesterol', 61, '61', 'mg/dL', 40, 60],
]);
