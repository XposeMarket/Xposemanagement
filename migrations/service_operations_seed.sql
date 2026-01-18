-- =============================================
-- SERVICE OPERATIONS SEED DATA (Labor Guide)
-- Common repair operations with labor times
-- =============================================

-- Delete existing to avoid duplicates
DELETE FROM public.service_operations WHERE scope = 'global';

-- MAINTENANCE / TUNE-UP
INSERT INTO public.service_operations (
  scope, name, category, keywords,
  labor_hours_low, labor_hours_typical, labor_hours_high, difficulty,
  summary, common_variations, checklist_steps, recommended_addons, related_dtc_codes
) VALUES (
  'global',
  'Spark Plug Replacement',
  'maintenance',
  ARRAY['spark plug', 'spark plugs', 'plugs', 'tune up', 'tune-up', 'ignition', 'misfire fix'],
  0.5, 1.0, 2.5,
  'moderate',
  'Replace spark plugs to restore proper ignition. Labor varies significantly based on engine layout - inline 4-cylinders are quickest, V6/V8 with rear-bank access issues take longer.',
  '[
    {"name": "4-cylinder easy access", "hours": 0.5, "note": "Most inline 4-cyl"},
    {"name": "V6 front bank only", "hours": 0.8, "note": "Front 3 plugs accessible"},
    {"name": "V6 rear bank access", "hours": 1.5, "note": "Intake plenum removal may be required"},
    {"name": "V8 with covers", "hours": 2.0, "note": "Coil covers and tight clearance"},
    {"name": "Subaru boxer engine", "hours": 2.5, "note": "Horizontal layout, tight access"}
  ]'::jsonb,
  '[
    {"step": "Disconnect battery negative"},
    {"step": "Remove engine covers if present"},
    {"step": "Disconnect ignition coil connectors"},
    {"step": "Remove ignition coils"},
    {"step": "Remove old spark plugs using proper socket"},
    {"step": "Gap new plugs if not pre-gapped"},
    {"step": "Apply anti-seize to threads (light coat)"},
    {"step": "Install new plugs - torque to spec"},
    {"step": "Reinstall coils and connectors"},
    {"step": "Clear any codes, test drive"}
  ]'::jsonb,
  '[
    {"name": "Ignition Coil Replacement", "labor_hours": 0.3, "reason": "Often fail around same mileage, prevents repeat visit"},
    {"name": "Air Filter Replacement", "labor_hours": 0.2, "reason": "Easy to do while already in area"},
    {"name": "Throttle Body Cleaning", "labor_hours": 0.3, "reason": "Improves idle quality"}
  ]'::jsonb,
  ARRAY['P0300', 'P0301', 'P0302', 'P0303', 'P0304']
);

INSERT INTO public.service_operations (
  scope, name, category, keywords,
  labor_hours_low, labor_hours_typical, labor_hours_high, difficulty,
  summary, checklist_steps, recommended_addons
) VALUES (
  'global',
  'Oil Change',
  'maintenance',
  ARRAY['oil change', 'oil', 'lube', 'oil service', 'synthetic oil'],
  0.3, 0.5, 0.8,
  'easy',
  'Drain and replace engine oil and filter. Standard maintenance service.',
  '[
    {"step": "Lift vehicle safely"},
    {"step": "Position drain pan under oil pan"},
    {"step": "Remove drain plug, allow to fully drain"},
    {"step": "Remove and replace oil filter"},
    {"step": "Reinstall drain plug with new washer"},
    {"step": "Lower vehicle and add correct oil type/quantity"},
    {"step": "Check level, start engine, check for leaks"},
    {"step": "Reset oil life monitor if equipped"}
  ]'::jsonb,
  '[
    {"name": "Air Filter Replacement", "labor_hours": 0.2, "reason": "Quick add-on during service"},
    {"name": "Cabin Air Filter Replacement", "labor_hours": 0.2, "reason": "Easy to replace, often neglected"},
    {"name": "Tire Rotation", "labor_hours": 0.3, "reason": "Should be done every oil change"}
  ]'::jsonb
);

