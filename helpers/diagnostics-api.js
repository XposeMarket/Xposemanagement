/**
 * Get vehicle-specific diagnostic analysis from AI based on triage answers
 * Calls /api/ai-diagnostic-triage on backend
 * @param {Object} params
 * @param {string|number} params.playbookId - The playbook/diagnosis ID
 * @param {string} params.playbookTitle - The diagnosis title
 * @param {number|string} params.vehicleYear
 * @param {string} params.vehicleMake
 * @param {string} params.vehicleModel
 * @param {string|null} [params.engineType]
 * @param {Array<{question: string, answer: string}>} params.triageAnswers
 * @param {Array<string>} params.likelyCauses - List of likely causes from playbook
 * @returns {Promise<Object>} AI result: { probableCause, explanation, whatToCheck, confidence, ... }
 */
export async function getAiDiagnosticAnalysis({
  playbookId,
  playbookTitle,
  vehicleYear,
  vehicleMake,
  vehicleModel,
  engineType = null,
  triageAnswers = [],
  likelyCauses = []
}) {
  // If no vehicle info, skip AI lookup
  if (!vehicleYear || !vehicleMake || !vehicleModel || !playbookTitle) {
    console.log('[diagnostics-api] Missing info for AI diagnostic triage');
    return { status: 'skipped', reason: 'Missing required info' };
  }

  try {
    const isLocalHost = (typeof window !== 'undefined') && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
    const apiUrl = isLocalHost
      ? 'http://127.0.0.1:4000/api/ai-diagnostic-triage'
      : 'https://xpose-stripe-server.vercel.app/api/ai-diagnostic-triage';

    console.log(`[diagnostics-api] Fetching AI diagnostic triage from: ${apiUrl}`);
    console.log(`[diagnostics-api] Vehicle: ${vehicleYear} ${vehicleMake} ${vehicleModel} - ${playbookTitle}`);

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        playbookId,
        playbookTitle,
        vehicleYear: parseInt(vehicleYear),
        vehicleMake,
        vehicleModel,
        engineType,
        triageAnswers,
        likelyCauses
      })
    });

    console.log('[diagnostics-api] AI triage HTTP status:', response.status);

    if (!response.ok) {
      const text = await response.text();
      let parsed = null;
      try { parsed = JSON.parse(text); } catch (e) {}
      console.error('[diagnostics-api] AI triage lookup failed:', response.status, parsed || text);
      return {
        status: 'error',
        error: parsed?.error || `HTTP ${response.status}`,
        fallback: true,
        httpStatus: response.status
      };
    }

    const result = await response.json();
    console.log('[diagnostics-api] AI triage result:', result);
    return result;

  } catch (e) {
    console.error('[diagnostics-api] getAiDiagnosticAnalysis error:', e);
    return { status: 'error', fallback: true, error: e.message };
  }
}
/**
 * helpers/diagnostics-api.js
 * 
 * Unified API for diagnostic playbooks AND service operations
 * Provides a single search interface that returns both types of results
 */

import { getSupabaseClient } from './supabase.js';

// ============================================
// API BASE URL HELPER
// ============================================

/**
 * Get the base URL for API calls
 * In local dev, Express runs on port 3000 (from .env)
 * In production, use relative URLs (same origin)
 */
function getApiBaseUrl() {
  if (typeof window !== 'undefined') {
    const host = window.location.hostname;
    // Local development - Express server runs on port 4000 (observed at runtime)
    if (host === 'localhost' || host === '127.0.0.1') {
      return 'http://127.0.0.1:4000';
    }
    // Always use the Vercel backend for production
    return 'https://xpose-stripe-server.vercel.app';
  }
  // Fallback for non-browser environments
  return 'https://xpose-stripe-server.vercel.app';
}

// ============================================
// UNIFIED SEARCH
// ============================================

