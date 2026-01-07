/**
 * pages/dashboard.js
 * Dashboard page - Calendar, KPIs, Revenue Chart, Invoice List
 * 
 * Imported by: app.js
 * Imports from: helpers/
 */

import { LS } from '../helpers/constants.js';
import { readLS, getShopData } from '../helpers/storage.js';
import { getSupabaseClient } from '../helpers/supabase.js';
import { byId, fmtMoney, formatTime12 } from '../helpers/utils.js';
import { calcInvProfit } from '../helpers/invoices.js';
import { 
  initializeShopConfig, 
  getCurrentTerm, 
  hasCurrentFeature,
  currentUsesVehicles,
  updatePageTerminology 
} from '../helpers/shop-config-loader.js';

/**
 * Get current shop ID from session
 */
function getCurrentShopId() {
  try {
    const session = JSON.parse(localStorage.getItem('xm_session') || '{}');
    if (session.shopId) {
      console.log('✅ Found shop ID in session:', session.shopId);
      return session.shopId;
    }
    console.warn('⚠️ No shop ID in session');
    return null;
  } catch (e) {
    console.error('❌ Error reading session:', e);
    return null;
  }
}

/**
 * Update dashboard terminology based on industry
 */
function updateDashboardTerminology() {
  console.log('🏷️ Updating dashboard terminology...');
  
  try {
    // Update page title
    document.title = 'Dashboard';
    
    // Update sidebar headers
    const activeJobsHeader = document.querySelector('.left-sidebar .card:nth-child(2) h3');
    if (activeJobsHeader) {
      const jobTerm = getCurrentTerm('jobs');
      activeJobsHeader.innerHTML = `<a href="jobs.html" style="color:inherit">Active ${jobTerm}</a>`;
    }
    
    // Update "Active Jobs" dropdown label
    const jobViewToggle = byId('jobViewToggle');
    if (jobViewToggle) {
      const jobTerm = getCurrentTerm('job');
      const options = jobViewToggle.options;
      if (options[0]) options[0].text = `Active ${jobTerm}s`;
      if (options[1]) options[1].text = 'In Progress';
      if (options[2]) options[2].text = 'Awaiting Parts';
    }
    
    // Update KPI labels
    const kpiJobsLabel = document.querySelector('.kpi:nth-child(3) .notice');
    if (kpiJobsLabel) {
      kpiJobsLabel.textContent = `Active ${getCurrentTerm('jobs').toLowerCase()}`;
    }
    
    // Update quick create buttons
    const btnNewAppt = byId('btnNewAppt');
    if (btnNewAppt) {
      btnNewAppt.textContent = `+ ${getCurrentTerm('appointment')}`;
      btnNewAppt.title = `Create new ${getCurrentTerm('appointment').toLowerCase()}`;
    }
    
    const btnNewCust = byId('btnNewCust');
    if (btnNewCust) {
      btnNewCust.textContent = `+ ${getCurrentTerm('client')}`;
      btnNewCust.title = `Create new ${getCurrentTerm('client').toLowerCase()}`;
    }
    
    // Update day table headers based on industry
    const dayTable = byId('dayTable');
    if (dayTable) {
      const headers = dayTable.querySelectorAll('thead th');
      if (headers.length >= 3) {
        headers[1].textContent = getCurrentTerm('client'); // Customer → Client
        
        // Show/hide vehicle column based on industry
        if (!currentUsesVehicles()) {
          headers[2].style.display = 'none'; // Hide Vehicle column
        }
      }
    }
    
    console.log('✅ Dashboard terminology updated');
  } catch (error) {
    console.error('❌ Error updating dashboard terminology:', error);
  }
}

/**
 * Setup dashboard - main entry point
 */
