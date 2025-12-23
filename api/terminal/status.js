/**
 * Terminal Status Endpoint
 * GET /api/terminal/status/:shopId
 * 
 * Returns the current status of a shop's registered terminal
 */

require('dotenv').config();

const HAS_STRIPE_KEY = !!process.env.STRIPE_SECRET_KEY;
let stripe = null;
if (HAS_STRIPE_KEY) {
  try {
    stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
  } catch (err) {
    console.error('❌ Failed to initialize Stripe client:', err && err.message);
  }
}

// Initialize Supabase
let supabase = null;
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ADMIN_KEY;

if (supabaseUrl && supabaseKey) {
  try {
    const { createClient } = require('@supabase/supabase-js');
    supabase = createClient(supabaseUrl, supabaseKey);
    console.log('✅ [Terminal Status] Supabase client initialized');
  } catch (err) {
    console.error('❌ [Terminal Status] Failed to initialize Supabase:', err.message);
  }
}

module.exports = async (req, res) => {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Get shopId from URL path or query parameter
    const shopId = req.query.shopId || (req.url && req.url.split('/').pop());
    
    if (!shopId) {
      return res.status(400).json({ error: 'Shop ID required' });
    }

    if (!supabase) {
      console.error('❌ [Terminal Status] Supabase client not initialized');
      return res.status(500).json({ error: 'Database connection not available' });
    }

    console.log(`🔍 [Terminal Status] Checking status for shop: ${shopId}`);

    // Get shop's terminal info from database
    const { data: shop, error: shopError } = await supabase
      .from('shops')
      .select('terminal_id, terminal_model, terminal_status, terminal_serial')
      .eq('id', shopId)
      .single();

    if (shopError) {
      console.error('❌ [Terminal Status] Database error:', shopError);
      return res.status(500).json({ error: 'Database error', details: shopError.message });
    }

    if (!shop || !shop.terminal_id) {
      console.log(`⚠️ [Terminal Status] No terminal registered for shop ${shopId}`);
      return res.json({ 
        status: 'not_registered',
        message: 'No terminal registered for this shop'
      });
    }

    console.log(`✅ [Terminal Status] Found terminal ${shop.terminal_id} for shop ${shopId}`);

    // TEST MODE: Just return database status without hitting Stripe
    const TEST_MODE = process.env.TEST_MODE === 'true' || req.query.test === 'true';
    
    if (TEST_MODE) {
      console.log('🧪 [Terminal Status] TEST MODE: Returning mock status');
      return res.json({
        status: shop.terminal_status || 'online',
        device_type: 'simulated',
        label: `Test Terminal (${shop.terminal_model})`,
        model: shop.terminal_model || 'reader_m2',
        serial: shop.terminal_serial || 'SIM-TEST-001',
        test_mode: true
      });
    }

    // PRODUCTION MODE: Fetch live status from Stripe
    if (!stripe) {
      console.error('❌ [Terminal Status] Stripe not initialized');
      return res.status(500).json({ error: 'Stripe not configured' });
    }

    try {
      const reader = await stripe.terminal.readers.retrieve(shop.terminal_id);
      
      console.log(`✅ [Terminal Status] Retrieved live status from Stripe: ${reader.status}`);

      // Update database with live status
      await supabase
        .from('shops')
        .update({ terminal_status: reader.status })
        .eq('id', shopId);

      return res.json({
        status: reader.status, // 'online' or 'offline'
        device_type: reader.device_type,
        label: reader.label,
        model: shop.terminal_model,
        serial: shop.terminal_serial,
        action: reader.action // current payment action if any
      });
    } catch (stripeError) {
      console.error('❌ [Terminal Status] Stripe error:', stripeError.message);
      
      // If reader not found in Stripe, mark as offline
      if (stripeError.code === 'resource_missing') {
        await supabase
          .from('shops')
          .update({ terminal_status: 'offline' })
          .eq('id', shopId);
        
        return res.json({
          status: 'offline',
          device_type: 'unknown',
          label: 'Terminal not found in Stripe',
          model: shop.terminal_model,
          serial: shop.terminal_serial,
          error: 'Terminal not found'
        });
      }
      
      throw stripeError;
    }
  } catch (error) {
    console.error('❌ [Terminal Status] Unexpected error:', error);
    return res.status(500).json({ 
      error: error.message || 'Failed to get terminal status' 
    });
  }
};