-- BRAKES
INSERT INTO public.service_operations (
  scope, name, category, keywords,
  labor_hours_low, labor_hours_typical, labor_hours_high, difficulty,
  summary, common_variations, checklist_steps, recommended_addons, related_symptoms
) VALUES (
  'global',
  'Brake Pad Replacement - Front',
  'brakes',
  ARRAY['brake pads', 'front brakes', 'brake job', 'pads', 'front brake pads', 'brake squeal fix'],
  0.8, 1.0, 1.5,
  'moderate',
  'Replace front brake pads. Includes inspection of rotors, hardware, and caliper slides.',
  '[
    {"name": "Standard floating caliper", "hours": 1.0, "note": "Most common design"},
    {"name": "Fixed caliper (performance)", "hours": 1.3, "note": "Brembo, etc"},
    {"name": "With rotor replacement", "hours": 1.5, "note": "Add time for rotor R&R"},
    {"name": "Seized caliper slides", "hours": 1.8, "note": "Requires extra cleanup"}
  ]'::jsonb,
  '[
    {"step": "Loosen lug nuts, raise vehicle, remove wheels"},
    {"step": "Inspect rotor condition and thickness"},
    {"step": "Remove caliper bolts, hang caliper safely"},
    {"step": "Remove old pads and hardware"},
    {"step": "Clean and lubricate caliper slides"},
    {"step": "Compress caliper piston (open bleeder if needed)"},
    {"step": "Install new hardware and brake pads"},
    {"step": "Reinstall caliper, torque bolts"},
    {"step": "Reinstall wheels, lower vehicle"},
    {"step": "Pump brake pedal before moving, test drive"}
  ]'::jsonb,
  '[
    {"name": "Brake Rotor Replacement (pair)", "labor_hours": 0.5, "reason": "Often worn or warped, prevents pulsation"},
    {"name": "Brake Fluid Flush", "labor_hours": 0.5, "reason": "Contaminated fluid causes soft pedal"},
    {"name": "Rear Brake Pad Replacement", "labor_hours": 1.0, "reason": "Often wear together, complete service"}
  ]'::jsonb,
  ARRAY['brake_noise', 'brake_squeal', 'grinding_brakes', 'soft_pedal']
);

INSERT INTO public.service_operations (
  scope, name, category, keywords,
  labor_hours_low, labor_hours_typical, labor_hours_high, difficulty,
  summary, checklist_steps, recommended_addons
) VALUES (
  'global',
  'Brake Pad Replacement - Rear',
  'brakes',
  ARRAY['rear brakes', 'rear brake pads', 'back brakes', 'rear pads'],
  0.8, 1.0, 1.5,
  'moderate',
  'Replace rear brake pads. May include drum brakes on some vehicles.',
  '[
    {"step": "Loosen lug nuts, raise vehicle, remove wheels"},
    {"step": "For disc: Remove caliper, inspect rotor"},
    {"step": "For drum: Remove drum, inspect shoes/hardware"},
    {"step": "Clean and lubricate slide pins or adjuster"},
    {"step": "Compress piston (disc) or adjust (drum)"},
    {"step": "Install new pads/shoes and hardware"},
    {"step": "Reassemble, reinstall wheels"},
    {"step": "Pump brake pedal, test parking brake"}
  ]'::jsonb,
  '[
    {"name": "Brake Rotor/Drum Replacement", "labor_hours": 0.5, "reason": "Worn surfaces reduce braking performance"},
    {"name": "Parking Brake Adjustment", "labor_hours": 0.3, "reason": "Often needs adjustment after rear service"}
  ]'::jsonb
);

INSERT INTO public.service_operations (
  scope, name, category, keywords,
  labor_hours_low, labor_hours_typical, labor_hours_high, difficulty,
  summary, notes
) VALUES (
  'global',
  'Brake Rotor Replacement',
  'brakes',
  ARRAY['brake rotor', 'rotors', 'disc', 'brake disc', 'rotor replacement'],
  0.3, 0.5, 0.8,
  'easy',
  'Replace brake rotors. Usually done with pad replacement - time shown is additional time beyond pad job.',
  'Time is per axle (both sides). If doing with pads, add this to pad labor. Some vehicles have hub-mounted rotors requiring more time.'
);

