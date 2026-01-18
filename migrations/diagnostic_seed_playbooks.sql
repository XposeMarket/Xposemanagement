-- =============================================
-- XPOSE DIAGNOSTIC SYSTEM - SEED DATA
-- Run this AFTER running the schema migration
-- =============================================

-- Insert seed playbooks for common DTCs and symptoms
-- These are generic playbooks that will work for most vehicles

-- P0300 - Random/Multiple Cylinder Misfire
INSERT INTO public.diagnostic_playbooks (
  scope, shop_id, title, symptoms, dtc_codes, vehicle_tags, playbook, confidence, requires_oem_reference
) VALUES (
  'global', NULL,
  'P0300 - Random/Multiple Cylinder Misfire Detected',
  ARRAY['rough idle', 'misfire', 'hesitation', 'shaking', 'CEL flashing', 'check engine flashing'],
  ARRAY['P0300'],
  '{"make": null, "model": null, "year_from": null, "year_to": null}'::jsonb,
  '{
    "summary": "Random or multiple cylinder misfire detected. This code indicates the engine is misfiring on more than one cylinder or the misfire pattern is inconsistent. Common causes include ignition system issues, fuel delivery problems, or vacuum leaks.",
    "likely_causes": [
      {"name": "Ignition coil failure", "description": "Most common cause - coils can fail intermittently under load"},
      {"name": "Spark plug worn or fouled", "description": "Check gap and condition of all plugs"},
      {"name": "Vacuum leak", "description": "Unmetered air entering intake causes lean misfire"},
      {"name": "Fuel injector fault", "description": "Clogged or stuck injector affecting multiple cylinders"},
      {"name": "Low fuel pressure", "description": "Weak pump or clogged filter"}
    ],
    "diagnostic_steps": [
      {"title": "Check for other codes", "description": "Look for cylinder-specific misfire codes P0301-P0312 and fuel system codes"},
      {"title": "Visual inspection", "description": "Check spark plug wires, coil connectors, and vacuum lines for damage"},
      {"title": "Swap ignition coils", "description": "If misfire moves to different cylinder, coil is bad"},
      {"title": "Inspect spark plugs", "description": "Check for wear, fouling, or incorrect gap"},
      {"title": "Smoke test", "description": "Check for vacuum leaks at intake manifold and hoses"},
      {"title": "Check fuel pressure", "description": "Verify fuel pressure at idle and under load"}
    ],
    "what_results_mean": [
      {"condition": "Misfire follows coil when swapped", "then": "Replace ignition coil"},
      {"condition": "Plugs oil-fouled", "then": "Check for oil consumption issues, valve seals"},
      {"condition": "Plugs white/lean", "then": "Investigate vacuum leak or fuel delivery"},
      {"condition": "Low fuel pressure", "then": "Check fuel pump, filter, and regulator"}
    ],
    "safety_warnings": [
      "Do not drive with flashing CEL - can damage catalytic converter",
      "Raw fuel in exhaust is a fire hazard"
    ],
    "suggested_services": [
      {"name": "Ignition Coil Replacement", "labor_hours": 0.5},
      {"name": "Spark Plug Replacement", "labor_hours": 1.0},
      {"name": "Fuel System Cleaning", "labor_hours": 0.5},
      {"name": "Smoke Test - Vacuum Leak", "labor_hours": 0.5}
    ]
  }'::jsonb,
  0.85,
  false
) ON CONFLICT DO NOTHING;

