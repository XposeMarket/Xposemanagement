/**
 * stripe-server.js
 * Stripe payment integration server with Terminal support
 * 
 * This handles creating checkout sessions for subscriptions + terminal hardware
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');

const HAS_STRIPE_KEY = !!process.env.STRIPE_SECRET_KEY;
console.log('🔑 Stripe Secret Key present=', HAS_STRIPE_KEY);

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

// Initialize Supabase
let supabase = null;
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ADMIN_KEY;

if (supabaseUrl && supabaseKey) {
  try {
    const { createClient } = require('@supabase/supabase-js');
    supabase = createClient(supabaseUrl, supabaseKey);
    console.log('✅ Supabase client initialized');
  } catch (err) {
    console.error('❌ Failed to initialize Supabase:', err.message);
  }
} else {
  console.warn('⚠️ Supabase credentials not set');
}

const app = express();

// Terminal hardware options
const TERMINAL_PRODUCTS = {
  'reader_m2': {
    name: 'Stripe Reader M2',
    price: 0, // included free
    stripe_product_id: 'prod_terminal_reader_m2',
    description: 'Countertop terminal, no screen'
  },
  'wisepos_e': {
    name: 'BBPOS WisePOS E',
    price: 3000, // $30/month in cents
    stripe_product_id: 'prod_Tecp1hLZB5AgXy',
    description: 'Handheld terminal with touchscreen'
  },
  'reader_s700': {
    name: 'Stripe Reader S700',
    price: 5000, // $50/month in cents
    stripe_product_id: 'prod_Tecqa4vvio8BL5',
    description: 'Premium terminal with large display'
  }
};

// Normalize frontend origin from env
function normalizeOrigin(val) {
  if (!val) return val;
  let v = String(val).trim();
  v = v.replace(/\/+$/, '');
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

app.use(cors({
  origin: function(origin, callback) {
    if (!origin) {
      console.log('CORS check: no origin (allowing)');
      return callback(null, true);
    }

    try {
      const incoming = String(origin).toLowerCase();
      console.log('CORS check: incoming origin=', incoming);

      if (allowedOrigins.indexOf(incoming) !== -1) {
        return callback(null, true);
      }

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
            // ignore
          }
        }
      }

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
app.use(express.urlencoded({ extended: true }));
app.use(express.static('.'));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    stripe: stripe ? 'connected' : 'missing',
    supabase: supabase ? 'connected' : 'missing'
  });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({ 
    message: 'Xpose Management Stripe Server with Terminal Support',
    version: '2.0.0',
    endpoints: [
      '/create-checkout-session',
      '/get-session-subscription',
      '/api/terminal/register',
      '/api/terminal/status/:shopId',
      '/api/terminal/create-payment',
      '/api/terminal/cancel-payment',
      '/health'
    ]
  });
});

// Create checkout session with terminal hardware
app.post('/create-checkout-session', async (req, res) => {
  try {
    if (!stripe) {
      console.error('Attempted checkout but Stripe client is not configured');
      return res.status(500).json({ error: 'Stripe not configured' });
    }
    
    const { priceId, customerEmail, terminalModel = 'reader_m2' } = req.body;

    console.log('📝 Checkout request:', { priceId, hasEmail: !!customerEmail, terminalModel });

    if (!priceId) {
      return res.status(400).json({ error: 'Price ID is required' });
    }

    if (!TERMINAL_PRODUCTS[terminalModel]) {
      return res.status(400).json({ error: 'Invalid terminal model' });
    }

    const envFrontend = normalizeOrigin(process.env.FRONTEND_URL);
    const origin = req.headers.origin || envFrontend || 'https://xpose-stripe-server.vercel.app';

    // Build line items
    const lineItems = [
      {
        price: priceId,
        quantity: 1,
      }
    ];

    // Add terminal hardware fee if not the free one
    if (terminalModel !== 'reader_m2') {
      const terminal = TERMINAL_PRODUCTS[terminalModel];
      lineItems.push({
        price_data: {
          currency: 'usd',
          product_data: {
            name: terminal.name,
            description: terminal.description,
          },
          recurring: { interval: 'month' },
          unit_amount: terminal.price,
        },
        quantity: 1
      });
    }

    console.log('🔄 Creating Stripe checkout session with terminal:', terminalModel);

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: lineItems,
      customer_email: customerEmail || undefined,
      subscription_data: {
        trial_period_days: 14,
        metadata: {
          terminal_model: terminalModel
        }
      },
      payment_method_options: {
        card: {
          request_three_d_secure: 'automatic',
        },
      },
      allow_promotion_codes: true,
      success_url: `${origin}/create-shop.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/paywall.html`,
      metadata: {
        terminal_model: terminalModel
      }
    });

    res.json({ url: session.url });
    console.log('✅ Checkout session created:', session.id);
  } catch (error) {
    console.error('❌ Stripe error:', error && error.message);
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
      return res.status(500).json({ error: 'Stripe not configured' });
    }
    const { customerEmail } = req.body;

    if (!customerEmail) {
      return res.status(400).json({ error: 'Customer email is required' });
    }

    const customers = await stripe.customers.list({
      email: customerEmail,
      limit: 1,
    });

    if (customers.data.length === 0) {
      return res.json({ subscribed: false });
    }

    const customer = customers.data[0];
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
      return res.status(500).json({ error: 'Stripe not configured' });
    }
    const { sessionId } = req.body;

    if (!sessionId) {
      return res.status(400).json({ error: 'Session ID is required' });
    }

    console.log('🔍 Fetching session details for:', sessionId);

    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ['subscription', 'customer'],
    });

    if (!session.subscription) {
      return res.status(400).json({ error: 'No subscription found for this session' });
    }

    const subscription = session.subscription;
    const customer = session.customer;

    // Get terminal model from metadata
    const terminalModel = session.metadata?.terminal_model || 'reader_m2';

    const priceId = subscription.items.data[0].price.id;
    let planName = 'Unknown';
    
    const PRICE_TO_PLAN = {
      'price_1SX97Z4K55W1qqBCSwzYlDd6': 'single',
      'price_1SX97b4K55W1qqBC7o7fJYUi': 'local',
      'price_1SX97d4K55W1qqBCcNM0eP00': 'multi',
    };
    
    planName = PRICE_TO_PLAN[priceId] || (subscription.items.data[0].price.nickname || 'unknown');
    if (typeof planName === 'string') {
      const pn = planName.toString().toLowerCase();
      if (pn.includes('single')) planName = 'single';
      else if (pn.includes('local')) planName = 'local';
      else if (pn.includes('multi')) planName = 'multi';
    }

    res.json({
      customer_id: typeof customer === 'string' ? customer : customer.id,
      subscription_id: subscription.id,
      status: subscription.status,
      plan: planName,
      terminal_model: terminalModel,
      trial_end: subscription.trial_end ? new Date(subscription.trial_end * 1000).toISOString() : null,
      current_period_end: subscription.current_period_end ? new Date(subscription.current_period_end * 1000).toISOString() : null,
    });

    console.log('✅ Subscription details sent:', planName, 'Terminal:', terminalModel);
  } catch (error) {
    console.error('❌ Stripe error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ===========================
// STRIPE TERMINAL ENDPOINTS
// ===========================

// Register a terminal to a shop
app.post('/api/terminal/register', async (req, res) => {
  const { shopId, registrationCode } = req.body;
  
  if (!stripe || !supabase) {
    return res.status(500).json({ error: 'Services not configured' });
  }

  try {
    console.log('🔧 Registering terminal for shop:', shopId);

    // Get shop info
    const { data: shop, error: shopError } = await supabase
      .from('shops')
      .select('name, terminal_location_id, address, city, state, zip, stripe_account_id')
      .eq('id', shopId)
      .single();
    
    if (shopError || !shop) {
      return res.status(404).json({ error: 'Shop not found' });
    }

    let locationId = shop.terminal_location_id;

    // Create location if it doesn't exist
    if (!locationId) {
      console.log('📍 Creating Stripe Terminal location...');
      const location = await stripe.terminal.locations.create({
        display_name: shop.name,
        address: {
          line1: shop.address || '123 Main St',
          city: shop.city || 'City',
          state: shop.state || 'State',
          postal_code: shop.zip || '12345',
          country: 'US'
        }
      });
      
      locationId = location.id;
      
      // Update shop with location
      await supabase
        .from('shops')
        .update({ terminal_location_id: locationId })
        .eq('id', shopId);
      
      console.log('✅ Location created:', locationId);
    }

    // Register reader with Stripe
    console.log('🔗 Registering reader with code:', registrationCode);
    const reader = await stripe.terminal.readers.create({
      registration_code: registrationCode,
      location: locationId,
      label: `${shop.name} Terminal`
    });

    // Update shop with terminal info
    const { error: updateError } = await supabase
      .from('shops')
      .update({
        terminal_id: reader.id,
        terminal_serial: reader.serial_number,
        terminal_status: reader.status || 'online'
      })
      .eq('id', shopId);

    if (updateError) {
      console.error('❌ Error updating shop:', updateError);
    }

    res.json({ 
      success: true, 
      reader: {
        id: reader.id,
        label: reader.label,
        status: reader.status,
        device_type: reader.device_type
      }
    });
    
    console.log('✅ Terminal registered successfully');
  } catch (error) {
    console.error('❌ Terminal registration error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get terminal status for a shop
app.get('/api/terminal/status/:shopId', async (req, res) => {
  if (!stripe || !supabase) {
    return res.status(500).json({ error: 'Services not configured' });
  }

  try {
    const { data: shop } = await supabase
      .from('shops')
      .select('terminal_id, terminal_status, terminal_model')
      .eq('id', req.params.shopId)
      .single();
    
    if (!shop || !shop.terminal_id) {
      return res.json({ status: 'not_registered' });
    }

    // Get live status from Stripe
    const reader = await stripe.terminal.readers.retrieve(shop.terminal_id);
    
    res.json({
      status: reader.status,
      action: reader.action,
      device_type: reader.device_type,
      label: reader.label,
      model: shop.terminal_model
    });
  } catch (error) {
    console.error('❌ Error fetching terminal status:', error);
    res.status(500).json({ error: error.message });
  }
});

// Create a payment intent and process on terminal
app.post('/api/terminal/create-payment', async (req, res) => {
  const { invoiceId, shopId } = req.body;
  
  if (!stripe || !supabase) {
    return res.status(500).json({ error: 'Services not configured' });
  }

  try {
    console.log('💳 Creating terminal payment for invoice:', invoiceId);

    // Get invoice details
    const { data: invoice, error: invError } = await supabase
      .from('invoices')
      .select('*, customer:customers(name, email)')
      .eq('id', invoiceId)
      .single();
    
    if (invError || !invoice) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    // Get shop/terminal info
    const { data: shop, error: shopError } = await supabase
      .from('shops')
      .select('terminal_id, stripe_customer_id, name')
      .eq('id', shopId)
      .single();
    
    if (shopError || !shop) {
      return res.status(404).json({ error: 'Shop not found' });
    }

    if (!shop.terminal_id) {
      return res.status(400).json({ error: 'No terminal registered for this shop' });
    }

    // Create payment intent
    const amount = Math.round(invoice.total * 100); // Convert to cents
    
    const paymentIntent = await stripe.paymentIntents.create({
      amount: amount,
      currency: 'usd',
      payment_method_types: ['card_present'],
      capture_method: 'automatic',
      metadata: {
        invoice_id: invoiceId,
        shop_id: shopId,
        invoice_number: invoice.invoice_number,
        customer_name: invoice.customer?.name || 'Unknown'
      }
    });

    console.log('✅ Payment intent created:', paymentIntent.id);

    // Save transaction record
    const { error: txnError } = await supabase
      .from('terminal_transactions')
      .insert({
        shop_id: shopId,
        invoice_id: invoiceId,
        payment_intent_id: paymentIntent.id,
        terminal_id: shop.terminal_id,
        amount: amount,
        currency: 'usd',
        status: 'pending'
      });

    if (txnError) {
      console.error('❌ Error saving transaction:', txnError);
    }

    // Process payment on terminal
    console.log('🔄 Processing payment on terminal:', shop.terminal_id);
    
    const reader = await stripe.terminal.readers.processPaymentIntent(
      shop.terminal_id,
      {
        payment_intent: paymentIntent.id
      }
    );

    res.json({
      success: true,
      paymentIntent: paymentIntent.id,
      clientSecret: paymentIntent.client_secret,
      status: 'processing',
      amount: invoice.total
    });

    console.log('✅ Payment processing on terminal');
  } catch (error) {
    console.error('❌ Payment creation error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Cancel a terminal payment
app.post('/api/terminal/cancel-payment', async (req, res) => {
  const { paymentIntentId, shopId } = req.body;
  
  if (!stripe || !supabase) {
    return res.status(500).json({ error: 'Services not configured' });
  }

  try {
    console.log('❌ Canceling payment:', paymentIntentId);

    const { data: shop } = await supabase
      .from('shops')
      .select('terminal_id')
      .eq('id', shopId)
      .single();
    
    if (shop && shop.terminal_id) {
      // Cancel action on terminal
      await stripe.terminal.readers.cancelAction(shop.terminal_id);
    }

    // Cancel payment intent
    await stripe.paymentIntents.cancel(paymentIntentId);

    // Update transaction status
    await supabase
      .from('terminal_transactions')
      .update({ 
        status: 'canceled',
        updated_at: new Date().toISOString()
      })
      .eq('payment_intent_id', paymentIntentId);

    res.json({ success: true });
    console.log('✅ Payment canceled');
  } catch (error) {
    console.error('❌ Cancel error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ===========================
// WEBHOOK ENDPOINT
// ===========================

app.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret) {
    console.warn('⚠️ STRIPE_WEBHOOK_SECRET not set');
    return res.status(500).json({ error: 'Webhook secret not configured' });
  }

  if (!stripe) {
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

  try {
    switch (event.type) {
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

      // Terminal payment events
      case 'payment_intent.succeeded':
        await handleTerminalPaymentSucceeded(event.data.object);
        break;

      case 'payment_intent.payment_failed':
        await handleTerminalPaymentFailed(event.data.object);
        break;

      case 'payment_intent.canceled':
        await handleTerminalPaymentCanceled(event.data.object);
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

// ===========================
// WEBHOOK HANDLERS
// ===========================

async function handleSubscriptionUpdate(subscription) {
  console.log('🔄 Handling subscription update:', subscription.id);
  
  if (!supabase) return;
  
  const customerId = subscription.customer;
  const status = subscription.status;
  const priceId = subscription.items.data[0].price.id;
  const terminalModel = subscription.metadata?.terminal_model || 'reader_m2';
  
  const PRICE_TO_PLAN = {
    'price_1SX97Z4K55W1qqBCSwzYlDd6': 'Single Shop',
    'price_1SX97b4K55W1qqBC7o7fJYUi': 'Local Shop',
    'price_1SX97d4K55W1qqBCcNM0eP00': 'Multi Shop',
  };
  
  let planName = PRICE_TO_PLAN[priceId] || 'Single Shop';
  
  try {
    const { data: users } = await supabase
      .from('users')
      .select('id, email')
      .eq('stripe_customer_id', customerId)
      .limit(1);
    
    if (!users || users.length === 0) {
      console.warn('⚠️ No user found with customer ID:', customerId);
      return;
    }
    
    const user = users[0];
    
    const nextBillingDate = subscription.current_period_end 
      ? new Date(subscription.current_period_end * 1000).toISOString() 
      : null;
    
    await supabase
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

    // Update shop with terminal model
    await supabase
      .from('shops')
      .update({
        terminal_model: terminalModel,
        terminal_status: 'pending_registration'
      })
      .eq('user_id', user.id);
    
    console.log('✅ User subscription updated:', user.email, '|', planName, '| Terminal:', terminalModel);
  } catch (error) {
    console.error('❌ Error in handleSubscriptionUpdate:', error);
  }
}

async function handleSubscriptionCanceled(subscription) {
  console.log('❌ Handling subscription cancellation:', subscription.id);
  
  if (!supabase) return;
  
  const customerId = subscription.customer;
  
  try {
    const { data: users } = await supabase
      .from('users')
      .select('id, email')
      .eq('stripe_customer_id', customerId)
      .limit(1);
    
    if (!users || users.length === 0) return;
    
    const user = users[0];
    
    await supabase
      .from('users')
      .update({
        subscription_status: 'canceled',
        subscription_end: subscription.current_period_end ? new Date(subscription.current_period_end * 1000).toISOString() : null,
        updated_at: new Date().toISOString()
      })
      .eq('id', user.id);
    
    console.log('✅ User subscription canceled:', user.email);
  } catch (error) {
    console.error('❌ Error in handleSubscriptionCanceled:', error);
  }
}

async function handleTrialEnding(subscription) {
  console.log('⏰ Trial ending soon for subscription:', subscription.id);
}

async function handlePaymentSucceeded(invoice) {
  console.log('✅ Payment succeeded for invoice:', invoice.id);
  
  if (!supabase || !stripe) return;
  
  const subscriptionId = invoice.subscription;
  if (!subscriptionId) return;
  
  try {
    const { data: users } = await supabase
      .from('users')
      .select('id, email')
      .eq('stripe_subscription_id', subscriptionId)
      .limit(1);
    
    if (users && users.length > 0) {
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
  
  if (!supabase) return;
  
  const customerId = invoice.customer;
  
  try {
    const { data: users } = await supabase
      .from('users')
      .select('id, email')
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

// Terminal payment webhook handlers
async function handleTerminalPaymentSucceeded(paymentIntent) {
  console.log('✅ Terminal payment succeeded:', paymentIntent.id);
  
  if (!supabase) return;

  try {
    const invoiceId = paymentIntent.metadata?.invoice_id;
    
    if (!invoiceId) {
      console.warn('⚠️ No invoice_id in payment intent metadata');
      return;
    }

    // Get card details
    const charge = paymentIntent.charges?.data[0];
    const cardBrand = charge?.payment_method_details?.card_present?.brand;
    const cardLast4 = charge?.payment_method_details?.card_present?.last4;

    // Update transaction
    await supabase
      .from('terminal_transactions')
      .update({
        status: 'succeeded',
        card_brand: cardBrand,
        card_last4: cardLast4,
        updated_at: new Date().toISOString()
      })
      .eq('payment_intent_id', paymentIntent.id);

    // Update invoice to PAID
    await supabase
      .from('invoices')
      .update({
        status: 'paid',
        paid_at: new Date().toISOString(),
        payment_method: 'terminal',
        payment_intent_id: paymentIntent.id
      })
      .eq('id', invoiceId);

    console.log('✅ Invoice marked as paid:', invoiceId);
  } catch (error) {
    console.error('❌ Error in handleTerminalPaymentSucceeded:', error);
  }
}

async function handleTerminalPaymentFailed(paymentIntent) {
  console.log('❌ Terminal payment failed:', paymentIntent.id);
  
  if (!supabase) return;

  try {
    await supabase
      .from('terminal_transactions')
      .update({
        status: 'failed',
        updated_at: new Date().toISOString()
      })
      .eq('payment_intent_id', paymentIntent.id);

    console.log('✅ Transaction marked as failed');
  } catch (error) {
    console.error('❌ Error in handleTerminalPaymentFailed:', error);
  }
}

async function handleTerminalPaymentCanceled(paymentIntent) {
  console.log('❌ Terminal payment canceled:', paymentIntent.id);
  
  if (!supabase) return;

  try {
    await supabase
      .from('terminal_transactions')
      .update({
        status: 'canceled',
        updated_at: new Date().toISOString()
      })
      .eq('payment_intent_id', paymentIntent.id);

    console.log('✅ Transaction marked as canceled');
  } catch (error) {
    console.error('❌ Error in handleTerminalPaymentCanceled:', error);
  }
}

// ===========================
// Twilio Messaging Routes
// ===========================

try {
  const messagingAPI = require('./helpers/messaging-api-cjs.js');
  
  console.log('✅ Messaging API loaded successfully');

  app.post('/api/messaging/provision', messagingAPI.provisionNumber);
  app.post('/api/messaging/send', messagingAPI.sendMessage);
  app.post('/api/messaging/webhook', messagingAPI.receiveWebhook);
  app.post('/api/messaging/status', messagingAPI.receiveStatusCallback);
  app.get('/api/messaging/threads/:shopId', messagingAPI.getThreads);
  app.get('/api/messaging/messages/:threadId', messagingAPI.getMessages);
  app.delete('/api/messaging/numbers/:numberId', messagingAPI.releaseNumber);
  
  console.log('✅ All messaging routes registered');
} catch (error) {
  console.error('❌ Failed to load messaging API:', error);
}

const PORT = process.env.PORT || process.env.STRIPE_PORT || 3001;

if (process.env.VERCEL !== '1') {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Stripe server with Terminal support running on port ${PORT}`);
    console.log(`🔗 Health check: http://localhost:${PORT}/health`);
  });
}

module.exports = app;
