/**
 * helpers/subscription-check.js
 * Check if user has valid subscription before allowing access
 */

import { getSupabaseClient } from './supabase.js';

/**
 * Check if current user has active subscription
 * Redirects to paywall if subscription is invalid
 */
async function checkSubscriptionAccess() {
  const supabase = getSupabaseClient();
  
  if (!supabase) {
    console.warn('⚠️ Supabase not available, skipping subscription check');
    return true; // Allow access if Supabase not configured
  }
  
  try {
    // Get current user
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    
    if (authError || !user) {
      console.log('ℹ️ No authenticated user');
      return true; // Let auth system handle this
    }
    
    // Get user's subscription status
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('subscription_status, subscription_end')
      .eq('id', user.id)
      .single();
    
    if (userError || !userData) {
      console.warn('⚠️ Could not load subscription data');
      return true; // Allow access if we can't check
    }
    
    const { subscription_status, subscription_end } = userData;
    
    // Valid statuses that allow access
    const validStatuses = ['trialing', 'active'];
    
    // Check if subscription is valid
    if (!validStatuses.includes(subscription_status)) {
      // Check if canceled but still within access period
      if (subscription_status === 'canceled' && subscription_end) {
        const endDate = new Date(subscription_end);
        const now = new Date();
        
        if (now < endDate) {
          console.log('✅ Canceled subscription but access still valid until', endDate);
          return true;
        }
      }
      
      console.log('❌ Invalid subscription status:', subscription_status);
      
      // Show styled modal instead of alert
      const modal = document.createElement('div');
      modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0,0,0,0.5);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 10000;
      `;
      
      const modalContent = document.createElement('div');
      modalContent.style.cssText = `
        background: white;
        border-radius: 12px;
        padding: 32px;
        max-width: 400px;
        text-align: center;
        box-shadow: 0 8px 24px rgba(0,0,0,0.2);
      `;
      
      modalContent.innerHTML = `
        <div style="font-size: 48px; margin-bottom: 16px;">🔒</div>
        <h2 style="font-size: 1.5rem; font-weight: 700; margin-bottom: 12px; color: #222;">Subscription Required</h2>
        <p style="color: #666; margin-bottom: 24px;">Your subscription is not active. Please subscribe to continue using Xpose Management.</p>
        <button onclick="window.location.href='paywall.html'" style="
          background: #2a7cff;
          color: white;
          border: none;
          border-radius: 8px;
          padding: 12px 32px;
          font-size: 1rem;
          font-weight: 600;
          cursor: pointer;
          box-shadow: 0 2px 8px rgba(42,124,255,0.3);
        ">View Plans</button>
      `;
      
      modal.appendChild(modalContent);
      document.body.appendChild(modal);
      
      return false;
    }
    
    console.log('✅ Valid subscription:', subscription_status);
    return true;
    
  } catch (error) {
    console.error('❌ Error checking subscription:', error);
    return true; // Allow access on error to avoid breaking the app
  }
}

export { checkSubscriptionAccess };
