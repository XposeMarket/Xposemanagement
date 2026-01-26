import { getSupabaseClient } from '../helpers/supabase.js';
import { inspectionForm } from '../components/inspectionFormModal.js';
import { getInspectionSummary, checkForInspection } from '../helpers/inspection-api.js';
import { openDiagnosticsModal } from '../components/diagnostics/DiagnosticsModal.js';

let supabase = null;
let authId = null;
let shopId = null;
let allJobs = [];
let allAppointments = [];

// Mobile action modal tracking
let currentActionJob = null;
let currentActionAppt = null;

// Polling intervals
let dataPollingInterval = null;
let notesPollingInterval = null;
const DATA_POLL_INTERVAL = 15000; // 15 seconds
const NOTES_POLL_INTERVAL = 15000; // 15 seconds

// Track seen job IDs to detect new ones
let seenJobIds = new Set();
let lastKnownDataHash = null;
let lastKnownNotesHash = null;

// Track new jobs for highlighting (job ID -> timestamp when first seen)
let newJobHighlights = new Map();
const HIGHLIGHT_DURATION = 8000; // 8 seconds

// Pending media files for note upload (staff jobs)
let pendingJobNoteMedia = [];
// Pending send-to roles for note modal (shared with other pages)
if (!window.pendingJobNoteSendTo) window.pendingJobNoteSendTo = new Set();

// ========== Read Notes Tracking (copied from jobs/appointments pages) ==========
function getReadNotesKey() {
  const userId = localStorage.getItem('xm_user_id') || 'anonymous';
  return `xm_read_notes_${userId}`;
}

function getReadNoteIds() {
  try {
    const data = localStorage.getItem(getReadNotesKey());
    return new Set(data ? JSON.parse(data) : []);
  } catch (e) {
    return new Set();
  }
}

function markNoteAsRead(noteId) {
  const readIds = getReadNoteIds();
  readIds.add(noteId);
  localStorage.setItem(getReadNotesKey(), JSON.stringify([...readIds]));
}

function isNoteRead(noteId) {
  return getReadNoteIds().has(noteId);
}

const NOTE_ROLES = [
  { key: 'admin', label: 'Admin/Owner' },
  { key: 'service_writer', label: 'Service Writer' },
  { key: 'receptionist', label: 'Receptionist' },
  { key: 'foreman', label: 'Foreman' },
  { key: 'staff', label: 'Staff' },
  { key: 'all', label: 'All' }
];

function renderNoteSendToPills() {
  try {
    const container = document.getElementById('noteSendToPills');
    if (!container) return;
    container.innerHTML = '';
    NOTE_ROLES.forEach(r => {
      const pill = document.createElement('button');
      pill.type = 'button';
      pill.className = 'btn small';
      pill.textContent = r.label;
      pill.dataset.role = r.key;
      pill.style.borderRadius = '999px';
      pill.style.padding = '6px 10px';
      pill.style.background = window.pendingJobNoteSendTo.has(r.key) ? '#10b981' : '#f3f4f6';
      pill.style.color = window.pendingJobNoteSendTo.has(r.key) ? '#fff' : '#111827';
      pill.onclick = (e) => {
        e.preventDefault();
        const key = pill.dataset.role;
        if (!key) return;
        if (key === 'all') {
          window.pendingJobNoteSendTo.clear();
          window.pendingJobNoteSendTo.add('all');
        } else {
          window.pendingJobNoteSendTo.delete('all');
          if (window.pendingJobNoteSendTo.has(key)) window.pendingJobNoteSendTo.delete(key);
          else window.pendingJobNoteSendTo.add(key);
        }
        renderNoteSendToPills();
      };
      container.appendChild(pill);
    });
  } catch (e) { console.warn('renderNoteSendToPills failed', e); }
}

document.addEventListener('DOMContentLoaded', init);

async function init() {
  supabase = getSupabaseClient();
  try {
    if (supabase) {
      const { data: authData } = await supabase.auth.getUser();
      authId = authData?.user?.id || null;
    }
  } catch (e) {
    console.warn('[jobs-staff] Could not get auth id', e);
  }

  try {
    const session = JSON.parse(localStorage.getItem('xm_session') || '{}');
    shopId = session.shopId || null;
  } catch (e) {
    shopId = null;
  }

  // Create mobile action modal
  createMobileActionModal();
  
  // Inject highlight animation styles
  injectHighlightStyles();

  // Wire file input for job note media if present
  try {
    const mediaInput = document.getElementById('jobNoteMedia');
    if (mediaInput) mediaInput.addEventListener('change', (ev) => handleJobNoteMediaSelect(ev.target));
    // Render Send-To pills if present
    try { renderNoteSendToPills(); } catch (e) { /* ignore */ }
  } catch (e) { /* ignore */ }

  await loadAndRender(true); // Initial load - mark all as seen

  // Start polling for updates
  startDataPolling();
  startNotesPolling();
  
  // Wire up Diagnostics button
  const diagBtn = document.getElementById('openDiagnosticsBtn');
  if (diagBtn) {
    diagBtn.addEventListener('click', () => {
      // Get jobs assigned to this staff member
      const myJobs = allJobs.filter(j => 
        (String(j.assigned_to || '') === String(authId) || String(j.assigned || '') === String(authId)) &&
        j.status !== 'completed'
      );
      
      openDiagnosticsModal({
        jobs: myJobs,
        appointments: allAppointments,
        isStaff: true,
        onClose: (playbook) => {
          if (playbook) {
            console.log('[jobs-staff] Diagnostics closed with playbook:', playbook.title);
            // Refresh the page to show any invoice updates
            loadAndRender();
          }
        }
      });
    });
  }
  
  console.log('✅ Staff Jobs page initialized with live polling');
}

// ========== Highlight Styles ==========
function injectHighlightStyles() {
  if (document.getElementById('job-highlight-styles')) return;
  
  const style = document.createElement('style');
  style.id = 'job-highlight-styles';
  style.textContent = `
    @keyframes newJobPulse {
      0% { background-color: rgba(16, 185, 129, 0.25); }
      50% { background-color: rgba(16, 185, 129, 0.15); }
      100% { background-color: rgba(16, 185, 129, 0.25); }
    }
    
    tr.new-job-highlight {
      animation: newJobPulse 1.5s ease-in-out infinite;
      background-color: rgba(16, 185, 129, 0.25) !important;
    }
    
    tr.new-job-highlight td:first-child::before {
      content: '';
      display: inline-block;
      width: 8px;
      height: 8px;
      background: #10b981;
      border-radius: 50%;
      margin-right: 4px;
      animation: pulse 1s ease-in-out infinite;
    }
    
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }
  `;
  document.head.appendChild(style);
}

// ========== Data Polling ==========
function generateDataHash(jobs) {
  if (!jobs || jobs.length === 0) return 'empty';
  return jobs.map(j => `${j.id}:${j.status}:${j.assigned_to || ''}:${j.updated_at || ''}`).sort().join('|');
}

function generateStaffInvoiceHash(invoices) {
  if (!invoices || invoices.length === 0) return 'empty';
  return invoices.map(inv => {
    const itemsHash = (inv.items || []).map(i => `${i.name || ''}:${i.type || ''}`).join(',');
    return `${inv.id}:${inv.updated_at || ''}:${itemsHash}`;
  }).sort().join('|');
}

let lastKnownInvoiceHash = null;

async function pollForDataUpdates() {
  try {
    if (!supabase || !shopId || !authId) return;
    
    const { data: dataRes } = await supabase
      .from('data')
      .select('jobs,appointments')
      .eq('shop_id', shopId)
      .single();
    
    if (!dataRes) return;
    
    const jobs = dataRes.jobs || [];
    const appointments = dataRes.appointments || [];
    
    // Filter to only jobs assigned to current staff
    let filtered = jobs.filter(j => String(j.assigned_to || '') === String(authId));
    filtered = filtered.concat(jobs.filter(j => String(j.assigned || '') === String(authId)));
    const seen = new Set();
    filtered = filtered.filter(j => { 
      if (!j || !j.id) return false; 
      if (seen.has(j.id)) return false; 
      seen.add(j.id); 
      return true; 
    });
    
    const currentHash = generateDataHash(filtered);
    
    if (lastKnownDataHash === null) {
      lastKnownDataHash = currentHash;
      return;
    }
    
    if (currentHash !== lastKnownDataHash) {
      console.log('[jobs-staff] Data changed, detecting new jobs and refreshing...');
      lastKnownDataHash = currentHash;
      
      // Detect newly added jobs
      const currentJobIds = new Set(filtered.map(j => j.id));
      for (const jobId of currentJobIds) {
        if (!seenJobIds.has(jobId)) {
          console.log('[jobs-staff] New job detected:', jobId);
          newJobHighlights.set(jobId, Date.now());
          // Auto-remove highlight after duration
          setTimeout(() => {
            newJobHighlights.delete(jobId);
            renderJobs(filtered);
          }, HIGHLIGHT_DURATION);
        }
      }
      
      // Update seen jobs
      seenJobIds = currentJobIds;
      
      allJobs = jobs;
      allAppointments = appointments;
      renderJobs(filtered);
    }
    
    // Also check for invoice changes (services updates)
    try {
      const { data: invoiceRows } = await supabase
        .from('invoices')
        .select('id, appointment_id, items, updated_at')
        .eq('shop_id', shopId);
      
      const currentInvoiceHash = generateStaffInvoiceHash(invoiceRows || []);
      if (lastKnownInvoiceHash === null) { lastKnownInvoiceHash = currentInvoiceHash; }
      else if (currentInvoiceHash !== lastKnownInvoiceHash) {
        console.log('[jobs-staff] Invoice items changed, refreshing...');
        lastKnownInvoiceHash = currentInvoiceHash;
        // Update the lookup and re-render
        window._staffJobsInvoiceLookup = new Map();
        (invoiceRows || []).forEach(inv => {
          if (inv.appointment_id) window._staffJobsInvoiceLookup.set(inv.appointment_id, inv);
          if (inv.id) window._staffJobsInvoiceLookup.set(inv.id, inv);
        });
        renderJobs(filtered || allJobs.filter(j => String(j.assigned_to || '') === String(authId)));
      }
    } catch (invErr) {
      console.warn('[jobs-staff] Invoice polling error:', invErr);
    }
  } catch (e) {
    console.warn('[jobs-staff] Polling error:', e);
  }
}

