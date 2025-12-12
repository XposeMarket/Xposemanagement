/**
 * One-time fix script for subscription status
 * 
 * This script will:
 * 1. Find your user in Supabase
 * 2. Check Stripe for the real subscription status
 * 3. Update Supabase with correct values
 * 
 * Run with: node fix-subscription-status.js
 */

require('dotenv').config();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
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
        
        // Determine correct status
        const now = new Date();
        const trialEnd = subscription.trial_end ? new Date(subscription.trial_end * 1000) : null;
        let actualStatus = subscription.status;
        
        // If status is "trialing" but trial has ended, mark as active
        if (actualStatus === 'trialing' && trialEnd && now > trialEnd) {
          actualStatus = 'active';
          console.log(`   ⚠️ Trial ended but status still "trialing" - correcting to "active"`);
        }
        
        // Update Supabase
        const { error: updateError } = await supabase
          .from('users')
          .update({
            subscription_status: actualStatus,
            subscription_plan: planName,
            trial_end: subscription.trial_end ? new Date(subscription.trial_end * 1000).toISOString() : null,
            subscription_end: new Date(subscription.current_period_end * 1000).toISOString(),
            updated_at: new Date().toISOString()
          })
          .eq('id', user.id);
        
        if (updateError) {
          console.error(`   ❌ Failed to update user:`, updateError);
        } else {
          console.log(`   ✅ Successfully updated to:`);
          console.log(`      Status: ${actualStatus}`);
          console.log(`      Plan: ${planName}`);
          console.log(`      Next billing: ${new Date(subscription.current_period_end * 1000).toISOString()}`);
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
