// revenue-stripe.js
// Handles Stripe Connect bank integration on Revenue page

document.addEventListener('DOMContentLoaded', async () => {
  const connectBankBtn = document.getElementById('stripe-connect-bank');
  const requestPayoutBtn = document.getElementById('stripe-request-payout');
  const toggleAutoWithdrawBtn = document.getElementById('stripe-toggle-auto-withdraw');

  if (!connectBankBtn) return;

  // Get current shop ID
  function getCurrentShopId() {
    try {
      const session = JSON.parse(localStorage.getItem('xm_session') || '{}');
      return session.shopId || null;
    } catch (e) {
      return null;
    }
  }

  // Get API URL based on environment
  const STRIPE_API_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? 'http://localhost:3001'
    : 'https://xpose-stripe-server.vercel.app';

  // ============================================================================
  // CONNECT BANK INFO BUTTON - Your Flow!
  // ============================================================================
  connectBankBtn.addEventListener('click', async () => {
    const shopId = getCurrentShopId();
    if (!shopId) {
      alert('Could not determine current shop');
      return;
    }

    connectBankBtn.disabled = true;
    connectBankBtn.textContent = 'Loading...';

    try {
      // Import Supabase client
      const { getSupabaseClient } = await import('./helpers/supabase.js');
      const supabase = getSupabaseClient();

      if (!supabase) {
        throw new Error('Supabase not available');
      }

      console.log('🏦 [CONNECT] Fetching shop details...');

      // Get shop details from database
      const { data: shop, error: shopError } = await supabase
        .from('shops')
        .select('stripe_account_id, name, email')
        .eq('id', shopId)
        .single();

      if (shopError || !shop) {
        throw new Error('Could not fetch shop details');
      }

      console.log('🏦 [CONNECT] Shop:', { id: shopId, hasAccount: !!shop.stripe_account_id });

      // ⭐ YOUR FLOW: Check if account exists
      if (!shop.stripe_account_id) {
        console.log('🏦 [CONNECT] No Stripe account found, creating one...');

        // CREATE EXPRESS ACCOUNT FIRST
        const createResponse = await fetch(`${STRIPE_API_URL}/api/connect/create-account`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            shopId: shopId,
            email: shop.email || 'shop@example.com',
            businessName: shop.name || 'Auto Shop',
            country: 'US'
          })
        });

        if (!createResponse.ok) {
          const errorData = await createResponse.json();
          throw new Error(errorData.error || 'Failed to create Stripe account');
        }

        const createData = await createResponse.json();
        console.log('✅ [CONNECT] Express account created:', createData.accountId);

        // Update local reference (database already updated by backend)
        shop.stripe_account_id = createData.accountId;
      }

      console.log('🏦 [CONNECT] Getting onboarding link for account:', shop.stripe_account_id);

      // CREATE ACCOUNT LINK (onboarding)
      const linkResponse = await fetch(`${STRIPE_API_URL}/api/connect/create-account-link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountId: shop.stripe_account_id
        })
      });

      if (!linkResponse.ok) {
        const errorData = await linkResponse.json();
        throw new Error(errorData.error || 'Failed to create onboarding link');
      }

      const linkData = await linkResponse.json();
      console.log('✅ [CONNECT] Onboarding link created:', linkData.url);

      // REDIRECT TO STRIPE ONBOARDING
      window.location.href = linkData.url;

    } catch (error) {
      console.error('❌ [CONNECT] Error:', error);
      alert('Failed to connect bank: ' + error.message);
      connectBankBtn.disabled = false;
      connectBankBtn.textContent = 'Connect Bank Info';
    }
  });

  // ============================================================================
  // CHECK ONBOARDING STATUS ON PAGE LOAD
  // ============================================================================
  async function checkOnboardingStatus() {
    const shopId = getCurrentShopId();
    if (!shopId) return;

    try {
      const { getSupabaseClient } = await import('./helpers/supabase.js');
      const supabase = getSupabaseClient();

      if (!supabase) return;

      // Get shop's Stripe account ID
      const { data: shop, error: shopError } = await supabase
        .from('shops')
        .select('stripe_account_id')
        .eq('id', shopId)
        .single();

      if (shopError || !shop || !shop.stripe_account_id) {
        // No account yet - show default state
        document.getElementById('stripe-bank-status').textContent = 'Not Connected';
        document.getElementById('stripe-bank-status').style.color = '#888';
        return;
      }

      // Check account status with Stripe
      const statusResponse = await fetch(`${STRIPE_API_URL}/api/connect/account-status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountId: shop.stripe_account_id
        })
      });

      if (!statusResponse.ok) {
        console.error('Failed to check account status');
        return;
      }

      const statusData = await statusResponse.json();
      console.log('📊 [STATUS] Account status:', statusData);

      // Update UI based on status
      const bankStatusEl = document.getElementById('stripe-bank-status');
      
      if (statusData.chargesEnabled && statusData.payoutsEnabled) {
        bankStatusEl.textContent = 'Connected ✅';
        bankStatusEl.style.color = '#28a745';
        connectBankBtn.textContent = 'Update Bank Info';
      } else if (statusData.detailsSubmitted) {
        bankStatusEl.textContent = 'Pending Verification ⏳';
        bankStatusEl.style.color = '#ffc107';
        connectBankBtn.textContent = 'Continue Setup';
      } else {
        bankStatusEl.textContent = 'Setup Incomplete ⚠️';
        bankStatusEl.style.color = '#dc3545';
        connectBankBtn.textContent = 'Complete Setup';
      }

    } catch (error) {
      console.error('❌ [STATUS] Error checking status:', error);
    }
  }

  // Check status on page load
  await checkOnboardingStatus();

  // Re-check status if returning from Stripe (URL param)
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('onboarding') === 'complete') {
    console.log('🎉 Returned from Stripe onboarding!');
    // Remove URL param
    window.history.replaceState({}, document.title, window.location.pathname);
    // Wait a moment for Stripe to sync, then check status
    setTimeout(async () => {
      await checkOnboardingStatus();
      // Show success message
      const bankStatusEl = document.getElementById('stripe-bank-status');
      if (bankStatusEl.textContent.includes('✅')) {
        alert('Bank account connected successfully! 🎉');
      }
    }, 2000);
  }

  // ============================================================================
  // REQUEST PAYOUT BUTTON (Placeholder)
  // ============================================================================
  if (requestPayoutBtn) {
    requestPayoutBtn.addEventListener('click', async () => {
      alert('Payout request functionality coming soon!\n\nThis will allow you to request manual payouts from your available balance.');
    });
  }

  // ============================================================================
  // AUTO-WITHDRAWAL TOGGLE (Placeholder)
  // ============================================================================
  if (toggleAutoWithdrawBtn) {
    toggleAutoWithdrawBtn.addEventListener('click', async () => {
      alert('Auto-withdrawal functionality coming soon!\n\nThis will allow automatic daily/weekly payouts to your bank account.');
    });
  }
});
