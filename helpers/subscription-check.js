/**
 * helpers/subscription-check.js
 * Check if user has valid subscription before allowing access
 */

import { getSupabaseClient } from './supabase.js';

// Helper to show subscription modal
function showSubscriptionModal() {
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
    padding: 24px;
    max-width: 420px;
    text-align: center;
    box-shadow: 0 8px 24px rgba(0,0,0,0.2);
  `;

  modalContent.innerHTML = `
    <div style="font-size: 40px; margin-bottom: 12px;">🔒</div>
    <h2 style="font-size: 1.25rem; margin-bottom: 8px;">Subscription Required</h2>
    <p style="color: #666; margin-bottom: 18px;">Your subscription is not active. Please subscribe to continue using Xpose Management.</p>
    <div>
      <button id="view-plans" style="
        background: #2a7cff;
        color: white;
        border: none;
        border-radius: 6px;
        padding: 10px 18px;
        font-size: 0.95rem;
        font-weight: 600;
        cursor: pointer;
      ">View Plans</button>
    </div>
  `;

  modal.appendChild(modalContent);
  document.body.appendChild(modal);

  const btn = document.getElementById('view-plans');
  if (btn) btn.addEventListener('click', () => { window.location.href = 'paywall.html'; });
}

/**
 * Check if current user has active subscription
 * Returns true if access allowed, false if blocked (and shows modal)
 * Explicit users with role === 'staff' are exempt from the subscription gate.
 */
async function checkSubscriptionAccess() {
  const supabase = getSupabaseClient();

  if (!supabase) {
    console.warn('⚠️ Supabase not available, skipping subscription check');
    return true;
  }

  try {
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return true; // let auth flow handle sign-in
    }

    const { data: userRecord, error: userRecErr } = await supabase
      .from('users')
      .select('role, subscription_status, subscription_end')
      .eq('id', user.id)
      .single();

    if (userRecErr) {
      console.warn('⚠️ Could not load user record:', userRecErr);
      return true;
    }

    // Exempt explicit shop staff accounts only
    if (userRecord && String(userRecord.role).toLowerCase() === 'staff') {
      console.log('ℹ️ Shop staff detected; skipping subscription check for user', user.id);
      return true;
    }

    const subscription_status = (userRecord && userRecord.subscription_status) || null;
    const subscription_end = (userRecord && userRecord.subscription_end) || null;
    const validStatuses = ['trialing', 'active'];

    if (!validStatuses.includes(subscription_status)) {
      if (subscription_status === 'canceled' && subscription_end) {
        const endDate = new Date(subscription_end);
        if (new Date() < endDate) {
          return true;
        }
      }
      showSubscriptionModal();
      return false;
    }

    return true;
  } catch (err) {
    console.error('❌ Error checking subscription:', err);
    return true;
  }
}

export { checkSubscriptionAccess };
/**
 * helpers/subscription-check.js
 * Check if user has valid subscription before allowing access
 */

import { getSupabaseClient } from './supabase.js';

// Helper to show subscription modal
function showSubscriptionModal() {
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
    padding: 24px;
    max-width: 420px;
    text-align: center;
    box-shadow: 0 8px 24px rgba(0,0,0,0.2);
  `;

  modalContent.innerHTML = `
    <div style="font-size: 40px; margin-bottom: 12px;">🔒</div>
    <h2 style="font-size: 1.25rem; margin-bottom: 8px;">Subscription Required</h2>
    <p style="color: #666; margin-bottom: 18px;">Your subscription is not active. Please subscribe to continue using Xpose Management.</p>
    <div>
      <button id="view-plans" style="
        background: #2a7cff;
        color: white;
        border: none;
        border-radius: 6px;
        padding: 10px 18px;
        font-size: 0.95rem;
        font-weight: 600;
        cursor: pointer;
      ">View Plans</button>
    </div>
  `;

  modal.appendChild(modalContent);
  document.body.appendChild(modal);

  const btn = document.getElementById('view-plans');
  if (btn) btn.addEventListener('click', () => { window.location.href = 'paywall.html'; });
}

/**
 * Check if current user has active subscription
 * Returns true if access allowed, false if blocked (and shows modal)
 * Explicit users with role === 'staff' are exempt from the subscription gate.
 */
async function checkSubscriptionAccess() {
  const supabase = getSupabaseClient();

  if (!supabase) {
    console.warn('⚠️ Supabase not available, skipping subscription check');
    return true;
  }

  try {
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return true; // let auth flow handle sign-in
    }

    const { data: userRecord, error: userRecErr } = await supabase
      .from('users')
      .select('role, subscription_status, subscription_end')
      .eq('id', user.id)
      .single();

    if (userRecErr) {
      console.warn('⚠️ Could not load user record:', userRecErr);
      return true;
    }

    // Exempt explicit shop staff accounts only
    if (userRecord && String(userRecord.role).toLowerCase() === 'staff') {
      console.log('ℹ️ Shop staff detected; skipping subscription check for user', user.id);
      return true;
    }

    const subscription_status = (userRecord && userRecord.subscription_status) || null;
    const subscription_end = (userRecord && userRecord.subscription_end) || null;
    const validStatuses = ['trialing', 'active'];

    if (!validStatuses.includes(subscription_status)) {
      if (subscription_status === 'canceled' && subscription_end) {
        const endDate = new Date(subscription_end);
        if (new Date() < endDate) {
          return true;
        }
      }
      showSubscriptionModal();
      return false;
    }

    return true;
  } catch (err) {
    console.error('❌ Error checking subscription:', err);
    return true;
  }
}

