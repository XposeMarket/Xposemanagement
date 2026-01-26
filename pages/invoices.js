// Listen for partAdded event to refresh invoice modal UI
window.addEventListener('partAdded', async (e) => {
  // Try to get the jobId from the event, then find the invoice by appointment_id
  const jobId = e.detail && e.detail.jobId;
  if (!jobId) return;
  // Find the job and its appointment
  const job = (window.jobs || []).find(j => j.id === jobId);
  if (!job || !job.appointment_id) return;
  // Find the invoice for this appointment
  const inv = (typeof invoices !== 'undefined' ? invoices : (window.invoices || [])).find(i => i.appointment_id === job.appointment_id);
  if (inv && typeof openInvoiceModal === 'function') {
    openInvoiceModal(inv);
  }
});

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
import { createShopNotification } from '../helpers/shop-notifications.js';

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
  let terminalOptedOut = false;
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
      // Fetch terminal opt-out status
      const { data: shopData } = await supabase
        .from('shops')
        .select('terminal_opted_out')
        .eq('id', shopId)
        .single();

      terminalOptedOut = shopData?.terminal_opted_out || false;
      console.log('[Invoices] Terminal opted out:', terminalOptedOut);

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
        <td>$${calcTotal(inv).toFixed(2)}</td>
  <td><span class="tag ${getInvoiceStatusClass(inv.status)}" tabindex="-1" style="flex:0 0 auto;display:inline-flex">${(inv.status || 'open').replace(/_/g, ' ')}</span></td>
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
        <td>$${calcTotal(inv).toFixed(2)}</td>
        <td><span class="tag ${getInvoiceStatusClass(inv.status)}" tabindex="-1" style="flex:0 0 auto;display:inline-flex">${(inv.status || 'paid').replace(/_/g, ' ')}</span></td>
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
  function calcSubtotal(inv) {
    const items = inv.items || [];
    const countedLabor = new Set();
    return items.reduce((sum, itm) => {
      // Skip service rows that are labor-based or have a linked labor
      if ((itm.type === 'service')) {
        const isExplicitLaborBased = itm.pricing_type === 'labor_based';
        const hasLinkedLabor = items.some(i => i.type === 'labor' && (i.linkedItemId === itm.id || itm.linkedItemId === i.id));
        if (isExplicitLaborBased || hasLinkedLabor) return sum;
      }
      // Deduplicate labor rows that reference the same service or are exact duplicates
      if ((itm.type || '').toLowerCase() === 'labor') {
        const key = itm.linkedItemId || `${(itm.name||'').trim()}|${Number(itm.qty)||0}|${Number(itm.price)||0}`;
        if (countedLabor.has(key)) return sum;
        countedLabor.add(key);
      }
      return sum + ((Number(itm.qty) || 0) * (Number(itm.price) || 0));
    }, 0);
  }

  function calcTotal(inv) {
    const subtotal = calcSubtotal(inv);
    const tax = subtotal * ((inv.tax_rate || 0) / 100);
    const discount = subtotal * ((inv.discount || 0) / 100);
    return subtotal + tax - discount;
  }

  // View invoice modal
  function openInvoiceModal(inv) {
    // Add Parts/Labor/Service quick buttons (top toolbar)
    const addPartEl = document.getElementById('addPart');
    const addLaborEl = document.getElementById('addLabor');
    const addServiceEl = document.getElementById('addService');
    if (addPartEl) addPartEl.onclick = () => {
        const job = (jobs || []).find(j => j.appointment_id === inv.appointment_id) || null;
        const appt = (appointments || []).find(a => a.id === inv.appointment_id) || null;
        const vehicleStr = job ? (job.vehicle || job.vehicle_display || null) : (inv.vehicle || appt?.vehicle || appt?.vehicle_display || null);
        const vehicleObj = job ? { vehicle: job.vehicle || job.vehicle_display || '', jobNumber: job.number || job.job_number || job.jobNo } : { vehicle: inv.vehicle || appt?.vehicle || appt?.vehicle_display || '', jobNumber: null };
      if (window.partPricingModal) {
        window.partPricingModal.show({ manual_entry: true, name: '' }, job ? job.id : null, vehicleObj);
      } else {
        inv.items = inv.items || []; inv.items.push({ name: '', qty: 1, price: '', type: 'part' }); renderItems(inv.items); scrollInvoiceModalToBottom();
      }
    };
    if (addLaborEl) addLaborEl.onclick = () => { inv.items = inv.items || []; inv.items.push({ name: '', qty: 1, price: '', type: 'labor' }); renderItems(inv.items); scrollInvoiceModalToBottom(); };
    if (addServiceEl) addServiceEl.onclick = () => { inv.items = inv.items || []; inv.items.push({ name: '', qty: 1, price: '', type: 'service' }); renderItems(inv.items); scrollInvoiceModalToBottom(); };

    // Hide platform fee description if user opted out of terminal
    const platformFeeDesc = document.getElementById('platformFeeDesc');
    if (platformFeeDesc) {
      platformFeeDesc.style.display = terminalOptedOut ? 'none' : 'block';
    }

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
    // Expose a modal-scoped addPartToInvoice handler so partPricingModal can add parts
    // when no job_id is present (invoice-only flow).
    window.addPartToInvoice = async function(jobIdOrInvoiceId, partName, quantity, sellPrice, costPrice, groupName) {
      try {
        // If a real jobId was provided, we don't handle it here - return null to let caller proceed
        if (jobIdOrInvoiceId) return null;
        // Ensure items array
        inv.items = inv.items || [];
        const item = {
          id: `inv_item_${Date.now()}`,
          name: partName || '',
          qty: quantity || 1,
          price: sellPrice || 0,
          cost_price: costPrice || 0,
          group: groupName || '',
          type: 'part'
        };
        inv.items.push(item);
        // Re-render items in the modal
        try { renderItems(inv.items); } catch (e) { console.warn('Failed to render items after addPartToInvoice', e); }
        // Return a synthetic invoice item id to mimic job invoice flow
        return item.id;
      } catch (e) {
        console.error('addPartToInvoice (invoice modal) failed', e);
        return null;
      }
    };
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
    if (addPartBtn) addPartBtn.onclick = () => {
        const job = (jobs || []).find(j => j.appointment_id === inv.appointment_id) || null;
        const appt = (appointments || []).find(a => a.id === inv.appointment_id) || null;
        const vehicleObj = job ? { vehicle: job.vehicle || job.vehicle_display || '', jobNumber: job.number || job.job_number || job.jobNo } : { vehicle: inv.vehicle || appt?.vehicle || appt?.vehicle_display || '', jobNumber: null };
      itemTypeModal.classList.add('hidden');
      if (window.partPricingModal) {
        window.partPricingModal.show({ manual_entry: true, name: '' }, job ? job.id : null, vehicleObj);
      } else {
        inv.items = inv.items || []; inv.items.push({ name: '', qty: 1, price: '', type: 'part' }); renderItems(inv.items); scrollInvoiceModalToBottom();
      }
    };
    if (addLaborBtn) addLaborBtn.onclick = () => { itemTypeModal.classList.add('hidden'); inv.items = inv.items || []; inv.items.push({ name: '', qty: 1, price: '', type: 'labor' }); renderItems(inv.items); scrollInvoiceModalToBottom(); };
    if (addServiceBtn) addServiceBtn.onclick = () => { itemTypeModal.classList.add('hidden'); inv.items = inv.items || []; inv.items.push({ name: '', qty: 1, price: '', type: 'service' }); renderItems(inv.items); scrollInvoiceModalToBottom(); };
    if (cancelItemBtn) cancelItemBtn.onclick = () => { itemTypeModal.classList.add('hidden'); };
    
    // Calculate subtotal using centralized helper which excludes service rows linked to labor
    const subtotalVal = calcSubtotal(inv);
    const taxRate = inv.tax_rate || 0;
    const taxVal = subtotalVal * (taxRate / 100);
    const discountVal = subtotalVal * ((inv.discount || 0) / 100);
    const totalVal = subtotalVal + taxVal - discountVal;

    document.getElementById('subTotal').textContent = subtotalVal.toFixed(2);
    document.getElementById('grandTotal').textContent = totalVal.toFixed(2);
    
    // Platform fee: 5% of Grand Total + $0.05 fixed fee
    // Only show if user has NOT opted out of terminal
    if (!terminalOptedOut) {
      const platformFeePercent = 0.05; // 5%
      const fixedFee = 0.05; // $0.05
      const platformFee = (totalVal * platformFeePercent) + fixedFee;
      
      // Shop receives: Grand Total - Platform Fee
      const netTotal = totalVal - platformFee;
      const netTotalEl = document.getElementById('netTotal');
      if (netTotalEl) {
        netTotalEl.textContent = netTotal.toFixed(2);
        const netTotalRow = netTotalEl.closest('div');
        if (netTotalRow) netTotalRow.style.display = 'flex';
      }
    } else {
      // User opted out - hide net total calculation
      const netTotalEl = document.getElementById('netTotal');
      if (netTotalEl) {
        const netTotalRow = netTotalEl.closest('div');
        if (netTotalRow) netTotalRow.style.display = 'none';
      }
    }
    
    // Save button
    document.getElementById('saveInv').onclick = () => {
      console.log('[InvoiceModal] Save button clicked', inv);
      saveInvoice(inv);
    };
      // Close button
      document.getElementById('closeInv').onclick = () => {
          document.getElementById('invModal').classList.add('hidden');
          // Cleanup modal-scoped globals
          try { window.addPartToInvoice = null; } catch (e) {}
      };
      
      // Send Estimate button
      // WORKFLOW: 
      // 1. Services/inventory can be added from Jobs or Invoice pages
      // 2. They sit in the invoice with NO estimate_status (not blocking anything)
      // 3. Staff clicks "Send Estimate" → items marked as estimate_status: 'pending'
      // 4. Customer sees pending estimates on kiosk with Approve/Decline buttons
      // 5. Customer approves → estimate_status: 'approved', shows in invoice total
      // 6. Customer declines → item removed from invoice
      // 7. IMPORTANT: estimate_status does NOT block checkout - invoices can be paid regardless
      // 8. This system is ONLY for in-person customers at kiosks
      const sendEstimateBtn = document.getElementById('sendEstimateBtn');
      if (sendEstimateBtn) {
        sendEstimateBtn.onclick = async () => {
          console.log('📋 Send Estimate clicked');
          
          // Only allow sending estimates if invoice has an appointment_id
          const aptId = document.getElementById('invAppt').value;
          console.log('📋 Appointment ID:', aptId);
          
          if (!aptId) {
            showNotification('This invoice must be linked to an appointment to send an estimate', 'warning');
            return;
          }
          
          // First, rebuild items from DOM to get current state
          const priorItems = Array.isArray(inv.items) ? JSON.parse(JSON.stringify(inv.items)) : [];
          const domRows = Array.from(document.querySelectorAll('#items .grid'));
          console.log('📋 DOM rows found:', domRows.length);
          
          const currentItems = domRows.map(row => {
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
            const qty = parseFloat(row.querySelector('.itm-qty')?.value) || 1;
            const priceRaw = row.querySelector('.itm-price')?.value;
            const price = priceRaw === '' ? 0 : parseFloat(priceRaw) || 0;
            const typeEl = row.querySelector('.itm-type');
            const type = typeEl ? (typeEl.value || 'service') : 'service';

            // Find matching prior item for existing estimate_status
            let matched = priorItems.find(pi => (pi.name || '').toString().trim() === name);
            
            const item = { name, qty, price, type };
            if (matched) {
              if (matched.cost_price) item.cost_price = matched.cost_price;
              if (matched.estimate_status) item.estimate_status = matched.estimate_status;
              if (matched.estimate_sent_at) item.estimate_sent_at = matched.estimate_sent_at;
              if (matched.estimate_approved_at) item.estimate_approved_at = matched.estimate_approved_at;
            }
            return item;
          });
          
          console.log('📋 Current items from DOM:', currentItems);
          
          // Filter items - only services and inventory (no parts, no labor)
          // Only send items that don't already have an estimate_status
          const estimateItems = currentItems.filter(item => {
            const itemType = (item.type || '').toLowerCase();
            // Exclude parts and labor
            if (itemType === 'part' || itemType === 'labor') return false;
            // Already has estimate status? Skip
            if (item.estimate_status) return false;
            return true;
          });
          
          console.log('📋 Estimate items to send:', estimateItems);
          
          if (estimateItems.length === 0) {
            console.log('📋 No new estimate items to mark pending — opening send modal to allow resend');
            showNotification('No new services or inventory items to send as estimate — opening send modal', 'info');
            // Update inv.items from DOM so send modal has current data
            inv.items = currentItems;
            inv.appointment_id = aptId;
            // Open the send invoice modal so user can send/resend
            showSendInvoiceModal(inv);
            return;
          }
          
          // Mark items as pending estimate
          estimateItems.forEach(item => {
            item.estimate_status = 'pending';
            item.estimate_sent_at = new Date().toISOString();
          });
          
          console.log(`📤 Sending ${estimateItems.length} item(s) as estimate:`, estimateItems.map(i => ({name: i.name, type: i.type, status: i.estimate_status})));
          
          // Update inv.items with the marked items
          inv.items = currentItems;
          inv.appointment_id = aptId;
          
          // Save invoice directly to database without rebuilding from DOM
          await saveInvoiceDirectly(inv);
          
          // Close the invoice modal
          document.getElementById('invModal').classList.add('hidden');
          
          // NOW: Open the send invoice modal (same as invoice.html)
          showSendInvoiceModal(inv);
        };
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
  // Persist a service preset from the invoice modal into settings (data table)
  // Supports saving labor-based presets by passing opts: { pricing_type: 'labor_based', labor_hours, labor_rate_name, labor_rate }
  async function addServiceFromInvoice(name, price, opts = {}) {
    if (!name) throw new Error('Name required');
    settings.services = settings.services || [];
    if (settings.services.some(s => s.name === name)) throw new Error('Service exists');

    const newService = { name: name };
    if (opts.pricing_type === 'labor_based') {
      newService.pricing_type = 'labor_based';
      newService.labor_hours = Number(opts.labor_hours) || 0;
      newService.labor_rate_name = opts.labor_rate_name || '';
      newService.price = Number(price) || (newService.labor_hours * (opts.labor_rate || 0));
    } else {
      newService.pricing_type = 'flat';
      newService.price = Number(price) || 0;
    }

    settings.services.push(newService);

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
          
          // Handle labor-based vs flat rate services in display
          // ONLY show the service name in the dropdown - not the full formula
          const isLaborBased = s.pricing_type === 'labor_based';
          if (isLaborBased) {
            const rate = laborRates.find(r => r.name === s.labor_rate_name);
            const hourlyRate = rate ? rate.rate : 0;
            const calculatedPrice = (s.labor_hours || 0) * hourlyRate;
            opt.dataset.price = 0; // Service row price is 0 for labor-based - labor row has the price
            opt.dataset.pricingType = 'labor_based';
            opt.dataset.laborHours = s.labor_hours || 0;
            opt.dataset.laborRate = hourlyRate;
            opt.dataset.laborRateName = s.labor_rate_name || '';
            opt.dataset.calculatedPrice = calculatedPrice;
            // Only show service name in dropdown
            opt.text = s.name;
          } else {
            opt.dataset.price = s.price;
            opt.dataset.pricingType = 'flat';
            opt.text = s.name;
          }
          serviceSelect.appendChild(opt);
        });
        // If item name matches preset, preselect it
        if (itm.name) {
          const exists = (settings.services || []).some(s => s.name === itm.name);
          if (exists) {
            serviceSelect.value = itm.name;
            // ensure price/name reflect preset
            const svc = (settings.services || []).find(s => s.name === itm.name);
            // For labor-based services, price should be 0 on service row (labor row has the price)
            const isLaborBased = svc && svc.pricing_type === 'labor_based';
            if (isLaborBased) {
              priceInput.value = 0;
              // Hide price input for labor-based services since the labor row handles pricing
              priceInput.style.display = 'none';
            } else {
              priceInput.value = svc ? svc.price : '';
            }
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

      // Controls container (holds small + buttons) placed inline in the row so buttons sit level with inputs
      const controlsDiv = document.createElement('div');
      controlsDiv.className = 'inv-item-controls';
      controlsDiv.style.display = 'flex';
      controlsDiv.style.gap = '8px';
      controlsDiv.style.flexWrap = 'wrap';
      controlsDiv.style.alignItems = 'center';
      controlsDiv.style.marginLeft = '8px';

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
            confirmBtn.onclick = () => {
              try {
                if (Array.isArray(itemsArr) && __pendingRemoveIndex !== null && itemsArr[__pendingRemoveIndex]) {
                  // If removing a part that has an attached labor row immediately after it, remove both
                  const targetIdx = __pendingRemoveIndex;
                  const target = itemsArr[targetIdx];
                  if (target && target.type === 'part' && itemsArr[targetIdx + 1] && itemsArr[targetIdx + 1].type === 'labor' && itemsArr[targetIdx + 1]._attached) {
                    itemsArr.splice(targetIdx, 2);
                  } else if (target && target.type === 'labor' && target._attached && itemsArr[targetIdx - 1] && itemsArr[targetIdx - 1].type === 'part' && itemsArr[targetIdx - 1]._hasAttachedLabor) {
                    // If removing an attached labor directly (shouldn't normally show a remove button), also remove the parent part
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
        const updateAddBtn = () => {
          const sel = laborSelect.value;
          // only show the add-rate controls when the user explicitly selects the 'Custom' option
          if (sel === '__custom__') {
            // hide the select and reveal the free-text input in the same spot
            laborSelect.style.display = 'none';
            nameInput.style.display = '';
            addRateBtn.style.display = '';
          } else {
            // show the select (presets) and hide the free-text input AND the + button
            laborSelect.style.display = '';
            nameInput.style.display = 'none';
            addRateBtn.style.display = 'none';
          }
        };
        laborSelect.addEventListener('change', updateAddBtn);
        // CRITICAL: Call updateAddBtn AFTER all elements are appended to ensure proper initial state
        // This is deferred to ensure the button display state is set correctly for pre-existing labor rates
        setTimeout(() => updateAddBtn(), 0);
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
            priceInput.style.display = ''; // Show price input for custom services
            return;
          }
          const svc = (settings.services || []).find(s => s.name === sel);
          nameInput.value = svc ? svc.name : sel;
          
          // Check if this is a labor-based service
          const isLaborBased = svc && svc.pricing_type === 'labor_based';
          if (isLaborBased) {
            // Service row price = 0, hide price input
            priceInput.value = 0;
            priceInput.style.display = 'none';
            
            // Auto-add the labor row with the correct hours and rate
            const laborHours = svc.labor_hours || 0;
            const rate = laborRates.find(r => r.name === svc.labor_rate_name);
            const hourlyRate = rate ? rate.rate : 0;
            const laborItem = { 
              name: svc.labor_rate_name || 'Labor', 
              qty: laborHours, 
              price: hourlyRate, 
              type: 'labor', 
              _attached: true,
              pricing_type: 'labor_based'
            };
            // CRITICAL: Update the service item with name and pricing_type BEFORE rendering
            // This ensures the service stays selected in the dropdown after re-render
            items[idx].name = svc.name;
            items[idx].pricing_type = 'labor_based';
            items[idx].price = 0;
            items.splice(idx + 1, 0, laborItem);
            renderItems(items);
          } else {
            priceInput.value = svc ? svc.price : '';
            priceInput.style.display = ''; // Show price input for flat rate services
          }
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
            // ensure the select is visible again and select the new option
            laborSelect.style.display = '';
            laborSelect.value = newName;
          }
          // hide add button and name input now that preset exists
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
          // If this item is a labor-based service, capture labor metadata from adjacent labor row
          let opts = {};
          try {
            const currentItem = items[idx];
            if (currentItem && (currentItem.pricing_type === 'labor_based' || currentItem.pricingType === 'labor_based' || currentItem.type === 'service' && Number(currentItem.price) === 0)) {
              // Look for a linked labor row (next item) or nearby labor item
              const potential = items[idx + 1] || items.find((it, i) => i !== idx && it.linkedItemId === currentItem.id);
              if (potential && (potential.type === 'labor' || potential.name && potential.name.toLowerCase().includes('labor') || potential.pricing_type === 'labor_based')) {
                opts.pricing_type = 'labor_based';
                opts.labor_hours = Number(potential.qty) || Number(potential.labor_hours) || 0;
                opts.labor_rate_name = potential.labor_rate_name || potential.name || '';
                opts.labor_rate = Number(potential.labor_rate) || Number(potential.price) || 0;
              }
            }
          } catch (e) { /* ignore */ }
          await addServiceFromInvoice(newName, newPrice, opts);
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

  // append add-rate / add-service small buttons into the controls container (so they wrap)
  if (laborSelect) controlsDiv.appendChild(addRateBtn);
  if (serviceSelect) controlsDiv.appendChild(addServiceBtnSmall);

  // Insert the controls into the row so they appear level with inputs
  if (controlsDiv.children.length) row.appendChild(controlsDiv);

  // Insert the row into the block
  block.appendChild(row);

      // Meta line: show Parts / Labor totals for this item above the row
      const meta = document.createElement('div');
      meta.className = 'inv-item-meta';
      const qty = Number(itm.qty) || Number(qtyInput.value) || 0;
      // Ensure service rows that are labor-based show price = 0 in the UI
      if ((itm.type === 'service') && itm.pricing_type === 'labor_based') {
        priceInput.value = 0;
        priceInput.style.display = 'none';
      }
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

  // Save invoice directly without rebuilding items from DOM
  // Used for estimate sending where items already have estimate_status set
  async function saveInvoiceDirectly(inv) {
    console.log('[saveInvoiceDirectly] Saving invoice with items:', inv.items?.map(i => ({name: i.name, status: i.estimate_status})));
    
    inv.updated_at = new Date().toISOString();
    
    // Update invoice in global invoices array
    const idx = invoices.findIndex(i => i.id === inv.id);
    if (idx !== -1) {
      invoices[idx] = { ...inv };
    } else {
      invoices.push({ ...inv });
    }
    
    // Save to Supabase
    if (supabase) {
      // Get current data
      const { data: currentData, error: fetchError } = await supabase
        .from('data')
        .select('*')
        .eq('shop_id', shopId)
        .single();
      
      if (fetchError && fetchError.code !== 'PGRST116') {
        console.error('[saveInvoiceDirectly] Supabase fetch error:', fetchError);
        throw fetchError;
      }
      
      // Sanitize internal flags
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
        appointments: currentData?.appointments || [],
        jobs: currentData?.jobs || [],
        settings: currentData?.settings || {},
        threads: currentData?.threads || [],
        updated_at: new Date().toISOString()
      };
      
      const { error } = await supabase.from('data').upsert(payload, { onConflict: 'shop_id' });
      if (error) {
        console.error('[saveInvoiceDirectly] Error saving:', error);
        alert('Error saving invoice: ' + error.message);
        return;
      }
      console.log('[saveInvoiceDirectly] ✅ Saved to data table with estimate_status preserved');
    }
    
    // Refresh UI
    renderTable();
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
      inv.items = domRows.map(row => {
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
        const qty = parseFloat(row.querySelector('.itm-qty').value) || 1;
        const priceRaw = row.querySelector('.itm-price').value;
        const price = priceRaw === '' ? 0 : parseFloat(priceRaw) || 0;
        const typeEl = row.querySelector('.itm-type');
        const type = typeEl ? (typeEl.value || 'part') : 'part';
        // Try to find a matching prior item to preserve cost_price and metadata
        let matched = null;
        if (priorItems && priorItems.length) {
          matched = priorItems.find(pi => {
            if ((pi.name || '').toString().trim() === name && Number(pi.qty || 0) === Number(qty) && Number(pi.price || 0) === Number(price)) return true;
            if ((pi.name || '').toString().trim() === name && Number(pi.price || 0) === Number(price)) return true;
            if ((pi.name || '').toString().trim() === name) return true;
            return false;
          });
        }

        // Detect service preset pricing type from select (if present)
        const svcSelect = row.querySelector('.itm-service-select');
        let detectedPricingType = null;
        let detectedLaborHours = null;
        let detectedLaborRate = null;
        if (svcSelect && svcSelect.selectedOptions && svcSelect.selectedOptions[0]) {
          const opt = svcSelect.selectedOptions[0];
          detectedPricingType = opt.dataset?.pricingType || opt.dataset?.pricing_type || null;
          detectedLaborHours = opt.dataset?.laborHours ? parseFloat(opt.dataset.laborHours) || null : null;
          detectedLaborRate = opt.dataset?.laborRate ? parseFloat(opt.dataset.laborRate) || null : null;
        }

        // Build item while preserving matched metadata when possible
        const item = { name, qty, price, type };
        // Preserve matched id/cost/estimate fields
        if (matched) {
          if (matched.id) item.id = matched.id;
          if (typeof matched.cost_price !== 'undefined') item.cost_price = Number(matched.cost_price);
          else if (typeof matched.cost !== 'undefined') item.cost_price = Number(matched.cost);
          if (matched.estimate_status) item.estimate_status = matched.estimate_status;
          if (matched.estimate_sent_at) item.estimate_sent_at = matched.estimate_sent_at;
          if (matched.estimate_approved_at) item.estimate_approved_at = matched.estimate_approved_at;
          if (matched.pricing_type) item.pricing_type = matched.pricing_type;
          if (matched.linkedItemId) item.linkedItemId = matched.linkedItemId;
        }

        // If the service select indicates a labor-based pricing type, set it explicitly
        if ((type || '').toLowerCase() === 'service' && detectedPricingType === 'labor_based') {
          item.pricing_type = 'labor_based';
          if (detectedLaborHours !== null) item.labor_hours = detectedLaborHours;
          if (detectedLaborRate !== null) item.labor_rate = detectedLaborRate;
          // Ensure service row price remains 0
          item.price = 0;
        }

        // New items: assign id and mark estimates if appropriate
        if (!item.id) item.id = `item_${Date.now()}_${Math.random().toString(36).substr(2,9)}`;
        if (!matched) {
          const itemType = (type || '').toLowerCase();
          if (itemType !== 'part' && itemType !== 'labor') {
            item.estimate_status = 'pending';
            item.estimate_sent_at = new Date().toISOString();
            console.log(`🔔 New service/inventory item "${name}" marked as pending for customer approval`);
          }
        }

        return item;
      });

      // Also update job items if job exists
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
    
    // Create shop-wide notification and show immediate panel notification
    try {
      const authResp = supabase ? await supabase.auth.getUser() : null;
      const authId = authResp?.data?.user?.id || authResp?.user?.id || null;
      const relatedIdVal = (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(inv.id)) ? inv.id : null;
      const customerName = `${inv.customer_first || ''} ${inv.customer_last || ''}`.trim() || inv.customer || 'Customer';
      await createShopNotification({
        supabase: supabase,
        shopId,
        type: 'invoice_paid',
        category: 'invoice',
        title: `${customerName} — Invoice Paid`,
        message: `Invoice #${inv.number || inv.id} for ${customerName} was marked as paid.`,
        relatedId: relatedIdVal,
        relatedType: 'invoice',
        metadata: {
          invoice_number: inv.number || inv.id,
          customer: `${inv.customer_first || ''} ${inv.customer_last || ''}`.trim(),
          amount: calcTotal(inv)
        },
        priority: 'normal',
        createdBy: authId
      });
      if (window.addNotificationToPanel) {
        window.addNotificationToPanel({ type: 'info', message: `${customerName} — Invoice marked as paid`, data: { invoiceId: inv.id } });
      }
    } catch (e) {
      console.warn('[Invoices] createShopNotification failed:', e);
    }

    // Show send invoice modal after marking as paid
    showSendInvoiceModal(inv);
  }

  // ============================================
  // SEND INVOICE VIA EMAIL/SMS
  // ============================================
  
  // Store current invoice for send modal
  let currentSendInvoice = null;

  // Show send invoice modal after checkout
  async function showSendInvoiceModal(inv) {
    currentSendInvoice = inv;
    const modal = document.getElementById('sendInvoiceModal');
    if (!modal) return;

    // Update invoice number display
    const invNumberEl = document.getElementById('sendInvNumber');
    if (invNumberEl) invNumberEl.textContent = inv.number || inv.id;

    // Try to get customer contact info
    let customerEmail = '';
    let customerPhone = '';
    let customerName = '';

    // Build customer name
    if (inv.customer_first || inv.customer_last) {
      customerName = `${inv.customer_first || ''} ${inv.customer_last || ''}`.trim();
    }

    // Try to look up customer email/phone from customers table
    if (supabase && inv.customer_id) {
      try {
        const { data: customer } = await supabase
          .from('customers')
          .select('email, phone, customer_first, customer_last')
          .eq('id', inv.customer_id)
          .single();
        
        if (customer) {
          customerEmail = customer.email || '';
          customerPhone = customer.phone || '';
          if (!customerName && (customer.customer_first || customer.customer_last)) {
            customerName = `${customer.customer_first || ''} ${customer.customer_last || ''}`.trim();
          }
        }
      } catch (e) {
        console.warn('[SendInvoice] Could not fetch customer:', e);
      }
    }

    // Also try to get contact from appointment/job
    if (!customerEmail || !customerPhone) {
      if (inv.appointment_id) {
        const appt = appointments.find(a => a.id === inv.appointment_id);
        if (appt) {
          if (!customerEmail && appt.email) customerEmail = appt.email;
          if (!customerPhone && appt.phone) customerPhone = appt.phone;
        }
      }
    }

    // Update UI
    const emailCheckbox = document.getElementById('sendEmailCheckbox');
    const smsCheckbox = document.getElementById('sendSmsCheckbox');
    const emailAddressEl = document.getElementById('sendEmailAddress');
    const smsPhoneEl = document.getElementById('sendSmsPhone');
    const noContactEl = document.getElementById('sendInvoiceNoContact');
    const statusEl = document.getElementById('sendInvoiceStatus');
    const sendBtn = document.getElementById('sendInvBtn');

    // Reset status
    if (statusEl) {
      statusEl.style.display = 'none';
      statusEl.innerHTML = '';
    }

    // Email option
    if (customerEmail) {
      if (emailCheckbox) emailCheckbox.disabled = false;
      if (emailCheckbox) emailCheckbox.checked = true;
      if (emailAddressEl) emailAddressEl.textContent = customerEmail;
    } else {
      if (emailCheckbox) emailCheckbox.disabled = true;
      if (emailCheckbox) emailCheckbox.checked = false;
      if (emailAddressEl) emailAddressEl.textContent = 'No email on file';
    }

    // SMS option
    if (customerPhone) {
      if (smsCheckbox) smsCheckbox.disabled = false;
      if (smsCheckbox) smsCheckbox.checked = true;
      if (smsPhoneEl) smsPhoneEl.textContent = customerPhone;
    } else {
      if (smsCheckbox) smsCheckbox.disabled = true;
      if (smsCheckbox) smsCheckbox.checked = false;
      if (smsPhoneEl) smsPhoneEl.textContent = 'No phone on file';
    }

    // Show warning if no contact info
    if (!customerEmail && !customerPhone) {
      if (noContactEl) noContactEl.style.display = 'block';
      if (sendBtn) sendBtn.disabled = true;
    } else {
      if (noContactEl) noContactEl.style.display = 'none';
      if (sendBtn) sendBtn.disabled = false;
    }

    // Store contact info for sending
    modal.dataset.email = customerEmail;
    modal.dataset.phone = customerPhone;
    modal.dataset.customerName = customerName;

    // Wire up send button
    if (sendBtn) {
      sendBtn.onclick = () => sendInvoiceToCustomer();
    }

    // Show modal
    modal.classList.remove('hidden');
  }

  // Close send invoice modal
  window.closeSendInvoiceModal = function() {
    const modal = document.getElementById('sendInvoiceModal');
    if (modal) modal.classList.add('hidden');
    currentSendInvoice = null;
  };

  // Send invoice via API
  async function sendInvoiceToCustomer() {
    if (!currentSendInvoice) return;

    const modal = document.getElementById('sendInvoiceModal');
    const sendBtn = document.getElementById('sendInvBtn');
    const statusEl = document.getElementById('sendInvoiceStatus');
    const emailCheckbox = document.getElementById('sendEmailCheckbox');
    const smsCheckbox = document.getElementById('sendSmsCheckbox');

    const sendEmail = emailCheckbox?.checked && !emailCheckbox?.disabled;
    const sendSms = smsCheckbox?.checked && !smsCheckbox?.disabled;

    if (!sendEmail && !sendSms) {
      if (statusEl) {
        statusEl.style.display = 'block';
        statusEl.style.background = '#fef3c7';
        statusEl.style.color = '#92400e';
        statusEl.innerHTML = 'Please select at least one delivery method.';
      }
      return;
    }

    // Show loading state
    if (sendBtn) {
      sendBtn.disabled = true;
      sendBtn.textContent = 'Sending...';
    }
    if (statusEl) {
      statusEl.style.display = 'block';
      statusEl.style.background = '#e0f2fe';
      statusEl.style.color = '#0369a1';
      statusEl.innerHTML = '⏳ Sending invoice...';
    }

    try {
      // Always use Vercel server for send-invoice (has Twilio/Resend credentials)
      // Same pattern as messages-backend.js
      const API_URL = 'https://xpose-stripe-server.vercel.app';
      
      const response = await fetch(`${API_URL}/api/send-invoice`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          invoiceId: currentSendInvoice.id,
          shopId: shopId,
          sendEmail,
          sendSms,
          customerEmail: modal.dataset.email || null,
          customerPhone: modal.dataset.phone || null,
          customerName: modal.dataset.customerName || 'Customer'
        })
      });

      const result = await response.json();

      if (result.success) {
        if (statusEl) {
          statusEl.style.background = '#d1fae5';
          statusEl.style.color = '#065f46';
          let msg = '✅ Invoice sent successfully!';
          if (result.results?.email?.success && result.results?.sms?.success) {
            msg = '✅ Invoice sent via email and SMS!';
          } else if (result.results?.email?.success) {
            msg = '✅ Invoice sent via email!';
          } else if (result.results?.sms?.success) {
            msg = '✅ Invoice sent via SMS!';
          }
          statusEl.innerHTML = msg;
        }
        // Auto-close after success
        setTimeout(() => {
          closeSendInvoiceModal();
        }, 2000);
      } else {
        // Partial success or failure
        if (statusEl) {
          statusEl.style.background = '#fef3c7';
          statusEl.style.color = '#92400e';
          let msg = '⚠️ ';
          if (result.results?.email && !result.results.email.success) {
            msg += `Email failed: ${result.results.email.error}. `;
          }
          if (result.results?.sms && !result.results.sms.success) {
            msg += `SMS failed: ${result.results.sms.error}. `;
          }
          statusEl.innerHTML = msg || 'Failed to send invoice.';
        }
      }
    } catch (error) {
      console.error('[SendInvoice] Error:', error);
      if (statusEl) {
        statusEl.style.background = '#fee2e2';
        statusEl.style.color = '#991b1b';
        statusEl.innerHTML = `❌ Error: ${error.message || 'Failed to send invoice'}`;
      }
    } finally {
      if (sendBtn) {
        sendBtn.disabled = false;
        sendBtn.textContent = 'Send Invoice';
      }
    }
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

    // Create shop-wide notification and show immediate panel notification for reopened invoice
    try {
      const authResp = supabase ? await supabase.auth.getUser() : null;
      const authId = authResp?.data?.user?.id || authResp?.user?.id || null;
      const relatedIdVal = (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(inv.id)) ? inv.id : null;
      const customerName = `${inv.customer_first || ''} ${inv.customer_last || ''}`.trim() || inv.customer || 'Customer';
      await createShopNotification({
        supabase: supabase,
        shopId,
        type: 'invoice_reopened',
        category: 'invoice',
        title: `${customerName} — Invoice Reopened`,
        message: `Invoice #${inv.number || inv.id} for ${customerName} was reopened/marked unpaid.`,
        relatedId: relatedIdVal,
        relatedType: 'invoice',
        metadata: {
          invoice_number: inv.number || inv.id,
          customer: `${inv.customer_first || ''} ${inv.customer_last || ''}`.trim(),
          amount: calcTotal(inv)
        },
        priority: 'normal',
        createdBy: authId
      });
      if (window.addNotificationToPanel) {
        window.addNotificationToPanel({ type: 'warning', message: `${customerName} — Invoice reopened`, data: { invoiceId: inv.id } });
      }
    } catch (e) {
      console.warn('[Invoices] createShopNotification failed:', e);
    }
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

  // Terminal Payment Modal - with multi-terminal selection support
  async function showTerminalPaymentModal(inv, selectedTerminalId = null) {
    // If no terminal selected yet, check if shop has multiple terminals
    if (!selectedTerminalId && supabase) {
      try {
        const { data: terminals, error } = await supabase
          .from('shop_terminals')
          .select('id, terminal_id, label, model, status')
          .eq('shop_id', shopId)
          .eq('status', 'online');
        
        if (!error && terminals && terminals.length > 1) {
          // Multiple terminals - show selection modal first
          showTerminalSelectionModal(inv, terminals);
          return;
        } else if (!error && terminals && terminals.length === 1) {
          // Single terminal - use it directly
          selectedTerminalId = terminals[0].terminal_id;
        }
      } catch (e) {
        console.warn('[Invoices] Could not fetch terminals:', e);
      }
    }

    // Get customer name
    let customerName = 'Unknown Customer';
    if (inv.customer_first || inv.customer_last) {
      customerName = `${inv.customer_first || ''} ${inv.customer_last || ''}`.trim();
    } else if (inv.customer && !/^[0-9a-f-]{36}$/i.test(inv.customer)) {
      customerName = inv.customer;
    }

    // Calculate totals (use calcSubtotal to avoid double-counting labor-based services)
    const subtotal = calcSubtotal(inv);
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
      <div class="checkout-item" style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--line, #eee);">
        <div>
          <div style="font-weight:500;color:var(--text);">${item.name || 'Item'}</div>
          <div style="font-size:12px;color:var(--muted, #666);">Qty: ${item.qty || 1} × ${(item.price || 0).toFixed(2)}</div>
        </div>
        <div style="font-weight:600;color:var(--text);">${((item.qty || 1) * (item.price || 0)).toFixed(2)}</div>
      </div>
    `).join('');

    modal.innerHTML = `
      <div class="terminal-modal">
        <div class="terminal-header">
          <h2><i class="fas fa-credit-card"></i> Terminal Checkout</h2>
        </div>
        <div class="terminal-body">
          <div class="invoice-summary">
            <p style="color:var(--text);"><strong>Invoice #${inv.number || inv.id}</strong></p>
            <p style="color:var(--text);">Customer: ${customerName}</p>
            <div style="margin:16px 0;">${itemsHTML}</div>
            <div style="display:flex;justify-content:space-between;margin-top:12px;padding-top:12px;border-top:2px solid var(--line, #ddd);color:var(--muted);">
              <div>Subtotal:</div>
              <div>${subtotal.toFixed(2)}</div>
            </div>
            ${tax > 0 ? `
            <div style="display:flex;justify-content:space-between;margin-top:4px;color:var(--muted);">
              <div>Tax (${inv.tax_rate || 0}%):</div>
              <div>${tax.toFixed(2)}</div>
            </div>
            ` : ''}
            ${discount > 0 ? `
            <div style="display:flex;justify-content:space-between;margin-top:4px;color:var(--muted);">
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
        <div class="terminal-footer">
          <button class="btn" id="manual-mark-paid-btn">Mark Paid Manually</button>
          <button class="btn" onclick="document.getElementById('terminal-payment-modal').style.display='none'">Cancel</button>
        </div>
      </div>
    `;

    modal.style.display = 'flex';

    // Add manual mark paid handler
    const manualBtn = modal.querySelector('#manual-mark-paid-btn');
    manualBtn.onclick = async () => {
      modal.style.display = 'none';
      await markInvoicePaid(inv);
    };

    // Simulate terminal checkout process (check if terminal is available)
    setTimeout(() => {
      const statusIcon = modal.querySelector('.status-icon');
      const statusText = modal.querySelector('.terminal-status p');
      
      // Check if shop has terminal
      const shopInfo = window.getShopInfo ? window.getShopInfo() : null;
      const hasTerminal = selectedTerminalId || (shopInfo && shopInfo.terminal_id);
      
      if (!hasTerminal) {
        statusIcon.innerHTML = '<i class="fas fa-info-circle" style="color:#ff9800;"></i>';
        statusText.textContent = 'No terminal connected. Use manual payment option below.';
        return;
      }
      
      statusIcon.innerHTML = '<i class="fas fa-check-circle text-success"></i>';
      statusText.textContent = 'Payment successful!';
      
      // Auto-close after 2 seconds and mark invoice as paid
      setTimeout(async () => {
        modal.style.display = 'none';
        await markInvoicePaid(inv);
      }, 2000);
    }, 2000);
  }

  // Terminal Selection Modal - shown when shop has multiple terminals
  function showTerminalSelectionModal(inv, terminals) {
    // Create or get the terminal selection modal
    let modal = document.getElementById('terminal-selection-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'terminal-selection-modal';
      modal.className = 'modal-overlay';
      document.body.appendChild(modal);
    }

    // Calculate total for display (use calcSubtotal to avoid double-counting labor-based services)
    const subtotal = calcSubtotal(inv);
    const tax = subtotal * ((inv.tax_rate || 0) / 100);
    const discount = subtotal * ((inv.discount || 0) / 100);
    const total = subtotal + tax - discount;

    // Build terminal options
    const terminalOptionsHTML = terminals.map(term => {
      const label = term.label || term.model || 'Terminal';
      const statusColor = term.status === 'online' ? '#10b981' : '#ef4444';
      const statusText = term.status === 'online' ? 'Online' : 'Offline';
      return `
        <button class="terminal-option-btn" data-terminal-id="${term.terminal_id}" style="
          display: flex;
          align-items: center;
          justify-content: space-between;
          width: 100%;
          padding: 16px;
          margin-bottom: 12px;
          background: var(--card, #fff);
          border: 2px solid var(--line, #e5e7eb);
          border-radius: 10px;
          cursor: pointer;
          transition: all 0.2s ease;
        ">
          <div style="display:flex;align-items:center;gap:12px;">
            <div style="width:48px;height:48px;background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);border-radius:8px;display:flex;align-items:center;justify-content:center;">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="white" xmlns="http://www.w3.org/2000/svg">
                <path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 14H4V8h16v10zm-6-1h2v-2h-2v2zm-3 0h2v-2h-2v2zm-3 0h2v-2H8v2zm6-3h2v-2h-2v2zm-3 0h2v-2h-2v2zm-3 0h2v-2H8v2z"/>
              </svg>
            </div>
            <div style="text-align:left;">
              <div style="font-weight:600;font-size:1rem;color:var(--text,#111);">${label}</div>
              <div style="font-size:0.85rem;color:var(--muted,#666);">${term.model || 'Stripe Terminal'}</div>
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:6px;">
            <span style="width:8px;height:8px;border-radius:50%;background:${statusColor};"></span>
            <span style="font-size:0.85rem;color:${statusColor};font-weight:500;">${statusText}</span>
          </div>
        </button>
      `;
    }).join('');

    modal.innerHTML = `
      <div class="modal-content card" style="max-width:480px;margin:12vh auto;padding:0;overflow:hidden;">
        <div style="background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);color:white;padding:20px 24px;">
          <h2 style="margin:0;font-size:1.35rem;">Select Terminal</h2>
          <p style="margin:8px 0 0 0;opacity:0.9;font-size:0.95rem;">Invoice #${inv.number || inv.id} • ${total.toFixed(2)}</p>
        </div>
        <div style="padding:24px;">
          <p style="margin:0 0 16px 0;color:var(--muted,#666);font-size:0.95rem;">Choose which terminal to process this payment:</p>
          <div id="terminal-options-list">
            ${terminalOptionsHTML}
          </div>
        </div>
        <div style="padding:16px 24px;background:var(--bg,#f9fafb);border-top:1px solid var(--line,#e5e7eb);display:flex;justify-content:flex-end;gap:12px;">
          <button class="btn" id="cancel-terminal-selection">Cancel</button>
        </div>
      </div>
    `;

    modal.classList.remove('hidden');
    modal.style.display = 'flex';

    // Wire up terminal selection buttons
    const optionBtns = modal.querySelectorAll('.terminal-option-btn');
    optionBtns.forEach(btn => {
      // Hover effect
      btn.addEventListener('mouseenter', () => {
        btn.style.borderColor = '#667eea';
        btn.style.background = 'var(--bg, #f9fafb)';
      });
      btn.addEventListener('mouseleave', () => {
        btn.style.borderColor = 'var(--line, #e5e7eb)';
        btn.style.background = 'var(--card, #fff)';
      });
      
      btn.addEventListener('click', () => {
        const terminalId = btn.dataset.terminalId;
        modal.style.display = 'none';
        modal.classList.add('hidden');
        // Proceed to checkout with selected terminal
        showTerminalPaymentModal(inv, terminalId);
      });
    });

    // Cancel button
    const cancelBtn = modal.querySelector('#cancel-terminal-selection');
    if (cancelBtn) {
      cancelBtn.onclick = () => {
        modal.style.display = 'none';
        modal.classList.add('hidden');
      };
    }

    // Close on backdrop click
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        modal.style.display = 'none';
        modal.classList.add('hidden');
      }
    });
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

// ============================================
// MISSING INVOICE FUNCTIONS FOR PART PRICING MODAL
// Called by partPricingModal.js
// ============================================

/**
 * Get labor rates from settings
 */
function getLaborRates() {
  try {
    const data = JSON.parse(localStorage.getItem('xm_data') || '{}');
    return (data.settings && data.settings.labor_rates) || [];
  } catch (e) {
    console.error('[getLaborRates] Error:', e);
    return [];
  }
}

/**
 * Add a part to the currently open invoice
 * Called from partPricingModal.js when user saves a part
 * 
 * @param {string|null} partId - Part ID if from inventory/catalog
 * @param {string} name - Part name/description
 * @param {number} quantity - Quantity
 * @param {number} sellPrice - Sell price (what customer pays)
 * @param {number} costPrice - Cost price (what shop pays)
 * @param {string} groupName - P+R group title
 * @param {boolean} inventoryAlreadyDeducted - Whether inventory was already deducted
 * @returns {string} Invoice item ID (for labor tracking)
 */
window.addPartToInvoice = async function(partId, name, quantity, sellPrice, costPrice, groupName, inventoryAlreadyDeducted) {
  console.log('[addPartToInvoice] called with:', { partId, name, quantity, sellPrice, costPrice, groupName });
  
  // Find the currently open invoice modal
  const invModal = document.getElementById('invModal');
  if (!invModal || invModal.classList.contains('hidden')) {
    console.error('[addPartToInvoice] No invoice modal is currently open!');
    try {
      showNotification('Please open an invoice first', 'error');
    } catch (e) {
      alert('Please open an invoice first');
    }
    return null;
  }
  
  // Get current invoice from modal title
  const invTitle = document.getElementById('invTitle');
  if (!invTitle) {
    console.error('[addPartToInvoice] Cannot find invoice title element');
    return null;
  }
  
  // Find all invoice items currently in the DOM
  const itemsDiv = document.getElementById('items');
  if (!itemsDiv) {
    console.error('[addPartToInvoice] Cannot find items container');
    return null;
  }
  
  // Create a unique ID for this invoice item
  const itemId = `item_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  // Create the new invoice item row directly in the DOM
  const block = document.createElement('div');
  block.className = 'inv-item-block';
  block.dataset.itemId = itemId;
  
  const meta = document.createElement('div');
  meta.className = 'inv-item-meta';
  const costTotal = quantity * costPrice;
  if (costTotal > 0) {
    meta.textContent = `Actual Part Price: $${costTotal.toFixed(2)}`;
  } else {
    meta.textContent = `Parts: $${(quantity * sellPrice).toFixed(2)}`;
  }
  
  const row = document.createElement('div');
  row.className = 'grid cols-3 item-row';
  row.style.position = 'relative';
  
  // Name input
  const nameInput = document.createElement('input');
  nameInput.className = 'itm-name';
  nameInput.value = groupName || name;
  nameInput.placeholder = 'Part name/description';
  
  // Quantity input
  const qtyInput = document.createElement('input');
  qtyInput.type = 'number';
  qtyInput.className = 'itm-qty';
  qtyInput.value = quantity;
  qtyInput.min = 0;
  qtyInput.placeholder = 'Qty';
  
  // Price input
  const priceInput = document.createElement('input');
  priceInput.type = 'number';
  priceInput.step = '0.01';
  priceInput.className = 'itm-price';
  priceInput.value = sellPrice;
  priceInput.placeholder = 'Price';
  
  // Type (hidden)
  const typeInput = document.createElement('input');
  typeInput.type = 'hidden';
  typeInput.className = 'itm-type';
  typeInput.value = 'part';
  
  // Store cost price as data attribute
  nameInput.dataset.costPrice = costPrice;
  
  row.appendChild(nameInput);
  row.appendChild(qtyInput);
  row.appendChild(priceInput);
  row.appendChild(typeInput);
  
  // Add REMOVE button
  const removeBtn = document.createElement('button');
  removeBtn.className = 'btn small danger itm-remove inv-abs-remove';
  removeBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false"><path fill="white" d="M3 6h18v2H3V6zm2 3h14l-1 12a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2l-1-12zM9 4V3a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v1h5v2H4V4h5z"/></svg>`;
  removeBtn.style.position = 'absolute';
  removeBtn.style.right = '0';
  removeBtn.style.top = '50%';
  removeBtn.style.transform = 'translateY(-50%)';
  removeBtn.onclick = () => {
    // Check if there's an attached labor row
    const nextBlock = block.nextElementSibling;
    // Build modal overlay matching app style
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    if (nextBlock && nextBlock.dataset.attachedTo === itemId) {
      modal.innerHTML = `
        <div class="modal-content card" style="max-width:420px;margin:18vh auto;padding:16px;">
          <h3>Remove Part</h3>
          <p style="margin:10px 0 0 0;">This part has attached labor. What would you like to remove?</p>
          <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:18px;">
            <button class="btn" id="cancelPartRemove">Cancel</button>
            <button class="btn danger" id="removePartOnly">Remove Part Only</button>
            <button class="btn danger" id="removePartAndLabor">Remove Part + Labor</button>
          </div>
        </div>
      `;
    } else {
      modal.innerHTML = `
        <div class="modal-content card" style="max-width:420px;margin:18vh auto;padding:16px;">
          <h3>Remove Part</h3>
          <p style="margin:10px 0 0 0;">Remove this part?</p>
          <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:18px;">
            <button class="btn" id="cancelPartRemove">Cancel</button>
            <button class="btn danger" id="removePartOnly">Remove Part</button>
          </div>
        </div>
      `;
    }

    document.body.appendChild(modal);
    modal.classList.remove('hidden');

    const removePartOnlyBtn = modal.querySelector('#removePartOnly');
    const removePartAndLaborBtn = modal.querySelector('#removePartAndLabor');
    const cancelBtn = modal.querySelector('#cancelPartRemove');

    if (removePartOnlyBtn) {
      removePartOnlyBtn.onclick = () => {
        block.remove();
        // If there's an attached labor block and we only asked to remove part, leave labor alone
        modal.remove();
      };
    }
    if (removePartAndLaborBtn) {
      removePartAndLaborBtn.onclick = () => {
        if (nextBlock && nextBlock.dataset.attachedTo === itemId) nextBlock.remove();
        block.remove();
        modal.remove();
      };
    }
    if (cancelBtn) {
      cancelBtn.onclick = () => modal.remove();
    }
  };
  row.appendChild(removeBtn);
  
  // Add "+ Add Labor" button
  const addLabor = document.createElement('button');
  addLabor.type = 'button';
  addLabor.className = 'add-labor-pill';
  addLabor.textContent = '+ Add Labor';
  addLabor.style.display = 'block';
  addLabor.style.margin = '2px 0 0 0';
  addLabor.onclick = () => {
    if (typeof window.openLaborModal === 'function') {
      window.openLaborModal(null, itemId, groupName || name);
    }
  };
  
  block.appendChild(meta);
  block.appendChild(row);
  block.appendChild(addLabor);
  
  // Append to items container
  itemsDiv.appendChild(block);
  
  // Scroll to bottom
  setTimeout(() => {
    const modalBody = document.querySelector('#invModal .modal-body');
    if (modalBody) {
      modalBody.scrollTop = modalBody.scrollHeight - modalBody.clientHeight + 12;
    }
  }, 100);
  
  console.log('[addPartToInvoice] ✅ Added part to invoice:', { itemId, name: groupName || name });
  
  try {
    showNotification('Part added to invoice!', 'success');
  } catch (e) {
    console.log('Part added to invoice!');
  }
  
  return itemId;
};

/**
 * Open labor modal to add labor to a specific part
 * Called from partPricingModal.js after user clicks "Add Labor"
 * 
 * @param {string} jobId - Job ID (may be null)
 * @param {string} invoiceItemId - Invoice item ID for the part
 * @param {string} partName - Part name for display
 */
window.openLaborModal = function(jobId, invoiceItemId, partName) {
  console.log('[openLaborModal] called with:', { jobId, invoiceItemId, partName });
  
  // Find the currently open invoice modal
  const invModal = document.getElementById('invModal');
  if (!invModal || invModal.classList.contains('hidden')) {
    console.error('[openLaborModal] No invoice modal is currently open!');
    try {
      showNotification('Please open an invoice to add labor', 'error');
    } catch (e) {
      alert('Please open an invoice to add labor');
    }
    return;
  }
  
  // Find the part item block by itemId
  const partBlock = document.querySelector(`[data-item-id="${invoiceItemId}"]`);
  if (!partBlock) {
    console.error('[openLaborModal] Cannot find part block:', invoiceItemId);
    return;
  }
  
  // Get labor rates from settings
  const laborRates = getLaborRates();
  console.log('[openLaborModal] Labor rates:', laborRates);
  
  // Create labor item block
  const laborBlock = document.createElement('div');
  laborBlock.className = 'inv-item-block';
  laborBlock.dataset.attachedTo = invoiceItemId;
  laborBlock.style.paddingLeft = '18px';
  
  const meta = document.createElement('div');
  meta.className = 'inv-item-meta';
  meta.textContent = 'Labor: $0.00';
  
  const row = document.createElement('div');
  row.className = 'grid cols-3 item-row';
  row.style.position = 'relative';
  
  // Create labor rate SELECT dropdown
  const laborSelect = document.createElement('select');
  laborSelect.className = 'itm-labor-select';
  
  // Add placeholder option
  const placeholderOpt = document.createElement('option');
  placeholderOpt.value = '';
  placeholderOpt.text = '-- select labor --';
  placeholderOpt.disabled = true;
  placeholderOpt.selected = true;
  laborSelect.appendChild(placeholderOpt);
  
  // Add "Custom" option
  const customOpt = document.createElement('option');
  customOpt.value = '__custom__';
  customOpt.text = 'Custom';
  laborSelect.appendChild(customOpt);
  
  // Add all labor rates from settings
  laborRates.forEach(rate => {
    const opt = document.createElement('option');
    opt.value = rate.name;
    opt.dataset.rate = rate.rate;
    opt.text = `${rate.name} - $${rate.rate}/hr`;
    laborSelect.appendChild(opt);
  });
  
  // Labor name input (hidden initially)
  const nameInput = document.createElement('input');
  nameInput.className = 'itm-name';
  nameInput.value = '';
  nameInput.placeholder = 'Labor name/description';
  nameInput.style.display = 'none'; // Hidden until "Custom" is selected
  
  // Quantity input (hours)
  const qtyInput = document.createElement('input');
  qtyInput.type = 'number';
  qtyInput.className = 'itm-qty';
  qtyInput.value = 1;
  qtyInput.min = 0;
  qtyInput.step = 0.25;
  qtyInput.placeholder = 'Hours';
  
  // Price input (hourly rate)
  const priceInput = document.createElement('input');
  priceInput.type = 'number';
  priceInput.step = '0.01';
  priceInput.className = 'itm-price';
  priceInput.value = '';
  priceInput.placeholder = 'Rate/hr';
  
  // Type (hidden)
  const typeInput = document.createElement('input');
  typeInput.type = 'hidden';
  typeInput.className = 'itm-type';
  typeInput.value = 'labor';
  
  // Handle labor rate selection
  laborSelect.addEventListener('change', () => {
    const selectedValue = laborSelect.value;
    
    if (selectedValue === '__custom__') {
      // Show name input, hide select
      laborSelect.style.display = 'none';
      nameInput.style.display = '';
      nameInput.value = '';
      priceInput.value = '';
      nameInput.focus();
    } else if (selectedValue) {
      // Preset selected - populate price
      const selectedRate = laborRates.find(r => r.name === selectedValue);
      if (selectedRate) {
        nameInput.value = selectedRate.name;
        priceInput.value = selectedRate.rate;
        updateMeta();
      }
    }
  });
  
  // Update meta when price/qty changes
  const updateMeta = () => {
    const qty = parseFloat(qtyInput.value) || 0;
    const price = parseFloat(priceInput.value) || 0;
    meta.textContent = `Labor: $${(qty * price).toFixed(2)}`;
  };
  qtyInput.addEventListener('input', updateMeta);
  priceInput.addEventListener('input', updateMeta);
  
  row.appendChild(laborSelect);
  row.appendChild(nameInput);
  row.appendChild(qtyInput);
  row.appendChild(priceInput);
  row.appendChild(typeInput);
  
  // Add REMOVE button for labor
  const removeBtn = document.createElement('button');
  removeBtn.className = 'btn small danger itm-remove inv-abs-remove';
  removeBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false"><path fill="white" d="M3 6h18v2H3V6zm2 3h14l-1 12a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2l-1-12zM9 4V3a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v1h5v2H4V4h5z"/></svg>`;
  removeBtn.style.position = 'absolute';
  removeBtn.style.right = '0';
  removeBtn.style.top = '50%';
  removeBtn.style.transform = 'translateY(-50%)';
  removeBtn.onclick = () => {
    // Show modal asking if they want to remove just labor or both part+labor
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal-content card" style="max-width:340px;margin:18vh auto;">
        <h3>Remove Labor or Part + Labor?</h3>
        <div style="margin:18px 0;">
          <button class="btn danger" style="margin-bottom:10px;width:100%;" id="removeLaborOnly">Remove Labor Only</button>
          <button class="btn danger" style="width:100%;" id="removePartAndLabor">Remove Part + Labor</button>
        </div>
        <button class="btn" id="cancelLaborRemove">Cancel</button>
      </div>
    `;
    document.body.appendChild(modal);
    modal.classList.remove('hidden');
    
    modal.querySelector('#removeLaborOnly').onclick = () => {
      laborBlock.remove();
      modal.remove();
    };
    
    modal.querySelector('#removePartAndLabor').onclick = () => {
      partBlock.remove();
      laborBlock.remove();
      modal.remove();
    };
    
    modal.querySelector('#cancelLaborRemove').onclick = () => {
      modal.remove();
    };
  };
  row.appendChild(removeBtn);
  
  laborBlock.appendChild(meta);
  laborBlock.appendChild(row);
  
  // Insert labor block after the part block
  partBlock.parentNode.insertBefore(laborBlock, partBlock.nextSibling);
  
  // Hide the "+ Add Labor" button on the part since labor is now added
  const addLaborBtn = partBlock.querySelector('.add-labor-pill');
  if (addLaborBtn) {
    addLaborBtn.style.display = 'none';
  }
  
  // Scroll to the new labor item
  setTimeout(() => {
    const modalBody = document.querySelector('#invModal .modal-body');
    if (modalBody) {
      modalBody.scrollTop = modalBody.scrollHeight - modalBody.clientHeight + 12;
    }
  }, 150);
  
  console.log('[openLaborModal] ✅ Added labor row with dropdown after part');
};

// Helper function for showNotification (in case it doesn't exist)
if (typeof window.showNotification !== 'function') {
  window.showNotification = function(message, type = 'success') {
    const notification = document.getElementById('notification');
    if (!notification) {
      console.warn('[showNotification] Notification element not found');
      return;
    }
    
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
  };
}
