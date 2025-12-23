/**
 * Stripe Connect - Get Account Link for Onboarding
 * POST /api/stripe-connect
 * 
 * Creates an AccountLink for shop to complete onboarding
 * This is what the "Connect Bank" button calls
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
    console.log('✅ [Connect Link] Supabase client initialized');
  } catch (err) {
    console.error('❌ [Connect Link] Failed to initialize Supabase:', err.message);
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
    // Get shopId from body or URL path
    let shopId = req.body?.shopId;
    
    // Check if shopId is in URL path (e.g. /api/stripe-connect/shopId)
    if (!shopId && req.url) {
      const urlParts = req.url.split('/').filter(Boolean);
      const lastPart = urlParts[urlParts.length - 1];
      // Check if it looks like a UUID
      if (lastPart && /^[0-9a-f-]{36}$/i.test(lastPart)) {
        shopId = lastPart;
      }
    }
    
    if (!shopId) {
      return res.status(400).json({ error: 'Shop ID required' });
    }

    if (!supabase) {
      console.error('❌ [Connect Link] Supabase client not initialized');
      return res.status(500).json({ error: 'Database connection not available' });
    }

    if (!stripe) {
      console.error('❌ [Connect Link] Stripe not initialized');
      return res.status(500).json({ error: 'Stripe not configured' });
    }

    console.log(`🔗 [Connect Link] Creating onboarding link for shop: ${shopId}`);

    // Get shop info
    const { data: shop, error: shopError } = await supabase
      .from('shops')
      .select('id, name, email, stripe_connected_account_id')
      .eq('id', shopId)
      .single();

    if (shopError || !shop) {
      console.error('❌ [Connect Link] Shop not found:', shopError);
      return res.status(404).json({ error: 'Shop not found' });
    }

    let accountId = shop.stripe_connected_account_id;

    // If no account exists, create one first
    if (!accountId) {
      console.log('🔄 [Connect Link] No account found, creating one...');
      
      const account = await stripe.accounts.create({
        type: 'express',
        country: 'US',
        email: shop.email || undefined,
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true }
        },
        business_profile: {
          name: shop.name || `Shop ${shopId}`
        }
      });

      accountId = account.id;
      console.log(`✅ [Connect Link] Created account: ${accountId}`);

      // Save to database
      await supabase
        .from('shops')
        .update({
          stripe_connected_account_id: accountId,
          onboarding_status: 'not_started',
          updated_at: new Date().toISOString()
        })
        .eq('id', shopId);
    }

    // Create Account Link for onboarding
    const BASE_URL = process.env.FRONTEND_URL || 'https://www.xpose.management';
    
    const accountLink = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: `${BASE_URL}/revenue.html?refresh=true`,
      return_url: `${BASE_URL}/revenue.html?success=true`,
      type: 'account_onboarding'
    });

    console.log(`✅ [Connect Link] Account link created`);

    return res.json({
      success: true,
      url: accountLink.url
    });

  } catch (error) {
    console.error('❌ [Connect Link] Unexpected error:', error);
    return res.status(500).json({ 
      error: error.message || 'Failed to create account link' 
    });
  }
};