export async function unifiedSearch({ query = '', dtcCodes = [], symptoms = [], vehicleTags = {}, shopId = null }) {
  const supabase = getSupabaseClient();
  if (!supabase) {
    console.warn('[diagnostics-api] No Supabase client');
    return { playbooks: [], operations: [], combined: [] };
  }

  const normalizedQuery = query.toLowerCase().trim();
  const queryWords = normalizedQuery.split(/\s+/).filter(w => w.length > 1);

  const [playbookResults, operationResults] = await Promise.all([
    searchPlaybooks({ query: normalizedQuery, dtcCodes, symptoms, vehicleTags, shopId }),
    searchOperations({ query: normalizedQuery, keywords: queryWords, vehicleTags, shopId })
  ]);

  const combined = [
    ...playbookResults.map(p => ({ ...p, resultType: 'playbook' })),
    ...operationResults.map(o => ({ ...o, resultType: 'operation' }))
  ].sort((a, b) => (b.score || 0) - (a.score || 0));

  console.log(`[diagnostics-api] Unified search found ${playbookResults.length} playbooks, ${operationResults.length} operations`);

  return { playbooks: playbookResults, operations: operationResults, combined };
}

// ============================================
// PLAYBOOK SEARCH
// ============================================

export async function searchPlaybooks({ query = '', dtcCodes = [], symptoms = [], vehicleTags = {}, shopId = null }) {
  const supabase = getSupabaseClient();
  if (!supabase) return [];

  try {
    let dbQuery = supabase.from('diagnostic_playbooks').select('*').eq('is_active', true);
    const { data, error } = await dbQuery;
    if (error) throw error;

    const scored = (data || []).map(playbook => {
      let score = 0;
      const matchReasons = [];

      const pbCodes = playbook.dtc_codes || [];
      for (const code of dtcCodes) {
        if (pbCodes.some(c => c.toUpperCase() === code.toUpperCase())) {
          score += 100;
          matchReasons.push(`DTC: ${code}`);
        }
      }

      const pbSymptoms = playbook.symptoms || [];
      const pbKeywords = playbook.keywords || [];
      const allPbTerms = [...pbSymptoms, ...pbKeywords].map(s => s.toLowerCase());
      
      for (const symptom of symptoms) {
        const symLower = symptom.toLowerCase();
        if (allPbTerms.some(t => t.includes(symLower) || symLower.includes(t))) {
          score += 50;
          matchReasons.push(`Symptom: ${symptom}`);
        }
      }

      if (query) {
        const queryLower = query.toLowerCase();
        if (playbook.title.toLowerCase().includes(queryLower)) {
          score += 40;
          matchReasons.push('Title match');
        }
        if (allPbTerms.some(t => t.includes(queryLower))) {
          score += 30;
          matchReasons.push('Keyword match');
        }
        const summary = playbook.playbook?.summary || '';
        if (summary.toLowerCase().includes(queryLower)) {
          score += 20;
          matchReasons.push('Summary match');
        }
      }

      if (vehicleTags.make && playbook.vehicle_tags?.make) {
        if (vehicleTags.make.toLowerCase() === playbook.vehicle_tags.make.toLowerCase()) {
          score += 20;
          matchReasons.push('Make match');
        }
      }
      if (vehicleTags.model && playbook.vehicle_tags?.model) {
        if (vehicleTags.model.toLowerCase() === playbook.vehicle_tags.model.toLowerCase()) {
          score += 15;
          matchReasons.push('Model match');
        }
      }
      if (vehicleTags.year && playbook.vehicle_tags?.year_from && playbook.vehicle_tags?.year_to) {
        const year = parseInt(vehicleTags.year);
        if (year >= playbook.vehicle_tags.year_from && year <= playbook.vehicle_tags.year_to) {
          score += 10;
          matchReasons.push('Year match');
        }
      }

      if (shopId && playbook.shop_id === shopId) {
        score += 5;
        matchReasons.push('Shop-specific');
      }

      score *= (playbook.confidence || 0.7);
      return { ...playbook, score, matchReasons };
    });

    const results = scored.filter(p => p.score > 0).sort((a, b) => b.score - a.score);
    console.log(`[diagnostics-api] Found ${results.length} matching playbooks`);
    return results;
  } catch (e) {
    console.error('[diagnostics-api] searchPlaybooks error:', e);
    return [];
  }
}

// ============================================
// SERVICE OPERATION SEARCH
// ============================================

