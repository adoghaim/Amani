/*
  # Add Period Logs, Symptom Logs, Notification Preferences, and Reminders

  ## Summary
  This migration adds the core data model for the rebuilt cycle tracker experience.
  It replaces the fragile period start/end event approach with a proper period log table
  and adds symptom logging, notification preferences, and a reminders system.

  ## New Tables

  ### period_logs
  - Source of truth for confirmed period ranges
  - `start_date` (required) and `end_date` (optional, set when period ends)
  - `flow_intensity` — light, medium, heavy, spotting
  - `notes` — optional free text

  ### symptom_logs
  - Daily symptom entries tied to a specific date
  - `symptoms` jsonb array of symptom keys
  - `notes` optional free text
  - One entry per user per date (upsertable)

  ### notification_preferences
  - Per-user toggles for each reminder type
  - `reminder_time` optional time of day for reminders
  - One row per user

  ### reminders
  - Scheduled in-app reminder records
  - `reminder_type` — period, fertile_window, ovulation, lab, intervention
  - `scheduled_for` — when to show it
  - `delivered` — whether user has seen it
  - `read` — whether user dismissed it
  - `metadata` jsonb for contextual data

  ## Also adds metadata column to cycle_events
  - Allows storing structured data for symptom/note event types alongside existing period events

  ## Security
  - RLS enabled on all new tables
  - All policies check auth.uid() ownership
*/

-- ============================================================
-- period_logs
-- ============================================================
CREATE TABLE IF NOT EXISTS period_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  start_date date NOT NULL,
  end_date date NULL,
  flow_intensity text NULL CHECK (flow_intensity IN ('spotting', 'light', 'medium', 'heavy')),
  notes text NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE period_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can select own period logs"
  ON period_logs FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own period logs"
  ON period_logs FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own period logs"
  ON period_logs FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own period logs"
  ON period_logs FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS period_logs_user_id_idx ON period_logs(user_id);
CREATE INDEX IF NOT EXISTS period_logs_start_date_idx ON period_logs(user_id, start_date DESC);

-- ============================================================
-- symptom_logs
-- ============================================================
CREATE TABLE IF NOT EXISTS symptom_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  log_date date NOT NULL,
  symptoms jsonb NOT NULL DEFAULT '[]',
  notes text NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(user_id, log_date)
);

ALTER TABLE symptom_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can select own symptom logs"
  ON symptom_logs FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own symptom logs"
  ON symptom_logs FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own symptom logs"
  ON symptom_logs FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own symptom logs"
  ON symptom_logs FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS symptom_logs_user_id_idx ON symptom_logs(user_id);
CREATE INDEX IF NOT EXISTS symptom_logs_log_date_idx ON symptom_logs(user_id, log_date DESC);

-- ============================================================
-- notification_preferences
-- ============================================================
CREATE TABLE IF NOT EXISTS notification_preferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
  period_reminders boolean NOT NULL DEFAULT true,
  fertile_reminders boolean NOT NULL DEFAULT true,
  ovulation_reminders boolean NOT NULL DEFAULT true,
  lab_reminders boolean NOT NULL DEFAULT true,
  intervention_reminders boolean NOT NULL DEFAULT true,
  reminder_time time NULL DEFAULT '08:00:00',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can select own notification preferences"
  ON notification_preferences FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own notification preferences"
  ON notification_preferences FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own notification preferences"
  ON notification_preferences FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own notification preferences"
  ON notification_preferences FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- ============================================================
-- reminders
-- ============================================================
CREATE TABLE IF NOT EXISTS reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reminder_type text NOT NULL CHECK (reminder_type IN ('period', 'fertile_window', 'ovulation', 'lab', 'intervention')),
  scheduled_for timestamptz NOT NULL,
  delivered boolean NOT NULL DEFAULT false,
  read boolean NOT NULL DEFAULT false,
  metadata jsonb NULL DEFAULT '{}',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE reminders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can select own reminders"
  ON reminders FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own reminders"
  ON reminders FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own reminders"
  ON reminders FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own reminders"
  ON reminders FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS reminders_user_id_idx ON reminders(user_id);
CREATE INDEX IF NOT EXISTS reminders_scheduled_for_idx ON reminders(user_id, scheduled_for DESC);
CREATE INDEX IF NOT EXISTS reminders_unread_idx ON reminders(user_id, read, delivered);

-- ============================================================
-- Add metadata column to cycle_events if not present
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'cycle_events' AND column_name = 'metadata'
  ) THEN
    ALTER TABLE cycle_events ADD COLUMN metadata jsonb NULL DEFAULT '{}';
  END IF;
END $$;
