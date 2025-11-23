-- Migration: add common shop columns and indexes
-- Run this in your Supabase SQL editor (or via psql) for the project.

-- Add columns if they don't exist (safe to re-run)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'shops' AND column_name = 'email'
  ) THEN
    ALTER TABLE public.shops
      ADD COLUMN email text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'shops' AND column_name = 'phone'
  ) THEN
    ALTER TABLE public.shops
      ADD COLUMN phone text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'shops' AND column_name = 'zipcode'
  ) THEN
    ALTER TABLE public.shops
      ADD COLUMN zipcode text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'shops' AND column_name = 'updated_at'
  ) THEN
    ALTER TABLE public.shops
      ADD COLUMN updated_at timestamptz DEFAULT now();
  END IF;

  -- If logo column was not present in older schemas, ensure it's present (harmless if already exists)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'shops' AND column_name = 'logo'
  ) THEN
    ALTER TABLE public.shops
      ADD COLUMN logo text;
  END IF;
END$$;

-- Create a unique index on lower(join_code) to prevent case-insensitive duplicates (only for non-null join_codes)
-- Using IF NOT EXISTS to avoid error on re-run. Note: some Postgres versions support CREATE INDEX IF NOT EXISTS.
CREATE UNIQUE INDEX IF NOT EXISTS idx_shops_join_code_unique ON public.shops ((lower(join_code))) WHERE join_code IS NOT NULL;

-- Optional: add a small check constraint on staff_limit if column exists
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'shops' AND column_name = 'staff_limit'
  ) THEN
    BEGIN
      -- Add check constraint if not present
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints tc
        JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name
        WHERE tc.table_schema='public' AND tc.table_name='shops' AND tc.constraint_type='CHECK' AND tc.constraint_name='chk_shops_staff_limit_positive'
      ) THEN
        ALTER TABLE public.shops
          ADD CONSTRAINT chk_shops_staff_limit_positive CHECK (staff_limit >= 1);
      END IF;
    EXCEPTION WHEN duplicate_object THEN
      -- ignore
    END;
  END IF;
END$$;

-- Helpful output: select the current columns for shops (run after migration to verify)
-- SELECT column_name, data_type FROM information_schema.columns WHERE table_name='shops' ORDER BY ordinal_position;

-- End of migration
