import { loadAppointments, renderAppointments, saveAppointments, initAppointmentNotes, startNotesPolling, setDisplayedAppointments, openViewModal } from './appointments.js';
import { getSupabaseClient } from '../helpers/supabase.js';
import { requireAuth, applyNavPermissions, enforcePageAccess } from '../helpers/auth.js';
import { initializeShopConfig } from '../helpers/shop-config-loader.js';
import { toggleTheme, logout, setThemeFromUser } from '../helpers/user.js';
import { byId } from '../helpers/utils.js';
import { initShopSwitcher } from '../helpers/shop-switcher-ui.js';
import { shouldShowAdminPage, getCurrentUserId, getUserShops, getCurrentShopId as getMultiShopId, switchShop } from '../helpers/multi-shop.js';

// Foreman Job Board: show only New and Scheduled
const FOREMAN_STATUSES = ['new', 'scheduled'];

// Store staff list for assign modal
let shopStaffList = [];
// Cache user role
let cachedUserRole = null;
// Current role used for re-customization after renders
let currentForemanRole = null;
// Store current filtered appointments for button customization
let currentFilteredAppts = [];
// Mobile action modal tracking
let currentActionAppt = null;
// Data polling for live updates
let foremanDataPollingInterval = null;
const FOREMAN_DATA_POLL_INTERVAL = 15000; // 15s
let foremanLastKnownDataHash = null;
// Highlight tracking
let foremanSeenJobIds = new Set();
// Track seen appointment ids as well so purely-appointment additions get highlighted
let foremanSeenApptIds = new Set();
let foremanNewJobHighlights = new Map();
const FOREMAN_HIGHLIGHT_DURATION = 8000; // ms
const FOREMAN_HIGHLIGHT_FADE_MS = 600; // fade out duration

function injectForemanHighlightStyles() {
  if (document.getElementById('foreman-highlight-styles')) return;
  const style = document.createElement('style');
  style.id = 'foreman-highlight-styles';
  style.textContent = `
    @keyframes foremanFade {
      0% { background-color: rgba(16, 185, 129, 0); }
      10% { background-color: rgba(16, 185, 129, 0.25); }
      50% { background-color: rgba(16, 185, 129, 0.15); }
      90% { background-color: rgba(16, 185, 129, 0.25); }
      100% { background-color: rgba(16, 185, 129, 0); }
    }
    /* Fade in, subtle pulse, then fade out over the highlight duration */
    tr.new-job-highlight-foreman {
      animation-name: foremanFade;
      animation-duration: 8s; /* matches FOREMAN_HIGHLIGHT_DURATION */
      animation-timing-function: ease-in-out;
      animation-iteration-count: 1;
      animation-fill-mode: forwards;
    }
    /* When fading out, pause the animation and transition to transparent */
    tr.new-job-fadeout-foreman {
      animation-play-state: paused !important;
      transition: background-color ${FOREMAN_HIGHLIGHT_FADE_MS}ms ease !important;
      background-color: rgba(16, 185, 129, 0) !important;
    }
  `;
  document.head.appendChild(style);
}

// Start a smooth fade-out for a given appointment row by capturing its
// computed background, applying it as an inline style, then transitioning
// it to transparent. Cleanup happens after the fade completes.
function startFadeOutForRow(id) {
  try {
    const row = document.querySelector(`#apptTable tbody tr[data-appt-id="${id}"]`);
    if (!row) return;
    const comp = getComputedStyle(row).backgroundColor;
    // Apply current background as inline style so transition has a start value
    row.style.backgroundColor = comp;
    row.style.transition = `background-color ${FOREMAN_HIGHLIGHT_FADE_MS}ms ease`;
    // Remove the animation class so it doesn't override our inline background
    row.classList.remove('new-job-highlight-foreman');
    // Force reflow then transition to transparent
    // eslint-disable-next-line no-unused-expressions
    row.offsetWidth;
    row.style.backgroundColor = 'rgba(16, 185, 129, 0)';
  } catch (e) {
    /* ignore */
  }
}

