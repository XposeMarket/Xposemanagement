// revenue-stripe.js
// Loads Stripe balance and wires payout/bank actions for the revenue page.
const REVENUE_API_URL = window.API_URL || 'https://xpose-stripe-server.vercel.app/api';

function getAuthToken() {
  try {
    const s = JSON.parse(localStorage.getItem('xm_session') || '{}');
    return (s && (s.access_token || s.token)) || null;
  } catch (e) { return null; }
}

async function getShopIdFromSessionOrSupabase() {
  try {
    if (window._supabaseClient) {
      const { data } = await window._supabaseClient.auth.getUser();
      const user = (data && data.user) || null;
      if (user) return user.current_shop_id || user.default_shop_id || null;
    }
  } catch (e) { /* ignore */ }

  try {
    const s = JSON.parse(localStorage.getItem('xm_session') || '{}');
    return (s && (s.shopId || s.current_shop_id || s.default_shop_id)) || null;
  } catch (e) { return null; }
}

function centsToMoney(cents) {
  if (cents == null) return '$0.00';
  return `$${(cents/100).toFixed(2)}`;
}

async function loadStripeBalance() {
  const shopId = await getShopIdFromSessionOrSupabase();
  const elTotal = document.getElementById('stripe-total-revenue');
  const elCurr = document.getElementById('stripe-current-balance');
  const elAvail = document.getElementById('stripe-available-payout');
  const elLast = document.getElementById('stripe-last-payout');
  const elBank = document.getElementById('stripe-bank-status');
  const elAuto = document.getElementById('stripe-auto-withdraw');

  try {
    const url = shopId ? REVENUE_API_URL + '/stripe-balance/' + shopId : REVENUE_API_URL + '/stripe-balance';
    const headers = { 'Content-Type': 'application/json' };
    const token = getAuthToken(); if (token) headers['Authorization'] = 'Bearer ' + token;

    const resp = await fetch(url, { headers });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const data = await resp.json();

    // Expecting amounts in cents or numbers. Use fallback properties for compatibility.
    const total = (data && (data.totalRevenue || data.total_revenue || data.total)) || 0;
    const current = (data && (data.currentBalance || data.current_balance || data.current)) || 0;
    const available = (data && (data.availableBalance || data.available_balance || data.available)) || 0;
    const last = (data && (data.lastPayout || data.last_payout || data.last)) || 0;
    const bankStatus = (data && (data.bankStatus || data.bank_status)) || ((data && data.bank_connected) ? 'Connected' : 'Not Connected');
    const autoOn = !!(data && (data.autoWithdrawEnabled || data.auto_withdraw || data.auto_withdraw_enabled));

    if (elTotal) elTotal.textContent = centsToMoney(total);
    if (elCurr) elCurr.textContent = centsToMoney(current);
    if (elAvail) elAvail.textContent = centsToMoney(available);
    if (elLast) elLast.textContent = centsToMoney(last);
    if (elBank) elBank.textContent = bankStatus;
    if (elAuto) elAuto.textContent = autoOn ? 'On' : 'Off';

  } catch (err) {
    console.warn('loadStripeBalance error', err);
    if (document.getElementById('stripe-total-revenue')) document.getElementById('stripe-total-revenue').textContent = '$0.00';
  }
}

async function requestPayout() {
  const shopId = await getShopIdFromSessionOrSupabase();
  if (!confirm('Request payout from available balance now?')) return;
  try {
    const url = shopId ? `${REVENUE_API_URL}/stripe-request-payout/${shopId}` : `${REVENUE_API_URL}/stripe-request-payout`;
    const headers = { 'Content-Type': 'application/json' };
    const token = getAuthToken(); if (token) headers['Authorization'] = `Bearer ${token}`;
    const resp = await fetch(url, { method: 'POST', headers });
    if (!resp.ok) {
      const txt = await resp.text().catch(()=>'');
      throw new Error(txt || `HTTP ${resp.status}`);
    }
    const data = await resp.json();
    alert('Payout requested. ' + (data.message || 'Check Stripe dashboard for status.'));
    await loadStripeBalance();
  } catch (err) {
    console.error('requestPayout error', err);
    alert('Failed to request payout: ' + (err.message || err));
  }
}

async function connectBank() {
  const shopId = await getShopIdFromSessionOrSupabase();
  try {
    const url = shopId ? `${REVENUE_API_URL}/stripe-connect/${shopId}` : `${REVENUE_API_URL}/stripe-connect`;
    const headers = { 'Content-Type': 'application/json' };
    const token = getAuthToken(); if (token) headers['Authorization'] = `Bearer ${token}`;
    const resp = await fetch(url, { method: 'POST', headers });
    if (!resp.ok) {
      const txt = await resp.text().catch(()=>'');
      throw new Error(txt || `HTTP ${resp.status}`);
    }
    const data = await resp.json();
    if (data && data.url) {
      // Redirect to Stripe onboarding / link page
      window.location.href = data.url;
    } else {
      alert('Could not get connect URL.');
    }
  } catch (err) {
    console.error('connectBank error', err);
    alert('Failed to start bank linking: ' + (err.message || err));
  }
}

async function toggleAutoWithdraw() {
  const shopId = await getShopIdFromSessionOrSupabase();
  const elAuto = document.getElementById('stripe-auto-withdraw');
  const currentlyOn = elAuto && elAuto.textContent && elAuto.textContent.toLowerCase().includes('on');
  const action = currentlyOn ? 'disable' : 'enable';
  if (!confirm(`${action === 'enable' ? 'Enable' : 'Disable'} auto withdrawals?`)) return;

  try {
    const url = shopId ? `${REVENUE_API_URL}/stripe-auto-withdraw/${shopId}` : `${REVENUE_API_URL}/stripe-auto-withdraw`;
    const headers = { 'Content-Type': 'application/json' };
    const token = getAuthToken(); if (token) headers['Authorization'] = `Bearer ${token}`;
    const resp = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ action }) });
    if (!resp.ok) {
      const txt = await resp.text().catch(()=>'');
      throw new Error(txt || `HTTP ${resp.status}`);
    }
    const data = await resp.json();
    alert(data.message || 'Auto-withdraw setting updated');
    await loadStripeBalance();
  } catch (err) {
    console.error('toggleAutoWithdraw error', err);
    alert('Failed to update auto-withdraw setting: ' + (err.message || err));
  }
}

// Wire buttons on DOM ready
document.addEventListener('DOMContentLoaded', () => {
  const btnPayout = document.getElementById('stripe-request-payout');
  const btnConnect = document.getElementById('stripe-connect-bank');
  const btnAuto = document.getElementById('stripe-toggle-auto-withdraw');

  if (btnPayout) btnPayout.addEventListener('click', requestPayout);
  if (btnConnect) btnConnect.addEventListener('click', connectBank);
  if (btnAuto) btnAuto.addEventListener('click', toggleAutoWithdraw);

  // initial load
  loadStripeBalance().catch(e => console.warn('initial loadStripeBalance failed', e));
});

// expose for debugging
window.loadStripeBalance = loadStripeBalance;
window.requestPayout = requestPayout;
window.connectBank = connectBank;
window.toggleAutoWithdraw = toggleAutoWithdraw;
