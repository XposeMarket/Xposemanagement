/**
 * helpers/diagnostics-api.js
 * 
 * Unified API for diagnostic playbooks AND service operations
 * Provides a single search interface that returns both types of results
 * 
 * Result types:
 * - 'playbook' = Diagnostic guide (DTC codes, symptoms)
 * - 'operation' = Service/Labor guide (spark plugs, brakes, etc)
 */

import { getSupabaseClient } from './supabase.js';

// ============================================
// UNIFIED SEARCH
// ============================================

/**
 * Search both playbooks and service operations
 * Returns mixed results sorted by relevance
 * 
 * @param {object} params
 * @param {string} params.query - Free text search query
 * @param {string[]} params.dtcCodes - DTC codes to search for
 * @param {string[]} params.symptoms - Symptoms to search for  
 * @param {object} params.vehicleTags - {make, model, year}
 * @param {string} params.shopId - Shop ID for shop-specific results
 * @returns {Promise<{playbooks: [], operations: [], combined: []}>}
 */
export async function unifiedSearch({ query = '', dtcCodes = [], symptoms = [], vehicleTags = {}, shopId = null }) {
  const supabase = getSupabaseClient();
  if (!supabase) {
    console.warn('[diagnostics-api] No Supabase client');
    return { playbooks: [], operations: [], combined: [] };
  }

  // Normalize query for searching
  const normalizedQuery = query.toLowerCase().trim();
  const queryWords = normalizedQuery.split(/\s+/).filter(w => w.length > 1);

  // Search both tables in parallel
  const [playbookResults, operationResults] = await Promise.all([
    searchPlaybooks({ query: normalizedQuery, dtcCodes, symptoms, vehicleTags, shopId }),
    searchOperations({ query: normalizedQuery, keywords: queryWords, vehicleTags, shopId })
  ]);

  // Combine and sort by score
  const combined = [
    ...playbookResults.map(p => ({ ...p, resultType: 'playbook' })),
    ...operationResults.map(o => ({ ...o, resultType: 'operation' }))
  ].sort((a, b) => (b.score || 0) - (a.score || 0));

  console.log(`[diagnostics-api] Unified search found ${playbookResults.length} playbooks, ${operationResults.length} operations`);

  return {
    playbooks: playbookResults,
    operations: operationResults,
    combined
  };
}

// ============================================
// PLAYBOOK SEARCH (Diagnostics)
// ============================================

/**
 * Search diagnostic playbooks
 */
export async function searchPlaybooks({ query = '', dtcCodes = [], symptoms = [], vehicleTags = {}, shopId = null }) {
  const supabase = getSupabaseClient();
  if (!supabase) return [];

  try {
    // Build query
    let dbQuery = supabase
      .from('diagnostic_playbooks')
      .select('*')
      .eq('is_active', true);

    const { data, error } = await dbQuery;
    if (error) throw error;

    // Score and filter results
    const scored = (data || []).map(playbook => {
      let score = 0;
      const matchReasons = [];

      // DTC code matching (highest priority)
      const pbCodes = playbook.dtc_codes || [];
      for (const code of dtcCodes) {
        if (pbCodes.some(c => c.toUpperCase() === code.toUpperCase())) {
          score += 100;
          matchReasons.push(`DTC: ${code}`);
        }
      }

      // Symptom matching
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

      // Free text query matching
      if (query) {
        const queryLower = query.toLowerCase();
        // Title match
        if (playbook.title.toLowerCase().includes(queryLower)) {
          score += 40;
          matchReasons.push('Title match');
        }
        // Keyword match
        if (allPbTerms.some(t => t.includes(queryLower))) {
          score += 30;
          matchReasons.push('Keyword match');
        }
        // Summary match
        const summary = playbook.playbook?.summary || '';
        if (summary.toLowerCase().includes(queryLower)) {
          score += 20;
          matchReasons.push('Summary match');
        }
      }

      // Vehicle tag matching (bonus)
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

      // Shop-specific boost
      if (shopId && playbook.shop_id === shopId) {
        score += 5;
        matchReasons.push('Shop-specific');
      }

      // Confidence multiplier
      score *= (playbook.confidence || 0.7);

      return { ...playbook, score, matchReasons };
    });

    // Filter to only matches and sort by score
    const results = scored
      .filter(p => p.score > 0)
      .sort((a, b) => b.score - a.score);

    console.log(`[diagnostics-api] Found ${results.length} matching playbooks`);
    return results;

  } catch (e) {
    console.error('[diagnostics-api] searchPlaybooks error:', e);
    return [];
  }
}