export async function searchOperations({ query = '', keywords = [], vehicleTags = {}, shopId = null }) {
  const supabase = getSupabaseClient();
  if (!supabase) return [];
  if (!query && keywords.length === 0) return [];

  try {
    const { data, error } = await supabase.from('service_operations').select('*').eq('is_active', true);
    if (error) throw error;

    const queryLower = query.toLowerCase();
    const keywordsLower = keywords.map(k => k.toLowerCase());

    const scored = (data || []).map(operation => {
      let score = 0;
      const matchReasons = [];

      const opKeywords = (operation.keywords || []).map(k => k.toLowerCase());
      const opName = operation.name.toLowerCase();
      const opCategory = (operation.category || '').toLowerCase();
      const opSummary = (operation.summary || '').toLowerCase();

      if (opName === queryLower) {
        score += 100;
        matchReasons.push('Exact name match');
      } else if (opName.includes(queryLower)) {
        score += 70;
        matchReasons.push('Name contains query');
      }

      for (const kw of keywordsLower) {
        if (opKeywords.includes(kw)) {
          score += 50;
          matchReasons.push(`Keyword: ${kw}`);
        } else if (opKeywords.some(ok => ok.includes(kw) || kw.includes(ok))) {
          score += 30;
          matchReasons.push(`Partial keyword: ${kw}`);
        }
      }

      if (queryLower && opCategory.includes(queryLower)) {
        score += 20;
        matchReasons.push('Category match');
      }
      if (queryLower && opSummary.includes(queryLower)) {
        score += 15;
        matchReasons.push('Summary match');
      }

      if (vehicleTags.make && operation.vehicle_tags?.make) {
        if (vehicleTags.make.toLowerCase() === operation.vehicle_tags.make.toLowerCase()) {
          score += 20;
          matchReasons.push('Make-specific');
        }
      }

      if (shopId && operation.shop_id === shopId) {
        score += 10;
        matchReasons.push('Shop-specific');
      }

      return { ...operation, score, matchReasons };
    });

    const results = scored.filter(o => o.score > 0).sort((a, b) => b.score - a.score);
    console.log(`[diagnostics-api] Found ${results.length} matching operations`);
    return results;
  } catch (e) {
    console.error('[diagnostics-api] searchOperations error:', e);
    return [];
  }
}

export async function getOperationById(operationId) {
  const supabase = getSupabaseClient();
  if (!supabase) return null;
  try {
    const { data, error } = await supabase.from('service_operations').select('*').eq('id', operationId).single();
    if (error) throw error;
    return data;
  } catch (e) {
    console.error('[diagnostics-api] getOperationById error:', e);
    return null;
  }
}

export async function getPlaybookById(playbookId) {
  const supabase = getSupabaseClient();
  if (!supabase) return null;
  try {
    const { data, error } = await supabase.from('diagnostic_playbooks').select('*').eq('id', playbookId).single();
    if (error) throw error;
    return data;
  } catch (e) {
    console.error('[diagnostics-api] getPlaybookById error:', e);
    return null;
  }
}

// ============================================
// TRACKING & ANALYTICS
// ============================================

export async function logSearchRequest({
  shopId = null, jobId = null, appointmentId = null, searchQuery = '', searchType = 'general',
  inputData = {}, resultType = 'none', matchedPlaybookId = null, matchedOperationId = null,
  vehicleYear = null, vehicleMake = null, vehicleModel = null
}) {
  const supabase = getSupabaseClient();
  if (!supabase) return null;
  try {
    if (!shopId) {
      try { const session = JSON.parse(localStorage.getItem('xm_session') || '{}'); shopId = session.shopId || null; } catch (e) {}
    }
    const { data, error } = await supabase.from('diagnostic_requests').insert({
      shop_id: shopId, job_id: jobId, appointment_id: appointmentId, search_query: searchQuery,
      search_type: searchType, input_data: inputData, result_type: resultType,
      matched_playbook_id: matchedPlaybookId, matched_operation_id: matchedOperationId,
      vehicle_year: vehicleYear, vehicle_make: vehicleMake, vehicle_model: vehicleModel
    }).select().single();
    if (error) throw error;
    console.log('✅ Search request logged:', data.id);
    return data;
  } catch (e) {
    console.error('[diagnostics-api] logSearchRequest error:', e);
    return null;
  }
}

export const logDiagnosticRequest = logSearchRequest;

