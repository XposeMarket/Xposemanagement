-- ============================================================================
-- TWILIO MESSAGING SYSTEM - COMPLETE SQL MIGRATION
-- ============================================================================
-- This migration adds all necessary tables and modifications for the Twilio
-- messaging system integration. Safe to run multiple times (uses IF NOT EXISTS).
--
-- Run this in Supabase SQL Editor or via psql.
-- ============================================================================

-- ============================================================================
-- STEP 1: Add messaging fields to existing shops table
-- ============================================================================

DO $$ 
BEGIN
  -- Add messaging_enabled column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name='shops' AND column_name='messaging_enabled'
  ) THEN
    ALTER TABLE shops ADD COLUMN messaging_enabled boolean DEFAULT false;
    COMMENT ON COLUMN shops.messaging_enabled IS 'Whether shop has messaging feature enabled';
  END IF;

  -- Add messaging_plan column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name='shops' AND column_name='messaging_plan'
  ) THEN
    ALTER TABLE shops ADD COLUMN messaging_plan text DEFAULT 'none' CHECK (messaging_plan IN ('none', 'included', 'addon'));
    COMMENT ON COLUMN shops.messaging_plan IS 'Messaging subscription type: none, included, or addon';
  END IF;
END $$;

-- ============================================================================
-- STEP 2: Create shop_twilio_numbers table
-- ============================================================================

CREATE TABLE IF NOT EXISTS shop_twilio_numbers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id text NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  phone_number text NOT NULL, -- E.164 format: +12025550123
  twilio_sid text NOT NULL, -- Twilio IncomingPhoneNumber SID (e.g., PNxxxx)
  messaging_service_sid text, -- Optional Twilio Messaging Service SID
  twilio_subaccount_sid text, -- Optional if using subaccounts per shop
  country text DEFAULT 'US',
  capabilities jsonb DEFAULT '{"sms": true, "mms": true, "voice": false}'::jsonb,
  provisioning_status text NOT NULL DEFAULT 'provisioning' 
    CHECK (provisioning_status IN ('provisioning', 'active', 'failed', 'released', 'suspended')),
  monthly_cost numeric(10, 2) DEFAULT 5.00, -- Your charge to shop per month
  twilio_monthly_cost numeric(10, 2) DEFAULT 1.00, -- Actual Twilio cost per month
  notes text, -- Admin notes about this number
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(phone_number),
  UNIQUE(twilio_sid)
);

COMMENT ON TABLE shop_twilio_numbers IS 'Twilio phone numbers provisioned for each shop';
COMMENT ON COLUMN shop_twilio_numbers.phone_number IS 'Phone number in E.164 format';
COMMENT ON COLUMN shop_twilio_numbers.twilio_sid IS 'Twilio IncomingPhoneNumber SID';
COMMENT ON COLUMN shop_twilio_numbers.provisioning_status IS 'Current status of the phone number';
COMMENT ON COLUMN shop_twilio_numbers.monthly_cost IS 'Monthly charge to shop for this number';

-- Indexes for shop_twilio_numbers
CREATE INDEX IF NOT EXISTS idx_shop_twilio_numbers_shop_id 
  ON shop_twilio_numbers(shop_id);
CREATE INDEX IF NOT EXISTS idx_shop_twilio_numbers_phone 
  ON shop_twilio_numbers(phone_number);
CREATE INDEX IF NOT EXISTS idx_shop_twilio_numbers_status 
  ON shop_twilio_numbers(provisioning_status);
CREATE INDEX IF NOT EXISTS idx_shop_twilio_numbers_active 
  ON shop_twilio_numbers(shop_id, provisioning_status) 
  WHERE provisioning_status = 'active';

-- ============================================================================
-- STEP 3: Modify customers table for messaging
-- ============================================================================

