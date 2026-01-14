-- Migration: Add pay_type to shop_staff
-- Run this against your Supabase/Postgres DB

ALTER TABLE public.shop_staff
ADD COLUMN IF NOT EXISTS pay_type text DEFAULT 'flat';

-- Optional: backfill pay_type from hourly_rate
-- UPDATE public.shop_staff SET pay_type = 'hourly' WHERE hourly_rate IS NOT NULL AND hourly_rate > 0;
-- UPDATE public.shop_staff SET pay_type = 'flat' WHERE hourly_rate IS NULL OR hourly_rate = 0;
