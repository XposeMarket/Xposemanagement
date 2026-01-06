-- ============================================
-- INVOICE TOKENS TABLE
-- Stores secure tokens for public invoice viewing
-- ============================================

-- Create the invoice_tokens table
CREATE TABLE IF NOT EXISTS invoice_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token VARCHAR(64) NOT NULL UNIQUE,
  invoice_id VARCHAR(255) NOT NULL,
  shop_id VARCHAR(255) NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  used_at TIMESTAMP WITH TIME ZONE,
  sent_via VARCHAR(20)[], -- Array: ['email', 'sms'] to track how it was sent
  recipient_email VARCHAR(255),
  recipient_phone VARCHAR(20)
);

-- Create indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_invoice_tokens_token ON invoice_tokens(token);
CREATE INDEX IF NOT EXISTS idx_invoice_tokens_invoice_id ON invoice_tokens(invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoice_tokens_shop_id ON invoice_tokens(shop_id);
CREATE INDEX IF NOT EXISTS idx_invoice_tokens_expires_at ON invoice_tokens(expires_at);

-- ============================================
-- ROW LEVEL SECURITY POLICIES
-- ============================================

-- Enable RLS on the table
ALTER TABLE invoice_tokens ENABLE ROW LEVEL SECURITY;

-- Shop owners can view and manage tokens for their shop
CREATE POLICY "Shop owners can manage their invoice tokens"
ON invoice_tokens
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

-- Staff can view tokens for their shop
CREATE POLICY "Staff can view invoice tokens for their shop"
ON invoice_tokens
FOR SELECT
USING (
  shop_id IN (
    SELECT shop_id 
    FROM shop_staff 
    WHERE auth_id::text = auth.uid()::text
  )
);

-- Staff can create tokens for their shop
CREATE POLICY "Staff can create invoice tokens for their shop"
ON invoice_tokens
FOR INSERT
WITH CHECK (
  shop_id IN (
    SELECT shop_id 
    FROM shop_staff 
    WHERE auth_id::text = auth.uid()::text
  )
);

-- ============================================
-- PUBLIC ACCESS FOR TOKEN VALIDATION
-- ============================================

-- Allow public (unauthenticated) users to read tokens by token value
-- This is needed for the public invoice page to validate tokens
CREATE POLICY "Public can validate tokens by token value"
ON invoice_tokens
FOR SELECT
USING (true);

-- ============================================
-- HELPER FUNCTION: Validate Token
-- ============================================

CREATE OR REPLACE FUNCTION validate_invoice_token(token_value VARCHAR(64))
RETURNS TABLE (
  valid BOOLEAN,
  invoice_id VARCHAR(255),
  shop_id VARCHAR(255),
  expired BOOLEAN
) 
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    CASE 
      WHEN t.id IS NOT NULL AND t.expires_at > NOW() THEN true
      ELSE false
    END as valid,
    t.invoice_id,
    t.shop_id,
    CASE 
      WHEN t.id IS NOT NULL AND t.expires_at <= NOW() THEN true
      ELSE false
    END as expired
  FROM invoice_tokens t
  WHERE t.token = token_value
  LIMIT 1;
END;
$$;

-- ============================================
-- CLEANUP: Function to remove expired tokens
-- ============================================

CREATE OR REPLACE FUNCTION cleanup_expired_invoice_tokens()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM invoice_tokens
  WHERE expires_at < NOW() - INTERVAL '7 days';
  
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

-- ============================================
-- NOTES
-- ============================================
-- To apply this migration:
-- 1. Go to Supabase Dashboard > SQL Editor
-- 2. Paste this SQL and run it
-- 
-- Token expiration: 30 days by default (set when creating token)
-- Cleanup: Run cleanup_expired_invoice_tokens() periodically or via pg_cron
--
-- Example: Create a token
-- INSERT INTO invoice_tokens (token, invoice_id, shop_id, expires_at, sent_via, recipient_email)
-- VALUES ('abc123secure', 'invoice-uuid', 'shop-uuid', NOW() + INTERVAL '30 days', ARRAY['email'], 'customer@example.com');
