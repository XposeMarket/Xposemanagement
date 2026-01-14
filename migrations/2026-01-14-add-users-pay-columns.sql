-- Migration: Add hourly_rate and pay_type to users
-- Run this against your Supabase/Postgres DB

ALTER TABLE public.users
ADD COLUMN IF NOT EXISTS hourly_rate numeric DEFAULT 0;

ALTER TABLE public.users
ADD COLUMN IF NOT EXISTS pay_type text DEFAULT 'flat';

-- Optional: set existing owner to hourly example
-- UPDATE public.users SET hourly_rate = 25, pay_type = 'hourly' WHERE id = '<owner_auth_id>';