function startDataPolling() {
  if (dataPollingInterval) clearInterval(dataPollingInterval);
  dataPollingInterval = setInterval(pollForDataUpdates, DATA_POLL_INTERVAL);
  console.log(`[jobs-staff] Started data polling every ${DATA_POLL_INTERVAL / 1000}s`);
}

// ========== Notes Polling ==========
function generateNotesHash(notes) {
  if (!notes || notes.length === 0) return 'empty';
  return notes.map(n => `${n.id}:${n.updated_at || ''}`).sort().join('|');
}

async function pollForNotes() {
  try {
    if (!supabase || !allJobs.length) return;
    
    const appointmentIds = allJobs
      .filter(j => String(j.assigned_to || '') === String(authId) || String(j.assigned || '') === String(authId))
      .map(j => j.appointment_id)
      .filter(Boolean);
    
    if (!appointmentIds.length) return;
    
    const { data: notesData } = await supabase
      .from('appointment_notes')
      .select('id, updated_at')
      .in('appointment_id', appointmentIds);
    
    const currentHash = generateNotesHash(notesData || []);
    
    if (lastKnownNotesHash === null) {
      lastKnownNotesHash = currentHash;
      return;
    }
    
    if (currentHash !== lastKnownNotesHash) {
      console.log('[jobs-staff] Notes changed, refreshing...');
      lastKnownNotesHash = currentHash;
      
      // Re-render to update note indicators
      let filtered = allJobs.filter(j => String(j.assigned_to || '') === String(authId));
      filtered = filtered.concat(allJobs.filter(j => String(j.assigned || '') === String(authId)));
      const seen = new Set();
      filtered = filtered.filter(j => { 
        if (!j || !j.id) return false; 
        if (seen.has(j.id)) return false; 
        seen.add(j.id); 
        return true; 
      });
      renderJobs(filtered);
    }
  } catch (e) {
    console.warn('[jobs-staff] Notes polling error:', e);
  }
}

function startNotesPolling() {
  if (notesPollingInterval) clearInterval(notesPollingInterval);
  pollForNotes();
  notesPollingInterval = setInterval(pollForNotes, NOTES_POLL_INTERVAL);
  console.log(`[jobs-staff] Started notes polling every ${NOTES_POLL_INTERVAL / 1000}s`);
}

// ========== Load and Render ==========
async function loadAndRender(isInitialLoad = false) {
  try {
    const dataRes = supabase ? await supabase.from('data').select('jobs,appointments').eq('shop_id', shopId).single() : null;
    const payload = dataRes?.data || JSON.parse(localStorage.getItem('xm_data') || '{}');
    allJobs = payload.jobs || [];
    allAppointments = payload.appointments || [];

    // Fetch fresh invoice data for services display
    let freshInvoices = [];
    try {
      if (supabase && shopId) {
        const { data: invData } = await supabase
          .from('invoices')
          .select('id, appointment_id, items, status')
          .eq('shop_id', shopId);
        if (invData) freshInvoices = invData;
      }
      if (freshInvoices.length === 0) {
        freshInvoices = payload.invoices || [];
      }
    } catch (e) {
      console.warn('Could not fetch invoices for services display:', e);
      freshInvoices = payload.invoices || [];
    }
    
    // Create invoice lookup map and store globally for table rows
    window._staffJobsInvoiceLookup = new Map();
    freshInvoices.forEach(inv => {
      if (inv.appointment_id) window._staffJobsInvoiceLookup.set(inv.appointment_id, inv);
      if (inv.id) window._staffJobsInvoiceLookup.set(inv.id, inv);
    });

    // Filter to only jobs assigned to current authenticated staff
    let filtered = [];
    if (authId) {
      filtered = allJobs.filter(j => String(j.assigned_to || '') === String(authId));
      filtered = filtered.concat(allJobs.filter(j => String(j.assigned || '') === String(authId)));
      const seen = new Set();
      filtered = filtered.filter(j => { 
        if (!j || !j.id) return false; 
        if (seen.has(j.id)) return false; 
        seen.add(j.id); 
        return true; 
      });
    }

    // On initial load, mark all current jobs as seen (no highlighting)
    if (isInitialLoad) {
      seenJobIds = new Set(filtered.map(j => j.id));
      lastKnownDataHash = generateDataHash(filtered);
    }

    renderJobs(filtered);
  } catch (e) {
    console.error('[jobs-staff] load error', e);
  }
}

function renderJobs(jobs) {
  const active = jobs.filter(j => j.status === 'in_progress');
  const awaiting = jobs.filter(j => j.status === 'awaiting_parts');
  renderJobsTable('jobsTable', 'jobsEmpty', active);
  renderJobsTable('awaitTable', 'awaitEmpty', awaiting);
}

