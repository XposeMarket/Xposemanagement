-- =============================================
-- VEHICLE LABOR CACHE TABLE
-- Stores AI-researched labor times for vehicle-specific lookups
-- Enables global caching across all shops
-- =============================================

-- Create the cache table
CREATE TABLE IF NOT EXISTS public.vehicle_labor_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Cache Key (unique combination)
  operation_id UUID NOT NULL,
  vehicle_year INTEGER NOT NULL,
  vehicle_make TEXT NOT NULL,
  vehicle_model TEXT NOT NULL,
  engine_type TEXT NOT NULL DEFAULT 'all',
  
  -- AI-Researched Labor Hours
  ai_labor_hours_low NUMERIC(4,2),
  ai_labor_hours_typical NUMERIC(4,2),
  ai_labor_hours_high NUMERIC(4,2),
  ai_labor_confidence TEXT CHECK (ai_labor_confidence IN ('high', 'medium', 'low')),
  ai_labor_notes TEXT,
  
  -- Metadata from AI research
  sources TEXT[] DEFAULT '{}',
  required_tools TEXT[] DEFAULT '{}',
  vehicle_specific_tips TEXT[] DEFAULT '{}',
  is_most_common BOOLEAN DEFAULT false,
  
  -- Cache management
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  last_accessed_at TIMESTAMPTZ DEFAULT now(),
  hit_count INTEGER DEFAULT 0,
  
  -- Unique constraint for cache key
  CONSTRAINT vehicle_labor_cache_unique_key 
    UNIQUE (operation_id, vehicle_year, vehicle_make, vehicle_model, engine_type)
);

-- Add foreign key reference to service_operations (optional, may fail if table doesn't exist yet)
DO $$
BEGIN
  ALTER TABLE public.vehicle_labor_cache 
    ADD CONSTRAINT vehicle_labor_cache_operation_fk 
    FOREIGN KEY (operation_id) REFERENCES public.service_operations(id) ON DELETE CASCADE;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Foreign key constraint skipped (service_operations table may not exist)';
END $$;

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_labor_cache_lookup 
  ON public.vehicle_labor_cache(operation_id, vehicle_year, vehicle_make, vehicle_model);

CREATE INDEX IF NOT EXISTS idx_labor_cache_vehicle 
  ON public.vehicle_labor_cache(vehicle_year, vehicle_make, vehicle_model);

CREATE INDEX IF NOT EXISTS idx_labor_cache_operation 
  ON public.vehicle_labor_cache(operation_id);

CREATE INDEX IF NOT EXISTS idx_labor_cache_hit_count 
  ON public.vehicle_labor_cache(hit_count DESC);

-- Row Level Security
ALTER TABLE public.vehicle_labor_cache ENABLE ROW LEVEL SECURITY;

-- Everyone can read cache (it's global data)
DROP POLICY IF EXISTS "Anyone can read vehicle labor cache" ON public.vehicle_labor_cache;
CREATE POLICY "Anyone can read vehicle labor cache" 
  ON public.vehicle_labor_cache 
  FOR SELECT 
  USING (true);

-- Service role can write to cache (API uses service key)
DROP POLICY IF EXISTS "Service role can write vehicle labor cache" ON public.vehicle_labor_cache;
CREATE POLICY "Service role can write vehicle labor cache" 
  ON public.vehicle_labor_cache 
  FOR ALL 
  USING (true)
  WITH CHECK (true);

-- Function to clean old/unused cache entries (optional maintenance)
CREATE OR REPLACE FUNCTION clean_old_labor_cache()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  -- Delete entries not accessed in 90 days with 0 hits
  DELETE FROM public.vehicle_labor_cache
  WHERE last_accessed_at < NOW() - INTERVAL '90 days'
    AND hit_count = 0;
  
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Grant permissions
GRANT SELECT ON public.vehicle_labor_cache TO anon, authenticated;
GRANT ALL ON public.vehicle_labor_cache TO service_role;

SELECT 'vehicle_labor_cache table created successfully' as result;
