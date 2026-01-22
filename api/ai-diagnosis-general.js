// api/ai-diagnosis-general.js
// Vercel serverless function for general AI-powered diagnosis (no triage)

/**
 * Request body:
 * {
 *   diagnosisTitle: string, // Symptom or diagnosis selected
 *   vehicleYear: number|string,
 *   vehicleMake: string,
 *   vehicleModel: string
 * }
 *
 * Response:
 * {
 *   probableCause: string,
 *   explanation: string,
 *   confidence: 'high'|'medium'|'low',
 *   sources: [string]
 * }
 */

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const {
      diagnosisTitle,
      vehicleYear,
      vehicleMake,
      vehicleModel
    } = req.body;

    if (!diagnosisTitle || !vehicleYear || !vehicleMake || !vehicleModel) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Check for OpenAI key
    const openaiKey = process.env.OPENAI_API_KEY;
    if (!openaiKey) {
      return res.status(500).json({ error: 'OpenAI API key not configured' });
    }

    // Compose prompt for OpenAI
    const searchPrompt = `You are an expert automotive diagnostician. Given the following vehicle and symptom/diagnosis, search real-world web results and return the single most common cause for this issue on this vehicle.\n\nVEHICLE: ${vehicleYear} ${vehicleMake} ${vehicleModel}\nSYMPTOM/DIAGNOSIS: ${diagnosisTitle}\n\nRespond with JSON:\n{\n  'probableCause': string,\n  'explanation': string,\n  'confidence': 'high'|'medium'|'low',\n  'sources': [string]\n}`;

    // Call OpenAI
    const openaiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${openaiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: 'You are an expert automotive diagnostician. Respond with ONLY valid JSON.' },
          { role: 'user', content: searchPrompt }
        ],
        temperature: 0.3,
        max_tokens: 800,
        response_format: { type: 'json_object' }
      })
    });

    if (!openaiResponse.ok) {
      throw new Error(`OpenAI API error: ${openaiResponse.status}`);
    }

    const openaiData = await openaiResponse.json();
    const aiResult = JSON.parse(openaiData.choices[0]?.message?.content || '{}');
    console.log('[AI-GeneralDiagnosis] OpenAI result:', JSON.stringify(aiResult, null, 2));

    return res.json({
      probableCause: aiResult.probableCause || aiResult.cause || 'Unknown',
      explanation: aiResult.explanation || '',
      confidence: aiResult.confidence || 'medium',
      sources: aiResult.sources || []
    });

  } catch (e) {
    console.error('[AI-GeneralDiagnosis] Error:', e.message);
    res.status(500).json({ error: e.message || 'Internal server error' });
  }
}