async function setupDashboard() {
  console.log('📊 Setting up Dashboard...');
  
  // Load fresh data from Supabase
  const shopId = getCurrentShopId();
  let data = {};
  
  // ============================================================================
  // LOAD SHOP AND INITIALIZE INDUSTRY CONFIGURATION
  // ============================================================================
  if (shopId) {
    console.log('📦 Loading shop data for:', shopId);
    try {
      // Load shop details to get industry_type
      const supabase = getSupabaseClient();
      const { data: shopData, error: shopError } = await supabase
        .from('shops')
        .select('*')
        .eq('id', shopId)
        .single();
      
      if (shopError) {
        console.error('❌ Failed to load shop:', shopError);
      } else {
        console.log('✅ Shop loaded:', shopData.name, '| Industry:', shopData.industry_type);
        
        // Initialize industry configuration
        initializeShopConfig(shopData);
        console.log('✅ Industry config initialized');
        
        // Update page terminology based on industry
        updateDashboardTerminology();
      }
      
      // Load shop data (appointments, jobs, etc.)
      data = await getShopData(shopId);
      console.log('✅ Loaded data:', data);
      
      // Update localStorage cache
      localStorage.setItem(LS.data, JSON.stringify(data));
    } catch (err) {
      console.warn('⚠️ Failed to load shop data from Supabase, using localStorage cache:', err);
      data = readLS(LS.data, {});
    }
  } else {
    console.warn('⚠️ No shop ID found, using localStorage cache');
    data = readLS(LS.data, {});
  }
  
  // Ensure data has required fields
  data = {
    appointments: data.appointments || [],
    jobs: data.jobs || [],
    invoices: data.invoices || [],
    threads: data.threads || [],
    settings: data.settings || {}
  };
  
  console.log(`📅 Appointments: ${data.appointments.length}`);
  console.log(`💼 Jobs: ${data.jobs.length}`);
  console.log(`📄 Invoices: ${data.invoices.length}`);
  
  // Load invoices with customer names
  let invoicesWithCustomers = data.invoices; // Use JSONB data
  let customerMap = {};
  async function refreshCustomerMap() {
    if (shopId) {
      try {
        const supabase = getSupabaseClient();
        const { data: customers, error: custError } = await supabase
          .from('customers')
          .select('id, customer_first, customer_last')
          .eq('shop_id', shopId);
        if (!custError) {
          customerMap = {};
          (customers || []).forEach(c => {
            customerMap[c.id] = c;
          });
          console.log('Loaded customerMap:', customerMap);
        } else {
          console.warn('Failed to load customers:', custError);
        }
      } catch (e) {
        console.warn('Exception loading customers:', e);
      }
    }
  }
  await refreshCustomerMap();

  // Render Appointments Today panel
  function renderAppointmentsToday() {
    const list = byId('appointmentsTodayList');
    const totalEl = byId('appointmentsTodayTotal');
    if (!list) return;
    const today = new Date().toISOString().slice(0, 10);
    let appts = (data.appointments || []).filter(a => (a.preferred_date || '').slice(0, 10) === today);
    if (totalEl) totalEl.textContent = String(appts.length);
    if (!appts.length) {
      list.innerHTML = '<p class="notice" id="appointmentsTodayEmpty">No appointments today</p>';
      return;
    }
    list.innerHTML = '';
    appts.forEach(a => {
      let custLabel = a.customer || 'N/A';
      if (a.customer && customerMap && customerMap[a.customer]) {
        const c = customerMap[a.customer];
        custLabel = `${c.customer_first || ''} ${c.customer_last || ''}`.trim();
      } else if (a.customer_first || a.customer_last) {
        custLabel = `${a.customer_first || ''} ${a.customer_last || ''}`.trim();
      }
      const row = document.createElement('div');
      row.style.cssText = 'padding:8px;border:1px solid var(--line);border-radius:8px;cursor:pointer;transition:all 0.2s ease;background:var(--card)';
      row.innerHTML = `<div style=\"display:flex;justify-content:space-between;font-size:13px\"><div><b>${custLabel}</b><br><span class=\"notice\">${a.preferred_time ? formatTime12(a.preferred_time) : ''}</span></div><div style=\"text-align:right;font-weight:700\">${a.vehicle || ''}<br>${a.service || ''}</div></div>`;
      row.addEventListener('click', () => {
        try { localStorage.setItem('openApptId', a.id); } catch (e) { console.warn('Failed to store openApptId', e); }
        if (window.openAppointmentModal) {
          window.openAppointmentModal(a.id);
        } else {
          location.href = 'appointments.html';
        }
      });
      row.addEventListener('mouseenter', () => {
        row.style.background = 'var(--line)';
        row.style.transform = 'translateX(4px)';
      });
      row.addEventListener('mouseleave', () => {
        row.style.background = 'var(--card)';
        row.style.transform = 'translateX(0)';
      });
      list.appendChild(row);
    });
  }

  // Listen for invoice creation/edit events and refresh customerMap
  window.addEventListener('invoiceCreatedOrEdited', async () => {
    await refreshCustomerMap();
    renderOpenInvoices();
    renderAppointmentsToday();
    // Also re-render other invoice-dependent UI if needed
  });
  
  const ref = new Date();
  let invSortBy = "date";
  
  /**
   * Calculate invoice total
   */
  function calcInvTotal(inv) {
    const sub = (inv.items || []).reduce((a, i) => a + ((i.qty || 0) * (i.price || 0)), 0);
    const tax = sub * (inv.tax_rate || 0) / 100;
    const disc = inv.discount || 0;
    return sub + tax - disc;
  }
  
  /**
   * Render open invoices sidebar
   */
  function renderOpenInvoices() {
    const openInvList = byId("openInvoicesList");
    const openInvTotal = byId("openInvTotal");
    if (!openInvList) return;
    
    let openInv = invoicesWithCustomers.filter(i => i.status !== "paid");
    
    // Helper to get customer name
    const getCustomerName = (inv) => {
      if (inv.customer && customerMap[inv.customer]) {
        const c = customerMap[inv.customer];
        return `${c.customer_first || ''} ${c.customer_last || ''}`.trim();
      }
      if (inv.customer_first || inv.customer_last) {
        return `${inv.customer_first || ''} ${inv.customer_last || ''}`.trim();
      }
      return inv.customer || "N/A";
    };
    
    // Sort based on filter
    if (invSortBy === "date") {
      openInv.sort((a, b) => (b.due || "").localeCompare(a.due || ""));
    } else if (invSortBy === "amount-high") {
      openInv.sort((a, b) => calcInvTotal(b) - calcInvTotal(a));
    } else if (invSortBy === "amount-low") {
      openInv.sort((a, b) => calcInvTotal(a) - calcInvTotal(b));
    } else if (invSortBy === "name-az") {
      openInv.sort((a, b) => getCustomerName(a).localeCompare(getCustomerName(b)));
    } else if (invSortBy === "name-za") {
      openInv.sort((a, b) => getCustomerName(b).localeCompare(getCustomerName(a)));
    }
    
    const total = openInv.reduce((a, i) => a + calcInvTotal(i), 0);
    if (openInvTotal) openInvTotal.textContent = "$" + fmtMoney(total);
    
    if (!openInv.length) {
      openInvList.innerHTML = '<p class="notice" id="invoicesEmpty">No open invoices</p>';
      return;
    }
    
    openInvList.innerHTML = "";
    openInv.forEach(inv => {
      const row = document.createElement("div");
      row.style.cssText = "padding:8px;border:1px solid var(--line);border-radius:8px;cursor:pointer;transition:all 0.2s ease;background:var(--card)";
      row.innerHTML = `<div style="display:flex;justify-content:space-between;font-size:13px"><div><b>${getCustomerName(inv)}</b><br><span class="notice">${inv.due || ""}</span></div><div style="text-align:right;font-weight:700">$${fmtMoney(calcInvTotal(inv))}</div></div>`;
      
      row.addEventListener("click", () => {
        try {
          localStorage.setItem('openInvoiceId', inv.id);
        } catch (e) { console.warn('Failed to store openInvoiceId', e); }
        // Navigate to invoices page; invoices.js will read openInvoiceId and open modal
        location.href = 'invoices.html';
      });
      
      row.addEventListener("mouseenter", () => {
        row.style.background = "var(--line)";
        row.style.transform = "translateX(4px)";
      });
      
      row.addEventListener("mouseleave", () => {
        row.style.background = "var(--card)";
        row.style.transform = "translateX(0)";
      });
      
      openInvList.appendChild(row);
    });
  }

  /**
   * Render Active Jobs sidebar (matches Open Invoices style)
   */
  let jobView = 'active';
  function renderActiveJobs() {
    const list = byId('activeJobsList');
    const totalEl = byId('activeJobsTotal');
    if (!list) return;

    let jobs = (data.jobs || []).slice();
    if (jobView === 'awaiting_parts') {
      jobs = jobs.filter(j => j.status === 'awaiting_parts');
    } else if (jobView === 'in_progress') {
      jobs = jobs.filter(j => j.status && j.status !== 'completed' && j.status !== 'awaiting_parts');
    } else {
      // active = not completed
      jobs = jobs.filter(j => j.status && j.status !== 'completed');
    }

    // Deduplicate by id (some workflows may accidentally produce duplicate job entries)
    const jobMap = new Map();
    jobs.forEach(j => {
      const key = String(j.id || '').toLowerCase();
      if (!key) return;
      const existing = jobMap.get(key);
      if (!existing) jobMap.set(key, j);
      else {
        // prefer the most recently updated record
        const a = existing.updated_at || existing.updatedAt || existing.created_at || 0;
        const b = j.updated_at || j.updatedAt || j.created_at || 0;
        const ta = new Date(a).getTime() || 0;
        const tb = new Date(b).getTime() || 0;
        if (tb >= ta) jobMap.set(key, j);
      }
    });

    const deduped = Array.from(jobMap.values());
    if (totalEl) totalEl.textContent = String(deduped.length);

    if (!deduped.length) {
      list.innerHTML = '<p class="notice" id="jobsEmpty">No active jobs</p>';
      return;
    }

    list.innerHTML = '';
    deduped.forEach(j => {
      const row = document.createElement('div');
      row.style.cssText = 'padding:8px;border:1px solid var(--line);border-radius:8px;cursor:pointer;transition:all 0.2s ease;background:var(--card)';
      // customer (bold) + date underneath (muted); service appears in right column (bold) like invoice amount
      let cust = j.customer || 'N/A';
      if (customerMap[j.customer]) {
        const c = customerMap[j.customer];
        cust = `${c.customer_first || ''} ${c.customer_last || ''}`.trim();
      } else if (j.customer_first || j.customer_last) {
        cust = `${j.customer_first || ''} ${j.customer_last || ''}`.trim();
      }
      // determine a sensible date to display
      const dateRaw = j.created_at || j.updated_at || j.completed_at || j.createdAt || j.updatedAt || '';
      let dateLabel = '';
      try{ if(dateRaw) dateLabel = new Date(dateRaw).toLocaleDateString(); }catch(e){ dateLabel = String(dateRaw).slice(0,10); }
      // service - jobs may store service as string or array
      let svc = '';
      if (j.service && typeof j.service === 'string') svc = j.service;
      else if (Array.isArray(j.services) && j.services.length) {
        // try to show first service name or the item itself
        const first = j.services[0];
        svc = (first && (first.name || first.service || first)) || '';
      } else if (j.services && typeof j.services === 'string') svc = j.services;

      let statusLabel = '';
      let statusColor = '';
      if (jobView === 'active') {
        if (j.status === 'awaiting_parts') {
          statusLabel = 'Awaiting Parts';
          statusColor = '#3b82f6'; // blue
        } else {
          statusLabel = 'In Progress';
          statusColor = '#f59e0b'; // orange
        }
      }

      let dateDisplay = dateLabel;
      if (statusLabel) {
        dateDisplay = `<span style="color: ${statusColor}">${statusLabel}</span> - ${dateLabel}`;
      }

      row.innerHTML = `<div style="display:flex;justify-content:space-between;font-size:13px"><div><b>${cust}</b><br><span class="notice">${dateDisplay}</span></div><div style="text-align:right;font-weight:700">${svc}</div></div>`;

      row.addEventListener('click', () => {
        try { localStorage.setItem('openJobId', j.id); } catch (e) { console.warn('Failed to store openJobId', e); }
        location.href = 'jobs.html';
      });

      row.addEventListener('mouseenter', () => {
        row.style.background = 'var(--line)';
        row.style.transform = 'translateX(4px)';
      });
      row.addEventListener('mouseleave', () => {
        row.style.background = 'var(--card)';
        row.style.transform = 'translateX(0)';
      });

      list.appendChild(row);
    });
  }
  
  /**
   * Invoice sort filter handler
   */
  const invFilterEl = byId("invSortFilter");
  if (invFilterEl) {
    invFilterEl.addEventListener("change", (e) => {
      invSortBy = e.target.value;
      renderOpenInvoices();
    });
  }

  // Job view toggle
  const jobViewEl = byId('jobViewToggle');
  if (jobViewEl) {
    jobViewEl.addEventListener('change', (e) => {
      jobView = e.target.value;
      renderActiveJobs();
    });
  }
  
  /**
   * Render KPIs
   */
  function kpis() {
    const ym = ref.toISOString().slice(0, 7);
    const appts = data.appointments.filter(a => (a.preferred_date || "").startsWith(ym));
    const leads = data.appointments.filter(a => (a.created_at || "").slice(0, 7) === ym);
    const jobs = data.jobs.filter(j => j.status !== "completed");
    const openInv = data.invoices.filter(i => i.status !== "paid");
    
    byId("kpiLeads").textContent = leads.length;
    byId("kpiAppts").textContent = appts.length;
    byId("kpiJobs").textContent = jobs.length;
    byId("kpiInv").textContent = openInv.length;
    
    const today = new Date().toISOString().slice(0, 10);
    const paidInvAll = data.invoices.filter(i => i.status === "paid");
    const paidInvMonth = paidInvAll.filter(i => (i.paid_date || i.due || "").startsWith(ym));
    
    // Use profit (sell - cost when available) rather than gross invoice total for revenue KPIs
    const totalRev = paidInvAll.reduce((a, i) => a + calcInvProfit(i), 0);
    const monthRev = paidInvMonth.reduce((a, i) => a + calcInvProfit(i), 0);
    
    if (byId("totalRevenueQuick")) byId("totalRevenueQuick").textContent = "$" + fmtMoney(totalRev);
    if (byId("monthRevenueQuick")) byId("monthRevenueQuick").textContent = "$" + fmtMoney(monthRev);
    
    renderOpenInvoices();
    renderActiveJobs();
    renderAppointmentsToday();
  }
  
  /**
   * Render calendar
   */
  function renderCal() {
    byId("monthLabel").textContent = ref.toLocaleString(undefined, { month: "long", year: "numeric" });
    const grid = byId("calGrid");
    grid.innerHTML = "";
    
    const y = ref.getFullYear();
    const m = ref.getMonth();
    const first = new Date(y, m, 1);
    const start = first.getDay();
    const days = new Date(y, m + 1, 0).getDate();
    
    // Empty cells for days before month starts
    for (let i = 0; i < start; i++) {
      const d = document.createElement("div");
      grid.appendChild(d);
    }
    
    // Calendar days
    for (let d = 1; d <= days; d++) {
      const cell = document.createElement("div");
      cell.className = "day";
      const iso = new Date(y, m, d).toISOString().slice(0, 10);
      const appts = data.appointments.filter(a => a.preferred_date === iso);
      
      const counts = { new: 0, scheduled: 0, in_progress: 0, awaiting_parts: 0, completed: 0 };
      appts.forEach(a => counts[a.status] = (counts[a.status] || 0) + 1);
      
      cell.innerHTML = `<div class="date">${d}</div>
<div class="dotRow">
  ${counts.new ? '<span class="chip"><span class="dot big open"></span><span>New</span></span>' : ''}
  ${counts.scheduled ? '<span class="chip"><span class="dot big scheduled"></span><span>Sch</span></span>' : ''}
  ${counts.in_progress ? '<span class="chip"><span class="dot big progress"></span><span>Prog</span></span>' : ''}
  ${counts.awaiting_parts ? '<span class="chip"><span class="dot big progress"></span><span>Parts</span></span>' : ''}
  ${counts.completed ? '<span class="chip"><span class="dot big done"></span><span>Done</span></span>' : ''}
</div>
<div class="tooltip" role="tooltip" aria-hidden="true">New:${counts.new || 0} · Sch:${counts.scheduled || 0} · Prog:${counts.in_progress || 0} · Parts:${counts.awaiting_parts || 0} · Done:${counts.completed || 0}</div>`;
      
      cell.setAttribute('tabindex', '0');
      cell.setAttribute('role', 'button');
      
      cell.addEventListener("click", () => {
        renderDay(appts, iso);
        const tip = cell.querySelector('.tooltip');
        if (tip) {
          const open = document.querySelector('.day .tooltip.show');
          if (open && open !== tip) {
            open.classList.remove('show');
            open.setAttribute('aria-hidden', 'true');
          }
          const now = tip.classList.toggle('show');
          tip.setAttribute('aria-hidden', now ? 'false' : 'true');
        }
      });
      
      cell.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault();
          const tip = cell.querySelector('.tooltip');
          if (tip) {
            const open = document.querySelector('.day .tooltip.show');
            if (open && open !== tip) {
              open.classList.remove('show');
              open.setAttribute('aria-hidden', 'true');
            }
            const now = tip.classList.toggle('show');
            tip.setAttribute('aria-hidden', now ? 'false' : 'true');
          }
        }
      });
      
      grid.appendChild(cell);
    }
  }
  
  /**
   * Status badge helper
   */
  function badge(st) {
    const map = {
      new: "open",
      scheduled: "scheduled",
      in_progress: "progress",
      awaiting_parts: "parts",
      completed: "done"
    };
    const c = map[st] || "";
    return `<span class="badge ${c}">${st}</span>`;
  }
  
  /**
   * Render day details
   */
  function renderDay(appts, dateStr) {
    const tb = document.querySelector("#dayTable tbody");
    if (!tb) return;
    tb.innerHTML = "";
    
    const empty = byId("dayEmpty");
    const dateDisplay = byId("dayDateDisplay");
    
    if (dateStr) {
      const parts = dateStr.split("-");
      const d = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
      const apptIds = appts.map(a => a.id);
      const paidInvForDay = data.invoices.filter(i => apptIds.includes(i.appointment_id) && i.status === "paid");
      const dayRev = paidInvForDay.reduce((a, i) => a + calcInvTotal(i), 0);
      const dateStr2 = d.toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" });
      
      if (dateDisplay) {
        dateDisplay.innerHTML = dateStr2 + " · Total Revenue: <b>$" + fmtMoney(dayRev) + "</b>";
        dateDisplay.style.fontWeight = "normal";
      }
      
      const dayRevEl = byId("dayRevenueQuick");
      if (dayRevEl) dayRevEl.textContent = "$" + fmtMoney(dayRev);
    }
    
    if (!appts.length) {
      if (empty) empty.textContent = "No appointments for this day.";
      return;
    }
    if (empty) empty.textContent = "";
    
    appts.forEach(a => {
      const tr = document.createElement('tr');
      const apptInv = data.invoices.find(i => i.appointment_id === a.id);
      const invAmount = apptInv ? calcInvTotal(apptInv) : 0;
      const invStatus = apptInv ? apptInv.status : 'open';
      const revColor = invStatus === 'paid' ? '#10b981' : '#ef4444';

      const isMobile = window.matchMedia && window.matchMedia('(max-width:480px)').matches;
      // Map customer_id to name if needed
      let custLabel = a.customer || 'N/A';
      if (a.customer && customerMap && customerMap[a.customer]) {
        const c = customerMap[a.customer];
        custLabel = `${c.customer_first || ''} ${c.customer_last || ''}`.trim();
      } else if (a.customer_first || a.customer_last) {
        custLabel = `${a.customer_first || ''} ${a.customer_last || ''}`.trim();
      }

      tr.innerHTML = `
        <td>${a.preferred_time ? formatTime12(a.preferred_time) : ''}</td>
        <td>${custLabel}</td>
        <td>${a.vehicle || ''}</td>
        <td>${a.service || ''}</td>
        <td style="font-weight:700;color:${revColor}">$${fmtMoney(invAmount)}</td>
        <td>${badge(a.status)}</td>
  ${isMobile ? `<td class="mobile-toggle-cell"><button class="btn small toggle-actions" data-appt="${a.id}">Actions</button></td>` : `<td class="actions-cell"><a class="btn" href="messages.html?appt=${a.id}">Message</a> <a class="btn" href="invoices.html?appt=${a.id}">Invoice</a></td>`}
      `;

      tb.appendChild(tr);

      if (isMobile) {
        const detailsTr = document.createElement('tr');
        detailsTr.className = 'appt-details-row hidden';
        detailsTr.innerHTML = `<td colspan="7" style="padding:8px"><div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><div class="mobile-time" style="font-weight:600">${a.preferred_time ? formatTime12(a.preferred_time) : ''}</div><div style="display:flex;gap:8px"><a class="btn mobile-detail-btn" href="messages.html?appt=${a.id}">Message</a><a class="btn mobile-detail-btn" href="invoices.html?appt=${a.id}">Invoice</a></div></div></td>`;
        tb.appendChild(detailsTr);

        const toggleBtn = tr.querySelector('.toggle-actions');
        if (toggleBtn) {
          toggleBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            detailsTr.classList.toggle('hidden');
          });
        }
      }
    });
  }
  
  /**
   * Reset day panel
   */
  function resetDayPanel() {
    const tb = document.querySelector("#dayTable tbody");
    if (tb) tb.innerHTML = "";
    const empty = byId("dayEmpty");
    if (empty) empty.textContent = "Click a day to view appointments.";
    const dateDisplay = byId("dayDateDisplay");
    if (dateDisplay) dateDisplay.textContent = "Select a day";
    const open = document.querySelector(".day .tooltip.show");
    if (open) {
      open.classList.remove("show");
      open.setAttribute("aria-hidden", "true");
    }
    const dayRevEl = byId("dayRevenueQuick");
    if (dayRevEl) dayRevEl.textContent = "$0";
  }
  
  /**
   * Month navigation
   */
  const btnPrev = byId("monthPrev");
  const btnNext = byId("monthNext");
  
  if (btnPrev) {
    btnPrev.addEventListener("click", () => {
      ref.setMonth(ref.getMonth() - 1);
      renderCal();
      resetDayPanel();
      // Update KPIs and chart for the new month
      kpis();
      renderRevenueChart();
    });
  }
  
  if (btnNext) {
    btnNext.addEventListener("click", () => {
      ref.setMonth(ref.getMonth() + 1);
      renderCal();
      resetDayPanel();
      // Update KPIs and chart for the new month
      kpis();
      renderRevenueChart();
    });
  }
  
  /**
   * Quick create buttons
   */
  function setupQuickCreateButtons() {
    const btnAppt = byId("btnNewAppt");
    const btnInv = byId("btnNewInv");
    const btnCust = byId("btnNewCust");
    
    if (btnAppt) btnAppt.addEventListener("click", () => {
      location.href = "appointments.html#new";
    });
    
    if (btnInv) btnInv.addEventListener("click", () => {
      location.href = "invoices.html#new";
    });
    
    if (btnCust) btnCust.addEventListener("click", () => {
      location.href = "customers.html#new";
    });
  }
  
  /**
   * Render revenue chart
   */
  function renderRevenueChart() {
    const canvas = byId("revenueChart");
    if (!canvas || typeof Chart === 'undefined') return;
    
    const today = new Date();
    const labels = [];
    const revenues = [];
    
    // Get last 30 days
    for (let i = 29; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().slice(0, 10);
      labels.push(d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }));
      
      // Sum paid invoices for this day
      const dayRev = (data.invoices || [])
        .filter(inv => {
          if (inv.status !== 'paid') return false;
          const dt = String(inv.paid_date || inv.due || '').slice(0,10);
          return dt === dateStr;
        })
        .reduce((sum, inv) => sum + calcInvTotal(inv), 0);
      revenues.push(Math.round(dayRev * 100) / 100);
    }
    
    const ctx = canvas.getContext('2d');
    if (window.revenueChartInstance) {
      window.revenueChartInstance.destroy();
    }
    
    window.revenueChartInstance = new Chart(ctx, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [{
          label: 'Daily Revenue',
          data: revenues,
          borderColor: 'var(--accent)',
          backgroundColor: 'rgba(225, 29, 72, 0.05)',
          borderWidth: 2,
          fill: true,
          tension: 0.4,
          pointRadius: 4,
          pointBackgroundColor: 'var(--accent)',
          pointBorderColor: '#fff',
          pointBorderWidth: 2
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (context) => '$' + context.parsed.y.toFixed(2)
            }
          }
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: {
              callback: (value) => '$' + value
            }
          },
          x: {
            ticks: {
              maxRotation: 45,
              minRotation: 45
            }
          }
        }
      }
    });
  }
  
  // Initialize everything
  kpis();
  renderCal();
  resetDayPanel();
  setupQuickCreateButtons();
  renderRevenueChart();
  renderActiveJobs();
  
  // Close tooltip on outside click or ESC
  document.addEventListener('click', (ev) => {
    const open = document.querySelector('.day .tooltip.show');
    if (!open) return;
    const day = open.closest('.day');
    if (day && day.contains(ev.target)) return;
    open.classList.remove('show');
    open.setAttribute('aria-hidden', 'true');
    resetDayPanel();
  });

  // Revenue modal logic (newspaper-style summary)
  const revenueModal = document.getElementById('revenueModal');
  const revModalContent = document.getElementById('revModalContent');
  const revModalClose = document.getElementById('revModalClose');
  const revModalExport = document.getElementById('revModalExport');
  const revModalPrint = document.getElementById('revModalPrint');
  const quickModal = document.getElementById('quickStatsModal');
  const quickModalContent = document.getElementById('quickModalContent');
  const quickModalClose = document.getElementById('quickModalClose');

  function closeRevenueModal() {
    if (!revenueModal) return;
    revenueModal.classList.add('hidden');
    revenueModal.setAttribute('aria-hidden', 'true');
  }

  async function openRevenueModal() {
    if (!revenueModal || !revModalContent) return;
    // Build summary HTML
    const paidInvAll = (data.invoices || []).filter(i => i.status === 'paid');
    // Use profit numbers for dashboard summary and charts
    const totalRev = paidInvAll.reduce((a, i) => a + calcInvProfit(i), 0);
    const today = new Date().toISOString().slice(0,10);
    const paidToday = paidInvAll.filter(i => (i.paid_date || i.due || '').slice(0,10) === today).reduce((a,i)=>a+calcInvProfit(i),0);
    // monthly
    const thisMonth = new Date().toISOString().slice(0,7);
    const paidMonth = paidInvAll.filter(i => (i.paid_date || i.due || '').startsWith(thisMonth)).reduce((a,i)=>a+calcInvProfit(i),0);

    // top customers
    const custMap = new Map();
    paidInvAll.forEach(inv => {
      const name = (inv.customer || 'Unknown').trim();
      custMap.set(name, (custMap.get(name) || 0) + calcInvProfit(inv));
    });
  const topCustomers = Array.from(custMap.entries()).sort((a,b)=>b[1]-a[1]).slice(0,5);

    // top services (by item name)
    const svcMap = new Map();
    paidInvAll.forEach(inv => {
      (inv.items || []).forEach(it => {
        const nm = (it.name || it.service || it.description || 'Service').trim();
        svcMap.set(nm, (svcMap.get(nm) || 0) + ((it.qty||1) * (it.price||0)));
      });
    });
  const topServices = Array.from(svcMap.entries()).sort((a,b)=>b[1]-a[1]).slice(0,3);

    // top services for the current week (Sun-Sat)
    const weekSvcMap = new Map();
    const now = new Date();
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay()); // Sunday
    startOfWeek.setHours(0,0,0,0);
    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(startOfWeek.getDate() + 6);
    endOfWeek.setHours(23,59,59,999);
    paidInvAll.forEach(inv => {
      const pd = new Date((inv.paid_date || inv.due || '').slice(0,10) + 'T00:00:00');
      if (isNaN(pd.getTime())) return;
      if (pd >= startOfWeek && pd <= endOfWeek) {
        (inv.items || []).forEach(it => {
          const nm = (it.name || it.service || it.description || 'Service').trim();
          weekSvcMap.set(nm, (weekSvcMap.get(nm) || 0) + ((it.qty||1) * (it.price||0)));
        });
      }
    });
  const topServicesWeek = Array.from(weekSvcMap.entries()).sort((a,b)=>b[1]-a[1]).slice(0,3);

    // last 7 days revenue breakdown
    const last7 = [];
    for (let i=6;i>=0;i--) {
      const d = new Date(); d.setDate(d.getDate()-i);
      const ds = d.toISOString().slice(0,10);
      const amount = paidInvAll.filter(inv => ((inv.paid_date||inv.due)||'').slice(0,10) === ds).reduce((a,i)=>a+calcInvProfit(i),0);
      // count appointments for this date
      const apptCount = (data.appointments || []).filter(a => ((a.preferred_date || (a.created_at||'').slice(0,10)) || '').slice(0,10) === ds).length;
      last7.push({ date: d.toLocaleDateString(undefined,{month:'short',day:'numeric'}), iso: ds, amount, count: apptCount });
    }

    // Additional metrics: per-day totals, best/worst, weekly/monthly
    const dateTotals = new Map();
    paidInvAll.forEach(inv => {
      const d = ((inv.paid_date || inv.due) || '').slice(0,10);
      if (!d) return;
      dateTotals.set(d, (dateTotals.get(d) || 0) + calcInvProfit(inv));
    });

    // Best/worst day (from dates that have revenue)
    let bestDay = null, worstDay = null;
    Array.from(dateTotals.entries()).forEach(([d,amt]) => {
      if (bestDay === null || amt > bestDay.amount) bestDay = { date: d, amount: amt };
      if (worstDay === null || amt < worstDay.amount) worstDay = { date: d, amount: amt };
    });

    // Highest earning week and month
    function getWeekKey(dateStr) {
      const d = new Date(dateStr + 'T00:00:00');
      // ISO week number
      const tmp = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
      const dayNum = tmp.getUTCDay() || 7;
      tmp.setUTCDate(tmp.getUTCDate() + 4 - dayNum);
      const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(),0,1));
      const weekNo = Math.ceil((((tmp - yearStart) / 86400000) + 1)/7);
      return `${tmp.getUTCFullYear()}-W${weekNo}`;
    }

    const weekTotals = new Map();
    const monthTotals = new Map();
    dateTotals.forEach((amt,d) => {
      const wk = getWeekKey(d);
      weekTotals.set(wk, (weekTotals.get(wk) || 0) + amt);
      const mon = d.slice(0,7);
      monthTotals.set(mon, (monthTotals.get(mon) || 0) + amt);
    });

    let bestWeek = null, bestMonth = null;
    Array.from(weekTotals.entries()).forEach(([k,v]) => { if (!bestWeek || v > bestWeek.amount) bestWeek = { key:k, amount:v }; });
    Array.from(monthTotals.entries()).forEach(([k,v]) => { if (!bestMonth || v > bestMonth.amount) bestMonth = { key:k, amount:v }; });

    // Most appointments in a day
    const apptCounts = new Map();
    (data.appointments || []).forEach(a => {
      const d = (a.preferred_date || (a.created_at||'').slice(0,10) || '').slice(0,10);
      if (!d) return;
      apptCounts.set(d, (apptCounts.get(d) || 0) + 1);
    });
    let mostAppts = null;
    Array.from(apptCounts.entries()).forEach(([d,c]) => { if (!mostAppts || c > mostAppts.count) mostAppts = { date:d, count:c }; });

    // Weekly average by weekday (Mon-Sun)
    const weekdayTotals = [0,0,0,0,0,0,0];
    // Determine date range for counting occurrences
    const allDates = Array.from(dateTotals.keys()).sort();
    let countsByWeekday = [0,0,0,0,0,0,0];
    if (allDates.length) {
      const minD = new Date(allDates[0] + 'T00:00:00');
      const maxD = new Date(allDates[allDates.length-1] + 'T00:00:00');
      for (let d = new Date(minD); d <= maxD; d.setDate(d.getDate()+1)) {
        countsByWeekday[d.getDay()] += 1;
      }
    }
    // Sum totals per weekday from dateTotals
    dateTotals.forEach((amt, d) => {
      const wd = new Date(d + 'T00:00:00').getDay();
      weekdayTotals[wd] += amt;
    });

    const weekdayAvg = weekdayTotals.map((tot, idx) => {
      const c = countsByWeekday[idx] || 0;
      return c ? Math.round((tot / c) * 100) / 100 : 0;
    });

    // Compose enhanced HTML with stats and chart placeholder
    const html = `
      <div class="rev-newspaper">
        <div class="rev-print-hero">
          <h3 class="rev-headline">Revenue at a Glance</h3>
          <div class="rev-lead">Total paid revenue: <strong>$${fmtMoney(totalRev)}</strong> · This month: <strong>$${fmtMoney(paidMonth)}</strong> · Today: <strong>$${fmtMoney(paidToday)}</strong></div>
        </div>

        <div class="rev-stats-grid">
          <div class="rev-stat-card"><div class="label">Best day</div><div class="value">${bestDay ? `${bestDay.date} · $${fmtMoney(bestDay.amount)}` : '—'}</div></div>
          <div class="rev-stat-card"><div class="label">Worst day</div><div class="value">${worstDay ? `${worstDay.date} · $${fmtMoney(worstDay.amount)}` : '—'}</div></div>
          <div class="rev-stat-card"><div class="label">Most appts in a day</div><div class="value">${mostAppts ? `${mostAppts.count} · ${mostAppts.date}` : '—'}</div></div>
          <div class="rev-stat-card"><div class="label">Highest earning day</div><div class="value">${bestDay ? `${bestDay.date} · $${fmtMoney(bestDay.amount)}` : '—'}</div></div>
          <div class="rev-stat-card"><div class="label">Highest earning week</div><div class="value">${bestWeek ? `${bestWeek.key} · $${fmtMoney(bestWeek.amount)}` : '—'}</div></div>
          <div class="rev-stat-card"><div class="label">Highest earning month</div><div class="value">${bestMonth ? `${bestMonth.key} · $${fmtMoney(bestMonth.amount)}` : '—'}</div></div>
        </div>

        <div class="rev-columns" style="margin-top:12px">
          <div class="rev-column">
            <h4 class="rev-section-title">Weekly Breakdown</h4>

            <div class="rev-panel rev-mini" style="margin:10px 0">
              <h4 class="rev-section-title">Top Services this week</h4>
              <ul class="rev-list">
                ${topServicesWeek.length ? topServicesWeek.map(s => `<li><div style="display:flex;justify-content:space-between"><div>${s[0]}</div><div style="font-weight:700">$${fmtMoney(s[1])}</div></div></li>`).join('') : `<li class="notice">No paid services this week</li>`}
              </ul>
            </div>

            <div class="rev-chart-container">
              <canvas id="revWeekChart"></canvas>
            </div>
            <h4 class="rev-section-title" style="margin-top:12px">Last 7 days</h4>
            <div>
              ${last7.map(l => `
                <div class="rev-day-row">
                  <div class="rev-day-toggle" data-date="${l.iso}" role="button" aria-expanded="false">
                    <div class="rev-day-left"><span class="rev-day-date">${l.date}</span> <span class="rev-day-badge">${l.count}</span></div>
                    <div class="rev-day-right"><span style="font-weight:700">$${fmtMoney(l.amount)}</span>
                      <svg class="rev-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
                    </div>
                  </div>
                  <div class="rev-day-details" id="rev-day-details-${l.iso}"></div>
                </div>
              `).join('')}
            </div>

            <h4 class="rev-section-title">Top Customers</h4>
            <ul class="rev-list">
              ${topCustomers.map(c => `<li><div style="display:flex;justify-content:space-between"><div>${c[0]}</div><div style="font-weight:700">$${fmtMoney(c[1])}</div></div></li>`).join('')}
            </ul>
          </div>
          <aside class="rev-side">
            <div class="rev-panel rev-mini">
              <h4 class="rev-section-title">Top Services</h4>
              <ul class="rev-list">
                ${topServices.length ? topServices.map(s => `<li><div style="display:flex;justify-content:space-between"><div>${s[0]}</div><div style="font-weight:700">$${fmtMoney(s[1])}</div></div></li>`).join('') : `<li class="notice">No paid services</li>`}
              </ul>
            </div>
          </aside>
        </div>
      </div>
    `;

    revModalContent.innerHTML = html;

    // Render weekly-average bar chart (Sun-Sat)
    try {
      const labels = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
      const ctx = document.getElementById('revWeekChart')?.getContext('2d');
      if (ctx) {
        try {
          if (window.revWeekChart && typeof window.revWeekChart.destroy === 'function') {
            window.revWeekChart.destroy();
          } else if (window.revWeekChart && typeof window.revWeekChart.clear === 'function') {
            // older Chart.js instances might expose other cleanup methods
            window.revWeekChart.clear();
          }
        } catch (err) {
          console.warn('Failed to destroy previous revWeekChart instance', err);
        }
        window.revWeekChart = new Chart(ctx, {
          type: 'bar',
          data: { labels, datasets: [{ label: 'Avg revenue', data: weekdayAvg, backgroundColor: 'rgba(59,130,246,0.7)' }] },
          options: { responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false},tooltip:{callbacks:{label:(ctx)=>'$'+(ctx.parsed.y||0).toFixed(2)}}}, scales:{y:{beginAtZero:true,ticks:{callback:v=>'$'+v}}, x:{}} }
        });
      }
    } catch (e) { console.warn('Failed to render week chart', e); }

    revenueModal.classList.remove('hidden');
    revenueModal.setAttribute('aria-hidden', 'false');

    // Populate expandable day details for Last 7 days and wire toggle behavior
    try {
      const users = JSON.parse(localStorage.getItem('xm_users') || '[]');
      const toggles = revModalContent.querySelectorAll('.rev-day-toggle');
      toggles.forEach(t => {
        t.addEventListener('click', (ev) => {
          const date = t.getAttribute('data-date');
          const detailsEl = revModalContent.querySelector('#rev-day-details-' + date);
          if (!detailsEl) return;

          // close any other open details
          const open = revModalContent.querySelector('.rev-day-details.open');
          if (open && open !== detailsEl) {
            open.classList.remove('open');
            open.style.maxHeight = '0';
            open.style.opacity = '0';
            const ot = revModalContent.querySelector('.rev-day-toggle[data-date="' + open.id.replace('rev-day-details-','') + '"]');
            if (ot) { ot.classList.remove('open'); ot.setAttribute('aria-expanded','false'); }
          }

          const isOpen = detailsEl.classList.contains('open');
          if (isOpen) {
            // close
            detailsEl.classList.remove('open');
            detailsEl.style.maxHeight = '0';
            detailsEl.style.opacity = '0';
            t.classList.remove('open');
            t.setAttribute('aria-expanded','false');
          } else {
            // open: build if empty
            const appts = (data.appointments || []).filter(a => ((a.preferred_date || (a.created_at||'').slice(0,10)) || '').slice(0,10) === date);
            if (!appts.length) {
              detailsEl.innerHTML = '<div class="notice">No appointments for this day.</div>';
            } else {
              let out = '<table class="table" style="margin-top:8px"><thead><tr><th>Time</th><th>Customer</th><th>Vehicle</th><th>Service</th><th>Amount</th><th>Status</th><th>Assigned</th></tr></thead><tbody>';
              appts.forEach(a => {
                const apptInv = data.invoices.find(i => i.appointment_id === a.id);
                const invAmount = apptInv ? calcInvTotal(apptInv) : 0;
                const invStatus = apptInv ? apptInv.status : 'open';
                const revColor = invStatus === 'paid' ? '#10b981' : '#ef4444';
                const custLabel = a.customer || 'N/A';
                const time = a.preferred_time ? formatTime12(a.preferred_time) : '';

                // Assigned lookup: find job by appointment id
                const job = (data.jobs || []).find(j => String(j.appointment_id || '') === String(a.id));
                let assignedLabel = 'Unassigned';
                if (job && job.assigned_to) {
                  const u = users.find(x => String(x.id) === String(job.assigned_to));
                  if (u) assignedLabel = (u.first || '') + ' ' + (u.last || '');
                  else assignedLabel = String(job.assigned_to);
                }

                out += `<tr><td>${time}</td><td>${custLabel}</td><td>${a.vehicle||''}</td><td>${a.service||''}</td><td style="font-weight:700;color:${revColor}">$${fmtMoney(invAmount)}</td><td>${badge(a.status)}</td><td>${assignedLabel}</td></tr>`;
              });
              out += '</tbody></table>';
              detailsEl.innerHTML = out;
            }

            // open animation
            detailsEl.classList.add('open');
            t.classList.add('open');
            t.setAttribute('aria-expanded','true');
            // ensure starting from 0 so transition runs
            detailsEl.style.maxHeight = '0';
            detailsEl.style.opacity = '0';
            // next tick, set to scrollHeight
            requestAnimationFrame(() => {
              detailsEl.style.maxHeight = (detailsEl.scrollHeight) + 'px';
              detailsEl.style.opacity = '1';
            });
          }
        });
      });
    } catch (err) {
      console.warn('Failed to wire Last 7 days toggles', err);
    }
  }

  function closeQuickStatsModal() {
    if (!quickModal) return;
    quickModal.classList.add('hidden');
    quickModal.setAttribute('aria-hidden','true');
  }

  function openQuickStatsModal() {
    if (!quickModal || !quickModalContent) return;
    // Appointments today
    const today = new Date().toISOString().slice(0,10);
    const apptsToday = (data.appointments || []).filter(a => ((a.preferred_date || (a.created_at||'').slice(0,10)) || '').slice(0,10) === today);

    // Active jobs: in_progress and awaiting_parts
    const activeJobs = (data.jobs || []).filter(j => ['in_progress','awaiting_parts'].includes(j.status));

    // Open invoices
    const openInv = (data.invoices || []).filter(i => i.status !== 'paid');

    const users = JSON.parse(localStorage.getItem('xm_users') || '[]');

    // Build HTML
    const html = `
      <div class="rev-panel">
        <h4 class="rev-section-title">Appointments Today (${apptsToday.length})</h4>
        ${apptsToday.length ? '<table class="table"><thead><tr><th>Time</th><th>Customer</th><th>Service</th><th>Status</th><th>Assigned</th></tr></thead><tbody>' + apptsToday.map(a => {
          const job = (data.jobs||[]).find(j => String(j.appointment_id||'') === String(a.id));
          let assigned = 'Unassigned';
          if (job && job.assigned_to) {
            const u = users.find(x => String(x.id) === String(job.assigned_to));
            if (u) assigned = (u.first||'') + ' ' + (u.last||''); else assigned = String(job.assigned_to);
          }
          return `<tr><td>${a.preferred_time ? formatTime12(a.preferred_time) : ''}</td><td>${a.customer||''}</td><td>${a.service||''}</td><td>${badge(a.status)}</td><td>${assigned}</td></tr>`;
        }).join('') + '</tbody></table>' : '<div class="notice">No appointments for today.</div>'}
      </div>

      <div class="rev-panel">
        <h4 class="rev-section-title">Active Jobs (In Progress & Awaiting)</h4>
        ${activeJobs.length ? '<ul class="rev-list">' + activeJobs.map(j => {
          const cust = j.customer || (j.customer_first ? `${j.customer_first} ${j.customer_last||''}` : 'N/A');
          const svc = j.service || (j.services && j.services[0] ? (j.services[0].name||j.services[0]) : '');
          return `<li><div style="display:flex;justify-content:space-between"><div><b>${cust}</b><div class="notice">${svc}</div></div><div style="font-weight:700">${badge(j.status)}</div></div></li>`;
        }).join('') + '</ul>' : '<div class="notice">No active jobs</div>'}
      </div>

      <div class="rev-panel">
        <h4 class="rev-section-title">Open Invoices</h4>
        ${openInv.length ? '<ul class="rev-list">' + openInv.map(i => `<li><div style="display:flex;justify-content:space-between"><div>${i.customer||'N/A'}<div class="notice">Due: ${i.due||'—'}</div></div><div style="font-weight:700">$${fmtMoney(calcInvTotal(i))}</div></div></li>`).join('') + '</ul>' : '<div class="notice">No open invoices</div>'}
      </div>
    `;

    quickModalContent.innerHTML = html;
    quickModal.classList.remove('hidden');
    quickModal.setAttribute('aria-hidden','false');
  }

  // Expose to global so inline handlers can call it
  window.openRevenueModal = openRevenueModal;
  window.closeRevenueModal = closeRevenueModal;
  window.openQuickStatsModal = openQuickStatsModal;
  window.closeQuickStatsModal = closeQuickStatsModal;

  if (revModalClose) revModalClose.addEventListener('click', closeRevenueModal);
  if (revenueModal) revenueModal.addEventListener('click', (e) => {
    if (e.target === revenueModal) closeRevenueModal();
  });
  if (quickModalClose) quickModalClose.addEventListener('click', closeQuickStatsModal);
  if (quickModal) quickModal.addEventListener('click', (e) => {
    if (e.target === quickModal) closeQuickStatsModal();
  });

  // Helper: attempt to open a new window and print HTML, fallback to hidden iframe if blocked
  function openAndPrintHtml(html) {
    try {
      const w = window.open('', '_blank', 'noopener,noreferrer');
      if (w) {
        w.document.open();
        w.document.write(html);
        w.document.close();
        setTimeout(() => {
          try { w.focus(); w.print(); } catch (e) { console.warn('Export/Print failed in new window', e); }
        }, 500);
        return;
      }
    } catch (e) {
      console.warn('window.open failed', e);
    }

    // Popup blocked or window.open unavailable — use an off-screen iframe fallback
    try {
      const iframe = document.createElement('iframe');
      iframe.style.position = 'fixed';
      iframe.style.right = '0';
      iframe.style.bottom = '0';
      iframe.style.width = '0';
      iframe.style.height = '0';
      iframe.style.border = '0';
      iframe.style.overflow = 'hidden';
      iframe.setAttribute('aria-hidden', 'true');
      document.body.appendChild(iframe);
      const doc = iframe.contentWindow || iframe.contentDocument;
      const wdoc = iframe.contentWindow.document || iframe.contentDocument;
      wdoc.open();
      wdoc.write(html);
      wdoc.close();
      // Wait for load event to ensure images/styles are applied
      const tryPrint = () => {
        try {
          (iframe.contentWindow || window).focus();
          (iframe.contentWindow || window).print();
        } catch (err) {
          console.warn('Iframe print failed', err);
        } finally {
          setTimeout(() => { try { document.body.removeChild(iframe); } catch (e) {} }, 500);
        }
      };
      // If iframe has onload, use it; otherwise try after a short timeout
      if ('onload' in iframe) {
        iframe.onload = () => { setTimeout(tryPrint, 250); };
      } else {
        setTimeout(tryPrint, 750);
      }
    } catch (err) {
      alert('Unable to open export/print window. Please enable popups or use the browser print (Ctrl/Cmd+P).');
      console.warn('Print fallback failed', err);
    }
  }
  // Print via off-screen iframe (skip window.open) to avoid popup blockers
  function printViaIframe(html) {
    try {
      const iframe = document.createElement('iframe');
      iframe.style.position = 'fixed';
      iframe.style.right = '0';
      iframe.style.bottom = '0';
      iframe.style.width = '0';
      iframe.style.height = '0';
      iframe.style.border = '0';
      iframe.style.overflow = 'hidden';
      iframe.setAttribute('aria-hidden', 'true');
      document.body.appendChild(iframe);
      const wdoc = iframe.contentWindow.document || iframe.contentDocument;
      wdoc.open();
      wdoc.write(html);
      wdoc.close();
      const tryPrint = () => {
        try {
          (iframe.contentWindow || window).focus();
          (iframe.contentWindow || window).print();
        } catch (err) {
          console.warn('Iframe print failed', err);
        } finally {
          setTimeout(() => { try { document.body.removeChild(iframe); } catch (e) {} }, 500);
        }
      };
      if ('onload' in iframe) {
        iframe.onload = () => { setTimeout(tryPrint, 250); };
      } else {
        setTimeout(tryPrint, 750);
      }
    } catch (err) {
      alert('Unable to print. Please use the browser print (Ctrl/Cmd+P).');
      console.warn('Print via iframe failed', err);
    }
  }

  // Export revenue modal content: try client-side PDF generator (no popup), fallback to print
  if (revModalExport) revModalExport.addEventListener('click', () => {
    if (!revModalContent) return;
    // Prefer html2pdf if available (generates a downloadable PDF without the print dialog)
    if (window.html2pdf) {
      try {
        const opt = {
          margin:       10,
          filename:     'revenue-summary.pdf',
          image:        { type: 'jpeg', quality: 0.98 },
          html2canvas:  { scale: 2 },
          jsPDF:        { unit: 'mm', format: 'a4', orientation: 'portrait' }
        };
        html2pdf().set(opt).from(revModalContent).save();
        return;
      } catch (err) {
        console.warn('html2pdf generation failed, falling back to print', err);
      }
    }

    // Fallback: open print-friendly window/iframe
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Revenue Export</title><link rel="stylesheet" href="${location.origin}/styles.css"></head><body>${revModalContent.innerHTML}</body></html>`;
    openAndPrintHtml(html);
  });

  // Print button: use iframe-only print to avoid popup blockers
  if (revModalPrint) revModalPrint.addEventListener('click', () => {
    if (!revModalContent) return;
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Revenue Print</title><link rel="stylesheet" href="${location.origin}/styles.css"></head><body>${revModalContent.innerHTML}</body></html>`;
    printViaIframe(html);
  });

  // AI summary button removed from markup; no client-side handler needed.
  
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') {
      const open = document.querySelector('.day .tooltip.show');
      if (open) {
        open.classList.remove('show');
        open.setAttribute('aria-hidden', 'true');
      }
    }
  });
  
  // Listen for local updates to the shop data (same-tab notifications)
  window.addEventListener('xm_data_updated', async () => {
    try {
      const fresh = await getShopData(shopId);
      data = {
        appointments: fresh.appointments || [],
        jobs: fresh.jobs || [],
        invoices: fresh.invoices || [],
        threads: fresh.threads || [],
        settings: fresh.settings || {}
      };
      kpis();
      renderCal();
      resetDayPanel();
      renderRevenueChart();
      console.log('Dashboard refreshed after xm_data_updated');
    } catch (e) {
      console.warn('Failed to refresh dashboard after xm_data_updated', e);
    }
  });
  
  // Also listen for storage events from other tabs/windows
  window.addEventListener('storage', (e) => {
    try {
      if (e.key === LS.data) {
        const fresh = JSON.parse(e.newValue || '{}');
        data = {
          appointments: fresh.appointments || [],
          jobs: fresh.jobs || [],
          invoices: fresh.invoices || [],
          threads: fresh.threads || [],
          settings: fresh.settings || {}
        };
        kpis();
        renderCal();
        resetDayPanel();
        renderRevenueChart();
        console.log('Dashboard refreshed from storage event');
      }
    } catch (err) {
      console.warn('Failed to handle storage event on dashboard', err);
    }
  });
  
  console.log('✅ Dashboard setup complete');
}

export { setupDashboard };
