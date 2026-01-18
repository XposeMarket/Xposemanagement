-- =============================================
-- DIAGNOSTIC PLAYBOOKS SEED DATA
-- =============================================

-- P0300 - Random Misfire
INSERT INTO public.diagnostic_playbooks (scope, title, symptoms, dtc_codes, keywords, playbook, confidence)
VALUES ('global', 'P0300 - Random/Multiple Cylinder Misfire Detected',
  ARRAY['rough_idle', 'misfire', 'hesitation', 'shaking', 'cel_flashing', 'rough idle', 'CEL flashing'],
  ARRAY['P0300'],
  ARRAY['misfire', 'random misfire', 'multiple cylinder'],
  '{
    "summary": "Random or multiple cylinder misfire detected. Common causes include ignition system issues, fuel delivery problems, or vacuum leaks.",
    "likely_causes": [
      {"name": "Ignition coil failure", "description": "Coils can fail intermittently under load"},
      {"name": "Spark plug worn/fouled", "description": "Check gap and condition"},
      {"name": "Vacuum leak", "description": "Unmetered air causes lean misfire"},
      {"name": "Fuel injector fault", "description": "Clogged or stuck injector"},
      {"name": "Low fuel pressure", "description": "Weak pump or clogged filter"}
    ],
    "diagnostic_steps": [
      {"title": "Check for other codes", "description": "Look for P0301-P0312 cylinder-specific codes"},
      {"title": "Visual inspection", "description": "Check plug wires, coil connectors, vacuum lines"},
      {"title": "Swap ignition coils", "description": "If misfire moves, coil is bad"},
      {"title": "Inspect spark plugs", "description": "Check for wear, fouling, gap"},
      {"title": "Smoke test", "description": "Check for vacuum leaks"}
    ],
    "what_results_mean": [
      {"condition": "Misfire follows coil", "then": "Replace ignition coil"},
      {"condition": "Plugs oil-fouled", "then": "Check valve seals/rings"},
      {"condition": "Plugs white/lean", "then": "Vacuum leak or fuel delivery issue"}
    ],
    "safety_warnings": ["Do not drive with flashing CEL - can damage catalytic converter"],
    "suggested_services": [
      {"name": "Ignition Coil Replacement", "labor_hours": 0.5},
      {"name": "Spark Plug Replacement", "labor_hours": 1.0},
      {"name": "Smoke Test - Vacuum Leak", "labor_hours": 0.5}
    ]
  }'::jsonb, 0.85)
ON CONFLICT DO NOTHING;

-- P0171 - System Too Lean
INSERT INTO public.diagnostic_playbooks (scope, title, symptoms, dtc_codes, keywords, playbook, confidence)
VALUES ('global', 'P0171 - System Too Lean (Bank 1)',
  ARRAY['rough_idle', 'hesitation', 'stalling', 'high_idle'],
  ARRAY['P0171'],
  ARRAY['lean', 'bank 1 lean', 'fuel trim'],
  '{
    "summary": "Air/fuel mixture is too lean on bank 1. Common causes include vacuum leaks, MAF sensor issues, or fuel delivery problems.",
    "likely_causes": [
      {"name": "Vacuum leak", "description": "Most common - unmetered air after MAF"},
      {"name": "MAF sensor dirty/faulty", "description": "Contaminated sensor"},
      {"name": "Fuel pressure low", "description": "Weak pump or clogged filter"},
      {"name": "Exhaust leak before O2", "description": "False lean reading"}
    ],
    "diagnostic_steps": [
      {"title": "Check fuel trims", "description": "LTFT over 10% indicates lean"},
      {"title": "Smoke test intake", "description": "Find vacuum leaks"},
      {"title": "Inspect MAF sensor", "description": "Check for contamination"},
      {"title": "Check fuel pressure", "description": "Test at idle and under load"}
    ],
    "safety_warnings": ["Lean conditions can cause overheating"],
    "suggested_services": [
      {"name": "Smoke Test - Vacuum Leak", "labor_hours": 0.5},
      {"name": "MAF Sensor Cleaning", "labor_hours": 0.3},
      {"name": "MAF Sensor Replacement", "labor_hours": 0.5}
    ]
  }'::jsonb, 0.82)
