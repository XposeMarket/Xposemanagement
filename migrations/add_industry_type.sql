-- Migration: Add industry_type column to shops table
-- Date: 2025-01-05
-- Purpose: Enable multi-industry support for Xpose Management platform

-- Add industry_type column to shops table
ALTER TABLE shops 
ADD COLUMN IF NOT EXISTS industry_type TEXT DEFAULT 'auto_shop';

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_shops_industry_type ON shops(industry_type);

-- Update existing shops to have 'auto_shop' as their industry type
UPDATE shops 
SET industry_type = 'auto_shop' 
WHERE industry_type IS NULL;

-- Add check constraint to ensure valid industry types
ALTER TABLE shops 
ADD CONSTRAINT check_industry_type 
CHECK (industry_type IN ('auto_shop', 'barbershop', 'tattoo_studio', 'nail_salon', 'other'));

-- Optional: Add comment to document the column
COMMENT ON COLUMN shops.industry_type IS 'Industry type: auto_shop, barbershop, tattoo_studio, nail_salon, or other';

-- Verification query (run after migration)
-- SELECT id, name, type, industry_type FROM shops LIMIT 10;
