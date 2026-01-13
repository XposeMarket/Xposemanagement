import { loadAppointments, renderAppointments, saveAppointments, initAppointmentNotes, startNotesPolling, setDisplayedAppointments } from './appointments.js';
import { getSupabaseClient } from '../helpers/supabase.js';
import { requireAuth, applyNavPermissions, enforcePageAccess } from '../helpers/auth.js';
import { initializeShopConfig } from '../helpers/shop-config-loader.js';
import { toggleTheme, logout, setThemeFromUser } from '../helpers/user.js';
import { byId } from '../helpers/utils.js';
import { initShopSwitcher } from '../helpers/shop-switcher-ui.js';
import { shouldShowAdminPage, getCurrentUserId, getUserShops, getCurrentShopId as getMultiShopId, switchShop } from '../helpers/multi-shop.js';

// Store staff list for assign modal (foreman only)
let shopStaffList = [];
// Cache current user role (fetched from Supabase)
let cachedUserRole = null;
// Store current filtered appointments for mobile modal
let currentFilteredAppts = [];
// Current role cached so reapply after renders
let currentClaimRole = null;
// Mobile action modal tracking
let currentActionAppt = null;

// Polling intervals
let dataPollingInterval = null;
const DATA_POLL_INTERVAL = 15000; // 15 seconds

// Track seen job IDs to detect new ones
let seenJobIds = new Set();
let lastKnownDataHash = null;

// Track new jobs for highlighting (job ID -> timestamp when first seen)
let newJobHighlights = new Map();
const HIGHLIGHT_DURATION = 8000; // 8 seconds
const HIGHLIGHT_FADE_MS = 600; // fade out duration

// ========== Highlight Styles ==========
function injectHighlightStyles() {
  if (document.getElementById('claim-highlight-styles')) return;
  
  const style = document.createElement('style');
  style.id = 'claim-highlight-styles';
  style.textContent = `
    @keyframes claimFade {
      0% { background-color: rgba(16, 185, 129, 0); }
      10% { background-color: rgba(16, 185, 129, 0.25); }
      50% { background-color: rgba(16, 185, 129, 0.15); }
      90% { background-color: rgba(16, 185, 129, 0.25); }
      100% { background-color: rgba(16, 185, 129, 0); }
    }

    tr.new-job-highlight {
      animation-name: claimFade;
      animation-duration: ${HIGHLIGHT_DURATION}ms;
      animation-timing-function: ease-in-out;
      animation-iteration-count: 1;
      animation-fill-mode: forwards;
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

    /* Fade-out helper: pause animation and transition background to transparent */
    tr.new-job-fadeout {
      animation-play-state: paused !important;
      transition: background-color ${HIGHLIGHT_FADE_MS}ms ease !important;
      background-color: rgba(16, 185, 129, 0) !important;
    }
  `;
  document.head.appendChild(style);
}