-- ELECTRICAL / STARTING
INSERT INTO public.service_operations (
  scope, name, category, keywords,
  labor_hours_low, labor_hours_typical, labor_hours_high, difficulty,
  summary, common_variations, checklist_steps, recommended_addons, related_symptoms
) VALUES (
  'global',
  'Battery Replacement',
  'electrical',
  ARRAY['battery', 'battery replacement', 'dead battery', 'new battery', 'car battery'],
  0.3, 0.3, 0.5,
  'easy',
  'Replace vehicle battery. Includes terminal cleaning and system test.',
  '[
    {"name": "Top-post standard", "hours": 0.3, "note": "Most common"},
    {"name": "Side-post GM style", "hours": 0.3, "note": "Slightly different terminals"},
    {"name": "Trunk/under seat mount", "hours": 0.5, "note": "BMW, some luxury cars"},
    {"name": "With battery registration", "hours": 0.5, "note": "BMW, Mercedes - requires scan tool"}
  ]'::jsonb,
  '[
    {"step": "Record radio presets and codes if needed"},
    {"step": "Turn off all accessories"},
    {"step": "Disconnect negative terminal first"},
    {"step": "Disconnect positive terminal"},
    {"step": "Remove battery hold-down"},
    {"step": "Remove old battery"},
    {"step": "Clean terminal ends and tray"},
    {"step": "Install new battery"},
    {"step": "Connect positive first, then negative"},
    {"step": "Apply terminal protector"},
    {"step": "Test starting and charging system"}
  ]'::jsonb,
  '[
    {"name": "Battery Terminal Cleaning", "labor_hours": 0.2, "reason": "Ensures good connection"},
    {"name": "Charging System Test", "labor_hours": 0.3, "reason": "Verify alternator is working"}
  ]'::jsonb,
  ARRAY['no_start', 'dead_battery', 'battery_drain', 'no_crank']
);

INSERT INTO public.service_operations (
  scope, name, category, keywords,
  labor_hours_low, labor_hours_typical, labor_hours_high, difficulty,
  summary, common_variations, related_dtc_codes, related_symptoms
) VALUES (
  'global',
  'Starter Replacement',
  'electrical',
  ARRAY['starter', 'starter motor', 'starter replacement', 'no crank fix', 'starting motor'],
  0.8, 1.2, 2.5,
  'moderate',
  'Replace starter motor. Location varies significantly - some are very accessible, others require component removal.',
  '[
    {"name": "Top-mount accessible", "hours": 0.8, "note": "Easy access from above"},
    {"name": "Bottom-mount standard", "hours": 1.2, "note": "Most common, from below"},
    {"name": "Behind intake/exhaust", "hours": 2.0, "note": "Requires manifold removal"},
    {"name": "Transverse V6 rear", "hours": 2.5, "note": "Very limited access"}
  ]'::jsonb,
  ARRAY['P0615', 'P0616', 'P0617'],
  ARRAY['no_crank', 'no_start', 'click_no_start']
);

INSERT INTO public.service_operations (
  scope, name, category, keywords,
  labor_hours_low, labor_hours_typical, labor_hours_high, difficulty,
  summary, common_variations, recommended_addons, related_symptoms
) VALUES (
  'global',
  'Alternator Replacement',
  'electrical',
  ARRAY['alternator', 'charging system', 'alternator replacement', 'not charging', 'battery light'],
  0.8, 1.2, 2.0,
  'moderate',
  'Replace alternator. Includes belt inspection and charging system test.',
  '[
    {"name": "Top-mount accessible", "hours": 0.8, "note": "Easy belt access"},
    {"name": "Standard with tensioner", "hours": 1.2, "note": "Most common"},
    {"name": "Behind A/C compressor", "hours": 1.8, "note": "Requires compressor movement"},
    {"name": "Lower mount tight", "hours": 2.0, "note": "From below, limited space"}
  ]'::jsonb,
  '[
    {"name": "Serpentine Belt Replacement", "labor_hours": 0.3, "reason": "Often worn, easy while apart"},
    {"name": "Battery Test/Replacement", "labor_hours": 0.3, "reason": "May have been damaged by charging issues"}
  ]'::jsonb,
  ARRAY['battery_drain', 'battery_light', 'dead_battery']
);

