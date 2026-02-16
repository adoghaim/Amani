-- # Create lab-files storage bucket
-- 
-- 1. Storage
--   - Create lab-files bucket for storing uploaded lab reports (PDFs, images)
--   - Configure bucket as public (for file access)
--   - Set 10MB file size limit
--   - Allow PDF and image file types
-- 
-- 2. Security
--   - Add RLS policies for authenticated users to:
--     - Upload files to their own folder (user_id/*)
--     - Read files from their own folder
--     - Delete files from their own folder

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'lab-files',
  'lab-files',
  true,
  10485760,
  ARRAY['application/pdf', 'image/jpeg', 'image/png']
)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Users can upload own lab files"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'lab-files' AND
    (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "Users can view own lab files"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'lab-files' AND
    (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "Users can delete own lab files"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'lab-files' AND
    (storage.foldername(name))[1] = auth.uid()::text
  );
