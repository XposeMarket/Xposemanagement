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
import { saveAppointments } from './appointments.js?v=1767391500';
import { createShopNotification } from '../helpers/shop-notifications.js';

// Current job being edited
let currentJobId = null;
let currentJobForStatus = null;
let currentJobForRemove = null;
let currentJobNotesAppointmentId = null;
let allJobs = [];
let allAppointments = [];
let allUsers = [];
let allStaff = []; // shop_staff rows (for assignment lookups)
// Track if current user is staff (not admin)
let isStaffUser = false;
let currentStaffUserId = null;
let currentStaffAuthId = null; // auth_id for consistent lookups
// Draft for newly-created or selected service to be used in add-flow
let newServiceDraft = null;
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
 * Get current authenticated user's ID
 */
async function getCurrentAuthId() {
  const supabase = getSupabaseClient();
  if (!supabase) return null;
  
  try {
    const { data: authData } = await supabase.auth.getUser();
    return authData?.user?.id || null;
  } catch (error) {
    console.error('[Jobs] Error getting auth ID:', error);
    return null;
  }
}

/**
 * Get current user with role (async - from Supabase shop_staff)
 */
async function getCurrentUserWithRole() {
  const supabase = getSupabaseClient();
  if (!supabase) return getCurrentUser();
  
  try {
    const { data: authData } = await supabase.auth.getUser();
    const authUser = authData?.user;
    if (!authUser) return getCurrentUser();
    
    // Check shop_staff table for role
    const { data: staffData } = await supabase
      .from('shop_staff')
      .select('*')
      .eq('auth_id', authUser.id)
      .limit(1);
    
    if (staffData && staffData.length > 0) {
      const staff = staffData[0];
      return {
        id: staff.id || authUser.id,
        auth_id: authUser.id,
        first: staff.first_name || '',
        last: staff.last_name || '',
        email: staff.email || authUser.email,
        role: staff.role || 'staff',
        shop_id: staff.shop_id
      };
    }
    
    // Fallback to email lookup
    if (authUser.email) {
      const { data: emailData } = await supabase
        .from('shop_staff')
        .select('*')
        .ilike('email', authUser.email)
        .limit(1);
      
      if (emailData && emailData.length > 0) {
        const staff = emailData[0];
        return {
          id: staff.id || authUser.id,
          auth_id: authUser.id,
          first: staff.first_name || '',
          last: staff.last_name || '',
          email: staff.email || authUser.email,
          role: staff.role || 'staff',
          shop_id: staff.shop_id
        };
      }
    }
    
    // Check users table for admin/owner
    const { data: userData } = await supabase
      .from('users')
      .select('*')
      .eq('id', authUser.id)
      .limit(1)
      .single();
    
    if (userData) {
      return {
        id: userData.id,
        auth_id: authUser.id,
        first: userData.first || '',
        last: userData.last || '',
        email: userData.email || authUser.email,
        role: userData.role || 'admin',
        shop_id: userData.shop_id
      };
    }
    
    return getCurrentUser();
  } catch (e) {
    console.warn('getCurrentUserWithRole failed:', e);
    return getCurrentUser();
  }
}