function startFadeOutForRow(id) {
  try {
    const row = document.querySelector(`#apptTable tbody tr[data-appt-id="${id}"]`);
    if (!row) return;
    const comp = getComputedStyle(row).backgroundColor;
    row.style.backgroundColor = comp;
    row.style.transition = `background-color ${HIGHLIGHT_FADE_MS}ms ease`;
    row.classList.remove('new-job-highlight');
    // Force reflow then transition to transparent
    // eslint-disable-next-line no-unused-expressions
    row.offsetWidth;
    row.style.backgroundColor = 'rgba(16, 185, 129, 0)';
  } catch (e) {}
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

// ========== Data Polling ==========
function generateDataHash(jobs) {
  if (!jobs || jobs.length === 0) return 'empty';
  return jobs.map(j => `${j.id}:${j.status}:${j.assigned_to || ''}:${j.updated_at || ''}`).sort().join('|');
}

async function pollForDataUpdates() {
  try {
    const supabase = getSupabaseClient();
    const shopId = getCurrentShopId();
    if (!supabase || !shopId) return;
    
    // Build unassigned jobs from the canonical `jobs` table and fall back to
    // appointments when a job row doesn't exist for an appointment. This
    // ensures that when a job row is removed (e.g., status -> scheduled)
    // the Claim Board will respect the appointment status and remove the row.
    let jobs = [];
    try {
      const { data: jobsTable, error: jobsErr } = await supabase
        .from('jobs')
        .select('*')
        .eq('shop_id', shopId)
        .is('assigned_to', null);

      const jobsFromTable = (!jobsErr && Array.isArray(jobsTable)) ? jobsTable : [];

      // Fetch appointments that represent active jobable statuses
      const { data: apptsTable, error: apptErr } = await supabase
        .from('appointments')
        .select('*')
        .eq('shop_id', shopId)
        .in('status', ['in_progress', 'awaiting_parts']);

      const apptsFromTable = (!apptErr && Array.isArray(apptsTable)) ? apptsTable : [];

      // Convert appointments that don't already have a job row into job-like objects
      const derivedFromAppts = (apptsFromTable || []).filter(a => !jobsFromTable.find(j => String(j.appointment_id) === String(a.id))).map(a => ({
        id: a.id,
        appointment_id: a.id,
        customer: a.customer || '',
        vehicle: a.vehicle || '',
        service: a.service || a.service_requested || '',
        status: a.status || 'in_progress',
        created_at: a.created_at,
        updated_at: a.updated_at
      }));

      jobs = jobsFromTable.concat(derivedFromAppts);
    } catch (e) {
      // Best-effort fallback to data.jobs JSONB if queries fail
      try {
        const { data } = await supabase.from('data').select('jobs').eq('shop_id', shopId).single();
        jobs = data?.jobs || [];
      } catch (e2) {
        jobs = [];
      }
    }

    // Filter to unassigned jobs only
    let unassigned = (jobs || []).filter(j => !j.assigned_to);

    // Verify appointment statuses for these jobs and exclude rows whose
    // appointments are no longer in an active jobable state.
    try {
      const appointmentIds = Array.from(new Set(unassigned.map(j => String(j.appointment_id)).filter(Boolean)));
      if (appointmentIds.length) {
        const { data: apptRows, error: apptErr } = await supabase
          .from('appointments')
          .select('id,status')
          .in('id', appointmentIds);
        const apptMap = (apptRows || []).reduce((m, r) => { if (r && r.id) m[String(r.id)] = r.status; return m; }, {});
        unassigned = unassigned.filter(j => {
          const aId = String(j.appointment_id || '');
          if (!aId) return (j.status === 'in_progress' || j.status === 'awaiting_parts');
          const st = apptMap[aId];
          return (st === 'in_progress' || st === 'awaiting_parts');
        });
      }
    } catch (e) {
      console.warn('[claim-board] Could not verify appointment statuses during polling:', e);
    }

    const currentHash = generateDataHash(unassigned);
    
    if (lastKnownDataHash === null) {
      lastKnownDataHash = currentHash;
      return;
    }
    
    if (currentHash !== lastKnownDataHash) {
      console.log('[claim-board] Data changed, detecting new jobs and refreshing...');
      lastKnownDataHash = currentHash;
      
      // Detect newly added jobs
      const currentJobIds = new Set(unassigned.map(j => j.id || j.appointment_id));
      for (const jobId of currentJobIds) {
        if (!seenJobIds.has(jobId)) {
          console.log('[claim-board] New job detected:', jobId);
          newJobHighlights.set(jobId, Date.now());
          // Auto-remove highlight after duration with graceful fade
          (function(id) {
            setTimeout(() => {
              try { startFadeOutForRow(id); } catch (e) {}
              setTimeout(() => {
                newJobHighlights.delete(id);
                try { applyHighlightsToRows(); } catch (e) {}
                try {
                  const row = document.querySelector(`#apptTable tbody tr[data-appt-id="${id}"]`);
                  if (row) { row.style.transition = ''; row.style.backgroundColor = ''; }
                } catch (e) {}
              }, HIGHLIGHT_FADE_MS);
            }, HIGHLIGHT_DURATION);
          })(jobId);
        }
      }
      
      // Update seen jobs
      seenJobIds = currentJobIds;
      
      // Refresh the board
      await initClaimBoard(true);
    }
  } catch (e) {
    console.warn('[claim-board] Polling error:', e);
  }
}

function startDataPolling() {
  if (dataPollingInterval) clearInterval(dataPollingInterval);
  dataPollingInterval = setInterval(pollForDataUpdates, DATA_POLL_INTERVAL);
  console.log(`[claim-board] Started data polling every ${DATA_POLL_INTERVAL / 1000}s`);
}

function applyHighlightsToRows() {
  const rows = document.querySelectorAll('#apptTable tbody tr');
  rows.forEach(row => {
    const apptId = row.dataset.apptId;
    if (apptId && newJobHighlights.has(apptId)) {
      if (!row.classList.contains('new-job-highlight')) {
        // restart animation by removing then forcing reflow
        row.classList.remove('new-job-highlight');
        // eslint-disable-next-line no-unused-expressions
        row.offsetWidth;
        row.classList.add('new-job-highlight');
      }
    } else {
      row.classList.remove('new-job-highlight');
    }
  });
}

// ========== Load Shop Staff (for foreman assign) ==========
async function loadShopStaff() {
  const supabase = getSupabaseClient();
  const shopId = getCurrentShopId();
  
  if (!supabase || !shopId) {
    shopStaffList = [];
    return;
  }
  
  try {
    const { data, error } = await supabase
      .from('shop_staff')
      .select('id, auth_id, first_name, last_name, email, role')
      .eq('shop_id', shopId)
      .order('first_name', { ascending: true });
    
    if (error) throw error;
    shopStaffList = data || [];
  } catch (e) {
    console.error('Failed to load shop staff:', e);
    shopStaffList = [];
  }
}

// ========== Assign Modal (for foreman) ==========
function createAssignModal() {
  const existing = document.getElementById('assignJobModal');
  if (existing) existing.remove();
  
  const modal = document.createElement('div');
  modal.id = 'assignJobModal';
  modal.className = 'modal-backdrop hidden';
  modal.innerHTML = `
    <div class="modal-card" onclick="event.stopPropagation()" style="max-width: 480px;">
      <div class="modal-head">
        <h3>Assign Job</h3>
        <button type="button" class="btn-close" onclick="closeAssignModal()">&times;</button>
      </div>
      <div class="modal-body">
        <p style="margin-bottom: 12px; color: var(--muted);">Select a staff member to assign this job to:</p>
        <div id="staffListContainer" style="display: flex; flex-direction: column; gap: 8px; max-height: 300px; overflow-y: auto;">
        </div>
      </div>
      <div class="modal-foot">
        <button onclick="closeAssignModal()" class="btn">Cancel</button>
      </div>
    </div>
  `;
  modal.onclick = () => closeAssignModal();
  document.body.appendChild(modal);
}

// ========== Remove Modal (reuse Jobs modal copy for consistent UX) ==========
function createRemoveModalClaim() {
  const existing = document.getElementById('removeModal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'removeModal';
  modal.className = 'modal-overlay hidden';
  modal.onclick = () => closeRemoveModalClaim();

  modal.innerHTML = `
    <div class="modal-content" onclick="event.stopPropagation()" style="max-width: 400px;">
      <div class="modal-head">
        <h3>Remove Job</h3>
        <button onclick="closeRemoveModalClaim()" class="btn-close">&times;</button>
      </div>
      <div class="modal-body">
        <p id="removeModalBody">Are you sure you want to remove this job?</p>
        <div style="display: flex; flex-direction: column; gap: 12px; margin-top: 20px;">
          <button id="removeJobBtn" class="btn danger" style="width: 100%;">Remove Job</button>
          <button id="removeJobApptBtn" class="btn danger" style="width: 100%;">Remove Job & Appointment</button>
          <button id="cancelRemoveBtn" class="btn" style="width: 100%;">Cancel</button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  // Wire buttons
  document.getElementById('cancelRemoveBtn').onclick = closeRemoveModalClaim;
  document.getElementById('removeJobBtn').onclick = async () => {
    const apptId = modal.dataset.apptId;
    closeRemoveModalClaim();
    try {
      await setSuppressAutoJob(apptId);
    } catch (e) { console.warn('Failed to set suppress flag for appointment', e); }
    await performSendJobBackToScheduled(apptId);
  };
  document.getElementById('removeJobApptBtn').onclick = async () => {
    const apptId = modal.dataset.apptId;
    closeRemoveModalClaim();
    // For claim-board, treat as same as remove job (appointment not deleted)
    try {
      await setSuppressAutoJob(apptId);
    } catch (e) { console.warn('Failed to set suppress flag for appointment', e); }
    // If current user is foreman, don't delete appointment — just send back to scheduled
    try {
      const role = await fetchCurrentUserRole();
      if (role === 'foreman') {
        await performSendJobBackToScheduled(apptId);
      } else {
        // Admin/owner: fully remove appointment and related job data
        await performDeleteAppointment(apptId);
      }
    } catch (e) {
      console.warn('[claim-board] removeJobAppt handler failed:', e);
      await performSendJobBackToScheduled(apptId);
    }
  };
  
}

/**
 * Fully delete an appointment and its related jobs/invoices from Supabase/data
 * Admin-only action. Falls back to localStorage when Supabase is unavailable.
 */
async function performDeleteAppointment(apptId) {
  const supabase = getSupabaseClient();
  const shopId = getCurrentShopId();

  // Remove from data.jobs/data.appointments and standalone tables
  if (supabase && shopId) {
    try {
      const { data: currentData, error: fetchError } = await supabase
        .from('data')
        .select('*')
        .eq('shop_id', shopId)
        .single();

      if (fetchError && fetchError.code !== 'PGRST116') throw fetchError;

      const updatedJobs = (currentData?.jobs || []).filter(j => String(j.appointment_id) !== String(apptId) && String(j.id) !== String(apptId));
      const updatedAppts = (currentData?.appointments || []).filter(a => String(a.id) !== String(apptId));

      const payload = {
        shop_id: shopId,
        jobs: updatedJobs,
        appointments: updatedAppts,
        settings: currentData?.settings || {},
        threads: currentData?.threads || [],
        invoices: currentData?.invoices || [],
        updated_at: new Date().toISOString()
      };

      const { error: upsertErr } = await supabase.from('data').upsert(payload, { onConflict: 'shop_id' });
      if (upsertErr) console.warn('[claim-board] Failed to upsert data row during delete:', upsertErr);

      // Remove standalone jobs and appointment rows
      await supabase.from('job_parts').delete().eq('appointment_id', apptId).catch(() => {});
      await supabase.from('job_labor').delete().eq('appointment_id', apptId).catch(() => {});
      await supabase.from('jobs').delete().eq('appointment_id', apptId).catch(() => {});
      await supabase.from('appointments').delete().eq('id', apptId).catch(() => {});

      console.log('[claim-board] Deleted appointment and related jobs from Supabase:', apptId);
    } catch (e) {
      console.error('[claim-board] performDeleteAppointment failed:', e);
    }
  } else {
    try {
      const localData = JSON.parse(localStorage.getItem('xm_data') || '{}');
      localData.jobs = (localData.jobs || []).filter(j => String(j.appointment_id) !== String(apptId) && String(j.id) !== String(apptId));
      localData.appointments = (localData.appointments || []).filter(a => String(a.id) !== String(apptId));
      localStorage.setItem('xm_data', JSON.stringify(localData));
    } catch (e) { console.warn('[claim-board] local delete failed:', e); }
  }

  // Refresh UI
  try { await initClaimBoard(); } catch (e) { console.warn('[claim-board] refresh after delete failed', e); }
}

/**
 * Mark an appointment to suppress automatic job creation.
 * This writes into the shop `data` row's appointments JSON so future status
 * updates won't recreate the job for this appointment.
 */
async function setSuppressAutoJob(apptId) {
  try {
    const supabase = getSupabaseClient();
    const shopId = getCurrentShopId();
    if (!supabase || !shopId || !apptId) return;

    const { data: dataRow, error: fetchErr } = await supabase.from('data').select('appointments').eq('shop_id', shopId).single();
    if (fetchErr) throw fetchErr;
    const appointments = dataRow?.appointments || [];
    let changed = false;
    for (let i = 0; i < appointments.length; i++) {
      if (appointments[i] && (appointments[i].id === apptId || appointments[i].appointment_id === apptId)) {
        appointments[i].suppress_auto_job = true;
        appointments[i].updated_at = new Date().toISOString();
        changed = true;
      }
    }
    if (!changed) return;
    const { error: upsertErr } = await supabase.from('data').upsert({ shop_id: shopId, appointments }, { onConflict: 'shop_id' });
    if (upsertErr) throw upsertErr;
    console.log('[claim-board] Set suppress_auto_job on appointment', apptId);
  } catch (e) {
    console.warn('[claim-board] Error setting suppress_auto_job:', e);
    throw e;
  }
}

function openRemoveModalClaim(apptId) {
  if (!document.getElementById('removeModal')) createRemoveModalClaim();
  const modal = document.getElementById('removeModal');
  if (!modal) return;
  modal.dataset.apptId = apptId;
  const bodyP = document.getElementById('removeModalBody');
  const removeApptBtn = document.getElementById('removeJobApptBtn');

  if (bodyP) bodyP.textContent = 'Are you sure you want to remove this job?';
  if (removeApptBtn) removeApptBtn.style.display = '';

  // If current user is foreman, adjust copy
  fetchCurrentUserRole().then(role => {
    if (role === 'foreman') {
      if (bodyP) bodyP.textContent = 'This will send the job/appointment back to scheduled status — it will not delete the appointment. Proceed?';
      if (removeApptBtn) removeApptBtn.style.display = 'none';
      const removeBtn = document.getElementById('removeJobBtn');
      if (removeBtn) removeBtn.textContent = 'Remove Job';
    }
  }).catch(() => {});

  // Log infodata for this job/appointment so the operator can search/remove specific rows later
  (async () => {
    try {
      const supabase = getSupabaseClient();
      const shopId = getCurrentShopId();
      if (!supabase || !shopId) return;
      const { data, error } = await supabase.from('data').select('jobs, appointments').eq('shop_id', shopId).single();
      if (error) throw error;
      const jobs = data?.jobs || [];
      const appts = data?.appointments || [];

      // Find jobs referencing this appointment id (appointment_id or job id equal)
      const matchingJobs = jobs.filter(j => {
        return (j.appointment_id && j.appointment_id === apptId) || (j.job_id && j.job_id === apptId) || (j.id && j.id === apptId);
      });

      const matchingAppt = appts.find(a => (a.id && a.id === apptId) || (a.appointment_id && a.appointment_id === apptId));

      console.log('[claim-board][remove-modal] apptId=', apptId, '\nmatchingJobs=', matchingJobs, '\nmatchingAppointment=', matchingAppt);
    } catch (e) {
      console.warn('[claim-board] failed to fetch infodata for remove modal', e);
    }
  })();

  modal.classList.remove('hidden');
}

function closeRemoveModalClaim() {
  const modal = document.getElementById('removeModal');
  if (modal) modal.classList.add('hidden');
}

function openAssignModal(apptId) {
  const modal = document.getElementById('assignJobModal');
  const container = document.getElementById('staffListContainer');
  
  if (!modal || !container) return;
  
  modal.dataset.apptId = apptId;
  
  if (shopStaffList.length === 0) {
    container.innerHTML = '<p class="notice">No staff members found. Add staff in Settings.</p>';
  } else {
    container.innerHTML = shopStaffList.map(staff => `
      <button class="btn" style="text-align: left; justify-content: flex-start; padding: 12px;" 
              onclick="selectStaffForAssign('${staff.auth_id || staff.id}', '${(staff.first_name || '').replace(/'/g, "\\'")} ${(staff.last_name || '').replace(/'/g, "\\'")}')">
        <div style="display: flex; flex-direction: column; align-items: flex-start;">
          <strong>${staff.first_name || ''} ${staff.last_name || ''}</strong>
          <span style="font-size: 12px; color: var(--muted);">${staff.email || ''} • ${staff.role || 'staff'}</span>
        </div>
      </button>
    `).join('');
  }
  
  modal.classList.remove('hidden');
}

window.closeAssignModal = function() {
  const modal = document.getElementById('assignJobModal');
  if (modal) modal.classList.add('hidden');
};

window.selectStaffForAssign = async function(staffAuthId, staffName) {
  const modal = document.getElementById('assignJobModal');
  const apptId = modal?.dataset.apptId;
  
  if (!apptId || !staffAuthId) return;
  
  closeAssignModal();
  
  try {
    await assignJobFromClaimBoard(apptId, staffAuthId, staffName);
  } catch (e) {
    console.error('Assignment failed:', e);
    showErrorBanner('Failed to assign job');
  }
};

// ========== Mobile Action Modal ==========
function createMobileActionModal() {
  const existing = document.getElementById('claimBoardActionModal');
  if (existing) existing.remove();
  
  const modal = document.createElement('div');
  modal.id = 'claimBoardActionModal';
  modal.className = 'modal-overlay hidden';
  modal.innerHTML = `
    <div class="modal-content" onclick="event.stopPropagation()" style="max-width: 340px; margin: 18vh auto; padding: 0; border-radius: 16px; overflow: hidden;">
      <div class="modal-head" style="padding: 16px 20px; border-bottom: 1px solid var(--line);">
        <h3 id="claimBoardActionTitle" style="margin: 0; font-size: 1.1rem;">Job Actions</h3>
        <button onclick="closeClaimBoardActionModal()" class="btn-close" style="position: absolute; right: 12px; top: 12px;">&times;</button>
      </div>
      <div class="modal-body" style="padding: 12px 16px;">
        <p id="claimBoardActionCustomer" style="margin: 0 0 16px 0; color: var(--muted); font-size: 0.95rem;"></p>
        <div id="claimBoardActionButtons" style="display: flex; flex-direction: column; gap: 10px;">
        </div>
      </div>
    </div>
  `;
  modal.onclick = () => closeClaimBoardActionModal();
  document.body.appendChild(modal);
}

function openClaimBoardActionModal(appt, role) {
  currentActionAppt = appt;
  
  const modal = document.getElementById('claimBoardActionModal');
  const customerDisplay = document.getElementById('claimBoardActionCustomer');
  const buttonsContainer = document.getElementById('claimBoardActionButtons');
  
  if (!modal || !buttonsContainer) return;
  
  const customerName = appt.customer || 'Unknown Customer';
  const vehicle = appt.vehicle || '';
  if (customerDisplay) {
    customerDisplay.textContent = vehicle ? `${customerName} • ${vehicle}` : customerName;
  }
  
  buttonsContainer.innerHTML = '';
  
  // View button (always shown)
  const viewBtn = document.createElement('button');
  viewBtn.className = 'btn';
  viewBtn.style.cssText = 'width: 100%; padding: 14px; font-size: 1rem;';
  viewBtn.textContent = 'View Details';
  viewBtn.onclick = () => {
    closeClaimBoardActionModal();
    const row = document.querySelector(`tr[data-appt-id="${appt.id}"]`);
    if (row) {
      const viewButton = Array.from(row.querySelectorAll('button')).find(b => (b.textContent || '').trim() === 'View');
      if (viewButton) viewButton.click();
    }
  };
  buttonsContainer.appendChild(viewBtn);
  
  if (role === 'foreman') {
    const assignBtn = document.createElement('button');
    assignBtn.className = 'btn info';
    assignBtn.style.cssText = 'width: 100%; padding: 14px; font-size: 1rem;';
    assignBtn.textContent = 'Assign to Staff';
    assignBtn.onclick = () => {
      closeClaimBoardActionModal();
      openAssignModal(appt.id);
    };
    buttonsContainer.appendChild(assignBtn);
    
      // Remove (send back to scheduled)
      const removeBtn = document.createElement('button');
      removeBtn.className = 'btn danger';
      removeBtn.style.cssText = 'width: 100%; padding: 14px; font-size: 1rem;';
      removeBtn.textContent = 'Remove';
      removeBtn.onclick = async () => {
        closeClaimBoardActionModal();
        openRemoveModalClaim(appt.id);
      };
      buttonsContainer.appendChild(removeBtn);
  } else {
    const claimBtn = document.createElement('button');
    claimBtn.className = 'btn info';
    claimBtn.style.cssText = 'width: 100%; padding: 14px; font-size: 1rem;';
    claimBtn.textContent = 'Claim Job';
    claimBtn.onclick = async () => {
      closeClaimBoardActionModal();
      await claimJob(appt.id);
    };
    buttonsContainer.appendChild(claimBtn);
  }
  
  modal.classList.remove('hidden');
}

function closeClaimBoardActionModal() {
  const modal = document.getElementById('claimBoardActionModal');
  if (modal) modal.classList.add('hidden');
  currentActionAppt = null;
}

window.closeClaimBoardActionModal = closeClaimBoardActionModal;

// ========== Assign Job from Claim Board (Foreman action) ==========
async function assignJobFromClaimBoard(apptId, staffAuthId, staffName) {
  const supabase = getSupabaseClient();
  const shopId = getCurrentShopId();
  
  const appts = await loadAppointments();
  const idx = (appts || []).findIndex(a => String(a.id) === String(apptId));
  if (idx === -1) {
    showErrorBanner('Appointment not found');
    return;
  }
  const appt = appts[idx];
  
  if (supabase && shopId) {
    const { data } = await supabase.from('data').select('jobs').eq('shop_id', shopId).single();
    const jobs = data?.jobs || [];
    let job = jobs.find(j => j.appointment_id === appt.id);
    
    if (job) {
      job.assigned_to = staffAuthId;
      job.status = 'in_progress';
      job.updated_at = new Date().toISOString();
      const jobIndex = jobs.findIndex(j => j.id === job.id);
      if (jobIndex >= 0) jobs[jobIndex] = job;
      await supabase.from('data').update({ jobs }).eq('shop_id', shopId);
      await supabase.from('jobs').update({
        assigned_to: staffAuthId,
        status: 'in_progress',
        updated_at: job.updated_at
      }).eq('id', job.id);
    }
  } else {
    const local = JSON.parse(localStorage.getItem('xm_data') || '{}');
    local.jobs = local.jobs || [];
    let job = local.jobs.find(j => j.appointment_id === appt.id);
    if (job) {
      job.assigned_to = staffAuthId;
      job.status = 'in_progress';
      job.updated_at = new Date().toISOString();
    }
    localStorage.setItem('xm_data', JSON.stringify(local));
  }
  
  delete appt.to_claim_board;
  appt.updated_at = new Date().toISOString();
  appts[idx] = appt;
  await saveAppointments(appts);
  
  if (typeof window.closeViewApptModal === 'function') {
    window.closeViewApptModal();
  }
  
  // Remove from seen since it's no longer on claim board
  seenJobIds.delete(appt.id);
  
  showSuccessBanner(`Job assigned to ${staffName}`);
  await initClaimBoard();
}

// ========== Claim Job (Staff action) ==========
async function claimJob(apptId) {
  const supabase = getSupabaseClient();
  const shopId = getCurrentShopId();
  const authId = await getCurrentAuthId();
  
  if (!authId) {
    showErrorBanner('Could not identify current user');
    return;
  }
  
  const appts = await loadAppointments();
  const idx = (appts || []).findIndex(a => String(a.id) === String(apptId));
  if (idx === -1) {
    showErrorBanner('Appointment not found');
    return;
  }
  const appt = appts[idx];
  
  if (supabase && shopId) {
    const { data } = await supabase.from('data').select('jobs').eq('shop_id', shopId).single();
    const jobs = data?.jobs || [];
    let job = jobs.find(j => j.appointment_id === appt.id);

    if (job) {
      job.assigned_to = authId;
      job.status = 'in_progress';
      job.updated_at = new Date().toISOString();
      const jobIndex = jobs.findIndex(j => j.id === job.id);
      if (jobIndex >= 0) jobs[jobIndex] = job;
      await supabase.from('data').update({ jobs }).eq('shop_id', shopId);
      await supabase.from('jobs').update({
        assigned_to: authId,
        status: 'in_progress',
        updated_at: job.updated_at
      }).eq('id', job.id);
    } else {
      // No canonical job row exists yet — create one in data.jobs and upsert canonical jobs table
      const jobId = `job_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const newJob = {
        id: jobId,
        appointment_id: appt.id,
        shop_id: shopId,
        customer: appt.customer || '',
        vehicle: appt.vehicle || '',
        service: appt.service || appt.service_requested || '',
        status: 'in_progress',
        assigned_to: authId,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      jobs.push(newJob);
      await supabase.from('data').update({ jobs }).eq('shop_id', shopId);

      // Attempt to upsert canonical jobs table via saveJobs (dynamic import to avoid circular deps)
      try {
        const { saveJobs } = await import('./jobs.js');
        await saveJobs([newJob]);
      } catch (e) {
        console.warn('[claim-board] Could not upsert new job to canonical jobs table:', e);
      }
    }
  } else {
    const local = JSON.parse(localStorage.getItem('xm_data') || '{}');
    local.jobs = local.jobs || [];
    let job = local.jobs.find(j => j.appointment_id === appt.id);
    if (job) {
      job.assigned_to = authId;
      job.status = 'in_progress';
      job.updated_at = new Date().toISOString();
    }
    localStorage.setItem('xm_data', JSON.stringify(local));
  }
  
  delete appt.to_claim_board;
  appt.updated_at = new Date().toISOString();
  appts[idx] = appt;
  await saveAppointments(appts);
  
  // Remove from seen since it's no longer on claim board
  seenJobIds.delete(appt.id);
  
  showSuccessBanner('Job claimed! Check your Jobs page.');
  await initClaimBoard();
}

