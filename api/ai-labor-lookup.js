/**
 * api/ai-labor-lookup.js
 * 
 * AI-powered labor time research using OpenAI
 * Searches for REAL labor times from industry sources
 * Caches results globally for platform-wide reuse
 */

const { createClient } = require('@supabase/supabase-js');

module.exports = async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  console.log('[ai-labor-lookup] Request received');

  // Check for required env vars
  if (!process.env.OPENAI_API_KEY) {
    console.error('[ai-labor-lookup] OPENAI_API_KEY not configured');
    return res.status(500).json({
      status: 'error',
      error: 'OpenAI API key not configured',
      fallback: true
    });
  }

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('[ai-labor-lookup] Supabase credentials not configured');
    return res.status(500).json({
      status: 'error',
      error: 'Database not configured',
      fallback: true
    });
  }

  // Initialize Supabase
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  const {
    operationId,
    operationName,
    dbLaborHours,
    vehicleYear,
    vehicleMake,
    vehicleModel,
    engineType
  } = req.body;

  // Validate required fields
  if (!operationName || !vehicleYear || !vehicleMake || !vehicleModel) {
    return res.status(400).json({ 
      status: 'error', 
      error: 'Missing required fields: operationName, vehicleYear, vehicleMake, vehicleModel',
      fallback: true
    });
  }

  console.log(`[ai-labor-lookup] Request: ${vehicleYear} ${vehicleMake} ${vehicleModel} - ${operationName}`);

  try {
    // ========================================
    // STEP 1: Check cache first
    // ========================================
    let cachedResults = [];

    try {
      let cacheQuery = supabase
        .from('vehicle_labor_cache')
        .select('*')
        .eq('operation_id', operationId)
        .eq('vehicle_year', vehicleYear)
        .ilike('vehicle_make', vehicleMake)
        .ilike('vehicle_model', vehicleModel);

      if (engineType) {
        cacheQuery = cacheQuery.ilike('engine_type', engineType);
      }

      const result = await cacheQuery;
      cachedResults = result.data || [];

      if (result.error) {
        console.error('[ai-labor-lookup] Cache query error:', result.error.message);
      }
    } catch (e) {
      console.error('[ai-labor-lookup] Cache query exception:', e.message);
    }

    // If we have engine type and exact cache hit, return it
    if (engineType && cachedResults.length >= 1) {
      const cached = cachedResults[0];
      console.log(`[ai-labor-lookup] Cache HIT for ${vehicleYear} ${vehicleMake} ${vehicleModel} ${engineType}`);

      return res.json({
        status: 'complete',
        source: 'cache',
        data: formatCachedData(cached)
      });
    }

    // If no engine type but we have multiple cached variants, ask user to pick
    if (!engineType && cachedResults.length > 1) {
      const variants = cachedResults.map(c => ({
        engine_type: c.engine_type,
        labor_hours_low: c.ai_labor_hours_low,
        labor_hours_typical: c.ai_labor_hours_typical,
        labor_hours_high: c.ai_labor_hours_high,
        confidence: c.ai_labor_confidence,
        notes: c.ai_labor_notes,
        is_most_common: c.is_most_common || false
      }));

      console.log(`[ai-labor-lookup] Cache has ${variants.length} engine variants`);

      return res.json({
        status: 'needs_engine_selection',
        source: 'cache',
        variants,
        message: `Multiple engine options found for ${vehicleYear} ${vehicleMake} ${vehicleModel}`
      });
    }

    // If we have exactly one cached result, return it
    if (!engineType && cachedResults.length === 1) {
      const cached = cachedResults[0];
      console.log(`[ai-labor-lookup] Cache HIT (single) for ${vehicleYear} ${vehicleMake} ${vehicleModel}`);

      return res.json({
        status: 'complete',
        source: 'cache',
        data: formatCachedData(cached)
      });
    }

    // ========================================
    // STEP 2: No cache hit - Call OpenAI
    // ========================================
    console.log(`[ai-labor-lookup] Cache MISS - calling OpenAI`);

    const searchPrompt = buildSearchPrompt({
      operationName,
      vehicleYear,
      vehicleMake,
      vehicleModel,
      engineType,
      dbLaborHours
    });

    const openaiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content: 'You are an expert automotive service advisor and labor time researcher. Find REAL, ACCURATE labor times from actual industry sources like RepairPal, YourMechanic, Mitchell 1, MOTOR, AllData, and automotive forums. Be specific to the exact vehicle. You must respond with ONLY valid JSON, no markdown.'
          },
          {
            role: 'user',
            content: searchPrompt
          }
        ],
        temperature: 0.3,
        max_tokens: 2000,
        response_format: { type: 'json_object' }
      })
    });

    if (!openaiResponse.ok) {
      const errorText = await openaiResponse.text();
      console.error('[ai-labor-lookup] OpenAI error:', openaiResponse.status, errorText);
      throw new Error(`OpenAI API error: ${openaiResponse.status}`);
    }

    const openaiData = await openaiResponse.json();
    const aiContent = openaiData.choices[0]?.message?.content;

    if (!aiContent) {
      throw new Error('No content in OpenAI response');
    }

    const aiResult = JSON.parse(aiContent);
    console.log('[ai-labor-lookup] OpenAI succeeded');

    // ========================================
    // STEP 3: Handle the response
    // ========================================

    if (aiResult.needs_engine_selection && !engineType && aiResult.engine_variants?.length > 1) {
      // Multiple engines found - cache each variant
      for (const variant of aiResult.engine_variants) {
        await upsertCacheEntry(supabase, {
          operationId,
          vehicleYear,
          vehicleMake,
          vehicleModel,
          engineType: variant.engine_type,
          laborHoursLow: variant.labor_hours_low,
          laborHoursTypical: variant.labor_hours_typical,
          laborHoursHigh: variant.labor_hours_high,
          confidence: variant.confidence || 'medium',
          laborNotes: variant.notes || variant.labor_notes,
          sources: variant.sources || aiResult.sources || [],
          requiredTools: variant.required_tools || [],
          vehicleSpecificTips: variant.vehicle_specific_tips || [],
          isMostCommon: variant.is_most_common || false
        });
      }

      return res.json({
        status: 'needs_engine_selection',
        source: 'ai',
        variants: aiResult.engine_variants,
        message: `${vehicleYear} ${vehicleMake} ${vehicleModel} has multiple engine options`
      });
    }

    // Single result
    const result = aiResult.single_result || aiResult;
    const finalEngineType = result.engine_type || engineType || 'all';

    // Cache the result
    await upsertCacheEntry(supabase, {
      operationId,
      vehicleYear,
      vehicleMake,
      vehicleModel,
      engineType: finalEngineType,
      laborHoursLow: result.labor_hours_low,
      laborHoursTypical: result.labor_hours_typical,
      laborHoursHigh: result.labor_hours_high,
      confidence: result.confidence || 'medium',
      laborNotes: result.labor_notes,
      sources: result.sources || [],
      requiredTools: result.required_tools || [],
      vehicleSpecificTips: result.vehicle_specific_tips || [],
      isMostCommon: false
    });

    return res.json({
      status: 'complete',
      source: 'ai',
      data: {
        engine_type: finalEngineType,
        labor_hours_low: result.labor_hours_low,
        labor_hours_typical: result.labor_hours_typical,
        labor_hours_high: result.labor_hours_high,
        confidence: result.confidence || 'medium',
        labor_notes: result.labor_notes,
        sources: result.sources || [],
        required_tools: result.required_tools || [],
        vehicle_specific_tips: result.vehicle_specific_tips || []
      }
    });

  } catch (error) {
    console.error('[ai-labor-lookup] Error:', error.message);
    return res.status(500).json({
      status: 'error',
      error: error.message,
      fallback: true
    });
  }
};