/**
 * Load jobs from Supabase
 * Also cleans up orphaned jobs (jobs without valid appointments)
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
      // Load from Supabase data table - get both jobs AND appointments for orphan cleanup
      const { data, error } = await supabase
        .from('data')
        .select('jobs, appointments')
        .eq('shop_id', shopId)
        .single();
      
      if (error && error.code !== 'PGRST116') {
        console.warn('Error loading jobs from Supabase:', error);
        throw error;
      }
      
      let jobs = data?.jobs || [];
      const appointments = data?.appointments || [];
      
      // Clean up orphaned jobs: remove jobs whose appointment_id doesn't exist in appointments
      const appointmentIds = new Set(appointments.map(a => a.id));
      const originalCount = jobs.length;
      
      jobs = jobs.filter(job => {
        // Keep completed jobs regardless
        if (job.status === 'completed') return true;
        // Keep jobs with valid appointment references
        if (job.appointment_id && appointmentIds.has(job.appointment_id)) return true;
        // Keep jobs without appointment_id (edge case)
        if (!job.appointment_id) return true;
        // Remove orphaned jobs
        console.log(`🧹 [Jobs] Removing orphaned job: ${job.id} (appointment ${job.appointment_id} not found)`);
        return false;
      });
      
      // If we removed orphaned jobs, save the cleaned data back
      if (jobs.length !== originalCount) {
        console.log(`🧹 [Jobs] Cleaned ${originalCount - jobs.length} orphaned job(s)`);
        
        // Update data table with cleaned jobs
        const { error: updateError } = await supabase
          .from('data')
          .update({ 
            jobs: jobs,
            updated_at: new Date().toISOString()
          })
          .eq('shop_id', shopId);
        
        if (updateError) {
          console.warn('[Jobs] Failed to save cleaned jobs:', updateError);
        } else {
          console.log('✅ [Jobs] Orphaned jobs cleaned from data table');
        }
        
        // Also delete orphaned jobs from the standalone jobs table
        const originalJobs = data?.jobs || [];
        const orphanedJobIds = originalJobs
          .filter(job => !jobs.some(j => j.id === job.id))
          .map(job => job.id);
        
        if (orphanedJobIds.length > 0) {
          for (const jobId of orphanedJobIds) {
            await supabase.from('jobs').delete().eq('id', jobId);
          }
          console.log(`✅ [Jobs] Deleted ${orphanedJobIds.length} orphaned job(s) from jobs table`);
        }
      }
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
    
    // Add green highlight for staff's assigned jobs
    if (isStaffUser && currentStaffAuthId) {
      const assignedId = job.assigned_to || job.assigned || null;
      if (assignedId && (String(assignedId) === String(currentStaffAuthId))) {
        tr.classList.add('staff-claimed');
      }
    }
    
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
  
  // Find related appointment for YMM info
  const appt = allAppointments.find(a => a.id === job.appointment_id);
  
  // View button (always shown)
  const viewBtn = document.createElement('button');
  viewBtn.className = 'btn';
  viewBtn.textContent = 'View Details';
  viewBtn.onclick = () => { 
    modal.classList.add('hidden'); 
    openJobViewModal(job, appt);
  };
  btns.appendChild(viewBtn);
  
  // Note button (always shown)
  const noteBtn = document.createElement('button');
  noteBtn.className = 'btn';
  noteBtn.textContent = 'Add Note';
  noteBtn.onclick = () => {
    modal.classList.add('hidden');
    if (appt) {
      currentJobNotesAppointmentId = appt.id;
      openJobAddNoteModal();
    }
  };
  btns.appendChild(noteBtn);
  
  if (isStaffUser) {
    // Staff: Only show Unclaim button (if assigned to them)
    const assignedId = job.assigned_to || job.assigned || null;
    const isAssignedToMe = assignedId && (String(assignedId) === String(currentStaffAuthId));
    
    if (isAssignedToMe) {
      const unclaimBtn = document.createElement('button');
      unclaimBtn.className = 'btn danger';
      unclaimBtn.textContent = 'Unclaim';
      unclaimBtn.onclick = async () => {
        modal.classList.add('hidden');
        const supabase = getSupabaseClient();
        const shopId = getCurrentShopId();
        
        if (supabase && shopId) {
          try {
            const { error: jobError } = await supabase
              .from('jobs')
              .update({ 
                assigned_to: null,
                updated_at: new Date().toISOString()
              })
              .eq('id', job.id);
            
            if (jobError) {
              console.error('Error unclaiming job:', jobError);
              showNotification('Failed to unclaim job', 'error');
              return;
            }
            
            const { data } = await supabase.from('data').select('jobs').eq('shop_id', shopId).single();
            const jobs = data?.jobs || [];
            const jobIndex = jobs.findIndex(j => j.id === job.id);
            if (jobIndex >= 0) {
              jobs[jobIndex].assigned_to = null;
              jobs[jobIndex].updated_at = new Date().toISOString();
              await supabase.from('data').update({ jobs }).eq('shop_id', shopId);
            }
            
            job.assigned_to = null;
            job.updated_at = new Date().toISOString();
            
            renderJobs();
            showNotification('Job unclaimed', 'success');
          } catch (e) {
            console.error('Error unclaiming job:', e);
            showNotification('Failed to unclaim job', 'error');
          }
        }
      };
      btns.appendChild(unclaimBtn);
    }
  } else {
    // Admin/Owner: Show all action buttons
    
    // Parts button
    const partsBtn = document.createElement('button');
    partsBtn.className = 'btn';
    partsBtn.textContent = 'Parts';
    partsBtn.onclick = () => { modal.classList.add('hidden'); openPartsModal(job, appt); };
    btns.appendChild(partsBtn);

    // Assign button
    const assignBtn = document.createElement('button');
    assignBtn.className = 'btn info';
    assignBtn.textContent = 'Assign';
    assignBtn.onclick = () => {
      modal.classList.add('hidden');
      openAssignModal(job);
    };
    btns.appendChild(assignBtn);

    // Add Parts Manually button
    const manualPartsBtn = document.createElement('button');
    manualPartsBtn.className = 'btn';
    manualPartsBtn.textContent = 'Add Parts Manually';
    manualPartsBtn.onclick = () => { 
      modal.classList.add('hidden'); 
      
      const pricingModal = window.partPricingModal || window.xm_partPricingModal;
      
      if (appt && pricingModal) {
        const manualPart = {
          manual_entry: true,
          name: '',
          part_name: '',
          part_number: '',
          id: 'manual'
        };
        
        const vehicle = appt.vehicle_year && appt.vehicle_make && appt.vehicle_model
          ? `${appt.vehicle_year} ${appt.vehicle_make} ${appt.vehicle_model}`
          : null;
        
        pricingModal.show(manualPart, job.id, vehicle);
      } else if (!pricingModal) {
        alert('Part pricing modal is not available. Please refresh the page.');
      } else if (!appt) {
        alert('Could not find appointment for this job.');
      }
    };
    btns.appendChild(manualPartsBtn);

    // Remove button
    const removeBtn = document.createElement('button');
    removeBtn.className = 'btn danger';
    removeBtn.textContent = 'Remove';
    removeBtn.onclick = () => { modal.classList.add('hidden'); openRemoveModal(job); };
    btns.appendChild(removeBtn);
  }
  
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
    actionsDiv.style.display = 'grid';
    actionsDiv.style.gridTemplateColumns = 'repeat(2, 1fr)';
    actionsDiv.style.gap = '4px';
    
    // View button (top-left)
    const viewBtn = document.createElement('button');
    viewBtn.className = 'btn small';
    viewBtn.textContent = 'View';
    viewBtn.onclick = () => openJobViewModal(job, appt);
    actionsDiv.appendChild(viewBtn);
    
    // Assign/Unclaim button (top-right)
    if (job.assigned_to) {
      const unclaimBtn = document.createElement('button');
      unclaimBtn.className = 'btn small danger';
      unclaimBtn.textContent = 'Unclaim';
      unclaimBtn.onclick = async () => {
        const supabase = getSupabaseClient();
        const shopId = getCurrentShopId();
        
        if (supabase && shopId) {
          try {
            // Update the jobs table
            const { error: jobError } = await supabase
              .from('jobs')
              .update({ 
                assigned_to: null,
                updated_at: new Date().toISOString()
              })
              .eq('id', job.id);
            
            if (jobError) {
              console.error('Error unclaiming job:', jobError);
              showNotification('Failed to unclaim job', 'error');
              return;
            }
            
            // Also update data table's jobs JSONB for consistency
            const { data } = await supabase.from('data').select('jobs').eq('shop_id', shopId).single();
            const jobs = data?.jobs || [];
            const jobIndex = jobs.findIndex(j => j.id === job.id);
            if (jobIndex >= 0) {
              jobs[jobIndex].assigned_to = null;
              jobs[jobIndex].updated_at = new Date().toISOString();
              await supabase.from('data').update({ jobs }).eq('shop_id', shopId);
            }
            
            // Update local
            job.assigned_to = null;
            job.updated_at = new Date().toISOString();
            
            renderJobs();
            showNotification('Job unclaimed', 'success');
            console.log('✅ Job unclaimed in jobs table');
          } catch (e) {
            console.error('Error unclaiming job:', e);
            showNotification('Failed to unclaim job', 'error');
          }
        }
      };
      actionsDiv.appendChild(unclaimBtn);
    } else {
      // For staff: show Claim button, for admin: show Assign button
      if (isStaffUser) {
        const claimBtn = document.createElement('button');
        claimBtn.className = 'btn small info';
        claimBtn.textContent = 'Claim';
        claimBtn.onclick = async () => {
          const supabase = getSupabaseClient();
          const shopId = getCurrentShopId();
          
          if (supabase && shopId) {
            try {
              // Update the jobs table - use auth_id for consistent lookups
              const { error: jobError } = await supabase
                .from('jobs')
                .update({ 
                  assigned_to: currentStaffAuthId,
                  updated_at: new Date().toISOString()
                })
                .eq('id', job.id);
              
              if (jobError) {
                console.error('Error claiming job:', jobError);
                showNotification('Failed to claim job', 'error');
                return;
              }
              
              // Also update data table's jobs JSONB for consistency
              const { data } = await supabase.from('data').select('jobs').eq('shop_id', shopId).single();
              const jobs = data?.jobs || [];
              const jobIndex = jobs.findIndex(j => j.id === job.id);
              if (jobIndex >= 0) {
                jobs[jobIndex].assigned_to = currentStaffAuthId;
                jobs[jobIndex].updated_at = new Date().toISOString();
                await supabase.from('data').update({ jobs }).eq('shop_id', shopId);
              }
              
              // Update local
              job.assigned_to = currentStaffAuthId;
              job.updated_at = new Date().toISOString();
              
              renderJobs();
              showNotification('Job claimed!', 'success');
            } catch (e) {
              console.error('Error claiming job:', e);
              showNotification('Failed to claim job', 'error');
            }
          }
        };
        actionsDiv.appendChild(claimBtn);
      } else {
        const assignBtn = document.createElement('button');
        assignBtn.className = 'btn small';
        assignBtn.textContent = 'Assign';
        assignBtn.onclick = () => openAssignModal(job);
        actionsDiv.appendChild(assignBtn);
      }
    }
    
    // Parts button (bottom-left) - Admin/Owner only
    if (!isStaffUser) {
      const partsBtn = document.createElement('button');
      partsBtn.className = 'btn small info';
      partsBtn.textContent = 'Parts';
      partsBtn.onclick = () => openPartsModal(job, appt);
      actionsDiv.appendChild(partsBtn);
    }
    
    // Note or Remove button based on role
    if (isStaffUser) {
      // Staff users get Note button
      const noteBtn = document.createElement('button');
      noteBtn.className = 'btn small secondary';
      noteBtn.setAttribute('aria-label', 'Add note');
      noteBtn.textContent = 'Note';
      noteBtn.onclick = () => openJobNoteModal(job);
      actionsDiv.appendChild(noteBtn);
    } else {
      // Admin/Owner users get Remove button
      const removeBtn = document.createElement('button');
      removeBtn.className = 'btn small danger';
      removeBtn.textContent = 'Remove';
      removeBtn.onclick = () => openRemoveModal(job);
      actionsDiv.appendChild(removeBtn);
    }
    
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
 * Open job view modal - shows appointment details with notes
 */
