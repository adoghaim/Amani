export type CyclePhase =
  | 'menstrual'
  | 'follicular'
  | 'ovulatory'
  | 'luteal'
  | 'pregnancy_t1'
  | 'pregnancy_t2'
  | 'pregnancy_t3'
  | 'unknown';

export type ReportStatus = 'processing' | 'ready' | 'error';
export type SubscriptionStatus = 'trial' | 'active' | 'expired';

export type BiomarkerCategory =
  | 'hormones'
  | 'thyroid'
  | 'metabolic'
  | 'lipids'
  | 'liver'
  | 'kidney'
  | 'inflammation'
  | 'nutrients';

export const CATEGORY_DISPLAY: Record<BiomarkerCategory, { label: string; shortLabel: string }> = {
  hormones:    { label: 'Hormones & Reproductive', shortLabel: 'Hormones' },
  thyroid:     { label: 'Thyroid',                 shortLabel: 'Thyroid' },
  metabolic:   { label: 'Metabolic & Glucose',     shortLabel: 'Metabolic' },
  lipids:      { label: 'Lipids & Cardiovascular', shortLabel: 'Cardiovascular' },
  liver:       { label: 'Liver',                   shortLabel: 'Liver' },
  kidney:      { label: 'Kidney',                  shortLabel: 'Kidney' },
  inflammation:{ label: 'Inflammation & Autoimmune', shortLabel: 'Inflammation' },
  nutrients:   { label: 'Nutrients & Deficiency',  shortLabel: 'Nutrients' },
};

export type BiomarkerName =
  | 'estradiol' | 'progesterone' | 'fsh' | 'lh'
  | 'testosterone_total' | 'testosterone_free' | 'shbg' | 'dhea_s'
  | 'prolactin' | 'amh'
  | 'tsh' | 'free_t3' | 'free_t4' | 'total_t4' | 'reverse_t3'
  | 'tpo_antibodies' | 'tgab'
  | 'glucose_fasting' | 'hba1c' | 'insulin' | 'c_peptide'
  | 'total_cholesterol' | 'hdl' | 'ldl' | 'triglycerides'
  | 'non_hdl' | 'apob' | 'lpa'
  | 'ast' | 'alt' | 'ggt' | 'alkaline_phosphatase' | 'bilirubin_total'
  | 'creatinine' | 'bun' | 'egfr'
  | 'hscrp' | 'esr'
  | 'ferritin' | 'iron_saturation' | 'vitamin_d' | 'b12' | 'folate' | 'magnesium';

export type AmaniStatus =
  | 'optimal'
  | 'normal'
  | 'borderline_low'
  | 'borderline_high'
  | 'out_of_range_low'
  | 'out_of_range_high'
  | 'unknown';

export type LabStatus =
  | 'in_range'
  | 'borderline_low'
  | 'borderline_high'
  | 'out_of_range_low'
  | 'out_of_range_high'
  | 'unknown';

export interface BiomarkerDefinition {
  id: string;
  name: BiomarkerName;
  display_name: string;
  short_name: string;
  category: BiomarkerCategory;
  unit: string;
  optimal_min: number | null;
  optimal_max: number | null;
  clinical_min: number | null;
  clinical_max: number | null;
  score_weight: number;
  sex_specific: boolean;
  cycle_dependent: boolean;
  description: string;
  what_it_measures: string;
  sort_order: number;
}

export interface PhaseReferenceRange {
  biomarker_name: BiomarkerName;
  phase: CyclePhase | 'general';
  optimal_min: number | null;
  optimal_max: number | null;
  clinical_min: number | null;
  clinical_max: number | null;
  notes: string | null;
}

export interface LabResult {
  id: string;
  lab_report_id: string;
  biomarker_name: BiomarkerName;
  value: number;
  unit: string;
  lab_ref_min: number | null;
  lab_ref_max: number | null;
  amani_status: AmaniStatus;
  lab_status: LabStatus;
  cycle_phase: CyclePhase | null;
  extraction_confidence: 'high' | 'medium' | 'low' | null;
  created_at: string;
}

export type DerivedMetricName =
  | 'HOMA_IR'
  | 'TG_HDL_RATIO'
  | 'NON_HDL'
  | 'FREE_ANDROGEN_INDEX'
  | 'FT3_FT4_RATIO';

export interface DerivedMetricResult {
  id: string;
  lab_report_id: string;
  metric_name: DerivedMetricName;
  value: number;
  status: 'optimal' | 'borderline' | 'out_of_range' | 'unknown';
  interpretation: string;
  created_at: string;
}

export type InsightSeverity = 'info' | 'caution' | 'discuss';

export interface InsightRuleResult {
  id: string;
  lab_report_id: string;
  rule_id: string;
  severity: InsightSeverity;
  title: string;
  description: string;
  biomarkers_involved: string[];
  created_at: string;
}

export interface HealthScores {
  id: string;
  lab_report_id: string;
  overall_score: number;
  hormone_score: number;
  thyroid_score: number;
  metabolic_score: number;
  cardiovascular_score: number;
  liver_score: number;
  kidney_score: number;
  inflammation_score: number;
  nutrient_score: number;
  score_breakdown: Record<string, unknown>;
  created_at: string;
}

