-- ============================================
-- ADD is_active COLUMN TO shop_staff IF IT DOESN'T EXIST
-- ============================================

-- Add is_active column if it doesn't exist
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'shop_staff' 
        AND column_name = 'is_active'
    ) THEN
        ALTER TABLE shop_staff ADD COLUMN is_active BOOLEAN DEFAULT true;
    END IF;
END $$;

-- Add other potentially missing columns
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'shop_staff' 
        AND column_name = 'hourly_rate'
    ) THEN
        ALTER TABLE shop_staff ADD COLUMN hourly_rate DECIMAL(10,2);
    END IF;
END $$;

DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'shop_staff' 
        AND column_name = 'hire_date'
    ) THEN
        ALTER TABLE shop_staff ADD COLUMN hire_date DATE DEFAULT CURRENT_DATE;
    END IF;
END $$;

DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'shop_staff' 
        AND column_name = 'notes'
    ) THEN
        ALTER TABLE shop_staff ADD COLUMN notes TEXT;
    END IF;
END $$;

DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'shop_staff' 
        AND column_name = 'created_by'
    ) THEN
        ALTER TABLE shop_staff ADD COLUMN created_by UUID;
    END IF;
END $$;

-- Create index for is_active if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_indexes
        WHERE indexname = 'idx_shop_staff_active'
    ) THEN
        CREATE INDEX idx_shop_staff_active ON shop_staff(shop_id, is_active);
    END IF;
END $$;