function applyForemanHighlightsToRows() {
  injectForemanHighlightStyles();
  const rows = document.querySelectorAll('#apptTable tbody tr');
  rows.forEach(row => {
    const apptId = row.dataset.apptId;
    if (apptId && foremanNewJobHighlights.has(apptId)) {
      // If not already highlighted, add class; if already present, leave it.
      if (!row.classList.contains('new-job-highlight-foreman')) {
        // Restart animation reliably by removing then forcing reflow before adding
        row.classList.remove('new-job-highlight-foreman');
        // Force reflow
        // eslint-disable-next-line no-unused-expressions
        row.offsetWidth;
        row.classList.add('new-job-highlight-foreman');
      }
    } else {
      row.classList.remove('new-job-highlight-foreman');
    }
  });
}

// ========== Success Banner ==========
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

function generateForemanDataHash(jobs, appointments) {
  const jobsPart = (jobs || []).map(j => `${j.id}:${j.assigned_to || ''}:${j.status || ''}:${j.updated_at || ''}`).sort().join('|');
  const apptsPart = (appointments || []).map(a => `${a.id}:${a.status || ''}:${a.updated_at || ''}`).sort().join('|');
  return `${jobsPart}||${apptsPart}`;
}

async function pollForemanDataUpdates() {
  try {
    const supabase = getSupabaseClient();
    const shopId = getCurrentShopId();
    if (!supabase || !shopId) return;

    const { data } = await supabase.from('data').select('jobs,appointments').eq('shop_id', shopId).single();
    const jobs = data?.jobs || [];
    const appointments = data?.appointments || [];

    // Filter to appointments that matter to the foreman board (new/scheduled)
    const relevantAppts = (appointments || []).filter(a => (a.status || 'new') === 'new' || (a.status || '') === 'scheduled');

    const currentHash = generateForemanDataHash(jobs, relevantAppts);
    // Build current job id set (use appointment_id fallback)
    const currentJobIds = new Set((jobs || []).map(j => String(j.appointment_id || j.id)).filter(Boolean));
    // Also build current appointment id set for highlighting pure-appointment additions
    const currentApptIds = new Set((relevantAppts || []).map(a => String(a.id)).filter(Boolean));

    if (foremanLastKnownDataHash === null) {
      foremanLastKnownDataHash = currentHash;
      foremanSeenJobIds = currentJobIds;
      foremanSeenApptIds = currentApptIds;
      return;
    }

    if (currentHash !== foremanLastKnownDataHash) {
      console.log('[foreman] Data changed, refreshing foreman board...');
      foremanLastKnownDataHash = currentHash;

      // Detect newly added jobs and mark for highlight
      for (const jobId of currentJobIds) {
        if (!foremanSeenJobIds.has(jobId)) {
            foremanNewJobHighlights.set(jobId, Date.now());
            // schedule removal of highlight with a graceful fade
            (function(id) {
              setTimeout(() => {
                  // start inline fade on DOM element if present
                  try { startFadeOutForRow(id); } catch (e) {}
                  // after fade duration, remove highlight tracking and reapply classes, then cleanup styles
                  setTimeout(() => {
                    foremanNewJobHighlights.delete(id);
                    try { applyForemanHighlightsToRows(); } catch (e) {}
                    try {
                      const row = document.querySelector(`#apptTable tbody tr[data-appt-id="${id}"]`);
                      if (row) {
                        row.style.transition = '';
                        row.style.backgroundColor = '';
                      }
                    } catch (e) {}
                  }, FOREMAN_HIGHLIGHT_FADE_MS);
                }, FOREMAN_HIGHLIGHT_DURATION);
            })(jobId);
          }
      }

      // Detect newly added appointments (no job) and mark for highlight
      for (const apptId of currentApptIds) {
        if (!foremanSeenApptIds.has(apptId)) {
          foremanNewJobHighlights.set(apptId, Date.now());
          // schedule graceful fade-out then removal
          (function(id) {
            setTimeout(() => {
              try { startFadeOutForRow(id); } catch (e) {}
              setTimeout(() => {
                foremanNewJobHighlights.delete(id);
                try { applyForemanHighlightsToRows(); } catch (e) {}
                try {
                  const row = document.querySelector(`#apptTable tbody tr[data-appt-id="${id}"]`);
                  if (row) {
                    row.style.transition = '';
                    row.style.backgroundColor = '';
                  }
                } catch (e) {}
              }, FOREMAN_HIGHLIGHT_FADE_MS);
            }, FOREMAN_HIGHLIGHT_DURATION);
          })(apptId);
        }
      }

      // Update seen sets
      foremanSeenJobIds = currentJobIds;
      foremanSeenApptIds = currentApptIds;

          // Refresh just the displayed appointments and UI without re-running full initialization
          try {
            await refreshForemanDisplay();
            // Apply highlights after re-render
            try { applyForemanHighlightsToRows(); } catch (e) {}
          } catch (e) {
            console.warn('[foreman] Failed to refresh board after data change', e);
          }
    }
  } catch (e) {
    console.warn('[foreman] Polling error:', e);
  }
  }

  // Lightweight refresh: re-load appointments, re-render only the table and reapply button customizations
  async function refreshForemanDisplay() {
  try {
    const appts = await loadAppointments();
    const filtered = (appts || []).filter(a => FOREMAN_STATUSES.includes(a.status));
    currentFilteredAppts = filtered;
    setDisplayedAppointments(filtered);
    await renderAppointments(filtered);
    // short delay to allow DOM to settle before customizing
    await new Promise(resolve => setTimeout(resolve, 50));
    try { customizeForemanButtons(filtered, currentForemanRole); } catch (e) { console.warn('[foreman] customize after refresh failed', e); }
    try { applyForemanHighlightsToRows(); } catch (e) {}
  } catch (e) {
    console.warn('[foreman] refreshForemanDisplay error:', e);
  }
}