// ============================================
// SERVICE OPERATION SEARCH (Labor Guide)
// ============================================

/**
 * Search service operations (labor guide)
 */
export async function searchOperations({ query = '', keywords = [], vehicleTags = {}, shopId = null }) {
  const supabase = getSupabaseClient();
  if (!supabase) return [];

  // Skip if no search terms
  if (!query && keywords.length === 0) return [];

  try {
    const { data, error } = await supabase
      .from('service_operations')
      .select('*')
      .eq('is_active', true);

    if (error) throw error;

    const queryLower = query.toLowerCase();
    const keywordsLower = keywords.map(k => k.toLowerCase());

    // Score and filter results
    const scored = (data || []).map(operation => {
      let score = 0;
      const matchReasons = [];

      const opKeywords = (operation.keywords || []).map(k => k.toLowerCase());
      const opName = operation.name.toLowerCase();
      const opCategory = (operation.category || '').toLowerCase();
      const opSummary = (operation.summary || '').toLowerCase();

      // Exact name match (highest priority)
      if (opName === queryLower) {
        score += 100;
        matchReasons.push('Exact name match');
      } else if (opName.includes(queryLower)) {
        score += 70;
        matchReasons.push('Name contains query');
      }

      // Keyword matches
      for (const kw of keywordsLower) {
        if (opKeywords.includes(kw)) {
          score += 50;
          matchReasons.push(`Keyword: ${kw}`);
        } else if (opKeywords.some(ok => ok.includes(kw) || kw.includes(ok))) {
          score += 30;
          matchReasons.push(`Partial keyword: ${kw}`);
        }
      }

      // Category match
      if (queryLower && opCategory.includes(queryLower)) {
        score += 20;
        matchReasons.push('Category match');
      }

      // Summary match
      if (queryLower && opSummary.includes(queryLower)) {
        score += 15;
        matchReasons.push('Summary match');
      }

      // Related DTC codes
      const relatedCodes = operation.related_dtc_codes || [];
      // (we could boost if query contains a DTC code)

      // Vehicle tag matching
      if (vehicleTags.make && operation.vehicle_tags?.make) {
        if (vehicleTags.make.toLowerCase() === operation.vehicle_tags.make.toLowerCase()) {
          score += 20;
          matchReasons.push('Make-specific');
        }
      }

      // Shop-specific boost
      if (shopId && operation.shop_id === shopId) {
        score += 10;
        matchReasons.push('Shop-specific');
      }

      return { ...operation, score, matchReasons };
    });

    const results = scored
      .filter(o => o.score > 0)
      .sort((a, b) => b.score - a.score);

    console.log(`[diagnostics-api] Found ${results.length} matching operations`);
    return results;

  } catch (e) {
    console.error('[diagnostics-api] searchOperations error:', e);
    return [];
  }
}

/**
 * Get operation by ID
 */
export async function getOperationById(operationId) {
  const supabase = getSupabaseClient();
  if (!supabase) return null;

  try {
    const { data, error } = await supabase
      .from('service_operations')
      .select('*')
      .eq('id', operationId)
      .single();

    if (error) throw error;
    return data;
  } catch (e) {
    console.error('[diagnostics-api] getOperationById error:', e);
    return null;
  }
}

// ============================================
// PLAYBOOK HELPERS
// ============================================

