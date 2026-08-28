/**
 * Synthetic data for the preview harness.
 *
 * One coherent account: a 34-year-old on cycle day 21 (luteal), three panels
 * across five months, a ferritin that has been falling the whole time, and a
 * TSH drifting toward the top of range. Chosen so every visual state the app
 * can render is present somewhere — in range, borderline, out of range, a
 * downward trend, a stale baseline — rather than a happy path where nothing
 * is ever flagged.
 */

export const USER_ID = '2f0a1c94-7d3e-4b8a-9c21-5e6f7a8b9c0d';
const day = 86_400_000;
const iso = (offsetDays) => new Date(Date.now() + offsetDays * day).toISOString();
const date = (offsetDays) => iso(offsetDays).slice(0, 10);

export const REPORT_IDS = {
  march: 'a1111111-1111-4111-8111-111111111111',
  january: 'b2222222-2222-4222-8222-222222222222',
  october: 'c3333333-3333-4333-8333-333333333333',
};

export const users = [{
  id: USER_ID,
  email: 'sample@amani.test',
  full_name: 'Sample Account',
  subscription_status: 'active',
  // -20 days: comfortably past the 7-day window, so trial banners stay off and
  // the dashboard renders its normal state rather than a countdown.
  trial_start_date: iso(-20),
  onboarding_completed: true,
  onboarding_skipped: false,
  average_cycle_length: 28,
  created_at: iso(-400),
}];

export const lab_reports = [
  {
    id: REPORT_IDS.march, user_id: USER_ID,
    report_date: date(-3), upload_date: iso(-3),
    file_url: null, lab_name: 'Quest Diagnostics',
    last_period_start_date: date(-21), average_cycle_length: 28,
    estimated_cycle_day: 21, estimated_cycle_phase: 'luteal',
    context: { birth_control: 'no', pregnant: 'no', postpartum: 'no', top_symptoms: ['fatigue', 'poor_sleep'] },
    status: 'complete', regeneration_count: 0, lab_source: 'quest', import_method: 'pdf',
  },
  {
    id: REPORT_IDS.january, user_id: USER_ID,
    report_date: date(-74), upload_date: iso(-74),
    file_url: null, lab_name: 'LabCorp',
    last_period_start_date: date(-80), average_cycle_length: 28,
    estimated_cycle_day: 6, estimated_cycle_phase: 'follicular',
    context: { birth_control: 'no', pregnant: 'no', postpartum: 'no', top_symptoms: ['fatigue'] },
    status: 'complete', regeneration_count: 0, lab_source: 'labcorp', import_method: 'pdf',
  },
  {
    id: REPORT_IDS.october, user_id: USER_ID,
    report_date: date(-159), upload_date: iso(-159),
    file_url: null, lab_name: 'Hone Health',
    last_period_start_date: date(-161), average_cycle_length: 28,
    estimated_cycle_day: 2, estimated_cycle_phase: 'menstrual',
    context: { birth_control: 'no', pregnant: 'no', postpartum: 'no', top_symptoms: [] },
    status: 'complete', regeneration_count: 0, lab_source: 'hone', import_method: 'photo',
  },
];

const marker = (id, reportId, name, value, unit, min, max, flagged) => ({
  id, lab_report_id: reportId, name, value,
  raw_value_text: String(value), unit,
  reference_min: min, reference_max: max, flagged,
});