function startForemanDataPolling() {
  if (foremanDataPollingInterval) clearInterval(foremanDataPollingInterval);
  // kick off an immediate poll then set interval
  pollForemanDataUpdates();
  foremanDataPollingInterval = setInterval(pollForemanDataUpdates, FOREMAN_DATA_POLL_INTERVAL);
  console.log('[foreman] Started data polling every', FOREMAN_DATA_POLL_INTERVAL / 1000, 's');
}

function stopForemanDataPolling() {
  if (foremanDataPollingInterval) { clearInterval(foremanDataPollingInterval); foremanDataPollingInterval = null; console.log('[foreman] Stopped data polling'); }
}

// ========== Fetch Current User Role (from Supabase) ==========
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
          console.log('👤 User role from shop_staff:', cachedUserRole);
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
          console.log('👤 User role from users:', cachedUserRole);
          return cachedUserRole;
        }
      }
    } catch (e) {
      console.warn('Error fetching user role from Supabase:', e);
    }
  }
  
  try {
    const session = JSON.parse(localStorage.getItem('xm_session') || '{}');
    const users = JSON.parse(localStorage.getItem('xm_users') || '[]');
    const u = users.find(x => x.email === session.email) || {};
    cachedUserRole = u.role || u.shop_staff_role || 'staff';
    console.log('👤 User role from localStorage:', cachedUserRole);
    return cachedUserRole;
  } catch (e) {
    return 'staff';
  }
}

// ========== Load Shop Staff ==========
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
    console.log(`📋 Loaded ${shopStaffList.length} staff members (including foremen)`);
  } catch (e) {
    console.error('Failed to load shop staff:', e);
    shopStaffList = [];
  }
}

// ========== Assign Modal ==========
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
        <p style="margin-bottom: 12px; color: var(--muted);">Select a team member to assign this job to:</p>
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

