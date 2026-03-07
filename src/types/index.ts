export type CyclePhase = 'menstrual' | 'follicular' | 'ovulatory' | 'luteal' | 'unknown';

export type ReportStatus = 'processing' | 'ready' | 'error';

export type SubscriptionStatus = 'trial' | 'active' | 'expired';

export type BiomarkerName =
  | 'estradiol'
  | 'progesterone'
  | 'lh'
  | 'fsh'
  | 'amh'
  | 'tsh'
  | 'free_t4'
  | 'ferritin'
  | 'vitamin_d';

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