function renderJobsTable(tableId, emptyId, jobs) {
  const tbody = document.querySelector(`#${tableId} tbody`);
  const empty = document.getElementById(emptyId);
  if (!tbody) return;
  tbody.innerHTML = '';
  if (!jobs || jobs.length === 0) { if (empty) empty.textContent = 'No jobs found.'; return; }
  if (empty) empty.textContent = '';

  const isMobile = window.matchMedia && window.matchMedia('(max-width: 768px)').matches;

  jobs.forEach(job => {
    const tr = document.createElement('tr');
    tr.dataset.jobId = job.id;

    const appt = allAppointments.find(a => a.id === job.appointment_id) || {};

    // Check if this is a new job that should be highlighted
    if (newJobHighlights.has(job.id)) {
      tr.classList.add('new-job-highlight');
    }

    // On mobile, make row clickable to open actions modal
    if (isMobile) {
      tr.classList.add('job-row-clickable');
      tr.addEventListener('click', (e) => {
        if (e.target.closest('button')) return;
        openJobActionsModal(job, appt);
      });
    }

    // Note indicator cell
    const dotCell = document.createElement('td');
    dotCell.style.cssText = 'width: 20px; padding: 0; text-align: center; vertical-align: middle;';
    tr.appendChild(dotCell);

    const assignedCell = document.createElement('td');
    // Use same job # format as main jobs page - last 6 chars uppercased
    assignedCell.textContent = job.id ? job.id.slice(-6).toUpperCase() : '';

    const customerCell = document.createElement('td');
    customerCell.textContent = (appt.customer || job.customer || `${appt.customer_first || ''} ${appt.customer_last || ''}`).trim();

    const vehicleCell = document.createElement('td');
    vehicleCell.textContent = appt.vehicle || job.vehicle || '';

    // Service - check for multiple services from invoice
    const serviceCell = document.createElement('td');
    
    // Get services from fresh invoice data (use window._staffJobsInvoiceLookup from loadAndRender)
    let invoiceServices = [];
    try {
      const invoiceLookup = window._staffJobsInvoiceLookup || new Map();
      let inv = null;
      if (appt.invoice_id) inv = invoiceLookup.get(appt.invoice_id);
      if (!inv && appt.id) inv = invoiceLookup.get(appt.id);
      if (inv && inv.items && Array.isArray(inv.items)) {
        invoiceServices = inv.items.filter(item => 
          item.type === 'service' || 
          (!item.type && item.name && !item.name.toLowerCase().startsWith('labor'))
        ).map(item => item.name || item.description || 'Unknown Service');
      }
    } catch (e) {
      console.warn('[StaffJobs] Could not get invoice services for table row', e);
    }
    
    // Combine appointment service with invoice services (deduplicated)
    const allServices = [];
    const primarySvc = appt.service || job.service || '';
    if (primarySvc) allServices.push(primarySvc);
    invoiceServices.forEach(s => {
      if (!allServices.some(existing => existing.toLowerCase() === s.toLowerCase())) {
        allServices.push(s);
      }
    });
    
    const hasMultipleServices = allServices.length > 1;
    const primaryService = allServices[0] || 'N/A';
    
    if (hasMultipleServices) {
      // Create dropdown button for multiple services
      const serviceWrapper = document.createElement('div');
      serviceWrapper.className = 'service-dropdown-wrapper';
      serviceWrapper.style.cssText = 'position:relative;';
      
      const serviceBtn = document.createElement('button');
      serviceBtn.className = 'service-dropdown-btn';
      serviceBtn.innerHTML = `
        <span class="service-primary">${primaryService}</span>
        <span class="service-badge">+${allServices.length - 1}</span>
        <span class="service-chevron">▼</span>
      `;
      serviceBtn.onclick = (e) => {
        e.stopPropagation();
        toggleServiceDropdown(serviceWrapper, allServices);
      };
      
      serviceWrapper.appendChild(serviceBtn);
      serviceCell.appendChild(serviceWrapper);
    } else {
      serviceCell.textContent = primaryService;
    }

    const statusCell = document.createElement('td');
    const statusSpan = document.createElement('span');
    statusSpan.className = `tag ${job.status || 'in_progress'}`;
    statusSpan.textContent = (job.status || 'in_progress').replace(/_/g, ' ');
    statusCell.appendChild(statusSpan);

    const assignedToCell = document.createElement('td');
    assignedToCell.textContent = 'You';

    const actionsCell = document.createElement('td');
    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'appt-actions-grid';

    // View button
    const viewBtn = document.createElement('button');
    viewBtn.className = 'btn small';
    viewBtn.textContent = 'View';
    viewBtn.onclick = () => openJobViewModal(job, appt);
    actionsDiv.appendChild(viewBtn);

    // Note button
    const noteBtn = document.createElement('button');
    noteBtn.className = 'btn small info';
    noteBtn.textContent = 'Note';
    noteBtn.onclick = () => { openJobNoteModalForAppt(appt); };
    actionsDiv.appendChild(noteBtn);

    // Inspection button
    const inspectBtn = document.createElement('button');
    inspectBtn.className = 'btn small';
 
    inspectBtn.textContent = '📋 Inspect';
    inspectBtn.onclick = (e) => {
      e.stopPropagation();
      openInspectionForm(job, appt);
    };
    actionsDiv.appendChild(inspectBtn);

    // Unclaim button
    const unclaimBtn = document.createElement('button');
    unclaimBtn.className = 'btn small danger';
    unclaimBtn.textContent = 'Unclaim';
    unclaimBtn.onclick = async () => { await unclaimJob(job); };
    actionsDiv.appendChild(unclaimBtn);

    // Wire status pill to open status modal (same flow as jobs page)
    statusSpan.style.cursor = 'pointer';
    statusSpan.title = 'Click to change status';
    statusSpan.addEventListener('click', (e) => {
      e.stopPropagation();
      openStatusModalForStaff(job);
    });

    actionsCell.appendChild(actionsDiv);

    tr.appendChild(assignedCell);
    tr.appendChild(customerCell);
    tr.appendChild(vehicleCell);
    tr.appendChild(serviceCell);
    tr.appendChild(statusCell);
    tr.appendChild(assignedToCell);
    tr.appendChild(actionsCell);

    tbody.appendChild(tr);
  });
}

