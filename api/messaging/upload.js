const { createClient } = require('@supabase/supabase-js');

// POST /api/messaging/upload
// Expects JSON: { shop_id, fileName, contentType, base64 }
// Returns: { success: true, path, url }

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { shop_id: shopId, fileName, contentType, base64 } = req.body || {};
    if (!shopId || !fileName || !base64) {
      return res.status(400).json({ error: 'shop_id, fileName and base64 are required' });
    }

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ADMIN_KEY;
    const BUCKET = process.env.SUPABASE_MEDIA_BUCKET || 'messages-media';

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return res.status(500).json({ error: 'Supabase not configured on server' });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Build a safe path: shopId/ts-filename
    const safeName = fileName.replace(/[^a-zA-Z0-9.\-_%()\[\]]/g, '_');
    const key = `${shopId}/${Date.now()}-${safeName}`;

    // Decode base64
    const buffer = Buffer.from(base64, 'base64');

    // Upload
    const { data: uploadData, error: uploadErr } = await supabase.storage
      .from(BUCKET)
      .upload(key, buffer, { contentType, upsert: false });

    if (uploadErr) {
      console.error('Supabase upload error:', uploadErr);
      return res.status(500).json({ error: 'Failed to upload file', details: uploadErr.message || uploadErr });
    }

    // Create a signed URL (valid 1 hour) so Twilio can fetch it immediately
    const expiresIn = 60 * 60; // 1 hour
    const { data: signed, error: signedErr } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(key, expiresIn);

    if (signedErr) {
      console.error('Supabase createSignedUrl error:', signedErr);
      return res.status(500).json({ error: 'Failed to create signed URL', details: signedErr.message || signedErr });
    }

    return res.json({ success: true, path: key, url: signed.signedURL });

  } catch (err) {
    console.error('Upload handler error:', err);
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
};
