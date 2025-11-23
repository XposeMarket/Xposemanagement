-- 4. JOB PARTS TABLE (links parts to jobs)
-- FIXED: Removed foreign key constraint on shop_id (shops table might have TEXT id)
CREATE TABLE IF NOT EXISTS job_parts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id TEXT NOT NULL, -- Changed to TEXT, no foreign key (will match your actual shop_id format)
  job_id TEXT NOT NULL, -- TEXT because your job IDs are text (e.g., "JOB-20231215-001")
  part_id UUID REFERENCES catalog_parts(id),
  part_name TEXT NOT NULL,
  part_number TEXT,
  quantity INTEGER DEFAULT 1,
  cost_price DECIMAL(10,2) DEFAULT 0,
  sell_price DECIMAL(10,2) DEFAULT 0,
  markup_percent DECIMAL(5,2) DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_job_parts_shop ON job_parts(shop_id);
CREATE INDEX IF NOT EXISTS idx_job_parts_job ON job_parts(job_id);
CREATE INDEX IF NOT EXISTS idx_job_parts_part ON job_parts(part_id);
