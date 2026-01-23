-- =============================================
-- FIX DIAGNOSTIC FEEDBACK & OUTCOMES TABLES
-- Run this in Supabase SQL Editor
-- =============================================

-- 1. Fix diagnostic_feedback table - allow null playbook_id for operation feedback
ALTER TABLE public.diagnostic_feedback 
  ALTER COLUMN playbook_id DROP NOT NULL;

-- 2. Add notes column to diagnostic_fix_outcomes if missing
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'diagnostic_fix_outcomes' 
    AND column_name = 'notes'
  ) THEN
    ALTER TABLE public.diagnostic_fix_outcomes ADD COLUMN notes TEXT;
  END IF;
END $$;

-- Verify changes
SELECT 'diagnostic_feedback columns:' as info;
SELECT column_name, is_nullable, data_type 
FROM information_schema.columns 
WHERE table_schema = 'public' AND table_name = 'diagnostic_feedback'
ORDER BY ordinal_position;

SELECT 'diagnostic_fix_outcomes columns:' as info;
SELECT column_name, is_nullable, data_type 
FROM information_schema.columns 
WHERE table_schema = 'public' AND table_name = 'diagnostic_fix_outcomes'
ORDER BY ordinal_position;

SELECT 'Schema fixes applied successfully!' as result;
