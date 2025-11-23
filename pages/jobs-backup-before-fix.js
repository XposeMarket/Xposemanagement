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

// Current job being edited
let currentJobId = null;
let currentJobForStatus = null;
let currentJobForRemove = null;
let allJobs = [];
let allAppointments = [];
let allUsers = [];

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
      
      return data?.jobs || [];
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
      const { data, error } = await supabase
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
      for (const job of jobs) {
        // Skip jobs with old string appointment IDs (not UUIDs)
        if (job.appointment_id && job.appointment_id.includes('_')) {
          console.log('Skipping upsert for job with old appointment ID:', job.appointment_id);
          continue;
        }
        
        // Skip jobs with old string IDs (not UUIDs)
        if (job.id.includes('_')) {
          console.log('Skipping upsert for old job ID:', job.id);
          continue;
        }
        
        const jobPayload = {
          id: job.id,
          shop_id: shopId,
          appointment_id: job.appointment_id,
          assigned_to: job.assigned_to,
          status: job.status,
          created_at: job.created_at,
          updated_at: job.updated_at
        };
        const { error: jobError } = await supabase
          .from('jobs')
          .upsert(jobPayload, { onConflict: 'id' });
        if (jobError) {
          console.error('Failed to upsert job:', jobError);
        }
      }
      
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
    
    // Remove old jobs for this shop
    localData.jobs = localData.jobs.filter(j => j.shop_id !== shopId);
    
    // Add new jobs
    localData.jobs.push(...jobs);
    
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
  
  // Sort by created date (newest first)
  const sorted = [...jobs].sort((a, b) => {
    const dateA = new Date(a.created_at);
    const dateB = new Date(b.created_at);
    return dateB - dateA;
  });
  
  sorted.forEach(job => {
    const tr = document.createElement('tr');
    tr.dataset.jobId = job.id;
    
    // Find related appointment
    const appt = allAppointments.find(a => a.id === job.appointment_id);
    
    // Job #
    const tdJobNum = document.createElement('td');
    tdJobNum.textContent = job.id.slice(-6).toUpperCase();
    tr.appendChild(tdJobNum);
    
    // Customer
    const tdCustomer = document.createElement('td');
    tdCustomer.textContent = appt?.customer || 'N/A';
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
    const assignedUser = allUsers.find(u => u.id === job.assigned_to);
    if (assignedUser) {
      tdAssigned.textContent = `${assignedUser.first} ${assignedUser.last}`;
    } else {
      tdAssigned.textContent = 'Unassigned';
    }
    tr.appendChild(tdAssigned);
    
    // Actions
    const tdActions = document.createElement('td');
    const actionsDiv = document.createElement('div');
    actionsDiv.style.display = 'flex';
    actionsDiv.style.gap = '4px';
    
    // Assign button
    const assignBtn = document.createElement('button');
    assignBtn.className = 'btn small';
    assignBtn.textContent = 'Assign';
    assignBtn.onclick = () => openAssignModal(job);
    actionsDiv.appendChild(assignBtn);
    
    // Parts button
    const partsBtn = document.createElement('button');
    partsBtn.className = 'btn small primary';
    partsBtn.textContent = 'Parts';
    partsBtn.onclick = () => openPartsModal(job, appt);
    actionsDiv.appendChild(partsBtn);
    
    // Remove button
    const removeBtn = document.createElement('button');
    removeBtn.className = 'btn small danger';
    removeBtn.textContent = 'Remove';
    removeBtn.onclick = () => openRemoveModal(job);
    actionsDiv.appendChild(removeBtn);
    
    tdActions.appendChild(actionsDiv);
    tr.appendChild(tdActions);
    
    tbody.appendChild(tr);
  });
}

/**
 * Get status class for styling
 */
function getStatusClass(status) {
  const map = {
    'in_progress': 'warning',
    'awaiting_parts': 'danger',
    'completed': 'success'
  };
  return map[status] || 'info';
}

/**
 * Open status modal
 */