-- P0171 - System Too Lean Bank 1
INSERT INTO public.diagnostic_playbooks (
  scope, shop_id, title, symptoms, dtc_codes, vehicle_tags, playbook, confidence, requires_oem_reference
) VALUES (
  'global', NULL,
  'P0171 - System Too Lean (Bank 1)',
  ARRAY['rough idle', 'hesitation', 'poor acceleration', 'stalling', 'high idle'],
  ARRAY['P0171'],
  '{"make": null, "model": null, "year_from": null, "year_to": null}'::jsonb,
  '{
    "summary": "The engine control module has detected the air/fuel mixture is too lean on bank 1. This means there is too much air or not enough fuel. Common causes include vacuum leaks, MAF sensor issues, or fuel delivery problems.",
    "likely_causes": [
      {"name": "Vacuum leak", "description": "Most common cause - unmetered air entering after MAF sensor"},
      {"name": "MAF sensor dirty or faulty", "description": "Contaminated or failing mass airflow sensor"},
      {"name": "Fuel pressure low", "description": "Weak fuel pump or clogged filter"},
      {"name": "Exhaust leak before O2 sensor", "description": "False lean reading from exhaust leak"},
      {"name": "PCV valve stuck open", "description": "Excessive crankcase ventilation"}
    ],
    "diagnostic_steps": [
      {"title": "Check fuel trims", "description": "Long term fuel trim (LTFT) over 10% indicates lean condition"},
      {"title": "Smoke test intake", "description": "Find vacuum leaks at intake manifold, hoses, gaskets"},
      {"title": "Inspect MAF sensor", "description": "Check for contamination, test MAF g/s readings"},
      {"title": "Check fuel pressure", "description": "Test at idle and under load"},
      {"title": "Inspect exhaust manifold", "description": "Look for cracks or loose bolts before O2 sensor"}
    ],
    "what_results_mean": [
      {"condition": "Smoke found at intake", "then": "Repair vacuum leak - replace gasket or hose"},
      {"condition": "MAF readings low", "then": "Clean or replace MAF sensor"},
      {"condition": "Fuel pressure low", "then": "Test fuel pump, replace filter, check regulator"},
      {"condition": "LTFT drops when MAF unplugged", "then": "MAF sensor is faulty"}
    ],
    "safety_warnings": [
      "Lean conditions can cause engine overheating",
      "Do not ignore - can cause catalyst damage"
    ],
    "suggested_services": [
      {"name": "Smoke Test - Vacuum Leak", "labor_hours": 0.5},
      {"name": "MAF Sensor Cleaning", "labor_hours": 0.3},
      {"name": "MAF Sensor Replacement", "labor_hours": 0.5},
      {"name": "Intake Manifold Gasket Replacement", "labor_hours": 2.0},
      {"name": "Fuel Filter Replacement", "labor_hours": 0.5}
    ]
  }'::jsonb,
  0.82,
  false
) ON CONFLICT DO NOTHING;

-- P0420 - Catalyst System Efficiency Below Threshold
INSERT INTO public.diagnostic_playbooks (
  scope, shop_id, title, symptoms, dtc_codes, vehicle_tags, playbook, confidence, requires_oem_reference
) VALUES (
  'global', NULL,
  'P0420 - Catalyst System Efficiency Below Threshold (Bank 1)',
  ARRAY['check engine light', 'reduced fuel economy', 'sulfur smell', 'failed emissions'],
  ARRAY['P0420'],
  '{"make": null, "model": null, "year_from": null, "year_to": null}'::jsonb,
  '{
    "summary": "The catalytic converter on bank 1 is not operating efficiently. This could be due to a failing catalyst, exhaust leaks, or underlying engine issues causing catalyst damage.",
    "likely_causes": [
      {"name": "Catalytic converter failing", "description": "Internal substrate damaged or contaminated"},
      {"name": "Exhaust leak before catalyst", "description": "False reading from unmetered oxygen"},
      {"name": "O2 sensor issue", "description": "Rear O2 sensor giving incorrect readings"},
      {"name": "Engine running rich", "description": "Excessive fuel contaminating catalyst"},
      {"name": "Coolant or oil in exhaust", "description": "Internal leak contaminating catalyst"}
    ],
    "diagnostic_steps": [
      {"title": "Check for other codes", "description": "Misfire or fuel system codes can cause catalyst damage"},
      {"title": "Compare O2 sensor readings", "description": "Front sensor should switch, rear should be steady"},
      {"title": "Inspect for exhaust leaks", "description": "Check manifold, pipes, and connections before cat"},
      {"title": "Temperature test", "description": "Outlet should be hotter than inlet if cat is working"},
      {"title": "Check for contamination", "description": "Look for coolant or oil consumption issues"}
    ],
    "what_results_mean": [
      {"condition": "Rear O2 mirrors front O2", "then": "Catalytic converter is failing"},
      {"condition": "Exhaust leak found", "then": "Repair leak and retest"},
      {"condition": "Misfire codes present", "then": "Fix misfire first, may have damaged cat"},
      {"condition": "Cat inlet hotter than outlet", "then": "Catalyst is not functioning"}
    ],
    "safety_warnings": [
      "Failed catalyst can overheat and cause fire",
      "Do not remove catalyst - it is federally illegal"
    ],
    "suggested_services": [
      {"name": "Catalytic Converter Replacement", "labor_hours": 1.5},
      {"name": "O2 Sensor Replacement (Rear)", "labor_hours": 0.5},
      {"name": "Exhaust Leak Repair", "labor_hours": 1.0}
    ]
  }'::jsonb,
  0.75,
  false
) ON CONFLICT DO NOTHING;