// ========== Mobile Action Modal ==========
function createMobileActionModal() {
  const existing = document.getElementById('jobActionsModal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'jobActionsModal';
  modal.className = 'modal-overlay hidden';
  modal.innerHTML = `
    <div class="modal-content" onclick="event.stopPropagation()" style="max-width: 340px; margin: 18vh auto; padding: 0; border-radius: 16px; overflow: hidden;">
      <div class="modal-head" style="padding: 16px 20px; border-bottom: 1px solid var(--line);">
        <h3 id="jobActionsTitle" style="margin: 0; font-size: 1.1rem;">Job Actions</h3>
        <button onclick="closeJobActionsModal()" class="btn-close" style="position: absolute; right: 12px; top: 12px;">&times;</button>
      </div>
      <div class="modal-body" style="padding: 12px 16px;">
        <p id="jobActionsCustomer" style="margin: 0 0 16px 0; color: var(--muted); font-size: 0.95rem;"></p>
        <div style="display: flex; flex-direction: column; gap: 10px;">
          <button id="jobActionView" class="btn" style="width: 100%; padding: 14px; font-size: 1rem;">View Details</button>
          <button id="jobActionInspection" class="btn" style="width: 100%; padding: 14px; font-size: 1rem; ">📋 Start Inspection</button>
          <button id="jobActionNote" class="btn info" style="width: 100%; padding: 14px; font-size: 1rem;">Add Note</button>
          <button id="jobActionUnclaim" class="btn danger" style="width: 100%; padding: 14px; font-size: 1rem;">Unclaim Job</button>
        </div>
      </div>
    </div>
  `;
  modal.onclick = () => closeJobActionsModal();
  document.body.appendChild(modal);

  document.getElementById('jobActionView').onclick = handleJobActionView;
  document.getElementById('jobActionInspection').onclick = handleJobActionInspection;
  document.getElementById('jobActionNote').onclick = handleJobActionNote;
  document.getElementById('jobActionUnclaim').onclick = handleJobActionUnclaim;
}

function openJobActionsModal(job, appt) {
  currentActionJob = job;
  currentActionAppt = appt;

  const modal = document.getElementById('jobActionsModal');
  const customerDisplay = document.getElementById('jobActionsCustomer');

  if (!modal) return;

  const customerName = (appt.customer || job.customer || `${appt.customer_first || ''} ${appt.customer_last || ''}`).trim() || 'Unknown';
  const vehicle = appt.vehicle || job.vehicle || '';
  if (customerDisplay) {
    customerDisplay.textContent = vehicle ? `${customerName} • ${vehicle}` : customerName;
  }

  modal.classList.remove('hidden');
}

// Simple promise-based confirm modal used instead of native `confirm()`
function openConfirmModal(message) {
  return new Promise((resolve) => {
    let modal = document.getElementById('confirmModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'confirmModal';
      modal.className = 'modal-overlay hidden';
      modal.innerHTML = `
        <div class="modal-content" onclick="event.stopPropagation()" style="max-width:380px;">
          <div class="modal-head"><h3>Confirm</h3></div>
          <div class="modal-body"><p id="confirmModalMessage"></p></div>
          <div class="modal-foot" style="gap:8px;">
            <button id="confirmCancel" class="btn">Cancel</button>
            <button id="confirmOk" class="btn info">Confirm</button>
          </div>
        </div>`;
      modal.onclick = () => { modal.classList.add('hidden'); resolve(false); };
      document.body.appendChild(modal);
    }
    const msgEl = modal.querySelector('#confirmModalMessage');
    const okBtn = modal.querySelector('#confirmOk');
    const cancelBtn = modal.querySelector('#confirmCancel');
    if (msgEl) msgEl.textContent = message || 'Are you sure?';
    const cleanup = () => {
      okBtn.onclick = null;
      cancelBtn.onclick = null;
    };
    okBtn.onclick = () => { modal.classList.add('hidden'); cleanup(); resolve(true); };
    cancelBtn.onclick = () => { modal.classList.add('hidden'); cleanup(); resolve(false); };
    modal.classList.remove('hidden');
  });
}

// Update job status from staff page and persist changes
async function updateJobStatusStaff(jobId, newStatus) {
  try {
    const idx = allJobs.findIndex(j => j.id === jobId);
    if (idx === -1) return;
    const now = new Date().toISOString();
    allJobs[idx].status = newStatus;
    allJobs[idx].updated_at = now;

    // If completed, record who completed it and when
    if (newStatus === 'completed') {
      allJobs[idx].completed_at = now;
      try {
        // Use authId (from supabase.auth.getUser earlier) and resolve staff name from shop_staff
        const sup = supabase || getSupabaseClient();
        if (sup && authId) {
          // Try to find shop_staff row for this authId
          const { data: staffRows } = await sup.from('shop_staff').select('id,first_name,last_name,auth_id').eq('auth_id', authId).limit(1);
          const staff = (staffRows && staffRows.length) ? staffRows[0] : null;
          allJobs[idx].completed_by = staff ? { id: staff.id, auth_id: staff.auth_id, name: `${staff.first_name||''} ${staff.last_name||''}`.trim() } : { auth_id: authId };
        } else {
          allJobs[idx].completed_by = { auth_id: authId || null };
        }
      } catch (e) {
        allJobs[idx].completed_by = { auth_id: authId || null };
      }
    }

    // Persist to jobs table (if available) and data JSON
    try {
      const sup = supabase || getSupabaseClient();
      const shop = shopId || (JSON.parse(localStorage.getItem('xm_session')||'{}')).shopId;
      if (!sup) {
        console.warn('No Supabase client available; skipping remote persistence');
        showErrorBanner('Offline: changes saved locally only');
      } else {
        // Update jobs table and report any error
        try {
          console.log('[jobs-staff] Persisting status change to jobs table', { jobId, newStatus, shop });
          const { data: jobUpdateData, error: jobErr } = await sup.from('jobs').update({ status: newStatus, updated_at: now, completed_at: allJobs[idx].completed_at || null, completed_by: allJobs[idx].completed_by || null }).eq('id', jobId);
          if (jobErr) {
            console.error('jobs table update error', jobErr);
            showErrorBanner('Failed to update job record');
          } else {
            console.log('jobs table updated', jobUpdateData);
          }
        } catch (e) {
          console.error('Exception updating jobs table', e);
          showErrorBanner('Failed to update job record');
        }

        // Also update linked appointment status when present
        try {
          const appointmentId = allJobs[idx].appointment_id;
          if (appointmentId) {
            console.log('[jobs-staff] Updating linked appointment', appointmentId, 'to status', newStatus);
            const { data: apptUpdate, error: apptErr } = await sup.from('appointments').update({ status: newStatus, updated_at: now }).eq('id', appointmentId);
            if (apptErr) {
              console.error('appointments table update error', apptErr);
              showErrorBanner('Failed to update linked appointment');
            } else {
              console.log('appointments table updated', apptUpdate);
            }
            // Also reflect change in local allAppointments array
            const aIdx = allAppointments.findIndex(a => a.id === appointmentId);
            if (aIdx !== -1) {
              allAppointments[aIdx].status = newStatus;
              allAppointments[aIdx].updated_at = now;
            }
          }
        } catch (e) {
          console.error('Exception updating appointment', e);
          showErrorBanner('Failed to update linked appointment');
        }

        // Upsert into data table for full sync and report errors
        try {
          const { data: currentData, error: currentDataErr } = await sup.from('data').select('*').eq('shop_id', shop).single();
          if (currentDataErr) console.warn('Could not read current data row', currentDataErr);
          const payload = {
            shop_id: shop,
            appointments: allAppointments,
            settings: currentData?.settings || {},
            jobs: Array.isArray(currentData?.jobs) ? currentData.jobs.slice() : (currentData?.jobs || []),
            threads: currentData?.threads || [],
            invoices: currentData?.invoices || [],
            updated_at: new Date().toISOString()
          };
          // replace job inside payload.jobs if present
          if (Array.isArray(payload.jobs)) {
            const jIdx = payload.jobs.findIndex(j => j.id === jobId);
            if (jIdx !== -1) payload.jobs[jIdx] = allJobs[idx];
            else payload.jobs.push(allJobs[idx]);
          }
          const { data: upsertData, error: upsertErr } = await sup.from('data').upsert(payload, { onConflict: 'shop_id' });
          if (upsertErr) {
            console.error('data upsert error', upsertErr);
            showErrorBanner('Failed to sync change to data store');
          } else {
            console.log('data upserted', upsertData);
          }
        } catch (e) {
          console.error('Exception upserting data row', e);
          showErrorBanner('Failed to sync change to data store');
        }
      }
    } catch (e) { console.warn('Failed to persist job status', e); showErrorBanner('Failed to persist job status'); }

    // Save locally
    try {
      const local = JSON.parse(localStorage.getItem('xm_data')||'{}');
      local.jobs = allJobs;
      localStorage.setItem('xm_data', JSON.stringify(local));
    } catch (e) { /* ignore */ }

    // Re-render filtered jobs for this staff (completed jobs will be omitted)
    let filtered = [];
    if (authId) {
      filtered = allJobs.filter(j => String(j.assigned_to||'') === String(authId));
      filtered = filtered.concat(allJobs.filter(j => String(j.assigned||'') === String(authId)));
      const seen = new Set();
      filtered = filtered.filter(j => { if (!j||!j.id) return false; if (seen.has(j.id)) return false; seen.add(j.id); return true; });
    }
    renderJobs(filtered);

    // If completed, notify and show a small toast
    if (newStatus === 'completed') {
      showSuccessBanner('Job marked completed and moved to Completed Jobs.');
    } else {
      showSuccessBanner('Job status updated.');
    }
  } catch (err) {
    console.error('updateJobStatusStaff failed', err);
    showErrorBanner('Failed to update job status.');
  }
}

function closeJobActionsModal() {
  const modal = document.getElementById('jobActionsModal');
  if (modal) modal.classList.add('hidden');
  currentActionJob = null;
  currentActionAppt = null;
}

// Create and show a status modal for staff page (mirrors jobs page flow)
function openStatusModalForStaff(job) {
  try {
    let modal = document.getElementById('statusModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'statusModal';
      modal.className = 'modal-overlay hidden';
      modal.onclick = () => { modal.classList.add('hidden'); };
      modal.innerHTML = `
        <div class="modal-content" onclick="event.stopPropagation()" style="max-width: 400px;">
          <div class="modal-head">
            <h3>Select Status</h3>
            <button onclick="document.getElementById('statusModal')?.classList.add('hidden')" class="btn-close">&times;</button>
          </div>
          <div class="modal-body">
            <div id="statusPills" style="display:flex;flex-direction:column;gap:12px;"></div>
          </div>
        </div>`;
      document.body.appendChild(modal);
    }

    const pillsContainer = modal.querySelector('#statusPills');
    if (!pillsContainer) return;
    pillsContainer.innerHTML = '';

    const STATUSES = [ {k:'in_progress', t:'In Progress'}, {k:'awaiting_parts', t:'Awaiting Parts'}, {k:'completed', t:'Completed'} ];
    STATUSES.forEach(s => {
      const pill = document.createElement('button');
      pill.className = 'btn';
      pill.style.width = '100%';
      pill.style.textAlign = 'left';
      pill.textContent = s.t.toUpperCase();
      if (job.status === s.k) pill.classList.add('active');
      pill.onclick = async () => {
        modal.classList.add('hidden');
        if (s.k === 'completed') {
          // Open in-page confirmation modal instead of native confirm()
          try {
            const ok = await openConfirmModal('Mark this job as completed?');
            if (!ok) return;
          } catch (e) { return; }
        }
        await updateJobStatusStaff(job.id, s.k);
      };
      pillsContainer.appendChild(pill);
    });

    modal.classList.remove('hidden');
  } catch (e) { console.error('openStatusModalForStaff failed', e); }
}

function handleJobActionView() {
  if (!currentActionJob) return;
  const job = currentActionJob;
  const appt = currentActionAppt || {};
  closeJobActionsModal();
  openJobViewModal(job, appt);
}

function handleJobActionInspection() {
  if (!currentActionJob) return;
  const job = currentActionJob;
  const appt = currentActionAppt || {};
  closeJobActionsModal();
  openInspectionForm(job, appt);
}

// ========== Inspection Form Integration ==========
async function openInspectionForm(job, appt) {
  try {
    // Build vehicle info from appointment data
    const vehicleInfo = {
      id: appt.vehicle_id || null,
      year: appt.vehicle_year || '',
      make: appt.vehicle_make || '',
      model: appt.vehicle_model || '',
      vin: appt.vin || '',
      mileage: appt.mileage || null
    };

    // If vehicle is a combined string, try to parse it
    if (appt.vehicle && !vehicleInfo.year && !vehicleInfo.make) {
      const parts = (appt.vehicle || '').split(' ');
      if (parts.length >= 3) {
        const yearMatch = parts[0].match(/^\d{4}$/);
        if (yearMatch) {
          vehicleInfo.year = parts[0];
          vehicleInfo.make = parts[1];
          vehicleInfo.model = parts.slice(2).join(' ');
        }
      }
    }

    // Build customer info
    const customerInfo = {
      id: appt.customer_id || null,
      name: appt.customer || `${appt.customer_first || ''} ${appt.customer_last || ''}`.trim(),
      phone: appt.phone || '',
      email: appt.email || ''
    };

    // Open the inspection form
    await inspectionForm.open({
      appointmentId: appt.id,
      jobId: job.id,
      vehicleInfo,
      customerInfo,
      onClose: async (inspection) => {
        if (inspection) {
          showSuccessBanner('Inspection saved');
          await loadAndRender();
        }
      }
    });
  } catch (e) {
    console.error('openInspectionForm error:', e);
    showErrorBanner('Failed to open inspection form');
  }
}

function handleJobActionNote() {
  if (!currentActionAppt) {
    alert('No appointment linked to this job');
    return;
  }
  const appt = currentActionAppt;
  closeJobActionsModal();
  openJobNoteModalForAppt(appt);
}

async function handleJobActionUnclaim() {
  if (!currentActionJob) return;
  const job = currentActionJob;
  closeJobActionsModal();
  await unclaimJob(job);
}

window.closeJobActionsModal = closeJobActionsModal;

// ========== View Modal ==========
async function openJobViewModal(job, appt) {
  const modal = document.getElementById('jobViewModal');
  const content = document.getElementById('jobViewContent');
  if (!modal || !content) return;
  // Format date/time if available
  const startsAt = appt?.starts_at || appt?.scheduled_at || appt?.date || appt?.start_time || null;
  let dateText = '';
  let timeText = '';
  try {
    if (startsAt) {
      const d = new Date(startsAt);
      if (!isNaN(d)) {
        dateText = d.toLocaleDateString();
        timeText = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      } else if (appt.date) {
        dateText = appt.date;
        timeText = appt.time || '';
      } else {
        dateText = '';
        timeText = '';
      }
    }
  } catch (e) { /* ignore */ }

  const assignedLabel = (String(job.assigned_to || job.assigned || '') === String(authId)) ? 'You' : (job.assigned_to_name || job.assigned_name || job.assigned || job.assigned_to || '');

  // Get services from invoice items - fetch fresh from Supabase
  let invoiceServices = [];
  try {
    let inv = null;
    
    if (supabase && shopId) {
      // Try to fetch from invoices table first (most up-to-date)
      if (appt.invoice_id) {
        const { data: invData } = await supabase.from('invoices').select('*').eq('id', appt.invoice_id).single();
        if (invData) inv = invData;
      }
      if (!inv) {
        const { data: invData } = await supabase.from('invoices').select('*').eq('appointment_id', appt.id).single();
        if (invData) inv = invData;
      }
    }
    
    // Fallback to lookup
    if (!inv) {
      const invoiceLookup = window._staffJobsInvoiceLookup || new Map();
      if (appt.invoice_id) inv = invoiceLookup.get(appt.invoice_id);
      if (!inv) inv = invoiceLookup.get(appt.id);
    }
    
    if (inv && inv.items && Array.isArray(inv.items)) {
      invoiceServices = inv.items.filter(item => 
        item.type === 'service' || 
        (!item.type && item.name && !item.name.toLowerCase().startsWith('labor'))
      ).map(item => item.name || item.description || 'Unknown Service');
    }
  } catch (e) {
    console.warn('[StaffJobs] Could not get invoice services for view modal', e);
  }
  
  // Combine appointment service with invoice services (deduplicated)
  const allServices = [];
  if (appt.service) allServices.push(appt.service);
  invoiceServices.forEach(s => {
    if (!allServices.some(existing => existing.toLowerCase() === s.toLowerCase())) {
      allServices.push(s);
    }
  });
  
  // Build services HTML with expandable functionality
  const hasMultipleServices = allServices.length > 1;
  const servicesLabel = hasMultipleServices ? 'Services' : 'Service';
  const primaryService = allServices[0] || 'N/A';
  
  let servicesHTML = '';
  if (hasMultipleServices) {
    servicesHTML = `
      <div class="services-expandable">
        <div class="services-header" onclick="toggleServicesExpand(this)" style="display:flex;align-items:center;gap:8px;cursor:pointer;">
          <strong>${servicesLabel}:</strong>
          <span class="primary-service" style="flex:1;">${primaryService}</span>
          <span class="services-count" style="background:var(--accent, #3b82f6);color:white;padding:2px 8px;border-radius:12px;font-size:12px;">+${allServices.length - 1} more</span>
          <span class="expand-icon" style="transition:transform 0.2s;">▼</span>
        </div>
        <div class="services-list" style="display:none;margin-top:12px;padding-left:12px;border-left:2px solid var(--accent, #3b82f6);">
          ${allServices.map((svc, idx) => `
            <div class="service-item" style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;${idx < allServices.length - 1 ? 'border-bottom:1px solid var(--line, #e5e7eb);' : ''}">
              <span style="flex:1;">${svc}</span>
              <button class="btn small" onclick="openCortexForService('${svc.replace(/'/g, "\\'")}')"
                style="display:flex;align-items:center;gap:4px;padding:4px 10px;font-size:12px;">
                <img src="/assets/cortex-mark.png" alt="" style="width:14px;height:14px;">
                Cortex
              </button>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  } else {
    servicesHTML = `
      <div style="display:flex;align-items:center;gap:8px;">
        <strong>${servicesLabel}:</strong>
        <span style="flex:1;">${primaryService}</span>
        ${primaryService !== 'N/A' && primaryService !== '' ? `
          <button class="btn small" onclick="openCortexForService('${primaryService.replace(/'/g, "\\'")}')"
            style="display:flex;align-items:center;gap:4px;padding:4px 10px;font-size:12px;">
            <img src="/assets/cortex-mark.png" alt="" style="width:14px;height:14px;">
            Cortex
          </button>
        ` : ''}
      </div>
    `;
  }

  content.innerHTML = `
    <p><strong>Customer:</strong> ${appt.customer || job.customer || ''}</p>
    ${appt.phone ? `<p><strong>Phone:</strong> ${appt.phone}</p>` : `<p><strong>Phone:</strong> </p>`}
    ${appt.email ? `<p><strong>Email:</strong> ${appt.email}</p>` : `<p><strong>Email:</strong> </p>`}
    <p><strong>Vehicle:</strong> ${appt.vehicle || ''}</p>
    ${servicesHTML}
    <p><strong>Date:</strong> ${dateText}</p>
    <p><strong>Time:</strong> ${timeText}</p>
    <p><strong>Status:</strong> <span class="tag ${job.status || 'in_progress'}">${(job.status || 'in_progress').replace(/_/g, ' ')}</span></p>
    <p><strong>Assigned to:</strong> ${assignedLabel}</p>
    <div id="inspectionStatusRow" style="margin-top: 8px;"></div>
  `;
  
  // Load inspection status asynchronously
  loadInspectionStatusForModal(appt.id, job.id);
  
  // Add a notes container and then asynchronously load notes for this appointment
  const notesWrapper = document.createElement('div');
  notesWrapper.id = 'jobViewNotesContainer';
  notesWrapper.style.cssText = 'margin-top:12px;';
  notesWrapper.innerHTML = '<h4 style="margin:0 0 8px 0;">Notes</h4><div id="jobViewNotes" style="display:flex;flex-direction:column;gap:8px;"></div>';
  content.appendChild(notesWrapper);

  // Fetch and render notes for this appointment (non-blocking)
  try { renderNotesForAppointment(appt.id); } catch (e) { console.warn('renderNotesForAppointment error', e); }

  modal.classList.remove('hidden');
}

