/**
 * pages/admin.js
 * Multi-shop admin dashboard - Fully functional
 */

import { getSupabaseClient } from '../helpers/supabase.js';
import { todayISO, formatTime12 } from '../helpers/utils.js';
import { 
  getCurrentUserId, 
  getUserShops, 
  canCreateShop, 
  createAdditionalShop,
  switchShop
} from '../helpers/multi-shop.js';

let userShops = [];
let shopStats = {};
let canCreate = { canCreate: false, currentShops: 0, maxShops: 0 };
let currentShopId = null;
let isSubscriptionOwner = false;

// Small helper: ensure a global notification container exists and provide showNotification
function ensureNotificationEl() {
  let n = document.getElementById('notification');
  if (!n) {
    n = document.createElement('div');
    n.id = 'notification';
    n.className = 'notification hidden';
    document.body.appendChild(n);
  }
  return n;
}

function showNotification(message, type = 'success') {
  const el = ensureNotificationEl();
  if (!el) return;
  el.textContent = message;
  el.className = 'notification';
  el.style.background = (type === 'error') ? '#ef4444' : '#10b981';
  el.classList.remove('hidden');
  setTimeout(() => { el.classList.add('hidden'); }, 3000);
}

// Confirmation banner with action buttons (green style)
function showConfirmBanner(message, onConfirm, onCancel) {
  // remove existing
  const existing = document.getElementById('confirmBanner');
  if (existing) existing.remove();

  // modal overlay
  const overlay = document.createElement('div');
  overlay.id = 'confirmBanner';
  overlay.className = 'modal-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;z-index:100200;background:rgba(0,0,0,0.35)';

  const modal = document.createElement('div');
  modal.className = 'modal-content card';
  modal.style.cssText = 'width:420px;max-width:92%;padding:18px;border-radius:12px;text-align:left';

  const txt = document.createElement('div'); txt.textContent = message; txt.style.fontWeight = '600'; txt.style.marginBottom = '12px';
  const desc = document.createElement('div'); desc.style.marginBottom = '12px'; desc.style.color = 'var(--muted)';

  const actions = document.createElement('div'); actions.style.display = 'flex'; actions.style.justifyContent = 'flex-end'; actions.style.gap = '8px';
  const cancel = document.createElement('button'); cancel.className = 'btn'; cancel.textContent = 'Cancel';
  const ok = document.createElement('button'); ok.className = 'btn primary'; ok.textContent = 'Confirm';
  actions.appendChild(cancel); actions.appendChild(ok);

  modal.appendChild(txt);
  if (desc) modal.appendChild(desc);
  modal.appendChild(actions);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  // Focus first button
  setTimeout(() => { try { ok.focus(); } catch(e){} }, 50);

  ok.addEventListener('click', () => {
    overlay.remove();
    try { if (typeof onConfirm === 'function') onConfirm(); } catch(e){}
  });
  cancel.addEventListener('click', () => {
    overlay.remove();
    try { if (typeof onCancel === 'function') onCancel(); } catch(e){}
  });

  overlay.addEventListener('click', (e) => { if (e.target === overlay) { overlay.remove(); try { if (typeof onCancel === 'function') onCancel(); } catch(e){} } });
}

function escapeHtml(s){ return String(s||'').replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }

/**
 * Initialize admin page
 */
async function init() {
  console.log('🏠 Initializing Admin Dashboard...');
  
  // Use standard auth flow (same as other pages)
  const userId = await getCurrentUserId();
  
  if (!userId) {
    console.error('❌ No authenticated user');
    window.location.href = 'login.html';
    return;
  }
  
  // SIMPLE: If you can see the admin link, you can use the admin page
  // Authorization is handled by app.js addAdminLinkToNav() function
  console.log('✅ Using authenticated user:', userId);
  
  // Get current shop from localStorage
  currentShopId = localStorage.getItem('xm_current_shop');
  
  // Load user's shops
  userShops = await getUserShops(userId);
  canCreate = await canCreateShop(userId);
  
  console.log('📊 User has', userShops.length, 'shops');
  console.log('🔒 Can create more shops?', canCreate.canCreate);
  console.log('🔒 CanCreate details:', canCreate);
  console.log('🏢 Current shop:', currentShopId);
  
  // Determine whether this user is the subscription owner (has a subscription_plan)
  try {
    const supabase = getSupabaseClient();
    if (supabase) {
      const { data: udata, error: uerr } = await supabase
        .from('users')
        .select('id, subscription_plan')
        .eq('id', userId)
        .single();
      if (!uerr && udata) {
        isSubscriptionOwner = !!udata.subscription_plan;
      }
    }
  } catch (ex) {
    console.warn('Could not determine subscription owner status:', ex);
    isSubscriptionOwner = false;
  }
  
  // Load stats for all shops
  await loadAllShopStats();
  
  renderShops();
  renderRevenueTable();
  setupEventListeners();

  // Make header logo act as a back button (fall back to dashboard)
  try {
    const logo = document.querySelector('header .brand img') || document.querySelector('header img');
    if (logo) {
      logo.style.cursor = 'pointer';
      logo.addEventListener('click', (e) => {
        try {
          if (window.history && window.history.length > 1) {
            window.history.back();
          } else {
            window.location.href = 'dashboard.html';
          }
        } catch (ex) {
          window.location.href = 'dashboard.html';
        }
      });
    }
  } catch (e) { console.warn('logo back handler attach failed', e); }
  
  console.log('✅ Admin dashboard initialized');
}

