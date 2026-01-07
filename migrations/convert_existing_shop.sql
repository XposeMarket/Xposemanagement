-- ============================================================================
-- CONVERT EXISTING SHOP TO DIFFERENT INDUSTRY TYPE
-- ============================================================================
-- This will convert one of your existing shops to a different industry type
-- All existing data (jobs, invoices, etc.) will be preserved
-- ============================================================================

-- STEP 1: Find your shop ID
-- Run this to see all your shops:
SELECT id, name, type, industry_type, email 
FROM shops 
ORDER BY created_at DESC;

-- STEP 2: Pick a shop and update its industry type
-- Replace 'YOUR_SHOP_ID_HERE' with the actual shop ID from step 1

-- Convert to Barbershop:
UPDATE shops 
SET industry_type = 'barbershop'
WHERE id = 'YOUR_SHOP_ID_HERE';

-- VERIFY the change:
SELECT id, name, type, industry_type 
FROM shops 
WHERE id = 'YOUR_SHOP_ID_HERE';

-- ============================================================================
-- OTHER INDUSTRY OPTIONS
-- ============================================================================

-- Convert to Tattoo Studio:
-- UPDATE shops SET industry_type = 'tattoo_studio' WHERE id = 'YOUR_SHOP_ID_HERE';

-- Convert to Nail Salon:
-- UPDATE shops SET industry_type = 'nail_salon' WHERE id = 'YOUR_SHOP_ID_HERE';

-- Convert back to Auto Shop:
-- UPDATE shops SET industry_type = 'auto_shop' WHERE id = 'YOUR_SHOP_ID_HERE';

-- Convert to Other:
-- UPDATE shops SET industry_type = 'other' WHERE id = 'YOUR_SHOP_ID_HERE';

-- ============================================================================
-- OPTIONAL: Update shop specialization too
-- ============================================================================
-- For barbershop, you might want to change the 'type' field too:

-- UPDATE shops 
-- SET 
--   industry_type = 'barbershop',
--   type = 'Hair Salon'
-- WHERE id = 'YOUR_SHOP_ID_HERE';

-- For tattoo studio:
-- UPDATE shops 
-- SET 
--   industry_type = 'tattoo_studio',
--   type = 'Custom Tattoos'
-- WHERE id = 'YOUR_SHOP_ID_HERE';

-- For nail salon:
-- UPDATE shops 
-- SET 
--   industry_type = 'nail_salon',
--   type = 'Full Service Salon'
-- WHERE id = 'YOUR_SHOP_ID_HERE';

-- ============================================================================
-- NOTES
-- ============================================================================
-- ✅ This is completely safe - no data is deleted
-- ✅ All your existing jobs, invoices, customers will remain intact
-- ✅ The UI will adapt next time you load the dashboard
-- ✅ You can switch back anytime with another UPDATE
-- ⚠️ Make sure the industry_type column exists (run add_industry_type.sql first)