/**
 * Get playbook by ID
 */
export async function getPlaybookById(playbookId) {
  const supabase = getSupabaseClient();
  if (!supabase) return null;

  try {
    const { data, error } = await supabase
      .from('diagnostic_playbooks')
      .select('*')
      .eq('id', playbookId)
      .single();

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

/**
 * Log a diagnostic/service search request
 */
export async function logSearchRequest({
  shopId = null,
  jobId = null,
  appointmentId = null,
  searchQuery = '',
  searchType = 'general',
  inputData = {},
  resultType = 'none',
  matchedPlaybookId = null,
  matchedOperationId = null,
  vehicleYear = null,
  vehicleMake = null,
  vehicleModel = null
}) {
  const supabase = getSupabaseClient();
  if (!supabase) return null;

  try {
    // Get shop ID from session if not provided
    if (!shopId) {
      try {
        const session = JSON.parse(localStorage.getItem('xm_session') || '{}');
        shopId = session.shopId || null;
      } catch (e) {}
    }

    const { data, error } = await supabase
      .from('diagnostic_requests')
      .insert({
        shop_id: shopId,
        job_id: jobId,
        appointment_id: appointmentId,
        search_query: searchQuery,
        search_type: searchType,
        input_data: inputData,
        result_type: resultType,
        matched_playbook_id: matchedPlaybookId,
        matched_operation_id: matchedOperationId,
        vehicle_year: vehicleYear,
        vehicle_make: vehicleMake,
        vehicle_model: vehicleModel
      })
      .select()
      .single();

    if (error) throw error;
    console.log('✅ Search request logged:', data.id);
    return data;
  } catch (e) {
    console.error('[diagnostics-api] logSearchRequest error:', e);
    return null;
  }
}

// Legacy alias for backward compatibility
export const logDiagnosticRequest = logSearchRequest;

/**
 * Record what fix resolved an issue
 */
export async function recordFixOutcome({
  playbookId = null,
  operationId = null,
  jobId = null,
  serviceName,
  resolved = true,
  mileage = null,
  vehicleYear = null,
  vehicleMake = null,
  vehicleModel = null,
  notes = ''
}) {
  const supabase = getSupabaseClient();
  if (!supabase) return null;

  try {
    let shopId = null;
    try {
      const session = JSON.parse(localStorage.getItem('xm_session') || '{}');
      shopId = session.shopId || null;
    } catch (e) {}

    const { data, error } = await supabase
      .from('diagnostic_fix_outcomes')
      .insert({
        shop_id: shopId,
        playbook_id: playbookId,
        operation_id: operationId,
        job_id: jobId,
        service_name: serviceName,
        resolved,
        mileage,
        vehicle_year: vehicleYear,
        vehicle_make: vehicleMake,
        vehicle_model: vehicleModel,
        notes
      })
      .select()
      .single();

    if (error) throw error;
    console.log('✅ Fix outcome recorded:', data.id);
    return data;
  } catch (e) {
    console.error('[diagnostics-api] recordFixOutcome error:', e);
    return null;
  }
}

/**
 * Get fix statistics for a playbook or operation
 */
export async function getFixStatistics(playbookId = null, operationId = null) {
  const supabase = getSupabaseClient();
  if (!supabase) return { fixStats: [], totalOutcomes: 0 };

  try {
    let query = supabase
      .from('diagnostic_fix_outcomes')
      .select('*');

    if (playbookId) {
      query = query.eq('playbook_id', playbookId);
    } else if (operationId) {
      query = query.eq('operation_id', operationId);
    } else {
      return { fixStats: [], totalOutcomes: 0 };
    }

    const { data, error } = await query;
    if (error) throw error;

    // Aggregate by service_name
    const stats = {};
    for (const outcome of (data || [])) {
      const name = outcome.service_name || 'Unknown';
      if (!stats[name]) {
        stats[name] = { total: 0, resolved: 0 };
      }
      stats[name].total++;
      if (outcome.resolved) stats[name].resolved++;
    }

    // Convert to array and calculate percentages
    const totalOutcomes = data?.length || 0;
    const fixStats = Object.entries(stats)
      .map(([serviceName, counts]) => ({
        serviceName,
        totalCount: counts.total,
        resolvedCount: counts.resolved,
        percentage: totalOutcomes > 0 ? Math.round((counts.resolved / totalOutcomes) * 100) : 0
      }))
      .sort((a, b) => b.resolvedCount - a.resolvedCount);

    return { fixStats, totalOutcomes };
  } catch (e) {
    console.error('[diagnostics-api] getFixStatistics error:', e);
    return { fixStats: [], totalOutcomes: 0 };
  }
}

/**
 * Submit feedback for a playbook or operation
 */
export async function submitFeedback({
  playbookId = null,
  operationId = null,
  verdict,
  notes = ''
}) {
  const supabase = getSupabaseClient();
  if (!supabase) return null;

  try {
    let shopId = null;
    try {
      const session = JSON.parse(localStorage.getItem('xm_session') || '{}');
      shopId = session.shopId || null;
    } catch (e) {}

    const { data, error } = await supabase
      .from('diagnostic_feedback')
      .insert({
        shop_id: shopId,
        playbook_id: playbookId,
        operation_id: operationId,
        verdict,
        notes
      })
      .select()
      .single();

    if (error) throw error;
    console.log('✅ Feedback submitted:', data.id);
    return data;
  } catch (e) {
    console.error('[diagnostics-api] submitFeedback error:', e);
    return null;
  }
}

// Legacy alias
export const submitPlaybookFeedback = submitFeedback;

// ============================================
// COMMON DTC INFO (Static Lookup)
// ============================================

const COMMON_DTC_INFO = {
  // Misfires
  'P0300': { description: 'Random/Multiple Cylinder Misfire Detected', category: 'Misfire', severity: 'high' },
  'P0301': { description: 'Cylinder 1 Misfire Detected', category: 'Misfire', severity: 'high' },
  'P0302': { description: 'Cylinder 2 Misfire Detected', category: 'Misfire', severity: 'high' },
  'P0303': { description: 'Cylinder 3 Misfire Detected', category: 'Misfire', severity: 'high' },
  'P0304': { description: 'Cylinder 4 Misfire Detected', category: 'Misfire', severity: 'high' },
  'P0305': { description: 'Cylinder 5 Misfire Detected', category: 'Misfire', severity: 'high' },
  'P0306': { description: 'Cylinder 6 Misfire Detected', category: 'Misfire', severity: 'high' },
  
  // Fuel System
  'P0171': { description: 'System Too Lean (Bank 1)', category: 'Fuel System', severity: 'medium' },
  'P0172': { description: 'System Too Rich (Bank 1)', category: 'Fuel System', severity: 'medium' },
  'P0174': { description: 'System Too Lean (Bank 2)', category: 'Fuel System', severity: 'medium' },
  'P0175': { description: 'System Too Rich (Bank 2)', category: 'Fuel System', severity: 'medium' },
  
  // Oxygen Sensors
  'P0130': { description: 'O2 Sensor Circuit (Bank 1, Sensor 1)', category: 'Oxygen Sensor', severity: 'medium' },
  'P0131': { description: 'O2 Sensor Low Voltage (Bank 1, Sensor 1)', category: 'Oxygen Sensor', severity: 'medium' },
  'P0133': { description: 'O2 Sensor Slow Response (Bank 1, Sensor 1)', category: 'Oxygen Sensor', severity: 'medium' },
  'P0134': { description: 'O2 Sensor No Activity (Bank 1, Sensor 1)', category: 'Oxygen Sensor', severity: 'medium' },
  'P0136': { description: 'O2 Sensor Circuit (Bank 1, Sensor 2)', category: 'Oxygen Sensor', severity: 'low' },
  'P0137': { description: 'O2 Sensor Low Voltage (Bank 1, Sensor 2)', category: 'Oxygen Sensor', severity: 'low' },
  'P0140': { description: 'O2 Sensor No Activity (Bank 1, Sensor 2)', category: 'Oxygen Sensor', severity: 'low' },
  'P0141': { description: 'O2 Sensor Heater Circuit (Bank 1, Sensor 2)', category: 'Oxygen Sensor', severity: 'low' },
  
  // Catalyst
  'P0420': { description: 'Catalyst System Efficiency Below Threshold (Bank 1)', category: 'Emissions', severity: 'medium' },
  'P0430': { description: 'Catalyst System Efficiency Below Threshold (Bank 2)', category: 'Emissions', severity: 'medium' },
  
  // EVAP
  'P0440': { description: 'Evaporative Emission System Malfunction', category: 'EVAP', severity: 'low' },
  'P0441': { description: 'EVAP Incorrect Purge Flow', category: 'EVAP', severity: 'low' },
  'P0442': { description: 'EVAP System Small Leak Detected', category: 'EVAP', severity: 'low' },
  'P0446': { description: 'EVAP Vent System Performance', category: 'EVAP', severity: 'low' },
  'P0455': { description: 'EVAP System Large Leak Detected', category: 'EVAP', severity: 'low' },
  'P0456': { description: 'EVAP System Very Small Leak Detected', category: 'EVAP', severity: 'low' },
  
  // Cooling System
  'P0125': { description: 'Insufficient Coolant Temp for Closed Loop', category: 'Cooling', severity: 'low' },
  'P0126': { description: 'Insufficient Coolant Temp for Stable Operation', category: 'Cooling', severity: 'low' },
  'P0128': { description: 'Coolant Thermostat Below Regulating Temperature', category: 'Cooling', severity: 'low' },
  
  // Ignition
  'P0351': { description: 'Ignition Coil A Primary/Secondary Circuit', category: 'Ignition', severity: 'high' },
  'P0352': { description: 'Ignition Coil B Primary/Secondary Circuit', category: 'Ignition', severity: 'high' },
  'P0353': { description: 'Ignition Coil C Primary/Secondary Circuit', category: 'Ignition', severity: 'high' },
  'P0354': { description: 'Ignition Coil D Primary/Secondary Circuit', category: 'Ignition', severity: 'high' },
  
  // Starter
  'P0615': { description: 'Starter Relay Circuit', category: 'Starting', severity: 'high' },
  'P0616': { description: 'Starter Relay Circuit Low', category: 'Starting', severity: 'high' },
  'P0617': { description: 'Starter Relay Circuit High', category: 'Starting', severity: 'high' },
  
  // Mass Air Flow
  'P0100': { description: 'Mass Air Flow Circuit Malfunction', category: 'Air Metering', severity: 'medium' },
  'P0101': { description: 'Mass Air Flow Circuit Range/Performance', category: 'Air Metering', severity: 'medium' },
  'P0102': { description: 'Mass Air Flow Circuit Low', category: 'Air Metering', severity: 'medium' },
  'P0103': { description: 'Mass Air Flow Circuit High', category: 'Air Metering', severity: 'medium' },
  
  // Throttle
  'P0120': { description: 'Throttle Position Sensor Circuit Malfunction', category: 'Throttle', severity: 'high' },
  'P0121': { description: 'Throttle Position Sensor Range/Performance', category: 'Throttle', severity: 'medium' },
  'P0122': { description: 'Throttle Position Sensor Circuit Low', category: 'Throttle', severity: 'high' },
  'P0123': { description: 'Throttle Position Sensor Circuit High', category: 'Throttle', severity: 'high' }
};

/**
 * Get info about a common DTC code (instant, no DB)
 */
export function getCommonDtcInfo(code) {
  if (!code) return null;
  return COMMON_DTC_INFO[code.toUpperCase()] || null;
}

// ============================================
// VEHICLE DATABASE (Makes/Models for dropdown)
// ============================================

// Common makes for Y/M/M selector
export const COMMON_MAKES = [
  'Acura', 'Audi', 'BMW', 'Buick', 'Cadillac', 'Chevrolet', 'Chrysler',
  'Dodge', 'Ford', 'GMC', 'Honda', 'Hyundai', 'Infiniti', 'Jeep', 'Kia',
  'Lexus', 'Lincoln', 'Mazda', 'Mercedes-Benz', 'Mitsubishi', 'Nissan',
  'Ram', 'Subaru', 'Tesla', 'Toyota', 'Volkswagen', 'Volvo'
];

// Years (current year down to 1990)
export function getYearOptions() {
  const currentYear = new Date().getFullYear() + 1; // Include next year for new models
  const years = [];
  for (let y = currentYear; y >= 1990; y--) {
    years.push(y);
  }
  return years;
}

// Common models by make (simplified list)
export const COMMON_MODELS = {
  'Toyota': ['Camry', 'Corolla', 'RAV4', 'Highlander', 'Tacoma', 'Tundra', '4Runner', 'Prius', 'Sienna'],
  'Honda': ['Accord', 'Civic', 'CR-V', 'Pilot', 'Odyssey', 'HR-V', 'Ridgeline', 'Fit'],
  'Ford': ['F-150', 'F-250', 'F-350', 'Mustang', 'Explorer', 'Escape', 'Edge', 'Bronco', 'Ranger'],
  'Chevrolet': ['Silverado', 'Equinox', 'Tahoe', 'Suburban', 'Malibu', 'Camaro', 'Colorado', 'Traverse'],
  'Nissan': ['Altima', 'Sentra', 'Rogue', 'Pathfinder', 'Frontier', 'Titan', 'Maxima', 'Murano'],
  'Jeep': ['Wrangler', 'Grand Cherokee', 'Cherokee', 'Compass', 'Gladiator', 'Renegade'],
  'BMW': ['3 Series', '5 Series', 'X3', 'X5', 'X1', '7 Series', 'X7'],
  'Mercedes-Benz': ['C-Class', 'E-Class', 'GLC', 'GLE', 'S-Class', 'A-Class'],
  'Hyundai': ['Elantra', 'Sonata', 'Tucson', 'Santa Fe', 'Palisade', 'Kona'],
  'Kia': ['Optima', 'Sorento', 'Sportage', 'Telluride', 'Forte', 'Soul'],
  'Subaru': ['Outback', 'Forester', 'Crosstrek', 'Impreza', 'Ascent', 'Legacy', 'WRX'],
  'Volkswagen': ['Jetta', 'Passat', 'Tiguan', 'Atlas', 'Golf', 'ID.4'],
  'Dodge': ['Charger', 'Challenger', 'Durango', 'Journey', 'Grand Caravan'],
  'Ram': ['1500', '2500', '3500', 'ProMaster'],
  'GMC': ['Sierra', 'Yukon', 'Terrain', 'Acadia', 'Canyon'],
  'Lexus': ['RX', 'ES', 'NX', 'IS', 'GX', 'LX'],
  'Audi': ['A4', 'A6', 'Q5', 'Q7', 'A3', 'Q3'],
  'Mazda': ['CX-5', 'CX-9', 'Mazda3', 'Mazda6', 'CX-30', 'MX-5 Miata']
};

/**
 * Get models for a make
 */
export function getModelsForMake(make) {
  return COMMON_MODELS[make] || [];
}

export default {
  unifiedSearch,
  searchPlaybooks,
  searchOperations,
  getPlaybookById,
  getOperationById,
  logSearchRequest,
  logDiagnosticRequest,
  recordFixOutcome,
  getFixStatistics,
  submitFeedback,
  submitPlaybookFeedback,
  getCommonDtcInfo,
  COMMON_MAKES,
  getYearOptions,
  getModelsForMake
};