export { checkSubscriptionAccess };
 * helpers/subscription-check.js
 * Check if user has valid subscription before allowing access
 */

import { getSupabaseClient } from './supabase.js';

// Helper to show subscription modal
function showSubscriptionModal() {
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
}

/**
 * Check if current user has active subscription
 * Returns true if access allowed, false if blocked (and shows modal)
 */
async function checkSubscriptionAccess() {
  const supabase = getSupabaseClient();

  if (!supabase) {
    console.warn('⚠️ Supabase not available, skipping subscription check');
    return true; // Allow access if Supabase not configured
  }

  try {
    // Get current auth user
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      console.log('ℹ️ No authenticated user');
      return true; // Let auth system handle unauthenticated state
    }

    // Load user record to determine role/shop membership and subscription info
    const { data: userRecord, error: userRecErr } = await supabase
      .from('users')
      .select('role, shop_id, subscription_status, subscription_end')
      .eq('id', user.id)
      .single();

    if (userRecErr) {
      console.warn('⚠️ Could not load user record:', userRecErr);
      // fallback: allow access to avoid blocking unexpectedly
      return true;
    }

    // If this is a shop staff account, do not block by subscription
    if (userRecord && (userRecord.role === 'staff' || userRecord.shop_id)) {
      console.log('ℹ️ Shop staff detected; skipping subscription check for user', user.id);
      return true;
    }

    // For owners/admins, enforce subscription status
    const subscription_status = (userRecord && userRecord.subscription_status) || null;
    const subscription_end = (userRecord && userRecord.subscription_end) || null;

    const validStatuses = ['trialing', 'active'];

    if (!validStatuses.includes(subscription_status)) {
      // allow canceled users until subscription_end
      if (subscription_status === 'canceled' && subscription_end) {
        const endDate = new Date(subscription_end);
        const now = new Date();
        if (now < endDate) {
          console.log('✅ Canceled subscription but access still valid until', endDate);
          return true;
        }
      }

      // show subscription modal and block
      showSubscriptionModal();
      return false;
    }

    console.log('✅ Valid subscription:', subscription_status);
    return true;
  } catch (err) {
    console.error('❌ Error checking subscription:', err);
    return true; // Allow access on error to avoid breaking the app
  }
}

export { checkSubscriptionAccess };
// Helper to show subscription modal
function showSubscriptionModal() {
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
      // Load user record to determine role/shop membership and subscription info
      const { data: userDataRecord, error: userDataErr } = await supabase
        .from('users')
        .select('role, shop_id, subscription_status, subscription_end, subscription_plan')
        .eq('id', user.id)
        .single();

      if (userDataErr) {
        console.warn('⚠️ Could not load local user record:', userDataErr);
      }

      // If the user is a shop staff (role === 'staff' or has shop_id), do not block by subscription
      if (userDataRecord && (userDataRecord.role === 'staff' || userDataRecord.shop_id)) {
        console.log('ℹ️ Shop staff detected; skipping subscription check for user', user.id);
        return true;
      const { data: shop, error: shopError } = await supabase
        .from('shops')
        .select('owner_id')
        .eq('id', userShop.shop_id)
        .single();
      if (!shopError && shop && shop.owner_id) {
        // Get owner's subscription status
        const { data: ownerData, error: ownerError } = await supabase
          .from('users')
          .select('subscription_status, subscription_end')
          .eq('id', shop.owner_id)
          .single();
        if (!ownerError && ownerData) {
          const { subscription_status, subscription_end } = ownerData;
          const validStatuses = ['trialing', 'active'];
          if (validStatuses.includes(subscription_status)) {
            console.log('✅ Valid subscription (owner):', subscription_status);
            return true;
          }
          if (subscription_status === 'canceled' && subscription_end) {
            const endDate = new Date(subscription_end);
            const now = new Date();
            if (now < endDate) {
              console.log('✅ Canceled subscription but access still valid until', endDate);
              return true;
            }
          }
          // Owner's subscription invalid
          showSubscriptionModal();
          return false;
        }
      }
    }
    // Fallback: check user's own subscription (owner or no shop info)
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
    const validStatuses = ['trialing', 'active'];
    if (!validStatuses.includes(subscription_status)) {
      if (subscription_status === 'canceled' && subscription_end) {
        const endDate = new Date(subscription_end);
        const now = new Date();
        if (now < endDate) {
          console.log('✅ Canceled subscription but access still valid until', endDate);
          return true;
        }
      }
      showSubscriptionModal();
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