function resetViewModalButtons() {
  const editBtn = document.getElementById('editFromViewBtn');
  const assignBtn = document.getElementById('assignFromViewBtn');
  
  if (editBtn) {
    editBtn.style.display = 'inline-block';
    editBtn.textContent = 'Edit Appointment';
  }
  if (assignBtn) {
    assignBtn.style.display = 'none';
  }
}

// Claim Board: list unassigned jobs
async function initClaimBoard(isPollingRefresh = false) {
  console.log('📥 Initializing Claim Board...');
  
  const role = await fetchCurrentUserRole();
  console.log('👤 Current user role:', role);
  
  await loadShopStaff();
  
  if (role === 'foreman') {
    createAssignModal();
  }
  
  createMobileActionModal();
  injectHighlightStyles();
  
  const originalClose = window.closeViewApptModal;
  window.closeViewApptModal = function() {
    resetViewModalButtons();
    if (originalClose) originalClose();
  };
  
  try {
    const supabase = getSupabaseClient();
    const shopId = getCurrentShopId();
    let jobs = [];

    if (supabase && shopId) {
      try {
        // Prefer the canonical `jobs` table as the source of truth for Claim Board.
        // Query only unassigned jobs to mirror Jobs page behavior and avoid re-creating
        // jobs that were removed from the jobs table but remain in data.jobs JSONB.
        try {
          const { data: jobsTable, error: jobsErr } = await supabase
            .from('jobs')
            .select('*')
            .eq('shop_id', shopId)
            .is('assigned_to', null);

          const jobsFromTable = (!jobsErr && Array.isArray(jobsTable)) ? jobsTable : [];

          // Also check appointments for in-progress / awaiting_parts statuses
          const { data: apptsTable, error: apptErr } = await supabase
            .from('appointments')
            .select('*')
            .eq('shop_id', shopId)
            .in('status', ['in_progress', 'awaiting_parts']);

          const apptsFromTable = (!apptErr && Array.isArray(apptsTable)) ? apptsTable : [];

          const derivedFromAppts = (apptsFromTable || []).filter(a => !jobsFromTable.find(j => String(j.appointment_id) === String(a.id))).map(a => ({
            id: a.id,
            appointment_id: a.id,
            customer: a.customer || '',
            vehicle: a.vehicle || '',
            service: a.service || a.service_requested || '',
            status: a.status || 'in_progress',
            created_at: a.created_at,
            updated_at: a.updated_at
          }));

          jobs = jobsFromTable.concat(derivedFromAppts);
        } catch (e) {
          // Fallback to JSONB data.jobs if anything goes wrong
          try {
            const { data } = await supabase.from('data').select('jobs').eq('shop_id', shopId).single();
            jobs = data?.jobs || [];
          } catch (e2) {
            console.warn('Could not load jobs from Supabase (data.jobs fallback):', e2);
          }
        }
      } catch (e) {
        console.warn('Could not load jobs from Supabase:', e);
      }
    }

    if (!jobs.length) {
      const localData = JSON.parse(localStorage.getItem('xm_data') || '{}');
      jobs = localData.jobs || [];
    }

    // Filter to unassigned jobs only
    let unassigned = (jobs || []).filter(j => !j.assigned_to);

    // Ensure we only show jobs whose appointment is actually in an active jobable status
    // (in_progress or awaiting_parts). This prevents stale job rows from appearing
    // on the Claim Board when the appointment has moved back to scheduled/new/completed.
    try {
      const appointmentIds = Array.from(new Set(unassigned.map(j => String(j.appointment_id)).filter(Boolean)));
      if (appointmentIds.length) {
        const { data: apptRows, error: apptErr } = await supabase
          .from('appointments')
          .select('id,status')
          .in('id', appointmentIds);
        const apptMap = (apptRows || []).reduce((m, r) => { if (r && r.id) m[String(r.id)] = r.status; return m; }, {});
        unassigned = unassigned.filter(j => {
          const aId = String(j.appointment_id || '');
          if (!aId) return (j.status === 'in_progress' || j.status === 'awaiting_parts');
          const st = apptMap[aId];
          return (st === 'in_progress' || st === 'awaiting_parts');
        });
      }
    } catch (e) {
      console.warn('[claim-board] Could not verify appointment statuses for filtering:', e);
    }

    // Enrich job rows from appointments when customer/vehicle/service are missing
    let apptLookup = new Map();
    try {
      const appts = await loadAppointments();
      apptLookup = new Map((appts || []).map(a => [String(a.id || a.appointment_id), a]));
    } catch (e) {
      console.warn('[claim-board] Could not load appointments for enrichment:', e);
    }

    const renderedAppts = unassigned.map(j => {
      const apptKey = String(j.appointment_id || j.id || '');
      const appt = apptLookup.get(apptKey) || {};
      const customer = j.customer || appt.customer || ((appt.customer_first || appt.customer_last) ? `${appt.customer_first || ''} ${appt.customer_last || ''}`.trim() : 'N/A');
      const vehicle = j.vehicle || appt.vehicle || (appt.vehicle_make ? `${appt.vehicle_make} ${appt.vehicle_model || ''}`.trim() : (appt.vehicle || 'N/A'));
      const service = j.service || appt.service || appt.service_requested || 'N/A';
      return {
        id: j.appointment_id || j.id,
        customer: customer || 'N/A',
        vehicle: vehicle || 'N/A',
        service: service || 'N/A',
        status: j.status || 'in_progress',
        created_at: j.created_at || new Date().toISOString(),
        updated_at: j.updated_at || new Date().toISOString()
      };
    });

    // On initial load, mark all as seen
    if (!isPollingRefresh && seenJobIds.size === 0) {
      seenJobIds = new Set(renderedAppts.map(a => a.id));
      lastKnownDataHash = generateDataHash(unassigned);
    }

    console.log(`🔎 Found ${renderedAppts.length} unassigned jobs on Claim Board`);
    currentFilteredAppts = renderedAppts;
    currentClaimRole = role;
    setDisplayedAppointments(renderedAppts);
    await renderAppointments(renderedAppts);

    try { initAppointmentNotes(); } catch (e) { console.warn('initAppointmentNotes failed:', e); }
    try { startNotesPolling(); } catch (e) { console.warn('startNotesPolling failed:', e); }

    // Post-process rows
    const isMobile = window.matchMedia && window.matchMedia('(max-width: 768px)').matches;
    const rows = document.querySelectorAll('#apptTable tbody tr');
    
    rows.forEach(row => {
      const apptId = row.dataset.apptId;
      if (!apptId) return;
      
      const appt = renderedAppts.find(a => String(a.id) === String(apptId));
      if (!appt) return;
      
      // Apply new job highlighting
      if (newJobHighlights.has(apptId)) {
        row.classList.add('new-job-highlight');
      }
      
      if (isMobile) {
        row.classList.add('appt-row-clickable');
        row.addEventListener('click', (e) => {
          if (e.target.closest('button')) return;
          openClaimBoardActionModal(appt, role);
        });
      }
      
      const actionsGrid = row.querySelector('td:last-child .appt-actions-grid');
      if (!actionsGrid) return;

      const buttons = Array.from(actionsGrid.querySelectorAll('button'));
      buttons.forEach(btn => {
        const txt = (btn.textContent || '').trim();
        if (txt === 'Invoice' || txt === 'Edit') btn.remove();
        if (btn.getAttribute && btn.getAttribute('aria-label') === 'Delete appointment') btn.remove();
      });

      const viewBtn = Array.from(actionsGrid.querySelectorAll('button')).find(b => (b.textContent || '').trim() === 'View');
      if (viewBtn) {
        viewBtn.addEventListener('click', () => {
          setTimeout(() => {
            try {
              const editBtn = document.getElementById('editFromViewBtn');
              if (editBtn) {
                if (role === 'foreman') {
                  editBtn.textContent = 'Assign Job';
                  editBtn.className = 'btn info';
                  editBtn.style.display = 'inline-block';
                  editBtn.onclick = (e) => {
                    e.preventDefault();
                    if (typeof window.closeViewApptModal === 'function') {
                      window.closeViewApptModal();
                    }
                    openAssignModal(apptId);
                  };
                } else {
                  editBtn.style.display = 'none';
                }
              }
            } catch (e) { console.error('Failed to adjust view modal:', e); }
          }, 150);
        });
      }

      if (!isMobile) {
        if (role === 'foreman') {
          if (!actionsGrid.querySelector('.assign-btn')) {
            const assignBtn = document.createElement('button');
            assignBtn.className = 'btn small info assign-btn';
            assignBtn.textContent = 'Assign';
            assignBtn.title = 'Assign this job to a staff member';
            assignBtn.addEventListener('click', async (e) => {
              e.stopPropagation();
              openAssignModal(apptId);
            });
            actionsGrid.appendChild(assignBtn);
          }
          // Add Remove button for foreman to send job back to scheduled
          if (!actionsGrid.querySelector('.remove-btn')) {
            const removeBtn = document.createElement('button');
            removeBtn.className = 'btn small danger remove-btn';
            removeBtn.textContent = 'Remove';
            removeBtn.title = 'Send job back to scheduled appointments';
            removeBtn.addEventListener('click', async (e) => {
              e.stopPropagation();
                    openRemoveModalClaim(apptId);
            });
            actionsGrid.appendChild(removeBtn);
          }
          
        } else {
          if (!actionsGrid.querySelector('.claim-btn')) {
            const claimBtn = document.createElement('button');
            claimBtn.className = 'btn small info claim-btn';
            claimBtn.textContent = 'Claim';
            claimBtn.title = 'Claim this job for yourself';
            claimBtn.addEventListener('click', async (e) => {
              e.stopPropagation();
              await claimJob(apptId);
            });
            actionsGrid.appendChild(claimBtn);
          }
        }
      }
    });

    const searchInput = document.getElementById('apptSearch');
    const filterBtn = document.getElementById('apptFilter');
    if (searchInput) searchInput.addEventListener('input', () => applyFilters(renderedAppts, role));
    if (filterBtn) filterBtn.addEventListener('click', () => applyFilters(renderedAppts, role));
    
    // Start polling only on initial load
    if (!isPollingRefresh) {
      startDataPolling();
    }
    // Reapply customizations after any external render (e.g., notes polling)
    if (!window.__claimAppointmentsRenderedListenerAdded) {
      window.__claimAppointmentsRenderedListenerAdded = true;
      window.addEventListener('appointmentsRendered', () => {
        try {
          // Use the currently displayed filtered appointments and cached role
          reapplyClaimRowCustomizations();
        } catch (e) { console.warn('[claim-board] appointmentsRendered handler failed', e); }
      });
    }
  } catch (e) {
    console.error('Error initializing Claim Board:', e);
  }
}