async function openJobViewModal(job, appt) {
  const modal = document.getElementById('jobViewModal');
  const content = document.getElementById('jobViewContent');
  
  if (!modal || !content || !appt) return;
  
  // Helper function to format time
  const formatTime12 = (time24) => {
    if (!time24) return 'Not set';
    const [h, m] = time24.split(':');
    const hour = parseInt(h, 10);
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const hour12 = hour % 12 || 12;
    return `${hour12}:${m} ${ampm}`;
  };
  
  // Helper function to get status class
  const getStatusClass = (status) => {
    const map = {
      'new': 'tag-new',
      'scheduled': 'tag-scheduled',
      'in_progress': 'tag-progress',
      'awaiting_parts': 'tag-parts',
      'completed': 'tag-done'
    };
    return map[status] || '';
  };
  
  content.innerHTML = `
    <div style="display: grid; gap: 12px;">
      <div><strong>Customer:</strong> ${appt.customer || 'N/A'}</div>
      <div><strong>Phone:</strong> ${appt.phone || 'N/A'}</div>
      <div><strong>Email:</strong> ${appt.email || 'N/A'}</div>
      <div><strong>Vehicle:</strong> ${appt.vehicle || 'N/A'}</div>
      ${appt.vin ? `<div><strong>VIN:</strong> ${appt.vin}</div>` : ''}
      <div><strong>Service:</strong> ${appt.service || 'N/A'}</div>
      <div><strong>Date:</strong> ${appt.preferred_date ? new Date(appt.preferred_date).toLocaleDateString() : 'Not set'}</div>
      <div><strong>Time:</strong> ${formatTime12(appt.preferred_time)}</div>
      <div><strong>Status:</strong> <span class="tag ${getStatusClass(appt.status)}">${appt.status || 'new'}</span></div>
      ${appt.notes ? `<div><strong>Notes:</strong><br>${appt.notes}</div>` : ''}
    </div>
    
    <div style="margin-top: 24px; padding-top: 16px; border-top: 1px solid #ddd;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
        <strong style="font-size: 15px;">Appointment Notes</strong>
        <button type="button" id="jobViewAddNoteBtn" class="btn small info">Add Note</button>
      </div>
      <div id="jobViewNotesList" style="display: flex; flex-direction: column; gap: 12px;">
        <p style="color: #666; font-style: italic; text-align: center;">Loading notes...</p>
      </div>
    </div>
  `;
  
  modal.classList.remove('hidden');
  
  // Load and render notes
  await renderJobViewNotes(appt.id);
  
  // Add note button handler
  const addNoteBtn = document.getElementById('jobViewAddNoteBtn');
  if (addNoteBtn) {
    addNoteBtn.addEventListener('click', () => {
      currentJobNotesAppointmentId = appt.id;
      openJobAddNoteModal();
    });
  }
}

/**
 * Render notes in job view modal
 */
async function renderJobViewNotes(appointmentId) {
  const container = document.getElementById('jobViewNotesList');
  if (!container) return;
  
  const notes = await loadAppointmentNotes(appointmentId);
  
  container.innerHTML = '';
  
  if (notes.length === 0) {
    container.innerHTML = '<p style="color: #666; font-style: italic; padding: 12px; text-align: center;">No notes for this appointment.</p>';
    return;
  }
  
  notes.forEach(note => {
    const notePanel = createJobViewNotePanel(note);
    container.appendChild(notePanel);
  });
}

/**
 * Load appointment notes
 */
async function loadAppointmentNotes(appointmentId) {
  const supabase = getSupabaseClient();
  if (!supabase || !appointmentId) return [];
  
  try {
    // Fetch notes
    const { data: notes, error } = await supabase
      .from('appointment_notes')
      .select('*')
      .eq('appointment_id', appointmentId)
      .order('created_at', { ascending: false });
    
    if (error) throw error;
    if (!notes || notes.length === 0) return [];
    
    // Get unique user IDs from notes
    const userIds = [...new Set(notes.map(n => n.created_by).filter(Boolean))];
    if (userIds.length === 0) return notes;
    
    // Create a map of userId -> user for easy lookup
    const userMap = new Map();
    
    // Fetch user data from users table (admins/shop owners)
    try {
      const { data: users, error: userError } = await supabase
        .from('users')
        .select('id, first, last, email')
        .in('id', userIds);
      
      if (!userError && users) {
        users.forEach(u => {
          userMap.set(u.id, {
            first_name: u.first,
            last_name: u.last,
            email: u.email
          });
        });
      }
    } catch (e) {
      console.warn('[Jobs] Could not fetch users table data:', e);
    }
    
    // Fetch user data from shop_staff table (staff members)
    try {
      const { data: staff, error: staffError } = await supabase
        .from('shop_staff')
        .select('auth_id, first_name, last_name, email')
        .in('auth_id', userIds);
      
      if (!staffError && staff) {
        staff.forEach(s => {
          if (!userMap.has(s.auth_id)) {
            userMap.set(s.auth_id, {
              first_name: s.first_name,
              last_name: s.last_name,
              email: s.email
            });
          }
        });
      }
    } catch (e) {
      console.warn('[Jobs] Could not fetch shop_staff table data:', e);
    }
    
    // Attach user data to each note
    return notes.map(note => ({
      ...note,
      user: userMap.get(note.created_by) || null
    }));
  } catch (err) {
    console.error('[Jobs] Error loading appointment notes:', err);
    return [];
  }
}

/**
 * Create a read-only note panel for job view
 */