function openAssignModal(apptId) {
  const modal = document.getElementById('assignJobModal');
  const container = document.getElementById('staffListContainer');
  
  if (!modal || !container) return;
  
  modal.dataset.apptId = apptId;
  
  if (shopStaffList.length === 0) {
    container.innerHTML = '<p class="notice">No team members found. Add staff in Settings.</p>';
  } else {
    container.innerHTML = shopStaffList.map(staff => {
      const displayRole = staff.role === 'foreman' ? 'Foreman' : 'Staff';
      return `
        <button class="btn" style="text-align: left; justify-content: flex-start; padding: 12px;" 
                onclick="selectStaffForAssign('${staff.auth_id || staff.id}', '${(staff.first_name || '').replace(/'/g, "\\'")} ${(staff.last_name || '').replace(/'/g, "\\'")}')">
          <div style="display: flex; flex-direction: column; align-items: flex-start;">
            <strong>${staff.first_name || ''} ${staff.last_name || ''}</strong>
            <span style="font-size: 12px; color: var(--muted);">${staff.email || ''} • ${displayRole}</span>
          </div>
        </button>
      `;
    }).join('');
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
    await assignJobToStaff(apptId, staffAuthId, staffName);
  } catch (e) {
    console.error('Assignment failed:', e);
    showErrorBanner('Failed to assign job');
  }
};

// ========== Mobile Action Modal ==========
function createMobileActionModal() {
  const existing = document.getElementById('foremanActionModal');
  if (existing) existing.remove();
  
  const modal = document.createElement('div');
  modal.id = 'foremanActionModal';
  modal.className = 'modal-overlay hidden';
  modal.innerHTML = `
    <div class="modal-content" onclick="event.stopPropagation()" style="max-width: 340px; margin: 18vh auto; padding: 0; border-radius: 16px; overflow: hidden;">
      <div class="modal-head" style="padding: 16px 20px; border-bottom: 1px solid var(--line);">
        <h3 id="foremanActionTitle" style="margin: 0; font-size: 1.1rem;">Appointment Actions</h3>
        <button onclick="closeForemanActionModal()" class="btn-close" style="position: absolute; right: 12px; top: 12px;">&times;</button>
      </div>
      <div class="modal-body" style="padding: 12px 16px;">
        <p id="foremanActionCustomer" style="margin: 0 0 16px 0; color: var(--muted); font-size: 0.95rem;"></p>
        <div id="foremanActionButtons" style="display: flex; flex-direction: column; gap: 10px;">
          <button id="foremanActionView" class="btn" style="width: 100%; padding: 14px; font-size: 1rem;">View Details</button>
          <button id="foremanActionAssign" class="btn info" style="width: 100%; padding: 14px; font-size: 1rem;">Assign Job</button>
          <button id="foremanActionClaimBoard" class="btn secondary" style="width: 100%; padding: 14px; font-size: 1rem;">Send to Claim Board</button>
        </div>
      </div>
    </div>
  `;
  modal.onclick = () => closeForemanActionModal();
  document.body.appendChild(modal);
  
  // Wire up button handlers
  document.getElementById('foremanActionView').onclick = handleForemanActionView;
  document.getElementById('foremanActionAssign').onclick = handleForemanActionAssign;
  document.getElementById('foremanActionClaimBoard').onclick = handleForemanActionClaimBoard;
}

function openForemanActionModal(appt) {
  currentActionAppt = appt;
  
  const modal = document.getElementById('foremanActionModal');
  const customerDisplay = document.getElementById('foremanActionCustomer');
  
  if (!modal) return;
  
  // Set customer info
  const customerName = appt.customer_first && appt.customer_last 
    ? `${appt.customer_first} ${appt.customer_last}`.trim()
    : appt.customer || 'Unknown Customer';
  const vehicle = appt.vehicle || '';
  if (customerDisplay) {
    customerDisplay.textContent = vehicle ? `${customerName} • ${vehicle}` : customerName;
  }
  
  modal.classList.remove('hidden');
}

