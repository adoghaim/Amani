ALTER TABLE notification_preferences
  ADD COLUMN IF NOT EXISTS expo_push_token text,
  ADD COLUMN IF NOT EXISTS push_token_updated_at timestamptz;
