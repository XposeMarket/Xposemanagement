/**
 * Auto Withdraw Toggle
 * POST /api/stripe-auto-withdraw/:shopId
 * 
 * Enable/disable automatic withdrawals
 * Note: Stripe doesn't have "auto-withdraw" - this would need to be a scheduled job
 */

require('dotenv').config();

// Initialize Supabase
let supabase = null;
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ADMIN_KEY;

if (supabaseUrl && supabaseKey) {
  try {
    const { createClient } = require('@supabase/supabase-js');
    supabase = createClient(supabaseUrl, supabaseKey);
    console.log('✅ [Auto Withdraw] Supabase client initialized');
  } catch (err) {
    console.error('❌ [Auto Withdraw] Failed to initialize Supabase:', err.message);
  }
}

module.exports = async (req, res) => {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Get shopId from URL path
    let shopId = req.body?.shopId;
    
    if (!shopId && req.url) {
      const urlParts = req.url.split('/').filter(Boolean);
      const lastPart = urlParts[urlParts.length - 1];
      if (lastPart && /^[0-9a-f-]{36}$/i.test(lastPart)) {
        shopId = lastPart;
      }
    }
    
    const { action } = req.body; // 'enable' or 'disable'
    
    if (!shopId) {
      return res.status(400).json({ error: 'Shop ID required' });
    }

    if (!action || !['enable', 'disable'].includes(action)) {
      return res.status(400).json({ error: 'Action must be "enable" or "disable"' });
    }

    if (!supabase) {
      console.error('❌ [Auto Withdraw] Supabase client not initialized');
      return res.status(500).json({ error: 'Database connection not available' });
    }

    console.log(`⚙️ [Auto Withdraw] ${action} auto-withdraw for shop: ${shopId}`);

    // Get shop
    const { data: shop, error: shopError } = await supabase
      .from('shops')
      .select('id')
      .eq('id', shopId)
      .single();

    if (shopError || !shop) {
      console.error('❌ [Auto Withdraw] Shop not found:', shopError);
      return res.status(404).json({ error: 'Shop not found' });
    }

    // Save setting to database
    const { error: updateError } = await supabase
      .from('shops')
      .update({
        auto_withdraw_enabled: action === 'enable',
        updated_at: new Date().toISOString()
      })
      .eq('id', shopId);

    if (updateError) {
      console.error('❌ [Auto Withdraw] Update error:', updateError);
      return res.status(500).json({ error: 'Failed to update settings' });
    }

    console.log(`✅ [Auto Withdraw] Setting updated`);

    return res.json({
      success: true,
      message: `Auto-withdraw ${action === 'enable' ? 'enabled' : 'disabled'}`,
      enabled: action === 'enable'
    });

  } catch (error) {
    console.error('❌ [Auto Withdraw] Unexpected error:', error);
    return res.status(500).json({ 
      error: error.message || 'Failed to update auto-withdraw setting' 
    });
  }
};
