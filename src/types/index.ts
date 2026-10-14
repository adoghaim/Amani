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
  | 'nutrients'
  | 'blood';

export const CATEGORY_DISPLAY: Record<BiomarkerCategory, { label: string; shortLabel: string }> = {
  hormones:    { label: 'Hormones & Reproductive', shortLabel: 'Hormones' },
  thyroid:     { label: 'Thyroid',                 shortLabel: 'Thyroid' },
  metabolic:   { label: 'Metabolic & Glucose',     shortLabel: 'Metabolic' },
  lipids:      { label: 'Lipids & Cardiovascular', shortLabel: 'Cardiovascular' },
  liver:       { label: 'Liver',                   shortLabel: 'Liver' },
  kidney:      { label: 'Kidney',                  shortLabel: 'Kidney' },
  inflammation:{ label: 'Inflammation & Autoimmune', shortLabel: 'Inflammation' },
  nutrients:   { label: 'Nutrients & Deficiency',  shortLabel: 'Nutrients' },
  blood:       { label: 'Blood & Hematology',      shortLabel: 'Blood' },
};

export type BiomarkerName =
  | 'estradiol' | 'progesterone' | 'fsh' | 'lh'
  | 'total_testosterone' | 'free_testosterone' | 'shbg' | 'dheas'
  | 'prolactin' | 'amh'
  | 'tsh' | 'free_t3' | 'free_t4' | 'total_t4' | 'reverse_t3'
  | 'tpo_antibodies' | 'tg_antibodies'
  | 'fasting_glucose' | 'hemoglobin_a1c' | 'fasting_insulin' | 'c_peptide'
  | 'total_cholesterol' | 'hdl_cholesterol' | 'ldl_cholesterol' | 'triglycerides'
  | 'non_hdl_cholesterol' | 'apob' | 'lpa'
  | 'ast' | 'alt' | 'ggt' | 'alkaline_phosphatase' | 'bilirubin_total'
  | 'creatinine' | 'bun' | 'egfr'
  | 'hs_crp' | 'esr'
  | 'ferritin' | 'iron_saturation' | 'vitamin_d_25_oh' | 'vitamin_b12' | 'folate' | 'magnesium'
  | 'free_thyroxine_index' | 'chol_hdl_ratio'
  | 'globulin' | 'albumin' | 'total_protein' | 'albumin_globulin_ratio'
  | 'bun_creatinine_ratio' | 'serum_iron' | 'tibc' | 'uibc'
  | 'wbc' | 'rbc' | 'hemoglobin' | 'hematocrit' | 'mcv' | 'mch' | 'mchc' | 'rdw' | 'platelets' | 'mpv'
  | 'neutrophils' | 'lymphocytes' | 'monocytes' | 'eosinophils' | 'basophils'
  | 'neutrophils_absolute' | 'lymphocytes_absolute' | 'monocytes_absolute'
  | 'eosinophils_absolute' | 'basophils_absolute'
  | 'sodium' | 'potassium' | 'chloride' | 'co2' | 'calcium'
  | 't3_uptake' | 'total_t3'
  | 'rheumatoid_factor'
  | 'ana_screen';

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
  
  // Phase 4A Telemetry & Tracing
  source_format?: 'text' | 'ocr' | 'manual' | 'unknown' | null;
  parser_version?: string | null;
  raw_biomarker_name?: string | null;
  canonical_biomarker_name?: string | null;
  unit_original?: string | null;
  unit_normalized?: string | null;
  normalization_status?: 'mapped' | 'partial' | 'unmapped' | null;
  review_status?: 'pending' | 'reviewed' | 'edited_by_user' | null;
  reviewed_by_user?: boolean | null;
  source_snippet?: string | null;

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
  submission_mode?: 'standard' | 'compatibility';
}

export interface Biomarker {
  id: string;
  lab_report_id: string;
  name: string;
  value: number;
  raw_value_text: string | null;
  unit: string;
  reference_min: number | null;
  reference_max: number | null;
  flagged: 'in_range' | 'borderline' | 'out_of_range' | 'unknown';
}

export interface BiomarkerInput {
  name: string;
  value: number;
  unit: string;
  reference_min?: number;
  reference_max?: number;
}

export interface AITopFinding {
  biomarker_slug: string;
  title: string;
  status: 'monitor' | 'discuss' | 'reassuring' | 'attention';
  explanation: string;
}

export interface AIKeyFinding {
  biomarker_slug: string;
  title: string;
  status: 'monitor' | 'attention' | 'reassuring';
  explanation: string;
}

export interface AIPrimaryConcern {
  title: string;
  summary: string;
  why_it_matters: string;
}

export interface AIPatternSignal {
  title: string;
  confidence: 'low' | 'medium' | 'high';
  explanation: string;
  related_biomarkers: string[];
}

