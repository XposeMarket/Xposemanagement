-- ============================================
-- FIX TIME CLOCK AND STAFF TABLES
-- Run this in Supabase SQL Editor
-- NOTE: This version handles shops.id being TEXT instead of UUID
-- ============================================

-- ============================================
-- PART 1: Ensure shop_staff table has all required columns
-- ============================================

-- Add is_active column if it doesn't exist
ALTER TABLE shop_staff ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;

-- Add first_name column if it doesn't exist
ALTER TABLE shop_staff ADD COLUMN IF NOT EXISTS first_name TEXT;

-- Add last_name column if it doesn't exist
ALTER TABLE shop_staff ADD COLUMN IF NOT EXISTS last_name TEXT;

-- Add hourly_rate column if it doesn't exist
ALTER TABLE shop_staff ADD COLUMN IF NOT EXISTS hourly_rate DECIMAL(10,2);

-- Add hire_date column if it doesn't exist
ALTER TABLE shop_staff ADD COLUMN IF NOT EXISTS hire_date DATE DEFAULT CURRENT_DATE;

-- Add notes column if it doesn't exist
ALTER TABLE shop_staff ADD COLUMN IF NOT EXISTS notes TEXT;

-- Add created_by column if it doesn't exist
ALTER TABLE shop_staff ADD COLUMN IF NOT EXISTS created_by UUID;

-- Add permissions column if it doesn't exist
ALTER TABLE shop_staff ADD COLUMN IF NOT EXISTS permissions TEXT[] DEFAULT ARRAY[]::TEXT[];

-- ============================================
-- PART 2: Create time_clock table
-- NOTE: shop_id is TEXT to match your shops table
-- ============================================

-- Drop time_clock if it exists with wrong column types
DROP TABLE IF EXISTS time_clock CASCADE;

-- Create time_clock table with TEXT shop_id to match shops table
CREATE TABLE time_clock (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  shop_id TEXT NOT NULL,
  staff_id UUID NOT NULL,
  staff_email TEXT NOT NULL,
  staff_name TEXT,
  clock_in TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  clock_out TIMESTAMP WITH TIME ZONE,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX idx_time_clock_shop_id ON time_clock(shop_id);
CREATE INDEX idx_time_clock_staff_id ON time_clock(staff_id);
CREATE INDEX idx_time_clock_clock_in ON time_clock(clock_in DESC);
CREATE INDEX idx_time_clock_shop_staff ON time_clock(shop_id, staff_id);

-- ============================================
-- PART 3: Enable RLS and Create Policies for time_clock
-- ============================================

ALTER TABLE time_clock ENABLE ROW LEVEL SECURITY;

-- Shop owners can view all time records for their shop
CREATE POLICY "Shop owners can view all time records"
ON time_clock
FOR SELECT
USING (
  shop_id IN (
    SELECT id::text FROM shops WHERE owner_id::text = auth.uid()::text
  )
);

-- Shop owners can manage all time records for their shop
CREATE POLICY "Shop owners can manage time records"
ON time_clock
FOR ALL
USING (
  shop_id IN (
    SELECT id::text FROM shops WHERE owner_id::text = auth.uid()::text
  )
)
WITH CHECK (
  shop_id IN (
    SELECT id::text FROM shops WHERE owner_id::text = auth.uid()::text
  )
);

-- Staff can view their own time records
CREATE POLICY "Staff can view own time records"
ON time_clock
FOR SELECT
USING (
  staff_id::text = auth.uid()::text
);

-- Staff can clock in (insert) - simplified, no self-reference
CREATE POLICY "Staff can clock in"
ON time_clock
FOR INSERT
WITH CHECK (
  staff_id::text = auth.uid()::text
);

-- Staff can clock out (update their active record)
CREATE POLICY "Staff can clock out"
ON time_clock
FOR UPDATE
USING (
  staff_id::text = auth.uid()::text
  AND clock_out IS NULL
)
WITH CHECK (
  staff_id::text = auth.uid()::text
);

-- ============================================
-- PART 4: Ensure shop_staff RLS is set up
-- IMPORTANT: Avoid self-referential policies to prevent infinite recursion
-- ============================================

ALTER TABLE shop_staff ENABLE ROW LEVEL SECURITY;

-- Drop ALL existing policies to recreate them cleanly
DROP POLICY IF EXISTS "Shop owners can manage staff" ON shop_staff;
DROP POLICY IF EXISTS "Staff can view own record" ON shop_staff;
DROP POLICY IF EXISTS "Managers can view staff" ON shop_staff;
DROP POLICY IF EXISTS "shop_staff_owner_policy" ON shop_staff;
DROP POLICY IF EXISTS "shop_staff_self_policy" ON shop_staff;

-- Policy 1: Shop owners can view and manage all staff in their shop
-- Uses shops table (no self-reference)
CREATE POLICY "shop_staff_owner_policy"
ON shop_staff
FOR ALL
USING (
  shop_id::text IN (
    SELECT id::text FROM shops WHERE owner_id::text = auth.uid()::text
  )
)
WITH CHECK (
  shop_id::text IN (
    SELECT id::text FROM shops WHERE owner_id::text = auth.uid()::text
  )
);

-- Policy 2: Staff can view their own record only
-- Simple auth_id check (no self-reference)
CREATE POLICY "shop_staff_self_policy"
ON shop_staff
FOR SELECT
USING (auth_id::text = auth.uid()::text);

-- NOTE: Removed "Managers can view staff" policy as it caused infinite recursion
-- Manager functionality can be handled at the application level instead

-- ============================================
-- PART 5: Create useful views (drop and recreate)
-- ============================================

-- Drop existing views
DROP VIEW IF EXISTS active_time_clock;
DROP VIEW IF EXISTS time_clock_daily_summary;

-- Create view for active clock-ins (staff currently clocked in)
CREATE VIEW active_time_clock AS
SELECT 
  tc.*,
  EXTRACT(EPOCH FROM (NOW() - tc.clock_in)) / 60 AS current_duration_minutes
FROM time_clock tc
WHERE tc.clock_out IS NULL;

-- Create view for daily summaries
CREATE VIEW time_clock_daily_summary AS
SELECT 
  shop_id,
  staff_id,
  staff_email,
  staff_name,
  DATE(clock_in AT TIME ZONE 'America/New_York') as work_date,
  COUNT(*) as clock_in_count,
  SUM(EXTRACT(EPOCH FROM (clock_out - clock_in))::INTEGER / 60) as total_minutes,
  ROUND(SUM(EXTRACT(EPOCH FROM (clock_out - clock_in))::INTEGER / 60) / 60.0, 2) as total_hours,
  MIN(clock_in) as first_clock_in,
  MAX(clock_out) as last_clock_out
FROM time_clock
WHERE clock_out IS NOT NULL
GROUP BY shop_id, staff_id, staff_email, staff_name, DATE(clock_in AT TIME ZONE 'America/New_York');

-- ============================================
-- DONE!
-- ============================================
SELECT 'Migration completed successfully! Time clock and staff tables are ready.' as status;