export async function recordFixOutcome({
  playbookId = null, operationId = null, jobId = null, serviceName, resolved = true,
  mileage = null, vehicleYear = null, vehicleMake = null, vehicleModel = null, notes = ''
}) {
  const supabase = getSupabaseClient();
  if (!supabase) return null;
  try {
    let shopId = null;
    try { const session = JSON.parse(localStorage.getItem('xm_session') || '{}'); shopId = session.shopId || null; } catch (e) {}
    const { data, error } = await supabase.from('diagnostic_fix_outcomes').insert({
      shop_id: shopId, playbook_id: playbookId, operation_id: operationId, job_id: jobId,
      service_name: serviceName, resolved, mileage, vehicle_year: vehicleYear,
      vehicle_make: vehicleMake, vehicle_model: vehicleModel, notes
    }).select().single();
    if (error) throw error;
    console.log('✅ Fix outcome recorded:', data.id);
    return data;
  } catch (e) {
    console.error('[diagnostics-api] recordFixOutcome error:', e);
    return null;
  }
}

export async function getFixStatistics(playbookId = null, operationId = null) {
  const supabase = getSupabaseClient();
  if (!supabase) return { fixStats: [], totalOutcomes: 0 };
  try {
    let query = supabase.from('diagnostic_fix_outcomes').select('*');
    if (playbookId) query = query.eq('playbook_id', playbookId);
    else if (operationId) query = query.eq('operation_id', operationId);
    else return { fixStats: [], totalOutcomes: 0 };
    const { data, error } = await query;
    if (error) throw error;
    const stats = {};
    for (const outcome of (data || [])) {
      const name = outcome.service_name || 'Unknown';
      if (!stats[name]) stats[name] = { total: 0, resolved: 0 };
      stats[name].total++;
      if (outcome.resolved) stats[name].resolved++;
    }
    const totalOutcomes = data?.length || 0;
    const fixStats = Object.entries(stats).map(([serviceName, counts]) => ({
      serviceName, totalCount: counts.total, resolvedCount: counts.resolved,
      percentage: totalOutcomes > 0 ? Math.round((counts.resolved / totalOutcomes) * 100) : 0
    })).sort((a, b) => b.resolvedCount - a.resolvedCount);
    return { fixStats, totalOutcomes };
  } catch (e) {
    console.error('[diagnostics-api] getFixStatistics error:', e);
    return { fixStats: [], totalOutcomes: 0 };
  }
}

export async function submitFeedback({ playbookId = null, operationId = null, verdict, notes = '' }) {
  const supabase = getSupabaseClient();
  if (!supabase) return null;
  try {
    let shopId = null;
    try { const session = JSON.parse(localStorage.getItem('xm_session') || '{}'); shopId = session.shopId || null; } catch (e) {}
    const { data, error } = await supabase.from('diagnostic_feedback').insert({
      shop_id: shopId, playbook_id: playbookId, operation_id: operationId, verdict, notes
    }).select().single();
    if (error) throw error;
    console.log('✅ Feedback submitted:', data.id);
    return data;
  } catch (e) {
    console.error('[diagnostics-api] submitFeedback error:', e);
    return null;
  }
}

export const submitPlaybookFeedback = submitFeedback;

// ============================================
// COMMON DTC INFO
// ============================================

const COMMON_DTC_INFO = {
  'P0300': { description: 'Random/Multiple Cylinder Misfire Detected', category: 'Misfire', severity: 'high' },
  'P0301': { description: 'Cylinder 1 Misfire Detected', category: 'Misfire', severity: 'high' },
  'P0302': { description: 'Cylinder 2 Misfire Detected', category: 'Misfire', severity: 'high' },
  'P0303': { description: 'Cylinder 3 Misfire Detected', category: 'Misfire', severity: 'high' },
  'P0304': { description: 'Cylinder 4 Misfire Detected', category: 'Misfire', severity: 'high' },
  'P0171': { description: 'System Too Lean (Bank 1)', category: 'Fuel System', severity: 'medium' },
  'P0172': { description: 'System Too Rich (Bank 1)', category: 'Fuel System', severity: 'medium' },
  'P0420': { description: 'Catalyst System Efficiency Below Threshold (Bank 1)', category: 'Emissions', severity: 'medium' },
  'P0440': { description: 'Evaporative Emission System Malfunction', category: 'EVAP', severity: 'low' },
  'P0442': { description: 'EVAP System Small Leak Detected', category: 'EVAP', severity: 'low' },
  'P0455': { description: 'EVAP System Large Leak Detected', category: 'EVAP', severity: 'low' },
  'P0128': { description: 'Coolant Thermostat Below Regulating Temperature', category: 'Cooling', severity: 'low' },
  'P0351': { description: 'Ignition Coil A Primary/Secondary Circuit', category: 'Ignition', severity: 'high' },
  'P0120': { description: 'Throttle Position Sensor Circuit Malfunction', category: 'Throttle', severity: 'high' },
};