export interface ScoreDimension {
  key: string;
  label: string;
  score: number;
  biomarkerCount: number;
  flaggedCount: number;
  category: BiomarkerCategory | 'overall';
}

export type DailySymptom =
  | 'cramps'
  | 'headache'
  | 'bloating'
  | 'fatigue'
  | 'acne'
  | 'mood_changes'
  | 'breast_tenderness'
  | 'sleep_issues'
  | 'low_energy';

export type Symptom =
  | 'fatigue'
  | 'acne'
  | 'mood_changes'
  | 'irregular_cycles'
  | 'hair_loss'
  | 'sleep_issues'
  | 'weight_changes'
  | 'cramps'
  | 'low_libido'
  | 'hot_flashes';

export type FlowIntensity = 'spotting' | 'light' | 'medium' | 'heavy';

export interface LabReportContext {
  birth_control: 'yes' | 'no' | 'unsure';
  pregnant: 'yes' | 'no' | 'unsure';
  postpartum: 'yes' | 'no' | 'unsure';
  top_symptoms: Symptom[];
}

export interface Biomarker {
  id: string;
  lab_report_id: string;
  name: BiomarkerName;
  value: number;
  unit: string;
  reference_min: number | null;
  reference_max: number | null;
  flagged: 'in_range' | 'borderline' | 'out_of_range' | 'unknown';
}

export interface BiomarkerInput {
  name: BiomarkerName;
  value: number;
  unit: string;
  reference_min?: number;
  reference_max?: number;
}

export interface AIInterpretation {
  summary_bullets: string[];
  cycle_context: {
    estimated_cycle_day: number | null;
    estimated_cycle_phase: CyclePhase;
    confidence: 'low' | 'medium' | 'high';
    explanation: string;
  };
  biomarkers: {
    name: string;
    user_value: string;
    unit: string;
    reference_range: string;
    status_label: 'in_range' | 'borderline' | 'out_of_range' | 'unknown';
    plain_english_meaning: string;
    timing_notes: string;
    common_non_alarm_reasons: string[];
    when_clinicians_follow_up: string[];
  }[];
  nutrient_topics_to_discuss: {
    nutrient: 'vitamin_d' | 'iron' | 'b12' | 'folate' | 'magnesium' | 'omega_3' | 'iodine';
    why_it_came_up: string;
    discussion_prompt: string;
  }[];
  supportive_considerations: {
    nutrition: string[];
    sleep_stress: string[];
    lifestyle: string[];
  };
  questions_for_doctor: string[];
  suggested_followups_to_discuss: string[];
  safety_notes: string[];
  disclaimer: string;
}

export interface User {
  id: string;
  email: string;
  created_at: string;
  age_range: string | null;
  goal: string;
  has_consented: boolean;
  subscription_status: SubscriptionStatus;
  trial_start_date: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  default_cycle_length: number | null;
  default_period_length: number | null;
}

export type CycleEventType = 'period_start' | 'period_end' | 'symptom' | 'note';

export interface CycleEvent {
  id: string;
  user_id: string;
  event_date: string;
  event_type: CycleEventType;
  notes: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export type InterventionCategory = 'supplement' | 'diet' | 'exercise' | 'medication' | 'sleep' | 'other';

export interface Intervention {
  id: string;
  user_id: string;
  title: string;
  category: InterventionCategory;
  start_date: string;
  end_date: string | null;
  notes: string | null;
  created_at: string;
}

export interface LabReport {
  id: string;
  user_id: string;
  report_date: string;
  upload_date: string;
  file_url: string | null;
  lab_name: string | null;
  last_period_start_date: string | null;
  average_cycle_length: number | null;
  estimated_cycle_day: number | null;
  estimated_cycle_phase: CyclePhase;
  context: LabReportContext;
  status: ReportStatus;
  regeneration_count: number;
}

export interface PeriodLog {
  id: string;
  user_id: string;
  start_date: string;
  end_date: string | null;
  flow_intensity: FlowIntensity | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface SymptomLog {
  id: string;
  user_id: string;
  log_date: string;
  symptoms: DailySymptom[];
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface NotificationPreferences {
  id: string;
  user_id: string;
  period_reminders: boolean;
  fertile_reminders: boolean;
  ovulation_reminders: boolean;
  lab_reminders: boolean;
  intervention_reminders: boolean;
  reminder_time: string | null;
  created_at: string;
  updated_at: string;
}

export type ReminderType = 'period' | 'fertile_window' | 'ovulation' | 'lab' | 'intervention';

export interface Reminder {
  id: string;
  user_id: string;
  reminder_type: ReminderType;
  scheduled_for: string;
  delivered: boolean;
  read: boolean;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export interface CyclePrediction {
  nextPeriodStart: Date;
  nextPeriodEnd: Date;
  fertileWindowStart: Date;
  fertileWindowEnd: Date;
  ovulationDay: Date;
  currentCycleDay: number;
  currentPhase: CyclePhase;
  cycleLength: number;
  periodLength: number;
}