/**
 * Load statistics for all shops
 */
async function loadAllShopStats() {
  const supabase = getSupabaseClient();

  if (!supabase) {
    console.warn('loadAllShopStats: Supabase client not available, skipping stats load');
    // initialize zeroed stats for all shops to avoid undefined values in UI
    for (const userShop of userShops) {
      shopStats[userShop.shop.id] = { revenue: 0, totalInvoices: 0, paidInvoices: 0, trendPercent: 0 };
    }
    return;
  }

  for (const userShop of userShops) {
    const shopId = userShop.shop.id;

    try {
      // Fetch jobs and invoices for the shop
      const [invRes, jobRes] = await Promise.all([
        supabase.from('invoices').select('items, tax_rate, status, created_at').eq('shop_id', shopId),
        supabase.from('jobs').select('id, customer, customer_first, customer_last, service, services, status, created_at, updated_at').eq('shop_id', shopId)
      ]);

      if (invRes.error) {
        console.warn(`loadAllShopStats: Supabase returned error for shop ${shopId}:`, invRes.error.message || invRes.error);
        shopStats[shopId] = { revenue: 0, totalInvoices: 0, paidInvoices: 0, trendPercent: 0, dailyRevenue: [0,0,0,0,0,0,0], activeJobs: [] };
        continue;
      }

      const invoices = Array.isArray(invRes.data) ? invRes.data : [];
      const jobs = Array.isArray(jobRes.data) ? jobRes.data : [];

      // Fetch appointments as well (we want Appointments Today) and customers for display names
      let appointments = [];
      let customerMap = {};
      try {
        // Try appointments table first, but many deployments store shop data in the `data` JSONB table.
        const [aptRes, custRes] = await Promise.all([
          supabase.from('appointments').select('id, preferred_date, preferred_time, customer, customer_first, customer_last, service, services, status, vehicle').eq('shop_id', shopId),
          supabase.from('customers').select('id, customer_first, customer_last').eq('shop_id', shopId)
        ]);

        if (!aptRes.error && Array.isArray(aptRes.data) && aptRes.data.length) {
          appointments = aptRes.data;
        } else {
          // Fallback: read appointments from `data` JSONB for this shop
          try {
            const { data: dataRow, error: dataErr } = await supabase.from('data').select('appointments').eq('shop_id', shopId).single();
            if (!dataErr && dataRow && Array.isArray(dataRow.appointments)) appointments = dataRow.appointments;
          } catch (de) {
            console.warn(`Could not load appointments from data table for shop ${shopId}:`, de);
          }
        }

        if (!custRes.error && Array.isArray(custRes.data)) {
          (custRes.data || []).forEach(c => { customerMap[c.id] = c; });
        }
      } catch (e) {
        console.warn(`Could not load appointments/customers for shop ${shopId}:`, e);
      }

      // Compute today's appointments list and annotate with display fields
      const today = todayISO();
      const todayAppointmentsRaw = (appointments || []).filter(a => (a.preferred_date || '').slice(0,10) === today);
      const todayAppointments = (todayAppointmentsRaw || []).map(a => {
        let cust = 'N/A';
        if (a.customer_first || a.customer_last) cust = `${a.customer_first || ''} ${a.customer_last || ''}`.trim();
        else if (a.customer && customerMap[a.customer]) {
          const c = customerMap[a.customer]; cust = `${c.customer_first || ''} ${c.customer_last || ''}`.trim();
        } else if (a.customer) cust = a.customer;
        const svc = a.service || (Array.isArray(a.services) && a.services[0] ? (a.services[0].name || a.services[0]) : '');
        return Object.assign({}, a, { displayCustomer: cust, displayService: svc });
      });
      const todayAppointmentsCount = todayAppointments.length;

      // Calculate revenue (paid invoices)
      const { calcInvTotal } = await import('../helpers/invoices.js');
      const paidInvoicesArr = invoices.filter(inv => inv && inv.status === 'paid');
      const revenue = paidInvoicesArr.reduce((sum, inv) => sum + calcInvTotal(inv), 0);

      // Calculate daily revenue for the past 7 days (Mon-Sun)
      const dailyRevenue = [0,0,0,0,0,0,0];
      const now = new Date();
      const weekStart = new Date(now);
      weekStart.setDate(now.getDate() - ((now.getDay() + 6) % 7));
      weekStart.setHours(0,0,0,0);
      for (const inv of paidInvoicesArr) {
        if (!inv.created_at) continue;
        const invDate = new Date(inv.created_at);
        const dayIdx = Math.floor((invDate - weekStart) / (1000*60*60*24));
        if (dayIdx >= 0 && dayIdx < 7) {
          dailyRevenue[dayIdx] += calcInvTotal(inv);
        }
      }

      // Calculate trends (percentage of paid vs total)
      const totalInvoices = invoices.length;
      const paidInvoices = paidInvoicesArr.length;
      const trendPercent = totalInvoices > 0
        ? Math.round((paidInvoices / totalInvoices) * 100)
        : 0;

      // Active jobs (not completed)
      const activeJobs = jobs.filter(j => j.status && j.status !== 'completed');

      shopStats[shopId] = {
        revenue,
        totalInvoices,
        paidInvoices,
        trendPercent,
        dailyRevenue,
        activeJobs,
        todayAppointmentsCount,
        todayAppointments
      };
    } catch (err) {
      console.error(`Error loading stats for shop ${shopId}:`, err && (err.message || err));
      shopStats[shopId] = { revenue: 0, totalInvoices: 0, paidInvoices: 0, trendPercent: 0 };
    }
  }
}