function createJobViewNotePanel(note) {
  const panel = document.createElement('div');
  panel.style.cssText = 'border: 1px solid #ddd; border-radius: 8px; padding: 12px; background: #f9f9f9; position: relative;';
  
  // Delete button (top right)
  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'btn small danger';
  deleteBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false"><path fill="white" d="M3 6h18v2H3V6zm2 3h14l-1 12a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2l-1-12zM9 4V3a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v1h5v2H4V4h5z"/></svg>';
  deleteBtn.style.cssText = 'position: absolute; top: 8px; right: 8px; padding: 4px 8px; border-radius: 4px;';
  deleteBtn.title = 'Delete note';
  deleteBtn.onclick = (e) => {
    e.stopPropagation();
    openDeleteNoteModal(note.id);
  };
  panel.appendChild(deleteBtn);
  
  // Main content wrapper (flex row for text left, media right)
  const contentWrapper = document.createElement('div');
  contentWrapper.style.cssText = 'display: flex; gap: 16px; align-items: flex-start;';
  
  // Left side - text content
  const textContent = document.createElement('div');
  textContent.style.cssText = 'flex: 1; min-width: 0; padding-right: 30px;';
  
  // Header with author and date
  const header = document.createElement('div');
  header.style.cssText = 'display: flex; flex-direction: column; gap: 2px; margin-bottom: 8px;';
  
  const authorName = document.createElement('strong');
  authorName.style.fontSize = '14px';
  authorName.style.color = '#333';
  let userName = 'Unknown User';
  if (note.user) {
    const fullName = `${note.user.first_name || ''} ${note.user.last_name || ''}`.trim();
    userName = fullName || note.user.email || 'Unknown User';
  }
  authorName.textContent = userName;
  
  const dateInfo = document.createElement('span');
  dateInfo.style.cssText = 'font-size: 12px; color: #666;';
  const createdDate = new Date(note.created_at);
  const wasEdited = new Date(note.updated_at).getTime() !== createdDate.getTime();
  dateInfo.textContent = createdDate.toLocaleString() + (wasEdited ? ' (edited)' : '');
  
  header.appendChild(authorName);
  header.appendChild(dateInfo);
  
  // Note text content
  const content = document.createElement('p');
  content.style.cssText = 'margin: 0; font-size: 14px; line-height: 1.5; white-space: pre-wrap; color: #333;';
  content.textContent = note.note;
  
  textContent.appendChild(header);
  textContent.appendChild(content);
  contentWrapper.appendChild(textContent);
  
  // Right side - media thumbnails
  if (note.media_urls && note.media_urls.length > 0) {
    const mediaContainer = document.createElement('div');
    mediaContainer.style.cssText = 'display: flex; flex-wrap: wrap; gap: 8px; max-width: 200px; justify-content: flex-end;';
    
    note.media_urls.forEach(media => {
      const thumb = document.createElement('div');
      thumb.style.cssText = 'width: 60px; height: 60px; border-radius: 6px; overflow: hidden; cursor: pointer; background: #ddd; display: flex; align-items: center; justify-content: center; flex-shrink: 0;';
      
      if (media.type === 'video') {
        // Video thumbnail with play icon
        thumb.innerHTML = `
          <div style="position: relative; width: 100%; height: 100%;">
            <video src="${media.url}" style="width: 100%; height: 100%; object-fit: cover;"></video>
            <div style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); background: rgba(0,0,0,0.6); border-radius: 50%; width: 24px; height: 24px; display: flex; align-items: center; justify-content: center;">
              <span style="color: white; font-size: 12px; margin-left: 2px;">▶</span>
            </div>
          </div>
        `;
      } else {
        // Image thumbnail
        const img = document.createElement('img');
        img.src = media.url;
        img.style.cssText = 'width: 100%; height: 100%; object-fit: cover;';
        img.alt = 'Note attachment';
        thumb.appendChild(img);
      }
      
      thumb.onclick = (e) => {
        e.stopPropagation();
        openMediaPreview(media.url, media.type);
      };
      
      mediaContainer.appendChild(thumb);
    });
    
    contentWrapper.appendChild(mediaContainer);
  }
  
  panel.appendChild(contentWrapper);
  
  return panel;
}

/**
 * Close job view modal
 */
function closeJobViewModal() {
  const modal = document.getElementById('jobViewModal');
  if (modal) modal.classList.add('hidden');
}

// Make it global for onclick
window.closeJobViewModal = closeJobViewModal;

/**
 * Open modal to add a job note (from table action button)
 */
function openJobNoteModal(job) {
  // Find appointment for this job
  const appt = allAppointments.find(a => a.id === job.appointment_id);
  if (appt) {
    currentJobNotesAppointmentId = appt.id;
  }
  openJobAddNoteModal();
}

/**
 * Open modal to add a job note
 */
function openJobAddNoteModal() {
  const modal = document.getElementById('jobNoteModal');
  const title = document.getElementById('jobNoteModalTitle');
  const textarea = document.getElementById('jobNoteText');
  
  if (!modal || !title || !textarea) return;
  
  title.textContent = 'Add Note';
  textarea.value = '';
  modal.classList.remove('hidden');
  textarea.focus();
}

/**
 * Close job note modal
 */
function closeJobNoteModal() {
  const modal = document.getElementById('jobNoteModal');
  if (modal) modal.classList.add('hidden');
  // Clear media selections
  pendingNoteMedia = [];
  const preview = document.getElementById('jobNoteMediaPreview');
  if (preview) preview.innerHTML = '';
  const count = document.getElementById('jobNoteMediaCount');
  if (count) count.textContent = 'No files selected';
  const input = document.getElementById('jobNoteMedia');
  if (input) input.value = '';
}

// Make it global for onclick
window.closeJobNoteModal = closeJobNoteModal;

// Pending media files for note upload
let pendingNoteMedia = [];
let noteToDeleteId = null;

/**
 * Handle media file selection for notes
 */
function handleNoteMediaSelect(input) {
  const files = Array.from(input.files);
  const preview = document.getElementById('jobNoteMediaPreview');
  const count = document.getElementById('jobNoteMediaCount');
  
  if (files.length === 0) {
    pendingNoteMedia = [];
    if (preview) preview.innerHTML = '';
    if (count) count.textContent = 'No files selected';
    return;
  }
  
  // Validate file sizes (max 10MB each)
  const maxSize = 10 * 1024 * 1024;
  const validFiles = files.filter(f => {
    if (f.size > maxSize) {
      alert(`File "${f.name}" is too large. Maximum size is 10MB.`);
      return false;
    }
    return true;
  });
  
  pendingNoteMedia = validFiles;
  
  if (count) {
    count.textContent = `${validFiles.length} file${validFiles.length !== 1 ? 's' : ''} selected`;
  }
  
  // Show previews
  if (preview) {
    preview.innerHTML = '';
    validFiles.forEach((file, idx) => {
      const thumb = document.createElement('div');
      thumb.style.cssText = 'position: relative; width: 60px; height: 60px; border-radius: 6px; overflow: hidden; background: #ddd;';
      
      if (file.type.startsWith('video/')) {
        // Video preview
        const video = document.createElement('video');
        video.src = URL.createObjectURL(file);
        video.style.cssText = 'width: 100%; height: 100%; object-fit: cover;';
        thumb.appendChild(video);
        // Add play icon overlay
        const playIcon = document.createElement('div');
        playIcon.style.cssText = 'position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); background: rgba(0,0,0,0.6); border-radius: 50%; width: 20px; height: 20px; display: flex; align-items: center; justify-content: center;';
        playIcon.innerHTML = '<span style="color: white; font-size: 10px; margin-left: 2px;">▶</span>';
        thumb.appendChild(playIcon);
      } else {
        // Image preview
        const img = document.createElement('img');
        img.src = URL.createObjectURL(file);
        img.style.cssText = 'width: 100%; height: 100%; object-fit: cover;';
        thumb.appendChild(img);
      }
      
      // Remove button
      const removeBtn = document.createElement('button');
      removeBtn.innerHTML = '&times;';
      removeBtn.style.cssText = 'position: absolute; top: 2px; right: 2px; width: 18px; height: 18px; border-radius: 50%; background: rgba(0,0,0,0.6); color: white; border: none; cursor: pointer; font-size: 12px; line-height: 1; padding: 0;';
      removeBtn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        pendingNoteMedia.splice(idx, 1);
        // Re-render previews
        handleNoteMediaSelect({ files: pendingNoteMedia });
      };
      thumb.appendChild(removeBtn);
      
      preview.appendChild(thumb);
    });
  }
}

window.handleNoteMediaSelect = handleNoteMediaSelect;

/**
 * Upload media files to Supabase storage
 */
