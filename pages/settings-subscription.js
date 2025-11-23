/**
 * Subscription banner functionality for settings page
 */

import { getSupabaseClient } from '../helpers/supabase.js';

async function loadSubscriptionBanner() {
  console.log('💳 Loading subscription info...');
  
  const supabase = getSupabaseClient();
  
  if (!supabase) {
      // Supabase not available, hiding subscription banner
    return;
  }
  
  try {
    // Get current user's auth session
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    
    if (authError || !user) {
        // No authenticated user found
      return;
    }
    
    // Fetch user's subscription data
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('subscription_status, subscription_plan, trial_end, subscription_end')
      .eq('id', user.id)
      .single();
    
    if (userError || !userData) {
        // No subscription data found
      return;
    }
    
    console.log('✅ Subscription data loaded:', userData);
    
    // Only show banner if user has a subscription
    if (userData.subscription_status && userData.subscription_status !== 'none') {
      const banner = document.getElementById('subscriptionBanner');
      const planName = document.getElementById('subPlanName');
      const statusText = document.getElementById('subStatusText');
      const billingDate = document.getElementById('billingDate');
      const billingLabel = document.querySelector('#subscriptionBanner div:last-child p:first-child');
      
      if (!banner) return;
      
      // Set plan name
      if (planName) planName.textContent = `${userData.subscription_plan || 'Premium'} Plan`;
      
      // Calculate days left in trial or show active status
      if (userData.subscription_status === 'trialing' && userData.trial_end) {
        const trialEnd = new Date(userData.trial_end);
        const now = new Date();
        const daysLeft = Math.ceil((trialEnd - now) / (1000 * 60 * 60 * 24));
        
        if (statusText) {
          statusText.innerHTML = `Trial ends in <strong>${daysLeft} day${daysLeft !== 1 ? 's' : ''}</strong>`;
        }
        if (billingDate) {
          billingDate.textContent = trialEnd.toLocaleDateString('en-US', { 
            year: 'numeric', 
            month: 'long', 
            day: 'numeric' 
          });
        }
        if (billingLabel) billingLabel.textContent = 'First billing date';
        
      } else if (userData.subscription_status === 'active') {
        if (statusText) {
          statusText.innerHTML = '<strong style="color: #10b981;">✅ Active Subscription</strong>';
        }
        
        if (userData.subscription_end && billingDate) {
          const nextBilling = new Date(userData.subscription_end);
          billingDate.textContent = nextBilling.toLocaleDateString('en-US', { 
            year: 'numeric', 
            month: 'long', 
            day: 'numeric' 
          });
        }
        if (billingLabel) billingLabel.textContent = 'Next billing date';
        
      } else if (userData.subscription_status === 'canceled') {
        if (statusText) {
          statusText.innerHTML = '<strong style="color: #ef4444;">❌ Subscription Canceled</strong>';
        }
        if (userData.subscription_end && billingDate) {
          const endsOn = new Date(userData.subscription_end);
          billingDate.textContent = endsOn.toLocaleDateString('en-US', { 
            year: 'numeric', 
            month: 'long', 
            day: 'numeric' 
          });
        }
        if (billingLabel) billingLabel.textContent = 'Access until';
      }
      
      banner.style.display = 'block';
        // Subscription banner displayed
    }
  } catch (error) {
    console.error('❌ Error loading subscription:', error);
  }
}

export { loadSubscriptionBanner };