export function getCommonDtcInfo(code) {
  if (!code) return null;
  return COMMON_DTC_INFO[code.toUpperCase()] || null;
}

// ============================================
// VEHICLE DATABASE
// ============================================

export const COMMON_MAKES = [
  'Acura', 'Audi', 'BMW', 'Buick', 'Cadillac', 'Chevrolet', 'Chrysler',
  'Dodge', 'Ford', 'GMC', 'Honda', 'Hyundai', 'Infiniti', 'Jeep', 'Kia',
  'Lexus', 'Lincoln', 'Mazda', 'Mercedes-Benz', 'Mitsubishi', 'Nissan',
  'Ram', 'Subaru', 'Tesla', 'Toyota', 'Volkswagen', 'Volvo'
];

export function getYearOptions() {
  const currentYear = new Date().getFullYear() + 1;
  const years = [];
  for (let y = currentYear; y >= 1990; y--) years.push(y);
  return years;
}

export const COMMON_MODELS = {
  'Toyota': ['Camry', 'Corolla', 'RAV4', 'Highlander', 'Tacoma', 'Tundra', '4Runner', 'Prius', 'Sienna'],
  'Honda': ['Accord', 'Civic', 'CR-V', 'Pilot', 'Odyssey', 'HR-V', 'Ridgeline', 'Fit'],
  'Ford': ['F-150', 'F-250', 'F-350', 'Mustang', 'Explorer', 'Escape', 'Edge', 'Bronco', 'Ranger'],
  'Chevrolet': ['Silverado', 'Equinox', 'Tahoe', 'Suburban', 'Malibu', 'Camaro', 'Colorado', 'Traverse'],
  'Nissan': ['Altima', 'Sentra', 'Rogue', 'Pathfinder', 'Frontier', 'Titan', 'Maxima', 'Murano'],
  'Jeep': ['Wrangler', 'Grand Cherokee', 'Cherokee', 'Compass', 'Gladiator', 'Renegade'],
};

export function getModelsForMake(make) {
  try {
    if (typeof window !== 'undefined' && window.VEHICLE_DATA && window.VEHICLE_DATA[make] && window.VEHICLE_DATA[make].models) {
      return Object.keys(window.VEHICLE_DATA[make].models).sort();
    }
  } catch (e) {
    // ignore and fallback
  }
  return COMMON_MODELS[make] || [];
}

// ============================================
// AI LABOR LOOKUP
// ============================================

/**
 * Get vehicle-specific labor time from AI research
 */
export async function getVehicleSpecificLabor({
  operationId,
  operationName,
  dbLaborHours,
  vehicle,
  engineType = null
}) {
  // If no vehicle info, skip AI lookup
  if (!vehicle?.year || !vehicle?.make || !vehicle?.model) {
    console.log('[diagnostics-api] No vehicle info, skipping AI lookup');
    return { status: 'skipped', reason: 'No vehicle info provided' };
  }

  try {
    // Use Vercel backend in production; keep local host for dev
    const isLocalHost = (typeof window !== 'undefined') && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
    const apiUrl = isLocalHost
      ? 'http://127.0.0.1:4000/api/ai-labor-lookup'
      : 'https://xpose-stripe-server.vercel.app/api/ai-labor-lookup';
    
    console.log(`[diagnostics-api] Fetching AI labor from: ${apiUrl}`);
    console.log(`[diagnostics-api] Vehicle: ${vehicle.year} ${vehicle.make} ${vehicle.model} - ${operationName}`);

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        operationId,
        operationName,
        dbLaborHours: {
          low: dbLaborHours?.low || null,
          typical: dbLaborHours?.typical || null,
          high: dbLaborHours?.high || null
        },
        vehicleYear: parseInt(vehicle.year),
        vehicleMake: vehicle.make,
        vehicleModel: vehicle.model,
        engineType: engineType || vehicle.engine || null
      })
    });

    console.log('[diagnostics-api] AI lookup HTTP status:', response.status);

    if (!response.ok) {
      const text = await response.text();
      let parsed = null;
      try { parsed = JSON.parse(text); } catch (e) {}
      console.error('[diagnostics-api] AI labor lookup failed:', response.status, parsed || text);
      return {
        status: 'error',
        error: parsed?.error || `HTTP ${response.status}`,
        fallback: true,
        httpStatus: response.status
      };
    }

    const result = await response.json();
    console.log('[diagnostics-api] AI labor result:', result);
    return result;

  } catch (e) {
    console.error('[diagnostics-api] getVehicleSpecificLabor error:', e);
    return { status: 'error', fallback: true, error: e.message };
  }
}