/**
 * Render shop cards
 */
function renderShops() {
  const shopListContainer = document.getElementById('shopList');
  if (!shopListContainer) return;
  
  // Ensure overall shop counter exists (create or update)
  let overall = document.getElementById('overallShopCount');
  if (!overall) {
    overall = document.createElement('div');
    overall.id = 'overallShopCount';
    overall.style.cssText = 'font-weight:600;margin-bottom:12px;font-size:16px;color:#222';
    shopListContainer.parentNode.insertBefore(overall, shopListContainer);
  }
  // Determine plan-based max shops display
  const planName = (canCreate && canCreate.plan) ? String(canCreate.plan).toLowerCase() : '';
  const planMaxMap = { local: 3, multi: 6 };
  const maxFromPlan = planMaxMap[planName] || (canCreate && canCreate.maxShops) || userShops.length || 1;
  overall.textContent = `Shops: ${userShops.length} / ${maxFromPlan}`;

  shopListContainer.innerHTML = '';
  
  if (userShops.length === 0) {
    shopListContainer.innerHTML = '<p style="color: #888;">No shops found. Create your first shop!</p>';
    return;
  }
  
  userShops.forEach((userShop, idx) => {
    const shop = userShop.shop;
    const role = userShop.role;
    const stats = shopStats[shop.id] || { revenue: 0, totalInvoices: 0, paidInvoices: 0, trendPercent: 0 };
    const isActive = shop.id === currentShopId;

    // Real data: active jobs count
    const activeJobsCount = stats.activeJobs ? stats.activeJobs.length : 0;

    const shopCard = document.createElement('div');
    shopCard.className = 'shop-card';
    shopCard.style.margin = '18px 0';
    shopCard.style.padding = '18px 18px 24px 18px';
    shopCard.style.background = 'var(--card)';
    shopCard.style.borderRadius = '14px';
    shopCard.style.boxShadow = '0 2px 12px rgba(0,0,0,0.07)';
    shopCard.style.border = isActive ? '2px solid #007bff' : '1px solid var(--line)';

    shopCard.innerHTML = `
      <div style="position: relative; display: flex; flex-direction: row; gap: 0px; align-items: flex-start; flex-wrap: wrap;">
        ${role === 'owner' ? `<button class="btn small danger delete-shop-btn icon-btn" data-shop-id="${shop.id}" aria-label="Delete shop" style="position:absolute; top:-10px; right:28px; z-index:3;">` +
            `<svg width="14" height="14" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false"><path fill="white" d="M3 6h18v2H3V6zm2 3h14l-1 12a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2l-1-12zM9 4V3a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v1h5v2H4V4h5z"/></svg></button>` : ''}
        <div style="position:absolute; top:-12px; right:-12px; z-index:3; width:36px; height:36px; border-radius:50%; background:#007bff; color:#fff; display:flex;align-items:center;justify-content:center; font-weight:700; font-size:14px; box-shadow:0 2px 6px rgba(0,0,0,0.12); border:3px solid var(--card);">${idx+1}</div>
        <div style="position: absolute; top: 18px; right: 18px; display: flex; flex-direction: column; gap: 8px; z-index:2;">
          ${!isActive ? `<button class=\"btn primary switch-shop-btn\" data-shop-id=\"${shop.id}\">Switch to Shop</button>` : ''}
        </div>
          <div style="flex:none; min-width:220px; max-width:340px; margin:0; padding:0;">
          <h3 style="margin: 0 0 8px 0; font-size: 18px; font-weight: 600;">
            ${shop.name}
            ${isActive ? '<span style=\"color: #007bff; font-size: 14px; margin-left: 8px;\">(Active)</span>' : ''}
          </h3>
          <div style="color: #666; font-size: 14px; margin-bottom: 4px;"><strong>Role:</strong> ${role}</div>
          <div style="color: #666; font-size: 14px; margin-bottom: 4px;"><strong>Revenue:</strong> $${stats.revenue.toFixed(2)}</div>
          <div style="color: #666; font-size: 14px; margin-bottom: 4px;"><strong>Invoices:</strong> ${stats.paidInvoices}/${stats.totalInvoices} paid (${stats.trendPercent}%)</div>
          <div style="color: #666; font-size: 14px; margin-bottom: 4px;"><strong>Active Jobs:</strong> ${activeJobsCount}</div>
        </div>
        <div style="margin-left:-12px; width:340px; min-width:220px; display:flex; gap:12px; align-items:flex-start;">
          <div class="card" style="flex:0 0 260px; padding:12px; background:var(--card); box-shadow:0 2px 8px rgba(0,0,0,0.04); border-radius:10px;">
            <div style="font-weight:600; font-size:14px; margin-bottom:6px; color:#007bff;">Revenue Trend</div>
            <canvas id="revenueChart-${shop.id}" width="220" height="140" style="display:block;max-width:100%;margin:0 auto;"></canvas>
          </div>
          <div class="card" style="flex:0 0 260px; padding:12px; background:var(--card); box-shadow:0 2px 8px rgba(0,0,0,0.04); border-radius:10px; min-width:120px;">
            <div style="font-weight:600; font-size:14px; margin-bottom:6px; color:#007bff; display:flex;justify-content:space-between;align-items:center;">
              <span>Appointments Today</span>
              <span style="font-size:12px;color:#666">${(stats.todayAppointmentsCount||0)}</span>
            </div>
            <div style="color:#666;font-size:12px;margin-bottom:8px">Active Jobs: <strong style="color:#222">${(stats.activeJobs?stats.activeJobs.length:0)}</strong></div>
            <div id="apptList-${shop.id}" style="display:flex;flex-direction:column;gap:8px;max-height:160px;overflow:auto;">
              <!-- appointments will be injected here -->
            </div>
          </div>
        </div>
      </div>
    `;

    shopListContainer.appendChild(shopCard);

    // Normalize inline styles that cause overflow on small screens.
    // Only override large fixed pixel widths; skip small badges (e.g. circular shop number)
    (function normalizeShopCard(card){
      try {
        const nodes = card.querySelectorAll('[style]');
        nodes.forEach(n => {
          const s = (n.getAttribute('style') || '').toLowerCase();

          // If element explicitly uses a 50% border-radius (circular badge), skip width overrides
          if (/border-radius:\s*50%/.test(s) || /border-radius:\s*\d+px/.test(s) && s.indexOf('50%') !== -1) return;

          // min-width overrides: collapse to 0 to allow flex shrink
          const minwMatch = s.match(/min-width:\s*(\d+)px/);
          if (minwMatch && Number(minwMatch[1]) >= 80) {
            n.style.minWidth = '0';
            n.style.maxWidth = '100%';
            n.style.width = '100%';
          }

          // width overrides: only replace large fixed widths (>=80px)
          const wMatch = s.match(/width:\s*(\d+)px/);
          if (wMatch) {
            const wVal = Number(wMatch[1]);
            if (wVal >= 80) {
              n.style.width = '100%';
              n.style.maxWidth = '100%';
            }
          }

          if (/margin-left:\s*-?\d+px/.test(s)) {
            n.style.marginLeft = '0';
          }
          if (/position:\s*absolute/.test(s)) {
            // Preserve absolute positioning for the delete button / icon-only controls
            try {
              const cls = (n.className || '').toString();
              if (cls.indexOf('delete-shop-btn') !== -1 || cls.indexOf('icon-btn') !== -1) {
                return; // keep absolute positioning for delete button
              }
            } catch (ex) {}
            // Only change absolute positioning for non-badge, non-delete elements
            if (!/border-radius:\s*50%/.test(s)) {
              n.style.position = 'relative';
              n.style.right = 'auto';
              n.style.top = 'auto';
            }
          }

          // Flex shorthand like "flex: 0 0 260px" -> convert to fluid
          const flexPxMatch = s.match(/flex:\s*0\s*0\s*(\d+)px/);
          if (flexPxMatch && Number(flexPxMatch[1]) >= 120) {
            n.style.flex = '1 1 auto';
            n.style.width = '100%';
            n.style.maxWidth = '100%';
          }
        });
      } catch (e) {
        console.warn('normalizeShopCard error', e);
      }
    })(shopCard);

    // Render chart with real daily revenue data
    setTimeout(() => {
      const ctx = document.getElementById(`revenueChart-${shop.id}`);
      if (ctx && window.Chart) {
        new window.Chart(ctx, {
          type: 'line',
          data: {
            labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
            datasets: [{
              label: 'Revenue',
              data: stats.dailyRevenue,
              borderColor: '#007bff',
              backgroundColor: 'rgba(0,123,255,0.1)',
              fill: true
            }]
          },
          options: {
            responsive: true,
            plugins: { legend: { display: false } },
            scales: { y: { beginAtZero: true } }
          }
        });
      }
    }, 100);

    // Populate appointments list for today
    setTimeout(() => {
      try {
        const listEl = document.getElementById(`apptList-${shop.id}`);
        if (!listEl) return;
        listEl.innerHTML = '';
        const appts = stats.todayAppointments || [];
        if (!appts.length) {
          listEl.innerHTML = '<div class="notice">No appointments today</div>';
          return;
        }
        appts.slice(0,8).forEach(a => {
          const time = a.preferred_time ? formatTime12(a.preferred_time) : '';
          const cust = a.displayCustomer || (a.customer_first || a.customer_last ? `${a.customer_first || ''} ${a.customer_last || ''}`.trim() : (a.customer || 'N/A'));
          const svc = a.displayService || (a.service || (Array.isArray(a.services) && a.services[0] ? (a.services[0].name || a.services[0]) : ''));
          const item = document.createElement('div');
          item.style.cssText = 'display:flex;justify-content:space-between;align-items:center;font-size:13px;padding:8px;border-radius:6px;background:transparent';
          item.innerHTML = `<div><b>${cust}</b><br><span class="notice">${time}</span></div><div style="text-align:right;font-weight:700">${svc}</div>`;
          // clicking an appointment navigates to the appointment page
          item.addEventListener('click', () => {
            try { localStorage.setItem('openApptId', a.id); } catch (e) { console.warn('Failed to store openApptId', e); }
            location.href = 'appointments.html';
          });
          listEl.appendChild(item);
        });
      } catch (e) {
        console.warn('Failed to render appointments list for shop', shop.id, e);
      }
    }, 160);
  });
}

/**
 * Render revenue table
 */
function renderRevenueTable() {
  const revenueTableBody = document.querySelector('#revenueTable tbody');
  const overallRevenueDiv = document.getElementById('overallRevenue');
  
  if (!revenueTableBody || !overallRevenueDiv) return;
  
  revenueTableBody.innerHTML = '';
  let totalRevenue = 0;
  
  userShops.forEach(userShop => {
    const shop = userShop.shop;
    const stats = shopStats[shop.id] || { revenue: 0, trendPercent: 0 };
    totalRevenue += stats.revenue;
    
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${shop.name}</td>
      <td>$${stats.revenue.toFixed(2)}</td>
      <td>${stats.trendPercent}% paid</td>
    `;
    revenueTableBody.appendChild(row);
  });
  
  overallRevenueDiv.textContent = `Overall Revenue: $${totalRevenue.toFixed(2)}`;
}