-- No Crank / No Start - Symptom Based
INSERT INTO public.diagnostic_playbooks (
  scope, shop_id, title, symptoms, dtc_codes, vehicle_tags, playbook, confidence, requires_oem_reference
) VALUES (
  'global', NULL,
  'No Crank / No Start Diagnosis',
  ARRAY['no crank', 'no start', 'wont start', 'nothing happens', 'click no start', 'dead'],
  ARRAY[]::text[],
  '{"make": null, "model": null, "year_from": null, "year_to": null}'::jsonb,
  '{
    "summary": "Vehicle does not crank or start when key is turned. This is typically an electrical issue with the starting circuit - battery, starter, or related components.",
    "likely_causes": [
      {"name": "Dead or weak battery", "description": "Most common cause - insufficient power to crank"},
      {"name": "Corroded battery terminals", "description": "Poor connection preventing power flow"},
      {"name": "Starter motor failure", "description": "Starter solenoid or motor has failed"},
      {"name": "Neutral safety switch", "description": "Vehicle not detecting park/neutral"},
      {"name": "Ignition switch failure", "description": "Electrical or mechanical failure"},
      {"name": "Blown fuse or fusible link", "description": "Open circuit in starting system"}
    ],
    "diagnostic_steps": [
      {"title": "Check battery voltage", "description": "Should be 12.4V+ at rest, 10.5V+ while cranking"},
      {"title": "Inspect battery terminals", "description": "Clean any corrosion, ensure tight connection"},
      {"title": "Test starter draw", "description": "Excessive draw indicates starter issue"},
      {"title": "Check for click", "description": "Single click = starter solenoid, multiple = weak battery"},
      {"title": "Bypass neutral safety switch", "description": "Try starting in neutral if auto trans"},
      {"title": "Check fuses", "description": "Inspect starter relay and related fuses"}
    ],
    "what_results_mean": [
      {"condition": "Battery under 12.4V", "then": "Charge and test battery, may need replacement"},
      {"condition": "Voltage drops below 10.5V cranking", "then": "Battery or starter issue"},
      {"condition": "Single click, lights stay bright", "then": "Starter solenoid or motor failure"},
      {"condition": "Multiple clicks, lights dim", "then": "Weak battery or poor connection"},
      {"condition": "No click at all", "then": "Check ignition switch, neutral safety, fuses"}
    ],
    "safety_warnings": [
      "Disconnect battery negative before starter work",
      "Battery acid is corrosive - use protection",
      "Do not hammer on starter to get it working"
    ],
    "suggested_services": [
      {"name": "Battery Replacement", "labor_hours": 0.3},
      {"name": "Battery Terminal Cleaning", "labor_hours": 0.3},
      {"name": "Starter Replacement", "labor_hours": 1.0},
      {"name": "Starter Circuit Diagnosis", "labor_hours": 1.0}
    ]
  }'::jsonb,
  0.88,
  false
) ON CONFLICT DO NOTHING;

-- Brake Noise - Symptom Based
INSERT INTO public.diagnostic_playbooks (
  scope, shop_id, title, symptoms, dtc_codes, vehicle_tags, playbook, confidence, requires_oem_reference
) VALUES (
  'global', NULL,
  'Brake Noise Diagnosis',
  ARRAY['brake noise', 'brake squeal', 'grinding', 'squeaking brakes', 'brake squeak'],
  ARRAY[]::text[],
  '{"make": null, "model": null, "year_from": null, "year_to": null}'::jsonb,
  '{
    "summary": "Customer reports noise when applying brakes. Brake noise can range from minor squeaking to severe grinding, indicating different levels of concern.",
    "likely_causes": [
      {"name": "Worn brake pads", "description": "Wear indicators contacting rotor"},
      {"name": "Glazed pads or rotors", "description": "Hardened surface causing squeal"},
      {"name": "Missing anti-rattle hardware", "description": "Pads moving in caliper bracket"},
      {"name": "Stuck caliper slide pins", "description": "Uneven pad wear causing noise"},
      {"name": "Warped rotors", "description": "Pulsation and noise during braking"},
      {"name": "Metal-to-metal contact", "description": "Pads worn through - grinding noise"}
    ],
    "diagnostic_steps": [
      {"title": "Road test", "description": "Verify noise type and when it occurs"},
      {"title": "Visual inspection", "description": "Check pad thickness, rotor condition"},
      {"title": "Measure pad thickness", "description": "Minimum spec typically 2-3mm"},
      {"title": "Check rotor thickness", "description": "Compare to minimum specification"},
      {"title": "Inspect slide pins", "description": "Should move freely when lubricated"},
      {"title": "Check hardware", "description": "Verify clips and shims are present and correct"}
    ],
    "what_results_mean": [
      {"condition": "High-pitched squeal", "then": "Wear indicators or glazing - replace pads"},
      {"condition": "Grinding noise", "then": "Metal-to-metal - replace pads and rotors immediately"},
      {"condition": "Noise only when cold", "then": "Often normal, light surface rust"},
      {"condition": "Pulsation with noise", "then": "Warped or uneven rotors - resurface or replace"}
    ],
    "safety_warnings": [
      "Grinding brakes are a safety hazard - stop driving",
      "Always replace pads in axle sets",
      "Brake dust may contain asbestos in older vehicles"
    ],
    "suggested_services": [
      {"name": "Brake Pad Replacement (Front)", "labor_hours": 1.0},
      {"name": "Brake Pad Replacement (Rear)", "labor_hours": 1.0},
      {"name": "Brake Rotor Replacement", "labor_hours": 0.5},
      {"name": "Brake Caliper Service", "labor_hours": 0.5},
      {"name": "Complete Brake Service", "labor_hours": 2.0}
    ]
  }'::jsonb,
  0.90,
  false
) ON CONFLICT DO NOTHING;