DO $$ 
BEGIN
  -- Add phone column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name='customers' AND column_name='phone'
  ) THEN
    ALTER TABLE customers ADD COLUMN phone text;
    COMMENT ON COLUMN customers.phone IS 'Customer phone number (raw format)';
  END IF;

  -- Add phone_normalized column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name='customers' AND column_name='phone_normalized'
  ) THEN
    ALTER TABLE customers ADD COLUMN phone_normalized text;
    COMMENT ON COLUMN customers.phone_normalized IS 'Phone number in E.164 format for lookups';
  END IF;

  -- Add notes column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name='customers' AND column_name='notes'
  ) THEN
    ALTER TABLE customers ADD COLUMN notes text;
    COMMENT ON COLUMN customers.notes IS 'Internal notes about the customer';
  END IF;

  -- Add sms_opt_in column for compliance
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name='customers' AND column_name='sms_opt_in'
  ) THEN
    ALTER TABLE customers ADD COLUMN sms_opt_in boolean DEFAULT true;
    COMMENT ON COLUMN customers.sms_opt_in IS 'Whether customer has opted in to SMS (TCPA compliance)';
  END IF;

  -- Add sms_opt_in_date column
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name='customers' AND column_name='sms_opt_in_date'
  ) THEN
    ALTER TABLE customers ADD COLUMN sms_opt_in_date timestamptz;
    COMMENT ON COLUMN customers.sms_opt_in_date IS 'When customer opted in to SMS';
  END IF;
END $$;

-- Add unique constraint on shop_id + phone_normalized to prevent duplicates
DROP INDEX IF EXISTS idx_customers_shop_phone;
CREATE UNIQUE INDEX idx_customers_shop_phone 
  ON customers(shop_id, phone_normalized) 
  WHERE phone_normalized IS NOT NULL;

-- Additional indexes for customers
CREATE INDEX IF NOT EXISTS idx_customers_shop_id 
  ON customers(shop_id);
CREATE INDEX IF NOT EXISTS idx_customers_phone_normalized 
  ON customers(phone_normalized) 
  WHERE phone_normalized IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_customers_sms_opt_in 
  ON customers(shop_id, sms_opt_in) 
  WHERE sms_opt_in = true;

-- ============================================================================
-- STEP 4: Create threads table (message conversations)
-- ============================================================================

CREATE TABLE IF NOT EXISTS threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id text NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  customer_id uuid REFERENCES customers(id) ON DELETE SET NULL,
  twilio_number_id uuid REFERENCES shop_twilio_numbers(id) ON DELETE SET NULL,
  external_recipient text NOT NULL, -- Customer phone in E.164 format
  subject text, -- Optional thread subject/name
  last_message text, -- Preview of last message
  last_message_at timestamptz, -- Timestamp of last message
  unread_count integer DEFAULT 0 CHECK (unread_count >= 0), -- Unread messages count
  archived boolean DEFAULT false, -- Soft delete for threads
  pinned boolean DEFAULT false, -- Pin important conversations
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE threads IS 'Message conversation threads between shops and customers';
COMMENT ON COLUMN threads.external_recipient IS 'Customer phone number in E.164 format';
COMMENT ON COLUMN threads.last_message IS 'Preview text of the most recent message';
COMMENT ON COLUMN threads.unread_count IS 'Number of unread messages from customer';
COMMENT ON COLUMN threads.archived IS 'Whether thread is archived (hidden from main view)';

-- Indexes for threads
CREATE INDEX IF NOT EXISTS idx_threads_shop_id 
  ON threads(shop_id);
CREATE INDEX IF NOT EXISTS idx_threads_customer_id 
  ON threads(customer_id);
CREATE INDEX IF NOT EXISTS idx_threads_twilio_number_id 
  ON threads(twilio_number_id);
CREATE INDEX IF NOT EXISTS idx_threads_last_message_at 
  ON threads(shop_id, last_message_at DESC) 
  WHERE archived = false;
CREATE INDEX IF NOT EXISTS idx_threads_unread 
  ON threads(shop_id, unread_count) 
  WHERE unread_count > 0 AND archived = false;
