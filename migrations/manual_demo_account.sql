-- ============================================================================
-- SUPER SIMPLE DEMO ACCOUNT - COPY & PASTE METHOD
-- ============================================================================
-- Instructions:
-- 1. Create user in Supabase Auth UI (Authentication > Users > Add User)
--    Email: demo.barbershop@test.com
--    Password: Demo123456!
--    Auto Confirm: YES
-- 2. Copy the User ID from the users list
-- 3. Replace 'YOUR_USER_ID_HERE' below with that UUID
-- 4. Run all three INSERT statements
-- ============================================================================

-- ⚠️ REPLACE THIS with your actual user ID from Supabase Auth
\set user_id 'YOUR_USER_ID_HERE'

-- ============================================================================
-- BARBERSHOP DEMO
-- ============================================================================

-- 1. Create the shop
INSERT INTO shops (
  name,
  type,
  industry_type,
  email,
  zipcode,
  street,
  city,
  state,
  join_code,
  staff_limit,
  owner_id
) VALUES (
  'Style & Cuts Barbershop',
  'Hair Salon',
  'barbershop',  -- ⭐ This is the key field!
  'demo.barbershop@test.com',
  '21701',
  '123 Main Street',
  'Frederick',
  'MD',
  'DEMO01',
  10,
  :'user_id'  -- Uses the variable set above
)
RETURNING id, name, industry_type;

-- 2. Get the shop_id from the output above, then create user record
-- Replace SHOP_ID_FROM_ABOVE with the actual ID returned
INSERT INTO users (
  id,
  auth_id,
  email,
  first,
  last,
  role,
  shop_id,
  zipcode,
  subscription_plan,
  subscription_status
) VALUES (
  :'user_id',
  :'user_id',
  'demo.barbershop@test.com',
  'Demo',
  'User',
  'admin',
  'SHOP_ID_FROM_ABOVE',  -- ⚠️ Replace this
  '21701',
  'single',
  'active'
);

-- 3. Initialize shop data (use same shop_id)
INSERT INTO data (
  shop_id,
  settings,
  appointments,
  jobs,
  threads,
  invoices
) VALUES (
  'SHOP_ID_FROM_ABOVE',  -- ⚠️ Replace this
  '{}',
  '[]',
  '[]',
  '[]',
  '[]'
);

-- ============================================================================
-- ALTERNATIVE: If variables don't work, use this manual version:
-- ============================================================================

/*
-- Step 1: Create Shop
INSERT INTO shops (name, type, industry_type, email, zipcode, join_code, staff_limit, owner_id)
VALUES (
  'Style & Cuts Barbershop',
  'Hair Salon', 
  'barbershop',
  'demo.barbershop@test.com',
  '21701',
  'DEMO01',
  10,
  'YOUR_USER_ID_HERE'  -- ⚠️ Paste actual UUID here
);
-- Copy the returned shop ID

-- Step 2: Create User (replace both UUIDs)
INSERT INTO users (id, auth_id, email, first, last, role, shop_id, zipcode, subscription_plan, subscription_status)
VALUES (
  'YOUR_USER_ID_HERE',      -- ⚠️ Same user ID
  'YOUR_USER_ID_HERE',      -- ⚠️ Same user ID
  'demo.barbershop@test.com',
  'Demo',
  'User',
  'admin',
  'YOUR_SHOP_ID_HERE',      -- ⚠️ Shop ID from step 1
  '21701',
  'single',
  'active'
);

-- Step 3: Initialize Data (use shop ID from step 1)
INSERT INTO data (shop_id, settings, appointments, jobs, threads, invoices)
VALUES (
  'YOUR_SHOP_ID_HERE',      -- ⚠️ Shop ID from step 1
  '{}',
  '[]',
  '[]',
  '[]',
  '[]'
);
*/

-- ============================================================================
-- OTHER INDUSTRY EXAMPLES
-- ============================================================================

-- TATTOO STUDIO
/*
INSERT INTO shops (name, type, industry_type, email, zipcode, join_code, staff_limit, owner_id)
VALUES ('Ink Masters Studio', 'Custom Tattoos', 'tattoo_studio', 'demo.tattoo@test.com', '21701', 'DEMO02', 10, 'YOUR_USER_ID');
*/

-- NAIL SALON
/*
INSERT INTO shops (name, type, industry_type, email, zipcode, join_code, staff_limit, owner_id)
VALUES ('Glamour Nails & Spa', 'Full Service', 'nail_salon', 'demo.nails@test.com', '21701', 'DEMO03', 10, 'YOUR_USER_ID');
*/

-- AUTO SHOP (for comparison)
/*
INSERT INTO shops (name, type, industry_type, email, zipcode, join_code, staff_limit, owner_id)
VALUES ('Quick Fix Auto', 'Mechanic', 'auto_shop', 'demo.auto@test.com', '21701', 'DEMO04', 10, 'YOUR_USER_ID');
*/