ON CONFLICT DO NOTHING;

-- P0420 - Catalyst Efficiency
INSERT INTO public.diagnostic_playbooks (scope, title, symptoms, dtc_codes, keywords, playbook, confidence)
VALUES ('global', 'P0420 - Catalyst System Efficiency Below Threshold',
  ARRAY['check_engine', 'failed_emissions', 'sulfur_smell'],
  ARRAY['P0420'],
  ARRAY['catalyst', 'catalytic converter', 'cat efficiency'],
  '{
    "summary": "Catalytic converter on bank 1 is not operating efficiently. Could be failing catalyst, exhaust leak, or O2 sensor issue.",
    "likely_causes": [
      {"name": "Catalytic converter failing", "description": "Internal substrate damaged"},
      {"name": "Exhaust leak before catalyst", "description": "False reading"},
      {"name": "O2 sensor issue", "description": "Rear sensor giving incorrect readings"},
      {"name": "Engine running rich", "description": "Excessive fuel damaging catalyst"}
    ],
    "diagnostic_steps": [
      {"title": "Check for other codes", "description": "Misfire codes can cause cat damage"},
      {"title": "Compare O2 sensors", "description": "Front should switch, rear steady"},
      {"title": "Temperature test", "description": "Outlet should be hotter than inlet"}
    ],
    "safety_warnings": ["Failed catalyst can overheat and cause fire", "Do not remove catalyst - federally illegal"],
    "suggested_services": [
      {"name": "Catalytic Converter Replacement", "labor_hours": 1.5},
      {"name": "O2 Sensor Replacement", "labor_hours": 0.5}
    ]
  }'::jsonb, 0.75)
ON CONFLICT DO NOTHING;

-- No Crank / No Start (with triage questions!)
INSERT INTO public.diagnostic_playbooks (scope, title, symptoms, dtc_codes, keywords, playbook, confidence)
VALUES ('global', 'No Crank / No Start Diagnosis',
  ARRAY['no_crank', 'no_start', 'wont_start', 'dead', 'click'],
  ARRAY[]::text[],
  ARRAY['no start', 'wont start', 'no crank', 'dead battery', 'click'],
  '{
    "summary": "Vehicle does not crank or start. Usually an electrical issue with battery, starter, or related components.",
    "triage_questions": [
      {"q": "Do you hear any click when turning the key?", "answers": ["Yes - single click", "Yes - multiple clicks", "No sound at all"]},
      {"q": "Do the dashboard lights come on?", "answers": ["Yes - bright", "Yes - dim", "No"]},
      {"q": "Did it start fine yesterday?", "answers": ["Yes", "No - been having issues"]}
    ],
    "likely_causes": [
      {"name": "Dead/weak battery", "description": "Most common cause"},
      {"name": "Corroded terminals", "description": "Poor connection"},
      {"name": "Starter motor failure", "description": "Solenoid or motor failed"},
      {"name": "Neutral safety switch", "description": "Not detecting park/neutral"},
      {"name": "Ignition switch failure", "description": "Electrical or mechanical"}
    ],
    "diagnostic_steps": [
      {"title": "Check battery voltage", "description": "Should be 12.4V+ at rest"},
      {"title": "Inspect terminals", "description": "Clean corrosion, ensure tight"},
      {"title": "Check for click", "description": "Single = starter, Multiple = weak battery"},
      {"title": "Test starter draw", "description": "Excessive draw = starter issue"}
    ],
    "what_results_mean": [
      {"condition": "Single click, lights bright", "then": "Starter solenoid/motor failure"},
      {"condition": "Multiple clicks, lights dim", "then": "Weak battery or poor connection"},
      {"condition": "No click at all", "then": "Check ignition switch, safety switch, fuses"}
    ],
    "safety_warnings": ["Disconnect battery negative before starter work"],
    "suggested_services": [
      {"name": "Battery Replacement", "labor_hours": 0.3},
      {"name": "Battery Terminal Cleaning", "labor_hours": 0.3},
      {"name": "Starter Replacement", "labor_hours": 1.0}
    ]
  }'::jsonb, 0.88)
