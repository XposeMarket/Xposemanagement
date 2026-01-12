import { loadAppointments, renderAppointments, saveAppointments, initAppointmentNotes, startNotesPolling, setDisplayedAppointments } from './appointments.js';
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

async function initForemanBoard() {
  console.log('📋 Initializing Foreman Job Board...');
  
  // Fetch role from Supabase
  const role = await fetchCurrentUserRole();
  console.log('👤 Current role:', role);
  
  // Load staff for assign modal
  await loadShopStaff();
  
  // Create assign modal
  createAssignModal();
  
  // Override closeViewApptModal to reset buttons
  const originalClose = window.closeViewApptModal;
  window.closeViewApptModal = function() {
    resetViewModalButtons();
    if (originalClose) originalClose();
  };
  
  try {
    const appts = await loadAppointments();
    const filtered = (appts || []).filter(a => FOREMAN_STATUSES.includes(a.status));
    console.log(`🔎 Found ${filtered.length} job board appointments`);
    setDisplayedAppointments(filtered);
    await renderAppointments(filtered);

    // Customize buttons for each row
    try {
      const rows = document.querySelectorAll('#apptTable tbody tr');
      rows.forEach(row => {
        const apptId = row.dataset.apptId;
        if (!apptId) return;
        const actionsGrid = row.querySelector('td:last-child .appt-actions-grid');
        if (!actionsGrid) return;

        // Remove admin-only buttons
        const buttons = Array.from(actionsGrid.querySelectorAll('button'));
        buttons.forEach(btn => {
          const txt = (btn.textContent || '').trim();
          if (txt === 'Invoice' || txt === 'Edit') btn.remove();
          if (btn.getAttribute && btn.getAttribute('aria-label') === 'Delete appointment') btn.remove();
        });

        const appt = filtered.find(a => String(a.id) === String(apptId));

        // Attach listener to View button to adjust modal
        const viewBtn = Array.from(actionsGrid.querySelectorAll('button')).find(b => (b.textContent || '').trim() === 'View');
        if (viewBtn && appt) {
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

        // Add "Claim Board" button for foreman
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
    } catch (e) {
      console.warn('Could not adjust action buttons:', e);
    }

    try { initAppointmentNotes(); } catch (e) { console.warn('initAppointmentNotes failed:', e); }
    try { startNotesPolling(); } catch (e) { console.warn('startNotesPolling failed:', e); }

    const searchInput = document.getElementById('apptSearch');
    const filterBtn = document.getElementById('apptFilter');
    if (searchInput) searchInput.addEventListener('input', () => applyFilters(filtered));
    if (filterBtn) filterBtn.addEventListener('click', () => applyFilters(filtered));
  } catch (e) {
    console.error('Error initializing foreman board:', e);
  }
}

function applyFilters(base) {
  const q = (document.getElementById('apptSearch')?.value || '').toLowerCase().trim();
  const status = (document.getElementById('apptStatus')?.value || '').trim();
  let set = base.slice();
  if (status) set = set.filter(a => (a.status || '').toLowerCase() === status.toLowerCase());
  if (q) set = set.filter(a => (a.customer || '').toLowerCase().includes(q) || (a.service || '').toLowerCase().includes(q));
  renderAppointments(set);
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
