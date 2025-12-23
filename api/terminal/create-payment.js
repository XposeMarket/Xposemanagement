/**
 * Create Terminal Payment Endpoint
 * POST /api/terminal/create-payment
 * 
 * Creates a PaymentIntent and processes it on the shop's terminal
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
    console.log('✅ [Terminal Payment] Supabase client initialized');
  } catch (err) {
    console.error('❌ [Terminal Payment] Failed to initialize Supabase:', err.message);
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
    const { invoiceId, shopId } = req.body;
    
    if (!invoiceId || !shopId) {
      return res.status(400).json({ 
        error: 'Invoice ID and Shop ID required' 
      });
    }

    if (!supabase) {
      console.error('❌ [Terminal Payment] Supabase client not initialized');
      return res.status(500).json({ error: 'Database connection not available' });
    }

    console.log(`💳 [Terminal Payment] Creating payment for invoice ${invoiceId}, shop ${shopId}`);

    // 1. Fetch invoice from database
    const { data: invoice, error: invoiceError } = await supabase
      .from('invoices')
      .select('*')
      .eq('id', invoiceId)
      .eq('shop_id', shopId)
      .single();

    if (invoiceError || !invoice) {
      console.error('❌ [Terminal Payment] Invoice not found:', invoiceError);
      return res.status(404).json({ error: 'Invoice not found' });
    }

    console.log(`📄 [Terminal Payment] Found invoice #${invoice.number}`);

    // 2. Calculate total amount
    const items = invoice.items || [];
    const subtotal = items.reduce((sum, item) => 
      sum + ((item.qty || 0) * (item.price || 0)), 0
    );
    const tax = subtotal * ((invoice.tax_rate || 0) / 100);
    const discount = subtotal * ((invoice.discount || 0) / 100);
    const total = subtotal + tax - discount;
    const amountCents = Math.round(total * 100);

    if (amountCents <= 0) {
      console.error('❌ [Terminal Payment] Invalid invoice amount:', amountCents);
      return res.status(400).json({ error: 'Invalid invoice amount' });
    }

    console.log(`💰 [Terminal Payment] Amount: $${(amountCents / 100).toFixed(2)} (${amountCents} cents)`);

    // 3. Get shop's terminal info
    const { data: shop, error: shopError } = await supabase
      .from('shops')
      .select('terminal_id, terminal_status, stripe_connected_account_id, name')
      .eq('id', shopId)
      .single();

    if (shopError || !shop) {
      console.error('❌ [Terminal Payment] Shop not found:', shopError);
      return res.status(404).json({ error: 'Shop not found' });
    }

    if (!shop.terminal_id) {
      console.error('❌ [Terminal Payment] No terminal registered for shop');
      return res.status(400).json({ 
        error: 'No terminal registered for this shop. Please register a terminal in Settings.' 
      });
    }

    console.log(`🖥️ [Terminal Payment] Using terminal: ${shop.terminal_id}`);

    // 4. Calculate platform fee (5% + $0.05)
    const platformFeePercent = 0.05; // 5%
    const platformFeeCents = Math.round(amountCents * platformFeePercent) + 5; // +$0.05

    console.log(`💸 [Terminal Payment] Platform fee: $${(platformFeeCents / 100).toFixed(2)}`);

    // TEST MODE: Skip Stripe, simulate success
    const TEST_MODE = process.env.TEST_MODE === 'true' || req.query.test === 'true';
    
    if (TEST_MODE) {
      console.log('🧪 [Terminal Payment] TEST MODE: Simulating payment');

      // Simulate 2-second processing delay
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Mark invoice as paid directly
      const { error: updateError } = await supabase
        .from('invoices')
        .update({ 
          status: 'paid',
          paid_date: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('id', invoiceId);

      if (updateError) {
        console.error('❌ [Terminal Payment] Failed to update invoice:', updateError);
        throw updateError;
      }

      console.log(`✅ [Terminal Payment] Invoice marked as paid (TEST MODE)`);

      return res.json({ 
        success: true, 
        paymentIntent: `pi_test_mock_${Date.now()}`,
        amount: amountCents,
        test_mode: true,
        message: 'Payment simulated successfully'
      });
    }

    // PRODUCTION MODE: Real Stripe payment
    if (!stripe) {
      console.error('❌ [Terminal Payment] Stripe not initialized');
      return res.status(500).json({ error: 'Stripe not configured' });
    }

    // 5. Create PaymentIntent
    const paymentIntentParams = {
      amount: amountCents,
      currency: 'usd',
      payment_method_types: ['card_present'],
      capture_method: 'automatic',
      metadata: {
        invoiceId: invoice.id,
        shopId: shopId,
        invoice_number: invoice.number || invoice.id,
        shop_name: shop.name || 'Unknown Shop'
      }
    };

    // If shop has Connect account, use destination charge with platform fee
    if (shop.stripe_connected_account_id) {
      console.log(`🔗 [Terminal Payment] Using Connect account: ${shop.stripe_connected_account_id}`);
      paymentIntentParams.application_fee_amount = platformFeeCents;
      paymentIntentParams.transfer_data = {
        destination: shop.stripe_connected_account_id
      };
    } else {
      console.log('⚠️ [Terminal Payment] No Connect account - direct charge only');
    }

    console.log('🔄 [Terminal Payment] Creating PaymentIntent...');
    const paymentIntent = await stripe.paymentIntents.create(paymentIntentParams);

    console.log(`✅ [Terminal Payment] PaymentIntent created: ${paymentIntent.id}`);

    // 6. Process payment on terminal
    try {
      console.log(`📡 [Terminal Payment] Sending to terminal ${shop.terminal_id}...`);
      
      const processResult = await stripe.terminal.readers.processPaymentIntent(
        shop.terminal_id,
        { payment_intent: paymentIntent.id }
      );

      console.log(`✅ [Terminal Payment] Payment sent to terminal successfully`);

      // Note: The actual payment completion will be handled by webhooks
      // The frontend will poll the database for invoice status change

      return res.json({ 
        success: true, 
        paymentIntent: paymentIntent.id,
        amount: amountCents,
        terminal_id: shop.terminal_id,
        message: 'Payment sent to terminal. Waiting for customer to complete payment.'
      });
    } catch (terminalError) {
      console.error('❌ [Terminal Payment] Terminal processing error:', terminalError);
      
      // Cancel the PaymentIntent if terminal processing fails
      try {
        await stripe.paymentIntents.cancel(paymentIntent.id);
        console.log(`🔄 [Terminal Payment] PaymentIntent cancelled`);
      } catch (cancelError) {
        console.error('❌ [Terminal Payment] Failed to cancel PaymentIntent:', cancelError);
      }
      
      return res.status(500).json({ 
        error: terminalError.message || 'Terminal processing failed',
        details: terminalError.raw ? terminalError.raw.message : null
      });
    }
  } catch (error) {
    console.error('❌ [Terminal Payment] Unexpected error:', error);
    return res.status(500).json({ 
      error: error.message || 'Failed to create terminal payment' 
    });
  }
};
