/**
 * pages/invoices.js
 * Invoices page setup
 *
 * Imported by: app.js
 * Imports from: helpers/
 */

import { getSupabaseClient } from '../helpers/supabase.js';

function setupInvoices() {
  // Load invoices from Supabase or localStorage
  const supabase = getSupabaseClient();
  const shopId = getCurrentShopId();
  let invoices = [];
  let appointments = [];
  let users = [];
  let jobs = [];
  let settings = {};
  let currentInvoiceForRemove = null;

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
    if (!openInvoices.length) {
      empty.textContent = 'No open invoices.';
      return;
    }
    empty.textContent = '';
    openInvoices.forEach(inv => {
      // Try to get customer/info from jobs table if available
      let job = jobs.find(j => j.appointment_id === inv.appointment_id);
      let customer = job?.customer || inv.customer || '';
      console.log(`[Invoices] Rendering invoice ${inv.id}: job=${job ? job.id : 'none'}, customer=${customer}`);
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${inv.number || inv.id}</td>
        <td>${customer}</td>
        <td>$${calcTotal(inv).toFixed(2)}</td>
        <td>${inv.status || 'open'}</td>
        <td>${inv.due || ''}</td>
        <td>
          <button class="btn small" data-id="${inv.id}" data-action="edit">Edit</button>
          <button class="btn small" data-id="${inv.id}" data-action="view">View</button>
          <button class="btn small" data-id="${inv.id}" data-action="markPaid">Mark Paid</button>
          <button class="btn small danger" data-id="${inv.id}" data-action="remove">Remove</button>
        </td>
      `;
      tb.appendChild(tr);
    });
  }

  function renderPrevInvoices() {
    const tb = document.querySelector('#prevTable tbody');
    const empty = document.getElementById('prevEmpty');
    tb.innerHTML = '';
    let paidInvoices = invoices.filter(inv => inv.status === 'paid');
    if (!paidInvoices.length) {
      empty.textContent = 'No paid invoices.';
      return;
    }
    empty.textContent = '';
    paidInvoices.forEach(inv => {
      let job = jobs.find(j => j.appointment_id === inv.appointment_id);
      let customer = job?.customer || inv.customer || '';
      console.log(`[Invoices] Rendering PAID invoice ${inv.id}: job=${job ? job.id : 'none'}, customer=${customer}`);
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${inv.number || inv.id}</td>
        <td>${customer}</td>
        <td>$${calcTotal(inv).toFixed(2)}</td>
        <td>${inv.status || 'paid'}</td>
        <td>${inv.due || ''}</td>
        <td>
          <button class="btn small" data-id="${inv.id}" data-action="view">View</button>
          <button class="btn small" data-id="${inv.id}" data-action="markUnpaid">Mark Unpaid</button>
          <button class="btn small danger" data-id="${inv.id}" data-action="remove">Remove</button>
        </td>
      `;
      tb.appendChild(tr);
    });
  }

  // Calculate invoice total
  function calcTotal(inv) {
    let subtotal = (inv.items || []).reduce((sum, itm) => sum + (itm.qty * itm.price), 0);
    let tax = subtotal * ((inv.tax_rate || 0) / 100);
    let discount = subtotal * ((inv.discount || 0) / 100);
    return subtotal + tax - discount;
  }

  // View invoice modal
  function openInvoiceModal(inv) {
    // Add Parts button
    document.getElementById('addPart').onclick = () => {
      inv.items = inv.items || [];
      inv.items.push({ name: '', qty: 1, price: 0, type: 'part' });
      renderItems(inv.items);
    };
    // Add Labor button
    document.getElementById('addLabor').onclick = () => {
      inv.items = inv.items || [];
      inv.items.push({ name: '', qty: 1, price: 0, type: 'labor' });
      renderItems(inv.items);
    };
    const modal = document.getElementById('invModal');
    if (!modal) return;
    modal.classList.remove('hidden');
  document.getElementById('invTitle').textContent = `Invoice #${inv.number || inv.id}`;
  // Prefer job customer if available
  let job = jobs.find(j => j.appointment_id === inv.appointment_id);
  let customer = job?.customer || inv.customer || '';
  console.log(`[Invoices] Opening invoice modal for ${inv.id}: job=${job ? job.id : 'none'}, customer=${customer}`);
  document.getElementById('invCustomer').value = customer;
  document.getElementById('invAppt').value = inv.appointment_id || '';
    document.getElementById('invTax').value = inv.tax_rate || settings.default_tax_rate || 6;
    document.getElementById('invDisc').value = inv.discount || settings.default_discount || 0;
    document.getElementById('invDue').value = inv.due || '';
    renderItems(inv.items || []);
    document.getElementById('subTotal').textContent = calcTotal(inv).toFixed(2);
    document.getElementById('grandTotal').textContent = calcTotal(inv).toFixed(2);
    // Save button
    document.getElementById('saveInv').onclick = () => saveInvoice(inv);
      // Close button
      document.getElementById('closeInv').onclick = () => {
        document.getElementById('invModal').classList.add('hidden');
      };
      // Add Item button
      document.getElementById('addItem').onclick = () => {
        inv.items = inv.items || [];
        inv.items.push({ name: '', qty: 1, price: 0, type: 'part' });
        renderItems(inv.items);
      };
  }

  // Render invoice items
  function renderItems(items) {
    const itemsDiv = document.getElementById('items');
    itemsDiv.innerHTML = '';
    items.forEach((itm, idx) => {
      const row = document.createElement('div');
      row.className = 'grid cols-3';
      row.innerHTML = `
        <input value="${itm.name}" class="itm-name">
        <input type="number" value="${itm.qty}" class="itm-qty">
        <input type="number" value="${itm.price}" class="itm-price">
        <span>${itm.type || ''}</span>
        <button class="btn danger itm-remove" data-idx="${idx}">Remove</button>
      `;
      itemsDiv.appendChild(row);
      row.querySelector('.itm-remove').onclick = () => {
        items.splice(idx, 1);
        renderItems(items);
      };
    });
  }

  // Save invoice
  async function saveInvoice(inv) {
    // Update invoice fields
  inv.customer = document.getElementById('invCustomer').value;
  inv.appointment_id = document.getElementById('invAppt').value;
  inv.tax_rate = parseFloat(document.getElementById('invTax').value) || settings.default_tax_rate || 6;
  inv.discount = parseFloat(document.getElementById('invDisc').value) || settings.default_discount || 0;
  inv.due = document.getElementById('invDue').value || new Date().toISOString().slice(0,10);
    // Items
    let job = jobs.find(j => j.appointment_id === inv.appointment_id);
    if (job && (!inv.items || inv.items.length === 0)) {
      // If invoice has no items, copy from job
      inv.items = job.items ? JSON.parse(JSON.stringify(job.items)) : [];
    } else {
      inv.items = Array.from(document.querySelectorAll('#items .grid')).map(row => ({
        name: row.querySelector('.itm-name').value,
        qty: parseFloat(row.querySelector('.itm-qty').value) || 1,
        price: parseFloat(row.querySelector('.itm-price').value) || 0,
        type: row.querySelector('span').textContent || 'part'
      }));
      // Also update job items if job exists
      if (job) job.items = JSON.parse(JSON.stringify(inv.items));
    }

    // Persist customer name to jobs and appointments
    if (inv.appointment_id) {
      // Update appointment
      let appt = appointments.find(a => a.id === inv.appointment_id);
      if (appt && inv.customer && inv.customer !== 'Walk-in') {
        appt.customer = inv.customer;
        appt.customer_first = inv.customer.split(' ')[0] || inv.customer;
        appt.customer_last = inv.customer.split(' ').slice(1).join(' ');
        console.log(`[Invoices] Updated appointment ${appt.id} with customer: ${inv.customer}`);
      }
      // Update job
      let job = jobs.find(j => j.appointment_id === inv.appointment_id);
      if (job && inv.customer && inv.customer !== 'Walk-in') {
        job.customer = inv.customer;
        job.customer_first = inv.customer.split(' ')[0] || inv.customer;
        job.customer_last = inv.customer.split(' ').slice(1).join(' ');
        console.log(`[Invoices] Updated job ${job.id} with customer: ${inv.customer}`);
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
        console.error('[Invoices] Supabase fetch error:', fetchError);
        throw fetchError;
      }
      
      // Upsert with invoices, appointments, jobs
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
      if (error) {
        console.error('[Invoices] Error saving invoice:', error);
        alert('Error saving invoice: ' + error.message);
      } else {
        console.log('[Invoices] Saved invoices, appointments, jobs to Supabase');
      }
      
      // Also upsert invoices to invoices table
      for (const inv of invoices) {
        // Skip invoices with old string IDs (not UUIDs)
        if (inv.id && inv.id.includes('_')) {
          console.log('[Invoices] Skipping upsert for invoice with old ID:', inv.id);
          continue;
        }
        
        const invoicePayload = {
          id: inv.id,
          shop_id: shopId,
          number: inv.number,
          customer: inv.customer || '',
          customer_first: inv.customer_first || '',
          customer_last: inv.customer_last || '',
          appointment_id: inv.appointment_id || null,
          job_id: inv.job_id || null,
          status: inv.status || 'open',
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
          console.warn('[Invoices] Error upserting invoice:', upsertError);
        } else {
          console.log(`[Invoices] Upserted invoice ${inv.id} for customer: ${inv.customer}`);
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
  }

  // Mark invoice paid
  function markInvoicePaid(inv) {
    inv.status = 'paid';
    saveInvoice(inv);
  }

  // Mark invoice unpaid
  function markInvoiceUnpaid(inv) {
    inv.status = 'open';
    saveInvoice(inv);
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

  // Wire up actions
  document.getElementById('invTable').onclick = e => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const inv = invoices.find(i => i.id === btn.dataset.id);
    if (!inv) return;
    if (btn.dataset.action === 'edit') openInvoiceModal(inv);
    if (btn.dataset.action === 'view') openInvoiceModal(inv);
    if (btn.dataset.action === 'markPaid') markInvoicePaid(inv);
    if (btn.dataset.action === 'remove') openRemoveInvModal(inv);
  };
  document.getElementById('prevTable').onclick = e => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const inv = invoices.find(i => i.id === btn.dataset.id);
    if (!inv) return;
    if (btn.dataset.action === 'view') openInvoiceModal(inv);
    if (btn.dataset.action === 'markUnpaid') markInvoiceUnpaid(inv);
    if (btn.dataset.action === 'remove') openRemoveInvModal(inv);
  };

  // New invoice button
  document.getElementById('newInvoice').onclick = () => {
    const newInv = {
      id: 'inv_' + Date.now(),
      number: invoices.length + 1001,
      customer: '',
      appointment_id: '',
      status: 'open',
      due: '',
      tax_rate: 6,
      discount: 0,
      items: []
    };
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
  });
}

export { setupInvoices };
