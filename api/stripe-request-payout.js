/**
 * Request Payout - Manual payout request
 * POST /api/stripe-request-payout/:shopId
 * 
 * Creates a manual payout from available balance
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
    console.log('✅ [Request Payout] Supabase client initialized');
  } catch (err) {
    console.error('❌ [Request Payout] Failed to initialize Supabase:', err.message);
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
    
    if (!shopId) {
      return res.status(400).json({ error: 'Shop ID required' });
    }

    if (!supabase) {
      console.error('❌ [Request Payout] Supabase client not initialized');
      return res.status(500).json({ error: 'Database connection not available' });
    }

    if (!stripe) {
      console.error('❌ [Request Payout] Stripe not initialized');
      return res.status(500).json({ error: 'Stripe not configured' });
    }

    console.log(`💸 [Request Payout] Processing payout request for shop: ${shopId}`);

    // Get shop's Stripe account
    const { data: shop, error: shopError } = await supabase
      .from('shops')
      .select('id, stripe_connected_account_id, payouts_enabled')
      .eq('id', shopId)
      .single();

    if (shopError || !shop) {
      console.error('❌ [Request Payout] Shop not found:', shopError);
      return res.status(404).json({ error: 'Shop not found' });
    }

    if (!shop.stripe_connected_account_id) {
      return res.status(400).json({ error: 'No Stripe Connect account found' });
    }

    if (!shop.payouts_enabled) {
      return res.status(400).json({ error: 'Payouts not enabled. Please complete bank account setup.' });
    }

    // Get available balance
    const balance = await stripe.balance.retrieve({
      stripeAccount: shop.stripe_connected_account_id
    });

    const availableAmount = balance.available?.[0]?.amount || 0;

    if (availableAmount <= 0) {
      return res.json({
        success: false,
        message: 'No funds available for payout'
      });
    }

    // Create payout
    const payout = await stripe.payouts.create(
      {
        amount: availableAmount,
        currency: 'usd',
        description: `Manual payout for shop ${shopId}`
      },
      {
        stripeAccount: shop.stripe_connected_account_id
      }
    );

    console.log(`✅ [Request Payout] Payout created: ${payout.id}`);

    return res.json({
      success: true,
      message: `Payout of $${(availableAmount / 100).toFixed(2)} initiated`,
      payoutId: payout.id,
      amount: availableAmount,
      status: payout.status
    });

  } catch (error) {
    console.error('❌ [Request Payout] Unexpected error:', error);
    return res.status(500).json({ 
      error: error.message || 'Failed to request payout' 
    });
  }
};