// Load and display inspection status in view modal
async function loadInspectionStatusForModal(appointmentId, jobId) {
  const container = document.getElementById('inspectionStatusRow');
  if (!container) return;
  
  try {
    const summary = await getInspectionSummary(appointmentId, jobId);
    
    if (summary) {
      // Inspection exists - show status and view button
      const gradeColors = {
        'A': { bg: '#dcfce7', color: '#166534' },
        'B': { bg: '#dbeafe', color: '#1e40af' },
        'C': { bg: '#fef3c7', color: '#92400e' },
        'D': { bg: '#fed7aa', color: '#9a3412' },
        'F': { bg: '#fee2e2', color: '#991b1b' }
      };
      const gradeStyle = gradeColors[summary.grade] || { bg: '#f3f4f6', color: '#374151' };
      
      const statusLabels = {
        'draft': 'Draft',
        'in_progress': 'In Progress',
        'ready_for_review': 'Ready for Review',
        'sent_to_customer': 'Sent to Customer',
        'customer_responded': 'Customer Responded',
        'closed': 'Closed'
      };
      const statusLabel = statusLabels[summary.status] || summary.status;
      
      container.innerHTML = `
        <p style="margin: 0 0 8px 0;"><strong>Inspection:</strong> 
          <span style="display: inline-flex; align-items: center; gap: 8px;">
            <span class="tag" style="background: ${gradeStyle.bg}; color: ${gradeStyle.color}; font-weight: 700;">
              Grade ${summary.grade}
            </span>
            <span style="color: #6b7280; font-size: 13px;">${statusLabel}</span>
            ${summary.failCount > 0 ? `<span style="color: #ef4444; font-size: 12px;">${summary.failCount} failed</span>` : ''}
          </span>
        </p>
        <button id="viewInspectionBtn" class="btn small" style="background: #3b82f6; color: white; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer; font-size: 13px;">
          📋 View Inspection
        </button>
      `;
      
      // Add click handler for view button
      document.getElementById('viewInspectionBtn')?.addEventListener('click', () => {
        closeJobViewModal();
        // Open the inspection viewer (we'll need to create this or use existing)
        openInspectionViewer(summary.id, appointmentId, jobId);
      });
    } else {
      // No inspection yet
      container.innerHTML = `
        <p style="margin: 0;"><strong>Inspection:</strong> 
          <span style="color: #9ca3af; font-size: 13px;">Not started</span>
        </p>
      `;
    }
  } catch (e) {
    console.warn('Failed to load inspection status:', e);
    container.innerHTML = '';
  }
}

