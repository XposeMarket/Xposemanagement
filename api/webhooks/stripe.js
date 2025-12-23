require('dotenv').config();

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

module.exports = async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Handle payment_intent.succeeded
  if (event.type === 'payment_intent.succeeded') {
    const paymentIntent = event.data.object;
    const invoiceId = paymentIntent.metadata?.invoiceId;

    if (invoiceId) {
      console.log(`✅ Payment succeeded for invoice: ${invoiceId}`);

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
        console.error('Failed to update invoice:', error);
        return res.status(500).json({ error: 'Failed to update invoice' });
      }

      console.log(`✅ Invoice ${invoiceId} marked as paid`);
    }
  }

  res.json({ received: true });
};