/**
 * Setup event listeners
 */
function setupEventListeners() {
  // Add Shop button
  const addShopBtn = document.getElementById('addShopBtn');
  if (addShopBtn) {
    // Only show the Add Shop button to subscription owners
    if (!isSubscriptionOwner) {
      addShopBtn.style.display = 'none';
    } else {
      addShopBtn.addEventListener('click', handleAddShop);

      // Disable if can't create more shops
      if (!canCreate.canCreate) {
        addShopBtn.disabled = true;
        addShopBtn.title = `You have reached your maximum of ${canCreate.maxShops} shops`;
        addShopBtn.style.opacity = '0.5';
        addShopBtn.style.cursor = 'not-allowed';
        // show small plan info next to button
        const info = document.createElement('span');
        info.id = 'addShopInfo';
        info.style.cssText = 'margin-left:10px;color:#666;font-size:13px';
        info.textContent = `${canCreate.currentShops || 0}/${canCreate.maxShops || 0} (${canCreate.plan || 'plan'})`;
        addShopBtn.parentNode && addShopBtn.parentNode.insertBefore(info, addShopBtn.nextSibling);
      }
    }
  }
  
  // Switch shop buttons
  document.querySelectorAll('.switch-shop-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const shopId = e.target.dataset.shopId;
      const shop = userShops.find(s => s.shop.id === shopId);
      const name = shop ? shop.shop.name : 'selected shop';
      showConfirmBanner(`Switch to ${name}?`, async () => {
        // on confirm
        try { await handleSwitchShop(shopId); } catch(e) { console.warn(e); }
      }, () => {});
    });
  });
  
  // Delete shop buttons
  document.querySelectorAll('.delete-shop-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const shopId = e.target.dataset.shopId;
      handleDeleteShop(shopId);
    });
  });
  
  // Logout button
  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', handleLogout);
  }
}