ON CONFLICT DO NOTHING;

-- Brake Noise (with triage questions!)
INSERT INTO public.diagnostic_playbooks (scope, title, symptoms, dtc_codes, keywords, playbook, confidence)
VALUES ('global', 'Brake Noise Diagnosis',
  ARRAY['brake_noise', 'brake_squeal', 'grinding', 'squeak'],
  ARRAY[]::text[],
  ARRAY['brake noise', 'squeal', 'grinding brakes', 'brake squeak'],
  '{
    "summary": "Customer reports noise when braking. Can range from minor squeaking to severe grinding.",
    "triage_questions": [
      {"q": "What type of noise?", "answers": ["High-pitched squeal", "Grinding/metal-on-metal", "Scraping", "Clunking"]},
      {"q": "When does it occur?", "answers": ["Only when braking", "All the time", "Only when cold"]},
      {"q": "Which end of vehicle?", "answers": ["Front", "Rear", "Both", "Not sure"]}
    ],
    "likely_causes": [
      {"name": "Worn brake pads", "description": "Wear indicators contacting rotor"},
      {"name": "Glazed pads/rotors", "description": "Hardened surface causing squeal"},
      {"name": "Missing hardware", "description": "Pads moving in bracket"},
      {"name": "Metal-to-metal", "description": "Pads worn through"}
    ],
    "diagnostic_steps": [
      {"title": "Road test", "description": "Verify noise type and when it occurs"},
      {"title": "Visual inspection", "description": "Check pad thickness, rotor condition"},
      {"title": "Measure pads", "description": "Min spec typically 2-3mm"}
    ],
    "what_results_mean": [
      {"condition": "High-pitched squeal", "then": "Wear indicators or glazing"},
      {"condition": "Grinding noise", "then": "Metal-to-metal - replace pads AND rotors"}
    ],
    "safety_warnings": ["Grinding brakes are a safety hazard - stop driving"],
    "suggested_services": [
      {"name": "Brake Pad Replacement (Front)", "labor_hours": 1.0},
      {"name": "Brake Pad Replacement (Rear)", "labor_hours": 1.0},
      {"name": "Brake Rotor Replacement", "labor_hours": 0.5}
    ]
  }'::jsonb, 0.90)
ON CONFLICT DO NOTHING;

-- AC Not Cold (with triage questions!)
INSERT INTO public.diagnostic_playbooks (scope, title, symptoms, dtc_codes, keywords, playbook, confidence)
VALUES ('global', 'AC Not Blowing Cold Air',
  ARRAY['ac_not_cold', 'ac_warm', 'no_cold_air'],
  ARRAY[]::text[],
  ARRAY['ac not cold', 'air conditioning', 'ac warm', 'no cold air'],
  '{
    "summary": "AC system not producing cold air. Could be low refrigerant, compressor issue, or electrical problem.",
    "triage_questions": [
      {"q": "Does the compressor clutch engage?", "answers": ["Yes", "No", "Not sure"]},
      {"q": "Is the blower working on all speeds?", "answers": ["Yes", "No"]},
      {"q": "When did it last work properly?", "answers": ["Recently stopped", "Gradually got worse", "Never worked well"]}
    ],
    "likely_causes": [
      {"name": "Low refrigerant", "description": "System has a leak"},
      {"name": "Compressor not engaging", "description": "Clutch, relay, or pressure switch"},
      {"name": "Condenser blocked", "description": "Debris blocking airflow"},
      {"name": "Blend door stuck", "description": "Not directing air through evaporator"}
    ],
    "diagnostic_steps": [
      {"title": "Check compressor", "description": "Listen for clutch engaging"},
      {"title": "Check pressures", "description": "Connect gauges, check high/low side"},
      {"title": "Inspect condenser", "description": "Look for debris, damage"}
    ],
    "what_results_mean": [
      {"condition": "Low side low, high side low", "then": "System low on refrigerant"},
      {"condition": "Compressor not engaging", "then": "Check clutch, relay, pressure switch"}
    ],
    "safety_warnings": ["Refrigerant under high pressure", "Wear eye protection"],
    "suggested_services": [
      {"name": "AC System Diagnosis", "labor_hours": 1.0},
      {"name": "AC Recharge with Dye", "labor_hours": 0.5},
      {"name": "AC Compressor Replacement", "labor_hours": 2.5}
    ]
  }'::jsonb, 0.80)
