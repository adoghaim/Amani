import type { Database } from '../../src/types/supabase.generated';

// Column-only wire validation, not PostgREST SQL/constraint emulation.
// Extracted from the base generated schema; satisfies rejects invented columns.
export const TABLE_COLUMNS = {
  health_scores: ['cardiovascular_score', 'created_at', 'hormone_score', 'id', 'inflammation_score', 'kidney_score', 'lab_report_id', 'liver_score', 'metabolic_score', 'nutrient_score', 'overall_score', 'score_breakdown', 'thyroid_score'],
  insight_rule_results: ['biomarkers_involved', 'created_at', 'description', 'id', 'lab_report_id', 'rule_id', 'severity', 'title'],
  derived_metric_results: ['created_at', 'id', 'interpretation', 'lab_report_id', 'metric_name', 'status', 'value'],
  lab_results: ['amani_status', 'biomarker_name', 'canonical_biomarker_name', 'created_at', 'cycle_phase', 'extraction_confidence', 'id', 'lab_ref_max', 'lab_ref_min', 'lab_report_id', 'lab_status', 'normalization_status', 'parser_version', 'raw_biomarker_name', 'review_status', 'reviewed_by_user', 'source_format', 'source_snippet', 'unit', 'unit_normalized', 'unit_original', 'value'],
  report_items: ['canonical_slug', 'category', 'confidence_score', 'created_at', 'id', 'is_core_biomarker', 'lab_report_id', 'needs_review', 'normalized_reference_max', 'normalized_reference_min', 'raw_name', 'raw_reference_range', 'reference_operator', 'reference_operator_value', 'source_snippet', 'status', 'unit', 'value_numeric', 'value_text'],
  audit_events: ['created_at', 'event_type', 'id', 'metadata', 'user_id'],
  biomarker_catalog: ['category', 'created_at', 'id', 'is_cycle_dependent', 'is_fasting_sensitive', 'name', 'sex_applicability', 'slug', 'subcategory', 'unit'],
  biomarkers: ['flagged', 'id', 'lab_report_id', 'name', 'raw_value_text', 'reference_max', 'reference_min', 'unit', 'value'],
  canonical_analytes: ['affects_recommendations', 'affects_scoring', 'category', 'created_at', 'display_name', 'id', 'is_core', 'is_ratio', 'slug', 'subcategory', 'unit'],
  cycle_events: ['created_at', 'event_date', 'event_type', 'id', 'metadata', 'notes', 'user_id'],
  interventions: ['category', 'created_at', 'end_date', 'id', 'notes', 'start_date', 'title', 'user_id'],
  lab_reports: ['average_cycle_length', 'context', 'estimated_cycle_day', 'estimated_cycle_phase', 'file_url', 'content_hash', 'id', 'import_method', 'lab_name', 'lab_source', 'last_period_start_date', 'regeneration_count', 'report_date', 'status', 'upload_date', 'user_id'],
  notification_preferences: ['created_at', 'fertile_reminders', 'id', 'intervention_reminders', 'lab_reminders', 'ovulation_reminders', 'period_reminders', 'reminder_time', 'updated_at', 'user_id'],
  parser_debug: ['ai_input_json', 'analyte_blocks_json', 'created_at', 'file_name', 'id', 'mapping_debug_json', 'page_count', 'parsed_candidates_json', 'raw_text', 'report_id', 'user_id'],
  period_logs: ['created_at', 'end_date', 'flow_intensity', 'id', 'notes', 'start_date', 'updated_at', 'user_id'],
  rate_limits: ['count', 'endpoint', 'id', 'user_id', 'window_start'],
  reminders: ['created_at', 'delivered', 'id', 'metadata', 'read', 'reminder_type', 'scheduled_for', 'user_id'],
  report_analytes: ['canonical_analyte_id', 'canonical_slug', 'confidence_score', 'created_at', 'display_name', 'id', 'is_core', 'lab_report_id', 'needs_review', 'normalization_status', 'normalized_max', 'normalized_min', 'normalized_operator', 'normalized_operator_value', 'parse_status', 'parser_version', 'raw_name', 'raw_reference_range', 'raw_value_text', 'review_status', 'reviewed_by_user', 'source_format', 'source_snippet', 'system_category', 'unit', 'unit_normalized', 'unit_original', 'value_numeric'],
  stripe_customers: ['created_at', 'customer_id', 'deleted_at', 'id', 'updated_at', 'user_id'],
  stripe_orders: ['amount_subtotal', 'amount_total', 'checkout_session_id', 'created_at', 'currency', 'customer_id', 'deleted_at', 'id', 'payment_intent_id', 'payment_status', 'status', 'updated_at'],
  stripe_subscriptions: ['cancel_at_period_end', 'created_at', 'current_period_end', 'current_period_start', 'customer_id', 'deleted_at', 'id', 'payment_method_brand', 'payment_method_last4', 'price_id', 'status', 'subscription_id', 'updated_at'],
  symptom_logs: ['created_at', 'id', 'log_date', 'notes', 'symptoms', 'updated_at', 'user_id'],
  users: ['age_range', 'created_at', 'default_cycle_length', 'default_period_length', 'email', 'goal', 'has_consented', 'id', 'stripe_customer_id', 'stripe_subscription_id', 'subscription_status', 'trial_start_date'],
} as const satisfies Partial<{ [T in keyof Database['public']['Tables']]: readonly (keyof Database['public']['Tables'][T]['Row'])[] }>;
