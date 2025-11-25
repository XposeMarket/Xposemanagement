/*
 Backfill script: populate users.subscription_plan from Stripe (if possible)
 and populate shops.owner_id where missing by looking at admin users.

 Usage:
  node scripts/backfill-owner-plan.js

 Requires env vars:
  - SUPABASE_URL
  - SUPABASE_SERVICE_ROLE_KEY
  - STRIPE_SECRET_KEY (optional, improves plan accuracy)
*/

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const Stripe = require('stripe');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const STRIPE_KEY = process.env.STRIPE_SECRET_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const stripe = STRIPE_KEY ? Stripe(STRIPE_KEY) : null;

// Map price IDs to normalized plans (keep in sync with stripe-server.js)
const PRICE_TO_PLAN = {
  'price_1SX97Z4K55W1qqBCSwzYlDd6': 'single',
  'price_1SX97b4K55W1qqBC7o7fJYUi': 'local',
  'price_1SX97d4K55W1qqBCcNM0eP00': 'multi'
};

(async function main(){
  try {
    console.log('Fetching users missing subscription_plan or with unknown...');
    const { data: users, error } = await supabase
      .from('users')
      .select('id, stripe_customer_id, stripe_subscription_id, subscription_plan')
      .or('subscription_plan.is.null,subscription_plan.eq.unknown');

    if (error) throw error;
    console.log('Users found:', users.length);

    for (const u of users) {
      let plan = 'unknown';
      // Prefer using stripe_subscription_id if present
      const subId = u.stripe_subscription_id;
      const custId = u.stripe_customer_id;
      if (subId && stripe) {
        try {
          const sub = await stripe.subscriptions.retrieve(subId);
          const priceId = sub.items.data[0].price.id;
          plan = PRICE_TO_PLAN[priceId] || (sub.items.data[0].price.nickname || 'unknown');
          if (typeof plan === 'string') {
            const pn = plan.toString().toLowerCase();
            if (pn.includes('single')) plan = 'single';
            else if (pn.includes('local')) plan = 'local';
            else if (pn.includes('multi')) plan = 'multi';
            else plan = pn.replace(/\s+/g, '_');
          }
        } catch (e) {
          console.warn('Stripe lookup failed for subscription', subId, e.message || e);
        }
      } else if (custId && stripe) {
        try {
          const subs = await stripe.subscriptions.list({ customer: custId, limit: 1 });
          if (subs && subs.data && subs.data.length) {
            const priceId = subs.data[0].items.data[0].price.id;
            plan = PRICE_TO_PLAN[priceId] || (subs.data[0].items.data[0].price.nickname || 'unknown');
            if (typeof plan === 'string') {
              const pn = plan.toString().toLowerCase();
              if (pn.includes('single')) plan = 'single';
              else if (pn.includes('local')) plan = 'local';
              else if (pn.includes('multi')) plan = 'multi';
              else plan = pn.replace(/\s+/g, '_');
            }
          }
        } catch (e) {
          console.warn('Stripe lookup failed for customer', custId, e.message || e);
        }
      }

      const { error: updateErr } = await supabase
        .from('users')
        .update({ subscription_plan: plan })
        .eq('id', u.id);
      if (updateErr) console.error('Failed to update user', u.id, updateErr);
      else console.log('Updated user', u.id, '=>', plan);
    }

    // Backfill shops.owner_id where missing by finding an admin user with shop_id
    console.log('\nBackfilling shops without owner_id...');
    const { data: shops, error: shopsErr } = await supabase
      .from('shops')
      .select('id')
      .is('owner_id', null);
    if (shopsErr) throw shopsErr;
    console.log('Shops without owner_id:', shops.length);

    for (const s of shops) {
      // Try to find a user with shop_id and role admin
      const { data: usersForShop, error: uErr } = await supabase
        .from('users')
        .select('id, role')
        .eq('shop_id', s.id)
        .eq('role', 'admin')
        .limit(1);
      if (uErr) { console.warn('Error finding admin for shop', s.id, uErr); continue; }
      if (usersForShop && usersForShop.length) {
        const ownerId = usersForShop[0].id;
        const { error: up } = await supabase
          .from('shops')
          .update({ owner_id: ownerId })
          .eq('id', s.id);
        if (up) console.warn('Failed to set owner for shop', s.id, up);
        else console.log('Set owner for shop', s.id, '=>', ownerId);
      } else {
        console.log('No admin user found for shop', s.id, '- skipping');
      }
    }

    console.log('\nBackfill complete');
  } catch (err) {
    console.error('Backfill failed:', err);
    process.exit(1);
  }
})();