function reapplyClaimRowCustomizations() {
  try {
    const role = currentClaimRole;
    const renderedAppts = currentFilteredAppts || [];
    const isMobile = window.matchMedia && window.matchMedia('(max-width: 768px)').matches;
    const rows = document.querySelectorAll('#apptTable tbody tr');
    rows.forEach(row => {
      const apptId = row.dataset.apptId;
      if (!apptId) return;
      const appt = renderedAppts.find(a => String(a.id) === String(apptId));
      if (!appt) return;

      // Apply highlight if needed
      if (newJobHighlights.has(apptId)) {
        if (!row.classList.contains('new-job-highlight')) {
          row.classList.remove('new-job-highlight');
          // eslint-disable-next-line no-unused-expressions
          row.offsetWidth;
          row.classList.add('new-job-highlight');
        }
      } else {
        row.classList.remove('new-job-highlight');
      }

      if (isMobile) {
        row.classList.add('appt-row-clickable');
        // ensure click handler exists
        if (!row.__claimRowClickBound) {
          row.addEventListener('click', (e) => {
            if (e.target.closest('button')) return;
            openClaimBoardActionModal(appt, role);
          });
          row.__claimRowClickBound = true;
        }
      }

      const actionsGrid = row.querySelector('td:last-child .appt-actions-grid');
      if (!actionsGrid) return;

      // Remove admin-only buttons that shouldn't be present
      const buttons = Array.from(actionsGrid.querySelectorAll('button'));
      buttons.forEach(btn => {
        const txt = (btn.textContent || '').trim();
        if (txt === 'Invoice' || txt === 'Edit') btn.remove();
        if (btn.getAttribute && btn.getAttribute('aria-label') === 'Delete appointment') btn.remove();
      });

      // Ensure Assign/Claim/Remove buttons are present per role
      if (!isMobile) {
        if (role === 'foreman') {
          if (!actionsGrid.querySelector('.assign-btn')) {
            const assignBtn = document.createElement('button');
            assignBtn.className = 'btn small info assign-btn';
            assignBtn.textContent = 'Assign';
            assignBtn.title = 'Assign this job to a staff member';
            assignBtn.addEventListener('click', async (e) => { e.stopPropagation(); openAssignModal(apptId); });
            actionsGrid.appendChild(assignBtn);
          }
          if (!actionsGrid.querySelector('.remove-btn')) {
            const removeBtn = document.createElement('button');
            removeBtn.className = 'btn small danger remove-btn';
            removeBtn.textContent = 'Remove';
            removeBtn.title = 'Send job back to scheduled appointments';
            removeBtn.addEventListener('click', async (e) => { e.stopPropagation(); openRemoveModalClaim(apptId); });
            actionsGrid.appendChild(removeBtn);
          }
        } else {
          if (!actionsGrid.querySelector('.claim-btn')) {
            const claimBtn = document.createElement('button');
            claimBtn.className = 'btn small info claim-btn';
            claimBtn.textContent = 'Claim';
            claimBtn.title = 'Claim this job for yourself';
            claimBtn.addEventListener('click', async (e) => { e.stopPropagation(); await claimJob(apptId); });
            actionsGrid.appendChild(claimBtn);
          }
        }
      }
    });
  } catch (e) { console.warn('[claim-board] reapplyClaimRowCustomizations failed', e); }
}