ON CONFLICT DO NOTHING;

-- Overheating
INSERT INTO public.diagnostic_playbooks (scope, title, symptoms, dtc_codes, keywords, playbook, confidence)
VALUES ('global', 'Engine Overheating Diagnosis',
  ARRAY['overheating', 'overheat', 'temp_high', 'hot'],
  ARRAY[]::text[],
  ARRAY['overheating', 'running hot', 'temp gauge high', 'coolant'],
  '{
    "summary": "Engine temperature is running higher than normal. Can be caused by cooling system failures, thermostat issues, or head gasket problems.",
    "triage_questions": [
      {"q": "When does it overheat?", "answers": ["At idle only", "While driving", "Both"]},
      {"q": "Is there coolant loss?", "answers": ["Yes - visible leak", "Yes - no visible leak", "No loss"]},
      {"q": "Does heater blow hot air?", "answers": ["Yes", "No - blows cold", "Inconsistent"]}
    ],
    "likely_causes": [
      {"name": "Low coolant", "description": "Leak in system"},
      {"name": "Thermostat stuck closed", "description": "Not allowing coolant flow"},
      {"name": "Water pump failure", "description": "Not circulating coolant"},
      {"name": "Cooling fan not working", "description": "Electric fan or clutch fan"},
      {"name": "Head gasket failure", "description": "Combustion gases in cooling system"}
    ],
    "diagnostic_steps": [
      {"title": "Check coolant level", "description": "Fill if low, look for leaks"},
      {"title": "Test thermostat", "description": "Should open around 195°F"},
      {"title": "Check cooling fans", "description": "Should come on with AC or high temp"},
      {"title": "Pressure test", "description": "Find external leaks"},
      {"title": "Check for combustion gases", "description": "Block test for head gasket"}
    ],
    "safety_warnings": ["Never open radiator cap when hot", "Steam can cause severe burns"],
    "suggested_services": [
      {"name": "Thermostat Replacement", "labor_hours": 1.0},
      {"name": "Water Pump Replacement", "labor_hours": 2.5},
      {"name": "Coolant Flush", "labor_hours": 1.0},
      {"name": "Cooling System Pressure Test", "labor_hours": 0.5}
    ]
  }'::jsonb, 0.85)
ON CONFLICT DO NOTHING;

-- P0128 - Coolant Temp Below Threshold
INSERT INTO public.diagnostic_playbooks (scope, title, symptoms, dtc_codes, keywords, playbook, confidence)
VALUES ('global', 'P0128 - Coolant Thermostat Below Regulating Temperature',
  ARRAY['cold_engine', 'heater_not_hot', 'slow_warmup'],
  ARRAY['P0128'],
  ARRAY['thermostat', 'running cold', 'heater cold'],
  '{
    "summary": "Engine not reaching operating temperature. Usually thermostat stuck open or coolant temp sensor issue.",
    "likely_causes": [
      {"name": "Thermostat stuck open", "description": "Coolant flows constantly"},
      {"name": "Coolant temp sensor faulty", "description": "Incorrect signal to ECM"},
      {"name": "Low coolant level", "description": "Sensor not submerged"},
      {"name": "Cooling fan stuck on", "description": "Overcooling engine"}
    ],
    "diagnostic_steps": [
      {"title": "Check coolant level", "description": "Verify at proper level"},
      {"title": "Monitor warmup", "description": "Should reach temp in 5-10 min"},
      {"title": "Feel upper hose", "description": "Should stay cold until thermostat opens"}
    ],
    "suggested_services": [
      {"name": "Thermostat Replacement", "labor_hours": 1.0},
      {"name": "Coolant Temp Sensor Replacement", "labor_hours": 0.5}
    ]
  }'::jsonb, 0.88)
ON CONFLICT DO NOTHING;

SELECT 'Diagnostic playbooks inserted. Total: ' || COUNT(*) as result FROM public.diagnostic_playbooks;
