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
console.log('🔑 Stripe Secret Key loaded:', process.env.STRIPE_SECRET_KEY ? 'YES (length: ' + process.env.STRIPE_SECRET_KEY.length + ')' : 'NO - CHECK .env FILE');

if (!process.env.STRIPE_SECRET_KEY) {
  console.error('❌ ERROR: STRIPE_SECRET_KEY not found in .env file!');
  console.error('Make sure .env file exists and contains STRIPE_SECRET_KEY');
  process.exit(1);
}

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const app = express();

// Configure CORS - allow your frontend domain
const allowedOrigins = [
  'http://localhost:5500',
  'http://127.0.0.1:5500',
  process.env.FRONTEND_URL // Your production domain will go here
].filter(Boolean);

app.use(cors({
  origin: function(origin, callback) {
    // Allow requests with no origin (like mobile apps or curl)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.indexOf(origin) === -1 && process.env.FRONTEND_URL) {
      return callback(new Error('CORS not allowed'), false);
    }
    return callback(null, true);
  },
  credentials: true
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
});

// Create checkout session
app.post('/create-checkout-session', async (req, res) => {
  try {
    const { priceId, customerEmail } = req.body;

    console.log('📝 Checkout request received:', { priceId, customerEmail });

    if (!priceId) {
      return res.status(400).json({ error: 'Price ID is required' });
    }

    console.log('🔄 Creating Stripe checkout session...');

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
      locale: 'auto',
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
      success_url: `${req.headers.origin}/create-shop.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${req.headers.origin}/paywall.html`,
    });

    res.json({ url: session.url });
    console.log('✅ Checkout session created successfully:', session.id);
  } catch (error) {
    console.error('❌ Stripe error:', error.message);
    console.error('Full error:', error);
    res.status(500).json({ error: error.message });
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
    
    // Map price IDs to plan names (these are your actual price IDs)
    const PRICE_TO_PLAN = {
      'price_1STABgQMIc1SOVFzyfZLVotW': 'Single Shop',
      'price_1STACjQMIc1SOVFz1JmYq341': 'Multi Shop',
      'price_1STADSQMIc1SOVFz6egyM0cR': 'Advanced Shop'
    };
    
    planName = PRICE_TO_PLAN[priceId] || subscription.items.data[0].price.nickname || 'Unknown';

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
    'price_1STABgQMIc1SOVFzyfZLVotW': 'Single Shop',
    'price_1STACjQMIc1SOVFz1JmYq341': 'Multi Shop',
    'price_1STADSQMIc1SOVFz6egyM0cR': 'Advanced Shop'
  };
  
  const planName = PRICE_TO_PLAN[priceId] || 'Unknown';
  
  // Update Supabase
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
  
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
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
  
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
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
  
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
