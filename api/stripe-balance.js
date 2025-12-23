/**
 * Stripe Balance - Get Account Balance
 * GET/POST /api/stripe-balance/:shopId
 * 
 * Returns the Stripe balance for a shop's Connect account
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
    console.log('✅ [Stripe Balance] Supabase client initialized');
  } catch (err) {
    console.error('❌ [Stripe Balance] Failed to initialize Supabase:', err.message);
  }
}

module.exports = async (req, res) => {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Get shopId from URL path or query
    let shopId = req.query?.shopId;
    
    if (!shopId && req.url) {
      const urlParts = req.url.split('/').filter(Boolean);
      const lastPart = urlParts[urlParts.length - 1];
      // Remove query string if present
      const cleanPart = lastPart.split('?')[0];
      // Check if it looks like a UUID
      if (cleanPart && /^[0-9a-f-]{36}$/i.test(cleanPart)) {
        shopId = cleanPart;
      }
    }
    
    if (!shopId) {
      return res.status(400).json({ error: 'Shop ID required' });
    }

    if (!supabase) {
      console.error('❌ [Stripe Balance] Supabase client not initialized');
      return res.status(500).json({ error: 'Database connection not available' });
    }

    if (!stripe) {
      console.error('❌ [Stripe Balance] Stripe not initialized');
      return res.status(500).json({ error: 'Stripe not configured' });
    }

    console.log(`💰 [Stripe Balance] Fetching balance for shop: ${shopId}`);

    // Get shop's Stripe account
    const { data: shop, error: shopError } = await supabase
      .from('shops')
      .select('id, stripe_connected_account_id, payouts_enabled')
      .eq('id', shopId)
      .single();

    if (shopError || !shop) {
      console.error('❌ [Stripe Balance] Shop not found:', shopError);
      return res.status(404).json({ error: 'Shop not found' });
    }

    if (!shop.stripe_connected_account_id) {
      console.log('⚠️ [Stripe Balance] No Connect account for shop');
      return res.json({
        totalRevenue: 0,
        currentBalance: 0,
        availableBalance: 0,
        pendingBalance: 0,
        lastPayout: 0,
        bankStatus: 'Not Connected',
        bank_connected: false,
        autoWithdrawEnabled: false
      });
    }

    // Fetch balance from Stripe
    const balance = await stripe.balance.retrieve({
      stripeAccount: shop.stripe_connected_account_id
    });

    console.log(`✅ [Stripe Balance] Balance retrieved`);

    // Available balance (can be paid out)
    const availableAmount = balance.available?.[0]?.amount || 0;
    
    // Pending balance (waiting to clear)
    const pendingAmount = balance.pending?.[0]?.amount || 0;
    
    // Total current balance
    const currentBalance = availableAmount + pendingAmount;

    // Get total revenue (sum of all charges)
    let totalRevenue = 0;
    try {
      const charges = await stripe.charges.list({
        limit: 100,
        stripeAccount: shop.stripe_connected_account_id
      });
      totalRevenue = charges.data.reduce((sum, charge) => 
        charge.status === 'succeeded' ? sum + charge.amount : sum, 0
      );
    } catch (chargeErr) {
      console.warn('Could not fetch charges:', chargeErr.message);
    }

    // Get last payout amount
    let lastPayout = 0;
    try {
      const payouts = await stripe.payouts.list({
        limit: 1,
        stripeAccount: shop.stripe_connected_account_id
      });
      if (payouts.data.length > 0) {
        lastPayout = payouts.data[0].amount;
      }
    } catch (payoutErr) {
      console.warn('Could not fetch payouts:', payoutErr.message);
    }

    // Check if bank account is connected
    const bankStatus = shop.payouts_enabled ? 'Connected' : 'Not Connected';

    return res.json({
      total_revenue: totalRevenue,
      totalRevenue: totalRevenue,
      current_balance: currentBalance,
      currentBalance: currentBalance,
      available_balance: availableAmount,
      availableBalance: availableAmount,
      pending_balance: pendingAmount,
      pendingBalance: pendingAmount,
      last_payout: lastPayout,
      lastPayout: lastPayout,
      bank_status: bankStatus,
      bankStatus: bankStatus,
      bank_connected: shop.payouts_enabled || false,
      autoWithdrawEnabled: false, // TODO: Implement auto-withdraw
      auto_withdraw_enabled: false
    });

  } catch (error) {
    console.error('❌ [Stripe Balance] Unexpected error:', error);
    return res.status(500).json({ 
      error: error.message || 'Failed to fetch balance' 
    });
  }
};
