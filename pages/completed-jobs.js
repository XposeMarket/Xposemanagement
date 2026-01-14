import { getSupabaseClient } from '../helpers/supabase.js';
import { requireAuth, applyNavPermissions, enforcePageAccess } from '../helpers/auth.js';
import { getCurrentUser, toggleTheme, setThemeFromUser, logout } from '../helpers/user.js';

let supabase = null;
let shopId = null;
let allJobs = [];
let allAppointments = [];

document.addEventListener('DOMContentLoaded', init);

async function init() {
  supabase = getSupabaseClient();
  try {
    const session = JSON.parse(localStorage.getItem('xm_session') || '{}');
    shopId = session.shopId || null;
  } catch (e) { shopId = null; }

  // Enforce authentication and nav permissions like other pages
  try {
    const ok = await requireAuth();
    if (!ok) return;
    await applyNavPermissions();
    const hasAccess = await enforcePageAccess();
    if (!hasAccess) return;
  } catch (e) {
    console.warn('completed-jobs: auth/permission check failed', e);
  }

  // Wire theme and logout controls (use local handlers to match app.js behavior)
  try {
    const themeBtn = document.getElementById('themeToggle');
    const mobileThemeBtn = document.getElementById('mobileThemeToggle');
    const logoutBtn = document.getElementById('logoutBtn');
    const mobileLogoutBtn = document.getElementById('mobileLogoutBtn');

    if (themeBtn) themeBtn.onclick = (e) => { e.preventDefault(); try { toggleTheme(); } catch (err) {} };
    if (mobileThemeBtn) mobileThemeBtn.onclick = (e) => { e.preventDefault(); try { toggleTheme(); } catch (err) {} };

    if (logoutBtn) logoutBtn.onclick = () => showLogoutConfirmModal();
    if (mobileLogoutBtn) mobileLogoutBtn.onclick = (e) => {
      e.preventDefault();
      const menuToggle = document.getElementById('menuToggle');
      const mainNav = document.getElementById('mainNav');
      if (mainNav && menuToggle && mainNav.classList.contains('active')) {
        mainNav.classList.remove('active');
        menuToggle.classList.remove('active');
      }
      showLogoutConfirmModal();
    };
    try { setThemeFromUser(); } catch (e) {}
  } catch (e) { /* ignore */ }

  await loadData();
}

async function loadData() {
  try {
    if (supabase && shopId) {
      const { data } = await supabase.from('data').select('jobs,appointments').eq('shop_id', shopId).single();
      allJobs = data?.jobs || [];
      allAppointments = data?.appointments || [];
    } else {
      const local = JSON.parse(localStorage.getItem('xm_data') || '{}');
      allJobs = local.jobs || [];
      allAppointments = local.appointments || [];
    }
    // Filter to current user's completed jobs only
    await renderCompletedJobs();
  } catch (e) {
    console.error('Failed to load completed jobs', e);
  }
}

async function renderCompletedJobs() {
  const tbody = document.querySelector('#completedJobsTable tbody');
  const empty = document.getElementById('completedEmpty');
  if (!tbody) return;
  tbody.innerHTML = '';
  // Determine current auth id and shop_staff id for the logged-in user
  let authId = null;
  let shopStaffId = null;
  try {
    const { data: { user: au } } = await supabase.auth.getUser();
    authId = au?.id || null;
  } catch (e) { /* ignore */ }
  try {
    // Try to resolve shop_staff id for this auth user and shop
    if (supabase && shopId && authId) {
      const { data: ss } = await supabase.from('shop_staff').select('id').eq('auth_id', authId).eq('shop_id', shopId).limit(1).single();
      shopStaffId = ss?.id || null;
    }
  } catch (e) { /* ignore */ }

  const completed = (allJobs || []).filter(j => {
    if (!j || j.status !== 'completed') return false;
    let cb = j.completed_by;
    if (!cb) return false;

    // If completed_by is a JSON string (e.g. "{...}"), try to parse it
    if (typeof cb === 'string') {
      const trimmed = cb.trim();
      if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        try {
          cb = JSON.parse(cb);
        } catch (e) {
          // not JSON, leave as string
        }
      }
    }

    // If still a primitive string, compare directly to auth/shop ids
    if (typeof cb === 'string') {
      return cb === authId || cb === shopStaffId;
    }

    // If it's an object, check common properties
    if (typeof cb === 'object' && cb !== null) {
      if (cb.auth_id && authId && String(cb.auth_id) === String(authId)) return true;
      if (cb.id && shopStaffId && String(cb.id) === String(shopStaffId)) return true;
      if (cb === authId || cb === shopStaffId) return true;
      // Some objects may nest an 'id' field inside a string value
      try {
        if (typeof cb === 'object' && cb.id && (String(cb.id) === String(authId) || String(cb.id) === String(shopStaffId))) return true;
      } catch (e) {}
      return false;
    }
    return false;
  });
  if (!completed.length) { if (empty) empty.textContent = 'No completed jobs found.'; return; }
  if (empty) empty.textContent = '';

  completed.forEach(job => {
    const tr = document.createElement('tr');
    const appt = allAppointments.find(a => a.id === job.appointment_id) || {};
    const jobNum = job.id ? job.id.slice(-6).toUpperCase() : '';
    tr.innerHTML = `
      <td>${jobNum}</td>
      <td>${appt.customer || job.customer || ''}</td>
      <td>${appt.vehicle || job.vehicle || ''}</td>
      <td>${appt.service || job.service || ''}</td>
      <td>${job.completed_by ? (job.completed_by.name || job.completed_by.auth_id || job.completed_by.id) : ''}</td>
      <td>${job.completed_at ? new Date(job.completed_at).toLocaleString() : ''}</td>
      <td><button class="btn small" data-job-id="${job.id}">View</button></td>
    `;
    tbody.appendChild(tr);
  });

  // Attach view handlers
  tbody.querySelectorAll('button').forEach(b => {
    b.addEventListener('click', async () => {
      const id = b.getAttribute('data-job-id');
      const job = allJobs.find(j => j.id === id);
      const appt = allAppointments.find(a => a.id === job.appointment_id) || {};
      openJobViewModal(job, appt);
    });
  });
}

