-- RLS Policies to allow staff to update jobs and appointments tables

-- ============================================
-- JOBS TABLE POLICIES
-- ============================================

-- Allow staff to UPDATE jobs in their shop
CREATE POLICY "Staff can update jobs in their shop"
ON jobs
FOR UPDATE
USING (
  shop_id IN (
    SELECT shop_id 
    FROM shop_staff 
    WHERE auth_id::text = auth.uid()::text
  )
);

-- Allow staff to INSERT jobs in their shop
CREATE POLICY "Staff can insert jobs in their shop"
ON jobs
FOR INSERT
WITH CHECK (
  shop_id IN (
    SELECT shop_id 
    FROM shop_staff 
    WHERE auth_id::text = auth.uid()::text
  )
);

-- ============================================
-- APPOINTMENTS TABLE POLICIES
-- ============================================

-- Allow staff to UPDATE appointments in their shop
CREATE POLICY "Staff can update appointments in their shop"
ON appointments
FOR UPDATE
USING (
  shop_id IN (
    SELECT shop_id 
    FROM shop_staff 
    WHERE auth_id::text = auth.uid()::text
  )
);

-- ============================================
-- INVENTORY TABLES POLICIES
-- ============================================

-- Allow staff to manage inventory items in their shop
CREATE POLICY "Staff can manage inventory items in their shop"
ON inventory_items
FOR ALL
USING (
  shop_id IN (
    SELECT shop_id 
    FROM shop_staff 
    WHERE auth_id::text = auth.uid()::text
  )
)
WITH CHECK (
  shop_id IN (
    SELECT shop_id 
    FROM shop_staff 
    WHERE auth_id::text = auth.uid()::text
  )
);

-- Allow staff to manage inventory folders in their shop
CREATE POLICY "Staff can manage inventory folders in their shop"
ON inventory_folders
FOR ALL
USING (
  shop_id IN (
    SELECT shop_id 
    FROM shop_staff 
    WHERE auth_id::text = auth.uid()::text
  )
)
WITH CHECK (
  shop_id IN (
    SELECT shop_id 
    FROM shop_staff 
    WHERE auth_id::text = auth.uid()::text
  )
);

-- ============================================
-- ALTERNATIVE: Single policies if you want to combine operations
-- ============================================

-- If you want a single policy for all operations on jobs:
-- DROP the above policies and use this instead:
/*
CREATE POLICY "Staff can manage jobs in their shop"
ON jobs
FOR ALL
USING (
  shop_id IN (
    SELECT shop_id 
    FROM shop_staff 
    WHERE user_id = auth.uid()
  )
)
WITH CHECK (
  shop_id IN (
    SELECT shop_id 
    FROM shop_staff 
    WHERE user_id = auth.uid()
  )
);
*/

-- If you want a single policy for all operations on appointments:
-- DROP the above policies and use this instead:
/*
CREATE POLICY "Staff can manage appointments in their shop"
ON appointments
FOR ALL
USING (
  shop_id IN (
    SELECT shop_id 
    FROM shop_staff 
    WHERE user_id = auth.uid()
  )
)
WITH CHECK (
  shop_id IN (
    SELECT shop_id 
    FROM shop_staff 
    WHERE user_id = auth.uid()
  )
);
*/

-- ============================================
-- INVOICE_TOKENS TABLE POLICIES
-- ============================================
-- Note: Full policies are in migrations/003_create_invoice_tokens.sql
-- These are additional staff policies if needed

-- Staff can create invoice tokens for their shop
CREATE POLICY "Staff can create invoice tokens"
ON invoice_tokens
FOR INSERT
WITH CHECK (
  shop_id IN (
    SELECT shop_id 
    FROM shop_staff 
    WHERE auth_id::text = auth.uid()::text
  )
);

-- Staff can view invoice tokens for their shop
CREATE POLICY "Staff can view invoice tokens"
ON invoice_tokens
FOR SELECT
USING (
  shop_id IN (
    SELECT shop_id 
    FROM shop_staff 
    WHERE auth_id::text = auth.uid()::text
  )
);

-- ============================================
-- NOTES
-- ============================================
-- These policies assume:
-- 1. Your shop_staff table has columns: user_id, shop_id
-- 2. Staff users are authenticated via Supabase Auth (auth.uid())
-- 3. Both jobs and appointments tables have a shop_id column
-- 
-- To apply these policies:
-- 1. Go to Supabase Dashboard > SQL Editor
-- 2. Paste the policies you want to use
-- 3. Run the SQL
-- 
-- To view existing policies:
-- SELECT * FROM pg_policies WHERE tablename IN ('jobs', 'appointments', 'invoice_tokens');