// Open inspection viewer (read-only view of completed inspection)
function openInspectionViewer(inspectionId, appointmentId, jobId) {
  // For now, open the form in edit mode - we can create a read-only viewer later
  // Find the job and appointment data
  const job = allJobs.find(j => j.id === jobId);
  const appt = allAppointments.find(a => a.id === appointmentId);
  
  if (!appt) {
    alert('Could not find appointment data');
    return;
  }
  
  // Parse vehicle info
  let vehicleInfo = {};
  if (appt.vehicle) {
    const parts = appt.vehicle.split(' ');
    if (parts.length >= 3) {
      vehicleInfo.year = parts[0];
      vehicleInfo.make = parts[1];
      vehicleInfo.model = parts.slice(2).join(' ');
    }
  }
  
  // Open the inspection form (it will load the existing inspection)
  inspectionForm.open({
    appointmentId: appointmentId,
    jobId: jobId,
    inspectionId: inspectionId,
    vehicleInfo: vehicleInfo,
    customerInfo: {
      name: appt.customer,
      phone: appt.phone,
      email: appt.email
    },
    onClose: (inspection) => {
      // Refresh the job list if inspection was saved
      if (inspection) {
        loadAndRender();
      }
    }
  });
}

function closeJobViewModal() { 
  const m = document.getElementById('jobViewModal'); 
  if (m) m.classList.add('hidden'); 
}

async function renderNotesForAppointment(appointmentId) {
  const container = document.getElementById('jobViewNotes');
  if (!container) return;
  container.innerHTML = '<div style="color:var(--muted)">Loading notes...</div>';
  try {
    if (!supabase) {
      container.innerHTML = '<div class="notice">No notes available</div>';
      return;
    }

    const { data: notes, error } = await supabase
      .from('appointment_notes')
      .select('*')
      .eq('appointment_id', appointmentId)
      .order('created_at', { ascending: true });

    if (error) throw error;

    container.innerHTML = '';
    if (!notes || notes.length === 0) {
      container.innerHTML = '<div class="notice">No notes</div>';
      return;
    }

    // Cache for resolved users
    const userCache = new Map();

    async function resolveUser(nameOrId) {
      if (!nameOrId) return null;
      if (userCache.has(nameOrId)) return userCache.get(nameOrId);
      try {
        // Try shop_staff by id
        let { data: staffData } = await supabase.from('shop_staff').select('id,first_name,last_name,email,auth_id,role').eq('id', nameOrId).limit(1);
        if (staffData && staffData.length) { userCache.set(nameOrId, staffData[0]); return staffData[0]; }
        // Try shop_staff by auth_id
        ({ data: staffData } = await supabase.from('shop_staff').select('id,first_name,last_name,email,auth_id,role').eq('auth_id', nameOrId).limit(1));
        if (staffData && staffData.length) { userCache.set(nameOrId, staffData[0]); return staffData[0]; }
        // Try users table
        const { data: userData } = await supabase.from('users').select('id,first,last,email,role').eq('id', nameOrId).limit(1);
        if (userData && userData.length) { userCache.set(nameOrId, userData[0]); return userData[0]; }
      } catch (e) { /* ignore */ }
      userCache.set(nameOrId, null);
      return null;
    }

    // Render notes sequentially (so we can await user resolution)
    for (const note of notes) {
      const noteObj = note;
      const resolvedUser = await resolveUser(noteObj.created_by);
      const noteIsRead = isNoteRead(noteObj.id);
      const panel = document.createElement('div');
      panel.style.cssText = `border: 1px solid ${noteIsRead ? '#ddd' : '#3b82f6'}; border-radius: 8px; padding: 12px; background: ${noteIsRead ? '#f9f9f9' : '#f0f7ff'}; position: relative;`;
      panel.dataset.noteId = note.id;

      const btnContainer = document.createElement('div');
      btnContainer.style.cssText = 'position: absolute; top: 8px; right: 8px; display: flex; gap: 4px;';

      if (!noteIsRead) {
        const readBtn = document.createElement('button');
        readBtn.className = 'btn small';
        readBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false"><path fill="currentColor" d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>';
        readBtn.style.cssText = 'padding: 4px 8px; border-radius: 4px; background: #10b981; color: white;';
        readBtn.title = 'Mark as read';
        readBtn.onclick = (e) => { e.stopPropagation(); markNoteAsRead(noteObj.id); panel.style.border = '1px solid #ddd'; panel.style.background = '#f9f9f9'; readBtn.style.display = 'none'; };
        btnContainer.appendChild(readBtn);
      }

      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'btn small danger';
      deleteBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false"><path fill="white" d="M3 6h18v2H3V6zm2 3h14l-1 12a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2l-1-12zM9 4V3a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v1h5v2H4V4h5z"/></svg>';
      deleteBtn.style.cssText = 'padding: 4px 8px; border-radius: 4px;';
      deleteBtn.title = 'Delete note';
      deleteBtn.onclick = (e) => { e.stopPropagation(); openDeleteNoteModal(noteObj.id); };
      btnContainer.appendChild(deleteBtn);

      panel.appendChild(btnContainer);

      const contentWrapper = document.createElement('div');
      contentWrapper.style.cssText = 'display: flex; gap: 16px; align-items: flex-start;';

      const textContent = document.createElement('div');
      textContent.style.cssText = 'flex: 1; min-width: 0; padding-right: 30px;';

      const header = document.createElement('div');
      header.style.cssText = 'display: flex; flex-direction: column; gap: 2px; margin-bottom: 8px;';

      const authorName = document.createElement('strong');
      authorName.style.fontSize = '14px';
      authorName.style.color = '#333';
      // Author name: prefer resolvedUser, then note.user payload, then created_by id
      let userName = 'Unknown User';
      let senderRole = null;
      if (resolvedUser) {
        const first = resolvedUser.first || resolvedUser.first_name || resolvedUser.firstName || '';
        const last = resolvedUser.last || resolvedUser.last_name || resolvedUser.lastName || '';
        const full = `${first} ${last}`.trim();
        userName = full || resolvedUser.email || resolvedUser.email_address || resolvedUser.id || String(noteObj.created_by || 'Unknown User');
        senderRole = resolvedUser.role || resolvedUser.role_name || null;
      } else if (noteObj.user) {
        const first = noteObj.user.first || noteObj.user.first_name || noteObj.user.firstName || '';
        const last = noteObj.user.last || noteObj.user.last_name || noteObj.user.lastName || '';
        const full = `${first} ${last}`.trim();
        userName = full || noteObj.user.email || noteObj.user.email_address || 'Unknown User';
        senderRole = noteObj.user.role || null;
      } else if (noteObj.created_by) {
        userName = String(noteObj.created_by);
      }

      // Create author row with name + role pill
      const authorRow = document.createElement('div');
      authorRow.style.cssText = 'display:flex; align-items:center; gap:8px;';
      authorName.textContent = userName;
      authorRow.appendChild(authorName);

      // Determine pill label and color
      let roleKey = (senderRole || '').toString().toLowerCase();
      let pillLabel = '';
      let pillBg = '#fbbf24'; // default yellow for everyone else
      let pillColor = '#111827';
      if (roleKey === 'staff') { pillLabel = 'Staff'; pillBg = '#10b981'; pillColor = '#fff'; }
      else if (roleKey === 'foreman') { pillLabel = 'Foreman'; pillBg = '#3b82f6'; pillColor = '#fff'; }
      else if (roleKey === 'admin' || roleKey === 'owner') { pillLabel = 'Admin/Owner'; pillBg = '#ef4444'; pillColor = '#fff'; }
      else if (roleKey) { pillLabel = roleKey.charAt(0).toUpperCase() + roleKey.slice(1); pillBg = '#fbbf24'; pillColor = '#111827'; }

      if (pillLabel) {
        const rolePill = document.createElement('span');
        rolePill.textContent = pillLabel;
        rolePill.style.cssText = `display:inline-block; padding:4px 8px; border-radius:999px; font-size:12px; background:${pillBg}; color:${pillColor}; font-weight:600;`;
        authorRow.appendChild(rolePill);
      }

      header.appendChild(authorRow);

      const dateInfo = document.createElement('span');
      dateInfo.style.cssText = 'font-size: 12px; color: #666;';
      dateInfo.textContent = noteObj.created_at ? new Date(noteObj.created_at).toLocaleString() : '';

      header.appendChild(dateInfo);

      if (noteObj.subject) {
        const subj = document.createElement('div');
        subj.style.cssText = 'font-size: 13px; color: #111827; font-weight: 600; margin-top:4px;';
        subj.textContent = noteObj.subject;
        header.appendChild(subj);
      }

      try {
        let sendToArr = noteObj.send_to || [];
        if (typeof sendToArr === 'string') { try { sendToArr = JSON.parse(sendToArr); } catch (e) { sendToArr = [sendToArr]; } }
        const sentToText = (Array.isArray(sendToArr) && sendToArr.length) ? sendToArr.map(s => { const m = NOTE_ROLES.find(r => r.key === s); return m ? m.label : s; }).join(', ') : 'All';
        const sentTo = document.createElement('div');
        sentTo.style.cssText = 'font-size:12px; color: #4b5563;';
        sentTo.textContent = `Sent to: ${sentToText}`;
        header.appendChild(sentTo);
      } catch (e) {}

      const content = document.createElement('p');
      content.style.cssText = 'margin: 0; font-size: 14px; line-height: 1.5; white-space: pre-wrap; color: #333;';
      content.textContent = noteObj.note || '';

      textContent.appendChild(header);
      textContent.appendChild(content);
      contentWrapper.appendChild(textContent);

      if (noteObj.media_urls && noteObj.media_urls.length > 0) {
        const mediaContainer = document.createElement('div');
        // Increase right margin slightly so thumbnails sit a bit more to the left
        const rightMargin = noteIsRead ? '60px' : '100px';
        mediaContainer.style.cssText = `display: flex; flex-wrap: wrap; gap: 8px; max-width: 200px; justify-content: flex-end; margin-right: ${rightMargin};`;

        noteObj.media_urls.forEach(media => {
          const thumb = document.createElement('div');
          thumb.style.cssText = 'width: 60px; height: 60px; border-radius: 6px; overflow: hidden; cursor: pointer; background: #ddd; display: flex; align-items: center; justify-content: center; flex-shrink: 0;';
          if (media.type === 'video') {
            thumb.innerHTML = `
              <div style="position: relative; width: 100%; height: 100%;">
                <video src="${media.url}" style="width: 100%; height: 100%; object-fit: cover;"></video>
                <div style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); background: rgba(0,0,0,0.6); border-radius: 50%; width: 24px; height: 24px; display: flex; align-items: center; justify-content: center;">
                  <span style="color: white; font-size: 12px; margin-left: 2px;">▶</span>
                </div>
              </div>
            `;
          } else {
            const img = document.createElement('img');
            img.src = media.url;
            img.style.cssText = 'width: 100%; height: 100%; object-fit: cover;';
            img.alt = 'Note attachment';
            thumb.appendChild(img);
          }
          thumb.onclick = (e) => { e.stopPropagation(); openMediaPreview(media.url, media.type || 'image'); };
          mediaContainer.appendChild(thumb);
        });

        contentWrapper.appendChild(mediaContainer);
      }

      panel.appendChild(contentWrapper);
      container.appendChild(panel);
    }

  } catch (err) {
    console.error('renderNotesForAppointment failed', err);
    container.innerHTML = '<div class="notice">Failed to load notes</div>';
  }
}

