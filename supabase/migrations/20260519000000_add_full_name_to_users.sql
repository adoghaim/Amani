/*
  # Add full_name to users table

  Stores the user's name for personalization in onboarding and downstream
  AI/notification copy. Nullable; existing rows backfill to NULL. OAuth
  providers (Google/Apple) in a future chunk will also populate this column
  from auth metadata.
*/

ALTER TABLE users ADD COLUMN IF NOT EXISTS full_name text;