-- AC Not Cold - Symptom Based
INSERT INTO public.diagnostic_playbooks (
  scope, shop_id, title, symptoms, dtc_codes, vehicle_tags, playbook, confidence, requires_oem_reference
) VALUES (
  'global', NULL,
  'AC Not Blowing Cold Air',
  ARRAY['AC not cold', 'air conditioning warm', 'no cold air', 'AC warm', 'AC not cooling'],
  ARRAY[]::text[],
  '{"make": null, "model": null, "year_from": null, "year_to": null}'::jsonb,
  '{
    "summary": "Air conditioning system is not producing cold air. Could be low refrigerant, compressor issue, or blend door/electrical problem.",
    "likely_causes": [
      {"name": "Low refrigerant", "description": "Most common cause - system has a leak"},
      {"name": "Compressor not engaging", "description": "Clutch, relay, or pressure switch issue"},
      {"name": "Condenser blocked", "description": "Debris blocking airflow through condenser"},
      {"name": "Blend door stuck", "description": "Door not directing air through evaporator"},
      {"name": "Expansion valve/orifice tube", "description": "Restriction in refrigerant flow"},
      {"name": "Compressor failure", "description": "Internal compressor damage"}
    ],
    "diagnostic_steps": [
      {"title": "Check compressor engagement", "description": "Listen/watch for clutch engaging when AC turned on"},
      {"title": "Check refrigerant pressures", "description": "Connect gauges, check high and low side"},
      {"title": "Inspect condenser", "description": "Look for debris, bent fins, damage"},
      {"title": "Check for leaks", "description": "Use UV dye or electronic detector"},
      {"title": "Verify blend door operation", "description": "Check if temperature changes with dial"},
      {"title": "Check fuses and relays", "description": "Verify AC circuit is powered"}
    ],
    "what_results_mean": [
      {"condition": "Low side low, high side low", "then": "System is low on refrigerant - find leak"},
      {"condition": "Compressor not engaging", "then": "Check clutch, relay, pressure switch"},
      {"condition": "Both sides equal/high", "then": "Compressor not pumping - internal failure"},
      {"condition": "Temp changes but not cold", "then": "Possible blend door or low charge"}
    ],
    "safety_warnings": [
      "Refrigerant is under high pressure",
      "R134a/R1234yf must be recovered, not vented",
      "Wear eye protection when working on AC"
    ],
    "suggested_services": [
      {"name": "AC System Diagnosis", "labor_hours": 1.0},
      {"name": "AC Recharge with Dye", "labor_hours": 0.5},
      {"name": "AC Leak Repair", "labor_hours": 1.5},
      {"name": "AC Compressor Replacement", "labor_hours": 2.5},
      {"name": "Condenser Replacement", "labor_hours": 1.5}
    ]
  }'::jsonb,
  0.80,
  false
) ON CONFLICT DO NOTHING;