function closeForemanActionModal() {
  const modal = document.getElementById('foremanActionModal');
  if (modal) modal.classList.add('hidden');
  currentActionAppt = null;
}

function handleForemanActionView() {
  if (!currentActionAppt) return;
  const appt = currentActionAppt;
  closeForemanActionModal();
  
  // Open the shared view modal
  if (typeof openViewModal === 'function') {
    openViewModal(appt);
    
    // Adjust modal for foreman after it opens
    setTimeout(() => {
      try {
        const editBtn = document.getElementById('editFromViewBtn');
        if (editBtn) {
          editBtn.textContent = 'Assign Job';
          editBtn.className = 'btn info';
          editBtn.style.display = 'inline-block';
          editBtn.onclick = (e) => {
            e.preventDefault();
            if (typeof window.closeViewApptModal === 'function') {
              window.closeViewApptModal();
            }
            openAssignModal(appt.id);
          };
        }
      } catch (e) { console.error('Failed to adjust view modal:', e); }
    }, 150);
  }
}

function handleForemanActionAssign() {
  if (!currentActionAppt) return;
  const apptId = currentActionAppt.id;
  closeForemanActionModal();
  openAssignModal(apptId);
}

async function handleForemanActionClaimBoard() {
  if (!currentActionAppt) return;
  const apptId = currentActionAppt.id;
  closeForemanActionModal();
  await sendToClaimBoard(apptId);
}

window.closeForemanActionModal = closeForemanActionModal;

// ========== Assign Job (Direct to Jobs, skips claim board) ==========
async function assignJobToStaff(apptId, staffAuthId, staffName) {
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
    
    if (!job) {
      const jobId = `job_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      job = {
        id: jobId,
        appointment_id: appt.id,
        shop_id: shopId,
        customer: appt.customer || '',
        vehicle: appt.vehicle || '',
        service: appt.service || '',
        status: 'in_progress',
        assigned_to: staffAuthId,
        parts: [],
        labor: [],
        notes: [],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      jobs.push(job);
      await supabase.from('data').update({ jobs }).eq('shop_id', shopId);
      await supabase.from('jobs').insert({
        id: job.id,
        shop_id: shopId,
        appointment_id: appt.id,
        assigned_to: staffAuthId,
        status: 'in_progress',
        created_at: job.created_at,
        updated_at: job.updated_at
      });
    } else {
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
    if (!job) {
      job = {
        id: `job_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        appointment_id: appt.id,
        shop_id: shopId,
        customer: appt.customer || '',
        vehicle: appt.vehicle || '',
        service: appt.service || '',
        status: 'in_progress',
        assigned_to: staffAuthId,
        parts: [],
        labor: [],
        notes: [],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      local.jobs.push(job);
    } else {
      job.assigned_to = staffAuthId;
      job.status = 'in_progress';
      job.updated_at = new Date().toISOString();
    }
    localStorage.setItem('xm_data', JSON.stringify(local));
  }
  
  appt.status = 'in_progress';
  delete appt.to_claim_board;
  appt.updated_at = new Date().toISOString();
  appts[idx] = appt;
  await saveAppointments(appts);
  
  if (typeof window.closeViewApptModal === 'function') {
    window.closeViewApptModal();
  }
  
  showSuccessBanner(`Job assigned to ${staffName}`);
  await initForemanBoard();
}