/**
 * Show styled logout confirmation modal (copied from app.js for identical UX)
 */
function showLogoutConfirmModal() {
  const existing = document.getElementById('logout-confirm-modal');
  if (existing) existing.remove();
  const modal = document.createElement('div');
  modal.id = 'logout-confirm-modal';
  modal.style.cssText = `
    position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); z-index: 9999; display:flex; align-items:center; justify-content:center;`;
  modal.innerHTML = `
    <div style="background: var(--card, #fff); border-radius: 12px; padding: 24px; max-width: 380px; width: 90%; box-shadow: 0 20px 60px rgba(0,0,0,0.3);">
      <div style="text-align:center;margin-bottom:20px">
        <div style="width:56px;height:56px;margin:0 auto 16px;background:linear-gradient(135deg,#ef4444 0%,#dc2626 100%);border-radius:50%;display:flex;align-items:center;justify-content:center;">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>
        </div>
        <h3 style="margin:0 0 8px;font-size:1.25rem;color:var(--text);">Sign Out?</h3>
        <p style="margin:0;color:var(--muted);font-size:0.95rem;">Are you sure you want to sign out of your account?</p>
      </div>
      <div style="display:flex;gap:12px;">
        <button id="logout-cancel-btn" style="flex:1;padding:12px 16px;border:1px solid var(--line);background:var(--bg);color:var(--text);border-radius:8px;font-size:0.95rem;font-weight:500;cursor:pointer;">Cancel</button>
        <button id="logout-confirm-btn" style="flex:1;padding:12px 16px;border:none;background:linear-gradient(135deg,#ef4444 0%,#dc2626 100%);color:white;border-radius:8px;font-size:0.95rem;font-weight:600;cursor:pointer;">Sign Out</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  document.getElementById('logout-cancel-btn').onclick = () => modal.remove();
  document.getElementById('logout-confirm-btn').onclick = async () => { const btn = document.getElementById('logout-confirm-btn'); btn.textContent = 'Signing out...'; btn.disabled = true; await logout(); };
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
  const escHandler = (e) => { if (e.key === 'Escape') { modal.remove(); document.removeEventListener('keydown', escHandler); } };
  document.addEventListener('keydown', escHandler);
}

function openJobViewModal(job, appt) {
  const modal = document.getElementById('jobViewModal');
  const content = document.getElementById('jobViewContent');
  if (!modal || !content) return;
  content.innerHTML = `
    <p><strong>Customer:</strong> ${appt.customer || job.customer || ''}</p>
    <p><strong>Vehicle:</strong> ${appt.vehicle || job.vehicle || ''}</p>
    <p><strong>Service:</strong> ${appt.service || job.service || ''}</p>
    <p><strong>Status:</strong> <span class="tag completed">Completed</span></p>
    <p><strong>Completed By:</strong> ${job.completed_by ? (job.completed_by.name || job.completed_by.auth_id || job.completed_by.id) : ''}</p>
    <p><strong>Completed At:</strong> ${job.completed_at ? new Date(job.completed_at).toLocaleString() : ''}</p>
  `;
  modal.classList.remove('hidden');
}

window.closeJobViewModal = function() { const m = document.getElementById('jobViewModal'); if (m) m.classList.add('hidden'); };
export {};