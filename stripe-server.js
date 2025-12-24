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
      console.log('CORS check: incoming origin=', incoming, 'allowedOrigins=', allowedOrigins);

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

// Serve static files
app.use(express.static('.'));

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
      // production price IDs -> normalized keys
      'price_1SX97Z4K55W1qqBCSwzYlDd6': 'single',
      'price_1SX97b4K55W1qqBC7o7fJYUi': 'local',
      'price_1SX97d4K55W1qqBCcNM0eP00': 'multi',
      // add additional mappings as needed
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
  const { shopId, email, businessName, country = 'US' } = req.body;
  
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

    // Create Stripe Terminal Location for this account
    const location = await stripe.terminal.locations.create(
      {
        display_name: businessName || 'Main Location',
        address: {
          line1: '123 Main St',
          city: 'City',
          state: 'State',
          postal_code: '12345',
          country: country,
        },
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

// Get terminal status
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
    'price_1SX97Z4K55W1qqBCSwzYlDd6': 'Single Shop',
    'price_1SX97b4K55W1qqBC7o7fJYUi': 'Local Shop',
    'price_1SX97d4K55W1qqBCcNM0eP00': 'Multi Shop',
    // Add any additional live price IDs here as needed
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
// Twilio Messaging Routes
// ===========================

try {
  const messagingAPI = require('./helpers/messaging-api-cjs.js');
  
  console.log('✅ Messaging API loaded successfully');

  // Provision a new Twilio number for a shop
  app.post('/api/messaging/provision', messagingAPI.provisionNumber);

  // Send an outbound message
  app.post('/api/messaging/send', messagingAPI.sendMessage);

  // Webhook for incoming messages
  app.post('/api/messaging/webhook', messagingAPI.receiveWebhook);

  // Status callbacks from Twilio
  app.post('/api/messaging/status', messagingAPI.receiveStatusCallback);

  // Get threads for a shop
  app.get('/api/messaging/threads/:shopId', messagingAPI.getThreads);

  // Get messages for a thread
  app.get('/api/messaging/messages/:threadId', messagingAPI.getMessages);

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