function openJobNoteModalForAppt(appt) {
  if (!appt || !appt.id) return alert('No appointment linked');
  window.currentJobNotesAppointmentId = appt.id;
  const m = document.getElementById('jobNoteModal'); 
  if (!m) return;
  const textarea = document.getElementById('jobNoteText');
  if (textarea) textarea.value = '';
  // Clear subject and send-to selection
  const subj = document.getElementById('noteSubject');
  if (subj) subj.value = '';
  if (!window.pendingJobNoteSendTo) window.pendingJobNoteSendTo = new Set();
  window.pendingJobNoteSendTo.clear();
  window.pendingJobNoteSendTo.add('all');
  try { renderNoteSendToPills(); } catch (e) {}
  m.classList.remove('hidden');
}

function closeJobNoteModal() { 
  const m = document.getElementById('jobNoteModal'); 
  if (m) m.classList.add('hidden'); 
  // Clear media selections
  pendingJobNoteMedia = [];
  const preview = document.getElementById('jobNoteMediaPreview');
  if (preview) preview.innerHTML = '';
  const count = document.getElementById('jobNoteMediaCount');
  if (count) count.textContent = 'No files selected';
  const input = document.getElementById('jobNoteMedia');
  if (input) input.value = '';
}

async function saveJobNote(e) {
  e && e.preventDefault && e.preventDefault();
  const txt = (document.getElementById('jobNoteText') || {}).value || '';
  const apptId = window.currentJobNotesAppointmentId;
  if (!apptId) return alert('No appointment selected');
  if (!txt.trim() && pendingJobNoteMedia.length === 0) return alert('Please enter a note or attach media');
  
  try {
    if (supabase) {
      let mediaUrls = [];
      if (pendingJobNoteMedia.length > 0) {
        mediaUrls = await uploadJobNoteMedia(pendingJobNoteMedia, apptId);
      }

      const subject = document.getElementById('noteSubject')?.value || null;
      let sendToArr = Array.from(window.pendingJobNoteSendTo || []);
      if (sendToArr.includes('all') && sendToArr.length > 1) sendToArr = sendToArr.filter(s => s !== 'all');

      const noteData = {
        appointment_id: apptId,
        note: txt || (mediaUrls.length ? '(Media attached)' : ''),
        created_by: authId,
        created_at: new Date().toISOString(),
        subject: subject,
        send_to: sendToArr
      };
      if (mediaUrls.length) noteData.media_urls = mediaUrls;

      const { error } = await supabase.from('appointment_notes').insert(noteData);
      if (error) throw error;
    }
    closeJobNoteModal();
    showSuccessBanner('Note saved successfully');
    await loadAndRender();
  } catch (err) { 
    console.error('saveJobNote failed', err); 
    showErrorBanner('Failed to save note'); 
  }
}

async function unclaimJob(job) {
  try {
    if (!supabase) {
      const localData = JSON.parse(localStorage.getItem('xm_data') || '{}'); 
      localData.jobs = localData.jobs || []; 
      const idx = localData.jobs.findIndex(j => j.id === job.id); 
      if (idx >= 0) { 
        localData.jobs[idx].assigned_to = null; 
        localStorage.setItem('xm_data', JSON.stringify(localData)); 
      }
      showSuccessBanner('Job unclaimed');
      await loadAndRender();
      return;
    }

    const { error: jobErr } = await supabase.from('jobs').update({ assigned_to: null, updated_at: new Date().toISOString() }).eq('id', job.id);
    if (jobErr) console.warn('jobs table update error', jobErr);

    const { data } = await supabase.from('data').select('jobs').eq('shop_id', shopId).single();
    const jobs = data?.jobs || [];
    const idx = jobs.findIndex(j => j.id === job.id);
    if (idx >= 0) {
      jobs[idx].assigned_to = null;
      jobs[idx].updated_at = new Date().toISOString();
      await supabase.from('data').update({ jobs }).eq('shop_id', shopId);
    }

    // Remove from seen jobs since it's no longer assigned to us
    seenJobIds.delete(job.id);
    
    showSuccessBanner('Job unclaimed');
    await loadAndRender();
  } catch (e) { 
    console.error('unclaimJob failed', e); 
    showErrorBanner('Failed to unclaim job'); 
  }
}

// ========== Success/Error Banners ==========
function showSuccessBanner(message) {
  const existing = document.getElementById('success-banner');
  if (existing) existing.remove();
  
  const banner = document.createElement('div');
  banner.id = 'success-banner';
  banner.style.cssText = `
    position: fixed;
    top: 60px;
    left: 50%;
    transform: translateX(-50%);
    background: linear-gradient(135deg, #10b981 0%, #059669 100%);
    color: white;
    padding: 12px 24px;
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    z-index: 10100;
    font-weight: 500;
    animation: slideDown 0.3s ease;
  `;
  banner.textContent = message;
  
  if (!document.getElementById('banner-animations')) {
    const style = document.createElement('style');
    style.id = 'banner-animations';
    style.textContent = `
      @keyframes slideDown {
        from { opacity: 0; transform: translateX(-50%) translateY(-20px); }
        to { opacity: 1; transform: translateX(-50%) translateY(0); }
      }
    `;
    document.head.appendChild(style);
  }
  
  document.body.appendChild(banner);
  
  setTimeout(() => {
    banner.style.opacity = '0';
    banner.style.transition = 'opacity 0.3s ease';
    setTimeout(() => banner.remove(), 300);
  }, 3000);
}

function showErrorBanner(message) {
  const existing = document.getElementById('success-banner');
  if (existing) existing.remove();
  
  const banner = document.createElement('div');
  banner.id = 'success-banner';
  banner.style.cssText = `
    position: fixed;
    top: 60px;
    left: 50%;
    transform: translateX(-50%);
    background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
    color: white;
    padding: 12px 24px;
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    z-index: 10100;
    font-weight: 500;
    animation: slideDown 0.3s ease;
  `;
  banner.textContent = message;
  document.body.appendChild(banner);
  
  setTimeout(() => {
    banner.style.opacity = '0';
    banner.style.transition = 'opacity 0.3s ease';
    setTimeout(() => banner.remove(), 300);
  }, 4000);
}

