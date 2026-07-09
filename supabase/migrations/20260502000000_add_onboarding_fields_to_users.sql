/*
  # Add onboarding fields to users table

  - onboarding_completed / onboarding_skipped: track first-time flow state
  - health_goals / symptoms / supplements / known_conditions: text arrays of user-selected context
  - sex_at_birth / pregnancy_status: contextual fields for cycle-aware interpretation
  - trial_start_date becomes nullable so we can defer the 7-day clock until onboarding finishes

  Existing RLS policies on `users` (select/update/insert own row) cover the new columns
  since RLS is row-level — no policy additions needed.
*/

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS onboarding_completed boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS onboarding_skipped boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS health_goals text[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS symptoms text[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS sex_at_birth text,
  ADD COLUMN IF NOT EXISTS pregnancy_status text,
  ADD COLUMN IF NOT EXISTS supplements text[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS known_conditions text[] DEFAULT '{}';

ALTER TABLE users ALTER COLUMN trial_start_date DROP NOT NULL;
