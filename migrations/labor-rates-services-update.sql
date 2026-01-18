-- =====================================================
-- SQL MIGRATIONS FOR LABOR RATES DEFAULT & LABOR-BASED SERVICES
-- Run these in your Supabase SQL Editor
-- =====================================================

-- NOTE: Services and Labor Rates are stored in the `data` table's JSONB `settings` column.
-- The structure is:
--   settings.labor_rates = [ { name: string, rate: number, is_default: boolean }, ... ]
--   settings.services = [ { name: string, pricing_type: 'flat' | 'labor_based', price: number, labor_hours?: number, labor_rate_name?: string }, ... ]
--
-- Since this is JSONB, no schema migration is required for the data table.
-- The JavaScript code handles the structure automatically.
--
-- However, if you want to create a normalized services/labor_rates table in the future,
-- here are the SQL statements you would use:

-- =====================================================
-- OPTION A: Keep using JSONB in data.settings (RECOMMENDED - NO SQL NEEDED)
-- =====================================================
-- The current implementation stores services and labor_rates in data.settings JSONB column.
-- This is flexible and doesn't require database migrations.
-- The JavaScript code has been updated to handle:
--   - labor_rates[].is_default (boolean)
--   - services[].pricing_type ('flat' or 'labor_based')
--   - services[].labor_hours (number, for labor-based services)
--   - services[].labor_rate_name (string, references labor_rates[].name)

-- =====================================================
-- OPTION B: Create normalized tables (OPTIONAL - for advanced use cases)
-- =====================================================
-- If you want to migrate to a normalized structure in the future:

-- 1. Create labor_rates table
/*
CREATE TABLE IF NOT EXISTS labor_rates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    rate NUMERIC(10, 2) NOT NULL DEFAULT 0,
    is_default BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(shop_id, name)
);

-- Create index for shop lookups
CREATE INDEX IF NOT EXISTS idx_labor_rates_shop_id ON labor_rates(shop_id);

-- Ensure only one default per shop using a partial unique index
CREATE UNIQUE INDEX IF NOT EXISTS idx_labor_rates_shop_default 
ON labor_rates(shop_id) 
WHERE is_default = TRUE;
*/

-- 2. Create services table with labor-based support
/*
CREATE TABLE IF NOT EXISTS services (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    pricing_type VARCHAR(20) NOT NULL DEFAULT 'flat' CHECK (pricing_type IN ('flat', 'labor_based')),
    price NUMERIC(10, 2) NOT NULL DEFAULT 0,
    labor_hours NUMERIC(6, 2) DEFAULT NULL,
    labor_rate_id UUID REFERENCES labor_rates(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(shop_id, name)
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_services_shop_id ON services(shop_id);
CREATE INDEX IF NOT EXISTS idx_services_labor_rate_id ON services(labor_rate_id);
*/

-- 3. Enable Row Level Security (RLS) if using normalized tables
/*
ALTER TABLE labor_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE services ENABLE ROW LEVEL SECURITY;

-- RLS policies for labor_rates
CREATE POLICY "Users can view labor rates for their shop" ON labor_rates
    FOR SELECT USING (
        shop_id IN (
            SELECT shop_id FROM users WHERE id = auth.uid()
            UNION
            SELECT shop_id FROM shop_staff WHERE auth_id = auth.uid()
        )
    );

CREATE POLICY "Users can insert labor rates for their shop" ON labor_rates
    FOR INSERT WITH CHECK (
        shop_id IN (
            SELECT shop_id FROM users WHERE id = auth.uid()
            UNION
            SELECT shop_id FROM shop_staff WHERE auth_id = auth.uid()
        )
    );

CREATE POLICY "Users can update labor rates for their shop" ON labor_rates
    FOR UPDATE USING (
        shop_id IN (
            SELECT shop_id FROM users WHERE id = auth.uid()
            UNION
            SELECT shop_id FROM shop_staff WHERE auth_id = auth.uid()
        )
    );

CREATE POLICY "Users can delete labor rates for their shop" ON labor_rates
    FOR DELETE USING (
        shop_id IN (
            SELECT shop_id FROM users WHERE id = auth.uid()
            UNION
            SELECT shop_id FROM shop_staff WHERE auth_id = auth.uid()
        )
    );

-- Similar RLS policies for services table...
*/

-- =====================================================
-- MIGRATION SCRIPT: Migrate from JSONB to normalized tables (if needed later)
-- =====================================================
/*
-- This would migrate existing data from data.settings JSONB to normalized tables

-- Migrate labor_rates
INSERT INTO labor_rates (shop_id, name, rate, is_default)
SELECT 
    d.shop_id,
    lr->>'name' as name,
    (lr->>'rate')::numeric as rate,
    COALESCE((lr->>'is_default')::boolean, false) as is_default
FROM data d,
     jsonb_array_elements(d.settings->'labor_rates') as lr
WHERE d.settings->'labor_rates' IS NOT NULL
ON CONFLICT (shop_id, name) DO UPDATE SET
    rate = EXCLUDED.rate,
    is_default = EXCLUDED.is_default;

-- Migrate services (after labor_rates exist)
INSERT INTO services (shop_id, name, pricing_type, price, labor_hours, labor_rate_id)
SELECT 
    d.shop_id,
    svc->>'name' as name,
    COALESCE(svc->>'pricing_type', 'flat') as pricing_type,
    COALESCE((svc->>'price')::numeric, 0) as price,
    (svc->>'labor_hours')::numeric as labor_hours,
    lr.id as labor_rate_id
FROM data d,
     jsonb_array_elements(d.settings->'services') as svc
LEFT JOIN labor_rates lr ON lr.shop_id = d.shop_id AND lr.name = svc->>'labor_rate_name'
WHERE d.settings->'services' IS NOT NULL
ON CONFLICT (shop_id, name) DO UPDATE SET
    pricing_type = EXCLUDED.pricing_type,
    price = EXCLUDED.price,
    labor_hours = EXCLUDED.labor_hours,
    labor_rate_id = EXCLUDED.labor_rate_id;
*/

-- =====================================================
-- SUMMARY
-- =====================================================
-- NO SQL CHANGES ARE REQUIRED for the current implementation.
-- The data.settings JSONB column handles the new structure automatically.
--
-- New data structure:
--   settings.labor_rates[] = {
--     name: string,          // e.g., "Standard"
--     rate: number,          // e.g., 125 ($/hr)
--     is_default: boolean    // NEW: first added rate is default
--   }
--
--   settings.services[] = {
--     name: string,          // e.g., "Oil Change"
--     pricing_type: string,  // NEW: 'flat' or 'labor_based'
--     price: number,         // for flat: the price; for labor_based: calculated price
--     labor_hours: number,   // NEW: hours for labor_based services
--     labor_rate_name: string // NEW: which labor rate to use
--   }