// ========== Send to Claim Board ==========
async function sendToClaimBoard(apptId) {
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
    
    if (!job) {
      const jobId = `job_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      job = {
        id: jobId,
        appointment_id: appt.id,
        shop_id: shopId,
        customer: appt.customer || '',
        vehicle: appt.vehicle || '',
        service: appt.service || '',
        status: 'in_progress',
        assigned_to: null,
        parts: [],
        labor: [],
        notes: [],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      jobs.push(job);
      await supabase.from('data').update({ jobs }).eq('shop_id', shopId);
      await supabase.from('jobs').insert({
        id: job.id,
        shop_id: shopId,
        appointment_id: appt.id,
        assigned_to: null,
        status: 'in_progress',
        created_at: job.created_at,
        updated_at: job.updated_at
      });
    } else {
      job.assigned_to = null;
      job.status = 'in_progress';
      job.updated_at = new Date().toISOString();
      const jobIndex = jobs.findIndex(j => j.id === job.id);
      if (jobIndex >= 0) jobs[jobIndex] = job;
      await supabase.from('data').update({ jobs }).eq('shop_id', shopId);
      await supabase.from('jobs').update({
        assigned_to: null,
        status: 'in_progress',
        updated_at: job.updated_at
      }).eq('id', job.id);
    }
  } else {
    const local = JSON.parse(localStorage.getItem('xm_data') || '{}');
    local.jobs = local.jobs || [];
    let job = local.jobs.find(j => j.appointment_id === appt.id);
    if (!job) {
      job = {
        id: `job_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        appointment_id: appt.id,
        shop_id: shopId,
        customer: appt.customer || '',
        vehicle: appt.vehicle || '',
        service: appt.service || '',
        status: 'in_progress',
        assigned_to: null,
        parts: [],
        labor: [],
        notes: [],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      local.jobs.push(job);
    } else {
      job.assigned_to = null;
      job.status = 'in_progress';
      job.updated_at = new Date().toISOString();
    }
    localStorage.setItem('xm_data', JSON.stringify(local));
  }
  
  appt.status = 'in_progress';
  appt.to_claim_board = true;
  appt.updated_at = new Date().toISOString();
  appts[idx] = appt;
  await saveAppointments(appts);
  
  showSuccessBanner('Sent to Claim Board');
  await initForemanBoard();
}

// Function to reset view modal buttons
function resetViewModalButtons() {
  const editBtn = document.getElementById('editFromViewBtn');
  if (editBtn) {
    editBtn.style.display = 'inline-block';
    editBtn.textContent = 'Edit Appointment';
    editBtn.className = 'btn info';
    editBtn.onclick = null;
  }
}

// ========== Customize Row Buttons for Foreman ==========
function customizeForemanButtons(filtered, role) {
  console.log('🔧 Customizing foreman buttons for role:', role);
  
  const isMobile = window.matchMedia && window.matchMedia('(max-width: 768px)').matches;
  const rows = document.querySelectorAll('#apptTable tbody tr');
  
  rows.forEach(row => {
    const apptId = row.dataset.apptId;
    if (!apptId) return;
    
    const appt = filtered.find(a => String(a.id) === String(apptId));
    if (!appt) return;
    
    const actionsGrid = row.querySelector('td:last-child .appt-actions-grid');
    if (!actionsGrid) return;

    // Remove admin-only buttons (Invoice, Edit, Delete)
    const buttons = Array.from(actionsGrid.querySelectorAll('button'));
    buttons.forEach(btn => {
      const txt = (btn.textContent || '').trim();
      if (txt === 'Invoice' || txt === 'Edit') {
        btn.remove();
      }
      if (btn.getAttribute && btn.getAttribute('aria-label') === 'Delete appointment') {
        btn.remove();
      }
      // Also remove any Claim buttons (for staff role) - foreman doesn't claim
      if (txt === 'Claim' || txt === 'Unclaim') {
        btn.remove();
      }
    });
    
    // Add mobile clickable row
    if (isMobile) {
      row.classList.add('appt-row-clickable');
      row.addEventListener('click', (e) => {
        if (e.target.closest('button')) return;
        openForemanActionModal(appt);
      });
      return; // Mobile uses modal, skip adding desktop buttons
    }

    // Re-attach listener to View button to adjust modal
    const viewBtn = Array.from(actionsGrid.querySelectorAll('button')).find(b => (b.textContent || '').trim() === 'View');
    if (viewBtn && appt) {
      // Clone and replace to remove old listeners, but ensure we still open the view modal
      const newViewBtn = viewBtn.cloneNode(true);
      viewBtn.parentNode.replaceChild(newViewBtn, viewBtn);

      newViewBtn.addEventListener('click', () => {
        try {
          // Open the shared view modal first
          if (typeof openViewModal === 'function') openViewModal(appt);
        } catch (e) {
          console.warn('openViewModal call failed:', e);
        }

        // Then adjust the modal for foreman/staff after it opens
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
                  openAssignModal(appt.id);
                };
              } else if (role === 'staff') {
                editBtn.style.display = 'none';
              }
            }
          } catch (e) { console.error('Failed to adjust view modal:', e); }
        }, 150);
      });
    }

    // Add "Assign" button for foreman (if not already present)
    if (role === 'foreman' && !actionsGrid.querySelector('.assign-btn')) {
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

    // Add "Claim Board" button for foreman (if not already present)
    if (role === 'foreman' && !actionsGrid.querySelector('.send-claim-btn')) {
      const sendBtn = document.createElement('button');
      sendBtn.className = 'btn small secondary send-claim-btn';
      sendBtn.textContent = 'Claim Board';
      sendBtn.title = 'Send to Claim Board for staff to claim';
      sendBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await sendToClaimBoard(apptId);
      });
      actionsGrid.appendChild(sendBtn);
    }
  });
  
  console.log('✅ Foreman button customization complete');
}

