/**
 * pages/jobs.js
 * Jobs page - List, CRUD, Status management, Parts finder
 * 
 * Handles:
 * - Loading jobs from Supabase (data.jobs JSONB)
 * - Creating jobs from appointments
 * - Status management (in_progress, awaiting_parts, completed)
 * - Assignment to staff
 * - Parts finder integration
 */

import { getSupabaseClient } from '../helpers/supabase.js';
import { LS } from '../helpers/constants.js';
import { saveAppointments } from './appointments.js';

// Current job being edited
let currentJobId = null;
let currentJobForStatus = null;
let currentJobForRemove = null;
let allJobs = [];
let allAppointments = [];
let allUsers = [];
let allStaff = []; // shop_staff rows (for assignment lookups)
// Sorting state for jobs tables
let jobSortCol = 'created_at';
let jobSortDir = 'desc';

// Status options for jobs
const JOB_STATUSES = ['in_progress', 'awaiting_parts', 'completed'];

/**
 * Get current user's shop ID
 */
function getCurrentShopId() {
  try {
    const session = JSON.parse(localStorage.getItem('xm_session') || '{}');
    return session.shopId || null;
  } catch (e) {
    return null;
  }
}

/**
 * Get current user info
 */
function getCurrentUser() {
  try {
    const session = JSON.parse(localStorage.getItem('xm_session') || '{}');
    const users = JSON.parse(localStorage.getItem('xm_users') || '[]');
    return users.find(u => u.email === session.email) || {};
  } catch (e) {
    return {};
  }
}

/**
 * Load jobs from Supabase
 */
async function loadJobs() {
  const shopId = getCurrentShopId();
  if (!shopId) {
    console.warn('No shop ID found');
    return [];
  }

  const supabase = getSupabaseClient();
  
  try {
    if (supabase) {
      // Load from Supabase data table
      const { data, error } = await supabase
        .from('data')
        .select('jobs')
        .eq('shop_id', shopId)
        .single();
      
      if (error && error.code !== 'PGRST116') {
        console.warn('Error loading jobs from Supabase:', error);
        throw error;
      }
      
      let jobs = data?.jobs || [];
      // Fix customer names if customer_first looks like a UUID
      try {
        const { data: customers } = await supabase
          .from('customers')
          .select('id, customer_first, customer_last')
          .eq('shop_id', shopId);
        const customerMap = new Map(customers?.map(c => [c.id, c]) || []);
        jobs.forEach(job => {
          if (job.customer_first && /^[0-9a-f-]{36}$/.test(job.customer_first) && customerMap.has(job.customer_first)) {
            const cust = customerMap.get(job.customer_first);
            job.customer_first = cust.customer_first;
            job.customer_last = cust.customer_last;
          }
          if (job.customer && /^[0-9a-f-]{36}$/.test(job.customer) && customerMap.has(job.customer)) {
            const cust = customerMap.get(job.customer);
            job.customer = `${cust.customer_first} ${cust.customer_last}`.trim();
          }
        });
      } catch (e) {
        console.warn('[jobs.js] Could not fix customer names:', e);
      }
      return jobs;
    }
  } catch (ex) {
    console.warn('Supabase load failed, using localStorage:', ex);
  }
  
  // Fallback to localStorage
  try {
    const localData = JSON.parse(localStorage.getItem('xm_data') || '{}');
    return (localData.jobs || []).filter(j => j.shop_id === shopId);
  } catch (e) {
    return [];
  }
}

/**
 * Load appointments from Supabase
 */
async function loadAppointments() {
  const shopId = getCurrentShopId();
  if (!shopId) return [];

  const supabase = getSupabaseClient();
  
  try {
    if (supabase) {
      const { data, error} = await supabase
        .from('data')
        .select('appointments')
        .eq('shop_id', shopId)
        .single();
      
      if (error && error.code !== 'PGRST116') throw error;
      return data?.appointments || [];
    }
  } catch (ex) {
    console.warn('Supabase appointments load failed:', ex);
  }
  
  // Fallback
  try {
    const localData = JSON.parse(localStorage.getItem('xm_data') || '{}');
    return (localData.appointments || []).filter(a => a.shop_id === shopId);
  } catch (e) {
    return [];
  }
}

/**
 * Load users (for assignment dropdown)
 */
async function loadUsers() {
  const shopId = getCurrentShopId();
  if (!shopId) return [];

  const supabase = getSupabaseClient();
  
  try {
    if (supabase) {
      const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('shop_id', shopId);
      
      if (error) throw error;
      return data || [];
    }
  } catch (ex) {
    console.warn('Supabase users load failed:', ex);
  }
  
  // Fallback
  try {
    const users = JSON.parse(localStorage.getItem('xm_users') || '[]');
    return users.filter(u => u.shop_id === shopId);
  } catch (e) {
    return [];
  }
}

/**
 * Save jobs to Supabase
 */
async function saveJobs(jobs) {
  const shopId = getCurrentShopId();
  if (!shopId) return false;

  const supabase = getSupabaseClient();
  
  try {
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
      
      // Upsert with jobs
      const payload = {
        shop_id: shopId,
        jobs: jobs,
        settings: currentData?.settings || {},
        appointments: currentData?.appointments || [],
        threads: currentData?.threads || [],
        invoices: currentData?.invoices || [],
        updated_at: new Date().toISOString()
      };
      
      const { error: upsertError } = await supabase
        .from('data')
        .upsert(payload, { onConflict: 'shop_id' });
      
      if (upsertError) throw upsertError;
      
      // Also insert/update jobs in jobs table
      // FIX: Removed the checks that were skipping jobs with underscores
      for (const job of jobs) {
        // Parse customer name from job or appointment
        let customer_first = '';
        let customer_last = '';
        if (job.customer) {
          const nameParts = job.customer.trim().split(' ');
          customer_first = nameParts[0] || '';
          customer_last = nameParts.slice(1).join(' ') || '';
        } else if (job.customer_first) {
          customer_first = job.customer_first;
          customer_last = job.customer_last || '';
        }
        
        const jobPayload = {
          id: job.id,
          shop_id: shopId,
          appointment_id: job.appointment_id || null,
          customer_first: customer_first,
          customer_last: customer_last,
          assigned_to: job.assigned_to || null,
          status: job.status,
          created_at: job.created_at,
          updated_at: job.updated_at,
          completed_at: job.completed_at || null
        };
        const { error: jobError } = await supabase
          .from('jobs')
          .upsert(jobPayload, { onConflict: 'id' });
        if (jobError) {
          console.error('Failed to upsert job:', jobError);
        } else {
          console.log(`✅ Job ${job.id} upserted to jobs table`);
        }
      }
      
      // Keep local cache in sync and notify other pages
      try {
        localStorage.setItem(LS.data, JSON.stringify(payload));
        window.dispatchEvent(new Event('xm_data_updated'));
      } catch (e) { console.warn('Failed to update local cache after saving jobs', e); }

      console.log('✅ Jobs saved to Supabase');
      return true;
    }
  } catch (ex) {
    console.warn('Supabase save failed, using localStorage:', ex);
  }
  
  // Fallback to localStorage
  try {
    const localData = JSON.parse(localStorage.getItem('xm_data') || '{}');
    localData.jobs = localData.jobs || [];

    // Merge jobs intelligently to avoid duplicates: prefer incoming jobs by id, otherwise match by appointment_id
    const keep = localData.jobs.filter(j => j.shop_id !== shopId);

    const incomingMap = new Map();
    jobs.forEach(j => { if (j && j.id) incomingMap.set(String(j.id).toLowerCase(), j); });

    // Build a map of appointment_id -> job for incoming to allow overwrite by appointment
    const incomingByAppt = new Map();
    jobs.forEach(j => { if (j && j.appointment_id) incomingByAppt.set(String(j.appointment_id), j); });

    // Start with kept jobs (other shops), then merge existing jobs for this shop that are not overwritten
    // by incoming jobs (by id or appointment_id)
    const merged = [...keep];
    // Add existing jobs for this shop that are not matched by incoming
    localData.jobs.forEach(existing => {
      if (existing.shop_id !== shopId) return;
      const eid = String(existing.id || '').toLowerCase();
      if (eid && incomingMap.has(eid)) return; // incoming has newer by id
      if (existing.appointment_id && incomingByAppt.has(String(existing.appointment_id))) return; // incoming replaces by appointment
      merged.push(existing);
    });

    // Finally add/overwrite with incoming jobs
    merged.push(...jobs);

    localData.jobs = merged;
    localStorage.setItem('xm_data', JSON.stringify(localData));
    console.log('✅ Jobs saved to localStorage');
    return true;
  } catch (e) {
    console.error('Failed to save jobs:', e);
    return false;
  }
}