-- COOLING SYSTEM
INSERT INTO public.service_operations (
  scope, name, category, keywords,
  labor_hours_low, labor_hours_typical, labor_hours_high, difficulty,
  summary, checklist_steps, recommended_addons, related_dtc_codes
) VALUES (
  'global',
  'Thermostat Replacement',
  'cooling',
  ARRAY['thermostat', 'overheating fix', 'coolant thermostat', 'running cold'],
  0.8, 1.0, 1.5,
  'moderate',
  'Replace engine thermostat. Includes coolant drain and refill, bleeding air from system.',
  '[
    {"step": "Allow engine to cool completely"},
    {"step": "Drain coolant below thermostat level"},
    {"step": "Remove thermostat housing"},
    {"step": "Note orientation of old thermostat"},
    {"step": "Clean housing surfaces"},
    {"step": "Install new thermostat with new gasket/O-ring"},
    {"step": "Reinstall housing, torque to spec"},
    {"step": "Refill coolant system"},
    {"step": "Bleed air from system"},
    {"step": "Run engine, check for leaks, verify temp"}
  ]'::jsonb,
  '[
    {"name": "Coolant Flush", "labor_hours": 0.5, "reason": "Contaminated coolant can clog new thermostat"},
    {"name": "Radiator Hose Replacement", "labor_hours": 0.5, "reason": "Often brittle if thermostat failed from age"}
  ]'::jsonb,
  ARRAY['P0128', 'P0125', 'P0126']
);

INSERT INTO public.service_operations (
  scope, name, category, keywords,
  labor_hours_low, labor_hours_typical, labor_hours_high, difficulty,
  summary, checklist_steps
) VALUES (
  'global',
  'Coolant Flush',
  'cooling',
  ARRAY['coolant flush', 'radiator flush', 'antifreeze', 'cooling system flush', 'coolant change'],
  0.8, 1.0, 1.5,
  'easy',
  'Drain and refill cooling system with fresh coolant. Includes bleeding air from system.',
  '[
    {"step": "Allow engine to cool"},
    {"step": "Remove radiator cap/reservoir cap"},
    {"step": "Open radiator drain or remove lower hose"},
    {"step": "Flush with water if heavily contaminated"},
    {"step": "Close drain, fill with correct coolant mix"},
    {"step": "Run engine with heater on to circulate"},
    {"step": "Bleed air from system (use bleeder if equipped)"},
    {"step": "Top off coolant, install cap"},
    {"step": "Check for leaks, verify temp gauge"}
  ]'::jsonb
);

INSERT INTO public.service_operations (
  scope, name, category, keywords,
  labor_hours_low, labor_hours_typical, labor_hours_high, difficulty,
  summary, common_variations, recommended_addons, related_symptoms
) VALUES (
  'global',
  'Water Pump Replacement',
  'cooling',
  ARRAY['water pump', 'coolant pump', 'water pump replacement', 'overheating fix', 'coolant leak fix'],
  1.5, 2.5, 4.0,
  'difficult',
  'Replace water pump. Major repair - often done with timing belt if timing-belt driven.',
  '[
    {"name": "External serpentine driven", "hours": 1.5, "note": "Accessible, standard job"},
    {"name": "External with tight access", "hours": 2.5, "note": "Limited space"},
    {"name": "Timing belt driven", "hours": 3.5, "note": "Requires timing belt removal - do both"},
    {"name": "Internal/timing chain area", "hours": 4.0, "note": "Major disassembly required"}
  ]'::jsonb,
  '[
    {"name": "Timing Belt Replacement", "labor_hours": 1.0, "reason": "If timing belt driven, replace together"},
    {"name": "Coolant Flush", "labor_hours": 0.5, "reason": "Fresh coolant after major repair"},
    {"name": "Thermostat Replacement", "labor_hours": 0.3, "reason": "Easy to do while system is open"}
  ]'::jsonb,
  ARRAY['overheating', 'coolant_leak']
);