// Send job back to scheduled appointments (remove from claim board)
// perform the send-back operation (no confirm)
async function performSendJobBackToScheduled(apptId) {
  const supabase = getSupabaseClient();
  const shopId = getCurrentShopId();

  const appts = await loadAppointments();
  const idx = (appts || []).findIndex(a => String(a.id) === String(apptId));
  if (idx === -1) { showErrorBanner('Appointment not found'); return; }
  const appt = appts[idx];

  if (supabase && shopId) {
    try {
      const { data } = await supabase.from('data').select('jobs').eq('shop_id', shopId).single();
      const jobs = data?.jobs || [];
      // Determine which jobs are being removed from data.jobs
      const removedJobs = (jobs || []).filter(j => String(j.appointment_id) === String(apptId) || String(j.id) === String(apptId));
      const newJobs = (jobs || []).filter(j => !(String(j.appointment_id) === String(apptId) || String(j.id) === String(apptId)));
      await supabase.from('data').update({ jobs: newJobs }).eq('shop_id', shopId);
      // Also remove from jobs table where appointment_id matches
      try {
        const { error: delByApptErr } = await supabase.from('jobs').delete().eq('appointment_id', apptId);
        if (delByApptErr) console.warn('[claim-board] Could not delete job(s) by appointment_id:', delByApptErr);
      } catch (e) { console.warn('[claim-board] delete by appointment_id failed:', e); }

      // Additionally attempt to delete by specific job IDs that were removed from data.jobs
      const removedIds = removedJobs.map(r => r.id).filter(Boolean);
      if (removedIds.length) {
        try {
          const { data: delData, error: delErr } = await supabase
            .from('jobs')
            .delete()
            .in('id', removedIds)
            .select('id');
          if (delErr) {
            console.warn('[claim-board] Could not delete job(s) by id:', delErr);
          } else if (delData && delData.length) {
            console.log('[claim-board] Deleted job rows by id:', delData.map(d => d.id));
          } else {
            console.log('[claim-board] No job rows deleted by id for ids:', removedIds);
          }
        } catch (e) {
          console.warn('[claim-board] delete by id attempt failed:', e);
        }
      }
    } catch (e) {
      console.error('Failed to remove job from data:', e);
    }
  } else {
    const local = JSON.parse(localStorage.getItem('xm_data') || '{}');
    local.jobs = (local.jobs || []).filter(j => String(j.appointment_id) !== String(apptId) && String(j.id) !== String(apptId));
    localStorage.setItem('xm_data', JSON.stringify(local));
  }

  // Update appointment status back to scheduled
  appt.status = 'scheduled';
  appt.updated_at = new Date().toISOString();
  appts[idx] = appt;
  await saveAppointments(appts);

  // Remove from seen highlights and list
  seenJobIds.delete(apptId);
  newJobHighlights.delete(apptId);

  showSuccessBanner('Job returned to Scheduled');
  await initClaimBoard();
}

