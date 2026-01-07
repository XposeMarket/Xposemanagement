-- Create a test appointment token for kiosk testing
-- Run this in Supabase SQL Editor

-- First, run the migration to add short_code support
-- (Paste contents of 005_add_short_tracking_codes_v2.sql here first)

-- Then create a test token
INSERT INTO appointment_tokens (
  token,
  short_code,
  appointment_id,
  shop_id,
  expires_at,
  sent_via,
  recipient_phone
) VALUES (
  'test_token_' || gen_random_uuid()::text,
  'ABC-1234', -- Your test code
  'b7011f95-249e-47f8-991a-fe9af7063083', -- Use a real appointment ID from your system
  '209e54d1-8815-4e6b-8917-74ecc88a5faa', -- Your shop ID
  NOW() + INTERVAL '30 days',
  ARRAY['manual'],
  NULL
)
RETURNING *;

-- Verify it was created
SELECT * FROM appointment_tokens WHERE short_code = 'ABC-1234';
