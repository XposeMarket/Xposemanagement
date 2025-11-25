/**
 * helpers/subscription-check-clean.js
 * Clean subscription check implementation (use this instead of corrupted file)
 */

import { getSupabaseClient } from './supabase.js';

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

async function checkSubscriptionAccess() {
  const supabase = getSupabaseClient();
  if (!supabase) return true;

  try {
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return true;

    // Prefer shop_staff for staff users
    const { data: staff, error: staffErr } = await supabase
      .from('shop_staff')
      .select('role, subscription_status, subscription_end')
      .eq('auth_id', user.id)
      .single();
    if (staff) {
      // Staff: always allow access (or handle staff-specific logic here)
      return true;
    }
    // If not staff, check users table
    const { data: userRecord, error: userRecErr } = await supabase
      .from('users')
      .select('role, subscription_status, subscription_end')
      .eq('id', user.id)
      .single();
    if (userRecErr) {
      console.warn('⚠️ Could not load user record:', userRecErr);
      return true;
    }
    if (userRecord && String(userRecord.role).toLowerCase() === 'staff') {
      return true;
    }

    const subscription_status = (userRecord && userRecord.subscription_status) || null;
    const subscription_end = (userRecord && userRecord.subscription_end) || null;
    const validStatuses = ['trialing', 'active'];

    if (!validStatuses.includes(subscription_status)) {
      if (subscription_status === 'canceled' && subscription_end) {
        const endDate = new Date(subscription_end);
        if (new Date() < endDate) return true;
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
