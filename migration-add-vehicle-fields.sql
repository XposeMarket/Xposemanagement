-- Migration: add vehicle fields to customers table
-- Run this in your Supabase SQL editor for the project.

DO $$
BEGIN
  -- Add vehicle_year column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'customers' AND column_name = 'vehicle_year'
  ) THEN
    ALTER TABLE public.customers ADD COLUMN vehicle_year text DEFAULT '';
  END IF;

  -- Add vehicle_make column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'customers' AND column_name = 'vehicle_make'
  ) THEN
    ALTER TABLE public.customers ADD COLUMN vehicle_make text DEFAULT '';
  END IF;

  -- Add vehicle_model column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'customers' AND column_name = 'vehicle_model'
  ) THEN
    ALTER TABLE public.customers ADD COLUMN vehicle_model text DEFAULT '';
  END IF;
END $$;