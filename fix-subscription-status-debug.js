/**
 * One-time fix script for subscription status - DEBUG VERSION
 * 
 * Run with: node fix-subscription-status-debug.js
 */

require('dotenv').config();

// Debug: Show what environment variables are loaded
console.log('🔍 Checking environment variables...\n');
console.log('STRIPE_SECRET_KEY:', process.env.STRIPE_SECRET_KEY ? `✅ Found (${process.env.STRIPE_SECRET_KEY.substring(0, 10)}...)` : '❌ Missing');
console.log('SUPABASE_URL:', process.env.SUPABASE_URL ? `✅ Found` : '❌ Missing');
console.log('SUPABASE_SERVICE_KEY:', process.env.SUPABASE_SERVICE_KEY ? `✅ Found` : '❌ Missing');
console.log('SUPABASE_SERVICE_ROLE_KEY:', process.env.SUPABASE_SERVICE_ROLE_KEY ? `✅ Found` : '❌ Missing');
console.log('');

if (!process.env.STRIPE_SECRET_KEY) {
  console.error('❌ STRIPE_SECRET_KEY is not set in .env file!');
  console.log('\nPlease add to your .env file:');
  console.log('STRIPE_SECRET_KEY=sk_test_...(your stripe secret key)');
  process.exit(1);
}

if (!process.env.SUPABASE_URL) {
  console.error('❌ SUPABASE_URL is not set in .env file!');
  console.log('\nPlease add to your .env file:');
  console.log('SUPABASE_URL=https://hxwufjzyhtwveyxbkkya.supabase.co');
  process.exit(1);
}

const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ADMIN_KEY;
if (!supabaseKey) {
  console.error('❌ No Supabase service key found!');
  console.log('\nPlease add ONE of these to your .env file:');
  console.log('SUPABASE_SERVICE_KEY=eyJ...(your service role key)');
  console.log('or');
  console.log('SUPABASE_SERVICE_ROLE_KEY=eyJ...(your service role key)');
  process.exit(1);
}

console.log('✅ All required environment variables are set!\n');

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  supabaseKey
);

async function fixSubscriptionStatus() {
  console.log('🔧 Starting subscription status fix...\n');
  
  try {
    // Get all users with subscriptions
    const { data: users, error: usersError } = await supabase
      .from('users')
      .select('*')
      .not('stripe_subscription_id', 'is', null);
    
    if (usersError) {
      console.error('❌ Error fetching users:', usersError);
      return;
    }
    
    console.log(`📋 Found ${users.length} users with subscriptions\n`);
    
    for (const user of users) {
      console.log(`\n👤 Checking user: ${user.email}`);
      console.log(`   Current status in DB: ${user.subscription_status}`);
      console.log(`   Current plan in DB: ${user.subscription_plan}`);
      console.log(`   Trial end in DB: ${user.trial_end}`);
      console.log(`   Next billing in DB: ${user.next_billing_date}`);
      
      if (!user.stripe_subscription_id) {
        console.log('   ⚠️ No Stripe subscription ID - skipping');
        continue;
      }
      
      try {
        // Fetch real data from Stripe
        const subscription = await stripe.subscriptions.retrieve(user.stripe_subscription_id);
        
        console.log(`   ✅ Stripe subscription found:`);
        console.log(`      Status: ${subscription.status}`);
        console.log(`      Trial end: ${subscription.trial_end ? new Date(subscription.trial_end * 1000).toISOString() : 'none'}`);
        console.log(`      Current period end: ${new Date(subscription.current_period_end * 1000).toISOString()}`);
        
        const priceId = subscription.items.data[0].price.id;
        const priceNickname = subscription.items.data[0].price.nickname;
        
        console.log(`      Price ID: ${priceId}`);
        console.log(`      Price nickname: ${priceNickname}`);
        
        // Map price to plan name
        const PRICE_TO_PLAN = {
          'price_1SX97Z4K55W1qqBCSwzYlDd6': 'Single Shop',
          'price_1SX97b4K55W1qqBC7o7fJYUi': 'Local Shop',
          'price_1SX97d4K55W1qqBCcNM0eP00': 'Multi Shop',
        };
        
        let planName = PRICE_TO_PLAN[priceId];
        if (!planName) {
          const lower = (priceNickname || '').toLowerCase();
          if (lower.includes('single')) planName = 'Single Shop';
          else if (lower.includes('local')) planName = 'Local Shop';
          else if (lower.includes('multi')) planName = 'Multi Shop';
          else planName = priceNickname || 'Single Shop';
        }
        
        // Use Stripe's actual status - don't override it
        const actualStatus = subscription.status;
        
        // Update Supabase
        const { error: updateError } = await supabase
          .from('users')
          .update({
            subscription_status: actualStatus,
            subscription_plan: planName,
            trial_end: subscription.trial_end ? new Date(subscription.trial_end * 1000).toISOString() : null,
            next_billing_date: new Date(subscription.current_period_end * 1000).toISOString(),
            subscription_end: subscription.cancel_at ? new Date(subscription.cancel_at * 1000).toISOString() : null
          })
          .eq('id', user.id);
        
        if (updateError) {
          console.error(`   ❌ Failed to update user:`, updateError);
        } else {
          console.log(`   ✅ Successfully updated to:`);
          console.log(`      Status: ${actualStatus}`);
          console.log(`      Plan: ${planName}`);
          console.log(`      Next billing: ${new Date(subscription.current_period_end * 1000).toISOString()}`);
          console.log(`      Subscription ends: ${subscription.cancel_at ? new Date(subscription.cancel_at * 1000).toISOString() : 'N/A (ongoing)'}`);
        }
        
      } catch (stripeError) {
        console.error(`   ❌ Error fetching Stripe subscription:`, stripeError.message);
      }
    }
    
    console.log('\n\n✅ Subscription status fix complete!');
    
  } catch (error) {
    console.error('❌ Fatal error:', error);
  }
}

// Run the fix
fixSubscriptionStatus().then(() => {
  console.log('\n🎉 Done! Check your settings page to verify the changes.');
  process.exit(0);
}).catch(err => {
  console.error('❌ Script failed:', err);
  process.exit(1);
});
