-- =============================================
-- XPOSE DIAGNOSTIC + ESTIMATOR SYSTEM - SCHEMA
-- Unified repair intelligence database
-- Run this in Supabase SQL Editor
-- =============================================

-- ===========================================
-- TABLE 1: DIAGNOSTIC PLAYBOOKS
-- ===========================================
CREATE TABLE IF NOT EXISTS public.diagnostic_playbooks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope TEXT NOT NULL DEFAULT 'global' CHECK (scope IN ('global', 'shop')),
  shop_id TEXT,
  title TEXT NOT NULL,
  symptoms TEXT[] DEFAULT '{}',
  dtc_codes TEXT[] DEFAULT '{}',
  vehicle_tags JSONB DEFAULT '{}',
  playbook JSONB NOT NULL DEFAULT '{}',
  confidence NUMERIC(3,2) DEFAULT 0.70,
  requires_oem_reference BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  created_by TEXT,
  version INTEGER DEFAULT 1,
  is_active BOOLEAN DEFAULT true
);

-- Add keywords column if missing
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'diagnostic_playbooks' AND column_name = 'keywords') THEN
    ALTER TABLE public.diagnostic_playbooks ADD COLUMN keywords TEXT[] DEFAULT '{}';
  END IF;
END $$;

-- ===========================================
-- TABLE 2: SERVICE OPERATIONS (NEW)
-- ===========================================
CREATE TABLE IF NOT EXISTS public.service_operations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope TEXT NOT NULL DEFAULT 'global' CHECK (scope IN ('global', 'shop')),
  shop_id TEXT,
  name TEXT NOT NULL,
  category TEXT,
  keywords TEXT[] DEFAULT '{}',
  vehicle_tags JSONB DEFAULT '{}',
  labor_hours_low NUMERIC(4,2),
  labor_hours_typical NUMERIC(4,2),
  labor_hours_high NUMERIC(4,2),
  difficulty TEXT CHECK (difficulty IN ('easy', 'moderate', 'difficult', 'expert')),
  summary TEXT,
  notes TEXT,
  common_variations JSONB DEFAULT '[]',
  checklist_steps JSONB DEFAULT '[]',
  recommended_addons JSONB DEFAULT '[]',
  parts_notes TEXT,
  related_dtc_codes TEXT[] DEFAULT '{}',
  related_symptoms TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  is_active BOOLEAN DEFAULT true
);

-- ===========================================
-- TABLE 3: DIAGNOSTIC REQUESTS
-- ===========================================
CREATE TABLE IF NOT EXISTS public.diagnostic_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id TEXT,
  job_id TEXT,
  appointment_id TEXT,
  search_query TEXT,
  search_type TEXT,
  input_data JSONB DEFAULT '{}',
  result_type TEXT,
  matched_playbook_id UUID,
  matched_operation_id UUID,
  vehicle_year INTEGER,
  vehicle_make TEXT,
  vehicle_model TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Add missing columns to diagnostic_requests if they exist
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'diagnostic_requests' AND column_name = 'search_query') THEN
    ALTER TABLE public.diagnostic_requests ADD COLUMN search_query TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'diagnostic_requests' AND column_name = 'search_type') THEN
    ALTER TABLE public.diagnostic_requests ADD COLUMN search_type TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'diagnostic_requests' AND column_name = 'matched_operation_id') THEN
    ALTER TABLE public.diagnostic_requests ADD COLUMN matched_operation_id UUID;
  END IF;
END $$;

-- ===========================================
-- TABLE 4: FIX OUTCOMES
-- ===========================================
CREATE TABLE IF NOT EXISTS public.diagnostic_fix_outcomes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id TEXT,
  playbook_id UUID,
  job_id TEXT,
  service_name TEXT NOT NULL,
  resolved BOOLEAN DEFAULT true,
  vehicle_year INTEGER,
  vehicle_make TEXT,
  vehicle_model TEXT,
  mileage INTEGER,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Add operation_id column if missing
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'diagnostic_fix_outcomes' AND column_name = 'operation_id') THEN
    ALTER TABLE public.diagnostic_fix_outcomes ADD COLUMN operation_id UUID;
  END IF;
END $$;

