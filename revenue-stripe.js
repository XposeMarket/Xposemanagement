// revenue-stripe.js
// Loads Stripe balance and wires payout/bank actions for the revenue page.
const REVENUE_API_URL = window.API_URL || 'https://xpose-stripe-server.vercel.app/api';

// Local banner-style notification helper (keeps UI consistent with other pages)
function showNotification(message, type = 'success') {
  let container = document.getElementById('revenue_notification_banner_container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'revenue_notification_banner_container';
    container.style.position = 'fixed';
    container.style.left = '0';
    container.style.right = '0';
    container.style.top = '0';
    container.style.zIndex = '2147483646';
    container.style.display = 'flex';
    container.style.justifyContent = 'center';
    container.style.pointerEvents = 'none';
    const header = document.querySelector('header');
    if (header && header.parentNode) header.parentNode.insertBefore(container, header);
    else document.body.insertBefore(container, document.body.firstChild);
  }

  const banner = document.createElement('div');
  banner.style.pointerEvents = 'auto';
  banner.style.margin = '8px';
  banner.style.minWidth = '280px';
  banner.style.maxWidth = '980px';
  banner.style.padding = '12px 18px';
  banner.style.borderRadius = '8px';
  banner.style.boxShadow = '0 8px 30px rgba(2,6,23,0.15)';
  banner.style.fontWeight = '600';
  banner.style.fontSize = '14px';
  banner.style.color = '#fff';
  if (type === 'error') banner.style.background = '#ef4444';
  else if (type === 'info') banner.style.background = '#3b82f6';
  else { banner.style.background = '#10b981'; banner.style.color = '#064e3b'; }
  banner.textContent = message;
  container.appendChild(banner);
  banner.style.opacity = '0';
  banner.style.transform = 'translateY(-6px)';
  requestAnimationFrame(() => { banner.style.transition = 'all 220ms ease'; banner.style.opacity = '1'; banner.style.transform = 'translateY(0)'; });
  setTimeout(() => { try { banner.style.opacity = '0'; banner.style.transform = 'translateY(-6px)'; } catch(e){}; setTimeout(()=>{ try{ banner.remove(); }catch(e){} },240); }, 4000);
}

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
    // Show friendly banner to user
    showNotification('Could not load Stripe balance. The Stripe service may be unavailable.', 'error');
  }
}

async function requestPayout() {
  const shopId = await getShopIdFromSessionOrSupabase();
  // Show a centered modal that includes the available balance
  const availEl = document.getElementById('stripe-available-payout');
  const availText = (availEl && availEl.textContent) ? availEl.textContent.trim() : '';

  const modalOverlay = document.createElement('div');
  modalOverlay.style.position = 'fixed';
  modalOverlay.style.left = '0';
  modalOverlay.style.top = '0';
  modalOverlay.style.width = '100vw';
  modalOverlay.style.height = '100vh';
  modalOverlay.style.display = 'flex';
  modalOverlay.style.alignItems = 'center';
  modalOverlay.style.justifyContent = 'center';
  modalOverlay.style.zIndex = '2147483647';
  modalOverlay.style.background = 'rgba(0,0,0,0.45)';

  const modal = document.createElement('div');
  modal.style.background = '#fff';
  modal.style.padding = '20px';
  modal.style.borderRadius = '8px';
  modal.style.minWidth = '320px';
  modal.style.maxWidth = '520px';
  modal.style.boxShadow = '0 12px 40px rgba(2,6,23,0.2)';
  modal.style.textAlign = 'center';

  const title = document.createElement('div');
  title.style.fontSize = '18px';
  title.style.fontWeight = '700';
  title.style.marginBottom = '8px';
  title.textContent = 'Request payout from available balance now?';

  const balance = document.createElement('div');
  balance.style.fontSize = '16px';
  balance.style.margin = '6px 0 14px 0';
  balance.style.color = '#111827';
  balance.textContent = availText ? `Available Balance: ${availText}` : 'Available Balance: N/A';

  const btnRow = document.createElement('div');
  btnRow.style.display = 'flex';
  btnRow.style.justifyContent = 'center';
  btnRow.style.gap = '12px';

  const btnCancel = document.createElement('button');
  btnCancel.textContent = 'Cancel';
  btnCancel.className = 'btn';
  btnCancel.style.background = '#fff';
  btnCancel.style.border = '1px solid #d1d5db';
  btnCancel.style.color = '#111827';
  btnCancel.style.padding = '8px 14px';
  btnCancel.style.borderRadius = '6px';

  const btnConfirm = document.createElement('button');
  btnConfirm.textContent = 'Request Payout';
  btnConfirm.className = 'btn';
  btnConfirm.style.background = '#2176bd';
  btnConfirm.style.color = '#fff';
  btnConfirm.style.padding = '8px 14px';
  btnConfirm.style.borderRadius = '6px';

  btnRow.appendChild(btnCancel);
  btnRow.appendChild(btnConfirm);
  modal.appendChild(title);
  modal.appendChild(balance);
  modal.appendChild(btnRow);
  modalOverlay.appendChild(modal);
  document.body.appendChild(modalOverlay);

  const confirmed = await new Promise(resolve => {
    btnCancel.addEventListener('click', () => resolve(false));
    btnConfirm.addEventListener('click', () => resolve(true));
    modalOverlay.addEventListener('click', (e) => { if (e.target === modalOverlay) resolve(false); });
    const onKey = (e) => { if (e.key === 'Escape') { document.removeEventListener('keydown', onKey); resolve(false); } };
    document.addEventListener('keydown', onKey);
  });

  try { modalOverlay.remove(); } catch (e) {}
  if (!confirmed) return;
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
    showNotification('Error opening Banking System.', 'error');
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
      showNotification('Could not get connect URL from server.', 'error');
    }
  } catch (err) {
    console.error('connectBank error', err);
    showNotification('Failed to start bank linking', 'error');
  }
}

