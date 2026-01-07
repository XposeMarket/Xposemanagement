-- ============================================
-- Migration: Add Short Tracking Codes
-- Version: 005
-- Date: 2026-01-07
-- ============================================

-- Step 1: Add short_code column
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'appointment_tokens' AND column_name = 'short_code'
    ) THEN
        ALTER TABLE appointment_tokens ADD COLUMN short_code VARCHAR(8);
        RAISE NOTICE 'Added short_code column';
    ELSE
        RAISE NOTICE 'short_code column already exists';
    END IF;
END $$;

-- Step 2: Create unique index
CREATE UNIQUE INDEX IF NOT EXISTS idx_appointment_tokens_short_code 
ON appointment_tokens(short_code) 
WHERE short_code IS NOT NULL;

-- Step 3: Create function to generate short codes
CREATE OR REPLACE FUNCTION generate_short_code()
RETURNS VARCHAR(8) AS $$
DECLARE
  letters TEXT := 'ABCDEFGHJKLMNPRSTUVWXYZ';
  code VARCHAR(8);
  code_exists BOOLEAN;
  attempts INT := 0;
  max_attempts INT := 100;
BEGIN
  LOOP
    attempts := attempts + 1;
    
    -- Prevent infinite loop
    IF attempts > max_attempts THEN
      RAISE EXCEPTION 'Could not generate unique short code after % attempts', max_attempts;
    END IF;
    
    -- Generate code: ABC-1234
    code := '';
    code := code || substring(letters FROM (floor(random() * 23)::int + 1) FOR 1);
    code := code || substring(letters FROM (floor(random() * 23)::int + 1) FOR 1);
    code := code || substring(letters FROM (floor(random() * 23)::int + 1) FOR 1);
    code := code || '-';
    code := code || lpad(floor(random() * 10000)::text, 4, '0');
    
    -- Check if code exists
    SELECT EXISTS(
      SELECT 1 FROM appointment_tokens WHERE short_code = code
    ) INTO code_exists;
    
    -- Return if unique
    IF NOT code_exists THEN
      RETURN code;
    END IF;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Step 4: Create trigger function
CREATE OR REPLACE FUNCTION set_short_code()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.short_code IS NULL THEN
    NEW.short_code := generate_short_code();
    RAISE NOTICE 'Generated short code: %', NEW.short_code;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Step 5: Drop existing trigger if exists
DROP TRIGGER IF EXISTS appointment_tokens_short_code_trigger ON appointment_tokens;

-- Step 6: Create trigger
CREATE TRIGGER appointment_tokens_short_code_trigger
  BEFORE INSERT ON appointment_tokens
  FOR EACH ROW
  EXECUTE FUNCTION set_short_code();

-- Step 7: Backfill existing tokens
DO $$
DECLARE
  updated_count INT;
BEGIN
  UPDATE appointment_tokens 
  SET short_code = generate_short_code()
  WHERE short_code IS NULL;
  
  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RAISE NOTICE 'Backfilled % tokens with short codes', updated_count;
END $$;

-- Verification
SELECT 
  COUNT(*) as total_tokens,
  COUNT(short_code) as tokens_with_codes,
  COUNT(*) - COUNT(short_code) as tokens_without_codes
FROM appointment_tokens;
