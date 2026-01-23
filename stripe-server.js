
// ...existing code...



/**
 * stripe-server.js
 * Stripe payment integration server
 * 
 * This handles creating checkout sessions for subscriptions
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
// Debug: Check if API key is loaded
// Do not log secret values. Only indicate presence.
const HAS_STRIPE_KEY = !!process.env.STRIPE_SECRET_KEY;
console.log('🔑 Stripe Secret Key present=', HAS_STRIPE_KEY);

// Initialize Stripe client safely. In serverless environments we should not
// call process.exit() because that crashes the function during module load.
let stripe = null;
if (HAS_STRIPE_KEY) {
  try {
    stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
  } catch (err) {
    console.error('❌ Failed to initialize Stripe client:', err && err.message);
    stripe = null;
  }
} else {
  console.warn('⚠️ STRIPE_SECRET_KEY is not set. Stripe endpoints will return errors until configured.');
}

const app = express();

// Simple request logger to help debug incoming requests (method, path, origin)
app.use((req, res, next) => {
  try {
    const origin = req.headers.origin || req.headers.referer || 'no-origin';
    console.log(`[request] ${req.method} ${req.path} origin=${origin} host=${req.headers.host}`);
  } catch (e) {
    // ignore logging errors
  }
  return next();
});
// Normalize frontend origin from env (ensure scheme and no trailing slash)
function normalizeOrigin(val) {
  if (!val) return val;
  let v = String(val).trim();
  v = v.replace(/\/+$/, '');
  // prepend https:// if no scheme present
  if (!/^https?:\/\//i.test(v)) {
    v = 'https://' + v;
  }
  return v;
}

const allowedOrigins = (() => {
  const list = [
    'http://localhost:5500',
    'http://127.0.0.1:5500',
    'http://localhost:3001',  // VS Code Live Preview
    'http://127.0.0.1:3001',  // VS Code Live Preview
    'http://localhost:5501',  // Alternative Live Preview port
    'http://127.0.0.1:5501',  // Alternative Live Preview port
    'https://www.xpose.management',
    'https://xpose.management'
  ];

  const envFrontend = normalizeOrigin(process.env.FRONTEND_URL);
  if (envFrontend) {
    list.push(envFrontend);
    try {
      const host = new URL(envFrontend).hostname;
      const noWww = host.replace(/^www\./, '');
      const withWww = host.startsWith('www.') ? host : `www.${noWww}`;
      list.push(`https://${noWww}`);
      list.push(`https://${withWww}`);
    } catch (e) {
      // ignore invalid URL
    }
  }

  return Array.from(new Set(list.filter(Boolean).map(s => s.replace(/\/$/, ''))));
})();

console.log('Configured allowedOrigins:', allowedOrigins);

// Robust CORS handling: allow listed origins or match hostnames (ignoring leading www.)
app.use(cors({
  origin: function(origin, callback) {
    // Allow requests with no origin (like mobile apps or curl)
    if (!origin) {
      console.log('CORS check: no origin (allowing)');
      return callback(null, true);
    }

    try {
      const incoming = String(origin).toLowerCase();
      console.log('CORS check: incoming origin=', incoming);

      // In development, allow ALL localhost origins
      if (incoming.includes('localhost') || incoming.includes('127.0.0.1')) {
        console.log('✅ CORS: allowing localhost origin');
        return callback(null, true);
      }

      // Direct exact-match first
      if (allowedOrigins.indexOf(incoming) !== -1) {
        return callback(null, true);
      }

      // Compare hostnames ignoring a leading www.
      const stripWww = (h) => h.replace(/^www\./, '');
      const incomingHost = (() => {
        try { return stripWww(new URL(incoming).hostname); } catch (e) { return null; }
      })();

      if (incomingHost) {
        for (const a of allowedOrigins) {
          try {
            const ah = stripWww(new URL(a).hostname);
            if (ah === incomingHost) {
              return callback(null, true);
            }
          } catch (e) {
            // ignore parse errors and continue
          }
        }
      }

      // If a FRONTEND_URL is set but the incoming origin doesn't match, reject
      if (process.env.FRONTEND_URL) {
        console.warn('CORS not allowed for origin:', origin);
        return callback(new Error('CORS not allowed'), false);
      }

      return callback(null, true);
    } catch (err) {
      console.error('CORS check failed:', err);
      return callback(new Error('CORS check failed'), false);
    }
  },
  credentials: true
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true })); // For Twilio webhooks

// Serve static files - but NOT for /api routes (let Express routes handle those)
app.use((req, res, next) => {
  // Skip static file serving for /api routes
  if (req.path.startsWith('/api')) {
    return next();
  }
  express.static('.')(req, res, next);
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    stripe: stripe ? 'connected' : 'missing'
  });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({ 
    message: 'Xpose Management Stripe Server',
    version: '1.0.0',
    endpoints: ['/create-checkout-session', '/get-session-subscription', '/health']
  });
});

// Mount AI dynamic triage endpoint from server-endpoints if available
try {
  const aiDynamicHandler = require('./server-endpoints/ai-dynamic-triage');
  if (typeof aiDynamicHandler === 'function') {
    app.post('/api/ai-dynamic-triage', aiDynamicHandler);
    app.options('/api/ai-dynamic-triage', (req, res) => res.sendStatus(200));
    console.log('Mounted /api/ai-dynamic-triage handler from server-endpoints/ai-dynamic-triage.js');
  } else {
    console.warn('ai-dynamic-triage module does not export a function');
  }
} catch (err) {
  console.warn('ai-dynamic-triage handler not mounted:', err && err.message);
}

// Terminal Price IDs
const TERMINAL_PRICES = {
  'reader_m2': null, // Free - included
  'wisepos_e': 'price_1ShJaI4K55W1qqBC08Lw0L9c', // $30/month
  'reader_s700': 'price_1ShJai4K55W1qqBCzAyUq8if' // $50/month
};

// Create checkout session
app.post('/create-checkout-session', async (req, res) => {
  try {
    if (!stripe) {
      console.error('Attempted checkout but Stripe client is not configured');
      return res.status(500).json({ error: 'Stripe not configured' });
    }
      const { priceId, customerEmail, terminalModel, terminalType } = req.body;

    console.log('📝 Checkout request received:', { priceId, hasCustomerEmail: !!customerEmail, terminalType });
    console.log('🔎 Request origin/header:', { origin: req.headers.origin, host: req.headers.host });

    if (!priceId) {
      return res.status(400).json({ error: 'Price ID is required' });
    }

    // Determine origin: prefer request Origin header, then normalized FRONTEND_URL env, then a sensible default
    const envFrontend = normalizeOrigin(process.env.FRONTEND_URL);
    const origin = req.headers.origin || envFrontend || 'https://xpose-stripe-server.vercel.app';
    console.log('🔄 Creating Stripe checkout session... using origin:', origin, ' (raw req.headers.origin=', req.headers.origin, ', envFrontend=', envFrontend, ')');

    // Build line items array
    const lineItems = [
      {
        price: priceId, // Subscription plan
        quantity: 1,
        }
    ];

    // Add terminal hardware if not M2 (M2 is free/included)
      // Accept `terminalModel` from newer frontends, fall back to legacy `terminalType`.
      const terminal = terminalModel || terminalType || 'reader_m2';
    if (terminal !== 'reader_m2' && TERMINAL_PRICES[terminal]) {
      console.log(`➕ Adding terminal: ${terminal} with price ${TERMINAL_PRICES[terminal]}`);
      lineItems.push({
        price: TERMINAL_PRICES[terminal],
        quantity: 1
      });
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: lineItems,
      customer_email: customerEmail || undefined,
      // Set explicit locale to avoid language file errors
      // 14-day trial
      subscription_data: {
        trial_period_days: 14,
        metadata: {
          terminal_type: terminal
        }
      },
      // Enable Apple Pay and Google Pay
      payment_method_options: {
        card: {
          request_three_d_secure: 'automatic',
        },
      },
      // Allow customers to enter promo codes
      allow_promotion_codes: true,
      // Redirect to create-shop page after successful payment (not dashboard)
      success_url: `${origin}/create-shop.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/paywall.html`,
      metadata: {
        terminal_type: terminal
      }
    });

    res.json({ url: session.url });
    console.log('✅ Checkout session created successfully:', session.id, 'url:', session.url, 'terminal:', terminal);
  } catch (error) {
    console.error('❌ Stripe error:', error && error.message);
    console.error('Full error object:', error);
    // If DEBUG or not in production, include stack for troubleshooting
    const payload = { error: (error && error.message) || 'Unknown error' };
    if (process.env.NODE_ENV !== 'production' || process.env.DEBUG === 'true') {
      payload.stack = (error && error.stack) || null;
    }
    res.status(500).json(payload);
  }
});

// Get customer subscription status
app.post('/get-subscription-status', async (req, res) => {
  try {
    if (!stripe) {
      console.error('Attempted to fetch subscription status but Stripe client is not configured');
      return res.status(500).json({ error: 'Stripe not configured' });
    }
    const { customerEmail } = req.body;

    if (!customerEmail) {
      return res.status(400).json({ error: 'Customer email is required' });
    }

    // Find customer by email
    const customers = await stripe.customers.list({
      email: customerEmail,
      limit: 1,
    });

    if (customers.data.length === 0) {
      return res.json({ subscribed: false });
    }

    const customer = customers.data[0];

    // Get active subscriptions
    const subscriptions = await stripe.subscriptions.list({
      customer: customer.id,
      status: 'active',
      limit: 1,
    });

    if (subscriptions.data.length === 0) {
      return res.json({ subscribed: false });
    }

    const subscription = subscriptions.data[0];

    res.json({
      subscribed: true,
      plan: subscription.items.data[0].price.nickname || 'Unknown',
      status: subscription.status,
      current_period_end: subscription.current_period_end,
    });
  } catch (error) {
    console.error('Stripe error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get subscription details from checkout session
app.post('/get-session-subscription', async (req, res) => {
  try {
    if (!stripe) {
      console.error('Attempted to fetch session but Stripe client is not configured');
      return res.status(500).json({ error: 'Stripe not configured' });
    }
    const { sessionId } = req.body;

    if (!sessionId) {
      return res.status(400).json({ error: 'Session ID is required' });
    }

    console.log('🔍 Fetching session details for:', sessionId);

    // Retrieve the checkout session
    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ['subscription', 'customer'],
    });

    console.log('📊 Session retrieved:', {
      id: session.id,
      status: session.status,
      payment_status: session.payment_status,
      subscription: session.subscription ? 'present' : 'missing',
    });

    if (!session.subscription) {
      console.error('❌ No subscription in session:', session);
      return res.status(400).json({ error: 'No subscription found for this session' });
    }

    const subscription = session.subscription;
    const customer = session.customer;

    console.log('💳 Subscription details:', {
      id: subscription.id,
      status: subscription.status,
      trial_end: subscription.trial_end,
      current_period_end: subscription.current_period_end,
    });

    // Get the price to determine the plan
    const priceId = subscription.items.data[0].price.id;
    let planName = 'Unknown';
    
    // Map price IDs to normalized plan keys used by the app
    const PRICE_TO_PLAN = {
      // Monthly price IDs -> normalized keys
      'price_1SX97Z4K55W1qqBCSwzYlDd6': 'single',
      'price_1SX97b4K55W1qqBC7o7fJYUi': 'local',
      'price_1SX97d4K55W1qqBCcNM0eP00': 'multi',
      // Annual price IDs -> normalized keys
      'price_1Slydh4K55W1qqBCPa4CAwOi': 'single',
      'price_1Slyf44K55W1qqBCIayxsn8D': 'local',
      'price_1Slyfn4K55W1qqBCMj84DH1q': 'multi',
    };
    // Prefer explicit mapping; fall back to nickname and try to normalize it
    planName = PRICE_TO_PLAN[priceId] || (subscription.items.data[0].price.nickname || 'unknown');
    if (typeof planName === 'string') {
      const pn = planName.toString().toLowerCase();
      if (pn.includes('single')) planName = 'single';
      else if (pn.includes('local')) planName = 'local';
      else if (pn.includes('multi')) planName = 'multi';
      else if (pn === 'unknown') planName = 'unknown';
      else planName = pn.replace(/\s+/g, '_');
    }
    if (!PRICE_TO_PLAN[priceId]) {
      console.warn('⚠️ Unknown Stripe price ID:', priceId, 'nickname:', subscription.items.data[0].price.nickname);
    }

    res.json({
      customer_id: typeof customer === 'string' ? customer : customer.id,
      subscription_id: subscription.id,
      status: subscription.status,
      plan: planName,
      trial_end: subscription.trial_end ? new Date(subscription.trial_end * 1000).toISOString() : null,
      current_period_end: subscription.current_period_end ? new Date(subscription.current_period_end * 1000).toISOString() : null,
    });

    console.log('✅ Subscription details sent:', planName);
  } catch (error) {
    console.error('❌ Stripe error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ===========================
// STRIPE CONNECT ENDPOINTS
// ===========================

// Create Express account for new shop
app.post('/api/connect/create-account', async (req, res) => {
  const { shopId, email, businessName, country = 'US', address } = req.body;
  
  if (!stripe) {
    return res.status(500).json({ error: 'Stripe not configured' });
  }
  
  if (!shopId || !email) {
    return res.status(400).json({ error: 'Shop ID and email required' });
  }

  try {
    console.log('🏦 Creating Express account for shop:', shopId);

    // Create Express account
    const account = await stripe.accounts.create({
      type: 'express',
      country: country,
      email: email,
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true },
      },
      business_type: 'individual',
      business_profile: {
        name: businessName || 'Auto Shop',
        product_description: 'Automotive repair and maintenance services',
      },
      settings: {
        payouts: {
          schedule: {
            interval: 'manual',
          },
        },
      },
    });

    console.log('✅ Express account created:', account.id);

    // Build terminal location address from shop data or use defaults
    const locationAddress = {
      line1: (address && address.street) || '123 Main St',
      city: (address && address.city) || 'Frederick',
      state: (address && address.state) || 'MD',
      postal_code: (address && address.zipcode) || '21701',
      country: country,
    };

    console.log('🏛️ Terminal location address:', locationAddress);

    // Create Stripe Terminal Location for this account
    const location = await stripe.terminal.locations.create(
      {
        display_name: businessName || 'Main Location',
        address: locationAddress,
      },
      {
        stripeAccount: account.id,
      }
    );

    console.log('✅ Terminal location created:', location.id);

    // Update shop in Supabase
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (supabaseUrl && supabaseKey) {
      const { createClient } = require('@supabase/supabase-js');
      const supabase = createClient(supabaseUrl, supabaseKey);

      const { error: updateError } = await supabase
        .from('shops')
        .update({
          stripe_account_id: account.id,
          terminal_location_id: location.id,
          updated_at: new Date().toISOString(),
        })
        .eq('id', shopId);

      if (updateError) {
        console.error('❌ Failed to update shop:', updateError);
        throw updateError;
      }

      console.log('✅ Shop updated with Stripe account');
    }

    res.json({
      success: true,
      accountId: account.id,
      locationId: location.id,
    });
  } catch (error) {
    console.error('❌ Express account creation failed:', error);
    res.status(500).json({ error: error.message });
  }
});

// Create account link for onboarding
app.post('/api/connect/create-account-link', async (req, res) => {
  const { accountId } = req.body;

  if (!stripe) {
    return res.status(500).json({ error: 'Stripe not configured' });
  }

  if (!accountId) {
    return res.status(400).json({ error: 'Account ID required' });
  }

  try {
    const envFrontend = normalizeOrigin(process.env.FRONTEND_URL);
    const origin = req.headers.origin || envFrontend || 'https://www.xpose.management';

    const accountLink = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: `${origin}/settings.html?refresh=true`,
      return_url: `${origin}/settings.html?onboarding=complete`,
      type: 'account_onboarding',
    });

    res.json({
      success: true,
      url: accountLink.url,
    });
  } catch (error) {
    console.error('❌ Account link creation failed:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get account status
app.post('/api/connect/account-status', async (req, res) => {
  const { accountId } = req.body;

  if (!stripe) {
    return res.status(500).json({ error: 'Stripe not configured' });
  }

  if (!accountId) {
    return res.status(400).json({ error: 'Account ID required' });
  }

  try {
    const account = await stripe.accounts.retrieve(accountId);

    res.json({
      success: true,
      chargesEnabled: account.charges_enabled,
      payoutsEnabled: account.payouts_enabled,
      detailsSubmitted: account.details_submitted,
      requiresInfo: account.requirements?.currently_due || [],
    });
  } catch (error) {
    console.error('❌ Account status check failed:', error);
    res.status(500).json({ error: error.message });
  }
});

// ===========================
// STRIPE TERMINAL ENDPOINTS
// ===========================

// Create terminal payment intent
app.post('/api/terminal/create-payment', async (req, res) => {
  const { invoiceId, shopId } = req.body;

  if (!stripe) {
    return res.status(500).json({ error: 'Stripe not configured' });
  }

  if (!invoiceId || !shopId) {
    return res.status(400).json({ error: 'Invoice ID and Shop ID required' });
  }

  try {
    console.log('💳 Creating terminal payment for invoice:', invoiceId);

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return res.status(500).json({ error: 'Database not configured' });
    }

    const { createClient } = require('@supabase/supabase-js');
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Fetch shop
    const { data: shop, error: shopError } = await supabase
      .from('shops')
      .select('stripe_account_id, terminal_id')
      .eq('id', shopId)
      .single();

    if (shopError || !shop) {
      return res.status(404).json({ error: 'Shop not found' });
    }

    if (!shop.stripe_account_id) {
      return res.status(400).json({ error: 'Shop has no Stripe account. Please complete onboarding in Settings.' });
    }

    if (!shop.terminal_id) {
      return res.status(400).json({ error: 'No terminal registered for this shop. Please register a terminal in Settings.' });
    }

    // Fetch invoice
    const { data: invoice, error: invoiceError } = await supabase
      .from('invoices')
      .select('total, customer_id, customers(name, email)')
      .eq('id', invoiceId)
      .single();

    if (invoiceError || !invoice) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    // Calculate amount (with platform fee)
    const grossAmount = Math.round(invoice.total * 100);
    const platformFee = Math.round(grossAmount * 0.023);

    // Create PaymentIntent on Connected Account
    const paymentIntent = await stripe.paymentIntents.create(
      {
        amount: grossAmount,
        currency: 'usd',
        payment_method_types: ['card_present'],
        capture_method: 'automatic',
        application_fee_amount: platformFee,
        metadata: {
          invoiceId: invoiceId,
          shopId: shopId,
          customerName: invoice.customers?.name || 'Unknown',
        },
      },
      {
        stripeAccount: shop.stripe_account_id,
      }
    );

    console.log('✅ PaymentIntent created:', paymentIntent.id);

    // Process payment on terminal
    await stripe.terminal.readers.processPaymentIntent(
      shop.terminal_id,
      {
        payment_intent: paymentIntent.id,
      },
      {
        stripeAccount: shop.stripe_account_id,
      }
    );

    console.log('✅ Payment sent to terminal');

    res.json({
      success: true,
      paymentIntent: paymentIntent.id,
      amount: grossAmount,
    });
  } catch (error) {
    console.error('❌ Terminal payment creation failed:', error);
    res.status(500).json({ error: error.message });
  }
});

// Register terminal reader
app.post('/api/terminal/register', async (req, res) => {
  const { shopId, registrationCode } = req.body;

  if (!stripe) {
    return res.status(500).json({ error: 'Stripe not configured' });
  }

  if (!shopId || !registrationCode) {
    return res.status(400).json({ error: 'Shop ID and registration code required' });
  }

  try {
    console.log('🔧 Registering terminal for shop:', shopId);

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return res.status(500).json({ error: 'Database not configured' });
    }

    const { createClient } = require('@supabase/supabase-js');
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get shop
    const { data: shop, error: shopError } = await supabase
      .from('shops')
      .select('stripe_account_id, terminal_location_id, name')
      .eq('id', shopId)
      .single();

    if (shopError || !shop) {
      return res.status(404).json({ error: 'Shop not found' });
    }

    if (!shop.stripe_account_id) {
      return res.status(400).json({ error: 'Shop has no Stripe account' });
    }

    if (!shop.terminal_location_id) {
      return res.status(400).json({ error: 'Shop has no terminal location' });
    }

    // Register reader
    const reader = await stripe.terminal.readers.create(
      {
        registration_code: registrationCode,
        location: shop.terminal_location_id,
        label: `${shop.name} Terminal`,
      },
      {
        stripeAccount: shop.stripe_account_id,
      }
    );

    console.log('✅ Terminal registered:', reader.id);

    // Update shop
    const { error: updateError } = await supabase
      .from('shops')
      .update({
        terminal_id: reader.id,
        terminal_serial: reader.serial_number,
        terminal_status: reader.status,
        updated_at: new Date().toISOString(),
      })
      .eq('id', shopId);

    if (updateError) {
      console.error('❌ Failed to update shop:', updateError);
      throw updateError;
    }

    console.log('✅ Shop updated with terminal');

    res.json({
      success: true,
      terminal: {
        id: reader.id,
        label: reader.label,
        status: reader.status,
        deviceType: reader.device_type,
      },
    });
  } catch (error) {
    console.error('❌ Terminal registration failed:', error);
    res.status(500).json({ error: error.message });
  }
});

// Purchase additional terminal
app.post('/api/terminal/purchase', async (req, res) => {
  const { shopId, terminalModel, priceId, customerEmail } = req.body;

  if (!stripe) {
    return res.status(500).json({ error: 'Stripe not configured' });
  }

  if (!shopId || !terminalModel || !priceId) {
    return res.status(400).json({ error: 'Shop ID, terminal model, and price ID are required' });
  }

  try {
    console.log('🛒 Creating terminal purchase checkout for shop:', shopId, 'terminal:', terminalModel);

    const envFrontend = normalizeOrigin(process.env.FRONTEND_URL);
    const origin = req.headers.origin || envFrontend || 'https://www.xpose.management';

    // Create checkout session for terminal purchase
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [
        {
          price: priceId,
          quantity: 1
        }
      ],
      customer_email: customerEmail || undefined,
      subscription_data: {
        metadata: {
          shop_id: shopId,
          terminal_model: terminalModel,
          purchase_type: 'additional_terminal'
        }
      },
      allow_promotion_codes: true,
      success_url: `${origin}/settings.html?terminal_purchase=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/settings.html?terminal_purchase=cancelled`,
      metadata: {
        shop_id: shopId,
        terminal_model: terminalModel,
        purchase_type: 'additional_terminal'
      }
    });

    console.log('✅ Terminal purchase checkout created:', session.id);

    res.json({ 
      success: true, 
      url: session.url,
      sessionId: session.id 
    });

  } catch (error) {
    console.error('❌ Terminal purchase checkout failed:', error);
    res.status(500).json({ error: error.message });
  }
});

// Complete terminal purchase - save to database
app.post('/api/terminal/purchase-complete', async (req, res) => {
  const { sessionId } = req.body;

  if (!stripe) {
    return res.status(500).json({ error: 'Stripe not configured' });
  }

  if (!sessionId) {
    return res.status(400).json({ error: 'Session ID is required' });
  }

  try {
    console.log('📦 Completing terminal purchase for session:', sessionId);

    // Retrieve the checkout session
    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ['subscription']
    });

    if (!session || session.payment_status !== 'paid') {
      return res.status(400).json({ error: 'Payment not completed' });
    }

    const shopId = session.metadata?.shop_id;
    const terminalModel = session.metadata?.terminal_model;

    if (!shopId || !terminalModel) {
      return res.status(400).json({ error: 'Missing shop or terminal info in session' });
    }

    // Save to shop_terminals table
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      console.warn('⚠️ Supabase not configured - cannot save terminal');
      return res.json({ success: true, saved: false, message: 'Terminal purchased but database not configured' });
    }

    const { createClient } = require('@supabase/supabase-js');
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Insert the terminal record
    const { data: terminal, error: insertError } = await supabase
      .from('shop_terminals')
      .insert({
        shop_id: shopId,
        terminal_model: terminalModel,
        stripe_subscription_id: session.subscription?.id || session.subscription,
        status: 'pending_shipment',
        created_at: new Date().toISOString()
      })
      .select()
      .single();

    if (insertError) {
      console.error('❌ Failed to save terminal:', insertError);
      // Don't fail the request - payment was successful
      return res.json({ success: true, saved: false, error: insertError.message });
    }

    console.log('✅ Terminal purchase saved:', terminal.id);

    res.json({
      success: true,
      saved: true,
      terminal: {
        id: terminal.id,
        model: terminalModel,
        status: 'pending_shipment'
      }
    });

  } catch (error) {
    console.error('❌ Terminal purchase completion failed:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get terminal status (GET with shopId in URL)
app.get('/api/terminal/status/:shopId?', async (req, res) => {
  const shopId = req.params.shopId || req.query.shopId;

  if (!stripe) {
    return res.status(500).json({ error: 'Stripe not configured' });
  }

  if (!shopId) {
    return res.status(400).json({ error: 'Shop ID required' });
  }

  try {
    const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return res.status(500).json({ error: 'Database not configured' });
    }

    const { createClient } = require('@supabase/supabase-js');
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get shop
    const { data: shop, error: shopError } = await supabase
      .from('shops')
      .select('stripe_account_id, terminal_id, terminal_status, terminal_model')
      .eq('id', shopId)
      .single();

    if (shopError || !shop) {
      return res.status(404).json({ error: 'Shop not found' });
    }

    if (!shop.terminal_id) {
      return res.json({ hasTerminal: false });
    }

    // Get reader status from Stripe
    const reader = await stripe.terminal.readers.retrieve(
      shop.terminal_id,
      {},
      {
        stripeAccount: shop.stripe_account_id,
      }
    );

    res.json({
      hasTerminal: true,
      terminal: {
        id: reader.id,
        label: reader.label,
        status: reader.status,
        deviceType: reader.device_type,
        model: shop.terminal_model,
      },
    });
  } catch (error) {
    console.error('❌ Terminal status check failed:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get terminal status (POST with shopId in body)
app.post('/api/terminal/status', async (req, res) => {
  const { shopId } = req.body;

  if (!stripe) {
    return res.status(500).json({ error: 'Stripe not configured' });
  }

  if (!shopId) {
    return res.status(400).json({ error: 'Shop ID required' });
  }

  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return res.status(500).json({ error: 'Database not configured' });
    }

    const { createClient } = require('@supabase/supabase-js');
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get shop
    const { data: shop, error: shopError } = await supabase
      .from('shops')
      .select('stripe_account_id, terminal_id, terminal_status, terminal_model')
      .eq('id', shopId)
      .single();

    if (shopError || !shop) {
      return res.status(404).json({ error: 'Shop not found' });
    }

    if (!shop.terminal_id) {
      return res.json({ hasTerminal: false });
    }

    // Get reader status from Stripe
    const reader = await stripe.terminal.readers.retrieve(
      shop.terminal_id,
      {},
      {
        stripeAccount: shop.stripe_account_id,
      }
    );

    res.json({
      hasTerminal: true,
      terminal: {
        id: reader.id,
        label: reader.label,
        status: reader.status,
        deviceType: reader.device_type,
        model: shop.terminal_model,
      },
    });
  } catch (error) {
    console.error('❌ Terminal status check failed:', error);
    res.status(500).json({ error: error.message });
  }
});

// Webhook endpoint for Stripe events
// IMPORTANT: This needs raw body for signature verification
app.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret) {
    console.warn('⚠️ STRIPE_WEBHOOK_SECRET not set - webhooks will not be verified!');
    return res.status(500).json({ error: 'Webhook secret not configured' });
  }

  if (!stripe) {
    console.error('Webhook requested but Stripe client is not configured');
    return res.status(500).json({ error: 'Stripe not configured' });
  }

  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    console.error('❌ Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  console.log('🔔 Webhook received:', event.type);

  // Handle the event
  try {
    switch (event.type) {
      case 'payment_intent.succeeded':
        await handleTerminalPayment(event.data.object);
        break;
        
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
        await handleSubscriptionUpdate(event.data.object);
        break;
        
      case 'customer.subscription.deleted':
        await handleSubscriptionCanceled(event.data.object);
        break;
        
      case 'customer.subscription.trial_will_end':
        await handleTrialEnding(event.data.object);
        break;
        
      case 'invoice.payment_succeeded':
        await handlePaymentSucceeded(event.data.object);
        break;
        
      case 'invoice.payment_failed':
        await handlePaymentFailed(event.data.object);
        break;
        
      default:
        console.log(`ℹ️ Unhandled event type: ${event.type}`);
    }
    
    res.json({ received: true });
  } catch (error) {
    console.error('❌ Error handling webhook:', error);
    res.status(500).json({ error: 'Webhook handler failed' });
  }
});

// Webhook handlers
async function handleTerminalPayment(paymentIntent) {
  console.log('💳 Handling terminal payment:', paymentIntent.id);
  
  const invoiceId = paymentIntent.metadata?.invoiceId;
  
  if (!invoiceId) {
    console.warn('⚠️ No invoice ID in payment intent metadata');
    return;
  }
  
  console.log('📄 Updating invoice:', invoiceId);
  
  // Update Supabase
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ADMIN_KEY;
  
  if (!supabaseUrl || !supabaseKey) {
    console.warn('⚠️ Supabase credentials not configured - skipping database update');
    return;
  }
  
  try {
    const { createClient } = require('@supabase/supabase-js');
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    // Mark invoice as paid
    const { error } = await supabase
      .from('invoices')
      .update({
        status: 'paid',
        paid_date: new Date().toISOString(),
        payment_intent_id: paymentIntent.id,
        updated_at: new Date().toISOString()
      })
      .eq('id', invoiceId);
    
    if (error) {
      console.error('❌ Error updating invoice:', error);
    } else {
      console.log('✅ Invoice marked as paid:', invoiceId);
    }
  } catch (error) {
    console.error('❌ Error in handleTerminalPayment:', error);
  }
}

async function handleSubscriptionUpdate(subscription) {
  console.log('🔄 Handling subscription update:', subscription.id);
  
  const customerId = subscription.customer;
  const status = subscription.status;
  const priceId = subscription.items.data[0].price.id;
  
  // Map price ID to plan name - use EXACT same format as frontend expects
  const PRICE_TO_PLAN = {
    // Monthly price IDs
    'price_1SX97Z4K55W1qqBCSwzYlDd6': 'Single Shop',
    'price_1SX97b4K55W1qqBC7o7fJYUi': 'Local Shop',
    'price_1SX97d4K55W1qqBCcNM0eP00': 'Multi Shop',
    // Annual price IDs
    'price_1Slydh4K55W1qqBCPa4CAwOi': 'Single Shop',
    'price_1Slyf44K55W1qqBCIayxsn8D': 'Local Shop',
    'price_1Slyfn4K55W1qqBCMj84DH1q': 'Multi Shop',
  };
  
  let planName = PRICE_TO_PLAN[priceId];
  
  // If no mapping found, try to normalize nickname
  if (!planName) {
    const nickname = subscription.items.data[0].price.nickname || '';
    const lower = nickname.toLowerCase();
    if (lower.includes('single')) planName = 'Single Shop';
    else if (lower.includes('local')) planName = 'Local Shop';
    else if (lower.includes('multi')) planName = 'Multi Shop';
    else planName = nickname || 'Single Shop'; // default to Single Shop
    
    console.warn('⚠️ Unknown Stripe price ID:', priceId, 'nickname:', nickname, 'mapped to:', planName);
  }
  
  // Update Supabase
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ADMIN_KEY;
  
  if (!supabaseUrl || !supabaseKey) {
    console.warn('⚠️ Supabase credentials not configured - skipping database update');
    return;
  }
  
  try {
    const { createClient } = require('@supabase/supabase-js');
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    // Find user by Stripe customer ID
    const { data: users, error: findError } = await supabase
      .from('users')
      .select('*')
      .eq('stripe_customer_id', customerId)
      .limit(1);
    
    if (findError) {
      console.error('❌ Error finding user:', findError);
      return;
    }
    
    if (!users || users.length === 0) {
      console.warn('⚠️ No user found with customer ID:', customerId);
      return;
    }
    
    const user = users[0];
    
    // Calculate next billing date (current_period_end)
    const nextBillingDate = subscription.current_period_end 
      ? new Date(subscription.current_period_end * 1000).toISOString() 
      : null;
    
    // Update user subscription info
    const { error: updateError } = await supabase
      .from('users')
      .update({
        stripe_subscription_id: subscription.id,
        subscription_status: status,
        subscription_plan: planName,
        trial_end: subscription.trial_end ? new Date(subscription.trial_end * 1000).toISOString() : null,
        subscription_end: nextBillingDate,
        updated_at: new Date().toISOString()
      })
      .eq('id', user.id);
    
    if (updateError) {
      console.error('❌ Error updating user:', updateError);
    } else {
      console.log('✅ User subscription updated:', user.email, '|', status, '|', planName, '| Next billing:', nextBillingDate);
    }
  } catch (error) {
    console.error('❌ Error in handleSubscriptionUpdate:', error);
  }
}

async function handleSubscriptionCanceled(subscription) {
  console.log('❌ Handling subscription cancellation:', subscription.id);
  
  const customerId = subscription.customer;
  
  // Update Supabase
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ADMIN_KEY;
  
  if (!supabaseUrl || !supabaseKey) {
    console.warn('⚠️ Supabase credentials not configured - skipping database update');
    return;
  }
  
  try {
    const { createClient } = require('@supabase/supabase-js');
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    // Find user by Stripe customer ID
    const { data: users, error: findError } = await supabase
      .from('users')
      .select('*')
      .eq('stripe_customer_id', customerId)
      .limit(1);
    
    if (findError || !users || users.length === 0) {
      console.warn('⚠️ No user found with customer ID:', customerId);
      return;
    }
    
    const user = users[0];
    
    // Update user to canceled status
    const { error: updateError } = await supabase
      .from('users')
      .update({
        subscription_status: 'canceled',
        subscription_end: subscription.current_period_end ? new Date(subscription.current_period_end * 1000).toISOString() : null,
        updated_at: new Date().toISOString()
      })
      .eq('id', user.id);
    
    if (updateError) {
      console.error('❌ Error updating user:', updateError);
    } else {
      console.log('✅ User subscription canceled:', user.email);
    }
  } catch (error) {
    console.error('❌ Error in handleSubscriptionCanceled:', error);
  }
}

async function handleTrialEnding(subscription) {
  console.log('⏰ Trial ending soon for subscription:', subscription.id);
  // You can send an email notification here
  // For now, just log it
}

async function handlePaymentSucceeded(invoice) {
  console.log('✅ Payment succeeded for invoice:', invoice.id);
  
  // When first payment succeeds after trial, update status to 'active'
  const subscriptionId = invoice.subscription;
  
  if (!subscriptionId) return;
  
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ADMIN_KEY;
  
  if (!supabaseUrl || !supabaseKey) return;
  
  try {
    const { createClient } = require('@supabase/supabase-js');
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    // Find user by subscription ID
    const { data: users } = await supabase
      .from('users')
      .select('*')
      .eq('stripe_subscription_id', subscriptionId)
      .limit(1);
    
    if (users && users.length > 0) {
      // Fetch full subscription from Stripe to get next billing date
      const subscription = await stripe.subscriptions.retrieve(subscriptionId);
      
      await supabase
        .from('users')
        .update({
          subscription_status: 'active',
          subscription_end: subscription.current_period_end ? new Date(subscription.current_period_end * 1000).toISOString() : null,
          updated_at: new Date().toISOString()
        })
        .eq('id', users[0].id);
      
      console.log('✅ User marked as active after payment:', users[0].email);
    }
  } catch (error) {
    console.error('❌ Error in handlePaymentSucceeded:', error);
  }
}

async function handlePaymentFailed(invoice) {
  console.log('❌ Payment failed for invoice:', invoice.id);
  
  const customerId = invoice.customer;
  
  // Update Supabase to mark subscription as past_due
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ADMIN_KEY;
  
  if (!supabaseUrl || !supabaseKey) return;
  
  try {
    const { createClient } = require('@supabase/supabase-js');
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    const { data: users } = await supabase
      .from('users')
      .select('*')
      .eq('stripe_customer_id', customerId)
      .limit(1);
    
    if (users && users.length > 0) {
      await supabase
        .from('users')
        .update({
          subscription_status: 'past_due',
          updated_at: new Date().toISOString()
        })
        .eq('id', users[0].id);
      
      console.log('✅ User marked as past_due:', users[0].email);
    }
  } catch (error) {
    console.error('❌ Error in handlePaymentFailed:', error);
  }
}

// ===========================
// Search Dealers Route
// ===========================

// Search dealerships via Google Programmable Search API
app.post('/api/search-dealers', async (req, res) => {
  try {
    const { manufacturer, location, shopId } = req.body;

    if (!manufacturer || !location) {
      return res.status(400).json({ error: 'Missing manufacturer or location' });
    }

    console.log('🔍 Searching dealerships for:', manufacturer, 'near', location);

    // Initialize Supabase client
    const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ADMIN_KEY;

    if (!supabaseUrl || !supabaseKey) {
      console.warn('⚠️ Supabase credentials not configured - cannot cache results');
      // Continue without caching
    }

    let supabase = null;
    if (supabaseUrl && supabaseKey) {
      const { createClient } = require('@supabase/supabase-js');
      supabase = createClient(supabaseUrl, supabaseKey);
    }

    // Check cache first (30 day TTL) if Supabase is available
    if (supabase) {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

      const { data: cached, error: cacheError } = await supabase
        .from('dealership_search_cache')
        .select('results, cached_at')
        .eq('manufacturer', manufacturer.toLowerCase())
        .eq('location', location.toLowerCase())
        .gte('cached_at', thirtyDaysAgo)
        .single();

      if (cached && !cacheError) {
        console.log('✅ Cache hit for:', manufacturer, location);
        return res.status(200).json({
          results: cached.results,
          cached: true,
          cached_at: cached.cached_at
        });
      }
    }

    console.log('🔍 Cache miss - calling Google API for:', manufacturer, location);

    // Get Google API credentials
    const GOOGLE_API_KEY = process.env.GOOGLE_SEARCH_API_KEY || 'AIzaSyAoepqAtWCIEcskpkSS22kD3TeQM7rDlJE';
    const GOOGLE_CX = process.env.GOOGLE_SEARCH_CX || '5783145ca815040ec';

    if (!GOOGLE_API_KEY || GOOGLE_API_KEY === 'your-api-key-here') {
      return res.status(503).json({ 
        error: 'Google Search API not configured', 
        message: 'Please set GOOGLE_SEARCH_API_KEY environment variable' 
      });
    }

    // Build search query
    const query = `${manufacturer} dealership near ${location}`;
    
    // Call Google Programmable Search API
    const googleUrl = `https://www.googleapis.com/customsearch/v1?key=${GOOGLE_API_KEY}&cx=${GOOGLE_CX}&q=${encodeURIComponent(query)}&num=5`;
    
    const response = await fetch(googleUrl);
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error('Google API Error:', errorData);
      return res.status(response.status).json({ 
        error: 'Google search failed', 
        details: errorData 
      });
    }

    const data = await response.json();

    // Parse results into clean format
    const results = (data.items || []).map(item => ({
      title: item.title,
      link: item.link,
      snippet: item.snippet,
      displayLink: item.displayLink
    }));

    // Save to cache if Supabase is available
    if (supabase) {
      const { error: insertError } = await supabase
        .from('dealership_search_cache')
        .upsert({
          manufacturer: manufacturer.toLowerCase(),
          location: location.toLowerCase(),
          results: results,
          cached_at: new Date().toISOString()
        }, {
          onConflict: 'manufacturer,location'
        });

      if (insertError) {
        console.warn('Failed to cache results:', insertError);
        // Continue anyway - cache failure shouldn't break the feature
      }
    }

    console.log('✅ Google API call successful, returning', results.length, 'results');

    return res.status(200).json({
      results: results,
      cached: false,
      search_query: query
    });

  } catch (error) {
    console.error('❌ Search dealers error:', error);
    return res.status(500).json({ 
      error: 'Internal server error', 
      message: error.message 
    });
  }
});

// ===========================
// Send Invoice Route (Email/SMS)
// ===========================

app.post('/api/send-invoice', async (req, res) => {
  console.log('[SendInvoice] Request received:', JSON.stringify(req.body, null, 2));
  
  try {
    const { 
      invoiceId, 
      shopId, 
      sendEmail, 
      sendSms, 
      customerEmail, 
      customerPhone,
      customerName,
      googleReviewUrl  // Optional - for paid invoices to include review request
    } = req.body;

    // Validate required fields
    if (!invoiceId || !shopId) {
      return res.status(400).json({ error: 'invoiceId and shopId are required' });
    }

    if (!sendEmail && !sendSms) {
      return res.status(400).json({ error: 'At least one of sendEmail or sendSms must be true' });
    }

    if (sendEmail && !customerEmail) {
      return res.status(400).json({ error: 'customerEmail is required when sendEmail is true' });
    }

    if (sendSms && !customerPhone) {
      return res.status(400).json({ error: 'customerPhone is required when sendSms is true' });
    }

    // Initialize Supabase
    const { createClient } = require('@supabase/supabase-js');
    const crypto = require('crypto');
    
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    
    if (!supabaseUrl || !supabaseKey) {
      console.error('[SendInvoice] Missing Supabase credentials');
      return res.status(500).json({ error: 'Server configuration error: Missing Supabase credentials' });
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // First, try to get invoice from invoices table (has most up-to-date status)
    const { data: invoiceRow, error: invoiceError } = await supabase
      .from('invoices')
      .select('*')
      .eq('id', invoiceId)
      .eq('shop_id', shopId)
      .single();

    let invoice = null;
    
    if (invoiceRow) {
      // Use invoice from invoices table (has current status)
      invoice = invoiceRow;
      console.log('[SendInvoice] Using invoice from invoices table with status:', invoice.status);
    } else {
      // Fallback to data table JSONB
      const { data: shopData, error: dataError } = await supabase
        .from('data')
        .select('invoices')
        .eq('shop_id', shopId)
        .single();

      if (dataError || !shopData) {
        console.error('[SendInvoice] Error fetching shop data:', dataError);
        return res.status(404).json({ error: 'Shop not found' });
      }

      const invoices = shopData.invoices || [];
      invoice = invoices.find(inv => inv.id === invoiceId);
      console.log('[SendInvoice] Using invoice from data JSONB with status:', invoice?.status);
    }

    if (!invoice) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    // Get shop info for branding
    const { data: shop, error: shopError } = await supabase
      .from('shops')
      .select('name, phone, email')
      .eq('id', shopId)
      .single();

    if (shopError) {
      console.error('[SendInvoice] Error fetching shop:', shopError);
    }

    const shopName = shop?.name || 'Our Business';
    const shopPhone = shop?.phone || '';
    const shopEmail = shop?.email || '';

    // Generate secure token
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30); // 30 days

    // Store token in invoice_tokens table
    const sentVia = [];
    if (sendEmail) sentVia.push('email');
    if (sendSms) sentVia.push('sms');

    const { error: tokenError } = await supabase
      .from('invoice_tokens')
      .insert({
        token,
        invoice_id: invoiceId,
        shop_id: shopId,
        expires_at: expiresAt.toISOString(),
        sent_via: sentVia,
        recipient_email: customerEmail || null,
        recipient_phone: customerPhone || null
      });

    if (tokenError) {
      console.error('[SendInvoice] Error creating token:', tokenError);
      return res.status(500).json({ error: 'Failed to create invoice token: ' + tokenError.message });
    }

    // Build the public invoice URL
    const baseUrl = process.env.APP_BASE_URL || 'https://xpose.management';
    const invoiceUrl = `${baseUrl}/public-invoice.html?token=${token}`;

    // Calculate invoice total (subtotal + tax - discount)
    const subtotal = (invoice.items || []).reduce((sum, item) => {
      return sum + (parseFloat(item.price) || 0) * (parseInt(item.quantity || item.qty) || 1);
    }, 0);
    const taxRate = parseFloat(invoice.tax_rate) || 0;
    const discountRate = parseFloat(invoice.discount) || 0;
    const tax = subtotal * (taxRate / 100);
    const discount = subtotal * (discountRate / 100);
    const invoiceTotal = subtotal + tax - discount;
    
    console.log('[SendInvoice] Calculation:', { 
      subtotal, 
      taxRate, 
      discountRate, 
      tax, 
      discount, 
      invoiceTotal,
      invoiceData: { tax_rate: invoice.tax_rate, discount: invoice.discount, items: invoice.items?.length }
    });
    
    // Check if invoice is paid
    const isPaid = invoice.status && invoice.status.toLowerCase() === 'paid';
    console.log('[SendInvoice] Invoice paid status:', { status: invoice.status, isPaid });

    const results = { email: null, sms: null };

    // Send Email via Resend
    if (sendEmail && customerEmail) {
      const resendKey = process.env.RESEND_API_KEY;
      if (!resendKey) {
        results.email = { success: false, error: 'RESEND_API_KEY not configured' };
        console.warn('[SendInvoice] RESEND_API_KEY not configured');
      } else {
        try {
          const emailHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
    <h1 style="color: white; margin: 0; font-size: 28px;">${shopName}</h1>
    <p style="color: rgba(255,255,255,0.9); margin: 10px 0 0 0;">Invoice #${invoice.number || invoiceId.slice(0, 8)}</p>
  </div>
  
  <div style="background: #f8f9fa; padding: 30px; border: 1px solid #e9ecef; border-top: none;">
    <p style="font-size: 16px; margin-bottom: 20px;">Hi ${customerName || 'Valued Customer'},</p>
    
    <p>Please find your invoice attached below. Click the button to view the full details.</p>
    
    <div style="background: white; border-radius: 8px; padding: 20px; margin: 20px 0; border: 1px solid #e9ecef;">
      <table style="width: 100%; border-collapse: collapse;">
        <tr>
          <td style="padding: 8px 0; color: #666;">Invoice Number:</td>
          <td style="padding: 8px 0; text-align: right; font-weight: 600;">#${invoice.number || invoiceId.slice(0, 8)}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: #666;">Date:</td>
          <td style="padding: 8px 0; text-align: right;">${new Date(invoice.date || Date.now()).toLocaleDateString()}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: #666;">Due Date:</td>
          <td style="padding: 8px 0; text-align: right;">${invoice.due ? new Date(invoice.due).toLocaleDateString() : 'Upon Receipt'}</td>
        </tr>
        <tr style="border-top: 2px solid #667eea;">
          <td style="padding: 12px 0; font-weight: 600; font-size: 18px;">Total Due:</td>
          <td style="padding: 12px 0; text-align: right; font-weight: 700; font-size: 20px; color: #667eea;">$${invoiceTotal.toFixed(2)}</td>
        </tr>
      </table>
    </div>
    
    <div style="text-align: center; margin: 30px 0;">
      <a href="${invoiceUrl}" style="display: inline-block; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 14px 40px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px;">View Invoice</a>
    </div>
    
    <p style="color: #666; font-size: 14px; margin-top: 30px;">
      If you have any questions, please contact us${shopPhone ? ' at ' + shopPhone : ''}${shopEmail ? ' or ' + shopEmail : ''}.
    </p>
  </div>
  
  <div style="text-align: center; padding: 20px; color: #999; font-size: 12px;">
    <p>This invoice was sent by ${shopName}</p>
    <p>This link will expire in 30 days.</p>
  </div>
</body>
</html>`;

          const fetch = require('node-fetch');
          const emailResponse = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${resendKey}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              from: `${shopName} <invoices@xpose.management>`,
              to: [customerEmail],
              subject: `Invoice #${invoice.number || invoiceId.slice(0, 8)} from ${shopName}`,
              html: emailHtml
            })
          });

          const emailResult = await emailResponse.json();
          
          if (emailResponse.ok) {
            results.email = { success: true, messageId: emailResult.id };
            console.log('[SendInvoice] Email sent successfully:', emailResult.id);
          } else {
            results.email = { success: false, error: emailResult.message || 'Failed to send email' };
            console.error('[SendInvoice] Email failed:', emailResult);
          }
        } catch (emailErr) {
          results.email = { success: false, error: emailErr.message };
          console.error('[SendInvoice] Email error:', emailErr);
        }
      }
    }

    // Send SMS via Twilio
    if (sendSms && customerPhone) {
      const twilioSid = process.env.TWILIO_ACCOUNT_SID;
      const twilioToken = process.env.TWILIO_AUTH_TOKEN;
      
      if (!twilioSid || !twilioToken) {
        results.sms = { success: false, error: 'Twilio not configured' };
        console.warn('[SendInvoice] Twilio not configured');
      } else {
        try {
          // Get shop's Twilio number
          const { data: twilioNumber, error: twilioError } = await supabase
            .from('shop_twilio_numbers')
            .select('phone_number')
            .eq('shop_id', shopId)
            .single();

          if (twilioError || !twilioNumber) {
            results.sms = { success: false, error: 'No Twilio number configured for this shop' };
            console.error('[SendInvoice] No Twilio number for shop:', twilioError);
          } else {
            const twilio = require('twilio')(twilioSid, twilioToken);
            
            // Build invoice SMS message
            let smsBody;
            if (isPaid) {
              smsBody = `${shopName}: Your Invoice #${invoice.number || invoiceId.slice(0, 8)} has been paid. Thank you! View your receipt: ${invoiceUrl}`;
            } else {
              smsBody = `${shopName}: Your invoice #${invoice.number || invoiceId.slice(0, 8)} for $${invoiceTotal.toFixed(2)} is ready: ${invoiceUrl}`;
            }
            
            console.log('[SendInvoice] SMS body length:', smsBody.length, 'chars');
            
            // Send invoice SMS
            const message = await twilio.messages.create({
              body: smsBody,
              from: twilioNumber.phone_number,
              to: customerPhone
            });

            results.sms = { success: true, messageSid: message.sid };
            console.log('[SendInvoice] SMS sent successfully:', message.sid);
            
            // If paid invoice with Google review URL, send review request as separate SMS after delay
            if (isPaid && googleReviewUrl) {
              console.log('[SendInvoice] Waiting 5 seconds before sending review request...');
              await new Promise(resolve => setTimeout(resolve, 5000));
              
              try {
                // Shorten long Google URLs
                let shortReviewUrl = googleReviewUrl;
                if (googleReviewUrl.length > 80) {
                  try {
                    const tinyResponse = await fetch(`https://tinyurl.com/api-create.php?url=${encodeURIComponent(googleReviewUrl)}`);
                    if (tinyResponse.ok) {
                      shortReviewUrl = await tinyResponse.text();
                      console.log('[SendInvoice] Shortened review URL:', shortReviewUrl);
                    }
                  } catch (e) {
                    console.warn('[SendInvoice] URL shortening failed:', e.message);
                  }
                }
                
                const reviewBody = `Hi! Thanks for choosing ${shopName}. We'd love your feedback! Please leave us a review: ${shortReviewUrl}`;
                console.log('[SendInvoice] Review SMS length:', reviewBody.length, 'chars');
                
                const reviewMsg = await twilio.messages.create({
                  body: reviewBody,
                  from: twilioNumber.phone_number,
                  to: customerPhone
                });
                
                results.reviewSms = { success: true, messageSid: reviewMsg.sid };
                console.log('[SendInvoice] Review SMS sent successfully:', reviewMsg.sid);
              } catch (reviewErr) {
                results.reviewSms = { success: false, error: reviewErr.message };
                console.error('[SendInvoice] Review SMS error:', reviewErr);
              }
            }
            console.log('[SendInvoice] SMS sent successfully:', message.sid);
          }
        } catch (smsErr) {
          results.sms = { success: false, error: smsErr.message };
          console.error('[SendInvoice] SMS error:', smsErr);
        }
      }
    }

    // Determine overall success
    const emailOk = !sendEmail || (results.email && results.email.success);
    const smsOk = !sendSms || (results.sms && results.sms.success);
    const success = emailOk && smsOk;

    console.log('[SendInvoice] Complete. Success:', success, 'Results:', results);

    return res.json({
      success,
      invoiceUrl,
      token,
      results
    });

  } catch (error) {
    console.error('[SendInvoice] Unexpected error:', error);
    return res.status(500).json({ error: 'Internal server error: ' + error.message });
  }
});

// Send Google Review Request Route
// ===========================
app.post('/api/send-review-request', async (req, res) => {
  try {
    const { invoiceId, shopId, customerEmail, customerPhone, customerName, googleReviewUrl, sendEmail, sendSms } = req.body;

    console.log('[ReviewRequest] Incoming request:', { invoiceId, shopId, customerEmail, customerPhone, googleReviewUrl, sendEmail, sendSms });

    if (!googleReviewUrl) {
      return res.status(400).json({ error: 'Google Business URL is required' });
    }

    if (!customerEmail && !customerPhone) {
      return res.status(400).json({ error: 'Customer email or phone is required' });
    }

    // Initialize Supabase client
    const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ADMIN_KEY;

    if (!supabaseUrl || !supabaseKey) {
      console.error('[ReviewRequest] Supabase credentials not configured');
      return res.status(500).json({ error: 'Server configuration error' });
    }

    const { createClient } = require('@supabase/supabase-js');
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get shop info for personalized message
    const { data: shopData } = await supabase
      .from('shops')
      .select('name, google_business_name')
      .eq('id', shopId)
      .single();

    const shopName = shopData?.google_business_name || shopData?.name || 'our business';
    
    // Create message
    const message = `Hi ${customerName || 'there'}! Thank you for choosing ${shopName}! We'd love to hear about your experience. Please leave us a review: ${googleReviewUrl}`;

    const results = {
      email: { sent: false, success: false },
      sms: { sent: false, success: false }
    };

    // Send via email if requested
    if (sendEmail && customerEmail) {
      try {
        const RESEND_API_KEY = process.env.RESEND_API_KEY || 're_123';
        
        const emailHtml = `
          <!DOCTYPE html>
          <html>
          <head>
            <meta charset="utf-8">
            <style>
              body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
              .container { max-width: 600px; margin: 0 auto; padding: 20px; }
              .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
              .content { background: #f9fafb; padding: 30px; border-radius: 0 0 8px 8px; }
              .review-button { display: inline-block; background: #10b981; color: white; padding: 15px 30px; text-decoration: none; border-radius: 6px; font-weight: bold; margin: 20px 0; }
              .stars { font-size: 2rem; color: #fbbf24; }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="header">
                <h1 style="margin:0;font-size:1.75rem;">⭐ Share Your Experience</h1>
              </div>
              <div class="content">
                <p>Hi ${customerName || 'there'}!</p>
                <p>Thank you for choosing <strong>${shopName}</strong>! We hope you had a great experience with us.</p>
                <p>We'd love to hear your feedback. Your review helps us improve and helps others find us!</p>
                <div style="text-align:center;margin:30px 0;">
                  <div class="stars">⭐ ⭐ ⭐ ⭐ ⭐</div>
                  <a href="${googleReviewUrl}" class="review-button">Leave a Google Review</a>
                </div>
                <p style="color:#6b7280;font-size:0.875rem;">Thank you for your time!</p>
                <p style="color:#6b7280;font-size:0.875rem;">— The team at ${shopName}</p>
              </div>
            </div>
          </body>
          </html>
        `;

        const emailResponse = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${RESEND_API_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            from: 'Xpose <noreply@xposemanagement.com>',
            to: customerEmail,
            subject: `⭐ We'd love your feedback, ${customerName || ''}!`,
            html: emailHtml
          })
        });

        results.email.sent = true;
        if (emailResponse.ok) {
          results.email.success = true;
          console.log('[ReviewRequest] Email sent successfully to:', customerEmail);
        } else {
          const errorData = await emailResponse.json().catch(() => ({}));
          results.email.error = errorData.message || 'Email send failed';
          console.error('[ReviewRequest] Email send failed:', errorData);
        }
      } catch (e) {
        results.email.error = e.message;
        console.error('[ReviewRequest] Email error:', e);
      }
    }

    // Send via SMS if requested
    if (sendSms && customerPhone) {
      const twilioSid = process.env.TWILIO_ACCOUNT_SID;
      const twilioAuth = process.env.TWILIO_AUTH_TOKEN;
      
      if (twilioSid && twilioAuth) {
        try {
          // Get the shop's Twilio number (same query as send-invoice)
          const { data: twilioNumber } = await supabase
            .from('shop_twilio_numbers')
            .select('phone_number')
            .eq('shop_id', shopId)
            .single();

          if (twilioNumber?.phone_number) {
            // Format phone number to E.164
            let toPhone = customerPhone.replace(/\D/g, '');
            if (toPhone.length === 10) toPhone = '1' + toPhone;
            if (!toPhone.startsWith('+')) toPhone = '+' + toPhone;

            const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Messages.json`;
            const auth = Buffer.from(`${twilioSid}:${twilioAuth}`).toString('base64');

            const smsResponse = await fetch(twilioUrl, {
              method: 'POST',
              headers: {
                'Authorization': `Basic ${auth}`,
                'Content-Type': 'application/x-www-form-urlencoded'
              },
              body: new URLSearchParams({
                To: toPhone,
                From: twilioNumber.phone_number,
                Body: message
              })
            });

            const smsResult = await smsResponse.json();

            if (smsResponse.ok) {
              results.sms = { success: true, sent: true, sid: smsResult.sid };
              console.log('[ReviewRequest] SMS sent successfully:', smsResult.sid);
            } else {
              results.sms = { success: false, sent: true, error: smsResult.message || 'SMS send failed' };
              console.error('[ReviewRequest] SMS send failed:', smsResult);
            }
          } else {
            results.sms = { success: false, sent: false, error: 'No Twilio number configured for this shop' };
            console.warn('[ReviewRequest] No Twilio number for shop:', shopId);
          }
        } catch (e) {
          results.sms = { success: false, sent: false, error: e.message };
          console.error('[ReviewRequest] SMS error:', e);
        }
      } else {
        results.sms = { success: false, sent: false, error: 'Twilio credentials not configured' };
        console.error('[ReviewRequest] Twilio credentials missing');
      }
    }

    // Return success if at least one method succeeded
    const success = results.email.success || results.sms.success;

    return res.status(success ? 200 : 500).json({
      success,
      results
    });

  } catch (error) {
    console.error('[ReviewRequest] Unexpected error:', error);
    return res.status(500).json({ error: 'Internal server error: ' + error.message });
  }
});

// ===========================
// Send Tracking Link Route (Email/SMS)
// ===========================

app.post('/api/send-tracking', async (req, res) => {
  console.log('[SendTracking] Request received:', JSON.stringify(req.body, null, 2));
  
  try {
    const { 
      appointmentId, 
      shopId, 
      sendEmail, 
      sendSms, 
      customerEmail, 
      customerPhone,
      customerName,
      trackingCode  // The appointment's existing tracking code (from frontend)
    } = req.body;

    // Validate required fields
    if (!appointmentId || !shopId) {
      return res.status(400).json({ error: 'appointmentId and shopId are required' });
    }

    if (!sendEmail && !sendSms) {
      return res.status(400).json({ error: 'At least one of sendEmail or sendSms must be true' });
    }

    if (sendEmail && !customerEmail) {
      return res.status(400).json({ error: 'customerEmail is required when sendEmail is true' });
    }

    if (sendSms && !customerPhone) {
      return res.status(400).json({ error: 'customerPhone is required when sendSms is true' });
    }

    // Initialize Supabase
    const { createClient } = require('@supabase/supabase-js');
    const crypto = require('crypto');
    
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    
    if (!supabaseUrl || !supabaseKey) {
      console.error('[SendTracking] Missing Supabase credentials');
      return res.status(500).json({ error: 'Server configuration error' });
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Fetch appointment from data table
    const { data: shopData, error: dataError } = await supabase
      .from('data')
      .select('appointments, customers')
      .eq('shop_id', shopId)
      .single();

    if (dataError || !shopData) {
      console.error('[SendTracking] Failed to fetch shop data:', dataError);
      return res.status(404).json({ error: 'Shop data not found' });
    }

    const appointment = (shopData.appointments || []).find(apt => apt.id === appointmentId);

    if (!appointment) {
      return res.status(404).json({ error: 'Appointment not found' });
    }

    console.log('[SendTracking] Appointment loaded:', {
      id: appointment.id,
      status: appointment.status,
      vehicle: appointment.vehicle
    });

    // Get shop info
    const { data: shop, error: shopError } = await supabase
      .from('shops')
      .select('name, phone, email, logo')
      .eq('id', shopId)
      .single();

    if (shopError) {
      console.warn('[SendTracking] Could not fetch shop info:', shopError);
    }

    const shopName = shop?.name || 'Business';

    // Get vehicle info for better messaging
    const customer = shopData.customers?.find(c => c.id === appointment.customer_id);
    const vehicleInfo = customer?.vehicles?.find(v => v.id === appointment.vehicle_id);
    const vehicleDisplay = vehicleInfo 
      ? `${vehicleInfo.year || ''} ${vehicleInfo.make || ''} ${vehicleInfo.model || ''}`.trim()
      : appointment.vehicle || 'your vehicle';

    // Check for existing valid token first
    let token;
    let shortCode;
    let isExistingToken = false;
    
    const appointmentTrackingCode = trackingCode || null;
    
    const { data: existingTokens, error: fetchTokenError } = await supabase
      .from('appointment_tokens')
      .select('token, short_code, expires_at')
      .eq('appointment_id', appointmentId)
      .eq('shop_id', shopId)
      .gte('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(1);

    if (fetchTokenError) {
      console.warn('[SendTracking] Error checking for existing token:', fetchTokenError);
    }

    if (existingTokens && existingTokens.length > 0) {
      // Reuse existing token
      token = existingTokens[0].token;
      shortCode = existingTokens[0].short_code;
      isExistingToken = true;
      console.log('[SendTracking] Reusing existing token for appointment:', appointmentId);
      
      // Update sent_via and recipient info
      const sentVia = [];
      if (sendEmail) sentVia.push('email');
      if (sendSms) sentVia.push('sms');
      
      const updatePayload = {
        sent_via: sentVia,
        recipient_email: customerEmail || null,
        recipient_phone: customerPhone || null
      };
      
      if (appointmentTrackingCode && appointmentTrackingCode !== shortCode) {
        updatePayload.short_code = appointmentTrackingCode;
        shortCode = appointmentTrackingCode;
      }
      
      await supabase
        .from('appointment_tokens')
        .update(updatePayload)
        .eq('token', token);
    } else {
      // Generate new secure token
      token = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 30);

      const sentVia = [];
      if (sendEmail) sentVia.push('email');
      if (sendSms) sentVia.push('sms');

      const insertPayload = {
        token,
        appointment_id: appointmentId,
        shop_id: shopId,
        expires_at: expiresAt.toISOString(),
        sent_via: sentVia,
        recipient_email: customerEmail || null,
        recipient_phone: customerPhone || null
      };
      
      if (appointmentTrackingCode) {
        insertPayload.short_code = appointmentTrackingCode;
      }

      const { data: newTokenData, error: tokenError } = await supabase
        .from('appointment_tokens')
        .insert(insertPayload)
        .select('short_code')
        .single();

      if (tokenError) {
        console.error('[SendTracking] Failed to create token:', tokenError);
        return res.status(500).json({ error: 'Failed to create tracking link' });
      }
      
      shortCode = newTokenData?.short_code || appointmentTrackingCode;
      console.log('[SendTracking] Created new token with short_code:', shortCode);
    }

    // Build tracking URLs
    const baseUrl = process.env.APP_BASE_URL || 'https://xpose.management';
    const trackingUrl = `${baseUrl}/public-tracking.html?token=${token}`;
    const mobileTrackingUrl = `${baseUrl}/public-tracking-mobile.html?token=${token}`;

    const results = { email: null, sms: null };

    // Send SMS via Twilio
    if (sendSms && customerPhone) {
      const twilioSid = process.env.TWILIO_ACCOUNT_SID;
      const twilioToken = process.env.TWILIO_AUTH_TOKEN;
      
      if (!twilioSid || !twilioToken) {
        results.sms = { success: false, error: 'Twilio not configured' };
        console.warn('[SendTracking] Twilio not configured');
      } else {
        try {
          // Get shop's Twilio number
          const { data: twilioNumber, error: twilioError } = await supabase
            .from('shop_twilio_numbers')
            .select('phone_number')
            .eq('shop_id', shopId)
            .single();

          if (twilioError || !twilioNumber) {
            results.sms = { success: false, error: 'No Twilio number configured for this shop' };
            console.error('[SendTracking] No Twilio number for shop:', twilioError);
          } else {
            const twilio = require('twilio')(twilioSid, twilioToken);
            
            const smsBody = `${shopName}: Track your ${vehicleDisplay} status here: ${mobileTrackingUrl}`;
            
            const message = await twilio.messages.create({
              body: smsBody,
              from: twilioNumber.phone_number,
              to: customerPhone
            });

            results.sms = { success: true, sid: message.sid };
            console.log('[SendTracking] SMS sent successfully:', message.sid);
          }
        } catch (smsErr) {
          results.sms = { success: false, error: smsErr.message };
          console.error('[SendTracking] SMS error:', smsErr);
        }
      }
    }

    // Send Email via Resend (if requested)
    if (sendEmail && customerEmail) {
      const resendKey = process.env.RESEND_API_KEY;
      if (!resendKey) {
        results.email = { success: false, error: 'RESEND_API_KEY not configured' };
      } else {
        try {
          const emailResponse = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${resendKey}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              from: `${shopName} <service@xpose.management>`,
              to: [customerEmail],
              subject: `Track Your ${vehicleDisplay} - ${shopName}`,
              html: `<p>Hi ${customerName || 'there'},</p><p>Track your ${vehicleDisplay} status here: <a href="${trackingUrl}">${trackingUrl}</a></p><p>- ${shopName}</p>`
            })
          });

          const emailResult = await emailResponse.json();
          
          if (emailResponse.ok) {
            results.email = { success: true, id: emailResult.id };
            console.log('[SendTracking] Email sent:', emailResult.id);
          } else {
            results.email = { success: false, error: emailResult.message || 'Email failed' };
          }
        } catch (emailErr) {
          results.email = { success: false, error: emailErr.message };
        }
      }
    }

    const emailOk = !sendEmail || (results.email && results.email.success);
    const smsOk = !sendSms || (results.sms && results.sms.success);
    const success = emailOk && smsOk;

    console.log('[SendTracking] Complete. Success:', success, 'Results:', results);

    return res.json({
      success,
      trackingUrl,
      mobileTrackingUrl,
      token,
      shortCode,
      isExistingToken,
      results
    });

  } catch (error) {
    console.error('[SendTracking] Unexpected error:', error);
    return res.status(500).json({ error: 'Internal server error: ' + error.message });
  }
});

// ===========================
// AI LABOR LOOKUP Route
// ===========================

app.post('/api/ai-labor-lookup', async (req, res) => {
  console.log('[AI-Labor] Request received:', JSON.stringify(req.body, null, 2));
  
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
      error: 'Missing required fields',
      fallback: true
    });
  }

  // Check for OpenAI key
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) {
    console.error('[AI-Labor] OPENAI_API_KEY not configured');
    return res.status(500).json({
      status: 'error',
      error: 'OpenAI API key not configured',
      fallback: true
    });
  }

  // Initialize Supabase
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

  let supabase = null;
  if (supabaseUrl && supabaseServiceKey) {
    const { createClient } = require('@supabase/supabase-js');
    supabase = createClient(supabaseUrl, supabaseServiceKey);
  }

  try {
    // Check cache first
    if (supabase && operationId) {
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

        const { data: cachedResults } = await cacheQuery;

        if (cachedResults?.length > 0) {
          if (engineType || cachedResults.length === 1) {
            const cached = cachedResults[0];
            console.log('[AI-Labor] Cache HIT');
            return res.json({
              status: 'complete',
              source: 'cache',
              data: {
                engine_type: cached.engine_type,
                labor_hours_low: cached.ai_labor_hours_low,
                labor_hours_typical: cached.ai_labor_hours_typical,
                labor_hours_high: cached.ai_labor_hours_high,
                confidence: cached.ai_labor_confidence,
                labor_notes: cached.ai_labor_notes,
                sources: cached.sources || [],
                required_tools: cached.required_tools || [],
                vehicle_specific_tips: cached.vehicle_specific_tips || []
              }
            });
          } else if (cachedResults.length > 1) {
            return res.json({
              status: 'needs_engine_selection',
              source: 'cache',
              variants: cachedResults.map(c => ({
                engine_type: c.engine_type,
                labor_hours_low: c.ai_labor_hours_low,
                labor_hours_typical: c.ai_labor_hours_typical,
                labor_hours_high: c.ai_labor_hours_high,
                confidence: c.ai_labor_confidence,
                notes: c.ai_labor_notes,
                is_most_common: c.is_most_common || false
              }))
            });
          }
        }
      } catch (cacheErr) {
        console.warn('[AI-Labor] Cache query failed:', cacheErr.message);
      }
    }

    // Call OpenAI
    console.log('[AI-Labor] Calling OpenAI for:', vehicleYear, vehicleMake, vehicleModel, '-', operationName);

    const searchPrompt = `Find the REAL labor time for this automotive repair:

SERVICE: ${operationName}
VEHICLE: ${vehicleYear} ${vehicleMake} ${vehicleModel}
${engineType ? `ENGINE: ${engineType}` : ''}
${dbLaborHours ? `DB ESTIMATE: ${dbLaborHours.low}-${dbLaborHours.high} hrs` : ''}

Respond with JSON:
{
  "needs_engine_selection": boolean,
  "engine_variants": [{"engine_type": "2.5L", "is_most_common": true, "labor_hours_low": 0.8, "labor_hours_typical": 1.0, "labor_hours_high": 1.2, "confidence": "high", "notes": "..."}],
  "single_result": {"engine_type": "All", "labor_hours_low": number, "labor_hours_typical": number, "labor_hours_high": number, "confidence": "high"|"medium"|"low", "labor_notes": "...", "sources": [], "required_tools": [], "vehicle_specific_tips": []}
}`;

    const openaiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${openaiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: 'You are an automotive labor time expert. Respond with ONLY valid JSON.' },
          { role: 'user', content: searchPrompt }
        ],
        temperature: 0.3,
        max_tokens: 2000,
        response_format: { type: 'json_object' }
      })
    });

    if (!openaiResponse.ok) {
      throw new Error(`OpenAI API error: ${openaiResponse.status}`);
    }

    const openaiData = await openaiResponse.json();
    const aiResult = JSON.parse(openaiData.choices[0]?.message?.content || '{}');
    console.log('[AI-Labor] OpenAI result:', JSON.stringify(aiResult, null, 2));

    // Handle multiple engine variants
    if (aiResult.needs_engine_selection && !engineType && aiResult.engine_variants?.length > 1) {
      return res.json({
        status: 'needs_engine_selection',
        source: 'ai',
        variants: aiResult.engine_variants
      });
    }

    // Single result
    const result = aiResult.single_result || aiResult;

    return res.json({
      status: 'complete',
      source: 'ai',
      data: {
        engine_type: result.engine_type || engineType || 'all',
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
    console.error('[AI-Labor] Error:', error.message);
    return res.status(500).json({
      status: 'error',
      error: error.message,
      fallback: true
    });
  }
});


// ===========================
// AI DIAGNOSTIC TRIAGE Route
// ===========================

app.post('/api/ai-diagnostic-triage', async (req, res) => {
  console.log('[AI-Triage] Request received:', JSON.stringify(req.body, null, 2));
  try {
    const {
      playbookId,
      playbookTitle,
      vehicleYear,
      vehicleMake,
      vehicleModel,
      engineType,
      triageAnswers = [],
      likelyCauses = []
    } = req.body;

    // Validate required fields
    if (!playbookTitle || !vehicleYear || !vehicleMake || !vehicleModel || !triageAnswers.length || !likelyCauses.length) {
      return res.status(400).json({ 
        status: 'error', 
        error: 'Missing required fields',
        fallback: true
      });
    }

    // Check for OpenAI key
    const openaiKey = process.env.OPENAI_API_KEY;
    if (!openaiKey) {
      console.error('[AI-Triage] OPENAI_API_KEY not configured');
      return res.status(500).json({
        status: 'error',
        error: 'OpenAI API key not configured',
        fallback: true
      });
    }

    // Compose prompt for OpenAI
    const triageText = triageAnswers.map((qa, i) => `${i+1}. Q: ${qa.question}\n   A: ${qa.answer}`).join('\n');
    const causesText = likelyCauses.map((c, i) => `${i+1}. ${c}`).join('\n');
    const searchPrompt = `You are an expert automotive diagnostician. Given the following vehicle and diagnosis context, analyze real-world web results and return the most probable cause (from the provided list), a vehicle-specific explanation, and what to check next.\n\nVEHICLE: ${vehicleYear} ${vehicleMake} ${vehicleModel}${engineType ? `\nENGINE: ${engineType}` : ''}\nDIAGNOSIS: ${playbookTitle}\nTRIAGE ANSWERS:\n${triageText}\nLIKELY CAUSES:\n${causesText}\n\nRespond with JSON:\n{\n  \'probableCause\': string,\n  \'explanation\': string,\n  \'whatToCheck\': string,\n  \'confidence\': 'high'|'medium'|'low',\n  \'sources\': [string]\n}`;

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
        max_tokens: 1200,
        response_format: { type: 'json_object' }
      })
    });

    if (!openaiResponse.ok) {
      throw new Error(`OpenAI API error: ${openaiResponse.status}`);
    }

    const openaiData = await openaiResponse.json();
    const aiResult = JSON.parse(openaiData.choices[0]?.message?.content || '{}');
    console.log('[AI-Triage] OpenAI result:', JSON.stringify(aiResult, null, 2));

    return res.json({
      probableCause: aiResult.probableCause || aiResult.cause || 'Unknown',
      explanation: aiResult.explanation || '',
      whatToCheck: aiResult.whatToCheck || '',
      confidence: aiResult.confidence || 'medium',
      sources: aiResult.sources || []
    });

  } catch (e) {
    console.error('[AI-Triage] Error:', e.message);
    res.status(500).json({ error: e.message || 'Internal server error' });
  }
});

console.log('✅ AI Labor Lookup route registered');
console.log('✅ AI Diagnostic Triage route registered');

// ===========================
// AI DIAGNOSIS GENERAL Route
// ===========================

app.post('/api/ai-diagnosis-general', async (req, res) => {
  console.log('[AI-GeneralDiagnosis] Request received:', JSON.stringify(req.body, null, 2));
  try {
    const { diagnosisTitle, vehicleYear, vehicleMake, vehicleModel } = req.body;

    if (!diagnosisTitle || !vehicleYear || !vehicleMake || !vehicleModel) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const openaiKey = process.env.OPENAI_API_KEY;
    if (!openaiKey) {
      console.error('[AI-GeneralDiagnosis] OPENAI_API_KEY not configured');
      return res.status(500).json({ error: 'OpenAI API key not configured' });
    }

    const searchPrompt = `You are an expert automotive diagnostician. Given the following vehicle and symptom/diagnosis, search real-world web results and return the single most common cause for this issue on this vehicle.\n\nVEHICLE: ${vehicleYear} ${vehicleMake} ${vehicleModel}\nSYMPTOM/DIAGNOSIS: ${diagnosisTitle}\n\nRespond with JSON:\n{\n  'probableCause': string,\n  'explanation': string,\n  'confidence': 'high'|'medium'|'low',\n  'sources': [string]\n}`;

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
});


// Twilio Messaging Routes
// ===========================

try {
  const messagingAPI = require('./helpers/messaging-api-cjs.js');
  
  console.log('✅ Messaging API loaded successfully');

  // Provision a new Twilio number for a shop
  app.post('/api/messaging/provision', messagingAPI.provisionNumber);

  // Send an outbound message
  app.post('/api/messaging/send', messagingAPI.sendMessage);

  // Upload media for outbound messages
  app.post('/api/messaging/upload', messagingAPI.uploadMedia);

  // Webhook for incoming messages
  app.post('/api/messaging/webhook', messagingAPI.receiveWebhook);

  // Status callbacks from Twilio
  app.post('/api/messaging/status', messagingAPI.receiveStatusCallback);

  // Get threads for a shop
  app.get('/api/messaging/threads/:shopId', messagingAPI.getThreads);

  // Get messages for a thread
  app.get('/api/messaging/messages/:threadId', messagingAPI.getMessages);

  // Permanently delete a thread (service-role) - disabled, function not exported
  // app.delete('/api/messaging/threads/:threadId', messagingAPI.deleteThread);

  // Release/delete a Twilio number
  app.delete('/api/messaging/numbers/:numberId', messagingAPI.releaseNumber);
  
  console.log('✅ All messaging routes registered');
} catch (error) {
  console.error('❌ Failed to load messaging API:', error);
  console.error('Messaging routes will not be available');
}

const PORT = process.env.PORT || process.env.STRIPE_PORT || 3001;

// Only start server if not in Vercel (Vercel uses serverless functions)
if (process.env.VERCEL !== '1') {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Stripe server running on port ${PORT}`);
    console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`🔗 Health check: http://localhost:${PORT}/health`);
  });
}

// Export for Vercel serverless

module.exports = app;
