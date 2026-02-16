/*
  # Add cycle events table for period tracking

  1. New Tables
    - `cycle_events`
      - `id` (uuid, primary key)
      - `user_id` (uuid, references auth.users)
      - `event_date` (date)
      - `event_type` (text, constrained to 'period_start')
      - `notes` (text, optional)
      - `created_at` (timestamptz)

  2. Indexes
    - Index on (user_id, event_date) for efficient querying

  3. Security
    - Enable RLS on `cycle_events` table
    - Add policies for authenticated users to manage their own events

  4. User Preferences (Optional)
    - Add default_cycle_length and default_period_length to users table
*/

-- Create cycle_events table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'cycle_events'
  ) THEN
    CREATE TABLE public.cycle_events (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      event_date date NOT NULL,
      event_type text NOT NULL,
      notes text,
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT cycle_events_event_type_check CHECK (event_type IN ('period_start'))
    );
  END IF;
END $$;

-- Create index on user_id and event_date
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
    AND tablename = 'cycle_events'
    AND indexname = 'cycle_events_user_id_event_date_idx'
  ) THEN
    CREATE INDEX cycle_events_user_id_event_date_idx
    ON public.cycle_events(user_id, event_date);
  END IF;
END $$;

-- Enable RLS
ALTER TABLE public.cycle_events ENABLE ROW LEVEL SECURITY;

-- RLS Policies
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
    AND tablename = 'cycle_events'
    AND policyname = 'Users can view own cycle events'
  ) THEN
    CREATE POLICY "Users can view own cycle events"
      ON public.cycle_events
      FOR SELECT
      TO authenticated
      USING (auth.uid() = user_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
    AND tablename = 'cycle_events'
    AND policyname = 'Users can insert own cycle events'
  ) THEN
    CREATE POLICY "Users can insert own cycle events"
      ON public.cycle_events
      FOR INSERT
      TO authenticated
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
    AND tablename = 'cycle_events'
    AND policyname = 'Users can update own cycle events'
  ) THEN
    CREATE POLICY "Users can update own cycle events"
      ON public.cycle_events
      FOR UPDATE
      TO authenticated
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
    AND tablename = 'cycle_events'
    AND policyname = 'Users can delete own cycle events'
  ) THEN
    CREATE POLICY "Users can delete own cycle events"
      ON public.cycle_events
      FOR DELETE
      TO authenticated
      USING (auth.uid() = user_id);
  END IF;
END $$;

-- Add optional user preferences columns
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'users'
    AND column_name = 'default_cycle_length'
  ) THEN
    ALTER TABLE public.users ADD COLUMN default_cycle_length int DEFAULT 28;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'users'
    AND column_name = 'default_period_length'
  ) THEN
    ALTER TABLE public.users ADD COLUMN default_period_length int DEFAULT 5;
  END IF;
END $$;