async function uploadNoteMedia(files, appointmentId) {
  console.log('[NoteMedia] Starting upload for', files.length, 'files');
  
  const supabase = getSupabaseClient();
  if (!supabase || !files.length) {
    console.log('[NoteMedia] No supabase client or no files');
    return [];
  }
  
  const shopId = getCurrentShopId();
  console.log('[NoteMedia] Shop ID:', shopId, 'Appointment ID:', appointmentId);
  
  const uploadedMedia = [];
  
  for (const file of files) {
    try {
      console.log('[NoteMedia] Uploading file:', file.name, 'Type:', file.type, 'Size:', file.size);
      
      const fileExt = file.name.split('.').pop();
      const fileName = `${shopId}/${appointmentId}/${Date.now()}_${Math.random().toString(36).substr(2, 9)}.${fileExt}`;
      
      console.log('[NoteMedia] Target path:', fileName);
      
      const { data, error } = await supabase.storage
        .from('note-media')
        .upload(fileName, file, {
          cacheControl: '3600',
          upsert: false,
          contentType: file.type
        });
      
      if (error) {
        console.error('[NoteMedia] Upload error:', error);
        showNotification(`Failed to upload ${file.name}: ${error.message}`, 'error');
        continue;
      }
      
      console.log('[NoteMedia] Upload successful:', data);
      
      // Get public URL
      const { data: urlData } = supabase.storage
        .from('note-media')
        .getPublicUrl(fileName);
      
      console.log('[NoteMedia] Public URL:', urlData?.publicUrl);
      
      if (urlData?.publicUrl) {
        uploadedMedia.push({
          url: urlData.publicUrl,
          type: file.type.startsWith('video/') ? 'video' : 'image',
          name: file.name
        });
      }
    } catch (err) {
      console.error('[NoteMedia] Exception during upload:', err);
      showNotification(`Error uploading ${file.name}`, 'error');
    }
  }
  
  console.log('[NoteMedia] Upload complete, uploaded:', uploadedMedia.length, 'files');
  return uploadedMedia;
}

/**
 * Open media preview modal
 */
function openMediaPreview(url, type) {
  const modal = document.getElementById('mediaPreviewModal');
  const content = document.getElementById('mediaPreviewContent');
  
  if (!modal || !content) return;
  
  content.innerHTML = '';
  
  if (type === 'video') {
    const video = document.createElement('video');
    video.src = url;
    video.controls = true;
    video.autoplay = true;
    video.style.cssText = 'max-width: 100%; max-height: 85vh;';
    content.appendChild(video);
  } else {
    const img = document.createElement('img');
    img.src = url;
    img.style.cssText = 'max-width: 100%; max-height: 85vh; object-fit: contain;';
    img.alt = 'Note attachment';
    content.appendChild(img);
  }
  
  modal.classList.remove('hidden');
}

window.openMediaPreview = openMediaPreview;

/**
 * Close media preview modal
 */
function closeMediaPreview() {
  const modal = document.getElementById('mediaPreviewModal');
  if (modal) {
    modal.classList.add('hidden');
    // Stop any playing videos
    const video = modal.querySelector('video');
    if (video) video.pause();
  }
}

window.closeMediaPreview = closeMediaPreview;

/**
 * Open delete note confirmation modal
 */
function openDeleteNoteModal(noteId) {
  noteToDeleteId = noteId;
  const modal = document.getElementById('deleteNoteModal');
  if (modal) modal.classList.remove('hidden');
}

window.openDeleteNoteModal = openDeleteNoteModal;

/**
 * Close delete note modal
 */
function closeDeleteNoteModal() {
  const modal = document.getElementById('deleteNoteModal');
  if (modal) modal.classList.add('hidden');
  noteToDeleteId = null;
}

window.closeDeleteNoteModal = closeDeleteNoteModal;

/**
 * Confirm and delete the note
 */
async function confirmDeleteNote() {
  if (!noteToDeleteId) return;
  
  const supabase = getSupabaseClient();
  if (!supabase) {
    showNotification('Unable to delete note. Please try again.', 'error');
    return;
  }
  
  try {
    const { error } = await supabase
      .from('appointment_notes')
      .delete()
      .eq('id', noteToDeleteId);
    
    if (error) throw error;
    
    closeDeleteNoteModal();
    
    // Refresh notes list
    if (currentJobNotesAppointmentId) {
      await renderJobViewNotes(currentJobNotesAppointmentId);
    }
    
    showNotification('Note deleted', 'success');
  } catch (err) {
    console.error('[Jobs] Error deleting note:', err);
    showNotification('Failed to delete note. Please try again.', 'error');
  }
}

window.confirmDeleteNote = confirmDeleteNote;

/**
 * Save job note
 */
async function saveJobNote(e) {
  if (e) e.preventDefault();
  
  const textarea = document.getElementById('jobNoteText');
  const saveBtn = document.getElementById('saveJobNoteBtn');
  const noteText = textarea.value.trim();
  
  if (!noteText && pendingNoteMedia.length === 0) {
    showNotification('Please enter a note or add media.', 'error');
    return;
  }
  
  const supabase = getSupabaseClient();
  const authId = await getCurrentAuthId();
  
  if (!supabase || !authId || !currentJobNotesAppointmentId) {
    showNotification('Unable to save note. Please try again.', 'error');
    return;
  }
  
  // Disable save button and show loading
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';
  }
  
  try {
    // Upload media files if any
    let mediaUrls = [];
    if (pendingNoteMedia.length > 0) {
      mediaUrls = await uploadNoteMedia(pendingNoteMedia, currentJobNotesAppointmentId);
    }
    
    // Create new note with media
    const noteData = {
      appointment_id: currentJobNotesAppointmentId,
      note: noteText || '(Media attached)',
      created_by: authId
    };
    
    // Add media_urls if we have any
    if (mediaUrls.length > 0) {
      noteData.media_urls = mediaUrls;
    }
    
    const { error } = await supabase
      .from('appointment_notes')
      .insert(noteData);
    
    if (error) throw error;
    
    // Refresh notes list
    await renderJobViewNotes(currentJobNotesAppointmentId);
    closeJobNoteModal();
    showNotification('Note saved successfully', 'success');
    
  } catch (err) {
    console.error('[Jobs] Error saving note:', err);
    showNotification('Failed to save note. Please try again.', 'error');
  } finally {
    // Re-enable save button
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save';
    }
  }
}