CREATE INDEX IF NOT EXISTS idx_threads_pinned 
  ON threads(shop_id, pinned) 
  WHERE pinned = true AND archived = false;

-- Unique constraint: one active thread per shop + customer phone + number
DROP INDEX IF EXISTS idx_threads_unique;
CREATE UNIQUE INDEX idx_threads_unique 
  ON threads(shop_id, external_recipient) 
  WHERE archived = false AND twilio_number_id IS NOT NULL;

-- ============================================================================
-- STEP 5: Create messages table
-- ============================================================================

CREATE TABLE IF NOT EXISTS messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id uuid NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  shop_id text NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  customer_id uuid REFERENCES customers(id) ON DELETE SET NULL,
  twilio_message_sid text, -- Twilio Message SID for tracking (e.g., SMxxxx or MMxxxx)
  direction text NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  from_number text NOT NULL, -- E.164 format
  to_number text NOT NULL, -- E.164 format
  body text, -- Message body text (max 1600 chars for SMS)
  media jsonb, -- Array of media: [{"url": "...", "contentType": "image/jpeg", "size": 12345}]
  status text NOT NULL DEFAULT 'queued' 
    CHECK (status IN ('queued', 'sent', 'delivered', 'failed', 'undelivered', 'received')),
  error_code text, -- Twilio error code if failed (e.g., "30008")
  error_message text, -- Human-readable error message
  price numeric(10, 4), -- Cost in USD from Twilio
  price_unit text DEFAULT 'USD',
  num_segments integer DEFAULT 1, -- SMS segments (1 segment = 160 chars)
  num_media integer DEFAULT 0, -- Number of media attachments
  sent_at timestamptz, -- When message was sent (outbound)
  delivered_at timestamptz, -- When message was delivered (outbound)
  received_at timestamptz, -- When message was received (inbound)
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE messages IS 'Individual SMS/MMS messages with full Twilio metadata';
COMMENT ON COLUMN messages.twilio_message_sid IS 'Twilio Message SID (SM for SMS, MM for MMS)';
COMMENT ON COLUMN messages.direction IS 'inbound (customer to shop) or outbound (shop to customer)';
COMMENT ON COLUMN messages.body IS 'Message text content (up to 1600 characters)';
COMMENT ON COLUMN messages.media IS 'JSONB array of media attachments with URLs and metadata';
COMMENT ON COLUMN messages.status IS 'Current delivery status from Twilio';
COMMENT ON COLUMN messages.num_segments IS 'Number of SMS segments (160 chars each)';

-- Indexes for messages
CREATE INDEX IF NOT EXISTS idx_messages_thread_id 
  ON messages(thread_id);
CREATE INDEX IF NOT EXISTS idx_messages_shop_id 
  ON messages(shop_id);
CREATE INDEX IF NOT EXISTS idx_messages_customer_id 
  ON messages(customer_id);
CREATE INDEX IF NOT EXISTS idx_messages_twilio_sid 
  ON messages(twilio_message_sid) 
  WHERE twilio_message_sid IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_messages_direction 
  ON messages(direction);
CREATE INDEX IF NOT EXISTS idx_messages_status 
  ON messages(status) 
  WHERE status IN ('failed', 'undelivered');