async function initForemanBoard() {
  console.log('📋 Initializing Foreman Job Board...');
  
  // Fetch role from Supabase
  const role = await fetchCurrentUserRole();
  console.log('👤 Current role:', role);
  currentForemanRole = role;
  
  // Load staff for assign modal
  await loadShopStaff();
  
  // Create assign modal
  createAssignModal();
  
  // Create mobile action modal
  createMobileActionModal();
  
  // Override closeViewApptModal to reset buttons
  const originalClose = window.closeViewApptModal;
  window.closeViewApptModal = function() {
    resetViewModalButtons();
    if (originalClose) originalClose();
  };
  
  try {
    const appts = await loadAppointments();
    const filtered = (appts || []).filter(a => FOREMAN_STATUSES.includes(a.status));
    currentFilteredAppts = filtered;
    console.log(`🔎 Found ${filtered.length} job board appointments`);
    setDisplayedAppointments(filtered);
    await renderAppointments(filtered);

    // Wait for DOM to update, then customize buttons
    await new Promise(resolve => setTimeout(resolve, 50));
    customizeForemanButtons(filtered, role);

    try { initAppointmentNotes(); } catch (e) { console.warn('initAppointmentNotes failed:', e); }
    try { startNotesPolling(); } catch (e) { console.warn('startNotesPolling failed:', e); }
    try { startForemanDataPolling(); } catch (e) { console.warn('startForemanDataPolling failed:', e); }

    // Re-apply foreman button customizations after any appointments render (notes polling, saves, etc.)
    window.addEventListener('appointmentsRendered', () => {
      try {
        // Use the currently displayed filtered appointments to customize
        customizeForemanButtons(currentFilteredAppts, currentForemanRole);
        // Apply any pending highlights after appointments rerender
        try { applyForemanHighlightsToRows(); } catch (e) {}
      } catch (e) { /* ignore */ }
    });

    // Wire up search/filter with button re-customization
    const searchInput = document.getElementById('apptSearch');
    const filterBtn = document.getElementById('apptFilter');
    
    const handleFilter = async () => {
      const q = (document.getElementById('apptSearch')?.value || '').toLowerCase().trim();
      const status = (document.getElementById('apptStatus')?.value || '').trim();
      let set = currentFilteredAppts.slice();
      if (status) set = set.filter(a => (a.status || '').toLowerCase() === status.toLowerCase());
      if (q) set = set.filter(a => (a.customer || '').toLowerCase().includes(q) || (a.service || '').toLowerCase().includes(q));
      await renderAppointments(set);
      // Re-customize buttons after filter
      await new Promise(resolve => setTimeout(resolve, 50));
      customizeForemanButtons(set, role);
    };
    
    if (searchInput) searchInput.addEventListener('input', handleFilter);
    if (filterBtn) filterBtn.addEventListener('click', handleFilter);
  } catch (e) {
    console.error('Error initializing foreman board:', e);
  }
}