/**
 * Render jobs tables
 */
function renderJobs() {
  // Active jobs (in_progress)
  const activeJobs = allJobs.filter(j => j.status === 'in_progress');
  renderJobsTable('jobsTable', 'jobsEmpty', activeJobs, 'No active jobs.');
  
  // Awaiting parts
  const awaitingJobs = allJobs.filter(j => j.status === 'awaiting_parts');
  renderJobsTable('awaitTable', 'awaitEmpty', awaitingJobs, 'No jobs awaiting parts.');
}

/**
 * Render a specific jobs table
 */
function renderJobsTable(tableId, emptyId, jobs, emptyText) {
  const tbody = document.querySelector(`#${tableId} tbody`);
  const empty = document.getElementById(emptyId);
  
  if (!tbody) return;
  
  tbody.innerHTML = '';
  
  if (jobs.length === 0) {
    if (empty) empty.textContent = emptyText;
    return;
  }
  
  if (empty) empty.textContent = '';
  
  // Sort according to jobSortCol/jobSortDir
  const sorted = [...jobs].sort((a, b) => {
    const getVal = (job) => {
      const appt = allAppointments.find(x => x.id === job.appointment_id) || {};
      switch (jobSortCol) {
        case 'id': return (job.id || '').toLowerCase();
        case 'customer': return ((appt.customer || job.customer) || '').toLowerCase();
        case 'vehicle': return (appt.vehicle || '').toLowerCase();
        case 'service': return (appt.service || '').toLowerCase();
        case 'status': return (job.status || '').toLowerCase();
        case 'assigned': {
          const user = allUsers.find(u => u.id === job.assigned_to);
          return user ? `${user.first} ${user.last}`.toLowerCase() : 'unassigned';
        }
        default:
          return new Date(job.created_at || job.updated_at || 0).getTime();
      }
    };

    const va = getVal(a);
    const vb = getVal(b);

    // If values are numbers (dates), compare numerically
    if (typeof va === 'number' && typeof vb === 'number') return jobSortDir === 'asc' ? va - vb : vb - va;
    // fallback string compare
    if (va < vb) return jobSortDir === 'asc' ? -1 : 1;
    if (va > vb) return jobSortDir === 'asc' ? 1 : -1;
    return 0;
  });
  
  sorted.forEach(job => {
    const tr = document.createElement('tr');
    tr.dataset.jobId = job.id;
    // On mobile, make row clickable to open actions modal
    if (window.matchMedia && window.matchMedia('(max-width: 768px)').matches) {
      tr.classList.add('job-row-clickable');
      tr.addEventListener('click', (e) => {
        if (e.target.closest('button')) return;
        openJobActionsModal(job);
      });
    }
// Modal for job actions (mobile)
function openJobActionsModal(job) {
  let modal = document.getElementById('jobActionsModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'jobActionsModal';
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal-content card" style="max-width:340px;margin:18vh auto;">
        <h3>Job Actions</h3>
        <div id="jobActionsBtns" style="display:flex;flex-direction:column;gap:12px;margin:18px 0;"></div>
        <button class="btn" id="closeJobActions">Close</button>
      </div>
    `;
    document.body.appendChild(modal);
  }
  const btns = modal.querySelector('#jobActionsBtns');
  btns.innerHTML = '';
  // Add action buttons (Parts, Assign, Remove)
  const partsBtn = document.createElement('button');
  partsBtn.className = 'btn';
  partsBtn.textContent = 'Parts';
  // Find related appointment for YMM info
  const appt = allAppointments.find(a => a.id === job.appointment_id);
  partsBtn.onclick = () => { modal.classList.add('hidden'); openPartsModal(job, appt); };
  btns.appendChild(partsBtn);

  // Assign button (mobile)
  const assignBtn = document.createElement('button');
  assignBtn.className = 'btn info';
  assignBtn.textContent = 'Assign';
  assignBtn.onclick = () => {
    modal.classList.add('hidden');
    openAssignModal(job);
  };
  btns.appendChild(assignBtn);

  const manualPartsBtn = document.createElement('button');
  manualPartsBtn.className = 'btn';
  manualPartsBtn.textContent = 'Add Parts Manually';
  manualPartsBtn.onclick = () => { 
    modal.classList.add('hidden'); 
    const appt = allAppointments.find(a => a.id === job.appointment_id);
    // manualPartsBtn clicked. Opening manual parts modal if appointment exists.
    if (appt) {
      openAddPartsModal(job, appt);
    } else {
      // appointment not found for manualPartsBtn
    }
  };
  btns.appendChild(manualPartsBtn);

  const removeBtn = document.createElement('button');
  removeBtn.className = 'btn danger';
  removeBtn.textContent = 'Remove';
  removeBtn.onclick = () => { modal.classList.add('hidden'); openRemoveModal(job); };
  btns.appendChild(removeBtn);
  modal.classList.remove('hidden');
  modal.querySelector('#closeJobActions').onclick = () => modal.classList.add('hidden');
}
    
    // Find related appointment
    const appt = allAppointments.find(a => a.id === job.appointment_id);
    
    // Job #
    const tdJobNum = document.createElement('td');
    tdJobNum.textContent = job.id.slice(-6).toUpperCase();
    tr.appendChild(tdJobNum);
    
    // Customer
    const tdCustomer = document.createElement('td');
    tdCustomer.textContent = appt?.customer || job.customer || 'N/A';
    tr.appendChild(tdCustomer);
    
    // Vehicle
    const tdVehicle = document.createElement('td');
    tdVehicle.textContent = appt?.vehicle || 'N/A';
    tr.appendChild(tdVehicle);
    
    // Service
    const tdService = document.createElement('td');
    tdService.textContent = appt?.service || 'N/A';
    tr.appendChild(tdService);
    
    // Status
    const tdStatus = document.createElement('td');
    const statusSpan = document.createElement('span');
    statusSpan.className = `tag ${getStatusClass(job.status)}`;
    statusSpan.textContent = job.status.replace(/_/g, ' ');
    statusSpan.style.cursor = 'pointer';
    statusSpan.title = 'Click to change status';
    statusSpan.addEventListener('click', (e) => {
      e.stopPropagation();
      openStatusModal(job);
    });
    tdStatus.appendChild(statusSpan);
    tr.appendChild(tdStatus);
    
    // Assigned To
    const tdAssigned = document.createElement('td');
    let assignedLabel = 'Unassigned';
    const assignedId = job.assigned_to || job.assigned || null;
    if (assignedId) {
      // Try to find a matching user by id or auth_id
      const u = allUsers.find(x => String(x.id) === String(assignedId) || String(x.auth_id || '') === String(assignedId));
      if (u) assignedLabel = `${u.first || u.first_name || ''} ${u.last || u.last_name || ''}`.trim();
      else {
        // Try shop_staff rows
        const s = allStaff.find(x => String(x.id) === String(assignedId) || String(x.auth_id || '') === String(assignedId) || String((x.email||'').toLowerCase()) === String((assignedId||'').toLowerCase()));
        if (s) assignedLabel = `${s.first_name || s.first || ''} ${s.last_name || s.last || ''}`.trim();
        else assignedLabel = String(assignedId);
      }
    }
    tdAssigned.textContent = assignedLabel || 'Unassigned';
    tr.appendChild(tdAssigned);
    
    // Actions
    const tdActions = document.createElement('td');
    const actionsDiv = document.createElement('div');
    actionsDiv.style.display = 'flex';
    actionsDiv.style.gap = '4px';
    
    // Assign/Unassign button
    if (job.assigned_to) {
      const unassignBtn = document.createElement('button');
      unassignBtn.className = 'btn small danger';
      unassignBtn.textContent = 'Unassign';
      unassignBtn.onclick = () => {
        job.assigned_to = null;
        job.updated_at = new Date().toISOString();
        saveJobs(allJobs);
        renderJobs();
        showNotification('Job unassigned');
      };
      actionsDiv.appendChild(unassignBtn);
    } else {
      const assignBtn = document.createElement('button');
      assignBtn.className = 'btn small';
      assignBtn.textContent = 'Assign';
      assignBtn.onclick = () => openAssignModal(job);
      actionsDiv.appendChild(assignBtn);
    }
    
  // Parts button
  const partsBtn = document.createElement('button');
  // Use blue "info" style for parts action
  partsBtn.className = 'btn small info';
  partsBtn.textContent = 'Parts';
    partsBtn.onclick = () => openPartsModal(job, appt);
    actionsDiv.appendChild(partsBtn);
    
    // Remove button
    const removeBtn = document.createElement('button');
    removeBtn.className = 'btn small danger';
    removeBtn.setAttribute('aria-label', 'Remove job');
    removeBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false"><path fill="white" d="M3 6h18v2H3V6zm2 3h14l-1 12a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2l-1-12zM9 4V3a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v1h5v2H4V4h5z"/></svg>';
    removeBtn.onclick = () => openRemoveModal(job);
    actionsDiv.appendChild(removeBtn);
    
    tdActions.appendChild(actionsDiv);
    tr.appendChild(tdActions);
    
    tbody.appendChild(tr);
  });
}

// Toggle sort when a jobs table header is clicked
function setupJobSorting() {
  ['jobsTable','awaitTable'].forEach(tableId => {
    const thead = document.querySelector(`#${tableId} thead`);
    if (!thead) return;
    thead.querySelectorAll('th.sortable').forEach(th => {
      th.style.cursor = 'pointer';
      th.addEventListener('click', () => {
        const col = th.dataset.col;
        if (!col) return;
        if (jobSortCol === col) {
          jobSortDir = jobSortDir === 'asc' ? 'desc' : 'asc';
        } else {
          jobSortCol = col;
          jobSortDir = 'asc';
        }
        // update visual indicators
        document.querySelectorAll(`#${tableId} thead th.sortable`).forEach(h => h.classList.remove('asc','desc'));
        th.classList.add(jobSortDir);
        renderJobs();
      });
    });
  });
}

/**
 * Get status class for styling
 */
function getStatusClass(status) {
  // Return the raw status string to match .tag.[status] CSS classes
  if (status === 'done') return 'completed';
  return status || 'in_progress';
}

/**
 * Open status modal
 */
function openStatusModal(job) {
  try {
    // Opening status modal for job
    currentJobForStatus = job;
    const modal = document.getElementById('statusModal');
    const pillsContainer = document.getElementById('statusPills');

    if (!modal) {
      console.error('Modal element not found');
      return;
    }

    if (!pillsContainer) {
      console.error('Pills container not found');
      return;
    }

    console.log('Modal element:', modal);
    console.log('Pills container:', pillsContainer);

    pillsContainer.innerHTML = '';

    if (!JOB_STATUSES || !Array.isArray(JOB_STATUSES)) {
      console.error('JOB_STATUSES not defined or not an array');
      return;
    }

    JOB_STATUSES.forEach(status => {
      try {
        const pill = document.createElement('button');
        pill.className = `btn ${job.status === status ? getStatusClass(status) : ''}`;
        pill.textContent = status.replace(/_/g, ' ').toUpperCase();
        pill.style.width = '100%';
        pill.style.textAlign = 'left';

        pill.addEventListener('click', async () => {
          try {
            await updateJobStatus(job.id, status);
            modal.classList.add('hidden');
          } catch (error) {
            console.error('Error updating job status:', error);
          }
        });

        pillsContainer.appendChild(pill);
      } catch (error) {
        console.error('Error creating status pill for', status, ':', error);
      }
    });

    modal.classList.remove('hidden');
    console.log('Status modal opened, hidden class removed');

  } catch (error) {
    console.error('Error in openStatusModal:', error);
  }
}

/**
 * Close status modal
 */
function closeStatusModal() {
  const modal = document.getElementById('statusModal');
  if (modal) modal.classList.add('hidden');
  currentJobForStatus = null;
}

// Make it global for onclick
window.closeStatusModal = closeStatusModal;

/**
 * Open remove modal
 */
function openRemoveModal(job) {
  currentJobForRemove = job;
  const modal = document.getElementById('removeModal');
  if (!modal) return;
  modal.classList.remove('hidden');
}

/**
 * Close remove modal
 */
function closeRemoveModal() {
  const modal = document.getElementById('removeModal');
  if (modal) modal.classList.add('hidden');
  currentJobForRemove = null;
}

// Make it global for onclick
window.closeRemoveModal = closeRemoveModal;

/**
 * Update job status
 */
async function updateJobStatus(jobId, newStatus) {
  const index = allJobs.findIndex(j => j.id === jobId);
  if (index === -1) return;
  // updateJobStatus called for job

  allJobs[index].status = newStatus;
  allJobs[index].updated_at = new Date().toISOString();

  // If completed, set completed_at and handle invoice creation/closure
  if (newStatus === 'completed') {
    allJobs[index].completed_at = new Date().toISOString();

    // Find or create invoice for this job
    const job = allJobs[index];
    let invoices = [];
    let customerName = job.customer || '';
    let customerId = null;
    // Try to get customer name and ID from appointment if missing
    if (job.appointment_id) {
      const apptIdx = allAppointments.findIndex(a => a.id === job.appointment_id);
      if (apptIdx !== -1) {
        const appt = allAppointments[apptIdx];
        customerName = appt.customer || `${appt.customer_first || ''} ${appt.customer_last || ''}`.trim();
        // Try to find customer ID by matching appointment details
        try {
          const supabase = getSupabaseClient();
          const shopId = getCurrentShopId();
          if (supabase && shopId) {
            const { data: customers } = await supabase
              .from('customers')
              .select('id, customer_first, customer_last, phone, email')
              .eq('shop_id', shopId);
            const match = customers?.find(c =>
              (c.customer_first?.trim().toLowerCase() === (appt.customer_first?.trim().toLowerCase() || '')) &&
              (c.customer_last?.trim().toLowerCase() === (appt.customer_last?.trim().toLowerCase() || ''))
            ) || customers?.find(c => c.phone === appt.phone) || customers?.find(c => c.email === appt.email);
            if (match) customerId = match.id;
          }
        } catch (e) {
          console.warn('[jobs.js] Could not lookup customer ID:', e);
        }

        // Update linked appointment status to 'completed' so other pages reflect the change
        try {
          allAppointments[apptIdx].status = 'completed';
          allAppointments[apptIdx].updated_at = new Date().toISOString();
          // Marked appointment as completed for job
        } catch (e) {
          console.warn('[jobs.js] Failed to mark linked appointment completed:', e);
        }

        // Ensure appointments table is updated everywhere
        await saveAppointments(allAppointments);
      }
    }
    try {
      const localData = JSON.parse(localStorage.getItem('xm_data') || '{}');
      invoices = localData.invoices || [];
    } catch {}
    let inv = invoices.find(i => i.appointment_id === job.appointment_id || i.job_id === job.id);
    if (!inv) {
      // Create new invoice
      inv = {
        id: `inv_${Date.now()}`,
        number: invoices.length + 1001,
        customer: customerName || 'Walk-in',
        customer_id: customerId || '',
        appointment_id: job.appointment_id || '',
        job_id: job.id,
        status: 'paid',
        due: new Date().toISOString().slice(0,10),
        tax_rate: 6,
        discount: 0,
        items: job.items || [],
        paid_date: new Date().toISOString(),
        created_at: new Date().toISOString()
      };
    }
    // ...existing code...
  // Make it global for onclick
  window.closeStatusModal = closeStatusModal;
  window.openLaborModal = openLaborModal;
  window.closeRemoveModal = closeRemoveModal;
  // `openLaborModal` is exposed above and used directly by other components.
  } else {
    if (!['in_progress', 'awaiting_parts'].includes(newStatus)) {
      // If status is not active, remove from jobs page (stays in appointments)
      allJobs = allJobs.filter(j => j.id !== allJobs[index].id);
    }
    // Always update linked appointment status for in_progress and awaiting_parts
    if (['in_progress', 'awaiting_parts'].includes(newStatus)) {
      const job = allJobs[index];
      if (job.appointment_id) {
        // Update appointment status locally
        const apptIdx = allAppointments.findIndex(a => a.id === job.appointment_id);
        if (apptIdx !== -1) {
          // Updating appointment status to newStatus
          allAppointments[apptIdx].status = newStatus;
          allAppointments[apptIdx].updated_at = new Date().toISOString();
        } else {
          // Appointment not found for job
        }
        // Save to Supabase 'data' table
        try {
          const shopId = getCurrentShopId();
          const supabase = getSupabaseClient();
          if (supabase && shopId) {
            const { data: currentData, error: fetchError } = await supabase
              .from('data')
              .select('*')
              .eq('shop_id', shopId)
              .single();
            if (fetchError && fetchError.code !== 'PGRST116') {
              // Supabase fetchError
              throw fetchError;
            }
            const payload = {
              shop_id: shopId,
              appointments: allAppointments,
              settings: currentData?.settings || {},
              jobs: currentData?.jobs || [],
              threads: currentData?.threads || [],
              invoices: currentData?.invoices || [],
              updated_at: new Date().toISOString()
            };
            // Upserting appointments to Supabase
            await supabase.from('data').upsert(payload, { onConflict: 'shop_id' });
          }
        } catch (ex) {
          // Supabase save failed (appt status update)
        }
        // Fallback to localStorage
        try {
          const localData = JSON.parse(localStorage.getItem('xm_data') || '{}');
          localData.appointments = allAppointments;
          localStorage.setItem('xm_data', JSON.stringify(localData));
          // Saved appointments to localStorage
        } catch (e) {
          // Failed to save appointments to localStorage
        }
        // Ensure appointments table is updated everywhere
        // calling saveAppointments for full sync
        await saveAppointments(allAppointments);
      }
    }
  }
  await saveJobs(allJobs);
  renderJobs();
  showNotification(`Job status updated to ${newStatus.replace(/_/g, ' ')}`);
}

/**
 * Open assign modal (simple prompt for now)
 */
function openAssignModal(job) {
  // Build a modal that matches the Remove confirmation modal style
  let modal = document.getElementById('assignModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'assignModal';
    modal.className = 'modal-overlay hidden';
    modal.innerHTML = `
      <div class="modal-content" onclick="event.stopPropagation()" style="max-width:98vw;width:100%;min-width:0;padding:0 8px;box-sizing:border-box;">
        <div class="modal-head">
          <h3 style="font-size:1.25rem;">Assign Job</h3>
          <button onclick="document.getElementById('assignModal')?.classList.add('hidden')" class="btn-close">&times;</button>
        </div>
        <div class="modal-body" style="padding-bottom: 6px;">
          <div style="margin-bottom:12px;">
            <label for="assignUserSelect" style="display:block;font-weight:600;margin-bottom:6px;font-size:1.08rem;">Select staff member</label>
            <select id="assignUserSelect" style="width:100%;padding:14px 10px;font-size:1.12rem;border-radius:10px;border:1.5px solid var(--line);background:#f9f9ff;max-width:100vw;">
              <option value="">-- Select staff --</option>
            </select>
          </div>
          <div id="assignModalError" style="color:#ef4444;font-weight:500;margin-top:4px;display:none;font-size:1.05rem"></div>
          <div style="display:flex;flex-direction:column;gap:14px;margin-top:16px;">
            <button id="assignConfirmBtn" class="btn info" style="width:100%;font-size:1.08rem;padding:14px 0;">Assign</button>
            <button id="assignCancelBtn" class="btn" style="width:100%;font-size:1.08rem;padding:14px 0;">Cancel</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  }

  // Populate staff dropdown from shop_staff first, fallback to allUsers
  (async function populateAssignList(){
    const select = modal.querySelector('#assignUserSelect');
    const errorDiv = modal.querySelector('#assignModalError');
    select.innerHTML = '<option value="">-- Loading staff --</option>';

    try {
      const supabase = getSupabaseClient();
      const shopId = getCurrentShopId();
      let staffRows = [];
      if (supabase && shopId) {
        try {
          const { data: sdata, error: sErr } = await supabase.from('shop_staff').select('*').eq('shop_id', shopId);
          if (!sErr && Array.isArray(sdata) && sdata.length) {
            staffRows = sdata.map(s => ({ id: s.auth_id || s.id, first: s.first_name || s.first || '', last: s.last_name || s.last || '', email: s.email, role: s.role || 'staff', shop_staff_id: s.id }));
          }
        } catch (e) { console.warn('Could not load shop_staff', e); }
      }

      // If no shop_staff found, fall back to allUsers loaded earlier
      if (!staffRows.length) {
        staffRows = (allUsers || []).map(u => ({ id: u.id, first: u.first || u.first_name || '', last: u.last || u.last_name || '', email: u.email, role: u.role }));
      }

      // Render options
      if (!staffRows.length) {
        select.innerHTML = '<option value="">No staff available</option>';
        errorDiv.style.display = 'block';
        errorDiv.textContent = 'No staff members available. Invite staff or add shop_staff entries.';
      } else {
        select.innerHTML = '<option value="">-- Select staff --</option>' + staffRows.map(s => `<option value="${s.id}">${(s.first||'').trim()} ${(s.last||'').trim()} ${s.role ? ' - ' + s.role : ''} ${s.email ? ' ('+s.email+')' : ''}</option>`).join('');
        errorDiv.style.display = 'none';
      }

      // Wire buttons
      const confirmBtn = modal.querySelector('#assignConfirmBtn');
      const cancelBtn = modal.querySelector('#assignCancelBtn');

      confirmBtn.onclick = async () => {
        const selected = select.value;
        if (!selected) {
          errorDiv.style.display = 'block';
          errorDiv.textContent = 'Please select a staff member to assign.';
          return;
        }
        modal.classList.add('hidden');
        await assignJob(job.id, selected);
      };

      cancelBtn.onclick = () => modal.classList.add('hidden');

      // Show modal
      modal.classList.remove('hidden');
      modal.onclick = (e) => { if (e.target === modal) modal.classList.add('hidden'); };

    } catch (err) {
      console.error('Failed to populate assign list', err);
      select.innerHTML = '<option value="">Error loading staff</option>';
      const errorDiv = modal.querySelector('#assignModalError');
      errorDiv.style.display = 'block';
      errorDiv.textContent = 'Error loading staff list.';
      modal.classList.remove('hidden');
    }
  })();
}

/**
 * Assign job to user
 */
async function assignJob(jobId, userId) {
  const index = allJobs.findIndex(j => j.id === jobId);
  if (index === -1) return;
  
  allJobs[index].assigned_to = userId;
  allJobs[index].updated_at = new Date().toISOString();
  
  await saveJobs(allJobs);
  renderJobs();
  
  const user = allUsers.find(u => u.id === userId);
  showNotification(`Job assigned to ${user.first} ${user.last}`);
}

/**
 * Complete job
 */
async function completeJob(jobId) {
  if (!confirm('Mark this job as completed?')) return;
  
  await updateJobStatus(jobId, 'completed');
}

/**
 * Handle remove job
 */
async function handleRemoveJob(removeAppointment = false) {
  if (!currentJobForRemove) return;
  
  const job = currentJobForRemove;
  
  // Remove job by setting to completed
  await updateJobStatus(job.id, 'completed');
  
  if (removeAppointment) {
    // Remove appointment from local array
    allAppointments = allAppointments.filter(a => a.id !== job.appointment_id);

    // Save to Supabase 'data' table
    const shopId = getCurrentShopId();
    const supabase = getSupabaseClient();
    if (supabase && shopId) {
      try {
        const { data: currentData, error: fetchError } = await supabase
          .from('data')
          .select('*')
          .eq('shop_id', shopId)
          .single();

        if (fetchError && fetchError.code !== 'PGRST116') {
          throw fetchError;
        }

        const payload = {
          shop_id: shopId,
          appointments: allAppointments,
          settings: currentData?.settings || {},
          jobs: currentData?.jobs || [],
          threads: currentData?.threads || [],
          invoices: currentData?.invoices || [],
          updated_at: new Date().toISOString()
        };

        await supabase.from('data').upsert(payload, { onConflict: 'shop_id' });

        // Also delete appointment from Supabase 'appointments' table
        if (job.appointment_id) {
          await supabase.from('appointments').delete().eq('id', job.appointment_id);
          console.log('✅ Deleted appointment from Supabase appointments table:', job.appointment_id);
        }
      } catch (ex) {
        console.warn('Supabase save failed:', ex);
      }
    }

    // Fallback to localStorage
    try {
      const localData = JSON.parse(localStorage.getItem('xm_data') || '{}');
      localData.appointments = allAppointments;
      localStorage.setItem('xm_data', JSON.stringify(localData));
    } catch (e) {
      console.error('Failed to save appointments to localStorage:', e);
    }
  }
  
  closeRemoveModal();
  showNotification('Job removed successfully');
}

/**
 * Open parts finder modal
 */
function openPartsModal(job, appt) {
  // Parse vehicle info from appointment
  const vehicleText = appt?.vehicle || '';
  const vehicleParts = vehicleText.match(/(\d{4})\s+([\w-]+)\s+(.+)/) || [];
  
  const jobWithVehicle = {
    ...job,
    year: vehicleParts[1] || null,
    make: vehicleParts[2] || null,
    model: vehicleParts[3] || null,
    vehicle: vehicleText
  };
  
  // Use the new parts modal handler if available
  if (window.partsModalHandler) {
    window.partsModalHandler.openModal(jobWithVehicle);
  } else {
    // Fallback to old modal
    const modal = document.getElementById('partsModal');
    if (modal) {
      modal.dataset.jobId = job.id;
      modal.classList.remove('hidden');
    }
  }
}

/**
 * Close parts modal
 */
function closePartsModal() {
  const modal = document.getElementById('partsModal');
  if (modal) modal.classList.add('hidden');
}

/**
 * Open add parts modal
 */
function openAddPartsModal(job, appt) {
  // openAddPartsModal called
  const modal = document.getElementById('addPartsModal');
  if (!modal) {
    // addPartsModal not found
    return;
  }
  // Clear form
  document.getElementById('partName').value = '';
  document.getElementById('partQty').value = '1';
  document.getElementById('partPrice').value = '';
  document.getElementById('addPartsNote').textContent = '';
  // Store current job for later
  // openAddPartsModal job
  if (job && job.id) {
    modal.dataset.jobId = job.id;
    // modal.dataset.jobId set
  } else {
    // openAddPartsModal: job or job.id missing
    delete modal.dataset.jobId;
  }
  modal.classList.remove('hidden');
}

/**
 * Close add parts modal
 */
function closeAddPartsModal() {
  const modal = document.getElementById('addPartsModal');
  if (modal) modal.classList.add('hidden');
}

/**
 * Handle add to invoice
 */
async function handleAddToInvoice() {
  // handleAddToInvoice called
  const modal = document.getElementById('addPartsModal');
  const jobId = modal?.dataset.jobId;
  if (!jobId) {
    // jobId undefined
    return;
  }
  
  const partName = document.getElementById('partName').value.trim();
  const partQty = parseInt(document.getElementById('partQty').value) || 1;
  const partPrice = parseFloat(document.getElementById('partPrice').value) || 0;
  
  if (!partName) {
    document.getElementById('addPartsNote').textContent = 'Part name is required';
    return;
  }
  
  if (partPrice <= 0) {
    document.getElementById('addPartsNote').textContent = 'Price must be greater than 0';
    return;
  }
  
  try {
    // Add part to invoice
    await addPartToInvoice(jobId, partName, partQty, partPrice);
    // Part added to invoice
      // Part added to invoice
    // Close add parts modal
    closeAddPartsModal();
    // Open labor modal
    openLaborModal(jobId);
    // Opened labor modal (user action)
  } catch (error) {
    console.error('Error adding part to invoice:', error);
    document.getElementById('addPartsNote').textContent = 'Error adding part to invoice';
  }
}

/**
 * Open labor modal
 */
async function openLaborModal(jobId) {
  console.log('[openLaborModal] called with jobId:', jobId);
  const modal = document.getElementById('laborModal');
  if (!modal) return;
  
  // Clear form
  const labDescEl = document.getElementById('labDesc');
  const labHoursEl = document.getElementById('labHours');
  const labRateSel = document.getElementById('labRateSel');
  const labRateCustom = document.getElementById('labRateCustom');
  if (labDescEl) labDescEl.value = '';
  // Default to 1 hour
  if (labHoursEl) labHoursEl.value = '1';
  // Populate rate select from settings (local cache)
  try {
    let settings = JSON.parse(localStorage.getItem('xm_data') || '{}').settings || {};
    let rates = settings.labor_rates || [];
    console.log('[openLaborModal] labor_rates from localStorage:', rates);
    // If no local rates, attempt to fetch from Supabase `data` table as a fallback
    if ((!rates || rates.length === 0)) {
      try {
        const supabase = getSupabaseClient();
        const shopId = getCurrentShopId();
        if (supabase && shopId) {
          const { data: dataRecord, error } = await supabase
            .from('data')
            .select('settings')
            .eq('shop_id', shopId)
            .single();
          if (!error && dataRecord && dataRecord.settings) {
            settings = dataRecord.settings || {};
            rates = settings.labor_rates || [];
            console.log('[openLaborModal] fetched labor_rates from Supabase:', rates);
            // update localStorage cache so subsequent calls are fast
            try {
              const localData = JSON.parse(localStorage.getItem('xm_data') || '{}');
              localData.settings = Object.assign(localData.settings || {}, settings);
              localStorage.setItem('xm_data', JSON.stringify(localData));
            } catch (e) { /* ignore local cache failures */ }
          }
        }
      } catch (e) {
        console.warn('[openLaborModal] Supabase fallback failed', e);
      }
    }
    if (labRateSel) {
      // populate select with only saved labor rates (no placeholder/custom option)
      labRateSel.innerHTML = '';
      // top option: Custom (default) so user can immediately type a custom rate
      const optCustom = document.createElement('option');
      optCustom.value = '__custom__';
      optCustom.text = 'Custom';
      labRateSel.appendChild(optCustom);
      rates.forEach(r => {
        const opt = document.createElement('option');
        opt.value = r.name;
        opt.dataset.rate = r.rate;
        opt.text = `${r.name} - $${r.rate}/hr`;
        labRateSel.appendChild(opt);
      });
      // ensure numeric rate input is visible
      if (labRateCustom) labRateCustom.style.display = '';
      // default to Custom so users can type a rate immediately
      labRateSel.value = '__custom__';
      if (labRateCustom) { labRateCustom.value = ''; labRateCustom.focus(); }
    }
  } catch (e) {
    console.warn('[openLaborModal] failed to populate rates', e);
    if (labRateSel) labRateSel.innerHTML = '<option value="__custom__" selected>Custom</option>';
  }
  document.getElementById('labNote').textContent = '';
  
  // Store current job
  modal.dataset.jobId = jobId;
  
  modal.classList.remove('hidden');
}

/**
 * Handle add labor
 */
async function handleAddLabor() {
  const modal = document.getElementById('laborModal');
  const jobId = modal?.dataset.jobId;
  if (!jobId) return;
  
  const labDesc = (document.getElementById('labDesc') || {}).value?.trim() || '';
  const labHours = parseFloat((document.getElementById('labHours') || {}).value) || 0;
  // Determine rate from select (preset) or custom numeric input
  let labRate = 0;
  const sel = document.getElementById('labRateSel');
  const custom = document.getElementById('labRateCustom');
  if (sel && sel.value) {
    labRate = parseFloat(sel.selectedOptions[0]?.dataset?.rate) || parseFloat((custom || {}).value) || 0;
  } else {
    // Backwards compat fallback to numeric input id 'labRate'
    labRate = parseFloat((document.getElementById('labRate') || {}).value) || parseFloat((custom || {}).value) || 0;
  }
  
  const usingPreset = sel && sel.value && sel.value !== '__custom__';
  // If using Custom (or no select), require a description. If using a preset and no description provided,
  // use the preset label as the description so invoice/labor lines are meaningful.
  if (!usingPreset && !labDesc) {
    document.getElementById('labNote').textContent = 'Labor description is required for custom rates';
    return;
  }
  let finalDesc = labDesc;
  if (usingPreset && !finalDesc) {
    finalDesc = sel.selectedOptions[0]?.text || sel.value || '';
  }
  
  if (labHours <= 0) {
    document.getElementById('labNote').textContent = 'Hours must be greater than 0';
    return;
  }
  
  if (labRate <= 0) {
    document.getElementById('labNote').textContent = 'Rate must be greater than 0';
    return;
  }
  
  try {
    // Add labor to invoice
    await addLaborToInvoice(jobId, finalDesc, labHours, labRate);
    // Labor added to invoice
      // Labor added to invoice
    // Close labor modal
    modal.classList.add('hidden');
    // Show success notification
    showNotification('Part and labor added to invoice successfully!', 'success');
  } catch (error) {
    console.error('Error adding labor to invoice:', error);
    document.getElementById('labNote').textContent = 'Error adding labor to invoice';
  }
}

/**
 * Handle skip labor
 */
function handleSkipLabor() {
  const modal = document.getElementById('laborModal');
  if (modal) modal.classList.add('hidden');
  
  // Show success notification for part only
  showNotification('Part added to invoice successfully!', 'success');
}

/**
 * Add part to invoice
 */
async function addPartToInvoice(jobId, partName, quantity, price, cost) {
  // Find the job and related appointment
  const job = allJobs.find(j => j.id === jobId);
  if (!job) throw new Error('Job not found');
  
  const appt = allAppointments.find(a => a.id === job.appointment_id);
  if (!appt) throw new Error('Appointment not found');
  
  // Get or create invoice for this appointment
  let invoice = await getInvoiceForAppointment(appt.id);
  if (!invoice) {
    invoice = await createInvoiceForAppointment(appt);
  }
  
  // Add part item to invoice
  const partItem = {
    name: partName,
    qty: quantity,
    price: price,
    cost_price: (typeof cost !== 'undefined') ? Number(cost) : undefined,
    type: 'part'
  };
  
  invoice.items = invoice.items || [];
  invoice.items.push(partItem);
  
  // If cost_price is missing, try to fetch job_parts for a fallback
  if (typeof partItem.cost_price === 'undefined' || partItem.cost_price === null) {
    try {
      const API_BASE = (window.XM_API_BASE !== undefined) ? window.XM_API_BASE : '';
      const resp = await fetch(`${API_BASE}/api/catalog/job-parts/${encodeURIComponent(jobId)}`);
      if (resp && resp.ok) {
        const json = await resp.json();
        const parts = json.parts || [];
        // Try to match by part name or close match
        const match = parts.find(p => (p.part_name || '').toString().trim() === (partName || '').toString().trim() || (p.part_number && partName && partName.includes(p.part_number)));
        if (match && typeof match.cost_price !== 'undefined') {
          partItem.cost_price = Number(match.cost_price) || 0;
        }
      }
    } catch (e) {
      console.warn('[addPartToInvoice] failed to fetch job parts for fallback cost_price', e);
    }
  }

  // Save invoice
  await saveInvoice(invoice);
  // Dispatch event to trigger UI refresh
  window.dispatchEvent(new CustomEvent('partAdded', { detail: { jobId } }));
  console.log('Part added to invoice:', partItem);
  // Show success notification to the user (ensure single-part adds always show feedback)
  try { showNotification('Part added to invoice', 'success'); } catch (e) {}
}

/**
 * Add labor to invoice
 */
async function addLaborToInvoice(jobId, description, hours, rate) {
  // Find the job and related appointment
  const job = allJobs.find(j => j.id === jobId);
  if (!job) throw new Error('Job not found');
  
  const appt = allAppointments.find(a => a.id === job.appointment_id);
  if (!appt) throw new Error('Appointment not found');
  
  // Get invoice for this appointment
  const invoice = await getInvoiceForAppointment(appt.id);
  if (!invoice) throw new Error('Invoice not found');
  
  // Add labor item to invoice
  const laborItem = {
    name: description,
    qty: hours,
    price: rate,
    type: 'labor'
  };
  
  invoice.items = invoice.items || [];
  invoice.items.push(laborItem);
  
  // Save invoice
  await saveInvoice(invoice);
  
  console.log('Labor added to invoice:', laborItem);
}

/**
 * Get invoice for appointment
 */
async function getInvoiceForAppointment(appointmentId) {
  try {
    const supabase = getSupabaseClient();
    if (supabase) {
      const shopId = getCurrentShopId();
      const { data, error } = await supabase
        .from('data')
        .select('invoices')
        .eq('shop_id', shopId)
        .single();
      
      if (error && error.code !== 'PGRST116') throw error; // PGRST116 = not found
      
      const invoices = data?.invoices || [];
      return invoices.find(inv => inv.appointment_id === appointmentId);
    } else {
      // LocalStorage fallback
      const data = JSON.parse(localStorage.getItem('xm_data') || '{}');
      const invoices = data.invoices || [];
      return invoices.find(inv => inv.appointment_id === appointmentId);
    }
  } catch (error) {
    console.error('Error getting invoice:', error);
    return null;
  }
}

/**
 * Create invoice for appointment
 */
async function createInvoiceForAppointment(appt) {
  const shopId = getCurrentShopId();
  const nextNumber = await getNextInvoiceNumber();
  
  const invoice = {
    id: `inv_${Date.now()}`,
    number: nextNumber,
    customer_id: appt.customer_id || appt.customer || '',
    customer_first: appt.customer_first || '',
    customer_last: appt.customer_last || '',
    customer: `${appt.customer_first || ''} ${appt.customer_last || ''}`.trim() || appt.customer || 'Walk-in',
    appointment_id: appt.id,
    status: 'open',
    due: new Date().toISOString().split('T')[0], // Today
    tax_rate: 6,
    discount: 0,
    items: [],
    created_at: new Date().toISOString()
  };
  
  await saveInvoice(invoice);
  return invoice;
}

/**
 * Get next invoice number
 */
async function getNextInvoiceNumber() {
  try {
    const supabase = getSupabaseClient();
    if (supabase) {
      const shopId = getCurrentShopId();
      const { data, error } = await supabase
        .from('data')
        .select('invoices')
        .eq('shop_id', shopId)
        .single();
      
      if (error && error.code !== 'PGRST116') throw error;
      
      const invoices = data?.invoices || [];
      const maxNumber = invoices.reduce((max, inv) => Math.max(max, parseInt(inv.number) || 0), 1000);
      return maxNumber + 1;
    } else {
      const data = JSON.parse(localStorage.getItem('xm_data') || '{}');
      const invoices = data.invoices || [];
      const maxNumber = invoices.reduce((max, inv) => Math.max(max, parseInt(inv.number) || 0), 1000);
      return maxNumber + 1;
    }
  } catch (error) {
    console.error('Error getting next invoice number:', error);
    return Date.now(); // Fallback
  }
}

/**
 * Save invoice
 */
async function saveInvoice(invoice) {
  try {
    const supabase = getSupabaseClient();
    if (supabase) {
      const shopId = getCurrentShopId();
      
      // Get current data
      const { data: currentData, error: fetchError } = await supabase
        .from('data')
        .select('*')
        .eq('shop_id', shopId)
        .single();
      
      if (fetchError && fetchError.code !== 'PGRST116') throw fetchError;
      
      const data = currentData || { shop_id: shopId, settings: {}, appointments: [], jobs: [], threads: [], invoices: [] };
      data.invoices = data.invoices || [];
      
      // Update or add invoice
      const index = data.invoices.findIndex(inv => inv.id === invoice.id);
      if (index >= 0) {
        data.invoices[index] = invoice;
      } else {
        data.invoices.push(invoice);
      }
      
      // Save to data table
      const { error: saveError } = await supabase
        .from('data')
        .upsert(data);
      
      if (saveError) throw saveError;
      console.log('✅ Invoice saved to data table:', invoice.id);
      
      // Also upsert to invoices table
      // Parse customer name
      const nameParts = (invoice.customer || '').trim().split(' ');
      const customer_first = nameParts[0] || '';
      const customer_last = nameParts.slice(1).join(' ') || '';
      
      const invoicePayload = {
        id: invoice.id,
        shop_id: shopId,
        number: invoice.number,
        customer_id: invoice.customer_id || '',
        customer_first: customer_first,
        customer_last: customer_last,
        appointment_id: invoice.appointment_id || null,
        job_id: invoice.job_id || null,
        status: invoice.status || 'open',
        due: invoice.due || null,
        tax_rate: invoice.tax_rate || 6,
        discount: invoice.discount || 0,
        items: invoice.items || [],
        paid_date: invoice.paid_date || null,
        created_at: invoice.created_at || new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      
      const { error: invoiceError } = await supabase
        .from('invoices')
        .upsert(invoicePayload, { onConflict: 'id' });
      
      if (invoiceError) throw invoiceError;
      console.log('✅ Invoice saved to invoices table:', invoice.id);
      
    } else {
      // LocalStorage fallback
      const data = JSON.parse(localStorage.getItem('xm_data') || '{}');
      data.invoices = data.invoices || [];
      
      const index = data.invoices.findIndex(inv => inv.id === invoice.id);
      if (index >= 0) {
        data.invoices[index] = invoice;
      } else {
        data.invoices.push(invoice);
      }
      
      localStorage.setItem('xm_data', JSON.stringify(data));
    }
    
    console.log('Invoice saved:', invoice);
    
  } catch (error) {
    console.error('Error saving invoice:', error);
    throw error;
  }
}

/**
 * Show notification
 */
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

/**
 * Setup jobs page
 */
async function setupJobs() {
  console.log('💼 Setting up Jobs page...');
  
  // Load all data
  allJobs = await loadJobs();
  allAppointments = await loadAppointments();
  allUsers = await loadUsers();
  // Load shop_staff for richer assignment lookup
  try {
    const supabase = getSupabaseClient();
    const shopId = getCurrentShopId();
    if (supabase && shopId) {
      const { data: sdata, error: sErr } = await supabase.from('shop_staff').select('*').eq('shop_id', shopId);
      if (!sErr && Array.isArray(sdata)) allStaff = sdata;
    }
  } catch (e) { console.warn('Could not load shop_staff for assignments', e); }
  
  console.log(`✅ Loaded ${allJobs.length} jobs`);
  console.log(`✅ Loaded ${allAppointments.length} appointments`);
  console.log(`✅ Loaded ${allUsers.length} users`);
  
  // Render tables
  renderJobs();
  // Setup sortable headers for jobs
  setupJobSorting();
  
  // Event listeners
  const closePartsBtn = document.getElementById('closeParts');
  if (closePartsBtn) closePartsBtn.addEventListener('click', closePartsModal);
  
  const closeAddPartsBtn = document.getElementById('closeAddParts');
  if (closeAddPartsBtn) closeAddPartsBtn.addEventListener('click', closeAddPartsModal);
  
  const addToInvoiceBtn = document.getElementById('addToInvoiceBtn');
  if (addToInvoiceBtn) addToInvoiceBtn.addEventListener('click', handleAddToInvoice);
  
  const addLaborBtn = document.getElementById('addLaborBtn');
  if (addLaborBtn) addLaborBtn.addEventListener('click', handleAddLabor);
  
  const skipLaborBtn = document.getElementById('skipLaborBtn');
  if (skipLaborBtn) skipLaborBtn.addEventListener('click', handleSkipLabor);

  // New: hook up the unified labor confirm button (jobs.html uses `labConfirm`)
  const labConfirmBtn = document.getElementById('labConfirm');
  if (labConfirmBtn) labConfirmBtn.addEventListener('click', handleAddLabor);

  // Toggle custom rate input when select changes
  const labRateSel = document.getElementById('labRateSel');
  const labRateCustom = document.getElementById('labRateCustom');
  if (labRateSel) {
    labRateSel.addEventListener('change', () => {
      // when a preset is selected, populate the numeric rate input with its value
      try {
        const sel = labRateSel;
        const custom = labRateCustom;
        if (sel && sel.value && custom) {
          const rate = parseFloat(sel.selectedOptions[0]?.dataset?.rate) || 0;
          custom.value = rate || '';
          custom.style.display = '';
        }
      } catch (e) { console.warn('[labRateSel change] error', e); }
    });
  }
  
  const searchPartsBtn = document.getElementById('pfSearch');
  if (searchPartsBtn) {
    searchPartsBtn.addEventListener('click', () => {
      showNotification('Parts search coming soon!', 'info');
    });
  }
  
  const openAddPartsFromFinderBtn = document.getElementById('openAddPartsFromFinder');
  if (openAddPartsFromFinderBtn) {
    openAddPartsFromFinderBtn.addEventListener('click', () => {
      // Close the find parts modal and open add parts modal
      closePartsModal();
      // Get the job ID from the parts modal that was just closed
      const jobId = document.getElementById('partsModal').dataset.jobId;
      if (jobId) {
        const job = allJobs.find(j => j.id === jobId);
        const appt = allAppointments.find(a => a.id === job?.appointment_id);
        if (job && appt) {
          openAddPartsModal(job, appt);
        }
      }
    });
  }
  
  const closeLabBtn = document.getElementById('labClose');
  if (closeLabBtn) {
    closeLabBtn.addEventListener('click', () => {
      const laborModal = document.getElementById('laborModal');
      if (laborModal) laborModal.classList.add('hidden');
    });
  }
  
  const removeJobBtn = document.getElementById('removeJobBtn');
  if (removeJobBtn) removeJobBtn.addEventListener('click', () => handleRemoveJob(false));
  
  const removeJobApptBtn = document.getElementById('removeJobApptBtn');
  if (removeJobApptBtn) removeJobApptBtn.addEventListener('click', () => handleRemoveJob(true));
  
  const cancelRemoveBtn = document.getElementById('cancelRemoveBtn');
  if (cancelRemoveBtn) cancelRemoveBtn.addEventListener('click', closeRemoveModal);
  // Listen for partAdded event to refresh invoice items
  window.addEventListener('partAdded', async (e) => {
    const jobId = e.detail.jobId;
    const job = allJobs.find(j => j.id === jobId);
    const appt = allAppointments.find(a => a.id === job?.appointment_id);
    if (job && appt) {
      // Optionally reload invoice and re-render modal/items
      const invoice = await getInvoiceForAppointment(appt.id);
      if (invoice) {
        // You may want to call openInvoiceModal(invoice) or a similar function to update the UI
        // Example:
        if (typeof openInvoiceModal === 'function') {
          openInvoiceModal(invoice);
        }
      }
    }
  });
  // Expose invoice helper functions to global scope for other components
  window.addPartToInvoice = addPartToInvoice;
  window.addLaborToInvoice = addLaborToInvoice;
  window.getInvoiceForAppointment = getInvoiceForAppointment;
  console.log('✅ Jobs page setup complete');
}

export { setupJobs, saveJobs };
