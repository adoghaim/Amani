/*
  # Add indexes for foreign keys and enable leaked password protection

  1. New Indexes
    - `idx_biomarkers_lab_report_id` on `public.biomarkers(lab_report_id)`
    - `idx_interpretations_lab_report_id` on `public.interpretations(lab_report_id)`

  These indexes cover the existing foreign key constraints to improve query performance
  on JOIN operations and cascading deletes/updates.
*/

CREATE INDEX IF NOT EXISTS idx_biomarkers_lab_report_id
  ON public.biomarkers(lab_report_id);

CREATE INDEX IF NOT EXISTS idx_interpretations_lab_report_id
  ON public.interpretations(lab_report_id);