/**
 * Get general vehicle-specific probable cause for a diagnosis/symptom
 */
export async function getAiGeneralDiagnosis({ diagnosisTitle, vehicleYear, vehicleMake, vehicleModel }) {
  if (!diagnosisTitle || !vehicleYear || !vehicleMake || !vehicleModel) {
    console.log('[diagnostics-api] Missing info for AI general diagnosis');
    return { status: 'skipped', reason: 'Missing required info' };
  }

  try {
    const isLocalHost = (typeof window !== 'undefined') && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
    const apiUrl = isLocalHost
      ? 'http://127.0.0.1:4000/api/ai-diagnosis-general'
      : 'https://xpose-stripe-server.vercel.app/api/ai-diagnosis-general';

    console.log(`[diagnostics-api] Fetching AI general diagnosis from: ${apiUrl}`);
    console.log(`[diagnostics-api] Vehicle: ${vehicleYear} ${vehicleMake} ${vehicleModel} - ${diagnosisTitle}`);

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ diagnosisTitle, vehicleYear: parseInt(vehicleYear), vehicleMake, vehicleModel })
    });

    console.log('[diagnostics-api] AI general HTTP status:', response.status);

    if (!response.ok) {
      const text = await response.text();
      let parsed = null;
      try { parsed = JSON.parse(text); } catch (e) {}
      console.error('[diagnostics-api] AI general lookup failed:', response.status, parsed || text);
      return { status: 'error', error: parsed?.error || `HTTP ${response.status}`, fallback: true, httpStatus: response.status };
    }

    const result = await response.json();
    console.log('[diagnostics-api] AI general result:', result);
    return result;
  } catch (e) {
    console.error('[diagnostics-api] getAiGeneralDiagnosis error:', e);
    return { status: 'error', fallback: true, error: e.message };
  }
}

/**
 * Get cached labor entries for a vehicle (direct Supabase query)
 */
export async function getCachedLaborForVehicle({ operationId, vehicle }) {
  const supabase = getSupabaseClient();
  if (!supabase || !vehicle?.year || !vehicle?.make || !vehicle?.model) return [];

  try {
    const { data, error } = await supabase
      .from('vehicle_labor_cache')
      .select('*')
      .eq('operation_id', operationId)
      .eq('vehicle_year', parseInt(vehicle.year))
      .ilike('vehicle_make', vehicle.make)
      .ilike('vehicle_model', vehicle.model);

    if (error) throw error;
    return data || [];
  } catch (e) {
    console.error('[diagnostics-api] getCachedLaborForVehicle error:', e);
    return [];
  }
}

// ============================================
// AI DYNAMIC TRIAGE (Conversational Diagnosis)
// ============================================

/**
 * Start or continue an AI-powered diagnostic conversation
 * AI asks 3-5 smart questions then provides diagnosis with TSBs/recalls
 * 
 * @param {Object} params
 * @param {string} params.symptom - The symptom/issue being diagnosed
 * @param {number|string} params.vehicleYear
 * @param {string} params.vehicleMake  
 * @param {string} params.vehicleModel
 * @param {string} [params.engineType] - Optional engine type
 * @param {Array<{role: string, content: string}>} [params.conversation] - Conversation history
 * @param {number} [params.questionCount] - Number of questions asked so far
 * @returns {Promise<Object>} Either a question or final diagnosis
 */