-- HVAC
INSERT INTO public.service_operations (
  scope, name, category, keywords,
  labor_hours_low, labor_hours_typical, labor_hours_high, difficulty,
  summary, checklist_steps, recommended_addons, related_symptoms
) VALUES (
  'global',
  'AC Recharge',
  'hvac',
  ARRAY['ac recharge', 'freon', 'refrigerant', 'ac charge', 'ac service', 'air conditioning'],
  0.5, 0.5, 1.0,
  'easy',
  'Evacuate and recharge AC system with refrigerant. Includes leak check with dye.',
  '[
    {"step": "Connect AC machine to service ports"},
    {"step": "Recover existing refrigerant"},
    {"step": "Pull vacuum on system (20+ minutes)"},
    {"step": "Check vacuum holds (leak test)"},
    {"step": "Add UV dye if not present"},
    {"step": "Charge system to spec weight"},
    {"step": "Add PAG oil if needed"},
    {"step": "Check vent temps and pressures"},
    {"step": "Scan for AC-related codes"}
  ]'::jsonb,
  '[
    {"name": "Cabin Air Filter Replacement", "labor_hours": 0.2, "reason": "Restricted filter reduces airflow"},
    {"name": "AC Leak Detection", "labor_hours": 0.5, "reason": "If system was low, there is a leak"}
  ]'::jsonb,
  ARRAY['ac_not_cold', 'ac_warm']
);

INSERT INTO public.service_operations (
  scope, name, category, keywords,
  labor_hours_low, labor_hours_typical, labor_hours_high, difficulty,
  summary, common_variations, recommended_addons, related_symptoms
) VALUES (
  'global',
  'AC Compressor Replacement',
  'hvac',
  ARRAY['ac compressor', 'compressor replacement', 'ac compressor clutch', 'ac not working'],
  2.0, 2.5, 4.0,
  'difficult',
  'Replace AC compressor. Includes system flush, new receiver/drier, and recharge.',
  '[
    {"name": "Good access standard", "hours": 2.0, "note": "Typical transverse 4-cyl"},
    {"name": "Limited access", "hours": 2.5, "note": "Most applications"},
    {"name": "Rear-mount or buried", "hours": 3.5, "note": "Significant disassembly"},
    {"name": "With condenser replacement", "hours": 4.0, "note": "Full system rebuild"}
  ]'::jsonb,
  '[
    {"name": "Receiver/Drier Replacement", "labor_hours": 0.5, "reason": "Required when opening system"},
    {"name": "AC System Flush", "labor_hours": 0.5, "reason": "Remove debris from failed compressor"},
    {"name": "Expansion Valve Replacement", "labor_hours": 0.5, "reason": "Often contaminated if compressor failed"}
  ]'::jsonb,
  ARRAY['ac_not_cold', 'ac_noise']
);

-- SUSPENSION
INSERT INTO public.service_operations (
  scope, name, category, keywords,
  labor_hours_low, labor_hours_typical, labor_hours_high, difficulty,
  summary, notes, recommended_addons
) VALUES (
  'global',
  'Strut Replacement - Front (Pair)',
  'suspension',
  ARRAY['struts', 'front struts', 'shocks', 'strut replacement', 'bouncy ride', 'front suspension'],
  1.5, 2.0, 3.0,
  'moderate',
  'Replace front strut assemblies. Price assumes complete assemblies (strut + spring + mount). Alignment required after.',
  'Labor shown is for pair. Using quick-strut assemblies (pre-assembled) saves significant time vs replacing just strut cartridge.',
  '[
    {"name": "Wheel Alignment", "labor_hours": 1.0, "reason": "Required after strut replacement"},
    {"name": "Sway Bar Link Replacement", "labor_hours": 0.5, "reason": "Often worn, easy to replace while apart"}
  ]'::jsonb
);

