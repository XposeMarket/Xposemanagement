-- ============================================
-- SHOP STAFF TABLE
-- ============================================

-- Create shop_staff table for managing staff members
CREATE TABLE IF NOT EXISTS shop_staff (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  auth_id UUID NOT NULL,
  email TEXT NOT NULL,
  full_name TEXT,
  role TEXT DEFAULT 'staff', -- 'admin', 'manager', 'technician', 'staff', etc.
  permissions TEXT[] DEFAULT ARRAY[]::TEXT[], -- Array of permission strings
  phone TEXT,
  hire_date DATE DEFAULT CURRENT_DATE,
  is_active BOOLEAN DEFAULT true,
  hourly_rate DECIMAL(10,2),
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_by UUID,
  UNIQUE(shop_id, auth_id)
);

-- Create indexes
CREATE INDEX idx_shop_staff_shop_id ON shop_staff(shop_id);
CREATE INDEX idx_shop_staff_auth_id ON shop_staff(auth_id);
CREATE INDEX idx_shop_staff_email ON shop_staff(email);
CREATE INDEX idx_shop_staff_active ON shop_staff(shop_id, is_active);

-- ============================================
-- ROW LEVEL SECURITY POLICIES
-- ============================================

-- Enable RLS
ALTER TABLE shop_staff ENABLE ROW LEVEL SECURITY;

-- Shop owners can view and manage all staff in their shop
CREATE POLICY "Shop owners can manage staff"
ON shop_staff
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

-- Staff can view their own record
CREATE POLICY "Staff can view own record"
ON shop_staff
FOR SELECT
USING (auth_id::text = auth.uid()::text);

-- Staff with 'manage_staff' permission can view other staff in their shop
CREATE POLICY "Managers can view staff"
ON shop_staff
FOR SELECT
USING (
  shop_id IN (
    SELECT shop_id 
    FROM shop_staff 
    WHERE auth_id::text = auth.uid()::text
      AND ('manage_staff' = ANY(permissions) OR role IN ('admin', 'manager'))
  )
);

-- ============================================
-- PERMISSION CONSTANTS
-- ============================================

-- Common permissions that can be assigned to staff
-- These are just examples, you can use any string values
COMMENT ON COLUMN shop_staff.permissions IS 'Possible values: 
  - view_dashboard: Can view shop dashboard and analytics
  - manage_appointments: Can create, edit, delete appointments
  - manage_jobs: Can create, edit, delete jobs
  - manage_invoices: Can create, edit, send invoices
  - manage_inventory: Can add, edit, remove inventory items
  - manage_customers: Can add, edit customer information
  - manage_staff: Can view and edit other staff members
  - view_reports: Can view financial and operational reports
  - send_messages: Can send SMS/email messages to customers
  - process_payments: Can process payments and refunds
  - * : All permissions (admin access)';

-- ============================================
-- HELPER FUNCTIONS
-- ============================================

-- Function to add a staff member
CREATE OR REPLACE FUNCTION add_staff_member(
  p_shop_id UUID,
  p_email TEXT,
  p_full_name TEXT,
  p_role TEXT DEFAULT 'staff',
  p_permissions TEXT[] DEFAULT ARRAY[]::TEXT[]
)
RETURNS TABLE (
  id UUID,
  auth_id UUID,
  email TEXT,
  status TEXT
) AS $$
DECLARE
  v_auth_id UUID;
  v_staff_id UUID;
BEGIN
  -- Check if user exists in auth.users
  SELECT id INTO v_auth_id
  FROM auth.users
  WHERE email = p_email;
  
  IF v_auth_id IS NULL THEN
    -- User doesn't exist, they'll need to sign up first
    RETURN QUERY
    SELECT 
      NULL::UUID as id,
      NULL::UUID as auth_id,
      p_email as email,
      'User needs to sign up first'::TEXT as status;
  ELSE
    -- Check if already a staff member
    IF EXISTS (
      SELECT 1 FROM shop_staff 
      WHERE shop_id = p_shop_id AND auth_id = v_auth_id
    ) THEN
      RETURN QUERY
      SELECT 
        ss.id,
        ss.auth_id,
        ss.email,
        'Already a staff member'::TEXT as status
      FROM shop_staff ss
      WHERE ss.shop_id = p_shop_id AND ss.auth_id = v_auth_id;
    ELSE
      -- Add as staff member
      INSERT INTO shop_staff (
        shop_id, 
        auth_id, 
        email, 
        full_name, 
        role, 
        permissions,
        created_by
      ) VALUES (
        p_shop_id,
        v_auth_id,
        p_email,
        p_full_name,
        p_role,
        p_permissions,
        auth.uid()
      ) RETURNING shop_staff.id INTO v_staff_id;
      
      RETURN QUERY
      SELECT 
        v_staff_id as id,
        v_auth_id as auth_id,
        p_email as email,
        'Staff member added successfully'::TEXT as status;
    END IF;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to update staff permissions
CREATE OR REPLACE FUNCTION update_staff_permissions(
  p_staff_id UUID,
  p_permissions TEXT[]
)
RETURNS BOOLEAN AS $$
BEGIN
  UPDATE shop_staff
  SET 
    permissions = p_permissions,
    updated_at = NOW()
  WHERE id = p_staff_id
    AND shop_id IN (
      SELECT id FROM shops WHERE owner_id::text = auth.uid()::text
    );
    
  RETURN FOUND;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to deactivate staff member
CREATE OR REPLACE FUNCTION deactivate_staff_member(p_staff_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  UPDATE shop_staff
  SET 
    is_active = false,
    updated_at = NOW()
  WHERE id = p_staff_id
    AND shop_id IN (
      SELECT id FROM shops WHERE owner_id::text = auth.uid()::text
    );
    
  RETURN FOUND;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
