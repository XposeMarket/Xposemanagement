-- ============================================
-- TIME CLOCK SYSTEM FOR STAFF
-- ============================================

-- Create time_clock table for tracking staff hours
CREATE TABLE IF NOT EXISTS time_clock (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  staff_id UUID NOT NULL,
  staff_email TEXT NOT NULL,
  staff_name TEXT,
  clock_in TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  clock_out TIMESTAMP WITH TIME ZONE,
  duration_minutes INTEGER GENERATED ALWAYS AS (
    CASE 
      WHEN clock_out IS NOT NULL THEN 
        EXTRACT(EPOCH FROM (clock_out - clock_in)) / 60
      ELSE 
        NULL
    END
  ) STORED,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX idx_time_clock_shop_id ON time_clock(shop_id);
CREATE INDEX idx_time_clock_staff_id ON time_clock(staff_id);
CREATE INDEX idx_time_clock_clock_in ON time_clock(clock_in DESC);
CREATE INDEX idx_time_clock_shop_staff ON time_clock(shop_id, staff_id);

-- Create view for active clock-ins (staff currently clocked in)
CREATE OR REPLACE VIEW active_time_clock AS
SELECT 
  tc.*,
  EXTRACT(EPOCH FROM (NOW() - tc.clock_in)) / 60 AS current_duration_minutes
FROM time_clock tc
WHERE tc.clock_out IS NULL;

-- Create view for daily summaries
CREATE OR REPLACE VIEW time_clock_daily_summary AS
SELECT 
  shop_id,
  staff_id,
  staff_email,
  staff_name,
  DATE(clock_in AT TIME ZONE 'America/New_York') as work_date,
  COUNT(*) as clock_in_count,
  SUM(duration_minutes) as total_minutes,
  ROUND(SUM(duration_minutes) / 60.0, 2) as total_hours,
  MIN(clock_in) as first_clock_in,
  MAX(clock_out) as last_clock_out
FROM time_clock
WHERE clock_out IS NOT NULL
GROUP BY shop_id, staff_id, staff_email, staff_name, DATE(clock_in AT TIME ZONE 'America/New_York');

-- ============================================
-- ROW LEVEL SECURITY POLICIES
-- ============================================

-- Enable RLS on time_clock table
ALTER TABLE time_clock ENABLE ROW LEVEL SECURITY;

-- Shop owners can view all time records for their shop
CREATE POLICY "Shop owners can view all time records"
ON time_clock
FOR SELECT
USING (
  shop_id IN (
    SELECT id FROM shops WHERE owner_id::text = auth.uid()::text
  )
);

-- Shop owners can manage all time records for their shop
CREATE POLICY "Shop owners can manage time records"
ON time_clock
FOR ALL
USING (
  shop_id IN (
    SELECT id FROM shops WHERE owner_id::text = auth.uid()::text
  )
)
WITH CHECK (
  shop_id IN (
    SELECT id FROM shops WHERE owner_id::text = auth.uid()::text
  )
);

-- Staff can view their own time records
CREATE POLICY "Staff can view own time records"
ON time_clock
FOR SELECT
USING (
  staff_id::text = auth.uid()::text
);

-- Staff can clock in (insert)
CREATE POLICY "Staff can clock in"
ON time_clock
FOR INSERT
WITH CHECK (
  staff_id::text = auth.uid()::text
  AND shop_id IN (
    SELECT shop_id 
    FROM shop_staff 
    WHERE auth_id::text = auth.uid()::text
  )
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
-- HELPER FUNCTIONS
-- ============================================

-- Function to get current active clock-in for a staff member
CREATE OR REPLACE FUNCTION get_active_clock_in(p_staff_id UUID, p_shop_id UUID)
RETURNS TABLE (
  id UUID,
  clock_in TIMESTAMP WITH TIME ZONE,
  duration_minutes NUMERIC
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    tc.id,
    tc.clock_in,
    ROUND(EXTRACT(EPOCH FROM (NOW() - tc.clock_in)) / 60, 2) as duration_minutes
  FROM time_clock tc
  WHERE tc.staff_id = p_staff_id 
    AND tc.shop_id = p_shop_id
    AND tc.clock_out IS NULL
  ORDER BY tc.clock_in DESC
  LIMIT 1;
END;
$$ LANGUAGE plpgsql;

-- Function to clock in
CREATE OR REPLACE FUNCTION clock_in_staff(
  p_shop_id UUID,
  p_staff_id UUID,
  p_staff_email TEXT,
  p_staff_name TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  v_time_clock_id UUID;
  v_active_count INTEGER;
BEGIN
  -- Check if already clocked in
  SELECT COUNT(*) INTO v_active_count
  FROM time_clock
  WHERE staff_id = p_staff_id 
    AND shop_id = p_shop_id
    AND clock_out IS NULL;
    
  IF v_active_count > 0 THEN
    RAISE EXCEPTION 'Staff member is already clocked in';
  END IF;
  
  -- Insert new clock in record
  INSERT INTO time_clock (shop_id, staff_id, staff_email, staff_name)
  VALUES (p_shop_id, p_staff_id, p_staff_email, p_staff_name)
  RETURNING id INTO v_time_clock_id;
  
  RETURN v_time_clock_id;
END;
$$ LANGUAGE plpgsql;

-- Function to clock out
CREATE OR REPLACE FUNCTION clock_out_staff(
  p_staff_id UUID,
  p_shop_id UUID,
  p_notes TEXT DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  duration_minutes NUMERIC,
  clock_in TIMESTAMP WITH TIME ZONE,
  clock_out TIMESTAMP WITH TIME ZONE
) AS $$
BEGIN
  -- Update the active clock-in record
  UPDATE time_clock tc
  SET 
    clock_out = NOW(),
    notes = COALESCE(p_notes, tc.notes),
    updated_at = NOW()
  WHERE tc.staff_id = p_staff_id 
    AND tc.shop_id = p_shop_id
    AND tc.clock_out IS NULL;
    
  -- Return the updated record
  RETURN QUERY
  SELECT 
    tc.id,
    ROUND(EXTRACT(EPOCH FROM (tc.clock_out - tc.clock_in)) / 60, 2) as duration_minutes,
    tc.clock_in,
    tc.clock_out
  FROM time_clock tc
  WHERE tc.staff_id = p_staff_id 
    AND tc.shop_id = p_shop_id
  ORDER BY tc.clock_out DESC
  LIMIT 1;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- REPORTING FUNCTIONS
-- ============================================

-- Get staff hours for a date range
CREATE OR REPLACE FUNCTION get_staff_hours_report(
  p_shop_id UUID,
  p_start_date DATE,
  p_end_date DATE
)
RETURNS TABLE (
  staff_id UUID,
  staff_name TEXT,
  staff_email TEXT,
  total_days INTEGER,
  total_hours NUMERIC,
  average_hours_per_day NUMERIC
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    tc.staff_id,
    tc.staff_name,
    tc.staff_email,
    COUNT(DISTINCT DATE(tc.clock_in))::INTEGER as total_days,
    ROUND(SUM(tc.duration_minutes) / 60.0, 2) as total_hours,
    ROUND(AVG(daily_totals.daily_minutes) / 60.0, 2) as average_hours_per_day
  FROM time_clock tc
  INNER JOIN (
    SELECT 
      staff_id,
      DATE(clock_in) as work_date,
      SUM(duration_minutes) as daily_minutes
    FROM time_clock
    WHERE shop_id = p_shop_id
      AND DATE(clock_in) BETWEEN p_start_date AND p_end_date
      AND clock_out IS NOT NULL
    GROUP BY staff_id, DATE(clock_in)
  ) daily_totals ON tc.staff_id = daily_totals.staff_id
  WHERE tc.shop_id = p_shop_id
    AND DATE(tc.clock_in) BETWEEN p_start_date AND p_end_date
    AND tc.clock_out IS NOT NULL
  GROUP BY tc.staff_id, tc.staff_name, tc.staff_email;
END;
$$ LANGUAGE plpgsql;