// ========== Setup Theme and Logout ==========
function setupPageControls() {
  const themeBtn = byId('themeToggle');
  const mobileThemeBtn = byId('mobileThemeToggle');
  if (themeBtn) themeBtn.onclick = toggleTheme;
  if (mobileThemeBtn) mobileThemeBtn.onclick = (e) => { e.preventDefault(); toggleTheme(); };
  
  const logoutBtn = byId('logoutBtn');
  const mobileLogoutBtn = byId('mobileLogoutBtn');
  if (logoutBtn) logoutBtn.onclick = logout;
  if (mobileLogoutBtn) mobileLogoutBtn.onclick = (e) => { e.preventDefault(); logout(); };
  
  const menuToggle = byId('menuToggle');
  const mainNav = byId('mainNav');
  if (menuToggle && mainNav) {
    menuToggle.onclick = () => mainNav.classList.toggle('open');
  }
  
  setThemeFromUser();
}

// ========== Add Admin Link for Multi-Shop Users ==========
async function addAdminLinkToNav() {
  try {
    const userId = await getCurrentUserId();
    if (!userId) return;
    
    const adminCheck = await shouldShowAdminPage(userId);
    if (!adminCheck.showAdmin) {
      console.log('ℹ️ Admin link hidden:', adminCheck.reason);
      return;
    }
    
    console.log('✅ Adding admin link to nav:', adminCheck.reason);
    
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
      adminLink.addEventListener('mouseenter', () => {
        adminLink.style.transform = 'translateY(-1px)';
        adminLink.style.boxShadow = '0 4px 12px rgba(225, 29, 72, 0.3)';
      });
      adminLink.addEventListener('mouseleave', () => {
        adminLink.style.transform = 'translateY(0)';
        adminLink.style.boxShadow = '0 2px 8px rgba(225, 29, 72, 0.2)';
      });
      mainNav.appendChild(adminLink);
      console.log('✅ Admin link added to navigation');
    }
  } catch (e) {
    console.warn('Could not add admin link:', e);
  }
}

// ========== Page Initialization ==========
async function initPage() {
  console.log('🔐 Foreman Job Board: Starting security checks...');
  
  setupPageControls();
  
  try {
    const hasAuth = await requireAuth();
    if (!hasAuth) {
      console.log('❌ Authentication failed, redirecting...');
      return;
    }
    console.log('✅ Authentication passed');
    
    await applyNavPermissions();
    console.log('✅ Nav permissions applied');
    
    const hasAccess = await enforcePageAccess();
    if (!hasAccess) {
      console.log('❌ Page access denied, redirecting...');
      return;
    }
    console.log('✅ Page access granted');
    
    try {
      await initializeShopConfig();
      console.log('✅ Shop config initialized');
    } catch (e) {
      console.warn('⚠️ Shop config init failed (non-fatal):', e);
    }
    
    // Initialize shop switcher and admin link (for multi-shop users)
    try {
      await initShopSwitcher();
      await addAdminLinkToNav();
      console.log('✅ Shop switcher initialized');
    } catch (e) {
      console.warn('⚠️ Shop switcher init failed (non-fatal):', e);
    }
    
    await initForemanBoard();
    console.log('✅ Foreman Job Board initialized');
    // Ensure polling stops on unload
    try { window.addEventListener('beforeunload', stopForemanDataPolling); } catch (e) {}
    
  } catch (err) {
    console.error('❌ Page initialization error:', err);
  }
}

// Run on load
initPage();

export { initForemanBoard };

// ========== Helper Functions ==========
function getCurrentShopId() {
  try {
    const session = JSON.parse(localStorage.getItem('xm_session') || '{}');
    return session.shopId || null;
  } catch (e) { return null; }
}