// Hard delete logic removed — temporarily disabled

async function applyFilters(base, role) {
  const q = (document.getElementById('apptSearch')?.value || '').toLowerCase().trim();
  const status = (document.getElementById('apptStatus')?.value || '').trim();
  let set = base.slice();
  if (status) set = set.filter(a => (a.status || '').toLowerCase() === status.toLowerCase());
  if (q) set = set.filter(a => (a.customer || '').toLowerCase().includes(q) || (a.service || '').toLowerCase().includes(q));
  
  currentFilteredAppts = set;
  await renderAppointments(set);
  
  const isMobile = window.matchMedia && window.matchMedia('(max-width: 768px)').matches;
  const rows = document.querySelectorAll('#apptTable tbody tr');
  
  rows.forEach(row => {
    const apptId = row.dataset.apptId;
    if (!apptId) return;
    
    const appt = set.find(a => String(a.id) === String(apptId));
    if (!appt) return;
    
    // Apply highlighting
    if (newJobHighlights.has(apptId)) {
      row.classList.add('new-job-highlight');
    }
    
    if (isMobile) {
      row.classList.add('appt-row-clickable');
      row.addEventListener('click', (e) => {
        if (e.target.closest('button')) return;
        openClaimBoardActionModal(appt, role);
      });
    }
    
    const actionsGrid = row.querySelector('td:last-child .appt-actions-grid');
    if (!actionsGrid) return;

    const buttons = Array.from(actionsGrid.querySelectorAll('button'));
    buttons.forEach(btn => {
      const txt = (btn.textContent || '').trim();
      if (txt === 'Invoice' || txt === 'Edit') btn.remove();
      if (btn.getAttribute && btn.getAttribute('aria-label') === 'Delete appointment') btn.remove();
    });

    if (!isMobile) {
      if (role === 'foreman') {
        if (!actionsGrid.querySelector('.assign-btn')) {
          const assignBtn = document.createElement('button');
          assignBtn.className = 'btn small info assign-btn';
          assignBtn.textContent = 'Assign';
          assignBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            openAssignModal(apptId);
          });
          actionsGrid.appendChild(assignBtn);
        }
      } else {
        if (!actionsGrid.querySelector('.claim-btn')) {
          const claimBtn = document.createElement('button');
          claimBtn.className = 'btn small info claim-btn';
          claimBtn.textContent = 'Claim';
          claimBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            await claimJob(apptId);
          });
          actionsGrid.appendChild(claimBtn);
        }
      }
    }
  });
}