export interface AIInterpretation {
  headline: string;
  summary_bullets: string[];
  primary_concern?: AIPrimaryConcern;
  key_findings?: AIKeyFinding[];
  what_you_can_do_now?: string[];
  what_to_do_next?: string[];
  overall_interpretation?: string;
  top_findings: AITopFinding[];
  pattern_signals: AIPatternSignal[];
  cycle_context: {
    estimated_cycle_day: number | null;
    estimated_cycle_phase: CyclePhase;
    confidence: 'low' | 'medium' | 'high';
    explanation: string;
  };
  questions_for_doctor: string[];
  disclaimer: string;
  biomarkers?: {
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
  nutrient_topics_to_discuss?: {
    nutrient: string;
    why_it_came_up: string;
    discussion_prompt: string;
  }[];
  supportive_considerations?: {
    nutrition: string[];
    sleep_stress: string[];
    lifestyle: string[];
  };
  suggested_followups_to_discuss?: string[];
  safety_notes?: string[];
}

export interface User {
  id: string;
  email: string;
  full_name: string | null;
  created_at: string;
  age_range: string | null;
  goal: string;
  has_consented: boolean;
  subscription_status: SubscriptionStatus;
  trial_start_date: string | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  default_cycle_length: number | null;
  default_period_length: number | null;
  // Phase 7 onboarding fields. Defaults provided by the users-table migration
  // (boolean false / empty array). trial_start_date is nullable because the
  // 7-day clock now starts when onboarding completes (or is skipped), not at signup.
  onboarding_completed: boolean;
  onboarding_skipped: boolean;
  health_goals: string[];
  symptoms: string[];
  sex_at_birth: string | null;
  pregnancy_status: string | null;
  supplements: string[];
  known_conditions: string[];
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

export type LabSource = 'quest' | 'labcorp' | 'unknown';
export type ImportMethod = 'guided_portal_pdf' | 'direct_upload' | 'manual';

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
  lab_source: LabSource;
  import_method: ImportMethod;
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

export type BaselineStatus =
  | 'near_baseline'
  | 'above_baseline'
  | 'below_baseline'
  | 'insufficient_data';

export type TrendDirection =
  | 'rising'
  | 'falling'
  | 'stable'
  | 'fluctuating'
  | 'insufficient_data';

export type TrendStrength = 'weak' | 'moderate' | 'strong';

export type PersonalPatternType = 'baseline' | 'trend' | 'symptom';

export type BaselineStaleness = 'fresh' | 'stale' | 'limited';

export interface BaselineResult {
  baselineValue: number;
  deviationPercent: number;
  baselineStatus: BaselineStatus;
  reportsUsed: number;
  staleness: BaselineStaleness;
}

export interface TrendResult {
  trendDirection: TrendDirection;
  trendStrength: TrendStrength;
  consistencyScore: number;
  reportsUsed: number;
}

export interface SymptomCorrelation {
  symptom: string;
  biomarker: string;
  system: string;
  relevanceLevel: 'high' | 'medium';
}

export interface PersonalPattern {
  type: PersonalPatternType;
  biomarker: string;
  summary: string;
  severity: 'info' | 'caution';
  supportingData?: {
    baselineResult?: BaselineResult;
    trendResult?: TrendResult;
    correlation?: SymptomCorrelation;
  };
}

export const PERSONALIZATION_THRESHOLDS = {
  MIN_REPORTS_FOR_BASELINE: 2,
  MIN_REPORTS_FOR_TREND: 3,
  MAX_PATTERNS_SHOWN: 3,
  SYMPTOM_WINDOW_DAYS: 14,
  DEVIATION_THRESHOLD_PERCENT: 10,
  TREND_MIN_CHANGE_PERCENT: 8,
  BASELINE_STALENESS_THRESHOLD_MONTHS: 12,
} as const;

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
  /** Null when no day can be placed (a last period logged after today). */
  currentCycleDay: number | null;
  /** By the report's rule (cycleDayRule.ts); 'unknown' when no phase is estimated. */
  currentPhase: CyclePhase;
  /** The calendar's forecast length only; never shown as hers. */
  cycleLength: number;
  /** Her logged average cycle length, or null when her logs establish none. */
  knownCycleLength: number | null;
  periodLength: number;
}

export interface CanonicalAnalyte {
  id: string;
  slug: string;
  display_name: string;
  category: string;
  subcategory: string | null;
  unit: string | null;
  is_core: boolean;
  is_ratio: boolean;
  affects_scoring: boolean;
  affects_recommendations: boolean;
}

export interface ReportAnalyte {
  id: string;
  lab_report_id: string;
  raw_name: string;
  raw_value_text: string | null;
  value_numeric: number | null;
  unit: string | null;
  raw_reference_range: string | null;
  normalized_min: number | null;
  normalized_max: number | null;
  normalized_operator: string | null;
  normalized_operator_value: number | null;
  source_snippet: string | null;
  confidence_score: 'high' | 'medium' | 'low';
  canonical_analyte_id: string | null;
  canonical_slug: string | null;
  parse_status: 'mapped' | 'partial' | 'unmapped';
  needs_review: boolean;
  is_core: boolean;
  
  display_name?: string | null;
  system_category?: string | null;
  normalization_status?: 'mapped' | 'partial' | 'unmapped' | null;
  source_format?: 'text' | 'ocr' | 'manual' | 'unknown' | null;
  parser_version?: string | null;
  unit_original?: string | null;
  unit_normalized?: string | null;
  review_status?: 'pending' | 'reviewed' | 'edited_by_user' | null;
  reviewed_by_user?: boolean | null;

  created_at: string;
}