/**
 * Format cached data for response
 */
function formatCachedData(cached) {
  return {
    engine_type: cached.engine_type,
    labor_hours_low: cached.ai_labor_hours_low,
    labor_hours_typical: cached.ai_labor_hours_typical,
    labor_hours_high: cached.ai_labor_hours_high,
    confidence: cached.ai_labor_confidence,
    labor_notes: cached.ai_labor_notes,
    sources: cached.sources || [],
    required_tools: cached.required_tools || [],
    vehicle_specific_tips: cached.vehicle_specific_tips || []
  };
}

/**
 * Build the search prompt for OpenAI
 */
function buildSearchPrompt({ operationName, vehicleYear, vehicleMake, vehicleModel, engineType, dbLaborHours }) {
  const dbInfo = dbLaborHours 
    ? `\nDATABASE ESTIMATE (generic): ${dbLaborHours.low || '?'}-${dbLaborHours.high || '?'} hrs (typical: ${dbLaborHours.typical || '?'})`
    : '';

  return `Find the REAL labor time for this automotive repair:

SERVICE: ${operationName}
VEHICLE: ${vehicleYear} ${vehicleMake} ${vehicleModel}
${engineType ? `ENGINE: ${engineType}` : 'ENGINE: Check if different engines have different labor times'}
${dbInfo}

Search RepairPal, YourMechanic, Mitchell 1, MOTOR, AllData, automotive forums for real data.

Respond with this JSON:
{
  "needs_engine_selection": boolean,
  "engine_variants": [
    {
      "engine_type": "2.5L 4-cyl",
      "is_most_common": true,
      "labor_hours_low": 0.8,
      "labor_hours_typical": 1.0,
      "labor_hours_high": 1.2,
      "confidence": "high",
      "notes": "Standard brake job"
    }
  ],
  "single_result": {
    "engine_type": "All engines",
    "labor_hours_low": number,
    "labor_hours_typical": number,
    "labor_hours_high": number,
    "confidence": "high" | "medium" | "low",
    "labor_notes": "What affects the time",
    "sources": ["RepairPal"],
    "required_tools": ["tool"],
    "vehicle_specific_tips": ["tip"]
  }
}

Use engine_variants ONLY if engines have significantly different labor times.
Otherwise use single_result.
Confidence: high = multiple sources agree, medium = some data, low = estimated.`;
}