INSERT INTO public.service_operations (
  scope, name, category, keywords,
  labor_hours_low, labor_hours_typical, labor_hours_high, difficulty,
  summary
) VALUES (
  'global',
  'Wheel Alignment',
  'suspension',
  ARRAY['alignment', 'wheel alignment', 'front end alignment', 'tire wear', 'pulling'],
  0.8, 1.0, 1.5,
  'moderate',
  'Adjust wheel alignment angles to manufacturer specifications. Includes printout of before/after measurements.'
);

-- ENGINE
INSERT INTO public.service_operations (
  scope, name, category, keywords,
  labor_hours_low, labor_hours_typical, labor_hours_high, difficulty,
  summary, common_variations, related_dtc_codes
) VALUES (
  'global',
  'Ignition Coil Replacement',
  'engine',
  ARRAY['ignition coil', 'coil pack', 'coil replacement', 'misfire fix', 'coil on plug'],
  0.3, 0.5, 1.0,
  'easy',
  'Replace ignition coil(s). Time shown is per coil for coil-on-plug systems.',
  '[
    {"name": "Single coil easy access", "hours": 0.3, "note": "Per coil"},
    {"name": "All coils (4-cyl)", "hours": 0.8, "note": "Discount for doing all 4"},
    {"name": "All coils (V6)", "hours": 1.2, "note": "Including rear bank"},
    {"name": "Coil pack (waste spark)", "hours": 0.5, "note": "Single unit for all cylinders"}
  ]'::jsonb,
  ARRAY['P0300', 'P0301', 'P0302', 'P0351', 'P0352']
);

INSERT INTO public.service_operations (
  scope, name, category, keywords,
  labor_hours_low, labor_hours_typical, labor_hours_high, difficulty,
  summary, common_variations, related_dtc_codes
) VALUES (
  'global',
  'Oxygen Sensor Replacement',
  'engine',
  ARRAY['o2 sensor', 'oxygen sensor', 'o2', 'lambda sensor', 'upstream o2', 'downstream o2'],
  0.3, 0.5, 1.0,
  'easy',
  'Replace oxygen sensor. Location affects labor - upstream sensors typically easier than downstream.',
  '[
    {"name": "Upstream accessible", "hours": 0.3, "note": "Before catalytic converter"},
    {"name": "Downstream accessible", "hours": 0.5, "note": "After cat, from below"},
    {"name": "Difficult access", "hours": 0.8, "note": "Manifold-mounted or tight space"},
    {"name": "Multiple sensors (bank 1+2)", "hours": 1.0, "note": "Both upstream sensors"}
  ]'::jsonb,
  ARRAY['P0130', 'P0131', 'P0133', 'P0134', 'P0136', 'P0137', 'P0140', 'P0141']
);

-- AIR FILTER
INSERT INTO public.service_operations (
  scope, name, category, keywords,
  labor_hours_low, labor_hours_typical, labor_hours_high, difficulty,
  summary
) VALUES (
  'global',
  'Air Filter Replacement',
  'maintenance',
  ARRAY['air filter', 'engine air filter', 'air cleaner'],
  0.1, 0.2, 0.3,
  'easy',
  'Replace engine air filter element. Simple maintenance item.'
);

INSERT INTO public.service_operations (
  scope, name, category, keywords,
  labor_hours_low, labor_hours_typical, labor_hours_high, difficulty,
  summary, common_variations
) VALUES (
  'global',
  'Cabin Air Filter Replacement',
  'maintenance',
  ARRAY['cabin filter', 'cabin air filter', 'hvac filter', 'ac filter'],
  0.1, 0.2, 0.5,
  'easy',
  'Replace cabin air filter (HVAC filter). Improves air quality and HVAC performance.',
  '[
    {"name": "Behind glove box (easy)", "hours": 0.1, "note": "Most common"},
    {"name": "Under dash (moderate)", "hours": 0.3, "note": "Some European cars"},
    {"name": "Under hood/cowl", "hours": 0.5, "note": "Requires wiper cowl removal"}
  ]'::jsonb
);

SELECT 'Service operations seed data inserted. Total: ' || COUNT(*) as result FROM public.service_operations;