// Make it global for onclick
window.saveJobNote = saveJobNote;

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
  // Create notification for status changes (awaiting_parts and completed)
  if (newStatus === 'awaiting_parts' || newStatus === 'completed') {
    try {
      const shopId = getCurrentShopId();
      const authId = await getCurrentAuthId();
      const job = allJobs[index];
      const appt = allAppointments.find(a => a.id === job.appointment_id);
      
      const titles = {
        'awaiting_parts': 'Job Awaiting Parts',
        'completed': 'Job Completed'
      };
      
      const messages = {
        'awaiting_parts': `Job for ${appt?.customer || 'customer'}'s ${appt?.vehicle || 'vehicle'} is awaiting parts. Review parts needed and place order.`,
        'completed': `Job for ${appt?.customer || 'customer'}'s ${appt?.vehicle || 'vehicle'} has been completed and is ready for invoicing.`
      };
      
      await createShopNotification({
        supabase: getSupabaseClient(),
        shopId,
        type: `job_${newStatus}`,
        category: 'job',
        title: titles[newStatus],
        message: messages[newStatus],
        relatedId: job.id,
        relatedType: 'job',
        metadata: {
          customer_name: appt?.customer || '',
          vehicle: appt?.vehicle || '',
          service: appt?.service || '',
          job_id: job.id,
          old_status: job.status,
          new_status: newStatus
        },
        priority: newStatus === 'awaiting_parts' ? 'high' : 'normal',
        createdBy: authId
        // No recipientUserId = sends to all shop owners
      });
    } catch (error) {
      console.error('[Jobs] Error creating status notification:', error);
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
      <div class="modal-content" onclick="event.stopPropagation()" style="max-width:420px;width:100%;min-width:0;padding:0 18px;box-sizing:border-box;margin:10vh auto; border-radius:12px;">
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
            <button id="assignConfirmBtn" class="btn info" style="width:100%;font-size:1.08rem;padding:14px 0;display:flex;align-items:center;justify-content:center;">Assign</button>
            <button id="assignCancelBtn" class="btn" style="width:100%;font-size:1.08rem;padding:14px 0;display:flex;align-items:center;justify-content:center;">Cancel</button>
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
        select.innerHTML = '<option value="">-- Select staff --</option>' + staffRows.map(s => `<option value="${s.id}">${(s.first||'').trim()} ${(s.last||'').trim()}${s.role ? ' - ' + s.role : ''}</option>`).join('');
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
  
  // Create notification for assigned technician
  try {
    const shopId = getCurrentShopId();
    const authId = await getCurrentAuthId();
    const job = allJobs[index];
    const appt = allAppointments.find(a => a.id === job.appointment_id);
    
    await createShopNotification({
      supabase: getSupabaseClient(),
      shopId,
      type: 'job_assigned',
      category: 'job',
      title: 'New Job Assigned',
      message: `You have been assigned to work on ${appt?.customer || 'a customer'}'s ${appt?.vehicle || 'vehicle'} - ${appt?.service || 'Service request'}`,
      relatedId: job.id,
      relatedType: 'job',
      metadata: {
        customer_name: appt?.customer || '',
        vehicle: appt?.vehicle || '',
        service: appt?.service || '',
        job_id: job.id
      },
      priority: 'high',
      createdBy: authId,
      recipientUserId: userId // Notify the assigned technician
    });
  } catch (error) {
    console.error('[Jobs] Error creating assignment notification:', error);
  }
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
    // Add part to invoice and get its ID for linking
    const partItemId = await addPartToInvoice(jobId, partName, partQty, partPrice, undefined, partName);
    // Part added to invoice
    // Close add parts modal
    closeAddPartsModal();
    // Open labor modal with part ID for linking
    openLaborModal(jobId, partItemId, partName);
    // Opened labor modal (user action)
  } catch (error) {
    console.error('Error adding part to invoice:', error);
    document.getElementById('addPartsNote').textContent = 'Error adding part to invoice';
  }
}

/**
 * Open labor modal
 * @param {string} jobId - The job ID
 * @param {string} partItemId - Optional part item ID to link labor with
 * @param {string} partName - Optional part name for display
 */
async function openLaborModal(jobId, partItemId, partName) {
  console.log('[openLaborModal] called with jobId:', jobId);
  const modal = document.getElementById('laborModal');
  const overlay = document.getElementById('laborModalOverlay');
  if (!modal) {
    console.error('[openLaborModal] laborModal element not found!');
    return;
  }
  
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
    // Attempt to fetch latest settings from Supabase (if available) to avoid stale local cache
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
          const fetchedSettings = dataRecord.settings || {};
          const fetchedRates = fetchedSettings.labor_rates || [];
          // Always replace local cached settings with authoritative Supabase settings
          settings = fetchedSettings;
          rates = fetchedRates;
          console.log('[openLaborModal] loaded labor_rates from Supabase:', rates);
          try {
            const localData = JSON.parse(localStorage.getItem('xm_data') || '{}');
            localData.settings = Object.assign(localData.settings || {}, settings);
            localStorage.setItem('xm_data', JSON.stringify(localData));
          } catch (e) { /* ignore local cache failures */ }
        }
      }
    } catch (e) {
      console.warn('[openLaborModal] Supabase fetch failed', e);
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
  
  // Store current job and part linkage info
  modal.dataset.jobId = jobId;
  modal.dataset.partItemId = partItemId || '';
  modal.dataset.partName = partName || '';
  
  // Update modal title if linking to a part
  const modalTitle = modal.querySelector('h3');
  if (modalTitle && partName) {
    modalTitle.textContent = `Add Labor for: ${partName}`;
  } else if (modalTitle) {
    modalTitle.textContent = 'Add Labor';
  }
  
  // Show overlay and modal
  if (overlay) overlay.style.display = 'block';
  modal.classList.remove('hidden');
  modal.style.display = 'block';
  console.log('[openLaborModal] Modal opened successfully');
}

/**
 * Handle add labor
 */
