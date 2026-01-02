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
  // SHOW OPTED-OUT UI (JOIN BUTTON)
  // ============================================================================
  function showOptedOutUI() {
    const panel = document.getElementById('stripe-express-panel');
    if (!panel) return;

    // Update panel content
    panel.innerHTML = `
      <div style="display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 16px;">
        <div style="flex: 2 1 320px; min-width: 220px;">
          <h2 style="margin: 0 0 8px 0; color: #2176bd;">Stripe Express Payouts</h2>
          <div style="margin-bottom: 8px; color: #444;">You opted out of Stripe Terminal during signup.</div>
          <div style="display: flex; flex-direction: column; gap: 6px;">
            <div>Total Revenue: <strong id="stripe-total-revenue">$0.00</strong></div>
          </div>
        </div>
        <div style="flex: 1 1 180px; min-width: 160px; display: flex; flex-direction: column; gap: 10px; align-items: flex-end;">
          <button id="join-stripe-express-btn" class="btn" style="background: #2176bd; color: #fff;">Join Stripe Express Payouts & Order a terminal</button>
        </div>
      </div>
    `;

    // Attach event listener to new button
    const joinBtn = document.getElementById('join-stripe-express-btn');
    if (joinBtn) {
      joinBtn.addEventListener('click', handleJoinStripeExpress);
    }
  }

  // ============================================================================
  // HANDLE JOIN STRIPE EXPRESS (CREATE ACCOUNT + SHOW TERMINAL MODAL)
  // ============================================================================
  async function handleJoinStripeExpress() {
    const shopId = getCurrentShopId();
    if (!shopId) {
      alert('Could not determine current shop');
      return;
    }

    const joinBtn = document.getElementById('join-stripe-express-btn');
    if (joinBtn) {
      joinBtn.disabled = true;
      joinBtn.textContent = 'Creating account...';
    }

    try {
      const { getSupabaseClient } = await import('./helpers/supabase.js');
      const supabase = getSupabaseClient();

      // Get shop details
      const { data: shop, error: shopError } = await supabase
        .from('shops')
        .select('stripe_account_id, name, email, street, city, state, zipcode')
        .eq('id', shopId)
        .single();

      if (shopError || !shop) {
        throw new Error('Could not fetch shop details');
      }

      // Create Stripe Express account if doesn't exist
      if (!shop.stripe_account_id) {
        const createResponse = await fetch(`${STRIPE_API_URL}/api/connect/create-account`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            shopId: shopId,
            email: shop.email || 'shop@example.com',
            businessName: shop.name || 'Auto Shop',
            country: 'US',
            address: {
              street: shop.street || '123 Main St',
              city: shop.city || 'Frederick',
              state: shop.state || 'MD',
              zipcode: shop.zipcode || '21701'
            }
          })
        });

        if (!createResponse.ok) {
          const errorData = await createResponse.json();
          throw new Error(errorData.error || 'Failed to create Stripe account');
        }

        const createData = await createResponse.json();
        shop.stripe_account_id = createData.accountId;
      }

      // Show terminal selection modal
      showTerminalModal();

    } catch (error) {
      console.error('❌ Error joining Stripe Express:', error);
      alert('Failed to create account: ' + error.message);
      if (joinBtn) {
        joinBtn.disabled = false;
        joinBtn.textContent = 'Join Stripe Express Payouts & Order a terminal';
      }
    }
  }

  // ============================================================================
  // SHOW TERMINAL SELECTION MODAL
  // ============================================================================
  function showTerminalModal() {
    // Create modal if doesn't exist
    if (document.getElementById('revenueTerminalModal')) {
      document.getElementById('revenueTerminalModal').classList.remove('hidden');
      return;
    }

    const modalHTML = `
      <div id="revenueTerminalModal" class="modal-overlay">
        <div class="modal-content card" style="max-width:1100px; width:95%; margin:6vh auto; padding:20px;">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;">
            <h3 style="margin:0">Choose Your Terminal</h3>
            <button id="terminalModalCloseRevenue" class="btn" aria-label="Close modal">×</button>
          </div>
          <p style="color:#666;margin-top:8px;">All subscriptions include a Stripe Reader M2 by default — choose a different terminal to add its monthly fee.</p>
          <p style="color:#9ca3af;margin-top:6px;font-weight:600;">Terminal subscription payments will automatically end after 6 months.</p>
          <div id="terminalModalOptionsRevenue" style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-top:14px;align-items:stretch;">
            <div class="terminal-option-revenue selected" data-terminal="reader_m2" style="padding:16px;border-radius:10px;background:#fff;text-align:center;display:flex;flex-direction:column;justify-content:space-between;border:3px solid #2a7cff;">
              <img src="assets/Stripe Reader M2.png" alt="Reader M2" style="max-width:140px;margin-bottom:8px;">
              <h4 style="margin:6px 0">Stripe Reader M2</h4>
              <div style="color:#059669;font-weight:700;margin-bottom:8px;">Included FREE</div>
              <p style="color:#666;font-size:0.95rem;">Countertop terminal, no screen.</p>
              <div style="margin-top:10px"><button class="btn" onclick="window.selectTerminalRevenue('reader_m2')">Select</button></div>
            </div>
            <div class="terminal-option-revenue" data-terminal="wisepos_e" style="padding:16px;border-radius:10px;background:#fff;text-align:center;display:flex;flex-direction:column;justify-content:space-between;border:1px solid #e6eefc;">
              <img src="assets/BBPOS WisePOS E1.png" alt="WisePOS E" style="max-width:140px;margin-bottom:8px;">
              <h4 style="margin:6px 0">BBPOS WisePOS E</h4>
              <div style="color:#b45309;font-weight:700;margin-bottom:8px;">+$30 / month for 6 months</div>
              <p style="color:#666;font-size:0.95rem;">Handheld terminal with touchscreen.</p>
              <div style="margin-top:10px"><button class="btn" onclick="window.selectTerminalRevenue('wisepos_e')">Select</button></div>
            </div>
            <div class="terminal-option-revenue" data-terminal="reader_s700" style="padding:16px;border-radius:10px;background:#fff;text-align:center;display:flex;flex-direction:column;justify-content:space-between;border:1px solid #e6eefc;">
              <img src="assets/Stripe Reader S7001.png" alt="Reader S700" style="max-width:140px;margin-bottom:8px;">
              <h4 style="margin:6px 0">Stripe Reader S700</h4>
              <div style="color:#9b1238;font-weight:700;margin-bottom:8px;">+$50 / month for 6 months</div>
              <p style="color:#666;font-size:0.95rem;">Premium terminal with customer-facing display.</p>
              <div style="margin-top:10px"><button class="btn" onclick="window.selectTerminalRevenue('reader_s700')">Select</button></div>
            </div>
          </div>
          <div style="margin-top:16px;text-align:center;">
            <button id="confirmTerminalRevenue" class="btn primary" style="background:#2176bd;color:#fff;padding:12px 32px;">Confirm & Complete Setup</button>
          </div>
        </div>
      </div>
      <style>
        .modal-overlay { position:fixed; left:0; right:0; top:0; bottom:0; background:rgba(0,0,0,0.5); display:flex; align-items:center; justify-content:center; z-index:1200; }
        .modal-overlay.hidden { display:none; }
        .terminal-option-revenue.selected { border:3px solid #2a7cff !important; box-shadow: 0 2px 12px rgba(42,124,255,0.10); }
      </style>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHTML);

    // Attach event listeners
    document.getElementById('terminalModalCloseRevenue').onclick = () => {
      document.getElementById('revenueTerminalModal').remove();
    };

    document.getElementById('confirmTerminalRevenue').onclick = handleTerminalConfirm;
  }

  // Terminal selection handler
  window.selectTerminalRevenue = function(terminal) {
    window.selectedTerminalRevenue = terminal;
    document.querySelectorAll('.terminal-option-revenue').forEach(opt => {
      opt.classList.remove('selected');
      opt.style.border = '1px solid #e6eefc';
      if (opt.dataset.terminal === terminal) {
        opt.classList.add('selected');
        opt.style.border = '3px solid #2a7cff';
      }
    });
  };

  // Initialize selection
  window.selectedTerminalRevenue = 'reader_m2';

  // ============================================================================
  // HANDLE TERMINAL CONFIRMATION
  // ============================================================================
  async function handleTerminalConfirm() {
    const shopId = getCurrentShopId();
    const terminal = window.selectedTerminalRevenue || 'reader_m2';

    const confirmBtn = document.getElementById('confirmTerminalRevenue');
    if (confirmBtn) {
      confirmBtn.disabled = true;
      confirmBtn.textContent = 'Processing...';
    }

    try {
      const { getSupabaseClient } = await import('./helpers/supabase.js');
      const supabase = getSupabaseClient();

      // Update shop: set terminal_opted_out to false and terminal model
      const { error: updateError } = await supabase
        .from('shops')
        .update({
          terminal_opted_out: false,
          terminal_id: terminal
        })
        .eq('id', shopId);

      if (updateError) throw updateError;

      // Get shop's stripe account
      const { data: shop } = await supabase
        .from('shops')
        .select('stripe_account_id')
        .eq('id', shopId)
        .single();

      if (!shop || !shop.stripe_account_id) {
        throw new Error('Stripe account not found');
      }

      // Create onboarding link
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

      // Close modal
      document.getElementById('revenueTerminalModal').remove();

      // Redirect to Stripe onboarding
      window.location.href = linkData.url;

    } catch (error) {
      console.error('❌ Error confirming terminal:', error);
      alert('Failed to complete setup: ' + error.message);
      if (confirmBtn) {
        confirmBtn.disabled = false;
        confirmBtn.textContent = 'Confirm & Complete Setup';
      }
    }
  }

  // ============================================================================
  // CONNECT BANK INFO BUTTON - Original Flow
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
      const { getSupabaseClient } = await import('./helpers/supabase.js');
      const supabase = getSupabaseClient();

      if (!supabase) {
        throw new Error('Supabase not available');
      }

      // Get shop details
      const { data: shop, error: shopError} = await supabase
        .from('shops')
        .select('stripe_account_id, name, email, street, city, state, zipcode')
        .eq('id', shopId)
        .single();

      if (shopError || !shop) {
        throw new Error('Could not fetch shop details');
      }

      // Create account if needed
      if (!shop.stripe_account_id) {
        const createResponse = await fetch(`${STRIPE_API_URL}/api/connect/create-account`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            shopId: shopId,
            email: shop.email || 'shop@example.com',
            businessName: shop.name || 'Auto Shop',
            country: 'US',
            address: {
              street: shop.street || '123 Main St',
              city: shop.city || 'Frederick',
              state: shop.state || 'MD',
              zipcode: shop.zipcode || '21701'
            }
          })
        });

        if (!createResponse.ok) {
          const errorData = await createResponse.json();
          throw new Error(errorData.error || 'Failed to create Stripe account');
        }

        const createData = await createResponse.json();
        shop.stripe_account_id = createData.accountId;
      }

      // Create onboarding link
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
      window.location.href = linkData.url;

    } catch (error) {
      console.error('❌ Error:', error);
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

      // Get shop's Stripe account ID and terminal opt-out status
      const { data: shop, error: shopError } = await supabase
        .from('shops')
        .select('stripe_account_id, terminal_opted_out')
        .eq('id', shopId)
        .single();

      if (shopError || !shop) {
        console.error('Failed to fetch shop data');
        return;
      }

      // CHECK IF USER OPTED OUT OF TERMINAL
      if (shop.terminal_opted_out === true) {
        console.log('🚫 User opted out of terminals - showing join flow');
        showOptedOutUI();
        return;
      }

      if (!shop.stripe_account_id) {
        document.getElementById('stripe-bank-status').textContent = 'Not Connected';
        document.getElementById('stripe-bank-status').style.color = '#888';
        return;
      }

      // Check account status
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
      console.error('❌ Error checking status:', error);
    }
  }

  // Check status on page load
  await checkOnboardingStatus();

  // Re-check status if returning from Stripe
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('onboarding') === 'complete') {
    window.history.replaceState({}, document.title, window.location.pathname);
    setTimeout(async () => {
      await checkOnboardingStatus();
      const bankStatusEl = document.getElementById('stripe-bank-status');
      if (bankStatusEl.textContent.includes('✅')) {
        alert('Bank account connected successfully! 🎉');
      }
    }, 2000);
  }

  // ============================================================================
  // PAYOUT BUTTONS (Placeholder)
  // ============================================================================
  if (requestPayoutBtn) {
    requestPayoutBtn.addEventListener('click', async () => {
      alert('Payout request functionality coming soon!');
    });
  }

  if (toggleAutoWithdrawBtn) {
    toggleAutoWithdrawBtn.addEventListener('click', async () => {
      alert('Auto-withdrawal functionality coming soon!');
    });
  }
});
