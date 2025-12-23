/**
 * Create Stripe Connect Account
 * POST /api/connect/create-account
 * 
 * Creates a Stripe Express account for a shop
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
    console.log('✅ [Connect Create] Supabase client initialized');
  } catch (err) {
    console.error('❌ [Connect Create] Failed to initialize Supabase:', err.message);
  }
}

module.exports = async (req, res) => {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { shopId } = req.body;
    
    if (!shopId) {
      return res.status(400).json({ error: 'Shop ID required' });
    }

    if (!supabase) {
      console.error('❌ [Connect Create] Supabase client not initialized');
      return res.status(500).json({ error: 'Database connection not available' });
    }

    if (!stripe) {
      console.error('❌ [Connect Create] Stripe not initialized');
      return res.status(500).json({ error: 'Stripe not configured' });
    }

    console.log(`💳 [Connect Create] Creating Connect account for shop: ${shopId}`);

    // Get shop info
    const { data: shop, error: shopError } = await supabase
      .from('shops')
      .select('id, name, email, stripe_connected_account_id')
      .eq('id', shopId)
      .single();

    if (shopError || !shop) {
      console.error('❌ [Connect Create] Shop not found:', shopError);
      return res.status(404).json({ error: 'Shop not found' });
    }

    // Check if shop already has a Connect account
    if (shop.stripe_connected_account_id) {
      console.log(`⚠️ [Connect Create] Shop already has account: ${shop.stripe_connected_account_id}`);
      return res.json({ 
        success: true,
        accountId: shop.stripe_connected_account_id,
        message: 'Account already exists'
      });
    }

    // Create Stripe Express account
    console.log('🔄 [Connect Create] Creating Stripe Express account...');
    
    const account = await stripe.accounts.create({
      type: 'express',
      country: 'US',
      email: shop.email || undefined,
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true }
      },
      business_type: 'company',
      business_profile: {
        name: shop.name || `Shop ${shopId}`,
        support_email: shop.email || undefined
      }
    });

    console.log(`✅ [Connect Create] Account created: ${account.id}`);

    // Save account ID to database
    const { error: updateError } = await supabase
      .from('shops')
      .update({
        stripe_connected_account_id: account.id,
        onboarding_status: 'not_started',
        payouts_enabled: false,
        updated_at: new Date().toISOString()
      })
      .eq('id', shopId);

    if (updateError) {
      console.error('❌ [Connect Create] Database update error:', updateError);
      return res.status(500).json({ error: 'Failed to save account info' });
    }

    console.log(`✅ [Connect Create] Account saved to database`);

    return res.json({
      success: true,
      accountId: account.id,
      message: 'Connect account created successfully'
    });

  } catch (error) {
    console.error('❌ [Connect Create] Unexpected error:', error);
    return res.status(500).json({ 
      error: error.message || 'Failed to create Connect account' 
    });
  }
};
