/**
 * /api/ai-dynamic-triage.js
 * 
 * AI-Powered Dynamic Triage System
 * - Asks 3-5 smart diagnostic questions based on vehicle + symptom
 * - Each question adapts based on previous answers
 * - Final response includes diagnosis, TSBs, recalls, and recommendations
 * 
 * COPY THIS FILE TO: xpose-stripe-server/api/ai-dynamic-triage.js
 */

// Use the OpenAI REST API via fetch for consistency with other handlers
// (No `openai` npm dependency required)

module.exports = async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      symptom,           // e.g., "No start", "Rough idle", "Brake noise"
      vehicleYear,
      vehicleMake,
      vehicleModel,
      engineType,        // optional
      conversation,      // Array of {role: 'assistant'|'user', content: string}
      questionCount      // How many questions have been asked so far
    } = req.body;

    if (!symptom || !vehicleYear || !vehicleMake || !vehicleModel) {
      return res.status(400).json({ error: 'Missing required fields: symptom, vehicleYear, vehicleMake, vehicleModel' });
    }

    const vehicle = `${vehicleYear} ${vehicleMake} ${vehicleModel}${engineType ? ` (${engineType})` : ''}`;
    const currentQuestionCount = questionCount || 0;

    // Build the system prompt
    const systemPrompt = `You are Cortex, an expert automotive diagnostic AI assistant. You help technicians diagnose vehicle problems through smart, targeted questions.

VEHICLE: ${vehicle}
SYMPTOM: ${symptom}

YOUR TASK:
You are conducting a diagnostic interview. Ask SHORT, SPECIFIC questions to narrow down the root cause.

RULES:
1. Ask ONE question at a time
2. Questions should be YES/NO or simple multiple choice (2-4 options max)
3. Target 3 questions total, maximum 5 if absolutely needed
4. Each question should significantly narrow the diagnosis
5. Focus on questions a customer or technician can easily answer
6. Consider vehicle-specific known issues for ${vehicleMake} ${vehicleModel}

QUESTION COUNT SO FAR: ${currentQuestionCount}

${currentQuestionCount >= 3 ? `
⚠️ You've asked ${currentQuestionCount} questions. You should provide your diagnosis NOW unless critical information is still missing.
` : ''}

${currentQuestionCount >= 5 ? `
🛑 MAXIMUM QUESTIONS REACHED. You MUST provide your final diagnosis now.
` : ''}

RESPONSE FORMAT:
If you need to ask another question, respond with JSON:
{
  "type": "question",
  "question": "Your diagnostic question here?",
  "options": ["Option 1", "Option 2", "Option 3"],
  "reasoning": "Brief explanation of why this question helps narrow diagnosis"
}

If you have enough information OR have reached 5 questions, respond with JSON:
{
  "type": "diagnosis",
  "probableCause": "Most likely root cause",
  "confidence": "high|medium|low",
  "explanation": "2-3 sentence explanation of why this is the likely cause",
  "additionalPossibilities": ["Other possible cause 1", "Other possible cause 2"],
  "recommendedService": "Primary recommended repair/service",
  "estimatedRepairComplexity": "easy|moderate|difficult|expert",
  "whatToCheck": "Specific diagnostic steps to confirm",
  "tsbs": [
    {"number": "TSB-XXX", "title": "TSB title", "relevance": "How it relates to this issue"}
  ],
  "recalls": [
    {"campaign": "Campaign ID", "description": "Recall description", "relevance": "How it relates"}
  ],
  "knownIssues": [
    {"description": "Known issue description", "frequency": "common|occasional|rare"}
  ],
  "warningsSafety": ["Any safety warnings for this repair"]
}

IMPORTANT: 
- Search your knowledge for TSBs, recalls, and known issues specific to ${vehicle} related to "${symptom}"
- Include real TSB numbers if you know them, otherwise note "Check manufacturer database"
- For ${vehicleMake}, common TSB/recall databases include NHTSA, ${vehicleMake} service bulletins
- Always respond with valid JSON only, no markdown or extra text`;

    // Build messages array
    const messages = [
      { role: 'system', content: systemPrompt }
    ];

    // Add conversation history
    if (conversation && conversation.length > 0) {
      // First, add the initial context
      messages.push({
        role: 'user',
        content: `I have a ${vehicle} with the following symptom: ${symptom}. Please help me diagnose the issue.`
      });
      
      // Then add the conversation history
      for (const msg of conversation) {
        messages.push({
          role: msg.role,
          content: msg.content
        });
      }
    } else {
      // Initial request - AI should ask first question
      messages.push({
        role: 'user',
        content: `I have a ${vehicle} with the following symptom: ${symptom}. Please help me diagnose the issue by asking diagnostic questions.`
      });
    }

    console.log(`[ai-dynamic-triage] Vehicle: ${vehicle}, Symptom: ${symptom}, Questions asked: ${currentQuestionCount}`);

    // Call OpenAI via REST API (consistent with other routes)
    const openaiKey = process.env.OPENAI_API_KEY;
    if (!openaiKey) {
      console.error('[ai-dynamic-triage] OPENAI_API_KEY not configured');
      return res.status(500).json({ error: 'OpenAI API key not configured' });
    }

    const openaiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${openaiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages,
        temperature: 0.3,
        max_tokens: 1500,
        response_format: { type: 'json_object' }
      })
    });

    if (!openaiResponse.ok) {
      const txt = await openaiResponse.text();
      console.error('[ai-dynamic-triage] OpenAI API error:', openaiResponse.status, txt);
      return res.status(500).json({ error: `OpenAI API error: ${openaiResponse.status}`, details: txt });
    }

    const openaiData = await openaiResponse.json();
    const responseText = openaiData.choices[0]?.message?.content;
    console.log('[ai-dynamic-triage] Raw response:', responseText);

    if (!responseText) throw new Error('No response from OpenAI');

    // Parse the JSON response
    let result;
    try {
      result = JSON.parse(responseText);
    } catch (parseError) {
      console.error('[ai-dynamic-triage] JSON parse error:', parseError);
      // Try to extract JSON from the response
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        result = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('Could not parse AI response as JSON');
      }
    }

    // Add metadata
    result.questionCount = currentQuestionCount + (result.type === 'question' ? 1 : 0);
    result.vehicle = vehicle;
    result.symptom = symptom;

    // Sanitize TSBs and recalls: only include concrete entries.
    // Filter out placeholder/ambiguous content like "Check manufacturer database" or "Potential".
    function keepEntry(obj) {
      if (!obj) return false;
      const combined = Object.values(obj).join(' ').toLowerCase();
      // Exclude clearly ambiguous hints
      const ambiguousPhrases = [
        'check manufacturer',
        'check manufacturer database',
        'check manufacturer site',
        'potential',
        'may',
        'unknown',
        'n/a',
        'none found'
      ];
      for (const p of ambiguousPhrases) {
        if (combined.includes(p)) return false;
      }

      // Require at least one reasonably specific token: a TSB number pattern or a descriptive length
      const hasNumberLike = /tsb[-_\s]?\d{2,}|\d{3,}/i.test(combined);
      const hasDescriptive = (combined.replace(/[^a-z0-9\s]/gi, '').trim().split(/\s+/).length >= 6);
      return hasNumberLike || hasDescriptive;
    }

    if (Array.isArray(result.tsbs)) {
      const filtered = result.tsbs.filter(keepEntry);
      if (filtered.length > 0) result.tsbs = filtered;
      else delete result.tsbs;
    }

    if (Array.isArray(result.recalls)) {
      let filtered = result.recalls.filter(keepEntry);

      // If we have vehicle info, try to validate recalls against NHTSA recallsByVehicle
      try {
        if (vehicleYear && vehicleMake && vehicleModel && filtered.length > 0) {
          const nhtsaUrl = `https://api.nhtsa.gov/recalls/recallsByVehicle?make=${encodeURIComponent(vehicleMake)}&model=${encodeURIComponent(vehicleModel)}&modelYear=${encodeURIComponent(vehicleYear)}`;
          const nhtsaResp = await fetch(nhtsaUrl);
          if (nhtsaResp.ok) {
            const nhtsaData = await nhtsaResp.json();
            const nhtsaItems = Array.isArray(nhtsaData.results) ? nhtsaData.results : [];

            // Keep only recalls that match an NHTSA campaign number or contain specific keywords present in NHTSA summaries/components
            const keepRecalls = [];
            for (const r of filtered) {
              const text = (r.campaign || r.description || r.title || '').toLowerCase();
              let matched = false;

              for (const n of nhtsaItems) {
                const cmp = (n.Component || '').toLowerCase();
                const summ = (n.Summary || n.Summary || '').toLowerCase();
                const camp = (n.NHTSACampaignNumber || '').toLowerCase();
                if (!text) continue;
                if (camp && text.includes(camp)) {
                  matched = true; break;
                }
                if (cmp && text.includes(cmp)) { matched = true; break; }
                if (summ && text.includes(summ.slice(0, 50))) { matched = true; break; }
              }

              if (matched) keepRecalls.push(r);
            }

            if (keepRecalls.length > 0) filtered = keepRecalls;
            else filtered = [];
          }
        }
      } catch (e) {
        console.warn('[ai-dynamic-triage] NHTSA recall validation failed:', e && e.message);
      }

      if (filtered.length > 0) result.recalls = filtered;
      else delete result.recalls;
    }

    // Stronger TSB validation: require either a credible source URL or a clear TSB number pattern
    if (Array.isArray(result.tsbs)) {
      const keepTsbs = [];
      for (const t of result.tsbs) {
        const num = (t.number || t.id || '').toString().toLowerCase();
        const title = (t.title || t.description || '').toLowerCase();
        const source = (t.source || t.url || '').toLowerCase();

        // If there's a source URL referencing manufacturer or nhtsa, accept it
        const hasCredibleSource = source.includes('nhtsa') || source.includes('.gov') || source.includes('.manufacturer') || /\.(com|org|net)\//.test(source);

        // Common TSB number patterns often include letters, dashes, or short codes; reject trivial numeric-only placeholders like '123456'
        const plausibleNumber = /[a-zA-Z]{1,}|\d{2,}-\d{2,}|tsb[-_\s]?\d{2,}|\w{2,}-\d{2,}/i.test(num) || (num.length >= 4 && !/^123+$/.test(num) && !/^0+$/.test(num));

        // Require either credible source or plausible number plus descriptive title length
        if (hasCredibleSource || (plausibleNumber && (title.split(/\s+/).length >= 6))) {
          keepTsbs.push(t);
        }
      }

      if (keepTsbs.length > 0) result.tsbs = keepTsbs;
      else delete result.tsbs;
    }

    console.log(`[ai-dynamic-triage] Response type: ${result.type}, Questions: ${result.questionCount}`);

    return res.status(200).json(result);

  } catch (error) {
    console.error('[ai-dynamic-triage] Error:', error);
    return res.status(500).json({
      error: error.message || 'Failed to process diagnostic triage',
      type: 'error'
    });
  }
};