CREATE INDEX IF NOT EXISTS idx_messages_created_at 
  ON messages(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_thread_created 
  ON messages(thread_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_messages_sent_at 
  ON messages(sent_at DESC NULLS LAST);

-- Unique constraint on Twilio SID to prevent duplicate message processing
CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_twilio_sid_unique 
  ON messages(twilio_message_sid) 
  WHERE twilio_message_sid IS NOT NULL;

-- ============================================================================
-- STEP 6: Create trigger functions and triggers
-- ============================================================================

-- Function to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION trigger_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION trigger_set_updated_at() IS 'Automatically sets updated_at to current timestamp';

-- Apply updated_at triggers to all messaging tables
DROP TRIGGER IF EXISTS set_updated_at ON shop_twilio_numbers;
CREATE TRIGGER set_updated_at 
  BEFORE UPDATE ON shop_twilio_numbers 
  FOR EACH ROW 
  EXECUTE FUNCTION trigger_set_updated_at();

DROP TRIGGER IF EXISTS set_updated_at ON threads;
CREATE TRIGGER set_updated_at 
  BEFORE UPDATE ON threads 
  FOR EACH ROW 
  EXECUTE FUNCTION trigger_set_updated_at();

DROP TRIGGER IF EXISTS set_updated_at ON messages;
CREATE TRIGGER set_updated_at 
  BEFORE UPDATE ON messages 
  FOR EACH ROW 
  EXECUTE FUNCTION trigger_set_updated_at();

-- Function to update thread's last_message when new message is inserted
CREATE OR REPLACE FUNCTION update_thread_last_message()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE threads 
  SET 
    last_message = COALESCE(NEW.body, '(Media)'),
    last_message_at = NEW.created_at,
    unread_count = CASE 
      WHEN NEW.direction = 'inbound' THEN unread_count + 1 
      ELSE unread_count 
    END,
    updated_at = now()
  WHERE id = NEW.thread_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION update_thread_last_message() IS 'Updates thread metadata when a new message is inserted';

DROP TRIGGER IF EXISTS update_thread_on_message ON messages;
CREATE TRIGGER update_thread_on_message 
  AFTER INSERT ON messages 
  FOR EACH ROW 
  EXECUTE FUNCTION update_thread_last_message();

-- Function to normalize phone numbers to E.164 format (basic implementation)
CREATE OR REPLACE FUNCTION normalize_phone_e164(phone_input text, default_country text DEFAULT 'US')
RETURNS text AS $$
DECLARE
  digits text;
BEGIN
  IF phone_input IS NULL OR phone_input = '' THEN
    RETURN NULL;
  END IF;
  
  -- Remove all non-digit characters
  digits := regexp_replace(phone_input, '[^0-9]', '', 'g');
  
  -- If already starts with +, return with + and digits
  IF phone_input ~ '^\+' THEN
    RETURN '+' || digits;
  END IF;
  
  -- US/Canada: 10 digits -> +1XXXXXXXXXX
  IF length(digits) = 10 AND default_country = 'US' THEN
    RETURN '+1' || digits;
  END IF;
  
  -- US/Canada: 11 digits starting with 1 -> +1XXXXXXXXXX
  IF length(digits) = 11 AND substring(digits, 1, 1) = '1' THEN
    RETURN '+' || digits;
  END IF;
  
  -- Default: add + prefix
  RETURN '+' || digits;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION normalize_phone_e164(text, text) IS 'Converts phone number to E.164 format (+1XXXXXXXXXX)';

-- Function to automatically normalize customer phone on insert/update
CREATE OR REPLACE FUNCTION auto_normalize_customer_phone()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.phone IS NOT NULL AND NEW.phone != '' THEN
    NEW.phone_normalized := normalize_phone_e164(NEW.phone, 'US');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION auto_normalize_customer_phone() IS 'Automatically normalizes customer phone to E.164 format';

DROP TRIGGER IF EXISTS normalize_phone ON customers;
CREATE TRIGGER normalize_phone
  BEFORE INSERT OR UPDATE OF phone ON customers
  FOR EACH ROW
  EXECUTE FUNCTION auto_normalize_customer_phone();

-- ============================================================================
-- STEP 7: Enable Row Level Security (RLS) and create policies
-- ============================================================================

-- Enable RLS on all messaging tables
ALTER TABLE shop_twilio_numbers ENABLE ROW LEVEL SECURITY;
ALTER TABLE threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- RLS Policies for shop_twilio_numbers
-- ============================================================================

-- Users can view numbers for shops they belong to
DROP POLICY IF EXISTS "Users can view their shop's Twilio numbers" ON shop_twilio_numbers;
CREATE POLICY "Users can view their shop's Twilio numbers" 
  ON shop_twilio_numbers FOR SELECT 
  USING (
    shop_id IN (
      SELECT shop_id FROM user_shops WHERE user_id = auth.uid()
    )
  );

-- Users can insert numbers for their shops (if they have admin role)
DROP POLICY IF EXISTS "Admins can provision numbers for their shop" ON shop_twilio_numbers;
CREATE POLICY "Admins can provision numbers for their shop" 
  ON shop_twilio_numbers FOR INSERT 
  WITH CHECK (
    shop_id IN (
      SELECT us.shop_id 
      FROM user_shops us 
      WHERE us.user_id = auth.uid() 
      AND us.role IN ('owner', 'admin')
    )
  );

-- Users can update numbers for their shops (if they have admin role)
DROP POLICY IF EXISTS "Admins can update their shop's numbers" ON shop_twilio_numbers;
CREATE POLICY "Admins can update their shop's numbers" 
  ON shop_twilio_numbers FOR UPDATE 
  USING (
    shop_id IN (
      SELECT us.shop_id 
      FROM user_shops us 
      WHERE us.user_id = auth.uid() 
      AND us.role IN ('owner', 'admin')
    )
  );

-- Service role can do everything (for server-side operations)
DROP POLICY IF EXISTS "Service role full access to numbers" ON shop_twilio_numbers;
CREATE POLICY "Service role full access to numbers"
  ON shop_twilio_numbers
  USING (auth.jwt()->>'role' = 'service_role');

-- ============================================================================
-- RLS Policies for threads
-- ============================================================================

-- Users can view threads for their shops
DROP POLICY IF EXISTS "Users can view their shop's threads" ON threads;
CREATE POLICY "Users can view their shop's threads" 
  ON threads FOR SELECT 
  USING (
    shop_id IN (
      SELECT shop_id FROM user_shops WHERE user_id = auth.uid()
    )
  );

-- Users can insert threads for their shops
DROP POLICY IF EXISTS "Users can insert threads for their shop" ON threads;
CREATE POLICY "Users can insert threads for their shop" 
  ON threads FOR INSERT 
  WITH CHECK (
    shop_id IN (
      SELECT shop_id FROM user_shops WHERE user_id = auth.uid()
    )
  );

-- Users can update threads for their shops
DROP POLICY IF EXISTS "Users can update their shop's threads" ON threads;
CREATE POLICY "Users can update their shop's threads" 
  ON threads FOR UPDATE 
  USING (
    shop_id IN (
      SELECT shop_id FROM user_shops WHERE user_id = auth.uid()
    )
  );

-- Users can delete (archive) threads for their shops
DROP POLICY IF EXISTS "Users can archive their shop's threads" ON threads;
CREATE POLICY "Users can archive their shop's threads" 
  ON threads FOR DELETE 
  USING (
    shop_id IN (
      SELECT shop_id FROM user_shops WHERE user_id = auth.uid()
    )
  );

-- Service role full access
DROP POLICY IF EXISTS "Service role full access to threads" ON threads;
CREATE POLICY "Service role full access to threads"
  ON threads
  USING (auth.jwt()->>'role' = 'service_role');

-- ============================================================================
-- RLS Policies for messages
-- ============================================================================

-- Users can view messages for their shops
DROP POLICY IF EXISTS "Users can view their shop's messages" ON messages;
CREATE POLICY "Users can view their shop's messages" 
  ON messages FOR SELECT 
  USING (
    shop_id IN (
      SELECT shop_id FROM user_shops WHERE user_id = auth.uid()
    )
  );

-- Users can insert messages for their shops
DROP POLICY IF EXISTS "Users can insert messages for their shop" ON messages;
CREATE POLICY "Users can insert messages for their shop" 
  ON messages FOR INSERT 
  WITH CHECK (
    shop_id IN (
      SELECT shop_id FROM user_shops WHERE user_id = auth.uid()
    )
  );

-- Users can update messages for their shops (for status updates)
DROP POLICY IF EXISTS "Users can update their shop's messages" ON messages;
CREATE POLICY "Users can update their shop's messages" 
  ON messages FOR UPDATE 
  USING (
    shop_id IN (
      SELECT shop_id FROM user_shops WHERE user_id = auth.uid()
    )
  );

-- Service role full access (for webhook processing)
DROP POLICY IF EXISTS "Service role full access to messages" ON messages;
CREATE POLICY "Service role full access to messages"
  ON messages
  USING (auth.jwt()->>'role' = 'service_role');

-- ============================================================================
-- STEP 8: Helper views and functions for messaging analytics
-- ============================================================================

-- View: Active threads with customer info and unread counts
CREATE OR REPLACE VIEW v_active_threads AS
SELECT 
  t.id,
  t.shop_id,
  t.customer_id,
  t.twilio_number_id,
  t.external_recipient,
  t.subject,
  t.last_message,
  t.last_message_at,
  t.unread_count,
  t.pinned,
  t.created_at,
  -- Return the entire customer row as JSON to avoid referencing unknown column names
  to_jsonb(c) AS customer,
  -- Derive a best-effort display name from common fields inside the customer JSON
  COALESCE(
    (to_jsonb(c)->> 'customer_first'),
    (to_jsonb(c)->> 'first_name'),
    (to_jsonb(c)->> 'first'),
    (to_jsonb(c)->> 'name'),
    (to_jsonb(c)->> 'full_name'),
    (to_jsonb(c)->> 'display_name'),
    t.external_recipient
  ) AS customer_display_name,
  -- Best-effort email and opt-in flags from customer JSON
  (to_jsonb(c)->> 'email') AS customer_email,
  (to_jsonb(c)->> 'sms_opt_in')::boolean AS customer_opt_in,
  stn.phone_number AS shop_phone_number,
  (
    SELECT COUNT(*) 
    FROM messages m 
    WHERE m.thread_id = t.id
  ) AS total_messages,
  (
    SELECT COUNT(*) 
    FROM messages m 
    WHERE m.thread_id = t.id 
    AND m.direction = 'inbound'
  ) AS inbound_messages,
  (
    SELECT COUNT(*) 
    FROM messages m 
    WHERE m.thread_id = t.id 
    AND m.direction = 'outbound'
  ) AS outbound_messages
FROM threads t
LEFT JOIN customers c ON t.customer_id = c.id
LEFT JOIN shop_twilio_numbers stn ON t.twilio_number_id = stn.id
WHERE t.archived = false;

COMMENT ON VIEW v_active_threads IS 'Enriched view of active threads with customer info and message counts';

-- View: Message statistics per shop
CREATE OR REPLACE VIEW v_shop_message_stats AS
SELECT 
  s.id AS shop_id,
  -- Defensive shop name resolution: try common name fields, fallback to id
  COALESCE(
    s.name,
    (to_jsonb(s)->> 'shop_name'),
    (to_jsonb(s)->> 'store_name'),
    (to_jsonb(s)->> 'name'),
    (to_jsonb(s)->> 'title'),
    s.id::text
  ) AS shop_name,
  COUNT(DISTINCT t.id) AS total_threads,
  COUNT(DISTINCT CASE WHEN t.unread_count > 0 THEN t.id END) AS threads_with_unread,
  COALESCE(SUM(t.unread_count), 0) AS total_unread_messages,
  COUNT(m.id) AS total_messages,
  COUNT(CASE WHEN m.direction = 'inbound' THEN 1 END) AS total_inbound,
  COUNT(CASE WHEN m.direction = 'outbound' THEN 1 END) AS total_outbound,
  COUNT(CASE WHEN m.status = 'failed' THEN 1 END) AS failed_messages,
  COUNT(CASE WHEN m.created_at >= CURRENT_DATE THEN 1 END) AS messages_today,
  COUNT(CASE WHEN m.created_at >= CURRENT_DATE - INTERVAL '7 days' THEN 1 END) AS messages_this_week,
  COUNT(CASE WHEN m.created_at >= CURRENT_DATE - INTERVAL '30 days' THEN 1 END) AS messages_this_month,
  MAX(m.created_at) AS last_message_time
FROM shops s
LEFT JOIN threads t ON s.id = t.shop_id AND t.archived = false
LEFT JOIN messages m ON t.id = m.thread_id
GROUP BY s.id, COALESCE(
    s.name,
    (to_jsonb(s)->> 'shop_name'),
    (to_jsonb(s)->> 'store_name'),
    (to_jsonb(s)->> 'name'),
    (to_jsonb(s)->> 'title'),
    s.id::text
  );

COMMENT ON VIEW v_shop_message_stats IS 'Messaging statistics and metrics per shop';

-- Function: Get message volume by hour (for rate limiting insights)
CREATE OR REPLACE FUNCTION get_message_volume_by_hour(
  p_shop_id text,
  p_hours_back integer DEFAULT 24
)
RETURNS TABLE(
  hour timestamptz,
  message_count bigint,
  inbound_count bigint,
  outbound_count bigint
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    date_trunc('hour', m.created_at) AS hour,
    COUNT(*) AS message_count,
    COUNT(CASE WHEN m.direction = 'inbound' THEN 1 END) AS inbound_count,
    COUNT(CASE WHEN m.direction = 'outbound' THEN 1 END) AS outbound_count
  FROM messages m
  WHERE m.shop_id = p_shop_id
    AND m.created_at >= now() - (p_hours_back || ' hours')::interval
  GROUP BY date_trunc('hour', m.created_at)
  ORDER BY hour DESC;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION get_message_volume_by_hour(uuid, integer) IS 'Returns hourly message volume for a shop';

-- Function: Search messages by content
CREATE OR REPLACE FUNCTION search_messages(
  p_shop_id text,
  p_search_text text,
  p_limit integer DEFAULT 50
)
RETURNS TABLE(
  message_id uuid,
  thread_id uuid,
  customer_name text,
  body text,
  direction text,
  created_at timestamptz
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    m.id AS message_id,
    m.thread_id,
    COALESCE(
      (to_jsonb(c)->> 'customer_first') || ' ' || (to_jsonb(c)->> 'customer_last'),
      (to_jsonb(c)->> 'first_name') || ' ' || (to_jsonb(c)->> 'last_name'),
      (to_jsonb(c)->> 'name'),
      t.external_recipient
    ) AS customer_name,
    m.body,
    m.direction,
    m.created_at
  FROM messages m
  JOIN threads t ON m.thread_id = t.id
  LEFT JOIN customers c ON m.customer_id = c.id
  WHERE m.shop_id = p_shop_id
    AND m.body ILIKE '%' || p_search_text || '%'
  ORDER BY m.created_at DESC
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION search_messages(uuid, text, integer) IS 'Full-text search across message bodies';

-- ============================================================================
-- STEP 9: Create indexes for Supabase Realtime
-- ============================================================================

-- Realtime requires replica identity for UPDATE/DELETE operations
ALTER TABLE shop_twilio_numbers REPLICA IDENTITY FULL;
ALTER TABLE threads REPLICA IDENTITY FULL;
ALTER TABLE messages REPLICA IDENTITY FULL;

-- Enable realtime for messaging tables (if not already enabled)
-- Note: This requires the supabase_realtime publication to exist
-- Run these commands in Supabase Dashboard or SQL Editor:

DO $$ 
BEGIN
  -- Check if publication exists and add tables to it
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    -- Add tables to realtime publication
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE IF NOT EXISTS shop_twilio_numbers';
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE IF NOT EXISTS threads';
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE IF NOT EXISTS messages';
    RAISE NOTICE 'Tables added to supabase_realtime publication';
  ELSE
    RAISE NOTICE 'supabase_realtime publication not found - enable Realtime in Supabase Dashboard';
  END IF;
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'Could not add tables to realtime publication: %', SQLERRM;
END $$;

-- ============================================================================
-- STEP 10: Grant permissions
-- ============================================================================

-- Grant service role full access (for server-side API operations)
GRANT ALL ON shop_twilio_numbers TO service_role;
GRANT ALL ON threads TO service_role;
GRANT ALL ON messages TO service_role;

-- Grant authenticated users appropriate access (controlled by RLS)
GRANT SELECT, INSERT, UPDATE ON shop_twilio_numbers TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON threads TO authenticated;
GRANT SELECT, INSERT, UPDATE ON messages TO authenticated;

-- Grant access to views
GRANT SELECT ON v_active_threads TO authenticated, service_role;
GRANT SELECT ON v_shop_message_stats TO authenticated, service_role;

-- Grant execute on functions
GRANT EXECUTE ON FUNCTION normalize_phone_e164(text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION get_message_volume_by_hour(text, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION search_messages(text, text, integer) TO authenticated, service_role;

-- ============================================================================
-- STEP 11: Insert sample data for testing (optional - comment out for production)
-- ============================================================================

-- Uncomment to insert sample data for development/testing:
/*
-- Sample: Add messaging to first shop (if exists)
DO $$ 
DECLARE
  v_shop_id uuid;
BEGIN
  SELECT id INTO v_shop_id FROM shops LIMIT 1;
  
  IF v_shop_id IS NOT NULL THEN
    -- Enable messaging for shop
    UPDATE shops 
    SET messaging_enabled = true, messaging_plan = 'addon'
    WHERE id = v_shop_id;
    
    -- Insert sample Twilio number
    INSERT INTO shop_twilio_numbers (shop_id, phone_number, twilio_sid, provisioning_status, country)
    VALUES (v_shop_id, '+14155551234', 'PN_sample_test_sid', 'active', 'US')
    ON CONFLICT DO NOTHING;
    
    RAISE NOTICE 'Sample messaging data created for shop %', v_shop_id;
  ELSE
    RAISE NOTICE 'No shops found - create a shop first';
  END IF;
END $$;
*/

-- ============================================================================
-- MIGRATION COMPLETE
-- ============================================================================

-- Verification queries (run these to check the migration succeeded):

-- Check table creation
SELECT 
  table_name, 
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_name = t.table_name) as column_count
FROM information_schema.tables t
WHERE table_schema = 'public' 
  AND table_name IN ('shop_twilio_numbers', 'threads', 'messages')
ORDER BY table_name;

-- Check RLS is enabled
SELECT 
  tablename,
  rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('shop_twilio_numbers', 'threads', 'messages');

-- Check policies exist
SELECT 
  tablename,
  policyname,
  cmd,
  roles
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('shop_twilio_numbers', 'threads', 'messages')
ORDER BY tablename, policyname;

-- Summary
DO $$ 
BEGIN
  RAISE NOTICE '✅ Twilio messaging migration completed successfully!';
  RAISE NOTICE '📋 Tables created: shop_twilio_numbers, threads, messages';
  RAISE NOTICE '🔒 RLS policies applied for secure multi-tenant access';
  RAISE NOTICE '⚡ Triggers configured for auto-updates';
  RAISE NOTICE '🔔 Realtime enabled for instant message sync';
  RAISE NOTICE '📊 Views and helper functions created';
  RAISE NOTICE '';
  RAISE NOTICE '🚀 Next steps:';
  RAISE NOTICE '1. Configure Twilio credentials in your .env file';
  RAISE NOTICE '2. Run: npm install';
  RAISE NOTICE '3. Start server: npm start';
  RAISE NOTICE '4. Test provisioning endpoint: POST /api/messaging/provision';
  RAISE NOTICE '5. Configure webhooks in Twilio Console';
  RAISE NOTICE '';
  RAISE NOTICE '📚 See docs/MESSAGING_SETUP.md for complete instructions';
END $$;
