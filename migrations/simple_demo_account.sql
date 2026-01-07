-- ============================================================================
-- SIMPLE DEMO ACCOUNT CREATOR
-- Create demo accounts for different industry types without Stripe
-- ============================================================================

-- STEP 1: First create the user in Supabase Auth UI
-- Go to: Authentication > Users > Add User
-- Email: demo.barbershop@test.com
-- Password: Demo123456!
-- Auto Confirm: YES
-- After creating, copy the User ID from the list

-- STEP 2: Replace USER_ID_HERE with the actual UUID from Step 1
-- Then run this entire script

-- ============================================================================
-- CONFIGURATION
-- ============================================================================
DO $$
DECLARE
  -- PASTE YOUR USER ID HERE (from Supabase Auth UI)
  v_user_id UUID := 'USER_ID_HERE'; -- ⚠️ REPLACE THIS!
  
  -- Demo account settings
  v_email TEXT := 'demo.barbershop@test.com';
  v_shop_name TEXT := 'Style & Cuts Barbershop';
  v_industry TEXT := 'barbershop'; -- Options: barbershop, tattoo_studio, nail_salon, other
  v_shop_type TEXT := 'Hair Salon';
  
  -- Generated values
  v_shop_id UUID;
  v_join_code TEXT;
BEGIN
  -- Validate user ID is not placeholder
  IF v_user_id = 'USER_ID_HERE' THEN
    RAISE EXCEPTION 'ERROR: You must replace USER_ID_HERE with actual user ID from Supabase Auth!';
  END IF;

  -- Generate join code
  v_join_code := upper(substring(md5(random()::text) from 1 for 6));

  -- Create Shop
  INSERT INTO shops (
    name, type, industry_type, email, zipcode, street, city, state,
    join_code, staff_limit, owner_id
  ) VALUES (
    v_shop_name, v_shop_type, v_industry, v_email, '21701',
    '123 Main St', 'Frederick', 'MD', v_join_code, 10, v_user_id
  ) RETURNING id INTO v_shop_id;

  -- Create User Record
  INSERT INTO users (
    id, auth_id, email, first, last, role, shop_id, zipcode,
    subscription_plan, subscription_status
  ) VALUES (
    v_user_id, v_user_id, v_email, 'Demo', 'User', 'admin',
    v_shop_id, '21701', 'single', 'active'
  );

  -- Initialize Data
  INSERT INTO data (shop_id, settings, appointments, jobs, threads, invoices)
  VALUES (v_shop_id, '{}', '[]', '[]', '[]', '[]');

  -- Success message
  RAISE NOTICE '✅ Demo account created!';
  RAISE NOTICE 'Email: %', v_email;
  RAISE NOTICE 'Shop: % (%)', v_shop_name, v_industry;
  RAISE NOTICE 'Shop ID: %', v_shop_id;
  RAISE NOTICE 'Join Code: %', v_join_code;
END $$;
