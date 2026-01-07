-- ============================================
-- Migration: Add short_code to appointment_tokens
-- ============================================
-- This adds a human-friendly short code (e.g., ABC-1234) for kiosk/public tracking
-- The short_code is auto-generated on insert via a trigger

-- ============================================
-- STEP 1: Add short_code column
-- ============================================

ALTER TABLE appointment_tokens 
ADD COLUMN IF NOT EXISTS short_code VARCHAR(10);

-- ============================================
-- STEP 2: Create index for short_code lookups
-- ============================================

CREATE INDEX IF NOT EXISTS idx_appointment_tokens_short_code ON appointment_tokens(short_code);

-- ============================================
-- STEP 3: Create function to generate unique short codes
-- ============================================

CREATE OR REPLACE FUNCTION generate_tracking_short_code()
RETURNS VARCHAR(10)
LANGUAGE plpgsql
AS $$
DECLARE
  letters VARCHAR(23) := 'ABCDEFGHJKLMNPRSTUVWXYZ'; -- Excludes confusing: I, O, Q
  new_code VARCHAR(10);
  code_exists BOOLEAN := TRUE;
  attempts INT := 0;
BEGIN
  -- Keep generating until we find a unique code
  WHILE code_exists AND attempts < 100 LOOP
    -- Generate format: ABC-1234 (3 letters + hyphen + 4 digits)
    new_code := '';
    
    -- 3 random letters
    FOR i IN 1..3 LOOP
      new_code := new_code || substr(letters, floor(random() * 23 + 1)::int, 1);
    END LOOP;
    
    -- Hyphen
    new_code := new_code || '-';
    
    -- 4 random digits
    FOR i IN 1..4 LOOP
      new_code := new_code || floor(random() * 10)::int::text;
    END LOOP;
    
    -- Check if code exists
    SELECT EXISTS(
      SELECT 1 FROM appointment_tokens WHERE short_code = new_code
    ) INTO code_exists;
    
    attempts := attempts + 1;
  END LOOP;
  
  IF code_exists THEN
    RAISE EXCEPTION 'Could not generate unique short code after 100 attempts';
  END IF;
  
  RETURN new_code;
END;
$$;

-- ============================================
-- STEP 4: Create trigger to auto-generate short_code on insert
-- ============================================

CREATE OR REPLACE FUNCTION trigger_set_short_code()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Only generate if short_code is not provided
  IF NEW.short_code IS NULL THEN
    NEW.short_code := generate_tracking_short_code();
  END IF;
  RETURN NEW;
END;
$$;

-- Drop existing trigger if it exists
DROP TRIGGER IF EXISTS set_short_code_trigger ON appointment_tokens;

-- Create trigger
CREATE TRIGGER set_short_code_trigger
BEFORE INSERT ON appointment_tokens
FOR EACH ROW
EXECUTE FUNCTION trigger_set_short_code();

-- ============================================
-- STEP 5: Backfill existing tokens with short codes
-- ============================================

UPDATE appointment_tokens
SET short_code = generate_tracking_short_code()
WHERE short_code IS NULL;

-- ============================================
-- STEP 6: Make short_code NOT NULL after backfill
-- ============================================

ALTER TABLE appointment_tokens 
ALTER COLUMN short_code SET NOT NULL;

-- ============================================
-- STEP 7: Add unique constraint
-- ============================================

ALTER TABLE appointment_tokens 
ADD CONSTRAINT appointment_tokens_short_code_unique UNIQUE (short_code);

-- ============================================
-- NOTES
-- ============================================
-- This migration adds a short_code column to appointment_tokens
-- The short_code is auto-generated in format ABC-1234 (3 letters, hyphen, 4 digits)
-- Letters exclude I, O, Q to avoid confusion with 1, 0
-- 
-- To apply this migration:
-- 1. Go to Supabase Dashboard > SQL Editor
-- 2. Paste this SQL and run it
--
-- After this migration, all new appointment_tokens will automatically get a short_code
-- Existing tokens will also be backfilled with short codes