function openStatusModal(job) {
  try {
    console.log('Opening status modal for job:', job.id);
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

  allJobs[index].status = newStatus;
  allJobs[index].updated_at = new Date().toISOString();

  // If completed, set completed_at and handle invoice creation/closure
  if (newStatus === 'completed') {
    allJobs[index].completed_at = new Date().toISOString();

    // Find or create invoice for this job
    const job = allJobs[index];
    let invoices = [];
    let customerName = job.customer || '';
    // Try to get customer name from appointment if missing
    if (!customerName && job.appointment_id) {
      const appt = allAppointments.find(a => a.id === job.appointment_id);
      if (appt) customerName = appt.customer || `${appt.customer_first || ''} ${appt.customer_last || ''}`.trim();
    }
    try {
      const localData = JSON.parse(localStorage.getItem('xm_data') || '{}');
      invoices = localData.invoices || [];
    } catch {}
    let inv = invoices.find(i => i.appointment_id === job.appointment_id || i.job_id === job.id);
    if (!inv) {
      // Create new invoice
      inv = {
        id: 'inv_' + Date.now(),
        number: invoices.length + 1001,
        customer: customerName || 'Walk-in',
        appointment_id: job.appointment_id || '',
        job_id: job.id,
        status: 'paid',
        due: new Date().toISOString().slice(0,10),
        tax_rate: 6,
        discount: 0,
        items: job.items || [],
        paid_date: new Date().toISOString()
      };
      invoices.push(inv);
    } else {
      inv.status = 'paid';
      inv.paid_date = new Date().toISOString();
      inv.customer = customerName || inv.customer || 'Walk-in';
    }
    // Save invoices and jobs to Supabase
    try {
      const supabase = getSupabaseClient();
      const shopId = getCurrentShopId();
      if (supabase && shopId) {
        const { data: currentData, error: fetchError } = await supabase
          .from('data')
          .select('*')
          .eq('shop_id', shopId)
          .single();
        const payload = {
          shop_id: shopId,
          jobs: allJobs.filter(j => j.status !== 'completed'),
          invoices: invoices,
          settings: currentData?.settings || {},
          appointments: currentData?.appointments || [],
          threads: currentData?.threads || [],
          updated_at: new Date().toISOString()
        };
        await supabase.from('data').upsert(payload, { onConflict: 'shop_id' });
      }
    } catch (ex) {
      console.warn('Supabase save failed, using localStorage:', ex);
      try {
        const localData = JSON.parse(localStorage.getItem('xm_data') || '{}');
        localData.invoices = invoices;
        localData.jobs = allJobs.filter(j => j.status !== 'completed');
        localStorage.setItem('xm_data', JSON.stringify(localData));
      } catch {}
    }
    // Remove job from jobs list
    allJobs = allJobs.filter(j => j.id !== job.id);
  } else if (!['in_progress', 'awaiting_parts'].includes(newStatus)) {
    // If status is not active, remove from jobs page (stays in appointments)
    allJobs = allJobs.filter(j => j.id !== allJobs[index].id);
  }
  await saveJobs(allJobs);
  renderJobs();
  showNotification(`Job status updated to ${newStatus.replace(/_/g, ' ')}`);
}

/**
 * Open assign modal (simple prompt for now)
 */
function openAssignModal(job) {
  if (allUsers.length === 0) {
    showNotification('No staff members available to assign', 'error');
    return;
  }
  
  const userOptions = allUsers.map((u, i) => `${i + 1}. ${u.first} ${u.last}`).join('\n');
  const selection = prompt(`Assign to:\n${userOptions}\n\nEnter number:`);
  
  if (!selection) return;
  
  const index = parseInt(selection) - 1;
  if (index >= 0 && index < allUsers.length) {
    assignJob(job.id, allUsers[index].id);
  }
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
    // Remove appointment
    allAppointments = allAppointments.filter(a => a.id !== job.appointment_id);
    
    // Save to Supabase
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
  const modal = document.getElementById('partsModal');
  if (!modal) return;
  
  // Populate vehicle info
  document.getElementById('pfVehicle').value = appt?.vehicle || '';
  document.getElementById('pfVin').value = appt?.vin || '';
  document.getElementById('pfQuery').value = '';
  document.getElementById('pfResults').innerHTML = '';
  document.getElementById('pfNote').textContent = '';
  
  // Store current job for later
  modal.dataset.jobId = job.id;
  
  modal.classList.remove('hidden');
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
  const modal = document.getElementById('addPartsModal');
  if (!modal) return;
  
  // Clear form
  document.getElementById('partName').value = '';
  document.getElementById('partQty').value = '1';
  document.getElementById('partPrice').value = '';
  document.getElementById('addPartsNote').textContent = '';
  
  // Store current job for later
  modal.dataset.jobId = job.id;
  
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
  const modal = document.getElementById('addPartsModal');
  const jobId = modal?.dataset.jobId;
  if (!jobId) return;
  
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
    
    // Close add parts modal
    closeAddPartsModal();
    
    // Open labor modal
    openLaborModal(jobId);
    
  } catch (error) {
    console.error('Error adding part to invoice:', error);
    document.getElementById('addPartsNote').textContent = 'Error adding part to invoice';
  }
}

/**
 * Open labor modal
 */
function openLaborModal(jobId) {
  const modal = document.getElementById('laborModal');
  if (!modal) return;
  
  // Clear form
  document.getElementById('labDesc').value = '';
  document.getElementById('labHours').value = '';
  document.getElementById('labRate').value = '';
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
  
  const labDesc = document.getElementById('labDesc').value.trim();
  const labHours = parseFloat(document.getElementById('labHours').value) || 0;
  const labRate = parseFloat(document.getElementById('labRate').value) || 0;
  
  if (!labDesc) {
    document.getElementById('labNote').textContent = 'Labor description is required';
    return;
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
    await addLaborToInvoice(jobId, labDesc, labHours, labRate);
    
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
async function addPartToInvoice(jobId, partName, quantity, price) {
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
    type: 'part'
  };
  
  invoice.items = invoice.items || [];
  invoice.items.push(partItem);
  
  // Save invoice
  await saveInvoice(invoice);
  
  console.log('Part added to invoice:', partItem);
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
    customer: `${appt.customer_first || ''} ${appt.customer_last || ''}`.trim() || 'Walk-in',
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
      
      // Save
      const { error: saveError } = await supabase
        .from('data')
        .upsert(data);
      
      if (saveError) throw saveError;
      
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
  
  console.log(`✅ Loaded ${allJobs.length} jobs`);
  console.log(`✅ Loaded ${allAppointments.length} appointments`);
  console.log(`✅ Loaded ${allUsers.length} users`);
  
  // Render tables
  renderJobs();
  
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
  
  console.log('✅ Jobs page setup complete');
}

export { setupJobs, saveJobs };
