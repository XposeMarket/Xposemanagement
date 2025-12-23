
// Modal for invoice actions (mobile) - must be global for row click
window.openInvoiceActionsModal = function(inv) {
  let modal = document.getElementById('invoiceActionsModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'invoiceActionsModal';
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal-content card" style="max-width:340px;margin:18vh auto;">
        <h3>Invoice Actions</h3>
        <div id="invoiceActionsBtns" style="display:flex;flex-direction:column;gap:12px;margin:18px 0;"></div>
        <button class="btn" id="closeInvoiceActions">Close</button>
      </div>
    `;
    document.body.appendChild(modal);
  }
  const btns = modal.querySelector('#invoiceActionsBtns');
  btns.innerHTML = '';
  // Add action buttons (View, Edit, Mark Paid/Unpaid, Remove)
  const viewBtn = document.createElement('button');
  viewBtn.className = 'btn';
  viewBtn.textContent = 'View';
  viewBtn.onclick = () => {
    modal.classList.add('hidden');
    // Route to invoice.html with invoice id
    window.location.href = `invoice.html?id=${encodeURIComponent(inv.id)}`;
  };
  btns.appendChild(viewBtn);
  const editBtn = document.createElement('button');
  editBtn.className = 'btn info';
  editBtn.textContent = 'Edit';
  editBtn.onclick = () => { modal.classList.add('hidden'); window.dispatchEvent(new CustomEvent('xm:invoiceAction', {detail:{action:'edit', invoice: inv}})); };
  btns.appendChild(editBtn);
  if ((inv.status || '').toString().trim().toLowerCase() === 'paid') {
    const markUnpaidBtn = document.createElement('button');
    markUnpaidBtn.className = 'btn';
    markUnpaidBtn.textContent = 'Mark Unpaid';
    markUnpaidBtn.onclick = () => { modal.classList.add('hidden'); window.dispatchEvent(new CustomEvent('xm:invoiceAction', {detail:{action:'markUnpaid', invoice: inv}})); };
    btns.appendChild(markUnpaidBtn);
  } else {
    const checkoutBtn = document.createElement('button');
    checkoutBtn.className = 'btn';
    checkoutBtn.textContent = 'Checkout';
    checkoutBtn.onclick = () => { modal.classList.add('hidden'); window.dispatchEvent(new CustomEvent('xm:invoiceAction', {detail:{action:'checkout', invoice: inv}})); };
    btns.appendChild(checkoutBtn);
  }
  const removeBtn = document.createElement('button');
  removeBtn.className = 'btn danger';
  removeBtn.textContent = 'Remove';
  removeBtn.onclick = () => { modal.classList.add('hidden'); window.dispatchEvent(new CustomEvent('xm:invoiceAction', {detail:{action:'remove', invoice: inv}})); };
  btns.appendChild(removeBtn);
  modal.classList.remove('hidden');
  modal.querySelector('#closeInvoiceActions').onclick = () => modal.classList.add('hidden');
};
/**
 * pages/invoices.js
 * Invoices page setup - FIXED VERSION
 *
 * Imported by: app.js
 * Imports from: helpers/
 */

import { getSupabaseClient } from '../helpers/supabase.js';
import { handleItemDeletion, handleQuantityChange, setupInvoiceInventoryMonitoring, handleInvoiceSave } from '../helpers/invoice-inventory-handler.js';

function setupInvoices() {
  // Helper to map invoice status to tag class for color
  function getInvoiceStatusClass(status) {
    // Normalize and map status to a consistent class name for .tag
    // Accepts different casing like 'Paid', 'PAID', 'paid ' etc.
    const s = (status || '').toString().trim().toLowerCase();
    if (!s) return 'open';
    if (s === 'paid') return 'completed';
    if (s === 'unpaid' || s === 'open') return 'open';
    // replace spaces with underscores so statuses like "in progress" map to in_progress
    return s.replace(/\s+/g, '_');
  }
  // Load invoices from Supabase or localStorage
  const supabase = getSupabaseClient();
  const shopId = getCurrentShopId();
  let invoices = [];
  let appointments = [];
  let users = [];
  let jobs = [];
  let settings = {};
  let currentInvoiceForRemove = null;
  // Sorting state for invoices
  let invoiceSortCol = 'number';
  let invoiceSortDir = 'asc';
  // Confirm modal state
  let currentConfirmInvoice = null;
  let currentConfirmAction = null; // 'paid' or 'unpaid'

  // Handle invoice actions dispatched from the global mobile modal
  window.addEventListener('xm:invoiceAction', async (ev) => {
    const detail = ev && ev.detail ? ev.detail : {};
    const action = detail.action;
    const inv = detail.invoice;
    if (!action || !inv) return;
    try {
      switch (action) {
        case 'view':
          openInvoiceModal(inv);
          break;
        case 'edit':
          openInvoiceModal(inv, true);
          break;
        case 'checkout':
          showTerminalPaymentModal(inv);
          break;
        case 'markPaid':
          await markInvoicePaid(inv);
          break;
        case 'markUnpaid':
          await markInvoiceUnpaid(inv);
          break;
        case 'remove':
          openRemoveModal(inv);
          break;
        default:
          console.warn('[Invoices] Unknown action from modal:', action);
      }
    } catch (e) {
      console.error('[Invoices] xm:invoiceAction handler error:', e);
    }
  });

  // Helper to get shop/session
  function getCurrentShopId() {
    try {
      const session = JSON.parse(localStorage.getItem('xm_session') || '{}');
      return session.shopId || null;
    } catch (e) { return null; }
  }

  // Load data
  async function loadData() {
    console.log('[Invoices] Loading data...');
    if (supabase) {
      const { data, error } = await supabase.from('data').select('invoices,appointments,jobs,settings').eq('shop_id', shopId).single();
      if (error) {
        console.error('[Invoices] Supabase load error:', error);
        return;
      }
      invoices = data?.invoices || [];
      appointments = data?.appointments || [];
      jobs = data?.jobs || [];
      settings = data?.settings || {};
      // Fix customer names in invoices if customer_first looks like a UUID
      try {
        const { data: customers } = await supabase
          .from('customers')
          .select('id, customer_first, customer_last')
          .eq('shop_id', shopId);
        const customerMap = new Map(customers?.map(c => [c.id, c]) || []);
        invoices.forEach(inv => {
          // Only fix customer_first/customer_last if customer_first is a UUID and customer_id is present
          if (
            inv.customer_first && /^[0-9a-f-]{36}$/.test(inv.customer_first) &&
            customerMap.has(inv.customer_first) && inv.customer_id
          ) {
            const cust = customerMap.get(inv.customer_first);
            inv.customer_first = cust.customer_first;
            inv.customer_last = cust.customer_last;
          }
        });
      } catch (e) {
        console.warn('[invoices.js] Could not fix customer names:', e);
      }
      console.log(`[Invoices] Loaded ${invoices.length} invoices, ${appointments.length} appointments, ${jobs.length} jobs`);
    } else {
      const data = JSON.parse(localStorage.getItem('xm_data') || '{}');
      invoices = data.invoices || [];
      appointments = data.appointments || [];
      jobs = data.jobs || [];
      settings = data.settings || {};
      console.log(`[Invoices] Loaded ${invoices.length} invoices, ${appointments.length} appointments, ${jobs.length} jobs from localStorage`);
    }
    users = JSON.parse(localStorage.getItem('xm_users') || '[]');
    console.log(`[Invoices] Loaded ${users.length} users`);
  }

  // Render invoice tables
  function renderInvoices() {
    // Check if we need to auto-open an invoice modal
    const openInvoiceId = localStorage.getItem('openInvoiceId');
    if (openInvoiceId) {
      const inv = invoices.find(i => i.id == openInvoiceId);
      if (inv) {
        openInvoiceModal(inv);
        localStorage.removeItem('openInvoiceId');
      }
    }
    const tb = document.querySelector('#invTable tbody');
    const empty = document.getElementById('invEmpty');
    tb.innerHTML = '';
  let openInvoices = invoices.filter(inv => inv.status !== 'paid');
  // Sort open invoices
  openInvoices = sortInvoicesArray(openInvoices, invoiceSortCol, invoiceSortDir);
    if (!openInvoices.length) {
      empty.textContent = 'No open invoices.';
      return;
    }
    empty.textContent = '';
    openInvoices.forEach(inv => {
      // Try to get customer/info from jobs table if available
      let customer = '';
      // Prefer customer_first/last if present
      if (inv.customer_first || inv.customer_last) {
        customer = `${inv.customer_first || ''} ${inv.customer_last || ''}`.trim();
      } else if (inv.customer_id && window.customers) {
        const cust = window.customers.find(c => c.id === inv.customer_id);
        if (cust) customer = `${cust.customer_first || cust.first_name || ''} ${cust.customer_last || cust.last_name || ''}`.trim();
      }
      // Only use inv.customer if it's NOT a UUID
      if (!customer && inv.customer && !/^[0-9a-f-]{36}$/i.test(inv.customer)) {
        customer = inv.customer;
      }
      // If still no customer name, show placeholder
      if (!customer) customer = 'Unknown Customer';
      console.log(`[Invoices] Rendering invoice ${inv.id}: customer=${customer}`);
      const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>${inv.number || inv.id}</td>
          <td>${customer}</td>
          <td style="font-weight:bold;color:#007bff">$${calcTotal(inv).toFixed(2)}</td>
          <td><span class="tag ${getInvoiceStatusClass(inv.status)}" tabindex="-1">${(inv.status || 'open').replace(/_/g, ' ')}</span></td>
          <td>${inv.due || ''}</td>
          <td style="text-align:right">
            <div class="appt-actions-grid" style="display:inline-grid;">
              <button class="btn small" data-id="${inv.id}" data-action="view">View</button>
              <button class="btn small" data-id="${inv.id}" data-action="checkout">Checkout</button>
              <button class="btn small info" data-id="${inv.id}" data-action="edit">Edit</button>
              <button class="btn small danger" data-id="${inv.id}" data-action="remove" aria-label="Remove invoice"><svg width="14" height="14" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false"><path fill="white" d="M3 6h18v2H3V6zm2 3h14l-1 12a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2l-1-12zM9 4V3a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v1h5v2H4V4h5z"/></svg></button>
            </div>
          </td>
        `;
      // On mobile, make row clickable to open actions modal
      if (window.matchMedia && window.matchMedia('(max-width: 768px)').matches) {
        tr.classList.add('inv-row-clickable');
        tr.addEventListener('click', (e) => {
          if (e.target.closest('button')) return;
          window.openInvoiceActionsModal(inv);
        });
      }
      tb.appendChild(tr);

// ...existing code...
// Move this definition above renderInvoices and renderPrevInvoices so it's always available
    });
  }

  function renderPrevInvoices() {
    const tb = document.querySelector('#prevTable tbody');
    const empty = document.getElementById('prevEmpty');
    tb.innerHTML = '';
  let paidInvoices = invoices.filter(inv => inv.status === 'paid');
  // Sort paid invoices
  paidInvoices = sortInvoicesArray(paidInvoices, invoiceSortCol, invoiceSortDir);
    if (!paidInvoices.length) {
      empty.textContent = 'No paid invoices.';
      return;
    }
    empty.textContent = '';
    paidInvoices.forEach(inv => {
      let customer = '';
      if (inv.customer_first || inv.customer_last) {
        customer = `${inv.customer_first || ''} ${inv.customer_last || ''}`.trim();
      } else if (inv.customer_id && window.customers) {
        const cust = window.customers.find(c => c.id === inv.customer_id);
        if (cust) customer = `${cust.customer_first || cust.first_name || ''} ${cust.customer_last || cust.last_name || ''}`.trim();
      }
      // Only use inv.customer if it's NOT a UUID
      if (!customer && inv.customer && !/^[0-9a-f-]{36}$/i.test(inv.customer)) {
        customer = inv.customer;
      }
      // If still no customer name, show placeholder
      if (!customer) customer = 'Unknown Customer';
      console.log(`[Invoices] Rendering PAID invoice ${inv.id}: customer=${customer}`);
      const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>${inv.number || inv.id}</td>
          <td>${customer}</td>
          <td style="font-weight:bold;color:#007bff">$${calcTotal(inv).toFixed(2)}</td>
          <td><span class="tag ${getInvoiceStatusClass(inv.status)}" tabindex="-1">${(inv.status || 'paid').replace(/_/g, ' ')}</span></td>
          <td>${inv.due || ''}</td>
          <td style="text-align:right">
            <div class="appt-actions-grid" style="display:inline-grid;">
              <button class="btn small info" data-id="${inv.id}" data-action="view">View</button>
              <button class="btn small" data-id="${inv.id}" data-action="markUnpaid">Mark Unpaid</button>
              <button class="btn small danger" data-id="${inv.id}" data-action="remove" aria-label="Remove invoice"><svg width="14" height="14" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false"><path fill="white" d="M3 6h18v2H3V6zm2 3h14l-1 12a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2l-1-12zM9 4V3a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v1h5v2H4V4h5z"/></svg></button>
            </div>
          </td>
        `;
      // Enable mobile modal for paid invoices
      if (window.matchMedia && window.matchMedia('(max-width: 768px)').matches) {
        tr.classList.add('inv-row-clickable');
        tr.addEventListener('click', (e) => {
          if (e.target.closest('button')) return;
          window.openInvoiceActionsModal(inv);
        });
      }
      tb.appendChild(tr);
    });
  }

  // Sort helper for invoices
  function sortInvoicesArray(arr, col, dir) {
    const wrapped = [...arr];
    wrapped.sort((a, b) => {
      const getVal = (inv) => {
        switch (col) {
          case 'number': return parseInt(inv.number) || 0;
          case 'customer': return (inv.customer || '').toLowerCase();
          case 'total': return calcTotal(inv);
          case 'status': return (inv.status || '').toLowerCase();
          case 'due': return (inv.due || '').toLowerCase();
          default: return (inv.number || 0);
        }
      };
      const va = getVal(a);
      const vb = getVal(b);
      if (typeof va === 'number' && typeof vb === 'number') return dir === 'asc' ? va - vb : vb - va;
      if (va < vb) return dir === 'asc' ? -1 : 1;
      if (va > vb) return dir === 'asc' ? 1 : -1;
      return 0;
    });
    return wrapped;
  }

  // Confirm modal helpers
  function openConfirmPayModal(inv, action) {
    currentConfirmInvoice = inv;
    currentConfirmAction = action; // 'paid' or 'unpaid'
    const modal = document.getElementById('confirmPayModal');
    const title = document.getElementById('confirmPayTitle');
    const msg = document.getElementById('confirmPayMessage');
    if (!modal || !title || !msg) return;
    title.textContent = action === 'paid' ? 'Confirm Mark Paid' : 'Confirm Mark Unpaid';
    msg.textContent = action === 'paid' ? `Mark invoice #${inv.number || inv.id} as PAID?` : `Mark invoice #${inv.number || inv.id} as UNPAID?`;
    // Always re-attach handlers when modal is shown
    const confirmBtn = document.getElementById('confirmPayConfirm');
    const cancelBtn = document.getElementById('confirmPayCancel');
    if (confirmBtn) {
      confirmBtn.onclick = async () => {
        if (!currentConfirmInvoice || !currentConfirmAction) { closeConfirmPayModal(); return; }
        try {
          if (currentConfirmAction === 'paid') await markInvoicePaid(currentConfirmInvoice);
          else await markInvoiceUnpaid(currentConfirmInvoice);
        } catch (e) { console.error('Error applying confirmed action:', e); }
        closeConfirmPayModal();
      };
    }
    if (cancelBtn) cancelBtn.onclick = () => closeConfirmPayModal();
    modal.classList.remove('hidden');
  }

  function closeConfirmPayModal() {
    const modal = document.getElementById('confirmPayModal');
    if (modal) modal.classList.add('hidden');
    currentConfirmInvoice = null;
    currentConfirmAction = null;
  }

  // Expose for onclick in markup fallback (safe)
  window.closeConfirmPayModal = closeConfirmPayModal;

  // Calculate invoice total
  function calcTotal(inv) {
    let subtotal = (inv.items || []).reduce((sum, itm) => sum + (itm.qty * itm.price), 0);
    let tax = subtotal * ((inv.tax_rate || 0) / 100);
    let discount = subtotal * ((inv.discount || 0) / 100);
    return subtotal + tax - discount;
  }

  // View invoice modal
  function openInvoiceModal(inv) {
    // Add Parts/Labor/Service quick buttons (top toolbar)
    const addPartEl = document.getElementById('addPart');
    const addLaborEl = document.getElementById('addLabor');
    const addServiceEl = document.getElementById('addService');
    if (addPartEl) addPartEl.onclick = () => { inv.items = inv.items || []; inv.items.push({ name: '', qty: 1, price: '', type: 'part' }); renderItems(inv.items); scrollInvoiceModalToBottom(); };
    if (addLaborEl) addLaborEl.onclick = () => { inv.items = inv.items || []; inv.items.push({ name: '', qty: 1, price: '', type: 'labor' }); renderItems(inv.items); scrollInvoiceModalToBottom(); };
    if (addServiceEl) addServiceEl.onclick = () => { inv.items = inv.items || []; inv.items.push({ name: '', qty: 1, price: '', type: 'service' }); renderItems(inv.items); scrollInvoiceModalToBottom(); };

    const modal = document.getElementById('invModal');
    if (!modal) return;
    modal.classList.remove('hidden');
    document.getElementById('invTitle').textContent = `Invoice #${inv.number || inv.id}`;
    // Prefer job customer if available
    let job = jobs.find(j => j.appointment_id === inv.appointment_id);
    let first = inv.customer_first || '';
    let last = inv.customer_last || '';
    // Try job customer fields
    if ((!first || !last) && job) {
      first = job.customer_first || job.first_name || first;
      last = job.customer_last || job.last_name || last;
    }
    // Try appointment customer fields
    let appt = appointments.find(a => a.id === inv.appointment_id);
    if ((!first || !last) && appt) {
      first = appt.customer_first || appt.first_name || first;
      last = appt.customer_last || appt.last_name || last;
    }
    // Try customer_id lookup
    if ((!first || !last) && inv.customer_id) {
      let customers = window.customers || [];
      let cust = customers.find(c => c.id === inv.customer_id);
      if (cust) {
        first = cust.customer_first || cust.first_name || first;
        last = cust.customer_last || cust.last_name || last;
      }
    }
    // Fallback to any available name fields
    if (!first) first = inv.first_name || inv.customer || '';
    if (!last) last = inv.last_name || '';
    document.getElementById('invCustomerFirst').value = first;
    document.getElementById('invCustomerLast').value = last;
    // Set customer_id if not already set (but don't overwrite customer with the UUID)
    if (!inv.customer_id && inv.customer && /^[0-9a-f-]{36}$/i.test(inv.customer)) {
      inv.customer_id = inv.customer;
    }
    document.getElementById('invAppt').value = inv.appointment_id || '';
    document.getElementById('invTax').value = inv.tax_rate || settings.default_tax_rate || 6;
    document.getElementById('invDisc').value = inv.discount || settings.default_discount || 0;
    document.getElementById('invDue').value = inv.due || '';
    // Render existing items
    renderItems(inv.items || []);
    // Wire the floating + button to show the item type modal
    const floatingAdd = document.getElementById('floatingAdd');
    const itemTypeModal = document.getElementById('itemTypeModal');
    if (floatingAdd && itemTypeModal) {
      floatingAdd.onclick = (e) => { e.preventDefault(); itemTypeModal.classList.remove('hidden'); };
    }
    // Wire the item type modal buttons
    const addPartBtn = document.getElementById('addPartBtn');
    const addLaborBtn = document.getElementById('addLaborBtn');
    const addServiceBtn = document.getElementById('addServiceBtn');
    const cancelItemBtn = document.getElementById('cancelItemBtn');
    if (addPartBtn) addPartBtn.onclick = () => { itemTypeModal.classList.add('hidden'); inv.items = inv.items || []; inv.items.push({ name: '', qty: 1, price: '', type: 'part' }); renderItems(inv.items); scrollInvoiceModalToBottom(); };
    if (addLaborBtn) addLaborBtn.onclick = () => { itemTypeModal.classList.add('hidden'); inv.items = inv.items || []; inv.items.push({ name: '', qty: 1, price: '', type: 'labor' }); renderItems(inv.items); scrollInvoiceModalToBottom(); };
    if (addServiceBtn) addServiceBtn.onclick = () => { itemTypeModal.classList.add('hidden'); inv.items = inv.items || []; inv.items.push({ name: '', qty: 1, price: '', type: 'service' }); renderItems(inv.items); scrollInvoiceModalToBottom(); };
    if (cancelItemBtn) cancelItemBtn.onclick = () => { itemTypeModal.classList.add('hidden'); };
    // Compute subtotal (pre-tax, pre-discount) for platform fee calculation
    const subtotalVal = (inv.items || []).reduce((sum, itm) => sum + ((Number(itm.qty) || 0) * (Number(itm.price) || 0)), 0);
    const taxVal = subtotalVal * ((inv.tax_rate || 0) / 100);
    const discountVal = subtotalVal * ((inv.discount || 0) / 100);
    const totalVal = subtotalVal + taxVal - discountVal;

    document.getElementById('subTotal').textContent = subtotalVal.toFixed(2);
    document.getElementById('grandTotal').textContent = totalVal.toFixed(2);

    // Combined platform fee: Shows total processing fees (Stripe 2.7% + Xpose 2.3% = 5%)
    // Calculated on subtotal only (not on tax portion)
    const combinedFeePercent = 0.05; // 5% total
    const fixedFee = 0.05;
    const platformFee = (subtotalVal * combinedFeePercent) + fixedFee;
    
    // Shop receives: Grand Total - Platform Fee
    const netTotal = totalVal - platformFee;
    const netTotalEl = document.getElementById('netTotal');
    if (netTotalEl) netTotalEl.textContent = netTotal.toFixed(2);
    // Save button
    document.getElementById('saveInv').onclick = () => {
      console.log('[InvoiceModal] Save button clicked', inv);
      saveInvoice(inv);
    };
      // Close button
      document.getElementById('closeInv').onclick = () => {
        document.getElementById('invModal').classList.add('hidden');
      };
      // Setup inventory monitoring for invoice edits (if linked to a job)
      try {
        // expose current job/shop to the inventory handler
        window._currentJobId = job && job.id ? job.id : window._currentJobId || null;
        window._currentShopId = shopId || window._currentShopId || null;
        if (inv.appointment_id) {
          const theJob = jobs.find(j => j.appointment_id === inv.appointment_id);
          if (theJob && theJob.id) {
            setupInvoiceInventoryMonitoring(inv.items || [], theJob.id, shopId);
          }
        }
      } catch (e) {
        console.warn('Could not setup inventory monitoring:', e);
      }
      // Note: generic Add Item button removed; only Parts and Labor are allowed
  }

  // Persist a labor rate from the invoice modal into settings (data table)
  async function addLaborRateFromInvoice(name, rate) {
    if (!name) throw new Error('Name required');
    settings.labor_rates = settings.labor_rates || [];
    if (settings.labor_rates.some(r => r.name === name)) throw new Error('Labor rate exists');

    settings.labor_rates.push({ name, rate });

    // Persist via Supabase or localStorage similar to settings.saveSettings
    try {
      if (supabase) {
        const { data: currentData, error: fetchError } = await supabase
          .from('data')
          .select('*')
          .eq('shop_id', shopId)
          .single();

        if (fetchError && fetchError.code !== 'PGRST116') throw fetchError;

        const payload = {
          shop_id: shopId,
          settings: settings,
          appointments: currentData?.appointments || [],
          jobs: currentData?.jobs || [],
          threads: currentData?.threads || [],
          invoices: currentData?.invoices || [],
          updated_at: new Date().toISOString()
        };

        const { error } = await supabase.from('data').upsert(payload, { onConflict: 'shop_id' });
        if (error) throw error;
      } else {
        const data = JSON.parse(localStorage.getItem('xm_data') || '{}');
        data.settings = settings;
        localStorage.setItem('xm_data', JSON.stringify(data));
      }

      // Update local cache and notify
      try {
        localStorage.setItem('xm_data', JSON.stringify({ ...(JSON.parse(localStorage.getItem('xm_data') || '{}')), settings }));
        window.dispatchEvent(new Event('xm_data_updated'));
      } catch (e) { console.warn('Failed to update local cache after adding labor rate', e); }

      return true;
    } catch (ex) {
      console.error('Error saving labor rate:', ex);
      throw ex;
    }
  }

  // Persist a service preset from the invoice modal into settings (data table)
  async function addServiceFromInvoice(name, price) {
    if (!name) throw new Error('Name required');
    settings.services = settings.services || [];
    if (settings.services.some(s => s.name === name)) throw new Error('Service exists');

    settings.services.push({ name: name, price: price });

    try {
      if (supabase) {
        const { data: currentData, error: fetchError } = await supabase
          .from('data')
          .select('*')
          .eq('shop_id', shopId)
          .single();

        if (fetchError && fetchError.code !== 'PGRST116') throw fetchError;

        const payload = {
          shop_id: shopId,
          settings: settings,
          appointments: currentData?.appointments || [],
          jobs: currentData?.jobs || [],
          threads: currentData?.threads || [],
          invoices: currentData?.invoices || [],
          updated_at: new Date().toISOString()
        };

        const { error } = await supabase.from('data').upsert(payload, { onConflict: 'shop_id' });
        if (error) throw error;
      } else {
        const data = JSON.parse(localStorage.getItem('xm_data') || '{}');
        data.settings = settings;
        localStorage.setItem('xm_data', JSON.stringify(data));
      }

      try {
        localStorage.setItem('xm_data', JSON.stringify({ ...(JSON.parse(localStorage.getItem('xm_data') || '{}')), settings }));
        window.dispatchEvent(new Event('xm_data_updated'));
      } catch (e) { console.warn('Failed to update local cache after adding service', e); }

      return true;
    } catch (ex) {
      console.error('Error saving service:', ex);
      throw ex;
    }
  }

  // Render invoice items
  function renderItems(items) {
    const itemsDiv = document.getElementById('items');
    itemsDiv.innerHTML = '';
    const laborRates = (settings && settings.labor_rates) || [];
    items.forEach((itm, idx) => {
  // Wrap each item in a block so we can show a meta line above and a separator between items
  const block = document.createElement('div');
  block.className = 'inv-item-block';

      const row = document.createElement('div');
      row.className = 'grid cols-3 item-row';
  // temp holder for any initial price we want applied to priceInput (used for custom preset handling)
  let initialPrice;

      // Name / selector
      const nameInput = document.createElement('input');
      nameInput.className = 'itm-name';
      nameInput.value = itm.name || '';
      // Set placeholder based on item type
      if ((itm.type || 'part') === 'part') {
        nameInput.placeholder = 'Part name/description';
      } else if ((itm.type || 'part') === 'labor') {
        nameInput.placeholder = 'Labor name/description';
      } else if ((itm.type || 'part') === 'service') {
        nameInput.placeholder = 'Service name/description';
      } else {
        nameInput.placeholder = 'Name/description';
      }

      // For labor items, provide a select populated from settings.labor_rates
      let laborSelect = null;
      if ((itm.type || 'part') === 'labor') {
        laborSelect = document.createElement('select');
        laborSelect.className = 'itm-labor-select';
  // First placeholder (disabled) so nothing is chosen by default
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.text = '-- select labor --';
  placeholder.disabled = true;
  placeholder.selected = true;
  laborSelect.appendChild(placeholder);
  // Special 'Custom' option that allows free-text entry
  const customOpt = document.createElement('option');
  customOpt.value = '__custom__';
  customOpt.text = 'Custom';
  laborSelect.appendChild(customOpt);
        laborRates.forEach(r => {
          const opt = document.createElement('option');
          opt.value = r.name;
          opt.dataset.rate = r.rate;
          opt.text = `${r.name} - $${r.rate}/hr`;
          laborSelect.appendChild(opt);
        });
        // If item has a name matching a rate, preselect it; if it's a custom name, select 'Custom' and show it
        if (itm.name) {
          const exists = laborRates.some(r => r.name === itm.name);
          if (exists) {
            laborSelect.value = itm.name;
          } else {
            // pre-existing custom labor entry -> select Custom so the UI shows the name input
            laborSelect.value = '__custom__';
            nameInput.value = itm.name;
            initialPrice = itm.price || '';
            // hide the select now so the name input occupies the same place
            laborSelect.style.display = 'none';
            nameInput.style.display = '';
          }
        }
        // If not a custom selection, default the free-text name input to hidden so the select is primary
        if (laborSelect.value !== '__custom__') {
          nameInput.style.display = 'none';
        }
      }

  // Quantity
      const qtyInput = document.createElement('input');
  qtyInput.type = 'number';
  qtyInput.className = 'itm-qty';
  qtyInput.value = (itm.qty !== undefined && itm.qty !== null) ? itm.qty : 1;
  qtyInput.min = 0;
  qtyInput.placeholder = 'Qty';

      // Price (allow blank)
      const priceInput = document.createElement('input');
      priceInput.type = 'number';
      priceInput.step = '0.01';
      priceInput.className = 'itm-price';
      priceInput.value = (itm.price === '' || itm.price === undefined || itm.price === null) ? '' : itm.price;
      priceInput.placeholder = 'Price';
      if (typeof initialPrice !== 'undefined') {
        priceInput.value = initialPrice;
      }

      // Type (hidden) - store item type for save logic but don't show a visible label
  const typeInput = document.createElement('input');
  typeInput.type = 'hidden';
  typeInput.className = 'itm-type';
  typeInput.value = itm.type || 'part';

      // For service items, provide a select populated from settings.services (mirrors labor UI)
      let serviceSelect = null;
      if ((itm.type || 'part') === 'service') {
        serviceSelect = document.createElement('select');
        serviceSelect.className = 'itm-service-select';
        const svcPlaceholder = document.createElement('option');
        svcPlaceholder.value = '';
        svcPlaceholder.text = '-- select service --';
        svcPlaceholder.disabled = true;
        svcPlaceholder.selected = true;
        serviceSelect.appendChild(svcPlaceholder);
        const svcCustomOpt = document.createElement('option');
        svcCustomOpt.value = '__custom__';
        svcCustomOpt.text = 'Custom';
        serviceSelect.appendChild(svcCustomOpt);
        const services = (settings && settings.services) || [];
        services.forEach(s => {
          const opt = document.createElement('option');
          opt.value = s.name;
          opt.dataset.price = s.price;
          opt.text = `${s.name} - $${s.price}`;
          serviceSelect.appendChild(opt);
        });
        // If item name matches preset, preselect it
        if (itm.name) {
          const exists = (settings.services || []).some(s => s.name === itm.name);
          if (exists) {
            serviceSelect.value = itm.name;
            // ensure price/name reflect preset
            const svc = (settings.services || []).find(s => s.name === itm.name);
            priceInput.value = svc ? svc.price : '';
            nameInput.value = svc ? svc.name : itm.name;
            // hide name input since select is primary
            nameInput.style.display = 'none';
          } else {
            // custom
            serviceSelect.value = '__custom__';
            nameInput.value = itm.name;
            priceInput.value = itm.price || '';
            serviceSelect.style.display = 'none';
            nameInput.style.display = '';
          }
        } else {
          // default: hide free-text name until custom selected
          nameInput.style.display = 'none';
        }
      }

  // Determine if this labor row is attached (created via +Add Labor)
  const isAttachedLabor = !!itm._attached;


      // Compose row: for labor/service, show select then name input then qty then price; for parts, show name input then qty then price
      if (laborSelect) {
        row.appendChild(laborSelect);
        row.appendChild(nameInput);
      } else if (serviceSelect) {
        row.appendChild(serviceSelect);
        row.appendChild(nameInput);
      } else row.appendChild(nameInput);
      row.appendChild(qtyInput);
      row.appendChild(priceInput);
      row.appendChild(typeInput);

      const hasAttachedAfter = Array.isArray(items) && items[idx + 1] && items[idx + 1].type === 'labor' && items[idx + 1]._attached;
      // Remove button logic for all item types
      let showRemove = false;
      let useLaborModal = false;
      if ((itm.type === 'part' || !itm.type) && !hasAttachedAfter) {
        showRemove = true;
      } else if (itm.type === 'labor' && itm._attached) {
        showRemove = true;
        useLaborModal = true;
      } else if ((itm.type === 'labor' && !itm._attached) || itm.type === 'service') {
        showRemove = true;
      }
      if (showRemove) {
        const removeBtn = document.createElement('button');
        removeBtn.className = 'btn small danger itm-remove inv-abs-remove';
        removeBtn.dataset.idx = idx;
        removeBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false"><path fill="white" d="M3 6h18v2H3V6zm2 3h14l-1 12a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2l-1-12zM9 4V3a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v1h5v2H4V4h5z"/></svg>`;
        row.style.position = 'relative';
        removeBtn.style.position = 'absolute';
        removeBtn.style.right = '0';
        removeBtn.style.top = '50%';
        removeBtn.style.transform = 'translateY(-50%)';
        row.appendChild(removeBtn);
        if (useLaborModal) {
          removeBtn.addEventListener('click', () => {
            openLaborRemoveChoiceModal(idx, items);
          });
        } else {
          removeBtn.addEventListener('click', () => {
            openConfirmItemRemove(idx, items);
          });
        }
      }
      // Indent attached labor rows
      if (isAttachedLabor) {
        row.style.paddingLeft = '18px';
      }
    // Helper: modal for labor remove choice
    function openLaborRemoveChoiceModal(laborIdx, itemsArr) {
      let modal = document.getElementById('laborRemoveChoiceModal');
      if (!modal) {
        modal = document.createElement('div');
        modal.id = 'laborRemoveChoiceModal';
        modal.className = 'modal-overlay';
        modal.innerHTML = `
          <div class="modal-content card" style="max-width:340px;margin:18vh auto;">
            <h3>Remove Labor or Part + Labor?</h3>
            <div style="margin:18px 0;">
              <button id="removeLaborOnlyBtn" class="btn danger" style="margin-bottom:10px;width:100%;">Remove Labor Only</button>
              <button id="removePartAndLaborBtn" class="btn danger" style="width:100%;">Remove Part + Labor</button>
            </div>
            <button class="btn" id="cancelLaborRemoveChoice">Cancel</button>
          </div>
        `;
        document.body.appendChild(modal);
      }
      modal.classList.remove('hidden');
      // Remove previous listeners
      const newModal = modal.cloneNode(true);
      modal.parentNode.replaceChild(newModal, modal);
      modal = newModal;
      // Wire up buttons
      modal.querySelector('#removeLaborOnlyBtn').onclick = () => {
        itemsArr.splice(laborIdx, 1);
        modal.classList.add('hidden');
        renderItems(itemsArr);
      };
      modal.querySelector('#removePartAndLaborBtn').onclick = () => {
        if (laborIdx > 0 && itemsArr[laborIdx - 1] && itemsArr[laborIdx - 1].type === 'part') {
          itemsArr.splice(laborIdx - 1, 2);
        } else {
          itemsArr.splice(laborIdx, 1);
        }
        modal.classList.add('hidden');
        renderItems(itemsArr);
      };
      modal.querySelector('#cancelLaborRemoveChoice').onclick = () => {
        modal.classList.add('hidden');
      };
    }

      // For part items, add a small '+ Add Labor' pill below the part name input (not in the grid row)
      if ((itm.type || 'part') === 'part') {
        const addLab = document.createElement('button');
        addLab.type = 'button';
        addLab.className = 'add-labor-pill';
        addLab.textContent = '+ Add Labor';
        addLab.style.display = 'block';
        addLab.style.margin = '2px 0 0 0';
        addLab.tabIndex = 0;
        addLab.addEventListener('click', () => {
          const laborItem = { name: '', qty: 1, price: '', type: 'labor', _attached: true };
          items.splice(idx + 1, 0, laborItem);
          items[idx]._hasAttachedLabor = true;
          renderItems(items);
        });
        // Insert the pill just after the name input in the block, but outside the row grid
        setTimeout(() => {
          if (block && nameInput && block.contains(row)) {
            // Insert after the row (so it appears below the grid row)
            block.appendChild(addLab);
          }
        }, 0);
      }

      // (No longer insert the '+ Add Labor' pill between name and qty input fields)

      if (laborSelect) {
        // If preselected and not Custom, populate name/price from the selected rate
        if (laborSelect.value && laborSelect.value !== '__custom__') {
          const rate = laborRates.find(r => r.name === laborSelect.value);
          priceInput.value = rate ? rate.rate : '';
          nameInput.value = rate ? rate.name : laborSelect.value;
        }
      }

      if (serviceSelect) {
        if (serviceSelect.value && serviceSelect.value !== '__custom__') {
          const svc = (settings.services || []).find(s => s.name === serviceSelect.value);
          priceInput.value = svc ? svc.price : '';
          nameInput.value = svc ? svc.name : serviceSelect.value;
        }
      }

        // === Per-item remove confirmation (modal themed) ===
        let __pendingRemoveIndex = null;
        function openConfirmItemRemove(idx, itemsArr) {
          __pendingRemoveIndex = idx;
          const modal = document.getElementById('confirmItemRemoveModal');
          const msg = document.getElementById('confirmItemRemoveMessage');
          const name = (itemsArr && itemsArr[idx] && itemsArr[idx].name) ? itemsArr[idx].name : 'this item';
          if (msg) msg.textContent = `Remove "${name}" from the invoice?`;
          if (modal) modal.classList.remove('hidden');

          const confirmBtn = document.getElementById('confirmItemRemoveConfirm');
          const cancelBtn = document.getElementById('confirmItemRemoveCancel');

          if (confirmBtn) {
              confirmBtn.onclick = async () => {
                try {
                  if (Array.isArray(itemsArr) && __pendingRemoveIndex !== null && itemsArr[__pendingRemoveIndex]) {
                    const targetIdx = __pendingRemoveIndex;
                    const target = itemsArr[targetIdx];

                    // Try to return inventory before removing item
                    try {
                      const jobId = window._currentJobId;
                      const shopId = window._currentShopId;
                      if (jobId && shopId && target) {
                        console.log('🗑️ Deleting item with inventory check:', target);
                        await handleItemDeletion(target, jobId, shopId);
                      }
                    } catch (invError) {
                      console.error('Inventory return error:', invError);
                      if (typeof showNotification === 'function') {
                        showNotification('Warning: Could not return inventory', 'error');
                      }
                    }

                    // Now remove from array (preserve existing removal rules)
                    if (target && target.type === 'part' && itemsArr[targetIdx + 1] && itemsArr[targetIdx + 1].type === 'labor' && itemsArr[targetIdx + 1]._attached) {
                      itemsArr.splice(targetIdx, 2);
                    } else if (target && target.type === 'labor' && target._attached && itemsArr[targetIdx - 1] && itemsArr[targetIdx - 1].type === 'part' && itemsArr[targetIdx - 1]._hasAttachedLabor) {
                      itemsArr.splice(targetIdx - 1, 2);
                    } else {
                      itemsArr.splice(targetIdx, 1);
                    }
                  }
                } catch (e) { console.error('Error removing item', e); }
                // re-render and hide modal
                renderItems(itemsArr || []);
                if (modal) modal.classList.add('hidden');
                __pendingRemoveIndex = null;
              };
          }
          if (cancelBtn) {
            cancelBtn.onclick = () => {
              if (modal) modal.classList.add('hidden');
              __pendingRemoveIndex = null;
            };
          }
        }

        function closeConfirmItemRemoveModal() {
          const modal = document.getElementById('confirmItemRemoveModal');
          if (modal) modal.classList.add('hidden');
          __pendingRemoveIndex = null;
        }
        window.closeConfirmItemRemoveModal = closeConfirmItemRemoveModal;
  // + button to save a custom labor rate to Settings (only shown when placeholder selected)
  const addRateBtn = document.createElement('button');
  addRateBtn.className = 'btn small info';
  addRateBtn.style.display = 'none';
  addRateBtn.textContent = '+';
  addRateBtn.title = 'Save as labor rate';

  // + button to save a custom service preset to Settings (only shown when service Custom selected)
  const addServiceBtnSmall = document.createElement('button');
  addServiceBtnSmall.className = 'btn small info';
  addServiceBtnSmall.style.display = 'none';
  addServiceBtnSmall.textContent = '+';
  addServiceBtnSmall.title = 'Save as service';

      // Show/hide addRateBtn when select changes
      if (laborSelect) {
        // Normalize names by removing leading 'labor' prefixes and trailing price suffixes
        const normalizeName = (n) => {
          if (!n) return '';
          let s = String(n).trim();
          // remove leading 'labor', 'labor -', 'labor:'
          s = s.replace(/^labor\s*[-:\s]*/i, '');
          // remove trailing price like ' - $60/hr' or ' — $60/hr' or ' - $60'
          s = s.replace(/[\s\u2013\u2014-]+\$?\d+(?:[.,]\d+)?(?:\/?hr|\/?h| per hour|\/hour)?\b.*$/i, '');
          return s.trim();
        };

        const updateAddBtn = () => {
          const sel = laborSelect.value;
          const currentRate = parseFloat(priceInput.value);
          const currentName = nameInput.value.trim();
          const normalizedCurrent = normalizeName(currentName);

          // Check if this labor rate matches an existing saved rate (compare normalized names)
          const matchesExistingRate = laborRates.some(r => 
            normalizeName(r.name) === normalizedCurrent && Number(r.rate) === currentRate
          );
          
          // only show the add-rate controls when the user explicitly selects 'Custom' option
          // OR when the rate doesn't match any saved rates (custom rate from jobs page)
          if (sel === '__custom__') {
            // hide the select and reveal the free-text input in the same spot
            laborSelect.style.display = 'none';
            nameInput.style.display = '';
            addRateBtn.style.display = '';
          } else if (!matchesExistingRate && currentName && sel !== '' && sel !== '__custom__') {
            // Labor came from jobs page with custom rate that doesn't match saved rates
            // Keep select visible but show save button
            addRateBtn.style.display = '';
          } else {
            // show the select (presets) and hide the free-text input
            laborSelect.style.display = '';
            nameInput.style.display = 'none';
            addRateBtn.style.display = 'none';
          }
        };
        laborSelect.addEventListener('change', updateAddBtn);
        // Also check on price/name changes in case user modifies values
        priceInput.addEventListener('input', updateAddBtn);
        nameInput.addEventListener('input', updateAddBtn);
        // initial state
        updateAddBtn();
      }

      if (serviceSelect) {
        const updateAddSvcBtn = () => {
          const sel = serviceSelect.value;
          if (sel === '__custom__') {
            serviceSelect.style.display = 'none';
            nameInput.style.display = '';
            addServiceBtnSmall.style.display = '';
          } else {
            serviceSelect.style.display = '';
            nameInput.style.display = 'none';
            addServiceBtnSmall.style.display = 'none';
          }
        };
        serviceSelect.addEventListener('change', updateAddSvcBtn);
        updateAddSvcBtn();
      }

      // change handler: populate name/price for presets; for Custom, allow free input
      if (laborSelect) {
        laborSelect.addEventListener('change', () => {
          const sel = laborSelect.value;
          if (sel === '__custom__') {
            // custom selected - clear name so user can type
            nameInput.value = '';
            priceInput.value = '';
            return;
          }
          const rate = laborRates.find(r => r.name === sel);
          // Ensure we store only the labor name (not the display text with price)
          nameInput.value = rate ? rate.name : sel;
          priceInput.value = rate ? rate.rate : '';
        });
      }

      if (serviceSelect) {
        serviceSelect.addEventListener('change', () => {
          const sel = serviceSelect.value;
          if (sel === '__custom__') {
            nameInput.value = '';
            priceInput.value = '';
            return;
          }
          const svc = (settings.services || []).find(s => s.name === sel);
          nameInput.value = svc ? svc.name : sel;
          priceInput.value = svc ? svc.price : '';
        });
      }

      addRateBtn.addEventListener('click', async () => {
        const newName = (nameInput.value || '').trim();
        const newPrice = parseFloat(priceInput.value) || 0;
        if (!newName) {
          showNotification('Please enter a name for the labor rate', 'error');
          return;
        }
        try {
          await addLaborRateFromInvoice(newName, newPrice);
          // add option to select and select it
          const opt = document.createElement('option');
          opt.value = newName;
          opt.dataset.rate = newPrice;
          opt.text = `${newName} - $${newPrice}/hr`;
          if (laborSelect) laborSelect.appendChild(opt);
          if (laborSelect) {
            laborSelect.style.display = '';
            laborSelect.value = newName;
          }
          nameInput.style.display = 'none';
          addRateBtn.style.display = 'none';
          showNotification('Labor rate saved to Settings');
        } catch (e) {
          console.error('Failed to save labor rate from invoice:', e);
          showNotification('Failed to save labor rate', 'error');
        }
      });

      addServiceBtnSmall.addEventListener('click', async () => {
        const newName = (nameInput.value || '').trim();
        const newPrice = parseFloat(priceInput.value) || 0;
        if (!newName) {
          showNotification('Please enter a name for the service', 'error');
          return;
        }
        try {
          await addServiceFromInvoice(newName, newPrice);
          const opt = document.createElement('option');
          opt.value = newName;
          opt.dataset.price = newPrice;
          opt.text = `${newName} - $${newPrice}`;
          if (serviceSelect) serviceSelect.appendChild(opt);
          if (serviceSelect) {
            serviceSelect.style.display = '';
            serviceSelect.value = newName;
          }
          nameInput.style.display = 'none';
          addServiceBtnSmall.style.display = 'none';
          showNotification('Service saved to Settings');
        } catch (e) {
          console.error('Failed to save service from invoice:', e);
          showNotification('Failed to save service', 'error');
        }
      });

  // append add-rate / add-service small buttons if present (after they're initialized)
  if (laborSelect) row.appendChild(addRateBtn);
  if (serviceSelect) row.appendChild(addServiceBtnSmall);

      // Meta line: show Parts / Labor totals for this item above the row
      const meta = document.createElement('div');
      meta.className = 'inv-item-meta';
      const qty = Number(itm.qty) || Number(qtyInput.value) || 0;
      const price = Number(itm.price) || Number(priceInput.value) || 0;
      const amt = (qty * price) || 0;
      let partsText = '';
      if ((itm.type || '').toLowerCase() === 'part') {
        const qty = Number(itm.qty) || 0;
        const costUnit = Number(itm.cost_price || itm.cost || 0) || 0;
        const costTotal = qty * costUnit;
        if (costTotal > 0) {
          partsText = `Actual Part Price: $${costTotal.toFixed(2)}`;
        } else {
          partsText = `Parts: $${amt.toFixed(2)}`;
        }
      }
      const laborText = (itm.type || '').toLowerCase() === 'labor' ? `Labor: $${amt.toFixed(2)}` : '';
      meta.textContent = [partsText, laborText].filter(Boolean).join(' · ');

      // If no explicit type, but price/qty present, show a small cost summary
      if (!meta.textContent) {
        meta.textContent = `Cost: $${amt.toFixed(2)}`;
      }

      // Build block: meta above, then row
      block.appendChild(meta);
      block.appendChild(row);
      itemsDiv.appendChild(block);
    });
    // add a small spacer so the modal can scroll a bit past the last row
    itemsDiv.style.paddingBottom = '36px';
  }

  // helper: scroll invoice modal body to bottom with small extra offset so last row is visible above floating +
  function scrollInvoiceModalToBottom() {
    const modalBody = document.querySelector('#invModal .modal-body');
    if (!modalBody) return;
    // small delay to allow reflow after render
    setTimeout(() => {
      modalBody.scrollTop = modalBody.scrollHeight - modalBody.clientHeight + 12;
    }, 40);
  }

  // Save invoice (upserts to invoices table)
  async function saveInvoice(inv) {
    console.log('[saveInvoice] called with:', inv);
    // Update invoice fields
    // Always set customer_id from selected customer if available
    // Always require first and last name from modal
    inv.customer_first = document.getElementById('invCustomerFirst').value.trim();
    inv.customer_last = document.getElementById('invCustomerLast').value.trim();
    // Invoice save: customer_first/last validated
    if (!inv.customer_first || !inv.customer_last) {
      showNotification('Customer first and last name are required.', 'error');
      return;
    }
    // Full invoice object serialized for save (omitted debug)
    // If customer_id is not set, try to find by name
    if (!inv.customer_id && window.customers) {
      const match = window.customers.find(c =>
        c.customer_first?.trim().toLowerCase() === inv.customer_first.toLowerCase() &&
        c.customer_last?.trim().toLowerCase() === inv.customer_last.toLowerCase()
      );
      if (match) {
        inv.customer_id = match.id;
        inv.customer = match.id;
      }
    }

  // Backfill script: update all invoices with correct customer IDs
  window.backfillInvoiceCustomerIDs = async function() {
    if (!window.supabase) return;
    const { data: invoices, error: invError } = await window.supabase
      .from('invoices')
      .select('*');
    if (invError) { console.error('Invoice fetch error:', invError); return; }
    const { data: customers, error: custError } = await window.supabase
      .from('customers')
      .select('id,customer_first,customer_last');
    if (custError) { console.error('Customer fetch error:', custError); return; }
    for (const invoice of invoices) {
      if (!invoice.customer_id || !/^[0-9a-fA-F-]{36}$/.test(invoice.customer_id)) {
        // Try to find customer by first/last name
        const match = customers.find(c =>
          c.customer_first?.trim().toLowerCase() === (invoice.customer_first?.trim().toLowerCase() || '') &&
          c.customer_last?.trim().toLowerCase() === (invoice.customer_last?.trim().toLowerCase() || '')
        );
        if (match) {
          const { error: upErr } = await window.supabase
            .from('invoices')
            .update({ customer_id: match.id })
            .eq('id', invoice.id);
          if (upErr) console.error('Backfill error for invoice', invoice.id, upErr);
          else console.log('Backfilled invoice', invoice.id, 'with customer ID', match.id);
        }
      }
    }
    console.log('Backfill complete.');
  };
  inv.appointment_id = document.getElementById('invAppt').value;
  inv.tax_rate = parseFloat(document.getElementById('invTax').value) || settings.default_tax_rate || 6;
  inv.discount = parseFloat(document.getElementById('invDisc').value) || settings.default_discount || 0;
  inv.due = document.getElementById('invDue').value || new Date().toISOString().slice(0,10);
    inv.updated_at = new Date().toISOString();
    
    // Items
    let job = jobs.find(j => j.appointment_id === inv.appointment_id);
    if (job && (!inv.items || inv.items.length === 0)) {
      // If invoice has no items, copy from job
      inv.items = job.items ? JSON.parse(JSON.stringify(job.items)) : [];
    } else {
      // Preserve any existing cost_price values by matching DOM rows to prior invoice items

      const priorItems = Array.isArray(inv.items) ? JSON.parse(JSON.stringify(inv.items)) : [];
      const domRows = Array.from(document.querySelectorAll('#items .grid'));
      const newItems = domRows.map(row => {
        const rawNameEl = row.querySelector('.itm-name');
        const rawSelect = row.querySelector('.itm-labor-select');
        let rawName = '';
        if (rawSelect) {
          if (rawSelect.value && rawSelect.value !== '__custom__') {
            rawName = rawSelect.value;
          } else {
            rawName = rawNameEl ? rawNameEl.value : (rawSelect ? rawSelect.value : '');
          }
        } else {
          rawName = rawNameEl ? rawNameEl.value : '';
        }
        const name = (rawName || '').replace(/\s*-\s*\$\d+(?:\.\d+)?\/hr\s*$/i, '').trim();
        const qtyRaw = row.querySelector('.itm-qty').value;
        const qty = qtyRaw === '' || qtyRaw == null ? undefined : parseFloat(qtyRaw) || 1;
        const priceRaw = row.querySelector('.itm-price').value;
        const price = priceRaw === '' || priceRaw == null ? undefined : parseFloat(priceRaw) || 0;
        const typeEl = row.querySelector('.itm-type');
        const type = typeEl ? (typeEl.value || 'part') : 'part';

        // Try to find a matching prior item to preserve missing values
        let matched = null;
        if (priorItems && priorItems.length) {
          matched = priorItems.find(pi => {
            if ((pi.name || '').toString().trim() === name && (pi.type || 'part') === type) return true;
            if ((pi.name || '').toString().trim() === name) return true;
            return false;
          });
        }

        const item = { name, qty: qty !== undefined ? qty : (matched ? matched.qty : 1), price: price !== undefined ? price : (matched ? matched.price : 0), type };
        if (matched) {
          if (typeof matched.cost_price !== 'undefined') item.cost_price = Number(matched.cost_price);
          else if (typeof matched.cost !== 'undefined') item.cost_price = Number(matched.cost);
          Object.keys(matched).forEach(k => {
            if (!(k in item)) item[k] = matched[k];
          });
        }
        return item;
      });

      // NEW: Handle inventory adjustments BEFORE updating the invoice
      try {
        await handleInvoiceSave(newItems);
      } catch (invError) {
        console.error('❌ Inventory adjustment failed:', invError);
        showNotification(invError.message || 'Inventory adjustment failed', 'error');
        return; // Stop save if inventory adjustment fails
      }

      // Assign computed items back to invoice and update job if present
      inv.items = newItems;
      if (job) job.items = JSON.parse(JSON.stringify(inv.items));
    }

    // --- PATCH: Save vehicle info to invoice if present in modal ---
    const year = document.getElementById('invVehicleYear')?.value || '';
    const make = document.getElementById('invVehicleMake')?.value || '';
    const model = document.getElementById('invVehicleModel')?.value || '';
    let vehicleStr = '';
    if (year && make && model) vehicleStr = `${year} ${make} ${model}`;
    else if (year && make) vehicleStr = `${year} ${make}`;
    else if (make && model) vehicleStr = `${make} ${model}`;
    else if (year) vehicleStr = year;
    else if (make) vehicleStr = make;
    else if (model) vehicleStr = model;
    inv.vehicle = vehicleStr;

    // Customer names already set from modal inputs above - no need to parse

    // Persist customer name to jobs and appointments
    if (inv.appointment_id) {
      // Update appointment
      let appt = appointments.find(a => a.id === inv.appointment_id);
      if (appt && inv.customer && inv.customer !== 'Walk-in') {
        appt.customer = inv.customer;
        appt.customer_first = inv.customer_first;
        appt.customer_last = inv.customer_last;
        console.log(`[Invoices] Updated appointment ${appt.id} with customer: ${inv.customer}`);
      }
      // Update job
      let job = jobs.find(j => j.appointment_id === inv.appointment_id);
      if (job && inv.customer && inv.customer !== 'Walk-in') {
        job.customer = inv.customer;
        job.customer_first = inv.customer_first;
        job.customer_last = inv.customer_last;
        console.log(`[Invoices] Updated job ${job.id} with customer: ${inv.customer}`);
      }
    }

    // Update invoice in global invoices array
    const idx = invoices.findIndex(i => i.id === inv.id);
    if (idx !== -1) {
      invoices[idx] = { ...inv };
      console.log('[saveInvoice] Updated invoice in global array:', invoices[idx]);
    } else {
      invoices.push({ ...inv });
      console.log('[saveInvoice] Added new invoice to global array:', inv);
    }
    // Save to Supabase/localStorage
    if (supabase) {
      // Get current data
      const { data: currentData, error: fetchError } = await supabase
        .from('data')
        .select('*')
        .eq('shop_id', shopId)
        .single();
      
      if (fetchError && fetchError.code !== 'PGRST116') {
        console.error('[Invoices] Supabase fetch error:', fetchError);
        throw fetchError;
      }
      
      // Upsert with invoices, appointments, jobs to data table
      // sanitize internal flags that mark attached labor rows
      const safeInvoices = (invoices || []).map(inv => ({
        ...inv,
        items: (inv.items || []).map(i => {
          const copy = { ...i };
          delete copy._attached;
          delete copy._hasAttachedLabor;
          return copy;
        })
      }));

      const payload = {
        shop_id: shopId,
        invoices: safeInvoices,
        appointments: appointments,
        jobs: jobs,
        settings: currentData?.settings || {},
        threads: currentData?.threads || [],
        updated_at: new Date().toISOString()
      };
      
      const { error } = await supabase.from('data').upsert(payload, { onConflict: 'shop_id' });
      if (error) {
        console.error('[Invoices] Error saving invoice to data table:', error);
        alert('Error saving invoice: ' + error.message);
        return;
      } else {
        console.log('[Invoices] ✅ Saved invoices to data table');
      }
      
      // FIX: Removed the check that was skipping invoices with underscores
      // Also upsert to invoices table
  for (const inv of safeInvoices) {
        const invoicePayload = {
          id: inv.id,
          shop_id: shopId,
          number: inv.number,
          customer_id: inv.customer_id || '',
          customer_first: inv.customer_first || '',
          customer_last: inv.customer_last || '',
          appointment_id: inv.appointment_id || null,
          job_id: inv.job_id || null,
          vehicle: inv.vehicle || '',
          status: typeof inv.status === 'string' ? inv.status : 'open',
          due: inv.due || null,
          tax_rate: inv.tax_rate || 6,
          discount: inv.discount || 0,
          items: inv.items || [],
          paid_date: inv.paid_date || null,
          created_at: inv.created_at || new Date().toISOString(),
          updated_at: new Date().toISOString()
        };
        
        const { error: upsertError } = await supabase
          .from('invoices')
          .upsert(invoicePayload, { onConflict: 'id' });
        
        if (upsertError) {
          console.error('[Invoices] Error upserting invoice to invoices table:', upsertError);
        } else {
          console.log(`[Invoices] ✅ Upserted invoice ${inv.id} to invoices table (status: ${inv.status})`);
        }
      }
    } else {
      const data = JSON.parse(localStorage.getItem('xm_data') || '{}');
      data.invoices = invoices;
      data.appointments = appointments;
      data.jobs = jobs;
      localStorage.setItem('xm_data', JSON.stringify(data));
      console.log('[Invoices] Saved invoices, appointments, jobs to localStorage');
    }
    document.getElementById('invModal').classList.add('hidden');
    renderInvoices();
    renderPrevInvoices();
    showNotification('Invoice saved successfully!');
    console.log('[saveInvoice] Modal closed and UI refreshed.');
  }

  // Mark invoice paid - FIXED to update Supabase
  async function markInvoicePaid(inv) {
    inv.status = 'paid';
    inv.paid_date = new Date().toISOString();
    inv.updated_at = new Date().toISOString();
    
    // Ensure customer field is always the customer ID
    if (inv.customer_id) {
      inv.customer = inv.customer_id;
    }
    // If you want to display the name in the modal, use customer_first/customer_last
    // (Assume inv.customer_first and inv.customer_last are already set correctly elsewhere)
    
    // Save to both data table and invoices table
    if (supabase) {
      // Save to data table
      const { data: currentData, error: fetchError } = await supabase
        .from('data')
        .select('*')
        .eq('shop_id', shopId)
        .single();
      
      if (fetchError && fetchError.code !== 'PGRST116') {
        console.error('[Invoices] Error fetching data:', fetchError);
        return;
      }
      
      const payload = {
        shop_id: shopId,
        invoices: invoices,
        appointments: appointments,
        jobs: jobs,
        settings: currentData?.settings || {},
        threads: currentData?.threads || [],
        updated_at: new Date().toISOString()
      };
      
      await supabase.from('data').upsert(payload, { onConflict: 'shop_id' });
      console.log('[Invoices] ✅ Saved to data table');
      
      // Save to invoices table
      const invoicePayload = {
        id: inv.id,
        shop_id: shopId,
        number: inv.number,
        // customer: inv.customer || '',
        customer_id: inv.customer_id || inv.customer || '',
        customer_first: inv.customer_first,
        customer_last: inv.customer_last,
        appointment_id: inv.appointment_id || null,
        job_id: inv.job_id || null,
        status: 'paid',
        due: inv.due || null,
        tax_rate: inv.tax_rate || 6,
        discount: inv.discount || 0,
        items: inv.items || [],
        paid_date: inv.paid_date,
        created_at: inv.created_at || new Date().toISOString(),
        updated_at: inv.updated_at
      };
      
      const { error: upsertError } = await supabase
        .from('invoices')
        .upsert(invoicePayload);
      
      if (upsertError) {
        console.error('[Invoices] Error updating invoice in invoices table:', upsertError);
      } else {
        console.log(`[Invoices] ✅ Invoice ${inv.id} marked as PAID in invoices table`);
        // Create in-app notifications for shop owners that invoice was paid
        try {
          await createInvoiceNotification(inv, 'paid');
        } catch (nErr) {
          console.error('[Invoices] Notification error (paid):', nErr);
        }
      }
    } else {
      const data = JSON.parse(localStorage.getItem('xm_data') || '{}');
      data.invoices = invoices;
      localStorage.setItem('xm_data', JSON.stringify(data));
    }
    
    await saveInvoice(inv);
    renderInvoices();
    renderPrevInvoices();
    showNotification('Invoice marked as paid!');
  }

  // Mark invoice unpaid - FIXED to update Supabase
  async function markInvoiceUnpaid(inv) {
    inv.status = 'open';
    inv.paid_date = null;
    inv.updated_at = new Date().toISOString();
    
    // Ensure customer field is always the customer ID
    if (inv.customer_id) {
      inv.customer = inv.customer_id;
    }
    // If you want to display the name in the modal, use customer_first/customer_last
    // (Assume inv.customer_first and inv.customer_last are already set correctly elsewhere)
    
    // Save to both data table and invoices table
    if (supabase) {
      // Save to data table
      const { data: currentData, error: fetchError } = await supabase
        .from('data')
        .select('*')
        .eq('shop_id', shopId)
        .single();
      
      if (fetchError && fetchError.code !== 'PGRST116') {
        console.error('[Invoices] Error fetching data:', fetchError);
        return;
      }
      
      const payload = {
        shop_id: shopId,
        invoices: invoices,
        appointments: appointments,
        jobs: jobs,
        settings: currentData?.settings || {},
        threads: currentData?.threads || [],
        updated_at: new Date().toISOString()
      };
      
      await supabase.from('data').upsert(payload, { onConflict: 'shop_id' });
      console.log('[Invoices] ✅ Saved to data table');
      
      // Save to invoices table
      const invoicePayload = {
        id: inv.id,
        shop_id: shopId,
        number: inv.number,
        // customer: inv.customer || '',
        customer_id: inv.customer_id || inv.customer || '',
        customer_first: inv.customer_first,
        customer_last: inv.customer_last,
        appointment_id: inv.appointment_id || null,
        job_id: inv.job_id || null,
        status: 'open',
        due: inv.due || null,
        tax_rate: inv.tax_rate || 6,
        discount: inv.discount || 0,
        items: inv.items || [],
        paid_date: null,
        created_at: inv.created_at || new Date().toISOString(),
        updated_at: inv.updated_at
      };
      
      const { error: upsertError } = await supabase
        .from('invoices')
        .upsert(invoicePayload);
      
      if (upsertError) {
        console.error('[Invoices] Error updating invoice in invoices table:', upsertError);
      } else {
        console.log(`[Invoices] ✅ Invoice ${inv.id} marked as UNPAID in invoices table`);
        // Notify owners that invoice status changed to open/unpaid
        try {
          await createInvoiceNotification(inv, 'open');
        } catch (nErr) {
          console.error('[Invoices] Notification error (open):', nErr);
        }
      }
    } else {
      const data = JSON.parse(localStorage.getItem('xm_data') || '{}');
      data.invoices = invoices;
      localStorage.setItem('xm_data', JSON.stringify(data));
    }
    
    await saveInvoice(inv);
    renderInvoices();
    renderPrevInvoices();
    showNotification('Invoice marked as unpaid!');
  }

  // Open remove invoice modal
  function openRemoveInvModal(inv) {
    currentInvoiceForRemove = inv;
    const modal = document.getElementById('removeInvModal');
    if (!modal) return;
    modal.classList.remove('hidden');
  }

  // Close remove invoice modal
  function closeRemoveInvModal() {
    const modal = document.getElementById('removeInvModal');
    if (modal) modal.classList.add('hidden');
    currentInvoiceForRemove = null;
  }

  // Make it global
  // Create notification entries in Supabase for invoice status changes
  async function createInvoiceNotification(inv, action) {
    try {
      if (!supabase) return;
      // action: 'paid' | 'open' etc.
      const { data: owners, error: ownerErr } = await supabase
        .from('user_shops')
        .select('user_id')
        .eq('shop_id', shopId)
        .eq('role', 'owner');

      if (ownerErr) {
        console.error('[Notifications] Could not fetch owners:', ownerErr);
        return;
      }
      if (!owners || owners.length === 0) return;

      const title = action === 'paid' ? 'Invoice Paid' : 'Invoice Updated';
      // Prefer customer name when available, otherwise fall back to invoice number/id
      const customerName = (inv.customer_first || inv.customer_last)
        ? `${(inv.customer_first || '').trim()} ${(inv.customer_last || '').trim()}`.trim()
        : (inv.customer_name || inv.customer || null);
      const idDisplay = customerName || (inv.number ? `#${inv.number}` : inv.id);
      const message = action === 'paid'
        ? `${idDisplay} was marked as PAID.`
        : `${idDisplay} status changed to ${action}.`;

      // Only set `related_id` if it looks like a UUID; otherwise keep it null and include invoice id/number in metadata
      const looksLikeUUID = (val) => typeof val === 'string' && /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/.test(val);
      const notifications = owners.map(o => ({
        user_id: o.user_id,
        shop_id: shopId,
        type: 'invoice',
        category: action === 'paid' ? 'financial' : 'invoice',
        title,
        message,
        related_id: looksLikeUUID(inv.id) ? inv.id : null,
        related_type: 'invoice',
        metadata: { invoice_id: inv.id, invoice_number: inv.number || null, status: action },
        priority: 'normal',
        created_by: (window.xm_session && window.xm_session.user_id) || null,
        is_read: false,
        created_at: new Date().toISOString()
      }));

      const { error: insertErr } = await supabase.from('notifications').insert(notifications);
      if (insertErr) console.error('[Notifications] Insert error:', insertErr);
      else console.log(`[Notifications] Created ${notifications.length} notification(s) for invoice ${inv.id}`);
    } catch (err) {
      console.error('[Notifications] Exception creating notifications:', err);
    }
  }
  window.closeRemoveInvModal = closeRemoveInvModal;

  // Handle remove invoice
  async function handleRemoveInv(removeAppointment = false) {
    if (!currentInvoiceForRemove) return;
    
    const inv = currentInvoiceForRemove;
    
    // Remove invoice
    invoices = invoices.filter(i => i.id !== inv.id);
    
    if (removeAppointment) {
      // Remove appointment
      appointments = appointments.filter(a => a.id !== inv.appointment_id);
      // Remove from Supabase
      if (supabase && inv.appointment_id) {
        try {
          await supabase
            .from('appointments')
            .delete()
            .eq('id', inv.appointment_id);
          console.log('✅ Appointment deleted from Supabase:', inv.appointment_id);
        } catch (e) {
          console.error('Error deleting appointment from Supabase:', e);
        }
      }
    }
    
    // Save to Supabase/localStorage
    if (supabase) {
      // Get current data
      const { data: currentData, error: fetchError } = await supabase
        .from('data')
        .select('*')
        .eq('shop_id', shopId)
        .single();
      
      if (fetchError && fetchError.code !== 'PGRST116') {
        throw fetchError;
      }
      
      // Upsert with updated invoices, appointments, jobs
      const payload = {
        shop_id: shopId,
        invoices: invoices,
        appointments: appointments,
        jobs: jobs,
        settings: currentData?.settings || {},
        threads: currentData?.threads || [],
        updated_at: new Date().toISOString()
      };
      
      const { error } = await supabase.from('data').upsert(payload, { onConflict: 'shop_id' });
      if (error) alert('Error saving: ' + error.message);
      
      // Also delete from invoices table
      const { error: deleteError } = await supabase
        .from('invoices')
        .delete()
        .eq('id', inv.id);
      
      if (deleteError) {
        console.error('[Invoices] Error deleting from invoices table:', deleteError);
      } else {
        console.log('[Invoices] ✅ Deleted invoice from invoices table');
      }
    } else {
      const data = JSON.parse(localStorage.getItem('xm_data') || '{}');
      data.invoices = invoices;
      data.appointments = appointments;
      data.jobs = jobs;
      localStorage.setItem('xm_data', JSON.stringify(data));
    }
    
    closeRemoveInvModal();
    renderInvoices();
    renderPrevInvoices();
    showNotification('Invoice removed successfully');
  }

  // Show notification
  function showNotification(message, type = 'success') {
    const notification = document.getElementById('notification');
    if (!notification) return;
    
    notification.textContent = message;
    notification.className = 'notification';
    
    if (type === 'error') {
      notification.style.background = '#ef4444';
    } else {
      notification.style.background = '#10b981';
    }
    
    notification.classList.remove('hidden');
    
    setTimeout(() => {
      notification.classList.add('hidden');
    }, 3000);
  }

  // Terminal Payment Modal
  function showTerminalPaymentModal(inv) {
    // Get customer name
    let customerName = 'Unknown Customer';
    if (inv.customer_first || inv.customer_last) {
      customerName = `${inv.customer_first || ''} ${inv.customer_last || ''}`.trim();
    } else if (inv.customer && !/^[0-9a-f-]{36}$/i.test(inv.customer)) {
      customerName = inv.customer;
    }

    // Calculate totals
    const subtotal = (inv.items || []).reduce((sum, itm) => sum + (itm.qty * itm.price), 0);
    const tax = subtotal * ((inv.tax_rate || 0) / 100);
    const discount = subtotal * ((inv.discount || 0) / 100);
    const total = subtotal + tax - discount;

    // Create modal if it doesn't exist
    let modal = document.getElementById('terminal-payment-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'terminal-payment-modal';
      modal.className = 'modal';
      modal.style.display = 'none';
      document.body.appendChild(modal);
    }

    // Build invoice summary with same style as invoice.html
    const itemsHTML = (inv.items || []).map(item => `
      <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #eee;">
        <div>
          <div style="font-weight:500;">${item.name || 'Item'}</div>
          <div style="font-size:12px;color:#666;">Qty: ${item.qty || 1} × ${(item.price || 0).toFixed(2)}</div>
        </div>
        <div style="font-weight:600;">${((item.qty || 1) * (item.price || 0)).toFixed(2)}</div>
      </div>
    `).join('');

    modal.innerHTML = `
      <div class="terminal-modal">
        <div class="terminal-header">
          <h2><i class="fas fa-credit-card"></i> Terminal Checkout</h2>
        </div>
        <div class="terminal-body">
          <div class="invoice-summary">
            <p><strong>Invoice #${inv.number || inv.id}</strong></p>
            <p>Customer: ${customerName}</p>
            <div style="margin:16px 0;">${itemsHTML}</div>
            <div style="display:flex;justify-content:space-between;margin-top:12px;padding-top:12px;border-top:2px solid #ddd;">
              <div>Subtotal:</div>
              <div>${subtotal.toFixed(2)}</div>
            </div>
            ${tax > 0 ? `
            <div style="display:flex;justify-content:space-between;margin-top:4px;">
              <div>Tax (${inv.tax_rate || 0}%):</div>
              <div>${tax.toFixed(2)}</div>
            </div>
            ` : ''}
            ${discount > 0 ? `
            <div style="display:flex;justify-content:space-between;margin-top:4px;">
              <div>Discount (${inv.discount || 0}%):</div>
              <div>-${discount.toFixed(2)}</div>
            </div>
            ` : ''}
            <p class="terminal-amount">Total: <span>${total.toFixed(2)}</span></p>
          </div>
          <div class="terminal-status">
            <div class="status-icon">
              <i class="fas fa-spinner fa-spin"></i>
            </div>
            <p>Initializing terminal...</p>
          </div>
        </div>
        <div class="terminal-footer" style="display:flex;gap:8px;align-items:center;">
          <button class="btn" onclick="document.getElementById('terminal-payment-modal').style.display='none'">Cancel</button>
          <button id="manualCheckoutBtn" class="btn btn-secondary" style="background:#fff;color:#2a7cff;border:1px solid #e0e7ff;">Manual Checkout</button>
        </div>
      </div>
    `;

    modal.style.display = 'flex';

    // Process real terminal payment via server + poll for result
    processTerminalPayment(inv, modal).catch(err => {
      console.error('Terminal payment failed:', err);
      const statusIcon = modal.querySelector('.status-icon');
      const statusText = modal.querySelector('.terminal-status p');
      if (statusIcon) statusIcon.innerHTML = '<i class="fas fa-times-circle" style="color:#ef4444"></i>';

      // Friendly user-facing message (hide technical details)
      let friendly = 'Payment failed. The terminal service is currently unavailable.';
      // If it's likely a network/server HTML response (starts with '<'), give a hint about service
      const raw = (err && err.message) ? err.message.toString() : '';
      // Detect HTML/garbage responses (e.g. server returned an HTML error page)
      if (raw && new RegExp('unexpected token.*<', 'i').test(raw)) {
        friendly = 'Payment failed. The terminal service returned an unexpected response. Please try again or use Manual Checkout.';
      }
      if (statusText) statusText.textContent = friendly;

      // Expose manual checkout button (already in footer) to allow bypassing terminal
      const manualBtn = document.getElementById('manualCheckoutBtn');
      if (manualBtn) {
        manualBtn.style.display = 'inline-block';
        manualBtn.onclick = async () => {
          // Create a themed inline confirmation inside the modal instead of a browser confirm()
          // Remove existing confirm if present
          let existing = modal.querySelector('.manual-confirm');
          if (existing) existing.remove();

          const conf = document.createElement('div');
          conf.className = 'manual-confirm';
          conf.style.cssText = 'margin-top:12px;padding:12px;border-radius:8px;background:#f8fafc;border:1px solid #e6eefc;display:flex;gap:8px;align-items:center;justify-content:space-between;';

          const txt = document.createElement('div');
          txt.textContent = 'Mark this invoice as PAID?';
          txt.style.cssText = 'font-weight:600;color:#111;';

          const controls = document.createElement('div');
          controls.style.cssText = 'display:flex;gap:8px;';

          const btnCancel = document.createElement('button');
          btnCancel.className = 'btn';
          btnCancel.textContent = 'Cancel';
          btnCancel.onclick = () => { try { conf.remove(); } catch(e){} };

          const btnConfirm = document.createElement('button');
          btnConfirm.className = 'btn btn-primary';
          btnConfirm.textContent = 'Mark Paid';
          btnConfirm.onclick = async () => {
            try {
              // show spinner/state
              if (statusIcon) statusIcon.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
              if (statusText) statusText.textContent = 'Marking invoice as paid...';
              // disable buttons while processing
              btnConfirm.disabled = true;
              btnCancel.disabled = true;
              await markInvoicePaid(inv);
              if (statusIcon) statusIcon.innerHTML = '<i class="fas fa-check-circle" style="color:#059669"></i>';
              if (statusText) statusText.textContent = 'Marked as paid (manual).';
              setTimeout(() => { try { modal.style.display = 'none'; } catch(e){} }, 900);
            } catch (mErr) {
              console.error('Manual checkout failed:', mErr);
              // show friendly error inside modal
              if (statusText) statusText.textContent = 'Could not mark invoice as paid. Please try again.';
              btnConfirm.disabled = false;
              btnCancel.disabled = false;
            }
          };

          controls.appendChild(btnCancel);
          controls.appendChild(btnConfirm);
          conf.appendChild(txt);
          conf.appendChild(controls);
          // insert before footer or at end of modal content
          const footer = modal.querySelector('.terminal-footer');
          if (footer) footer.parentNode.insertBefore(conf, footer);
          else modal.appendChild(conf);
        };
      }
    });
  }

  // Create a terminal payment on the server and poll invoice status
  async function processTerminalPayment(inv, modal) {
    if (!inv || !inv.id) throw new Error('Invalid invoice');
    const API_BASE = window.API_URL || 'https://xpose-stripe-server.vercel.app/api';
    const shop = getCurrentShopId();
    const statusIcon = modal.querySelector('.status-icon');
    const statusText = modal.querySelector('.terminal-status p');

    if (statusIcon) statusIcon.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
    if (statusText) statusText.textContent = 'Sending to terminal...';

    // Create payment on server which will trigger terminal processing
    let paymentIntentId = null;
    try {
      const resp = await fetch(API_BASE + '/terminal/create-payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoiceId: inv.id, shopId: shop })
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data && data.error ? data.error : 'Failed to create terminal payment');
      paymentIntentId = data && data.paymentIntent;
    } catch (err) {
      throw new Error('Could not initiate terminal payment: ' + (err.message || err));
    }

    // Poll Supabase invoices table for this invoice to be marked 'paid'
    if (statusText) statusText.textContent = 'Waiting for terminal...';

    const maxAttempts = 30; // ~30 * 2s = 60s
    const intervalMs = 2000;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      // Allow user to cancel the modal which will break out
      if (!modal || modal.style.display === 'none') throw new Error('Payment cancelled');

      try {
        const { data: invoiceRow, error } = await supabase
          .from('invoices')
          .select('status')
          .eq('id', inv.id)
          .single();
        if (!error && invoiceRow && (invoiceRow.status || '').toString().toLowerCase() === 'paid') {
          if (statusIcon) statusIcon.innerHTML = '<i class="fas fa-check-circle text-success"></i>';
          if (statusText) statusText.textContent = 'Payment successful!';
          // Small delay so user sees success then close and refresh
          setTimeout(async () => {
            try { modal.style.display = 'none'; } catch(e){}
            await markInvoicePaid(inv);
          }, 1200);
          return;
        }
      } catch (pollErr) {
        console.warn('Polling invoice status failed:', pollErr);
      }

      // wait
      await new Promise(r => setTimeout(r, intervalMs));
    }

    // If we reach here, timeout
    throw new Error('Timed out waiting for terminal confirmation');
  }

  // Wire up actions
  document.getElementById('invTable').onclick = e => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const inv = invoices.find(i => i.id === btn.dataset.id);
    if (!inv) return;
    if (btn.dataset.action === 'edit') openInvoiceModal(inv);
    if (btn.dataset.action === 'view') {
      // Route to the standalone invoice view page
      try {
        const id = encodeURIComponent(inv.id || inv.number || '');
        if (id) location.href = `invoice.html?id=${id}`;
        else openInvoiceModal(inv);
      } catch (e) {
        console.warn('[Invoices] Failed to navigate to invoice view, opening modal as fallback', e);
        openInvoiceModal(inv);
      }
    }
    if (btn.dataset.action === 'checkout') showTerminalPaymentModal(inv);
    if (btn.dataset.action === 'markPaid') openConfirmPayModal(inv, 'paid');
    if (btn.dataset.action === 'remove') openRemoveInvModal(inv);
  };
  document.getElementById('prevTable').onclick = e => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const inv = invoices.find(i => i.id === btn.dataset.id);
    if (!inv) return;
    if (btn.dataset.action === 'view') {
      try {
        const id = encodeURIComponent(inv.id || inv.number || '');
        if (id) location.href = `invoice.html?id=${id}`;
        else openInvoiceModal(inv);
      } catch (e) {
        console.warn('[Invoices] Failed to navigate to invoice view, opening modal as fallback', e);
        openInvoiceModal(inv);
      }
    }
    if (btn.dataset.action === 'markUnpaid') openConfirmPayModal(inv, 'unpaid');
    if (btn.dataset.action === 'remove') openRemoveInvModal(inv);
  };

  // New invoice button
  document.getElementById('newInvoice').onclick = () => {
    // Always require customer info in modal
    // If no appointment or customer ID, use modal first/last name and assign invoice ID
    const newInv = {
      id: getUUID(),
      number: invoices.length + 1001,
      customer_id: '',
      customer_first: '',
      customer_last: '',
      appointment_id: window.selectedAppointment?.id || '',
      status: 'open',
      due: '',
      tax_rate: 6,
      discount: 0,
      items: [],
      created_at: new Date().toISOString()
    };
    // Always push to invoices array before opening modal, so save logic works for walk-ins
    invoices.push(newInv);
    openInvoiceModal(newInv);
  };

  // Initial load
  loadData().then(() => {
    renderInvoices();
    renderPrevInvoices();
    
    // Event listeners for remove modal
    document.getElementById('removeInvBtn').addEventListener('click', () => handleRemoveInv(false));
    document.getElementById('removeInvApptBtn').addEventListener('click', () => handleRemoveInv(true));
    document.getElementById('cancelRemoveInvBtn').addEventListener('click', closeRemoveInvModal);
    // Wire confirm modal buttons (always re-attach after render)
    function attachConfirmPayModalEvents() {
      const confirmBtn = document.getElementById('confirmPayConfirm');
      const cancelBtn = document.getElementById('confirmPayCancel');
      if (confirmBtn) {
        confirmBtn.onclick = async () => {
          if (!currentConfirmInvoice || !currentConfirmAction) { closeConfirmPayModal(); return; }
          try {
            if (currentConfirmAction === 'paid') await markInvoicePaid(currentConfirmInvoice);
            else await markInvoiceUnpaid(currentConfirmInvoice);
          } catch (e) { console.error('Error applying confirmed action:', e); }
          closeConfirmPayModal();
        };
      }
      if (cancelBtn) cancelBtn.onclick = () => closeConfirmPayModal();
    }
    attachConfirmPayModalEvents();

    // Setup sortable headers for invoices
    document.querySelectorAll('#invTable thead th.sortable, #prevTable thead th.sortable').forEach(th => {
      th.style.cursor = 'pointer';
      th.addEventListener('click', () => {
        const col = th.dataset.col;
        if (!col) return;
        if (invoiceSortCol === col) invoiceSortDir = invoiceSortDir === 'asc' ? 'desc' : 'asc';
        else { invoiceSortCol = col; invoiceSortDir = 'asc'; }
        // Update visual indicators
        document.querySelectorAll('#invTable thead th.sortable, #prevTable thead th.sortable').forEach(h => h.classList.remove('asc','desc'));
        th.classList.add(invoiceSortDir);
        renderInvoices(); renderPrevInvoices();
      });
    });
  });
}

export { setupInvoices };
