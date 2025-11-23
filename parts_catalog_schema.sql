-- Parts Catalog Schema for Xpose Management
-- Run this in your Supabase SQL Editor

-- 1. PART CATEGORIES TABLE
CREATE TABLE IF NOT EXISTS catalog_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert default categories
INSERT INTO catalog_categories (name, description) VALUES
  ('Brakes', 'Brake pads, rotors, calipers, brake fluid'),
  ('Engine', 'Engine parts, filters, belts, hoses'),
  ('Suspension', 'Shocks, struts, control arms, ball joints'),
  ('Electrical', 'Batteries, alternators, starters, wiring'),
  ('Cooling', 'Radiators, water pumps, thermostats, coolant'),
  ('Exhaust', 'Mufflers, catalytic converters, exhaust pipes'),
  ('Transmission', 'Transmission fluid, filters, clutches'),
  ('Fluids', 'Oil, coolant, brake fluid, power steering fluid'),
  ('Filters', 'Air filters, oil filters, fuel filters, cabin filters'),
  ('Belts & Hoses', 'Serpentine belts, timing belts, radiator hoses'),
  ('Ignition', 'Spark plugs, ignition coils, wires'),
  ('Fuel System', 'Fuel pumps, fuel injectors, fuel filters'),
  ('Steering', 'Power steering pumps, tie rods, rack and pinion'),
  ('Tires & Wheels', 'Tires, wheels, wheel bearings, lug nuts'),
  ('Body & Trim', 'Bumpers, mirrors, lights, trim pieces'),
  ('Interior', 'Seats, carpets, dashboard parts'),
  ('Climate Control', 'AC compressors, heater cores, blower motors'),
  ('Wipers & Lighting', 'Wiper blades, bulbs, headlights, tail lights'),
  ('Tools & Equipment', 'Diagnostic tools, lifts, jacks')
ON CONFLICT (name) DO NOTHING;

-- 2. VEHICLE DATABASE TABLE (for YMM dropdowns)
CREATE TABLE IF NOT EXISTS catalog_vehicles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  year INTEGER NOT NULL,
  make TEXT NOT NULL,
  model TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(year, make, model)
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_catalog_vehicles_year ON catalog_vehicles(year);
CREATE INDEX IF NOT EXISTS idx_catalog_vehicles_make ON catalog_vehicles(make);
CREATE INDEX IF NOT EXISTS idx_catalog_vehicles_model ON catalog_vehicles(model);

-- 3. PARTS CATALOG TABLE
CREATE TABLE IF NOT EXISTS catalog_parts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id UUID REFERENCES catalog_categories(id),
  part_name TEXT NOT NULL,
  part_number TEXT,
  description TEXT,
  year INTEGER,
  make TEXT,
  model TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for searching
CREATE INDEX IF NOT EXISTS idx_catalog_parts_category ON catalog_parts(category_id);
CREATE INDEX IF NOT EXISTS idx_catalog_parts_year ON catalog_parts(year);
CREATE INDEX IF NOT EXISTS idx_catalog_parts_make ON catalog_parts(make);
CREATE INDEX IF NOT EXISTS idx_catalog_parts_model ON catalog_parts(model);
CREATE INDEX IF NOT EXISTS idx_catalog_parts_name ON catalog_parts(part_name);
CREATE INDEX IF NOT EXISTS idx_catalog_parts_number ON catalog_parts(part_number);

-- 4. JOB PARTS TABLE (links parts to jobs)
CREATE TABLE IF NOT EXISTS job_parts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID REFERENCES jobs(id) ON DELETE CASCADE,
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
CREATE INDEX IF NOT EXISTS idx_job_parts_job ON job_parts(job_id);
CREATE INDEX IF NOT EXISTS idx_job_parts_part ON job_parts(part_id);

-- 5. ROW LEVEL SECURITY POLICIES

-- Enable RLS on all catalog tables
ALTER TABLE catalog_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalog_vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalog_parts ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_parts ENABLE ROW LEVEL SECURITY;

-- Catalog Categories - Everyone can read, admins can modify
CREATE POLICY "catalog_categories_read" ON catalog_categories
  FOR SELECT USING (true);

CREATE POLICY "catalog_categories_modify" ON catalog_categories
  FOR ALL USING (
    auth.uid() IN (
      SELECT user_id FROM shop_users WHERE role = 'admin'
    )
  );

-- Catalog Vehicles - Everyone can read, admins can modify
CREATE POLICY "catalog_vehicles_read" ON catalog_vehicles
  FOR SELECT USING (true);

CREATE POLICY "catalog_vehicles_modify" ON catalog_vehicles
  FOR ALL USING (
    auth.uid() IN (
      SELECT user_id FROM shop_users WHERE role = 'admin'
    )
  );

-- Catalog Parts - Everyone can read, authenticated users can add/modify
CREATE POLICY "catalog_parts_read" ON catalog_parts
  FOR SELECT USING (true);

CREATE POLICY "catalog_parts_insert" ON catalog_parts
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "catalog_parts_update" ON catalog_parts
  FOR UPDATE USING (auth.uid() IS NOT NULL);