/**
 * Handle add shop
 */
async function handleAddShop() {
  if (!canCreate.canCreate) {
    alert(`You have reached your maximum of ${canCreate.maxShops} shops. Upgrade your plan to create more shops.`);
    return;
  }

  // Ensure modal exists
  if (!document.getElementById('addShopModal')) createAddShopModal();
  openAddShopModal();
}

/**
 * Create Add Shop modal DOM (minimal form)
 */
function createAddShopModal() {
  const modal = document.createElement('div');
  modal.id = 'addShopModal';
  modal.className = 'modal-overlay';
  modal.style.cssText = 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;z-index:9999;background:rgba(0,0,0,0.35)';
  modal.innerHTML = `
    <div class="modal-content card" style="width:420px;padding:18px;border-radius:12px;">
      <h3 style="margin-top:0">Create Shop</h3>
      <div id="addShopErr" style="color:red;min-height:18px;margin-bottom:8px"></div>
      <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:12px">
        <label style="font-size:13px;color:#444">Shop Name</label>
        <input id="addShopName" type="text" placeholder="My New Shop" style="padding:8px;border:1px solid var(--line);border-radius:6px" />
        <label style="font-size:13px;color:#444">Type</label>
        <select id="addShopType" style="padding:8px;border:1px solid var(--line);border-radius:6px">
          <option value="Mechanic">Mechanic</option>
          <option value="Detailer">Detailer</option>
          <option value="Other">Other</option>
        </select>
        <label style="font-size:13px;color:#444">Zipcode (optional)</label>
        <input id="addShopZip" type="text" placeholder="12345" style="padding:8px;border:1px solid var(--line);border-radius:6px" />
        <label style="font-size:13px;color:#444">Logo (optional)</label>
        <div id="logoDrop" style="padding:10px;border:1px dashed var(--line);border-radius:8px;display:flex;align-items:center;gap:8px;flex-direction:row;">
          <div style="flex:1;color:#666;font-size:13px">Drag & drop an image here or</div>
          <button class="btn" id="chooseLogoBtn" type="button">Choose file</button>
          <input id="addShopLogoFile" type="file" accept="image/*" style="display:none" />
        </div>
        <div id="addShopLogoPreview" style="margin-top:8px;display:none;align-items:center;gap:8px">
          <img id="addShopLogoPreviewImg" src="" alt="logo preview" style="height:40px;border-radius:6px;object-fit:contain;border:1px solid var(--line)" />
          <div id="addShopLogoPreviewName" style="color:#444;font-size:13px"></div>
        </div>
      </div>
      <div style="display:flex;justify-content:flex-end;gap:8px">
        <button class="btn" id="cancelAddShop">Cancel</button>
        <button class="btn primary" id="submitAddShop">Create</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  document.getElementById('cancelAddShop').addEventListener('click', () => closeAddShopModal());
  document.getElementById('submitAddShop').addEventListener('click', () => submitAddShopModal());
  modal.addEventListener('click', (e) => { if (e.target === modal) closeAddShopModal(); });

  // Logo file / drag-and-drop handlers
  try {
    const drop = document.getElementById('logoDrop');
    const fileInput = document.getElementById('addShopLogoFile');
    const chooseBtn = document.getElementById('chooseLogoBtn');
    const previewWrap = document.getElementById('addShopLogoPreview');
    const previewImg = document.getElementById('addShopLogoPreviewImg');
    const previewName = document.getElementById('addShopLogoPreviewName');

    function showPreview(file) {
      if (!file) { previewWrap.style.display = 'none'; previewImg.src = ''; previewName.textContent = ''; return; }
      const url = URL.createObjectURL(file);
      previewImg.src = url;
      previewName.textContent = file.name;
      previewWrap.style.display = 'flex';
    }

    if (drop) {
      drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.style.borderColor = '#007bff'; });
      drop.addEventListener('dragleave', (e) => { e.preventDefault(); drop.style.borderColor = 'var(--line)'; });
      drop.addEventListener('drop', (e) => {
        e.preventDefault(); drop.style.borderColor = 'var(--line)';
        const f = (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) ? e.dataTransfer.files[0] : null;
        if (f) {
          fileInput.files = e.dataTransfer.files;
          showPreview(f);
        }
      });
    }

    if (chooseBtn && fileInput) {
      chooseBtn.addEventListener('click', () => fileInput.click());
      fileInput.addEventListener('change', (e) => {
        const f = (e.target.files && e.target.files[0]) ? e.target.files[0] : null;
        showPreview(f);
      });
    }
  } catch (e) {
    console.warn('Logo handlers init failed', e);
  }
}

function openAddShopModal() {
  const modal = document.getElementById('addShopModal');
  if (!modal) return;
  modal.style.display = 'flex';
  const name = document.getElementById('addShopName');
  if (name) { name.value = ''; name.focus(); }
  const err = document.getElementById('addShopErr'); if (err) err.textContent = '';
}

function closeAddShopModal() {
  const modal = document.getElementById('addShopModal');
  if (!modal) return;
  modal.style.display = 'none';
}

async function submitAddShopModal() {
  const nameEl = document.getElementById('addShopName');
  const typeEl = document.getElementById('addShopType');
  const zipEl = document.getElementById('addShopZip');
  const logoEl = document.getElementById('addShopLogo');
  const logoFileEl = document.getElementById('addShopLogoFile');
  const err = document.getElementById('addShopErr');
  if (!nameEl || !typeEl) return;
  const shopName = (nameEl.value || '').trim();
  const shopType = (typeEl.value || 'Mechanic').trim();
  const zipcode = (zipEl && zipEl.value) ? zipEl.value.trim() : '';
  // If a file was provided, we'll upload it to Supabase Storage and use the public URL as the logo
  const logo = (logoEl && logoEl.value) ? logoEl.value.trim() : '';
  const logoFile = (logoFileEl && logoFileEl.files && logoFileEl.files[0]) ? logoFileEl.files[0] : null;
  if (!shopName) { if (err) err.textContent = 'Shop name is required'; return; }

  try {
    document.getElementById('submitAddShop').disabled = true;
    let logoToSave = logo || null;
    if (logoFile) {
      try {
        const supabase = getSupabaseClient();
        if (supabase && supabase.storage) {
          const bucket = 'shop-logos';
          const ext = (logoFile.name || '').split('.').pop();
          const filePath = `shop_${Date.now()}_${Math.random().toString(36).slice(2,6)}.${ext}`;
          const { data: uploadData, error: uploadErr } = await supabase.storage.from(bucket).upload(filePath, logoFile);
          if (uploadErr) {
            console.warn('Logo upload failed:', uploadErr);
            if (err) err.textContent = 'Logo upload failed; try again or skip logo.';
          } else {
            // Get public URL (handle different supabase-js versions)
            try {
              const pub = supabase.storage.from(bucket).getPublicUrl(filePath);
              logoToSave = (pub && (pub.publicURL || (pub.data && pub.data.publicUrl) || pub.publicUrl)) || null;
            } catch (pe) {
              console.warn('Could not get public URL for uploaded logo', pe);
              logoToSave = null;
            }
          }
        }
      } catch (uplErr) {
        console.warn('Logo upload exception', uplErr);
      }
    }

    const result = await createAdditionalShop(shopName, shopType, logoToSave);
    if (result && result.success) {
      closeAddShopModal();
      window.location.reload();
    } else {
      const msg = (result && result.error) ? result.error : 'Failed to create shop';
      if (err) err.textContent = msg;
    }
  } catch (e) {
    console.error('Add shop modal error', e);
    if (err) err.textContent = e && e.message ? e.message : String(e);
  } finally {
    document.getElementById('submitAddShop').disabled = false;
  }
}

/**
 * Handle switch shop
 */
async function handleSwitchShop(shopId) {
  try {
    const success = await switchShop(shopId);
    
    if (success) {
      showNotification('Shop switched successfully! Redirecting...', 'success');
      setTimeout(() => { window.location.href = 'dashboard.html'; }, 800);
    } else {
      showNotification('Failed to switch shop. Please try again.', 'error');
    }
  } catch (error) {
    console.error('Error switching shop:', error);
    showNotification(`Error switching shop: ${error.message}`, 'error');
  }
}

/**
 * Handle delete shop
 */
async function handleDeleteShop(shopId) {
  const shop = userShops.find(us => us.shop.id === shopId);
  if (!shop) return;
  // Open custom delete confirmation modal
  createDeleteShopModal(shopId, shop.shop.name);
}

/**
 * Create and show delete confirmation modal that requires typing the shop name
 */
function createDeleteShopModal(shopId, shopName) {
  // If modal exists, remove
  const existing = document.getElementById('deleteShopModal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'deleteShopModal';
  modal.className = 'modal-overlay';
  modal.style.cssText = 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;z-index:10000;background:rgba(0,0,0,0.45)';
  modal.innerHTML = `
    <div class="modal-content card" style="width:520px;padding:18px;border-radius:12px;">
      <h3 style="margin-top:0;color:#b91c1c">Delete Shop — ${escapeHtml(shopName)}</h3>
      <div style="color:#333;margin-bottom:8px">This will permanently delete all data for this shop, including appointments, jobs, invoices, customers, and messages. This action CANNOT be undone.</div>
      <div id="deleteShopErr" style="color:red;min-height:20px;margin-bottom:8px"></div>
      <div style="margin-bottom:8px">To confirm, type the shop name exactly:</div>
      <input id="confirmDeleteName" type="text" placeholder="Type shop name to confirm" style="padding:8px;border:1px solid var(--line);border-radius:6px;width:100%;margin-bottom:12px" />
      <div style="display:flex;justify-content:flex-end;gap:8px">
        <button class="btn" id="cancelDeleteShop">Cancel</button>
        <button class="btn danger" id="confirmDeleteShop">Delete</button>
      </div>
    </div>`;

  document.body.appendChild(modal);

  document.getElementById('cancelDeleteShop').addEventListener('click', () => modal.remove());
  document.getElementById('confirmDeleteShop').addEventListener('click', async () => {
    const input = document.getElementById('confirmDeleteName');
    const err = document.getElementById('deleteShopErr');
    if (!input) return;
    if ((input.value || '').trim() !== shopName) {
      if (err) err.textContent = 'Shop name did not match. Please type the full shop name to confirm.';
      return;
    }

    try {
      const supabase = getSupabaseClient();
      const { error } = await supabase.from('shops').delete().eq('id', shopId);
      if (error) throw error;
      modal.remove();
      if (typeof showNotification === 'function') showNotification(`Shop "${shopName}" deleted`, 'success');
      if (shopId === currentShopId) {
        localStorage.removeItem('xm_current_shop');
        setTimeout(() => { window.location.href = 'dashboard.html'; }, 900);
      } else {
        setTimeout(() => { window.location.reload(); }, 900);
      }
    } catch (ex) {
      console.error('Error deleting shop:', ex);
      if (err) err.textContent = `Error deleting shop: ${ex && ex.message ? ex.message : String(ex)}`;
    }
  });

  modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
}

/**
 * Handle logout
 */
async function handleLogout() {
  try {
    const supabase = getSupabaseClient();
    await supabase.auth.signOut();
    window.location.href = 'login.html';
  } catch (error) {
    console.error('Error logging out:', error);
    alert('Error logging out. Please try again.');
  }
}

// Initialize on load
document.addEventListener('DOMContentLoaded', init);

export { init };
