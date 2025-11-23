-- Sample Parts for Testing
-- Run this in Supabase SQL Editor to add common parts

-- Add brake parts for Honda Civic (2010)
INSERT INTO catalog_parts (category_id, part_name, part_number, description, year, make, model, notes)
SELECT 
  c.id,
  'Front Brake Pads - Ceramic',
  'BP-CIVIC-F-10',
  'High-performance ceramic brake pads for front axle',
  2010,
  'Honda',
  'Civic',
  'OEM quality, low dust'
FROM catalog_categories c
WHERE c.name = 'Brakes';

INSERT INTO catalog_parts (category_id, part_name, part_number, description, year, make, model, notes)
SELECT 
  c.id,
  'Rear Brake Pads - Ceramic',
  'BP-CIVIC-R-10',
  'High-performance ceramic brake pads for rear axle',
  2010,
  'Honda',
  'Civic',
  'OEM quality, low dust'
FROM catalog_categories c
WHERE c.name = 'Brakes';

INSERT INTO catalog_parts (category_id, part_name, part_number, description, year, make, model, notes)
SELECT 
  c.id,
  'Front Brake Rotors (Pair)',
  'BR-CIVIC-F-10',
  'Vented front brake rotors, set of 2',
  2010,
  'Honda',
  'Civic',
  'Replace with pads for best performance'
FROM catalog_categories c
WHERE c.name = 'Brakes';

-- Add engine parts
INSERT INTO catalog_parts (category_id, part_name, part_number, description, year, make, model, notes)
SELECT 
  c.id,
  'Oil Filter',
  'OF-CIVIC-10',
  'Standard oil filter for 1.8L engine',
  2010,
  'Honda',
  'Civic',
  'Change every 5,000 miles'
FROM catalog_categories c
WHERE c.name = 'Filters';

INSERT INTO catalog_parts (category_id, part_name, part_number, description, year, make, model, notes)
SELECT 
  c.id,
  'Air Filter',
  'AF-CIVIC-10',
  'Engine air filter',
  2010,
  'Honda',
  'Civic',
  'Replace every 15,000 miles'
FROM catalog_categories c
WHERE c.name = 'Filters';

INSERT INTO catalog_parts (category_id, part_name, part_number, description, year, make, model, notes)
SELECT 
  c.id,
  'Cabin Air Filter',
  'CAF-CIVIC-10',
  'HVAC cabin air filter',
  2010,
  'Honda',
  'Civic',
  'Replace annually'
FROM catalog_categories c
WHERE c.name = 'Filters';

INSERT INTO catalog_parts (category_id, part_name, part_number, description, year, make, model, notes)
SELECT 
  c.id,
  'Spark Plugs (Set of 4)',
  'SP-CIVIC-10',
  'Iridium spark plugs',
  2010,
  'Honda',
  'Civic',
  'NGK or Denso recommended'
FROM catalog_categories c
WHERE c.name = 'Ignition';

-- Add fluids
INSERT INTO catalog_parts (category_id, part_name, part_number, description, year, make, model, notes)
SELECT 
  c.id,
  'Engine Oil 5W-30 (5 Quarts)',
  'OIL-5W30-5Q',
  'Synthetic blend 5W-30 motor oil',
  2010,
  'Honda',
  'Civic',
  'Use Honda-approved oil'
FROM catalog_categories c
WHERE c.name = 'Fluids';

INSERT INTO catalog_parts (category_id, part_name, part_number, description, year, make, model, notes)
SELECT 
  c.id,
  'Coolant/Antifreeze (1 Gallon)',
  'COOLANT-HONDA',
  'Pre-mixed Honda coolant',
  2010,
  'Honda',
  'Civic',
  'Honda Type 2 coolant'
FROM catalog_categories c
WHERE c.name = 'Fluids';

-- Add belts
INSERT INTO catalog_parts (category_id, part_name, part_number, description, year, make, model, notes)
SELECT 
  c.id,
  'Serpentine Belt',
  'BELT-CIVIC-10',
  'Accessory drive belt',
  2010,
  'Honda',
  'Civic',
  'Inspect for cracks regularly'
FROM catalog_categories c
WHERE c.name = 'Belts & Hoses';

-- Add wiper blades
INSERT INTO catalog_parts (category_id, part_name, part_number, description, year, make, model, notes)
SELECT 
  c.id,
  'Wiper Blades (Pair)',
  'WB-CIVIC-10',
  'Front windshield wiper blades',
  2010,
  'Honda',
  'Civic',
  '26" driver, 19" passenger'
FROM catalog_categories c
WHERE c.name = 'Wipers & Lighting';

-- Add universal parts (no specific year/make/model)
INSERT INTO catalog_parts (category_id, part_name, part_number, description, notes)
SELECT 
  c.id,
  'Brake Fluid DOT 3 (12oz)',
  'BF-DOT3-12',
  'DOT 3 brake fluid',
  'Universal - check vehicle specs'
FROM catalog_categories c
WHERE c.name = 'Fluids';

INSERT INTO catalog_parts (category_id, part_name, part_number, description, notes)
SELECT 
  c.id,
  'Windshield Washer Fluid (1 Gallon)',
  'WWF-1GAL',
  'All-season washer fluid',
  'Universal'
FROM catalog_categories c
WHERE c.name = 'Fluids';

-- Success message
SELECT 'Successfully added 15+ sample parts for 2010 Honda Civic!' as message;