async function handleAddLabor() {
  const modal = document.getElementById('laborModal');
  const jobId = modal?.dataset.jobId;
  if (!jobId) return;
  
  const partItemId = modal?.dataset.partItemId || null;
  const partName = modal?.dataset.partName || null;
  
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
    // Use the option value (preset name) rather than the display text (which includes price)
    finalDesc = sel.value || sel.selectedOptions[0]?.value || '';
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
    // Add labor to invoice, linking to part if applicable
    await addLaborToInvoice(jobId, finalDesc, labHours, labRate, partItemId);
    // Labor added to invoice
    // Close labor modal
    const overlay = document.getElementById('laborModalOverlay');
    if (overlay) overlay.style.display = 'none';
    modal.style.display = 'none';
    // Clear modal data attributes
    delete modal.dataset.partItemId;
    delete modal.dataset.partName;
    // Show success notification
    const message = partItemId ? `${partName} (Part & Labor) added to invoice successfully!` : 'Labor added to invoice successfully!';
    showNotification(message, 'success');
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
 * @param {string} jobId - The job ID
 * @param {string} partName - Name of the part
 * @param {number} quantity - Quantity
 * @param {number} price - Price per unit
 * @param {number} cost - Cost price (optional)
 * @param {string} groupName - Optional group name for P&R (Part & Replace) grouping
 * @param {boolean} inventoryAlreadyDeducted - If true, skip inventory deduction (already handled)
 * @returns {Promise<string>} - Returns the part item ID for linking
 */
async function addPartToInvoice(jobId, partName, quantity, price, cost, groupName, inventoryAlreadyDeducted = false) {
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
  
  // Generate unique ID for this item
  const itemId = `item_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  // Add part item to invoice
  const partItem = {
    id: itemId,
    name: partName,
    qty: quantity,
    price: price,
    cost_price: (typeof cost !== 'undefined') ? Number(cost) : undefined,
    type: 'part',
    groupName: groupName || partName, // Store group name for invoice display
    inventoryAlreadyDeducted: inventoryAlreadyDeducted // Track if inventory was already deducted
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
  
  // Show success notification (only if inventory wasn't already deducted)
  // This prevents duplicate success messages when inventory was handled by addInventoryToJob
  if (!inventoryAlreadyDeducted) {
    try { showNotification('Part added to invoice', 'success'); } catch (e) {}
  }
  
  // Return item ID for linking with labor
  return itemId;
}

/**
 * Add labor to invoice
 * @param {string} jobId - The job ID
 * @param {string} description - Labor description
 * @param {number} hours - Hours of labor
 * @param {number} rate - Hourly rate
 * @param {string} linkedItemId - Optional ID of the part item to link with
 * @param {string} groupName - Optional group name for P&R grouping
 */
async function addLaborToInvoice(jobId, description, hours, rate, linkedItemId, groupName) {
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
    id: `item_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    // Store the description WITHOUT 'Labor:' prefix so it matches saved labor rates in settings
    name: description,
    qty: hours,
    price: rate,
    type: 'labor',
    linkedItemId: linkedItemId || undefined, // Link to part if provided
    groupName: groupName || undefined // Store group name for P&R display
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
 * Close service modal
 */
function closeServiceModal() {
  const serviceModal = document.getElementById('serviceModal');
  if (serviceModal) {
    serviceModal.classList.add('hidden');
  }
}

/**
 * Open service modal and populate available services
 */
async function openServiceModal() {
  const serviceModal = document.getElementById('serviceModal');
  const serviceContainer = document.getElementById('serviceOptionsContainer');
  
  if (!serviceModal || !serviceContainer) return;
  
  // Get available services from shop settings
  const supabase = getSupabaseClient();
  const shopId = getCurrentShopId();
  let services = [];
  
  try {
    if (supabase && shopId) {
      const { data } = await supabase.from('data').select('settings').eq('shop_id', shopId).single();
      if (data?.settings?.services && Array.isArray(data.settings.services)) {
        services = data.settings.services;
      }
    }
  } catch (e) {
    // Fallback to localStorage
    const localData = JSON.parse(localStorage.getItem('xm_data') || '{}');
    services = (localData.settings?.services) || [];
  }
  
  // Populate service options
  serviceContainer.innerHTML = '';
  
  if (services.length === 0) {
    serviceContainer.innerHTML = '<p style="color: var(--muted); font-size: 0.9rem;">No services configured in your shop settings.</p>';
    serviceModal.classList.remove('hidden');
    return;
  }
  
  services.forEach(service => {
    const btn = document.createElement('button');
    btn.className = 'btn';
    btn.type = 'button';
    btn.style.textAlign = 'left';
    btn.style.display = 'flex';
    btn.style.justifyContent = 'space-between';
    btn.style.alignItems = 'center';
    
    const serviceName = service.name || service;
    const servicePrice = service.price || 0;
    
    btn.innerHTML = `
      <span>${serviceName}</span>
      <span style="font-size: 0.9rem; color: var(--muted);">$${parseFloat(servicePrice).toFixed(2)}</span>
    `;
    
    btn.addEventListener('click', () => handleServiceSelection(service, serviceModal));
    serviceContainer.appendChild(btn);
  });
  
  serviceModal.classList.remove('hidden');
}

/**
 * Handle service selection
 */
async function handleServiceSelection(service, serviceModal) {
  try {
    // Get current job from partsModalHandler
    const partsHandler = window.partsModalHandler;
    if (!partsHandler || !partsHandler.currentJob) {
      showNotification('No job selected', 'error');
      return;
    }
    
    const currentJob = partsHandler.currentJob;
    const appointment = allAppointments.find(a => a.id === currentJob.appointment_id);
    
    if (!appointment) {
      showNotification('Appointment not found', 'error');
      return;
    }
    
    // Instead of adding immediately, open the Customize Service flow so user can add parts/labor or skip.
    const serviceName = service.name || service;
    const servicePrice = parseFloat(service.price) || 0;

    newServiceDraft = { name: serviceName, price: servicePrice, type: 'service', qty: 1 };

    // Close service modal and any parts modal overlay, then show the add-flow modal
    closeServiceModal();
    const partsModal = document.getElementById('partsModal');
    const partsOverlay = document.getElementById('partsModalOverlay');
    if (partsModal) partsModal.classList.add('hidden');
    if (partsOverlay) partsOverlay.style.display = 'none';

    const flow = document.getElementById('serviceAddFlowModal');
    if (flow) flow.classList.remove('hidden');
  } catch (error) {
    console.error('Error adding service:', error);
    showNotification('Failed to add service', 'error');
  }
}

/**
 * Setup jobs page
 */
async function setupJobs() {
  console.log('💼 Setting up Jobs page...');
  
  // Check if current user is staff (not admin) - use async version to get role from Supabase
  const currentUser = await getCurrentUserWithRole();
  isStaffUser = currentUser.role === 'staff';
  currentStaffUserId = currentUser.id;
  currentStaffAuthId = currentUser.auth_id || currentUser.id; // Store auth_id for consistent lookups
  // Set global for other components to check
  window.xm_isStaffUser = isStaffUser;
  // Also store in session for partsModalHandler
  try {
    const session = JSON.parse(localStorage.getItem('xm_session') || '{}');
    session.role = currentUser.role;
    localStorage.setItem('xm_session', JSON.stringify(session));
  } catch (e) {}
  console.log(`👤 User role: ${currentUser.role || 'unknown'}, isStaffUser: ${isStaffUser}`);
  
  // For staff: hide supplier and dealer sections in parts modal
  if (isStaffUser) {
    const supplierSection = document.getElementById('supplierQuickLinks');
    if (supplierSection) supplierSection.style.display = 'none';
    
    // Also hide the "Add Parts Manually" button - staff can only add from inventory or add service
    const addPartsManuallyBtn = document.getElementById('openAddPartsFromFinder');
    if (addPartsManuallyBtn) addPartsManuallyBtn.style.display = 'none';
  }
  
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
      // Close the find parts modal and open partPricingModal
      closePartsModal();
      // Get the job ID from the parts modal that was just closed
      const jobId = document.getElementById('partsModal').dataset.jobId;
      if (jobId) {
        const job = allJobs.find(j => j.id === jobId);
        const appt = allAppointments.find(a => a.id === job?.appointment_id);
        if (job && appt) {
          // Use partPricingModal instead of old addPartsModal
          const pricingModal = window.partPricingModal || window.xm_partPricingModal;
          
          if (pricingModal) {
            const manualPart = {
              manual_entry: true,
              name: '',
              part_name: '',
              part_number: '',
              id: 'manual'
            };
            
            const vehicle = appt.vehicle_year && appt.vehicle_make && appt.vehicle_model
              ? `${appt.vehicle_year} ${appt.vehicle_make} ${appt.vehicle_model}`
              : null;
            
            pricingModal.show(manualPart, job.id, vehicle);
          }
        }
      }
    });
  }
  
  const openAddServiceFromFinderBtn = document.getElementById('openAddServiceFromFinder');
  if (openAddServiceFromFinderBtn) {
    openAddServiceFromFinderBtn.addEventListener('click', openServiceModal);
  }
  
  const closeLabBtn = document.getElementById('labClose');
  if (closeLabBtn) {
    closeLabBtn.addEventListener('click', () => {
      const laborModal = document.getElementById('laborModal');
      const overlay = document.getElementById('laborModalOverlay');
      if (overlay) overlay.style.display = 'none';
      if (laborModal) {
        laborModal.classList.add('hidden');
        laborModal.style.display = 'none';
      }
    });
  }
  
  // Close labor modal when clicking overlay
  const laborOverlay = document.getElementById('laborModalOverlay');
  if (laborOverlay) {
    laborOverlay.addEventListener('click', (e) => {
      if (e.target === laborOverlay) {
        const laborModal = document.getElementById('laborModal');
        laborOverlay.style.display = 'none';
        if (laborModal) {
          laborModal.classList.add('hidden');
          laborModal.style.display = 'none';
        }
      }
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
  window.openLaborModal = openLaborModal;
  window.openServiceModal = openServiceModal;
  window.closeServiceModal = closeServiceModal;

  function initJobsDOMBindings() {
    // New service draft used across the add-flow (module-level `newServiceDraft` is used)

    // 'Other' input + confirm in service modal (inline add)
    const otherServiceInput = document.getElementById('otherServiceInput');
    const otherServiceConfirm = document.getElementById('otherServiceConfirm');
    const otherServiceRate = document.getElementById('otherServiceRate');
    console.log('[jobs] DOMContentLoaded: otherServiceInput=', !!otherServiceInput, 'otherServiceConfirm=', !!otherServiceConfirm, 'otherServiceRate=', !!otherServiceRate);
    if (otherServiceConfirm && otherServiceInput) {
      // When user clicks the checkmark, show a small confirm modal asking whether to save this service.
      otherServiceConfirm.addEventListener('click', async () => {
        const name = otherServiceInput.value.trim();
        const price = parseFloat((otherServiceRate && otherServiceRate.value) || 0) || 0;
        if (!name) { alert('Please enter a service name.'); return; }

        // Append the service in the UI immediately so it appears like regular services
        const serviceContainer = document.getElementById('serviceOptionsContainer');
        if (serviceContainer) {
          const svc = { name, price };
          const btn = document.createElement('button');
          btn.className = 'btn';
          btn.type = 'button';
          btn.style.textAlign = 'left';
          btn.style.display = 'flex';
          btn.style.justifyContent = 'space-between';
          btn.style.alignItems = 'center';
          btn.innerHTML = `\n              <span>${svc.name}</span>\n              <span style="font-size: 0.9rem; color: var(--muted);">$${parseFloat(svc.price||0).toFixed(2)}</span>\n            `;
          btn.addEventListener('click', () => handleServiceSelection(svc, document.getElementById('serviceModal')));
          serviceContainer.appendChild(btn);
        }

        // Prepare draft used by the add-flow
        newServiceDraft = { name, price, type: 'service', qty: 1 };
        // Close service modal and show the save-confirm modal
        document.getElementById('serviceModal').classList.add('hidden');
        const confirmModal = document.getElementById('saveServiceConfirmModal');
        if (confirmModal) {
          confirmModal.classList.remove('hidden');

          // Wire buttons (overwrite previous handlers safely)
          const yes = document.getElementById('saveServiceYesBtn');
          const no = document.getElementById('saveServiceNoBtn');

          yes.onclick = async () => {
            try {
              await addServiceToSettings(name, price);
              showNotification('Service saved to settings', 'success');
            } catch (e) {
              console.error('[jobs] Failed to save service:', e);
              showNotification('Failed to save service', 'error');
            }
            confirmModal.classList.add('hidden');
            document.getElementById('serviceAddFlowModal').classList.remove('hidden');
          };

          no.onclick = () => {
            // Do not persist, just proceed to add-flow
            confirmModal.classList.add('hidden');
            document.getElementById('serviceAddFlowModal').classList.remove('hidden');
          };
        } else {
          // Fallback: directly open add-flow
          document.getElementById('serviceAddFlowModal').classList.remove('hidden');
        }
      });
    }

    // Close new service modal (kept for compatibility)
    window.closeNewServiceModal = function() {
      document.getElementById('newServiceModal').classList.add('hidden');
      document.getElementById('serviceModal').classList.remove('hidden');
    };

    // Close service add flow modal
    window.closeServiceAddFlowModal = function() {
      document.getElementById('serviceAddFlowModal').classList.add('hidden');
    };

    // Handle Add in new service modal (legacy path)
    const confirmAddServiceBtn = document.getElementById('confirmAddServiceBtn');
    if (confirmAddServiceBtn) {
      confirmAddServiceBtn.addEventListener('click', async () => {
        const name = document.getElementById('newServiceName').value.trim();
        const rate = parseFloat(document.getElementById('newServiceRate').value);
        if (!name || isNaN(rate)) {
          alert('Please enter a service name and rate.');
          return;
        }
        newServiceDraft = { name, price: rate, type: 'service', qty: 1 };
        document.getElementById('newServiceModal').classList.add('hidden');
        document.getElementById('serviceAddFlowModal').classList.remove('hidden');
      });
    }

    // Handle Add Parts to Service
    document.getElementById('addPartsToServiceBtn').addEventListener('click', () => {
      // Open partPricingModal for custom part
      if (window.partPricingModal) {
        // Hide the service flow and open the part pricing modal; do NOT auto-reshow the flow here.
        document.getElementById('serviceAddFlowModal').classList.add('hidden');
        window.partPricingModal.show({ manual_entry: true, name: '', part_name: '', part_number: '', id: 'manual' }, null, null);
      } else {
        // Fallback: just hide the service flow
        document.getElementById('serviceAddFlowModal').classList.add('hidden');
      }
    });
    // Run bindings immediately (invoked after function ends)

    // Handle Add Labor to Service
    document.getElementById('addLaborToServiceBtn').addEventListener('click', async () => {
      // Hide the service flow and open the labor modal using openLaborModal so it populates rates
      document.getElementById('serviceAddFlowModal').classList.add('hidden');
      const partsHandler = window.partsModalHandler;
      const jobId = partsHandler?.currentJob?.id || null;
      // Show overlay and open labor modal (which populates rates)
      try {
        await openLaborModal(jobId);
      } catch (e) {
        console.error('[jobs] Failed to open labor modal:', e);
        // Fallback: show modal directly
        const overlay = document.getElementById('laborModalOverlay'); if (overlay) overlay.style.display = 'block';
        const lm = document.getElementById('laborModal'); if (lm) { lm.classList.remove('hidden'); lm.style.display = 'block'; }
      }
    });

    // Handle Skip & Add to Invoice
    document.getElementById('skipToInvoiceBtn').addEventListener('click', async () => {
      if (!newServiceDraft) return;
      // Add the new service to the current job's invoice
      const partsHandler = window.partsModalHandler;
      if (!partsHandler || !partsHandler.currentJob) {
        alert('No job selected');
        return;
      }
      const currentJob = partsHandler.currentJob;
      const appointment = allAppointments.find(a => a.id === currentJob.appointment_id);
      if (!appointment) {
        alert('Appointment not found');
        return;
      }
      let invoice = await getInvoiceForAppointment(appointment.id);
      if (!invoice) {
        invoice = await createInvoiceForAppointment(appointment);
      }
      if (!invoice) {
        alert('Could not create invoice');
        return;
      }
      invoice.items = invoice.items || [];
      invoice.items.push({ ...newServiceDraft, id: `item_${Date.now()}_${Math.random().toString(36).substr(2, 9)}` });
      await saveInvoice(invoice);
      // Close the flow modal and notify
      closeServiceAddFlowModal();
      showNotification(`Service "${newServiceDraft.name}" added to invoice`, 'success');
      newServiceDraft = null;
    });

  }

  // Run bindings immediately
  initJobsDOMBindings();

  console.log('✅ Jobs page setup complete');
}

// Persist a service preset into settings (data table) from Jobs page
async function addServiceToSettings(name, price) {
  if (!name) throw new Error('Name required');
  try {
    const supabase = getSupabaseClient();
    const shopId = getCurrentShopId();
    if (!supabase || !shopId) throw new Error('Supabase client or shop ID not available');

    // Load current data from Supabase
    const { data, error } = await supabase.from('data').select('*').eq('shop_id', shopId).single();
    if (error && error.code !== 'PGRST116') throw error;

    const settings = (data?.settings) || {};
    settings.services = settings.services || [];
    if (settings.services.some(s => s.name === name)) {
      // Already exists - nothing to do
      return true;
    }

    settings.services.push({ name: name, price: price });

    const payload = {
      shop_id: shopId,
      settings: settings,
      appointments: data?.appointments || [],
      jobs: data?.jobs || [],
      threads: data?.threads || [],
      invoices: data?.invoices || [],
      updated_at: new Date().toISOString()
    };

    const { error: upErr } = await supabase.from('data').upsert(payload, { onConflict: 'shop_id' });
    if (upErr) throw upErr;

    // notify other pages
    window.dispatchEvent(new Event('xm_data_updated'));
    return true;
  } catch (ex) {
    console.error('[jobs] addServiceToSettings failed:', ex);
    throw ex;
  }
}

export { setupJobs, saveJobs };
