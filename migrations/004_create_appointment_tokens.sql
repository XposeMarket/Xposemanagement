-- ============================================
-- STEP 1: Create Table
-- ============================================

CREATE TABLE IF NOT EXISTS appointment_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token VARCHAR(64) NOT NULL UNIQUE,
  appointment_id VARCHAR(255) NOT NULL,
  shop_id VARCHAR(255) NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  used_at TIMESTAMP WITH TIME ZONE,
  sent_via VARCHAR(20)[],
  recipient_email VARCHAR(255),
  recipient_phone VARCHAR(20)
);

-- ============================================
-- STEP 2: Create Indexes
-- ============================================

CREATE INDEX IF NOT EXISTS idx_appointment_tokens_token ON appointment_tokens(token);
CREATE INDEX IF NOT EXISTS idx_appointment_tokens_appointment_id ON appointment_tokens(appointment_id);
CREATE INDEX IF NOT EXISTS idx_appointment_tokens_shop_id ON appointment_tokens(shop_id);
CREATE INDEX IF NOT EXISTS idx_appointment_tokens_expires_at ON appointment_tokens(expires_at);

-- ============================================
-- STEP 3: Enable RLS
-- ============================================

ALTER TABLE appointment_tokens ENABLE ROW LEVEL SECURITY;

-- ============================================
-- STEP 4: Drop Existing Policies (if any)
-- ============================================

DROP POLICY IF EXISTS "Shop owners can manage their appointment tokens" ON appointment_tokens;
DROP POLICY IF EXISTS "Staff can view appointment tokens for their shop" ON appointment_tokens;
DROP POLICY IF EXISTS "Staff can create appointment tokens for their shop" ON appointment_tokens;
DROP POLICY IF EXISTS "Public can validate tokens by token value" ON appointment_tokens;

-- ============================================
-- STEP 5: Create RLS Policies
-- ============================================

CREATE POLICY "Shop owners can manage their appointment tokens"
ON appointment_tokens
FOR ALL
USING (
  shop_id IN (
    SELECT id FROM shops WHERE owner_id = auth.uid()
  )
)
WITH CHECK (
  shop_id IN (
    SELECT id FROM shops WHERE owner_id = auth.uid()
  )
);

CREATE POLICY "Staff can view appointment tokens for their shop"
ON appointment_tokens
FOR SELECT
USING (
  shop_id IN (
    SELECT shop_id 
    FROM shop_staff 
    WHERE auth_id::text = auth.uid()::text
  )
);

CREATE POLICY "Staff can create appointment tokens for their shop"
ON appointment_tokens
FOR INSERT
WITH CHECK (
  shop_id IN (
    SELECT shop_id 
    FROM shop_staff 
    WHERE auth_id::text = auth.uid()::text
  )
);

CREATE POLICY "Public can validate tokens by token value"
ON appointment_tokens
FOR SELECT
USING (true);

-- ============================================
-- STEP 6: Create Validation Function
-- ============================================

CREATE OR REPLACE FUNCTION validate_appointment_token(token_value VARCHAR(64))
RETURNS TABLE (
  valid BOOLEAN,
  appointment_id VARCHAR(255),
  shop_id VARCHAR(255),
  expired BOOLEAN
) 
LANGUAGE plpgsql
SECURITY DEFINER
AS $
BEGIN
  RETURN QUERY
  SELECT 
    CASE 
      WHEN t.id IS NOT NULL AND t.expires_at > NOW() THEN true
      ELSE false
    END as valid,
    t.appointment_id,
    t.shop_id,
    CASE 
      WHEN t.id IS NOT NULL AND t.expires_at <= NOW() THEN true
      ELSE false
    END as expired
  FROM appointment_tokens t
  WHERE t.token = token_value
  LIMIT 1;
END;
$;

-- ============================================
-- STEP 7: Create Cleanup Function
-- ============================================

CREATE OR REPLACE FUNCTION cleanup_expired_appointment_tokens()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM appointment_tokens
  WHERE expires_at < NOW() - INTERVAL '7 days';
  
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$;

-- ============================================
-- NOTES
-- ============================================
-- To apply this migration:
-- 1. Go to Supabase Dashboard > SQL Editor
-- 2. Paste this SQL and run it
-- 
-- Token expiration: 30 days by default (set when creating token)
-- Cleanup: Run cleanup_expired_appointment_tokens() periodically or via pg_cron
--
-- Example: Create a token
-- INSERT INTO appointment_tokens (token, appointment_id, shop_id, expires_at, sent_via, recipient_phone)
-- VALUES ('abc123secure', 'appointment-uuid', 'shop-uuid', NOW() + INTERVAL '30 days', ARRAY['sms'], '+12345678901');
