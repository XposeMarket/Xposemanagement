import { getSupabaseClient } from '../helpers/supabase.js';

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

  await loadAndRender(true); // Initial load - mark all as seen

  // Start polling for updates
  startDataPolling();
  startNotesPolling();
  
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

    const serviceCell = document.createElement('td');
    serviceCell.textContent = appt.service || job.service || '';

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

    // Unclaim button
    const unclaimBtn = document.createElement('button');
    unclaimBtn.className = 'btn small danger';
    unclaimBtn.textContent = 'Unclaim';
    unclaimBtn.onclick = async () => { await unclaimJob(job); };
    actionsDiv.appendChild(unclaimBtn);

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
          <button id="jobActionNote" class="btn info" style="width: 100%; padding: 14px; font-size: 1rem;">Add Note</button>
          <button id="jobActionUnclaim" class="btn danger" style="width: 100%; padding: 14px; font-size: 1rem;">Unclaim Job</button>
        </div>
      </div>
    </div>
  `;
  modal.onclick = () => closeJobActionsModal();
  document.body.appendChild(modal);

  document.getElementById('jobActionView').onclick = handleJobActionView;
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

function closeJobActionsModal() {
  const modal = document.getElementById('jobActionsModal');
  if (modal) modal.classList.add('hidden');
  currentActionJob = null;
  currentActionAppt = null;
}

function handleJobActionView() {
  if (!currentActionJob) return;
  const job = currentActionJob;
  const appt = currentActionAppt || {};
  closeJobActionsModal();
  openJobViewModal(job, appt);
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
function openJobViewModal(job, appt) {
  const modal = document.getElementById('jobViewModal');
  const content = document.getElementById('jobViewContent');
  if (!modal || !content) return;
  content.innerHTML = `
    <p><strong>Job #:</strong> ${job.id ? job.id.slice(-6).toUpperCase() : ''}</p>
    <p><strong>Status:</strong> <span class="tag ${job.status || 'in_progress'}">${(job.status || 'in_progress').replace(/_/g, ' ')}</span></p>
    <p><strong>Customer:</strong> ${appt.customer || job.customer || ''}</p>
    <p><strong>Vehicle:</strong> ${appt.vehicle || ''}</p>
    <p><strong>Service:</strong> ${appt.service || ''}</p>
    ${appt.phone ? `<p><strong>Phone:</strong> ${appt.phone}</p>` : ''}
    ${appt.email ? `<p><strong>Email:</strong> ${appt.email}</p>` : ''}
  `;
  modal.classList.remove('hidden');
}

function closeJobViewModal() { 
  const m = document.getElementById('jobViewModal'); 
  if (m) m.classList.add('hidden'); 
}

function openJobNoteModalForAppt(appt) {
  if (!appt || !appt.id) return alert('No appointment linked');
  window.currentJobNotesAppointmentId = appt.id;
  const m = document.getElementById('jobNoteModal'); 
  if (!m) return;
  const textarea = document.getElementById('jobNoteText');
  if (textarea) textarea.value = '';
  m.classList.remove('hidden');
}

function closeJobNoteModal() { 
  const m = document.getElementById('jobNoteModal'); 
  if (m) m.classList.add('hidden'); 
}

async function saveJobNote(e) {
  e && e.preventDefault && e.preventDefault();
  const txt = (document.getElementById('jobNoteText') || {}).value || '';
  const apptId = window.currentJobNotesAppointmentId;
  if (!apptId) return alert('No appointment selected');
  if (!txt.trim()) return alert('Please enter a note');
  
  try {
    if (supabase) {
      const { error } = await supabase.from('appointment_notes').insert({ 
        appointment_id: apptId, 
        note: txt, 
        created_by: authId,
        created_at: new Date().toISOString()
      });
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

export default {};