export async function getAiDynamicTriage({
  symptom,
  vehicleYear,
  vehicleMake,
  vehicleModel,
  engineType = null,
  conversation = [],
  questionCount = 0
}) {
  if (!symptom || !vehicleYear || !vehicleMake || !vehicleModel) {
    console.log('[diagnostics-api] Missing info for AI dynamic triage');
    return { type: 'error', error: 'Missing required vehicle/symptom info' };
  }

  try {
    const isLocalHost = (typeof window !== 'undefined') && 
      (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
    const apiUrl = isLocalHost
      ? 'http://127.0.0.1:4000/api/ai-dynamic-triage'
      : 'https://xpose-stripe-server.vercel.app/api/ai-dynamic-triage';

    console.log(`[diagnostics-api] AI Dynamic Triage: ${vehicleYear} ${vehicleMake} ${vehicleModel} - ${symptom}`);
    console.log(`[diagnostics-api] Question count: ${questionCount}, Conversation length: ${conversation.length}`);

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        symptom,
        vehicleYear: parseInt(vehicleYear),
        vehicleMake,
        vehicleModel,
        engineType,
        conversation,
        questionCount
      })
    });

    console.log('[diagnostics-api] AI dynamic triage HTTP status:', response.status);

    if (!response.ok) {
      const text = await response.text();
      let parsed = null;
      try { parsed = JSON.parse(text); } catch (e) {}
      console.error('[diagnostics-api] AI dynamic triage failed:', response.status, parsed || text);
      return {
        type: 'error',
        error: parsed?.error || `HTTP ${response.status}`,
        httpStatus: response.status
      };
    }

    const result = await response.json();
    console.log('[diagnostics-api] AI dynamic triage result:', result);
    return result;

  } catch (e) {
    console.error('[diagnostics-api] getAiDynamicTriage error:', e);
    return { type: 'error', error: e.message };
  }
}

// ============================================
// VIN DECODE (for fuel type, engine info)
// ============================================

/**
 * Decode a VIN using NHTSA API to get vehicle details including fuel type
 * @param {string} vin - The VIN to decode
 * @returns {Promise<Object>} Decoded vehicle info with fuelType, engineType, etc.
 */
export async function decodeVinForCortex(vin) {
  if (!vin || vin.length !== 17) {
    return { success: false, error: 'Invalid VIN' };
  }

  try {
    const response = await fetch(`https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/${vin}?format=json`);
    if (!response.ok) throw new Error(`NHTSA API error: ${response.status}`);
    
    const data = await response.json();
    const results = data.Results?.[0];
    
    if (!results || results.ErrorCode !== '0') {
      return { success: false, error: results?.ErrorText || 'Failed to decode VIN' };
    }

    // Extract relevant fields
    const decoded = {
      success: true,
      year: results.ModelYear || null,
      make: results.Make || null,
      model: results.Model || null,
      trim: results.Trim || null,
      engineSize: results.DisplacementL || results.DisplacementCC || null,
      engineCylinders: results.EngineCylinders || null,
      engineConfig: results.EngineConfiguration || null,
      fuelType: results.FuelTypePrimary || null,  // e.g., "Gasoline", "Diesel", "Electric"
      fuelTypeSecondary: results.FuelTypeSecondary || null,
      driveType: results.DriveType || null,
      transmissionType: results.TransmissionStyle || null,
      bodyClass: results.BodyClass || null,
      vehicleType: results.VehicleType || null,
      // Derived helper flags
      isDiesel: (results.FuelTypePrimary || '').toLowerCase().includes('diesel'),
      isElectric: (results.FuelTypePrimary || '').toLowerCase().includes('electric'),
      isHybrid: (results.FuelTypePrimary || '').toLowerCase().includes('hybrid') || 
                (results.FuelTypeSecondary || '').toLowerCase().includes('electric'),
      isGasoline: (results.FuelTypePrimary || '').toLowerCase().includes('gasoline') ||
                  (results.FuelTypePrimary || '').toLowerCase().includes('gas')
    };

    console.log('[diagnostics-api] VIN decoded:', decoded);
    return decoded;

  } catch (e) {
    console.error('[diagnostics-api] decodeVinForCortex error:', e);
    return { success: false, error: e.message };
  }
}

// ============================================
// VEHICLE COMPATIBILITY CHECK
// ============================================

// Common codes/services that are powertrain-specific
const DIESEL_ONLY_PATTERNS = [
  /glow\s*plug/i,
  /P06[67]\d/i,        // P0670-P0679 Glow Plug codes
  /P0380/i,            // Glow Plug Heater Circuit
  /diesel\s*particulate/i,
  /DPF/i,
  /DEF/i,
  /urea/i,
  /injector\s*pump/i,
  /injection\s*pump/i,
  /turbo.*diesel/i
];