// ========== Setup Theme and Logout ==========
/**
 * Show styled logout confirmation modal (local to claim-board page)
 */
function showLogoutConfirmModal() {
  const existing = document.getElementById('logout-confirm-modal');
  if (existing) existing.remove();
  const modal = document.createElement('div');
  modal.id = 'logout-confirm-modal';
  modal.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.5);
    z-index: 10060;
    display: flex;
    align-items: center;
    justify-content: center;
    animation: fadeIn 0.2s ease;
  `;
  modal.innerHTML = `
    <div style="background: var(--card, #fff); border-radius:12px; padding:20px; max-width:380px; width:90%; box-shadow:0 20px 60px rgba(0,0,0,0.3); animation: slideUp 0.2s ease;">
      <div style="text-align:center; margin-bottom:12px;">
        <div style="width:48px;height:48px;margin:0 auto 12px;background:linear-gradient(135deg,#ef4444 0%,#dc2626 100%);border-radius:50%;display:flex;align-items:center;justify-content:center;">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>
        </div>
        <h3 style="margin:0 0 6px; font-size:1.1rem; color:var(--text);">Sign Out?</h3>
        <p style="margin:0; color:var(--muted); font-size:0.95rem;">Are you sure you want to sign out of your account?</p>
      </div>
      <div style="display:flex; gap:10px;">
        <button id="logout-cancel-btn" style="flex:1;padding:10px 12px;border:1px solid var(--line);background:var(--bg);color:var(--text);border-radius:8px;cursor:pointer;">Cancel</button>
        <button id="logout-confirm-btn" style="flex:1;padding:10px 12px;border:none;background:linear-gradient(135deg,#ef4444 0%,#dc2626 100%);color:#fff;border-radius:8px;cursor:pointer;font-weight:600;">Sign Out</button>
      </div>
    </div>
  `;

  if (!document.getElementById('logout-modal-styles')) {
    const style = document.createElement('style');
    style.id = 'logout-modal-styles';
    style.textContent = `
      @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
      @keyframes slideUp { from { transform: translateY(20px); opacity: 0;} to { transform: translateY(0); opacity:1;} }
    `;
    document.head.appendChild(style);
  }

  document.body.appendChild(modal);

  document.getElementById('logout-cancel-btn').onclick = () => modal.remove();
  document.getElementById('logout-confirm-btn').onclick = async () => {
    const btn = document.getElementById('logout-confirm-btn');
    btn.textContent = 'Signing out...';
    btn.disabled = true;
    await logout();
  };

  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.remove();
  });

  const escHandler = (e) => { if (e.key === 'Escape') { modal.remove(); document.removeEventListener('keydown', escHandler); } };
  document.addEventListener('keydown', escHandler);
}

function setupPageControls() {
  const themeBtn = byId('themeToggle');
  const mobileThemeBtn = byId('mobileThemeToggle');
  if (themeBtn) themeBtn.onclick = toggleTheme;
  if (mobileThemeBtn) mobileThemeBtn.onclick = (e) => { e.preventDefault(); toggleTheme(); };
  const logoutBtn = byId('logoutBtn');
  const mobileLogoutBtn = byId('mobileLogoutBtn');
  if (logoutBtn) logoutBtn.onclick = () => showLogoutConfirmModal();
  if (mobileLogoutBtn) mobileLogoutBtn.onclick = (e) => {
    e.preventDefault();
    // close mobile nav if open
    const menuToggle = byId('menuToggle');
    const mainNav = byId('mainNav');
    if (mainNav && menuToggle && mainNav.classList.contains('active')) {
      mainNav.classList.remove('active');
      menuToggle.classList.remove('active');
    }
    showLogoutConfirmModal();
  };
  
  const menuToggle = byId('menuToggle');
  const mainNav = byId('mainNav');
  if (menuToggle && mainNav) {
    menuToggle.onclick = () => {
      mainNav.classList.toggle('active');
      menuToggle.classList.toggle('active');
    };
  }
  
  setThemeFromUser();
}

async function addAdminLinkToNav() {
  try {
    const userId = await getCurrentUserId();
    if (!userId) return;
    
    const adminCheck = await shouldShowAdminPage(userId);
    if (!adminCheck.showAdmin) return;
    
    const mainNav = document.getElementById('mainNav');
    if (mainNav && !document.getElementById('adminNavLink')) {
      const adminLink = document.createElement('a');
      adminLink.id = 'adminNavLink';
      adminLink.href = 'admin.html';
      adminLink.textContent = 'Admin';
      adminLink.style.cssText = `
        background: linear-gradient(135deg, var(--accent), #c72952);
        color: white;
        font-weight: 600;
        border-radius: 8px;
        padding: 8px 16px;
        box-shadow: 0 2px 8px rgba(225, 29, 72, 0.2);
        transition: all 0.2s;
      `;
      mainNav.appendChild(adminLink);
    }
  } catch (e) {
    console.warn('Could not add admin link:', e);
  }
}

async function initPage() {
  console.log('🔐 Claim Board: Starting security checks...');
  
  setupPageControls();
  
  try {
    const hasAuth = await requireAuth();
    if (!hasAuth) return;
    
    await applyNavPermissions();
    
    const hasAccess = await enforcePageAccess();
    if (!hasAccess) return;
    
    try {
      // Attempt to load shop row and initialize industry config with real shop data
      try {
        const supabase = getSupabaseClient();
        const shopId = getCurrentShopId();
        if (supabase && shopId) {
          const { data: shopRow } = await supabase.from('shops').select('*').eq('id', shopId).single();
          if (shopRow) {
            await initializeShopConfig(shopRow);
          } else {
            await initializeShopConfig();
          }
        } else {
          await initializeShopConfig();
        }
      } catch (e) {
        // Fall back to default behavior if supabase/shop lookup fails
        try { await initializeShopConfig(); } catch (ee) {}
      }
    } catch (e) {}
    
    try {
      await initShopSwitcher();
      await addAdminLinkToNav();
    } catch (e) {}
    
    await initClaimBoard();
    console.log('✅ Claim Board initialized with live polling');
    
  } catch (err) {
    console.error('❌ Page initialization error:', err);
  }
}

initPage();

export { initClaimBoard };

// ========== Helper Functions ==========
async function fetchCurrentUserRole() {
  if (cachedUserRole) return cachedUserRole;
  
  const supabase = getSupabaseClient();
  const shopId = getCurrentShopId();
  
  if (supabase) {
    try {
      const { data: authData } = await supabase.auth.getUser();
      const authId = authData?.user?.id;
      
      if (authId && shopId) {
        const { data: staffRow } = await supabase
          .from('shop_staff')
          .select('role')
          .eq('auth_id', authId)
          .eq('shop_id', shopId)
          .limit(1)
          .single();
        
        if (staffRow && staffRow.role) {
          cachedUserRole = staffRow.role;
          return cachedUserRole;
        }
        
        const { data: userRow } = await supabase
          .from('users')
          .select('role')
          .eq('id', authId)
          .limit(1)
          .single();
        
        if (userRow && userRow.role) {
          cachedUserRole = userRow.role;
          return cachedUserRole;
        }
      }
    } catch (e) {}
  }
  
  try {
    const session = JSON.parse(localStorage.getItem('xm_session') || '{}');
    const users = JSON.parse(localStorage.getItem('xm_users') || '[]');
    const u = users.find(x => x.email === session.email) || {};
    cachedUserRole = u.role || u.shop_staff_role || 'staff';
    return cachedUserRole;
  } catch (e) {
    return 'staff';
  }
}

function getCurrentShopId() {
  try {
    const session = JSON.parse(localStorage.getItem('xm_session') || '{}');
    return session.shopId || null;
  } catch (e) { return null; }
}

async function getCurrentAuthId() {
  try {
    const supabase = getSupabaseClient();
    if (!supabase) return null;
    const { data: authData } = await supabase.auth.getUser();
    return authData?.user?.id || null;
  } catch (e) { return null; }
}
