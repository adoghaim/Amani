/*
  # Add interventions table for tracking supplements, diet, and medication changes

  1. New Tables
    - `interventions`
      - `id` (uuid, primary key)
      - `user_id` (uuid, references auth.users)
      - `title` (text, e.g., "Magnesium glycinate", "Keto diet")
      - `category` (text, constrained to allowed values)
      - `start_date` (date)
      - `end_date` (date, nullable for ongoing interventions)
      - `notes` (text, optional)
      - `created_at` (timestamptz)

  2. Indexes
    - Index on (user_id, start_date) for date range queries
    - Index on (user_id, end_date) for active intervention queries

  3. Security
    - Enable RLS on `interventions` table
    - Add policies for authenticated users to manage their own interventions
*/

-- Create interventions table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'interventions'
  ) THEN
    CREATE TABLE public.interventions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      title text NOT NULL,
      category text NOT NULL DEFAULT 'supplement',
      start_date date NOT NULL,
      end_date date,
      notes text,
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT interventions_category_check CHECK (category IN ('supplement', 'diet', 'exercise', 'medication', 'sleep', 'other'))
    );
  END IF;
END $$;

-- Create indexes
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
    AND tablename = 'interventions'
    AND indexname = 'interventions_user_id_start_date_idx'
  ) THEN
    CREATE INDEX interventions_user_id_start_date_idx
    ON public.interventions(user_id, start_date);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
    AND tablename = 'interventions'
    AND indexname = 'interventions_user_id_end_date_idx'
  ) THEN
    CREATE INDEX interventions_user_id_end_date_idx
    ON public.interventions(user_id, end_date);
  END IF;
END $$;

-- Enable RLS
ALTER TABLE public.interventions ENABLE ROW LEVEL SECURITY;

-- RLS Policies
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
    AND tablename = 'interventions'
    AND policyname = 'Users can view own interventions'
  ) THEN
    CREATE POLICY "Users can view own interventions"
      ON public.interventions
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
    AND tablename = 'interventions'
    AND policyname = 'Users can insert own interventions'
  ) THEN
    CREATE POLICY "Users can insert own interventions"
      ON public.interventions
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
    AND tablename = 'interventions'
    AND policyname = 'Users can update own interventions'
  ) THEN
    CREATE POLICY "Users can update own interventions"
      ON public.interventions
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
    AND tablename = 'interventions'
    AND policyname = 'Users can delete own interventions'
  ) THEN
    CREATE POLICY "Users can delete own interventions"
      ON public.interventions
      FOR DELETE
      TO authenticated
      USING (auth.uid() = user_id);
  END IF;
END $$;