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
console.log('🔑 Stripe Secret Key present=', !!process.env.STRIPE_SECRET_KEY);

if (!process.env.STRIPE_SECRET_KEY) {
  console.error('❌ ERROR: STRIPE_SECRET_KEY not found in .env file!');
  console.error('Make sure .env file exists and contains STRIPE_SECRET_KEY');
  process.exit(1);
}

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

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
        console.log('CORS allowed: exact match');
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
              console.log('CORS allowed: hostname match');
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

      console.log('CORS allowed: default allow');
      return callback(null, true);
    } catch (err) {
      console.error('CORS check failed:', err);
      return callback(new Error('CORS check failed'), false);
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

// Serve static files
app.use(express.static('.'));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    stripe: 'connected' 
  });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({ 
    message: 'Xpose Management Stripe Server',
    version: '1.0.0',
    endpoints: ['/create-checkout-session', '/get-session-subscription', '/health']
});

// Create checkout session
app.post('/create-checkout-session', async (req, res) => {
  try {
    const { priceId, customerEmail } = req.body;

    console.log('📝 Checkout request received:', { priceId, hasCustomerEmail: !!customerEmail });
    console.log('🔎 Request origin/header:', { origin: req.headers.origin, host: req.headers.host });

    if (!priceId) {
      return res.status(400).json({ error: 'Price ID is required' });
    }

    // Determine origin: prefer request Origin header, then normalized FRONTEND_URL env, then a sensible default
    const envFrontend = normalizeOrigin(process.env.FRONTEND_URL);
    const origin = req.headers.origin || envFrontend || 'https://xpose-stripe-server.vercel.app';
    console.log('🔄 Creating Stripe checkout session... using origin:', origin, ' (raw req.headers.origin=', req.headers.origin, ', envFrontend=', envFrontend, ')');

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      customer_email: customerEmail || undefined,
      // Set explicit locale to avoid language file errors
      // 14-day trial
      subscription_data: {
        trial_period_days: 14,
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
    });

    res.json({ url: session.url });
    console.log('✅ Checkout session created successfully:', session.id, 'url:', session.url);
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

// Webhook endpoint for Stripe events
// IMPORTANT: This needs raw body for signature verification
app.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret) {
    console.warn('⚠️ STRIPE_WEBHOOK_SECRET not set - webhooks will not be verified!');
    return res.status(500).json({ error: 'Webhook secret not configured' });
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
async function handleSubscriptionUpdate(subscription) {
  console.log('🔄 Handling subscription update:', subscription.id);
  
  const customerId = subscription.customer;
  const status = subscription.status;
  const priceId = subscription.items.data[0].price.id;
  
  // Map price ID to plan name
  const PRICE_TO_PLAN = {
    'price_1SX97Z4K55W1qqBCSwzYlDd6': 'Single Shop',
    'price_1SX97b4K55W1qqBC7o7fJYUi': 'Local Shop',
    'price_1SX97d4K55W1qqBCcNM0eP00': 'Multi Shop',
    // Add any additional live price IDs here as needed
  };
  const planName = PRICE_TO_PLAN[priceId] || subscription.items.data[0].price.nickname || 'Unknown';
  
  // Update Supabase
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ADMIN_KEY;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ADMIN_KEY;
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
    
    // Update user subscription info
    const { error: updateError } = await supabase
      .from('users')
      .update({
        stripe_subscription_id: subscription.id,
        subscription_status: status,
        subscription_plan: planName,
        trial_end: subscription.trial_end ? new Date(subscription.trial_end * 1000).toISOString() : null,
        subscription_end: subscription.current_period_end ? new Date(subscription.current_period_end * 1000).toISOString() : null,
        updated_at: new Date().toISOString()
      })
      .eq('id', user.id);
    
    if (updateError) {
      console.error('❌ Error updating user:', updateError);
    } else {
      console.log('✅ User subscription updated:', user.email, '|', status, '|', planName);
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
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ADMIN_KEY;
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
  // Payment went through - subscription should already be active from subscription.updated event
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

// Debug endpoint to check if server is responding
app.get('/api/messaging/test', (req, res) => {
  res.json({ 
    status: 'ok', 
    message: 'Messaging API endpoint is reachable',
    timestamp: new Date().toISOString()
  });
});

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
  console.error('Error stack:', error.stack);
  console.error('Messaging routes will not be available');
  
  // Add fallback error routes so we can see what's happening
  app.post('/api/messaging/send', (req, res) => {
    res.status(500).json({ 
      error: 'Messaging API failed to load', 
      message: error.message,
      stack: error.stack 
    });
  });
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