-- ===========================================
-- TABLE 5: FEEDBACK
-- ===========================================
CREATE TABLE IF NOT EXISTS public.diagnostic_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id TEXT,
  playbook_id UUID,
  verdict TEXT CHECK (verdict IN ('worked', 'partially_worked', 'did_not_work', 'needs_oem', 'unsafe', 'inaccurate_time')),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Add operation_id column if missing
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'diagnostic_feedback' AND column_name = 'operation_id') THEN
    ALTER TABLE public.diagnostic_feedback ADD COLUMN operation_id UUID;
  END IF;
END $$;

-- ===========================================
-- INDEXES
-- ===========================================
CREATE INDEX IF NOT EXISTS idx_playbooks_dtc ON public.diagnostic_playbooks USING GIN (dtc_codes);
CREATE INDEX IF NOT EXISTS idx_playbooks_symptoms ON public.diagnostic_playbooks USING GIN (symptoms);
CREATE INDEX IF NOT EXISTS idx_playbooks_shop ON public.diagnostic_playbooks (shop_id) WHERE shop_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_operations_keywords ON public.service_operations USING GIN (keywords);
CREATE INDEX IF NOT EXISTS idx_operations_category ON public.service_operations (category);
CREATE INDEX IF NOT EXISTS idx_operations_shop ON public.service_operations (shop_id) WHERE shop_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_requests_shop ON public.diagnostic_requests (shop_id);
CREATE INDEX IF NOT EXISTS idx_outcomes_playbook ON public.diagnostic_fix_outcomes (playbook_id);
CREATE INDEX IF NOT EXISTS idx_outcomes_operation ON public.diagnostic_fix_outcomes (operation_id);

-- Keywords index (may fail if column was just added, that's ok)
DO $$ 
BEGIN
  CREATE INDEX IF NOT EXISTS idx_playbooks_keywords ON public.diagnostic_playbooks USING GIN (keywords);
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- ===========================================
-- ROW LEVEL SECURITY
-- ===========================================
ALTER TABLE public.diagnostic_playbooks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.diagnostic_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.diagnostic_fix_outcomes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.diagnostic_feedback ENABLE ROW LEVEL SECURITY;

-- Drop and recreate policies
DROP POLICY IF EXISTS "Global playbooks readable by all" ON public.diagnostic_playbooks;
DROP POLICY IF EXISTS "Shop playbooks by shop members" ON public.diagnostic_playbooks;
DROP POLICY IF EXISTS "Global operations readable by all" ON public.service_operations;
DROP POLICY IF EXISTS "Shop operations by shop members" ON public.service_operations;
DROP POLICY IF EXISTS "Insert requests authenticated" ON public.diagnostic_requests;
DROP POLICY IF EXISTS "Read own shop requests" ON public.diagnostic_requests;
DROP POLICY IF EXISTS "Insert outcomes authenticated" ON public.diagnostic_fix_outcomes;
DROP POLICY IF EXISTS "Read outcomes" ON public.diagnostic_fix_outcomes;
DROP POLICY IF EXISTS "Insert feedback authenticated" ON public.diagnostic_feedback;
DROP POLICY IF EXISTS "Read feedback" ON public.diagnostic_feedback;

CREATE POLICY "Global playbooks readable by all" ON public.diagnostic_playbooks FOR SELECT USING (scope = 'global');
CREATE POLICY "Shop playbooks by shop members" ON public.diagnostic_playbooks FOR ALL USING (scope = 'shop' AND shop_id = current_setting('app.current_shop_id', true));
CREATE POLICY "Global operations readable by all" ON public.service_operations FOR SELECT USING (scope = 'global');
CREATE POLICY "Shop operations by shop members" ON public.service_operations FOR ALL USING (scope = 'shop' AND shop_id = current_setting('app.current_shop_id', true));
CREATE POLICY "Insert requests authenticated" ON public.diagnostic_requests FOR INSERT WITH CHECK (true);
CREATE POLICY "Read own shop requests" ON public.diagnostic_requests FOR SELECT USING (shop_id = current_setting('app.current_shop_id', true) OR shop_id IS NULL);
CREATE POLICY "Insert outcomes authenticated" ON public.diagnostic_fix_outcomes FOR INSERT WITH CHECK (true);
CREATE POLICY "Read outcomes" ON public.diagnostic_fix_outcomes FOR SELECT USING (true);
CREATE POLICY "Insert feedback authenticated" ON public.diagnostic_feedback FOR INSERT WITH CHECK (true);
CREATE POLICY "Read feedback" ON public.diagnostic_feedback FOR SELECT USING (true);

SELECT 'Schema created/updated successfully' as result;