window.saveJobNote = saveJobNote;
window.closeJobNoteModal = closeJobNoteModal;
window.closeJobViewModal = closeJobViewModal;

// ========== Media handling for staff job notes ==========
function handleJobNoteMediaSelect(input) {
  try {
    const files = Array.from(input.files || []);
    const preview = document.getElementById('jobNoteMediaPreview');
    const count = document.getElementById('jobNoteMediaCount');

    if (files.length === 0) {
      pendingJobNoteMedia = [];
      if (preview) preview.innerHTML = '';
      if (count) count.textContent = 'No files selected';
      return;
    }

    const maxSize = 10 * 1024 * 1024;
    const validFiles = files.filter(f => {
      if (f.size > maxSize) {
        alert(`File "${f.name}" is too large. Maximum size is 10MB.`);
        return false;
      }
      return true;
    });

    pendingJobNoteMedia = validFiles;
    if (count) count.textContent = `${validFiles.length} file${validFiles.length !== 1 ? 's' : ''} selected`;

    if (preview) {
      preview.innerHTML = '';
      validFiles.forEach((file, idx) => {
        const thumb = document.createElement('div');
        thumb.style.cssText = 'position: relative; width: 60px; height: 60px; border-radius: 6px; overflow: hidden; background: #ddd;';

        if (file.type.startsWith('video/')) {
          const video = document.createElement('video');
          video.src = URL.createObjectURL(file);
          video.style.cssText = 'width: 100%; height: 100%; object-fit: cover;';
          thumb.appendChild(video);
          const playIcon = document.createElement('div');
          playIcon.style.cssText = 'position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); background: rgba(0,0,0,0.6); border-radius: 50%; width: 20px; height: 20px; display: flex; align-items: center; justify-content: center;';
          playIcon.innerHTML = '<span style="color: white; font-size: 10px; margin-left: 2px;">▶</span>';
          thumb.appendChild(playIcon);
        } else {
          const img = document.createElement('img');
          img.src = URL.createObjectURL(file);
          img.style.cssText = 'width: 100%; height: 100%; object-fit: cover;';
          thumb.appendChild(img);
        }

        const removeBtn = document.createElement('button');
        removeBtn.innerHTML = '&times;';
        removeBtn.style.cssText = 'position: absolute; top: 2px; right: 2px; width: 18px; height: 18px; border-radius: 50%; background: rgba(0,0,0,0.6); color: white; border: none; cursor: pointer; font-size: 12px; line-height: 1; padding: 0;';
        removeBtn.onclick = (e) => {
          e.preventDefault(); e.stopPropagation();
          pendingJobNoteMedia.splice(idx, 1);
          handleJobNoteMediaSelect({ files: pendingJobNoteMedia });
        };
        thumb.appendChild(removeBtn);

        preview.appendChild(thumb);
      });
    }
  } catch (err) {
    console.error('handleJobNoteMediaSelect error', err);
  }
}

window.handleJobNoteMediaSelect = handleJobNoteMediaSelect;

async function uploadJobNoteMedia(files, appointmentId) {
  console.log('[Staff NoteMedia] Starting upload for', files.length, 'files');
  if (!supabase || !files.length) return [];
  if (!shopId) console.warn('[Staff NoteMedia] shopId missing');

  const uploaded = [];
  for (const file of files) {
    try {
      const fileExt = file.name.split('.').pop();
      const path = `${shopId}/${appointmentId}/${Date.now()}_${Math.random().toString(36).substr(2,9)}.${fileExt}`;
      const { data, error } = await supabase.storage.from('note-media').upload(path, file, { cacheControl: '3600', upsert: false, contentType: file.type });
      if (error) { console.error('[Staff NoteMedia] upload error', error); continue; }
      const { data: urlData } = supabase.storage.from('note-media').getPublicUrl(path);
      if (urlData?.publicUrl) {
        uploaded.push({ url: urlData.publicUrl, type: file.type.startsWith('video/') ? 'video' : 'image', name: file.name });
      }
    } catch (err) { console.error('[Staff NoteMedia] exception', err); }
  }
  console.log('[Staff NoteMedia] Upload complete', uploaded.length);
  return uploaded;
}

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

function closeMediaPreview() {
  const modal = document.getElementById('mediaPreviewModal');
  if (modal) {
    modal.classList.add('hidden');
    const video = modal.querySelector('video');
    if (video) video.pause();
  }
}

window.closeMediaPreview = closeMediaPreview;

// ========== Delete Note Modal Handlers ==========
let noteToDeleteId = null;
function openDeleteNoteModal(noteId) {
  noteToDeleteId = noteId;
  const modal = document.getElementById('deleteNoteModal');
  if (modal) modal.classList.remove('hidden');
}

function closeDeleteNoteModal() {
  noteToDeleteId = null;
  const modal = document.getElementById('deleteNoteModal');
  if (modal) modal.classList.add('hidden');
}

async function confirmDeleteNote() {
  if (!noteToDeleteId) return closeDeleteNoteModal();
  try {
    if (supabase) {
      const { error } = await supabase.from('appointment_notes').delete().eq('id', noteToDeleteId);
      if (error) throw error;
    }
    closeDeleteNoteModal();
    showSuccessBanner('Note deleted');
    const apptId = window.currentJobNotesAppointmentId;
    if (apptId) await renderNotesForAppointment(apptId);
    await loadAndRender();
  } catch (e) {
    console.error('confirmDeleteNote failed', e);
    showErrorBanner('Failed to delete note');
  }
}

window.openDeleteNoteModal = openDeleteNoteModal;
window.closeDeleteNoteModal = closeDeleteNoteModal;
window.confirmDeleteNote = confirmDeleteNote;

// === Services Expand & Cortex Integration ===

// Toggle services expand/collapse (if not already defined)
if (typeof window.toggleServicesExpand !== 'function') {
  window.toggleServicesExpand = function(headerEl) {
    const container = headerEl.closest('.services-expandable');
    if (!container) return;
    const list = container.querySelector('.services-list');
    const icon = container.querySelector('.expand-icon');
    if (!list) return;
    
    const isExpanded = list.style.display !== 'none';
    list.style.display = isExpanded ? 'none' : 'block';
    if (icon) icon.style.transform = isExpanded ? 'rotate(0deg)' : 'rotate(180deg)';
  };
}

// Toggle service dropdown in table rows (if not already defined)
if (typeof window.toggleServiceDropdown !== 'function') {
  window.toggleServiceDropdown = function(wrapperEl, services) {
    // Close any other open dropdowns first
    document.querySelectorAll('.service-dropdown-menu.open').forEach(menu => {
      if (menu.parentElement !== wrapperEl) {
        menu.parentElement.closest('tr')?.classList.remove('dropdown-open');
        menu.remove();
      }
    });

    // Check if dropdown already exists
    let dropdown = wrapperEl.querySelector('.service-dropdown-menu');
    if (dropdown) {
      wrapperEl.closest('tr')?.classList.remove('dropdown-open');
      dropdown.remove();
      return;
    }

    // Add class to parent row for z-index
    wrapperEl.closest('tr')?.classList.add('dropdown-open');

    // Create dropdown
    dropdown = document.createElement('div');
    dropdown.className = 'service-dropdown-menu open';
    dropdown.innerHTML = services.map((svc) => `
      <div class="service-dropdown-item">
        <span class="service-name">${svc}</span>
        <button class="btn small cortex-btn" onclick="event.stopPropagation(); openCortexForService('${svc.replace(/'/g, "\\'")}')">
          <img src="/assets/cortex-mark.png" alt="" style="width:14px;height:14px;">
          Cortex
        </button>
      </div>
    `).join('');

    wrapperEl.appendChild(dropdown);

    // Close dropdown when clicking outside
    const closeHandler = (e) => {
      if (!wrapperEl.contains(e.target)) {
        wrapperEl.closest('tr')?.classList.remove('dropdown-open');
        dropdown.remove();
        document.removeEventListener('click', closeHandler);
      }
    };
    setTimeout(() => document.addEventListener('click', closeHandler), 0);
  };
}

// Open Cortex modal with pre-filled search for a specific service (if not already defined)
if (typeof window.openCortexForService !== 'function') {
  window.openCortexForService = async function(serviceName) {
    try {
      const { openDiagnosticsModal } = await import('../components/diagnostics/DiagnosticsModal.js');
      const store = JSON.parse(localStorage.getItem('xm_data') || '{}');
      const jobs = store.jobs || [];
      const appointments = store.appointments || [];
      
      openDiagnosticsModal({
        jobs: jobs.filter(j => j.status !== 'completed'),
        appointments: appointments,
        initialSearch: serviceName,
        isStaff: true,
        onClose: () => {
          console.log('[StaffJobs] Cortex modal closed for service:', serviceName);
        }
      });
    } catch (err) {
      console.error('[StaffJobs] Failed to open Cortex for service:', err);
      alert('Could not open Cortex. Please try again.');
    }
  };
}

export default {};