-- Job Parts - Users can only see/modify parts for jobs they have access to
CREATE POLICY "job_parts_select" ON job_parts
  FOR SELECT USING (
    job_id IN (
      SELECT j.id FROM jobs j
      JOIN shop_users su ON su.shop_id = j.shop_id
      WHERE su.user_id = auth.uid()
    )
  );

CREATE POLICY "job_parts_insert" ON job_parts
  FOR INSERT WITH CHECK (
    job_id IN (
      SELECT j.id FROM jobs j
      JOIN shop_users su ON su.shop_id = j.shop_id
      WHERE su.user_id = auth.uid()
    )
  );

CREATE POLICY "job_parts_update" ON job_parts
  FOR UPDATE USING (
    job_id IN (
      SELECT j.id FROM jobs j
      JOIN shop_users su ON su.shop_id = j.shop_id
      WHERE su.user_id = auth.uid()
    )
  );

CREATE POLICY "job_parts_delete" ON job_parts
  FOR DELETE USING (
    job_id IN (
      SELECT j.id FROM jobs j
      JOIN shop_users su ON su.shop_id = j.shop_id
      WHERE su.user_id = auth.uid()
    )
  );

-- 6. SEED VEHICLE DATA (sample - you'll add more via import)
-- Adding popular makes/models from 1990-2025

DO $$
DECLARE
  y INTEGER;
BEGIN
  -- Popular makes to seed
  FOR y IN 1990..2025 LOOP
    -- Toyota
    INSERT INTO catalog_vehicles (year, make, model) VALUES
      (y, 'Toyota', 'Camry'),
      (y, 'Toyota', 'Corolla'),
      (y, 'Toyota', 'RAV4'),
      (y, 'Toyota', 'Highlander'),
      (y, 'Toyota', 'Tacoma'),
      (y, 'Toyota', 'Tundra')
    ON CONFLICT (year, make, model) DO NOTHING;
    
    -- Honda
    INSERT INTO catalog_vehicles (year, make, model) VALUES
      (y, 'Honda', 'Civic'),
      (y, 'Honda', 'Accord'),
      (y, 'Honda', 'CR-V'),
      (y, 'Honda', 'Pilot'),
      (y, 'Honda', 'Odyssey')
    ON CONFLICT (year, make, model) DO NOTHING;
    
    -- Ford
    INSERT INTO catalog_vehicles (year, make, model) VALUES
      (y, 'Ford', 'F-150'),
      (y, 'Ford', 'Mustang'),
      (y, 'Ford', 'Explorer'),
      (y, 'Ford', 'Escape'),
      (y, 'Ford', 'Focus')
    ON CONFLICT (year, make, model) DO NOTHING;
    
    -- Chevrolet
    INSERT INTO catalog_vehicles (year, make, model) VALUES
      (y, 'Chevrolet', 'Silverado'),
      (y, 'Chevrolet', 'Equinox'),
      (y, 'Chevrolet', 'Malibu'),
      (y, 'Chevrolet', 'Traverse'),
      (y, 'Chevrolet', 'Tahoe')
    ON CONFLICT (year, make, model) DO NOTHING;
    
    -- Nissan
    INSERT INTO catalog_vehicles (year, make, model) VALUES
      (y, 'Nissan', 'Altima'),
      (y, 'Nissan', 'Sentra'),
      (y, 'Nissan', 'Rogue'),
      (y, 'Nissan', 'Pathfinder'),
      (y, 'Nissan', 'Frontier')
    ON CONFLICT (year, make, model) DO NOTHING;
    
    -- BMW
    INSERT INTO catalog_vehicles (year, make, model) VALUES
      (y, 'BMW', '3 Series'),
      (y, 'BMW', '5 Series'),
      (y, 'BMW', 'X3'),
      (y, 'BMW', 'X5')
    ON CONFLICT (year, make, model) DO NOTHING;
    
    -- Mercedes-Benz
    INSERT INTO catalog_vehicles (year, make, model) VALUES
      (y, 'Mercedes-Benz', 'C-Class'),
      (y, 'Mercedes-Benz', 'E-Class'),
      (y, 'Mercedes-Benz', 'GLE'),
      (y, 'Mercedes-Benz', 'GLC')
    ON CONFLICT (year, make, model) DO NOTHING;
  END LOOP;
END $$;

-- 7. SAMPLE PARTS DATA (you'll add real parts over time)
INSERT INTO catalog_parts (category_id, part_name, part_number, description, notes)
SELECT 
  c.id,
  'Sample Brake Pad Set',
  'BP-001',
  'Front brake pads - ceramic',
  'Universal fit - verify vehicle compatibility'
FROM catalog_categories c
WHERE c.name = 'Brakes'
ON CONFLICT DO NOTHING;

INSERT INTO catalog_parts (category_id, part_name, part_number, description, notes)
SELECT 
  c.id,
  'Sample Oil Filter',
  'OF-001',
  'Standard oil filter',
  'Verify size before ordering'
FROM catalog_categories c
WHERE c.name = 'Filters'
ON CONFLICT DO NOTHING;

-- Done!
SELECT 'Parts catalog schema created successfully!' as message;