export const biomarkers = [
  // March — the panel the app opens on. One out of range, one borderline.
  marker('m01', REPORT_IDS.march, 'ferritin', 18, 'ng/mL', 15, 150, 'out_of_range'),
  marker('m02', REPORT_IDS.march, 'vitamin_d', 27.3, 'ng/mL', 30, 100, 'out_of_range'),
  marker('m03', REPORT_IDS.march, 'tsh', 4.12, 'mIU/L', 0.45, 4.5, 'borderline'),
  marker('m04', REPORT_IDS.march, 'estradiol', 142, 'pg/mL', 26, 165, 'in_range'),
  marker('m05', REPORT_IDS.march, 'progesterone', 8.4, 'ng/mL', 1.8, 24, 'in_range'),
  marker('m06', REPORT_IDS.march, 'free_t3', 2.8, 'pg/mL', 2.3, 4.2, 'in_range'),
  marker('m07', REPORT_IDS.march, 'hemoglobin_a1c', 5.4, '%', 4, 5.6, 'in_range'),
  marker('m08', REPORT_IDS.march, 'ldl_cholesterol', 118, 'mg/dL', 0, 100, 'out_of_range'),

  // January — ferritin already falling, TSH already climbing.
  marker('j01', REPORT_IDS.january, 'ferritin', 28, 'ng/mL', 15, 150, 'in_range'),
  marker('j02', REPORT_IDS.january, 'vitamin_d', 29.1, 'ng/mL', 30, 100, 'borderline'),
  marker('j03', REPORT_IDS.january, 'tsh', 3.3, 'mIU/L', 0.45, 4.5, 'in_range'),
  marker('j04', REPORT_IDS.january, 'estradiol', 118, 'pg/mL', 26, 165, 'in_range'),

  // October — the baseline everything is measured against.
  marker('o01', REPORT_IDS.october, 'ferritin', 41, 'ng/mL', 15, 150, 'in_range'),
  marker('o02', REPORT_IDS.october, 'tsh', 2.4, 'mIU/L', 0.45, 4.5, 'in_range'),
  marker('o03', REPORT_IDS.october, 'estradiol', 96, 'pg/mL', 26, 165, 'in_range'),
];

export const interpretations = [{
  id: 'i0000000-0000-4000-8000-000000000001',
  lab_report_id: REPORT_IDS.march,
  created_at: iso(-3),
  summary:
    'Your ferritin is low at 18 ng/mL and has fallen from 41 last October. Iron stores this ' +
    'low can explain fatigue that sleep does not fix. Vitamin D sits just below range, and TSH ' +
    'has climbed toward the top of its range across all three panels. Your cycle hormones look ' +
    'as expected for day 21.',
  what_you_can_do_now: [
    'Bring the ferritin trend to your next appointment — three panels showing a decline is more useful than one low value.',
    'Ask whether iron studies (serum iron, TIBC, transferrin saturation) would add useful context.',
  ],
  what_to_do_next: [
    'Ask your clinician whether repeat thyroid testing is warranted given the upward TSH trend.',
  ],
  questions_for_doctor: [
    'My ferritin has gone from 41 to 28 to 18 since October — is that worth investigating?',
    'Does a TSH of 4.12 with a normal free T3 need follow-up?',
  ],
}];

export const period_logs = [
  { id: 'p1', user_id: USER_ID, start_date: date(-21), end_date: date(-16), flow: 'medium' },
  { id: 'p2', user_id: USER_ID, start_date: date(-49), end_date: date(-44), flow: 'heavy' },
  { id: 'p3', user_id: USER_ID, start_date: date(-78), end_date: date(-74), flow: 'medium' },
  { id: 'p4', user_id: USER_ID, start_date: date(-106), end_date: date(-101), flow: 'light' },
];

export const symptom_logs = [
  { id: 's1', user_id: USER_ID, date: date(-2), symptoms: ['fatigue'], severity: 3, notes: null },
  { id: 's2', user_id: USER_ID, date: date(-5), symptoms: ['poor_sleep', 'fatigue'], severity: 4, notes: null },
  { id: 's3', user_id: USER_ID, date: date(-9), symptoms: ['bloating'], severity: 2, notes: null },
];

export const interventions = [
  { id: 'v1', user_id: USER_ID, title: 'Iron bisglycinate', category: 'supplement', start_date: date(-30), end_date: null, notes: '25 mg, every other day' },
  { id: 'v2', user_id: USER_ID, title: 'Earlier bedtime', category: 'sleep', start_date: date(-45), end_date: null, notes: null },
  { id: 'v3', user_id: USER_ID, title: 'Strength training', category: 'exercise', start_date: date(-90), end_date: date(-20), notes: 'Twice a week' },
];

export const cycle_events = [];
export const report_analytes = [];
export const notification_preferences = [];
export const reminders = [];
export const iap_subscriptions = [];

export const stripe_user_subscriptions = [{
  customer_id: 'cus_sample',
  subscription_id: 'sub_sample',
  subscription_status: 'active',
  price_id: 'price_1T1XKd0qFZxXyzLUfmtmpqxx',
  current_period_end: Math.floor((Date.now() + 20 * day) / 1000),
  cancel_at_period_end: false,
  payment_method_brand: 'visa',
  payment_method_last4: '4242',
}];

export const TABLES = {
  users, lab_reports, biomarkers, interpretations, period_logs, symptom_logs,
  interventions, cycle_events, report_analytes, notification_preferences,
  reminders, iap_subscriptions, stripe_user_subscriptions,
};