async function toggleAutoWithdraw() {
  const shopId = await getShopIdFromSessionOrSupabase();
  const elAuto = document.getElementById('stripe-auto-withdraw');
  const currentlyOn = elAuto && elAuto.textContent && elAuto.textContent.toLowerCase().includes('on');
  const action = currentlyOn ? 'disable' : 'enable';
  // Build modal for enabling/disabling auto-withdraw. When enabling, present frequency options.
  const modalOverlay = document.createElement('div');
  modalOverlay.style.position = 'fixed';
  modalOverlay.style.left = '0';
  modalOverlay.style.top = '0';
  modalOverlay.style.width = '100vw';
  modalOverlay.style.height = '100vh';
  modalOverlay.style.display = 'flex';
  modalOverlay.style.alignItems = 'center';
  modalOverlay.style.justifyContent = 'center';
  modalOverlay.style.zIndex = '2147483647';
  modalOverlay.style.background = 'rgba(0,0,0,0.45)';

  const modal = document.createElement('div');
  modal.style.background = '#fff';
  modal.style.padding = '22px';
  modal.style.borderRadius = '8px';
  modal.style.minWidth = '320px';
  modal.style.maxWidth = '560px';
  modal.style.boxShadow = '0 12px 40px rgba(2,6,23,0.2)';
  modal.style.textAlign = 'center';

  const title = document.createElement('div');
  title.style.fontSize = '18px';
  title.style.fontWeight = '700';
  title.style.marginBottom = '8px';
  title.textContent = `${action === 'enable' ? 'Enable' : 'Disable'} auto withdrawals?`;

  modal.appendChild(title);

  let selectedFrequency = 'weekly';
  if (action === 'enable') {
    const info = document.createElement('div');
    info.style.marginBottom = '8px';
    info.style.color = '#111827';
    info.textContent = 'Choose withdrawal frequency:';
    modal.appendChild(info);

    // Render pill-style buttons stacked vertically. Monthly is shown centered at the bottom.
    const primaryOptions = [
      { v: 'daily', label: 'Daily' },
      { v: 'every_other_day', label: 'Every Other Day' },
      { v: 'weekly', label: 'Weekly (Friday)' },
      { v: 'bi_weekly', label: 'Bi Weekly' }
    ];

    const primaryWrap = document.createElement('div');
    primaryWrap.style.display = 'flex';
    primaryWrap.style.flexDirection = 'column';
    primaryWrap.style.gap = '8px';
    primaryWrap.style.marginBottom = '10px';
    primaryWrap.style.alignItems = 'center';

    const makePill = (opt) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = opt.label;
      btn.dataset.value = opt.v;
      btn.style.padding = '8px 14px';
      btn.style.borderRadius = '999px';
      btn.style.border = '1px solid #d1d5db';
      btn.style.background = '#fff';
      btn.style.color = '#111827';
      btn.style.cursor = 'pointer';
      btn.style.minWidth = '180px';
      btn.style.boxShadow = '0 6px 18px rgba(2,6,23,0.06)';

      if (opt.v === selectedFrequency) {
        btn.style.background = '#2176bd';
        btn.style.color = '#fff';
        btn.style.borderColor = '#1e4f7a';
      }

        btn.addEventListener('click', () => {
          selectedFrequency = opt.v;
          // update visuals across all pills inside modal
          const siblings = modal.querySelectorAll('button[data-value]');
          siblings.forEach(s => {
            s.style.background = '#fff';
            s.style.color = '#111827';
            s.style.borderColor = '#d1d5db';
          });
          btn.style.background = '#2176bd';
          btn.style.color = '#fff';
          btn.style.borderColor = '#1e4f7a';
        });

      return btn;
    };

    primaryOptions.forEach(opt => {
      primaryWrap.appendChild(makePill(opt));
    });
    modal.appendChild(primaryWrap);

    // Monthly pill centered at the bottom
    const monthlyWrap = document.createElement('div');
    monthlyWrap.style.display = 'flex';
    monthlyWrap.style.justifyContent = 'center';
    monthlyWrap.style.marginTop = '6px';
    monthlyWrap.style.marginBottom = '18px';

    const monthlyBtn = makePill({ v: 'monthly', label: 'Monthly' });
    monthlyBtn.style.minWidth = '200px';
    monthlyWrap.appendChild(monthlyBtn);
    modal.appendChild(monthlyWrap);
  }

  const btnRow = document.createElement('div');
  btnRow.style.display = 'flex';
  btnRow.style.justifyContent = 'center';
  btnRow.style.gap = '12px';

  const btnCancel = document.createElement('button');
  btnCancel.textContent = 'Cancel';
  btnCancel.className = 'btn';
  btnCancel.style.background = '#fff';
  btnCancel.style.border = '1px solid #d1d5db';
  btnCancel.style.color = '#111827';
  btnCancel.style.padding = '8px 14px';
  btnCancel.style.borderRadius = '6px';

  const btnConfirm = document.createElement('button');
  btnConfirm.textContent = action === 'enable' ? 'Enable' : 'Disable';
  btnConfirm.className = 'btn';
  btnConfirm.style.background = action === 'enable' ? '#10b981' : '#ef4444';
  btnConfirm.style.color = '#fff';
  btnConfirm.style.padding = '8px 14px';
  btnConfirm.style.borderRadius = '6px';

  btnRow.appendChild(btnCancel);
  btnRow.appendChild(btnConfirm);
  modal.appendChild(btnRow);
  modalOverlay.appendChild(modal);
  document.body.appendChild(modalOverlay);

  const confirmed = await new Promise(resolve => {
    btnCancel.addEventListener('click', () => resolve({ ok: false }));
    btnConfirm.addEventListener('click', () => resolve({ ok: true }));
    modalOverlay.addEventListener('click', (e) => { if (e.target === modalOverlay) resolve({ ok: false }); });
    const onKey = (e) => { if (e.key === 'Escape') { document.removeEventListener('keydown', onKey); resolve({ ok: false }); } };
    document.addEventListener('keydown', onKey);
  });

  try { modalOverlay.remove(); } catch (e) {}
  if (!confirmed.ok) return;

  try {
    const url = shopId ? `${REVENUE_API_URL}/stripe-auto-withdraw/${shopId}` : `${REVENUE_API_URL}/stripe-auto-withdraw`;
    const headers = { 'Content-Type': 'application/json' };
    const token = getAuthToken(); if (token) headers['Authorization'] = `Bearer ${token}`;
    const body = action === 'enable' ? JSON.stringify({ action, frequency: selectedFrequency }) : JSON.stringify({ action });
    const resp = await fetch(url, { method: 'POST', headers, body });
    if (!resp.ok) {
      const txt = await resp.text().catch(()=>'');
      throw new Error(txt || `HTTP ${resp.status}`);
    }
    const data = await resp.json();
    showNotification(data.message || 'Auto-withdraw setting updated', 'success');
    await loadStripeBalance();
  } catch (err) {
    console.error('toggleAutoWithdraw error', err);
    showNotification('Failed to update auto-withdraw setting', 'error');
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