/**
 * Upsert a cache entry
 */
async function upsertCacheEntry(supabase, {
  operationId,
  vehicleYear,
  vehicleMake,
  vehicleModel,
  engineType,
  laborHoursLow,
  laborHoursTypical,
  laborHoursHigh,
  confidence,
  laborNotes,
  sources,
  requiredTools,
  vehicleSpecificTips,
  isMostCommon
}) {
  try {
    const { error } = await supabase
      .from('vehicle_labor_cache')
      .upsert({
        operation_id: operationId,
        vehicle_year: vehicleYear,
        vehicle_make: vehicleMake.toLowerCase(),
        vehicle_model: vehicleModel.toLowerCase(),
        engine_type: (engineType || 'all').toLowerCase(),
        ai_labor_hours_low: laborHoursLow,
        ai_labor_hours_typical: laborHoursTypical,
        ai_labor_hours_high: laborHoursHigh,
        ai_labor_confidence: confidence,
        ai_labor_notes: laborNotes,
        sources: sources || [],
        required_tools: requiredTools || [],
        vehicle_specific_tips: vehicleSpecificTips || [],
        is_most_common: isMostCommon || false,
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'operation_id,vehicle_year,vehicle_make,vehicle_model,engine_type'
      });

    if (error) {
      console.error('[ai-labor-lookup] Cache upsert error:', error.message);
    } else {
      console.log(`[ai-labor-lookup] Cached: ${vehicleYear} ${vehicleMake} ${vehicleModel} ${engineType}`);
    }
  } catch (e) {
    console.error('[ai-labor-lookup] Cache exception:', e.message);
  }
}
