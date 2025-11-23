-- ============================================
-- CRM Database Migration Script
-- Adds auth_id column and updates schema
-- Run this in Supabase SQL Editor
-- ============================================

-- Step 1: Add auth_id column to users table if it doesn't exist
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 
    FROM information_schema.columns 
    WHERE table_schema = 'public' 
      AND table_name = 'users' 
      AND column_name = 'auth_id'
  ) THEN
    ALTER TABLE public.users ADD COLUMN auth_id uuid;
    RAISE NOTICE 'Added auth_id column to users table';
  ELSE
    RAISE NOTICE 'auth_id column already exists';
  END IF;
END $$;

-- Step 2: Update existing users to populate auth_id from id
-- (Only if you have existing user records)
UPDATE public.users 
SET auth_id = id 
WHERE auth_id IS NULL;

-- Step 3: Make auth_id NOT NULL and UNIQUE after populating
ALTER TABLE public.users 
  ALTER COLUMN auth_id SET NOT NULL;

-- Add unique constraint if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 
    FROM pg_constraint 
    WHERE conname = 'users_auth_id_key'
  ) THEN
    ALTER TABLE public.users ADD CONSTRAINT users_auth_id_key UNIQUE (auth_id);
    RAISE NOTICE 'Added unique constraint on auth_id';
  ELSE
    RAISE NOTICE 'Unique constraint already exists';
  END IF;
END $$;

-- Step 4: Add performance indexes
CREATE INDEX IF NOT EXISTS idx_users_auth_id ON public.users(auth_id);
CREATE INDEX IF NOT EXISTS idx_users_shop_id ON public.users(shop_id);
CREATE INDEX IF NOT EXISTS idx_users_email ON public.users(email);

-- Step 5: Verify the changes
SELECT 
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_schema = 'public' 
  AND table_name = 'users'
ORDER BY ordinal_position;

-- Step 6: Show current users (if any)
SELECT 
  id,
  auth_id,
  email,
  first,
  last,
  role,
  shop_id,
  created_at
FROM public.users
ORDER BY created_at DESC
LIMIT 5;

-- Step 7: Show current shops (if any)
SELECT 
  id,
  name,
  type,
  join_code,
  staff_limit,
  created_at
FROM public.shops
ORDER BY created_at DESC
LIMIT 5;

-- ============================================
-- Verification Queries
-- ============================================

-- Check for users without shop_id (these may need manual fixing)
SELECT 
  email,
  first,
  last,
  role,
  shop_id,
  'Missing shop_id' as issue
FROM public.users
WHERE shop_id IS NULL;

-- Check for orphaned users (shop_id doesn't exist in shops table)
SELECT 
  u.email,
  u.first,
  u.last,
  u.shop_id,
  'Orphaned - shop does not exist' as issue
FROM public.users u
LEFT JOIN public.shops s ON u.shop_id = s.id
WHERE u.shop_id IS NOT NULL 
  AND s.id IS NULL;

RAISE NOTICE 'Migration complete! Review the results above.';