const GASOLINE_ONLY_PATTERNS = [
  /spark\s*plug/i,
  /ignition\s*coil/i,
  /P030[0-9]/i,        // P0300-P0309 Misfire codes (gas engines)
  /P035[0-9]/i,        // P0350-P0359 Ignition Coil codes
  /catalytic\s*converter/i,
  /O2\s*sensor/i,
  /oxygen\s*sensor/i,
  /MAF.*sensor/i,
  /throttle\s*body/i
];

const ELECTRIC_INCOMPATIBLE_PATTERNS = [
  /oil\s*change/i,
  /spark\s*plug/i,
  /glow\s*plug/i,
  /fuel\s*filter/i,
  /fuel\s*pump/i,
  /exhaust/i,
  /catalytic/i,
  /transmission\s*fluid/i,
  /radiator/i,
  /coolant/i  // EVs have coolant but different system
];

/**
 * Check if a diagnostic code or service is compatible with vehicle powertrain
 * @param {string} codeOrService - The DTC code or service name
 * @param {Object} vehicleInfo - Vehicle info including fuelType, isDiesel, isElectric, isGasoline
 * @returns {Object|null} Compatibility warning or null if compatible
 */
export function checkVehicleCompatibility(codeOrService, vehicleInfo) {
  if (!codeOrService || !vehicleInfo) return null;
  
  const { fuelType, isDiesel, isElectric, isGasoline, year, make, model } = vehicleInfo;
  const searchTerm = codeOrService.toString();
  const vehicleDesc = `${year || ''} ${make || ''} ${model || ''}`.trim();

  // Check diesel-only patterns on non-diesel vehicle
  if (!isDiesel) {
    for (const pattern of DIESEL_ONLY_PATTERNS) {
      if (pattern.test(searchTerm)) {
        return {
          type: 'incompatible',
          severity: 'warning',
          title: 'Vehicle Compatibility Notice',
          message: `This diagnostic code/service (${searchTerm}) is typically associated with **diesel engines**. The vehicle on this job is a **${vehicleDesc}** which has a **${fuelType || 'gasoline'}** powertrain.`,
          suggestion: 'Please verify this code was read correctly, or confirm if the vehicle information needs to be updated.',
          expectedPowertrain: 'diesel',
          actualPowertrain: fuelType || 'gasoline'
        };
      }
    }
  }

  // Check gasoline-only patterns on diesel vehicle
  if (isDiesel) {
    for (const pattern of GASOLINE_ONLY_PATTERNS) {
      if (pattern.test(searchTerm)) {
        return {
          type: 'incompatible',
          severity: 'warning',
          title: 'Vehicle Compatibility Notice',
          message: `This diagnostic code/service (${searchTerm}) is typically associated with **gasoline engines**. The vehicle on this job is a **${vehicleDesc}** which has a **diesel** powertrain.`,
          suggestion: 'Please verify this code was read correctly, or confirm if the vehicle information needs to be updated.',
          expectedPowertrain: 'gasoline',
          actualPowertrain: 'diesel'
        };
      }
    }
  }

  // Check ICE patterns on electric vehicle
  if (isElectric) {
    for (const pattern of ELECTRIC_INCOMPATIBLE_PATTERNS) {
      if (pattern.test(searchTerm)) {
        return {
          type: 'incompatible',
          severity: 'warning',
          title: 'Vehicle Compatibility Notice',
          message: `This service (${searchTerm}) is typically associated with **internal combustion engines**. The vehicle on this job is a **${vehicleDesc}** which is **electric**.`,
          suggestion: 'Electric vehicles have different maintenance requirements. Please verify this service applies to this vehicle.',
          expectedPowertrain: 'ICE',
          actualPowertrain: 'electric'
        };
      }
    }
  }

  return null; // Compatible or no issues detected
}

export default {
  unifiedSearch, searchPlaybooks, searchOperations, getPlaybookById, getOperationById,
  logSearchRequest, logDiagnosticRequest, recordFixOutcome, getFixStatistics,
  submitFeedback, submitPlaybookFeedback, getCommonDtcInfo, COMMON_MAKES, getYearOptions,
  getModelsForMake, getVehicleSpecificLabor, getCachedLaborForVehicle, getAiDiagnosticAnalysis, getAiGeneralDiagnosis,
  getAiDynamicTriage, decodeVinForCortex, checkVehicleCompatibility
};
