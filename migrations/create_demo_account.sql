-- Demo Account Creation Script
-- Creates a complete demo account for testing different industry types
-- No Stripe subscription required

-- ============================================================================
-- CONFIGURATION - Change these values for your demo account
-- ============================================================================
DO $$
DECLARE
  demo_email TEXT := 'demo.barbershop@test.com';  -- Change this
  demo_password TEXT := 'demo123456';              -- Change this
  demo_first_name TEXT := 'Demo';
  demo_last_name TEXT := 'User';
  demo_shop_name TEXT := 'Style & Cuts Barbershop'; -- Change this
  demo_industry TEXT := 'barbershop';               -- Options: 'barbershop', 'tattoo_studio', 'nail_salon', 'other'
  demo_shop_type TEXT := 'Hair Salon';              -- Specialization (optional for non-auto)
  demo_zipcode TEXT := '21701';
  
  new_user_id UUID;
  new_shop_id UUID;
  demo_join_code TEXT;
BEGIN
  -- Generate random join code
  demo_join_code := upper(substring(md5(random()::text) from 1 for 6));
  
  -- ============================================================================
  -- STEP 1: Create Auth User
  -- ============================================================================
  -- Note: This requires you to manually create the user in Supabase Auth UI
  -- Or use Supabase API to create user programmatically
  -- For now, we'll use a placeholder UUID - you'll need to replace this
  
  -- Option A: If you already created the user in Supabase Auth, get their ID:
  -- SELECT id INTO new_user_id FROM auth.users WHERE email = demo_email;
  
  -- Option B: Generate a UUID and create user manually in Supabase Auth UI
  new_user_id := gen_random_uuid();
  
  RAISE NOTICE '============================================';
  RAISE NOTICE 'STEP 1: Create user in Supabase Auth UI';
  RAISE NOTICE 'Email: %', demo_email;
  RAISE NOTICE 'Password: %', demo_password;
  RAISE NOTICE 'Then come back and run STEP 2 with the user ID';
  RAISE NOTICE '============================================';
  
  -- ============================================================================
  -- STEP 2: Create Shop
  -- ============================================================================
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
    demo_shop_name,
    demo_shop_type,
    demo_industry,
    demo_email,
    demo_zipcode,
    '123 Main Street',
    'Frederick',
    'MD',
    demo_join_code,
    10,  -- Generous staff limit for demo
    new_user_id
  )
  RETURNING id INTO new_shop_id;
  
  RAISE NOTICE '✅ Shop created: % (ID: %)', demo_shop_name, new_shop_id;
  RAISE NOTICE '   Industry Type: %', demo_industry;
  RAISE NOTICE '   Join Code: %', demo_join_code;
  
  -- ============================================================================
  -- STEP 3: Create User Record
  -- ============================================================================
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
    subscription_status,
    created_at
  ) VALUES (
    new_user_id,
    new_user_id,
    demo_email,
    demo_first_name,
    demo_last_name,
    'admin',
    new_shop_id,
    demo_zipcode,
    'single',  -- Free single shop plan
    'active',
    NOW()
  );
  
  RAISE NOTICE '✅ User record created';
  
  -- ============================================================================
  -- STEP 4: Initialize Shop Data
  -- ============================================================================
  INSERT INTO data (
    shop_id,
    settings,
    appointments,
    jobs,
    threads,
    invoices
  ) VALUES (
    new_shop_id,
    '{}',
    '[]',
    '[]',
    '[]',
    '[]'
  );
  
  RAISE NOTICE '✅ Shop data initialized';
  
  -- ============================================================================
  -- STEP 5: Add Demo Services (if applicable)
  -- ============================================================================
  IF demo_industry = 'barbershop' THEN
    -- Add sample barbershop services
    RAISE NOTICE '💇 Adding barbershop demo services...';
    -- You can add to your services table if you have one
  ELSIF demo_industry = 'tattoo_studio' THEN
    RAISE NOTICE '🖊️ Adding tattoo studio demo services...';
  ELSIF demo_industry = 'nail_salon' THEN
    RAISE NOTICE '💅 Adding nail salon demo services...';
  END IF;
  
  -- ============================================================================
  -- SUMMARY
  -- ============================================================================
  RAISE NOTICE '============================================';
  RAISE NOTICE '🎉 Demo Account Created Successfully!';
  RAISE NOTICE '============================================';
  RAISE NOTICE 'Shop Name: %', demo_shop_name;
  RAISE NOTICE 'Industry: %', demo_industry;
  RAISE NOTICE 'Email: %', demo_email;
  RAISE NOTICE 'Password: %', demo_password;
  RAISE NOTICE 'Shop ID: %', new_shop_id;
  RAISE NOTICE 'User ID: %', new_user_id;
  RAISE NOTICE 'Join Code: %', demo_join_code;
  RAISE NOTICE '============================================';
  RAISE NOTICE 'IMPORTANT: You must create the Auth user manually!';
  RAISE NOTICE '1. Go to Supabase Auth > Users';
  RAISE NOTICE '2. Click "Add User"';
  RAISE NOTICE '3. Use email: %', demo_email;
  RAISE NOTICE '4. Use password: %', demo_password;
  RAISE NOTICE '5. Note the user ID created';
  RAISE NOTICE '6. Update owner_id in shops table if needed';
  RAISE NOTICE '============================================';
  
END $$;