-- P0128 - Coolant Thermostat
INSERT INTO public.diagnostic_playbooks (
  scope, shop_id, title, symptoms, dtc_codes, vehicle_tags, playbook, confidence, requires_oem_reference
) VALUES (
  'global', NULL,
  'P0128 - Coolant Thermostat Below Regulating Temperature',
  ARRAY['cold engine', 'heater not hot', 'slow to warm up', 'low temp gauge'],
  ARRAY['P0128'],
  '{"make": null, "model": null, "year_from": null, "year_to": null}'::jsonb,
  '{
    "summary": "Engine coolant temperature is not reaching operating temperature within expected time. Usually indicates thermostat stuck open or coolant temperature sensor issue.",
    "likely_causes": [
      {"name": "Thermostat stuck open", "description": "Most common - coolant flows constantly"},
      {"name": "Coolant temperature sensor faulty", "description": "Sending incorrect signal to ECM"},
      {"name": "Low coolant level", "description": "Sensor not submerged properly"},
      {"name": "Cooling fan stuck on", "description": "Fan running constantly overcooling engine"}
    ],
    "diagnostic_steps": [
      {"title": "Check coolant level", "description": "Verify coolant is at proper level"},
      {"title": "Monitor warm-up time", "description": "Should reach operating temp in 5-10 minutes"},
      {"title": "Feel upper radiator hose", "description": "Should stay cold until thermostat opens"},
      {"title": "Check sensor readings", "description": "Compare ECT sensor to actual temperature"},
      {"title": "Inspect cooling fan", "description": "Should not run when engine is cold"}
    ],
    "what_results_mean": [
      {"condition": "Upper hose warm immediately", "then": "Thermostat stuck open - replace"},
      {"condition": "Sensor reading differs from actual", "then": "Replace coolant temp sensor"},
      {"condition": "Fan runs with cold engine", "then": "Check fan relay and control circuit"},
      {"condition": "Coolant low", "then": "Fill and check for leaks"}
    ],
    "safety_warnings": [
      "Never open radiator cap when hot",
      "Coolant is toxic to pets and children"
    ],
    "suggested_services": [
      {"name": "Thermostat Replacement", "labor_hours": 1.0},
      {"name": "Coolant Temperature Sensor Replacement", "labor_hours": 0.5},
      {"name": "Cooling System Flush", "labor_hours": 1.0}
    ]
  }'::jsonb,
  0.88,
  false
) ON CONFLICT DO NOTHING;

-- Battery Drain - Symptom Based
INSERT INTO public.diagnostic_playbooks (
  scope, shop_id, title, symptoms, dtc_codes, vehicle_tags, playbook, confidence, requires_oem_reference
) VALUES (
  'global', NULL,
  'Battery Drain / Parasitic Draw Diagnosis',
  ARRAY['battery drain', 'dead battery', 'battery keeps dying', 'parasitic draw', 'battery dead overnight'],
  ARRAY[]::text[],
  '{"make": null, "model": null, "year_from": null, "year_to": null}'::jsonb,
  '{
    "summary": "Battery drains when vehicle sits. Normal parasitic draw is 25-50mA. Higher draw indicates something is staying on or a component is faulty.",
    "likely_causes": [
      {"name": "Module not sleeping", "description": "ECU or body module staying awake"},
      {"name": "Aftermarket accessories", "description": "Poorly installed radio, alarm, or lights"},
      {"name": "Trunk/glove box light", "description": "Light staying on with door closed"},
      {"name": "Alternator diode leaking", "description": "Current flowing backward through alternator"},
      {"name": "Relay stuck closed", "description": "Relay keeping circuit powered"},
      {"name": "Bad battery", "description": "Internal short causing self-discharge"}
    ],
    "diagnostic_steps": [
      {"title": "Test battery condition", "description": "Load test to verify battery is good"},
      {"title": "Measure parasitic draw", "description": "Ammeter in series, wait for modules to sleep"},
      {"title": "Pull fuses one by one", "description": "Find which circuit has excessive draw"},
      {"title": "Check for aftermarket items", "description": "Inspect radio, alarm, accessories"},
      {"title": "Test alternator output", "description": "Check for AC ripple indicating bad diode"}
    ],
    "what_results_mean": [
      {"condition": "Draw over 50mA", "then": "Excessive - continue diagnosis"},
      {"condition": "Draw drops when fuse pulled", "then": "Problem is on that circuit"},
      {"condition": "High AC ripple from alternator", "then": "Alternator diode is bad"},
      {"condition": "Battery fails load test", "then": "Replace battery"}
    ],
    "safety_warnings": [
      "Disconnect battery negative first",
      "Wait 20+ minutes for modules to sleep before testing"
    ],
    "suggested_services": [
      {"name": "Parasitic Draw Test", "labor_hours": 1.0},
      {"name": "Battery Replacement", "labor_hours": 0.3},
      {"name": "Alternator Replacement", "labor_hours": 1.0},
      {"name": "Electrical Circuit Repair", "labor_hours": 1.0}
    ]
  }'::jsonb,
  0.82,
  false
) ON CONFLICT DO NOTHING;

SELECT 'Seed playbooks inserted successfully. Total playbooks: ' || COUNT(*) as result 
FROM public.diagnostic_playbooks;
