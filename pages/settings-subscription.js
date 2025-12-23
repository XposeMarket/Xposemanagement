/**
 * Subscription banner functionality for settings page
 */

import { getSupabaseClient } from '../helpers/supabase.js';

async function loadSubscriptionBanner() {
  console.log('💳 Loading subscription info...');
  
  const supabase = getSupabaseClient();
  
  if (!supabase) {
    console.log('⚠️ Supabase not available, hiding subscription banner');
    return;
  }
  
  try {
    // Get current user's auth session
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    
    if (authError || !user) {
      console.log('⚠️ No authenticated user found');
      return;
    }
    
    // Fetch user's subscription data
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('subscription_status, subscription_plan, trial_end, subscription_end, stripe_subscription_id')
      .eq('id', user.id)
      .single();
    
    if (userError || !userData) {
      console.log('⚠️ No subscription data found');
      return;
    }
    
    console.log('✅ Raw subscription data:', userData);
    
    // Only show banner if user has a subscription
    if (userData.subscription_status && userData.subscription_status !== 'none') {
      const banner = document.getElementById('subscriptionBanner');
      const planName = document.getElementById('subPlanName');
      const statusText = document.getElementById('subStatusText');
      const billingDate = document.getElementById('billingDate');
      const billingLabel = document.querySelector('#subscriptionBanner div:last-child p:first-child');
      
      if (!banner) return;
      
      // Set plan name with friendly label - handle Stripe price IDs
      if (planName) {
        let planLabel = 'Premium';
        const planKey = (userData.subscription_plan || '').toLowerCase();
        
        // Map Stripe price IDs to friendly names (add your actual Stripe price IDs here)
        if (planKey.includes('single') || planKey.includes('price_') || planKey === 'unknown' || !planKey) {
          planLabel = 'Single Shop';
        } else if (planKey.includes('local')) {
          planLabel = 'Local Shop';
        } else if (planKey.includes('multi')) {
          planLabel = 'Multi Shop';
        } else {
          planLabel = planKey.charAt(0).toUpperCase() + planKey.slice(1);
        }
        
        planName.textContent = `${planLabel} Plan`;
      }
      
      const now = new Date();
      const trialEndDate = userData.trial_end ? new Date(userData.trial_end) : null;
      const subEndDate = userData.subscription_end ? new Date(userData.subscription_end) : null;
      
      // Fix trial calculation - check if trial is actually over
      let actualStatus = userData.subscription_status;
      if (actualStatus === 'trialing' && trialEndDate && now > trialEndDate) {
        // Trial has ended, treat as active
        actualStatus = 'active';
        console.log('⚠️ Trial ended but status still shows "trialing" - treating as active');
      }
      
      // Calculate days left in trial or show active status
      if (actualStatus === 'trialing' && trialEndDate) {
        const daysLeft = Math.ceil((trialEndDate - now) / (1000 * 60 * 60 * 24));
        
        if (daysLeft > 0) {
          // Still in trial period
          if (statusText) {
            statusText.innerHTML = `Trial ends in <strong>${daysLeft} day${daysLeft !== 1 ? 's' : ''}</strong>`;
          }
          if (billingDate) {
            billingDate.textContent = trialEndDate.toLocaleDateString('en-US', { 
              year: 'numeric', 
              month: 'long', 
              day: 'numeric' 
            });
          }
          if (billingLabel) billingLabel.textContent = 'First billing date';
        } else {
          // Trial ended - show active status
          if (statusText) {
            statusText.innerHTML = '<strong style="color: #10b981;">✅ Active Subscription</strong>';
          }
          // Use subscription_end for next billing (or trial_end + 30 days as fallback)
          if (subEndDate && billingDate) {
            billingDate.textContent = subEndDate.toLocaleDateString('en-US', { 
              year: 'numeric', 
              month: 'long', 
              day: 'numeric' 
            });
          } else if (trialEndDate && billingDate) {
            // Fallback: assume monthly billing starts after trial
            const nextBilling = new Date(trialEndDate);
            nextBilling.setDate(nextBilling.getDate() + 30);
            billingDate.textContent = nextBilling.toLocaleDateString('en-US', { 
              year: 'numeric', 
              month: 'long', 
              day: 'numeric' 
            });
          }
          if (billingLabel) billingLabel.textContent = 'Next billing date';
        }
      } else if (actualStatus === 'active') {
        // Active subscription
        if (statusText) {
          statusText.innerHTML = '<strong style="color: #10b981;">✅ Active Subscription</strong>';
        }
        if (subEndDate && billingDate) {
          billingDate.textContent = subEndDate.toLocaleDateString('en-US', { 
            year: 'numeric', 
            month: 'long', 
            day: 'numeric' 
          });
        } else if (trialEndDate && billingDate) {
          // Fallback calculation
          const nextBilling = new Date(trialEndDate);
          nextBilling.setDate(nextBilling.getDate() + 30);
          billingDate.textContent = nextBilling.toLocaleDateString('en-US', { 
            year: 'numeric', 
            month: 'long', 
            day: 'numeric' 
          });
        }
        if (billingLabel) billingLabel.textContent = 'Next billing date';
      } else if (actualStatus === 'canceled') {
        // Canceled subscription
        if (statusText) {
          statusText.innerHTML = '<strong style="color: #ef4444;">❌ Subscription Canceled</strong>';
        }
        if (subEndDate && billingDate) {
          billingDate.textContent = subEndDate.toLocaleDateString('en-US', { 
            year: 'numeric', 
            month: 'long', 
            day: 'numeric' 
          });
        }
        if (billingLabel) billingLabel.textContent = 'Access until';
      } else if (actualStatus === 'past_due') {
        // Payment failed
        if (statusText) {
          statusText.innerHTML = '<strong style="color: #f59e0b;">⚠️ Payment Failed</strong>';
        }
        if (billingLabel) billingLabel.textContent = 'Action required';
      }
      
      banner.style.display = 'block';
      console.log('✅ Subscription banner displayed with status:', actualStatus);
    }
  } catch (error) {
    console.error('❌ Error loading subscription:', error);
  }
}
// Initialize terminal settings region on the settings page.
// If a page-level script exposes `initTerminalRegistration`, prefer that.
async function initTerminalSettings() {
  if (typeof window === 'undefined') return;
  const el = document.getElementById('terminal-settings-section');
  if (!el) return;
  el.innerHTML = '<div class="muted">Loading terminal settings...</div>';
  if (window && typeof window.initTerminalRegistration === 'function') {
    try {
      await window.initTerminalRegistration(el);
      return;
    } catch (e) {
      console.warn('terminal registration init failed', e);
    }
  }
  // Fallback content
  el.innerHTML = '<div class="notice">Terminal settings are not available. Ensure /js/terminal-registration.js is present.</div>';
}

export { loadSubscriptionBanner, initTerminalSettings };
