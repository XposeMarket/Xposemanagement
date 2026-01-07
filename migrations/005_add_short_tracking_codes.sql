-- Migration: Add short tracking codes to appointment_tokens
-- Date: 2026-01-07
-- Description: Adds short_code column for kiosk mode tracking (ABC-1234 format)

-- Add short_code column
ALTER TABLE appointment_tokens 
ADD COLUMN IF NOT EXISTS short_code VARCHAR(8);

-- Create unique index on short_code
CREATE UNIQUE INDEX IF NOT EXISTS idx_appointment_tokens_short_code 
ON appointment_tokens(short_code) 
WHERE short_code IS NOT NULL;

-- Create function to generate short codes
CREATE OR REPLACE FUNCTION generate_short_code()
RETURNS VARCHAR(8) AS $$
DECLARE
  letters TEXT := 'ABCDEFGHJKLMNPRSTUVWXYZ';  -- Excluding I, O, Q to avoid confusion
  code VARCHAR(8);
  exists BOOLEAN;
BEGIN
  LOOP
    -- Generate 3 random letters
    code := '';
    code := code || substring(letters FROM (floor(random() * 24)::int + 1) FOR 1);
    code := code || substring(letters FROM (floor(random() * 24)::int + 1) FOR 1);
    code := code || substring(letters FROM (floor(random() * 24)::int + 1) FOR 1);
    code := code || '-';
    
    -- Generate 4 random numbers
    code := code || lpad(floor(random() * 10000)::text, 4, '0');
    
    -- Check if code already exists
    SELECT EXISTS(
      SELECT 1 FROM appointment_tokens WHERE short_code = code
    ) INTO exists;
    
    -- If code doesn't exist, return it
    IF NOT exists THEN
      RETURN code;
    END IF;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to auto-generate short_code on insert
CREATE OR REPLACE FUNCTION set_short_code()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.short_code IS NULL THEN
    NEW.short_code := generate_short_code();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS appointment_tokens_short_code_trigger ON appointment_tokens;
CREATE TRIGGER appointment_tokens_short_code_trigger
  BEFORE INSERT ON appointment_tokens
  FOR EACH ROW
  EXECUTE FUNCTION set_short_code();

-- Backfill existing tokens with short codes
UPDATE appointment_tokens 
SET short_code = generate_short_code()
WHERE short_code IS NULL;
