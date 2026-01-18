/**
 * components/diagnostics/DiagnosticsModal.js
 * Unified Repair Intelligence Tool
 */

import { 
  unifiedSearch, getPlaybookById, getOperationById, logSearchRequest, recordFixOutcome,
  getFixStatistics, submitFeedback, getCommonDtcInfo, COMMON_MAKES, getYearOptions, getModelsForMake
} from '../../helpers/diagnostics-api.js';
import { getSupabaseClient } from '../../helpers/supabase.js';

// State
let currentJob = null, currentAppt = null, currentVehicle = null, currentResult = null;
let onCloseCallback = null, availableJobs = [], availableAppointments = [];
let shopSettings = null, shopData = null;
let selectedVehicle = { year: '', make: '', model: '' };

let currentIsStaff = false;
export function openDiagnosticsModal({ jobs = [], appointments = [], onClose, isStaff = false }) {
  availableJobs = jobs.filter(j => j.status !== 'completed');
  availableAppointments = appointments;
  onCloseCallback = onClose || null;
  currentJob = currentAppt = currentVehicle = currentResult = null;
  selectedVehicle = { year: '', make: '', model: '' };
  loadShopData();
  currentIsStaff = !!isStaff;
  createModal();
  availableJobs.length > 0 ? showJobSelectionView() : showSearchView();
  document.getElementById('diagnosticsModal')?.classList.remove('hidden');
}

export function closeDiagnosticsModal() {
  document.getElementById('diagnosticsModal')?.classList.add('hidden');
  if (onCloseCallback) onCloseCallback(currentResult);
  currentJob = currentAppt = currentVehicle = currentResult = null;
  availableJobs = []; availableAppointments = [];
}
window.closeDiagnosticsModal = closeDiagnosticsModal;

async function loadShopData() {
  try {
    const supabase = getSupabaseClient();
    const session = JSON.parse(localStorage.getItem('xm_session') || '{}');
    if (!supabase || !session.shopId) return;
    const { data } = await supabase.from('data').select('*').eq('shop_id', session.shopId).single();
    if (data) { shopData = data; shopSettings = data.settings || {}; }
  } catch (e) { console.warn('[DiagnosticsModal] loadShopData:', e); }
}

function getDefaultLaborRate() {
  if (!shopSettings?.labor_rates?.length) return { name: 'Standard', rate: 125 };
  return shopSettings.labor_rates.find(r => r.is_default) || shopSettings.labor_rates[0];
}

function createModal() {
  document.getElementById('diagnosticsModal')?.remove();
  const modal = document.createElement('div');
  modal.id = 'diagnosticsModal';
  modal.className = 'modal-overlay hidden';
  modal.style.cssText = 'z-index: 10100;';
  modal.onclick = (e) => { if (e.target === modal) closeDiagnosticsModal(); };
  modal.innerHTML = `
    <div class="modal-content" onclick="event.stopPropagation()" style="max-width: 900px; width: 95%; max-height: 90vh; overflow: hidden; display: flex; flex-direction: column;">
      <div class="modal-head" style="padding: 16px 20px; border-bottom: 1px solid var(--line); display: flex; justify-content: space-between; align-items: center;">
        <div style="display: flex; align-items: center; gap: 12px;">
          <span style="font-size: 24px;">🔧</span>
          <div>
            <h3 style="margin: 0; font-size: 1.2rem;">Repair Assistant</h3>
            <p id="diagVehicleInfo" style="margin: 2px 0 0 0; font-size: 0.85rem; color: var(--muted);">Search diagnostics, services, or repairs</p>
          </div>
        </div>
        <button onclick="window.closeDiagnosticsModal()" class="btn-close" style="font-size: 24px; width: 36px; height: 36px;">&times;</button>
      </div>
      <div id="diagModalBody" class="modal-body" style="flex: 1; overflow-y: auto; padding: 20px;"></div>
    </div>`;
  document.body.appendChild(modal);
}

function updateVehicleDisplay() {
  const el = document.getElementById('diagVehicleInfo');
  if (!el) return;
  const v = currentVehicle || selectedVehicle;
  el.textContent = (v?.year || v?.make || v?.model) ? [v.year, v.make, v.model].filter(Boolean).join(' ') : 'Search diagnostics, services, or repairs';
}

function parseVehicleFromAppt(appt) {
  if (!appt) return null;
  const v = { year: appt.vehicle_year || '', make: appt.vehicle_make || '', model: appt.vehicle_model || '', mileage: appt.mileage || null };
  if (appt.vehicle && !v.year) {
    const p = (appt.vehicle || '').split(' ');
    if (p.length >= 3 && /^\d{4}$/.test(p[0])) { v.year = p[0]; v.make = p[1]; v.model = p.slice(2).join(' '); }
  }
  return v;
}

// Job Selection
function showJobSelectionView() {
  const body = document.getElementById('diagModalBody');
  if (!body) return;
  body.innerHTML = `
    <div style="max-width: 700px; margin: 0 auto;">
      <h3 style="margin: 0 0 8px 0;">Select a Job</h3>
      <p style="color: var(--muted); margin-bottom: 20px;">Choose a job for vehicle-specific results, or skip for general search.</p>
      <div style="display: flex; flex-direction: column; gap: 12px; margin-bottom: 24px;">
        ${availableJobs.map(j => {
          const a = availableAppointments.find(x => x.id === j.appointment_id) || {};
          return `<button class="btn" onclick="window.diagSelectJob('${j.id}')" style="text-align: left; padding: 16px; background: var(--card-bg); border: 2px solid var(--line); border-radius: 8px;">
            <strong>${a.vehicle || 'No vehicle'}</strong><br><span style="font-size: 0.9rem; color: var(--muted);">${a.customer || 'Unknown'}</span>
          </button>`;
        }).join('')}
      </div>
      <div style="text-align: center; border-top: 1px solid var(--line); padding-top: 16px;">
        <button onclick="window.diagSkipJobSelection()" class="btn" style="padding: 12px 32px;">Skip - General Search</button>
      </div>
    </div>`;
}

window.diagSelectJob = function(jobId) {
  const j = availableJobs.find(x => x.id === jobId);
  if (!j) return;
  currentJob = j;
  currentAppt = availableAppointments.find(x => x.id === j.appointment_id) || null;
  currentVehicle = parseVehicleFromAppt(currentAppt);
  showSearchView();
};
window.diagSkipJobSelection = function() { currentJob = currentAppt = currentVehicle = null; showSearchView(); };
window.diagChangeJob = function() { currentJob = currentAppt = currentVehicle = null; selectedVehicle = { year: '', make: '', model: '' }; showJobSelectionView(); };

// Main Search View
function showSearchView() {
  const body = document.getElementById('diagModalBody');
  if (!body) return;
  updateVehicleDisplay();

  const backBtn = currentJob ? `<button onclick="window.diagChangeJob()" class="btn small" style="margin-bottom: 16px;">← Change Job</button>` :
    (availableJobs.length ? `<button onclick="window.diagChangeJob()" class="btn small" style="margin-bottom: 16px;">← Select a Job</button>` : '');

  const ymmHtml = !currentJob ? `
    <div style="background: var(--bg); padding: 16px; border-radius: 8px; margin-bottom: 20px;">
      <label style="font-weight: 600; display: block; margin-bottom: 12px;">🚗 Vehicle (optional)</label>
      <div style="display: flex; gap: 8px; flex-wrap: wrap;">
        <select id="diagYearSelect" onchange="window.diagUpdateVehicle()" style="padding: 10px; border: 1px solid var(--line); border-radius: 6px;">
          <option value="">Year</option>${getYearOptions().map(y => `<option value="${y}">${y}</option>`).join('')}
        </select>
        <select id="diagMakeSelect" onchange="window.diagUpdateVehicle()" style="padding: 10px; border: 1px solid var(--line); border-radius: 6px;">
          <option value="">Make</option>${COMMON_MAKES.map(m => `<option value="${m}">${m}</option>`).join('')}
        </select>
        <select id="diagModelSelect" onchange="window.diagUpdateVehicle()" style="padding: 10px; border: 1px solid var(--line); border-radius: 6px; flex: 1;">
          <option value="">Model</option>
        </select>
      </div>
    </div>` : '';

  body.innerHTML = `
    <div style="max-width: 700px; margin: 0 auto;">
      ${backBtn}${ymmHtml}
      <div style="margin-bottom: 24px;">
        <label style="font-weight: 600; display: block; margin-bottom: 8px;">🔍 Search anything...</label>
        <div style="display: flex; gap: 8px;">
          <input type="text" id="diagSearchInput" placeholder="DTC code, symptom, or service (e.g., P0300, rough idle, spark plugs)" 
            style="flex: 1; padding: 14px; border: 2px solid var(--line); border-radius: 8px; font-size: 16px;" onkeypress="if(event.key==='Enter') window.diagDoSearch()">
          <button onclick="window.diagDoSearch()" class="btn info" style="padding: 14px 28px; font-size: 16px;">Search</button>
        </div>
      </div>
      <div id="diagQuickInfo" style="display: none; margin-bottom: 20px;"></div>
      <div style="margin-bottom: 24px;">
        <label style="font-weight: 600; display: block; margin-bottom: 12px;">⚡ Quick Search</label>
        <div style="display: flex; flex-wrap: wrap; gap: 8px;">
          ${['Oil Change', 'Brake Pads', 'Spark Plugs', 'Battery', 'Alternator', 'Struts', 'AC Recharge'].map(s => 
            `<button class="btn small" onclick="window.diagQuickSearch('${s}')" style="border-radius: 20px; padding: 8px 16px;">${s}</button>`).join('')}
        </div>
      </div>
      <div>
        <label style="font-weight: 600; display: block; margin-bottom: 12px;">🩺 Common Symptoms</label>
        <div style="display: flex; flex-wrap: wrap; gap: 8px;">
          ${['No start', 'Rough idle', 'Overheating', 'Brake noise', 'AC not cold', 'Check engine', 'Battery drain'].map(s => 
            `<button class="btn small" onclick="window.diagQuickSearch('${s}')" style="border-radius: 20px; padding: 8px 16px; background: var(--bg);">${s}</button>`).join('')}
        </div>
      </div>
    </div>`;

  const input = document.getElementById('diagSearchInput');
  if (input) { input.addEventListener('input', debounce(showQuickInfo, 300)); setTimeout(() => input.focus(), 100); }
}

window.diagShowSearch = showSearchView;
window.diagUpdateVehicle = function() {
  selectedVehicle.year = document.getElementById('diagYearSelect')?.value || '';
  selectedVehicle.make = document.getElementById('diagMakeSelect')?.value || '';
  selectedVehicle.model = document.getElementById('diagModelSelect')?.value || '';
  const modelSel = document.getElementById('diagModelSelect');
  if (modelSel && selectedVehicle.make) {
    modelSel.innerHTML = `<option value="">Model</option>` + getModelsForMake(selectedVehicle.make).map(m => `<option value="${m}">${m}</option>`).join('');
  }
  updateVehicleDisplay();
};
window.diagQuickSearch = function(q) { document.getElementById('diagSearchInput').value = q; window.diagDoSearch(); };

function showQuickInfo() {
  const input = document.getElementById('diagSearchInput'), container = document.getElementById('diagQuickInfo');
  if (!input || !container) return;
  const v = input.value.trim().toUpperCase();
  if (/^[PBCU]\d{4}$/.test(v)) {
    const info = getCommonDtcInfo(v);
    if (info) {
      const c = { low: '#dcfce7', medium: '#fef3c7', high: '#fee2e2' }, t = { low: '#166534', medium: '#92400e', high: '#991b1b' };
      container.innerHTML = `<div style="padding: 12px 16px; background: var(--card-bg); border: 1px solid var(--line); border-radius: 8px;">
        <div style="display: flex; justify-content: space-between;"><strong style="font-family: monospace;">${v}</strong>
        <span style="font-size: 0.75rem; padding: 2px 8px; border-radius: 12px; background: ${c[info.severity]}; color: ${t[info.severity]};">${info.severity.toUpperCase()}</span></div>
        <p style="margin: 4px 0 0 0; font-size: 0.9rem;">${info.description}</p></div>`;
      container.style.display = 'block'; return;
    }
  }
  container.style.display = 'none';
}

// Search Execution
window.diagDoSearch = async function() {
  const query = document.getElementById('diagSearchInput')?.value?.trim() || '';
  if (!query) { alert('Please enter a search term'); return; }

  const body = document.getElementById('diagModalBody');
  body.innerHTML = `<div style="text-align: center; padding: 60px 20px;"><div style="width: 40px; height: 40px; border: 3px solid var(--line); border-top-color: #3b82f6; border-radius: 50%; animation: spin 1s linear infinite; margin: 0 auto;"></div><p style="margin-top: 16px; color: var(--muted);">Searching...</p></div><style>@keyframes spin { to { transform: rotate(360deg); } }</style>`;

  const dtcCodes = query.split(/[\s,]+/).filter(p => /^[PBCU]\d{4}$/i.test(p)).map(c => c.toUpperCase());
  const vehicle = currentVehicle || selectedVehicle;
  const vehicleTags = { make: vehicle?.make || '', model: vehicle?.model || '', year: vehicle?.year || '' };

  try {
    const results = await unifiedSearch({ query, dtcCodes, symptoms: dtcCodes.length ? [] : [query], vehicleTags });
    await logSearchRequest({ searchQuery: query, searchType: dtcCodes.length > 0 ? 'dtc' : 'general', inputData: { query, dtcCodes, vehicleTags },
      resultType: results.combined.length > 0 ? 'found' : 'none', matchedPlaybookId: results.playbooks[0]?.id, matchedOperationId: results.operations[0]?.id,
      jobId: currentJob?.id, vehicleYear: vehicle?.year ? parseInt(vehicle.year) : null, vehicleMake: vehicle?.make, vehicleModel: vehicle?.model });
    results.combined.length > 0 ? showResultsView(results, query) : showNoResultsView(query);
  } catch (e) { console.error('Search failed:', e); showErrorView('Search failed. Please try again.'); }
};

function showResultsView(results, query) {
  const body = document.getElementById('diagModalBody');
  if (!body) return;
  const { playbooks, operations, combined } = results;
  const rate = getDefaultLaborRate();

  // Build results HTML, hiding service entries for staff users
  const resultsToShow = combined.slice(0, 10).filter(item => !(currentIsStaff && item.resultType !== 'playbook'));
  const resultsHtml = resultsToShow.map(item => {
            const isPB = item.resultType === 'playbook';
            const icon = isPB ? '🩺' : '🔧', typeLabel = isPB ? 'Diagnostic' : 'Service', color = isPB ? '#8b5cf6' : '#10b981';
            if (isPB) {
              const pb = item.playbook || {};
              return `<div style="border: 1px solid var(--line); border-radius: 12px; margin-bottom: 12px; padding: 16px; cursor: pointer;" onclick="window.diagViewPlaybook('${item.id}')">
              <span style="font-size: 0.75rem; padding: 2px 8px; border-radius: 12px; background: ${color}20; color: ${color};">${icon} ${typeLabel}</span>
              <h4 style="margin: 8px 0 4px 0;">${item.title}</h4>
              <p style="margin: 0; font-size: 0.9rem; color: var(--muted);">${(pb.summary || '').slice(0, 120)}...</p>
              ${(item.dtc_codes || []).length ? `<div style="margin-top: 8px;">${item.dtc_codes.slice(0, 4).map(c => `<span style="font-family: monospace; background: var(--bg); padding: 2px 6px; border-radius: 4px; margin-right: 4px; font-size: 0.8rem;">${c}</span>`).join('')}</div>` : ''}
            </div>`;
            } else {
              const hrs = item.labor_hours_typical || 1;
              return `<div style="border: 1px solid var(--line); border-radius: 12px; margin-bottom: 12px; padding: 16px; cursor: pointer;" onclick="window.diagViewOperation('${item.id}')">
              <div style="display: flex; justify-content: space-between;"><div>
                <span style="font-size: 0.75rem; padding: 2px 8px; border-radius: 12px; background: ${color}20; color: ${color};">${icon} ${typeLabel}</span>
                <h4 style="margin: 8px 0 4px 0;">${item.name}</h4>
                <p style="margin: 0; font-size: 0.9rem; color: var(--muted);">${(item.summary || '').slice(0, 100)}...</p>
              </div><div style="text-align: right;">
                <div style="font-weight: 600; color: #10b981;">${item.labor_hours_low || hrs}–${item.labor_hours_high || hrs} hrs</div>
                <div style="font-size: 0.85rem; color: var(--muted);">~$${(hrs * rate.rate).toFixed(0)} labor</div>
              </div></div>
            </div>`;
            }
          }).join('');

  body.innerHTML = `
    <div style="max-width: 800px; margin: 0 auto;">
      <button onclick="window.diagShowSearch()" class="btn small" style="margin-bottom: 16px;">← New Search</button>
      <div style="background: var(--bg); padding: 12px 16px; border-radius: 8px; margin-bottom: 20px;">
        <p style="margin: 0; font-size: 0.9rem; color: var(--muted);"><strong>Searched:</strong> "${query}" | Found: ${playbooks.length} diagnostics, ${operations.length} services</p>
      </div>
      <div id="diagResultsContainer">
        ${resultsHtml}
      </div>
    </div>`;
  window._diagResults = results;
}

function showNoResultsView(query) {
  const body = document.getElementById('diagModalBody');
  body.innerHTML = `<div style="max-width: 600px; margin: 0 auto; text-align: center; padding: 40px 20px;">
    <div style="font-size: 64px; margin-bottom: 20px;">🔍</div>
    <h3 style="margin: 0 0 12px 0;">No Results Found</h3>
    <p style="color: var(--muted); margin-bottom: 24px;">No matches for "${query}"</p>
    <button onclick="window.diagShowSearch()" class="btn info">← Try Different Search</button>
  </div>`;
}

function showErrorView(msg) {
  const body = document.getElementById('diagModalBody');
  body.innerHTML = `<div style="text-align: center; padding: 60px 20px;"><div style="font-size: 48px; margin-bottom: 16px;">⚠️</div>
    <p style="color: #ef4444; margin-bottom: 24px;">${msg}</p><button onclick="window.diagShowSearch()" class="btn">← Back</button></div>`;
}

// View Playbook Detail
window.diagViewPlaybook = async function(id) {
  const body = document.getElementById('diagModalBody');
  body.innerHTML = `<div style="text-align: center; padding: 60px;"><p>Loading...</p></div>`;
  const playbook = await getPlaybookById(id);
  if (!playbook) { showErrorView('Could not load playbook'); return; }
  currentResult = playbook;
  const pb = playbook.playbook || {}, rate = getDefaultLaborRate();
  const canAdd = !!currentJob && !currentIsStaff;
  const noJobMsg = currentIsStaff ? '' : '<span style="font-size: 0.8rem; color: var(--muted); font-style: italic;">Select job to add</span>';

  body.innerHTML = `
    <div style="max-width: 800px; margin: 0 auto;">
      <button onclick="window.diagShowSearch()" class="btn small" style="margin-bottom: 16px;">← Back to Results</button>
      <div style="border: 2px solid #8b5cf6; border-radius: 12px; overflow: hidden;">
        <div style="background: linear-gradient(135deg, #8b5cf6 0%, #6d28d9 100%); color: white; padding: 16px 20px;">
          <span style="font-size: 0.75rem; opacity: 0.8;">🩺 DIAGNOSTIC GUIDE</span>
          <h3 style="margin: 4px 0 0 0;">${playbook.title}</h3>
        </div>
        <div style="padding: 20px;">
          ${pb.summary ? `<p style="margin: 0 0 20px 0; line-height: 1.6;">${pb.summary}</p>` : ''}
          ${pb.likely_causes?.length ? `<h4 style="margin: 0 0 12px 0;">🎯 Likely Causes</h4><ol style="margin: 0 0 20px 0; padding-left: 20px;">${pb.likely_causes.map((c, i) => `<li style="margin-bottom: 8px; ${i === 0 ? 'color: #10b981; font-weight: 600;' : ''}"><strong>${c.name || c}</strong>${c.description ? `<br><span style="font-size: 0.9rem; color: var(--muted);">${c.description}</span>` : ''}</li>`).join('')}</ol>` : ''}
          ${pb.diagnostic_steps?.length ? `<h4 style="margin: 0 0 12px 0;">🔍 Diagnostic Steps</h4><div style="border: 1px solid var(--line); border-radius: 8px; margin-bottom: 20px;">${pb.diagnostic_steps.map((s, i) => `<div style="padding: 12px 16px; ${i < pb.diagnostic_steps.length - 1 ? 'border-bottom: 1px solid var(--line);' : ''} display: flex; gap: 12px;"><span style="background: #3b82f6; color: white; width: 24px; height: 24px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 0.85rem; flex-shrink: 0;">${i + 1}</span><div><strong>${s.title || s}</strong>${s.description ? `<p style="margin: 4px 0 0 0; font-size: 0.9rem; color: var(--muted);">${s.description}</p>` : ''}</div></div>`).join('')}</div>` : ''}
          ${pb.safety_warnings?.length ? `<div style="background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 14px 16px; margin-bottom: 20px;"><h4 style="margin: 0 0 8px 0; color: #991b1b;">⚠️ Safety Warnings</h4><ul style="margin: 0; padding-left: 20px; color: #991b1b;">${pb.safety_warnings.map(w => `<li>${w}</li>`).join('')}</ul></div>` : ''}
          ${!currentIsStaff && pb.suggested_services?.length ? `<h4 style="margin: 0 0 12px 0;">🛠️ Suggested Services</h4><div style="display: flex; flex-direction: column; gap: 8px; margin-bottom: 20px;">${pb.suggested_services.map(svc => {
            const name = svc.name || svc, hrs = svc.labor_hours || 1, est = hrs * rate.rate;
            return `<div style="padding: 12px 16px; background: var(--bg); border: 1px solid var(--line); border-radius: 8px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;">
              <div><strong>${name}</strong><div style="font-size: 0.85rem; color: var(--muted);">${hrs} hr × $${rate.rate}/hr = <strong>$${est.toFixed(2)}</strong></div></div>
              ${canAdd ? `<button class="btn small info" onclick="event.stopPropagation(); window.diagAddToInvoice('${name.replace(/'/g, "\\'")}', ${hrs}, 'playbook', '${id}')">+ Add $${est.toFixed(0)}</button>` : noJobMsg}
            </div>`;
          }).join('')}</div>` : ''}
        </div>
        <div style="padding: 16px 20px; border-top: 1px solid var(--line); display: flex; gap: 12px; flex-wrap: wrap;">
          <button onclick="window.diagRecordOutcome('playbook', '${id}')" class="btn info" style="flex: 1;">✅ Record What Fixed It</button>
          <button onclick="window.diagShowFeedback('playbook', '${id}')" class="btn" style="flex: 1;">📝 Give Feedback</button>
        </div>
      </div>
    </div>`;
};

// View Operation Detail - WITH VARIATIONS AND ADD-ONS ADDABLE!
window.diagViewOperation = async function(id) {
  const body = document.getElementById('diagModalBody');
  body.innerHTML = `<div style="text-align: center; padding: 60px;"><p>Loading...</p></div>`;
  const op = await getOperationById(id);
  if (!op) { showErrorView('Could not load operation'); return; }
  currentResult = op;
  const rate = getDefaultLaborRate();
  const hrs = op.labor_hours_typical || 1;
  const canAdd = !!currentJob && !currentIsStaff;
  const noJobMsg = currentIsStaff ? '' : '<span style="font-size: 0.8rem; color: var(--muted); font-style: italic;">Select job to add</span>';

  // Helper to escape names for onclick
  const esc = (s) => (s || '').replace(/'/g, "\\'").replace(/"/g, '\\"');

  body.innerHTML = `
    <div style="max-width: 800px; margin: 0 auto;">
      <button onclick="window.diagShowSearch()" class="btn small" style="margin-bottom: 16px;">← Back to Results</button>
      <div style="border: 2px solid #10b981; border-radius: 12px; overflow: hidden;">
        <div style="background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: white; padding: 16px 20px;">
          <span style="font-size: 0.75rem; opacity: 0.8;">🔧 SERVICE / LABOR GUIDE</span>
          <h3 style="margin: 4px 0 0 0;">${op.name}</h3>
        </div>
        <div style="padding: 20px;">
          ${op.summary ? `<p style="margin: 0 0 20px 0; line-height: 1.6;">${op.summary}</p>` : ''}
          
          <!-- Labor Time Box -->
          <div style="background: #f0fdf4; border: 1px solid #86efac; border-radius: 8px; padding: 16px; margin-bottom: 20px;">
            <h4 style="margin: 0 0 12px 0; color: #166534;">⏱️ Labor Time</h4>
            <div style="display: flex; justify-content: space-between; flex-wrap: wrap; gap: 12px; margin-bottom: 12px;">
              <div><span style="color: var(--muted);">Range:</span> <strong>${op.labor_hours_low || hrs} – ${op.labor_hours_high || hrs} hrs</strong></div>
              <div><span style="color: var(--muted);">Typical:</span> <strong>${hrs} hrs</strong></div>
              <div><span style="color: var(--muted);">Est. Labor:</span> <strong>$${(hrs * rate.rate).toFixed(2)}</strong> <span style="font-size: 0.85rem; color: var(--muted);">(${rate.name} @ $${rate.rate}/hr)</span></div>
            </div>
            <!-- Add typical to invoice button -->
            <div style="text-align: center; padding-top: 12px; border-top: 1px solid #86efac;">
              ${canAdd ? `<button class="btn info" onclick="window.diagAddToInvoice('${esc(op.name)}', ${hrs}, 'operation', '${id}')">+ Add to Invoice ($${(hrs * rate.rate).toFixed(2)})</button>` : noJobMsg}
            </div>
          </div>
          
          <!-- Common Variations - EACH WITH ADD BUTTON -->
          ${!currentIsStaff && op.common_variations?.length ? `
            <h4 style="margin: 0 0 12px 0;">📋 Common Variations</h4>
            <div style="display: flex; flex-direction: column; gap: 8px; margin-bottom: 20px;">
              ${op.common_variations.map(v => {
                const vHrs = v.hours || v.add_hours || hrs;
                const vEst = vHrs * rate.rate;
                const vName = `${op.name} - ${v.name}`;
                return `<div style="padding: 12px 16px; background: var(--bg); border: 1px solid var(--line); border-radius: 8px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;">
                  <div>
                    <strong>${v.name}</strong>
                    <div style="font-size: 0.85rem; color: var(--muted);">
                      <strong>${vHrs} hrs</strong> × $${rate.rate}/hr = <strong>$${vEst.toFixed(2)}</strong>
                      ${v.note ? ` — <span style="font-style: italic;">${v.note}</span>` : ''}
                    </div>
                  </div>
                  ${canAdd ? `<button class="btn small info" onclick="event.stopPropagation(); window.diagAddToInvoice('${esc(vName)}', ${vHrs}, 'operation', '${id}')">+ Add $${vEst.toFixed(0)}</button>` : noJobMsg}
                </div>`;
              }).join('')}
            </div>
          ` : ''}
          
          <!-- Procedure Checklist -->
          ${op.checklist_steps?.length ? `
            <h4 style="margin: 0 0 12px 0;">📝 Procedure Checklist</h4>
            <div style="border: 1px solid var(--line); border-radius: 8px; margin-bottom: 20px;">
              ${op.checklist_steps.map((s, i) => `<div style="padding: 10px 16px; ${i < op.checklist_steps.length - 1 ? 'border-bottom: 1px solid var(--line);' : ''} display: flex; gap: 10px; align-items: center;">
                <span style="width: 20px; height: 20px; border: 2px solid var(--line); border-radius: 4px; flex-shrink: 0;"></span>
                <span>${s.step || s}</span>
              </div>`).join('')}
            </div>
          ` : ''}
          
          <!-- Recommended Add-ons - EACH WITH ADD BUTTON -->
          ${!currentIsStaff && op.recommended_addons?.length ? `
            <h4 style="margin: 0 0 12px 0;">➕ Recommended Add-ons</h4>
            <div style="display: flex; flex-direction: column; gap: 8px; margin-bottom: 20px;">
              ${op.recommended_addons.map(a => {
                const aHrs = a.labor_hours || 0.5; // Default 0.5 hrs for add-ons
                const aEst = aHrs * rate.rate;
                return `<div style="padding: 12px 16px; background: #fef3c7; border: 1px solid #fcd34d; border-radius: 8px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;">
                  <div>
                    <strong>${a.name}</strong>
                    ${a.reason ? ` — <span style="font-size: 0.9rem; color: #92400e;">${a.reason}</span>` : ''}
                    <div style="font-size: 0.85rem; color: var(--muted); margin-top: 2px;">Est: ${aHrs} hr = <strong>$${aEst.toFixed(2)}</strong></div>
                  </div>
                  ${canAdd ? `<button class="btn small" style="background: #f59e0b; color: white; border-color: #f59e0b;" onclick="event.stopPropagation(); window.diagAddToInvoice('${esc(a.name)}', ${aHrs}, 'addon', '${id}')">+ Add $${aEst.toFixed(0)}</button>` : noJobMsg}
                </div>`;
              }).join('')}
            </div>
          ` : ''}
          
          ${op.notes ? `<div style="background: var(--bg); border-radius: 8px; padding: 12px 16px; margin-bottom: 20px;"><strong>💡 Tech Notes:</strong> ${op.notes}</div>` : ''}
        </div>
        
        <div style="padding: 16px 20px; border-top: 1px solid var(--line); display: flex; gap: 12px; flex-wrap: wrap;">
          <button onclick="window.diagShowFeedback('operation', '${id}')" class="btn" style="flex: 1;">📝 Feedback on Labor Time</button>
        </div>
      </div>
    </div>`;
};

// Add to Invoice
window.diagAddToInvoice = async function(serviceName, laborHours, type, itemId) {
  if (!currentJob) { alert('No job selected. Please select a job first.'); return; }
  try {
    const supabase = getSupabaseClient();
    const session = JSON.parse(localStorage.getItem('xm_session') || '{}');
    const shopId = session.shopId;
    if (!supabase || !shopId) throw new Error('No connection');
    const rate = getDefaultLaborRate();
    const { data: freshData, error: dataError } = await supabase.from('data').select('*').eq('shop_id', shopId).single();
    if (dataError) throw dataError;
    const invoices = freshData.invoices || [];
    let invoice = invoices.find(i => i.appointment_id === currentJob.appointment_id || i.job_id === currentJob.id);
    if (!invoice) {
      const maxNum = invoices.reduce((m, i) => Math.max(m, parseInt(i.number) || 0), 1000);
      invoice = { id: `inv_${Date.now()}`, number: maxNum + 1, shop_id: shopId, appointment_id: currentJob.appointment_id, job_id: currentJob.id, status: 'draft', items: [], subtotal: 0, tax: 0, total: 0, created_at: new Date().toISOString() };
      invoices.push(invoice);
    }

    // Create service row (labor_based, price 0)
    const serviceId = `diagsvc_${Date.now()}_${Math.random().toString(36).substr(2,5)}`;
    const serviceRow = {
      id: serviceId,
      type: 'service',
      name: serviceName,
      qty: 1,
      price: 0,
      pricing_type: 'labor_based',
      from_diagnostics: true,
      source_type: type,
      source_id: itemId
    };

    // Create labor row (linked to service row)
    const laborId = `diaglabor_${Date.now()}_${Math.random().toString(36).substr(2,5)}`;
    const laborRow = {
      id: laborId,
      type: 'labor',
      name: rate.name, // Always use default labor rate name
      qty: laborHours,
      price: rate.rate,
      labor_hours: laborHours,
      labor_rate_name: rate.name,
      labor_rate: rate.rate,
      total: laborHours * rate.rate,
      linkedItemId: serviceId,
      from_diagnostics: true,
      source_type: type,
      source_id: itemId
    };

    invoice.items = invoice.items || [];
    invoice.items.push(serviceRow);
    invoice.items.push(laborRow);
    invoice.subtotal = invoice.items.reduce((s, i) => s + (i.total || i.qty * i.price || 0), 0);
    invoice.total = invoice.subtotal + (invoice.tax || 0);
    invoice.updated_at = new Date().toISOString();
    const idx = invoices.findIndex(i => i.id === invoice.id);
    if (idx >= 0) invoices[idx] = invoice;
    await supabase.from('data').update({ invoices, updated_at: new Date().toISOString() }).eq('shop_id', shopId);
    showNotification(`✅ Added "${serviceName}" ($${(laborHours * rate.rate).toFixed(2)})`, 'success');
    window.dispatchEvent(new Event('xm_data_updated'));
  } catch (e) { console.error('Add to invoice failed:', e); showNotification('Failed: ' + e.message, 'error'); }
};

// Record Outcome & Feedback (placeholders)
window.diagRecordOutcome = function(type, id) { showNotification('Record outcome - coming soon!', 'success'); };
window.diagShowFeedback = function(type, id) { showNotification('Feedback - coming soon!', 'success'); };

function showNotification(msg, type) {
  document.getElementById('diagNotification')?.remove();
  const n = document.createElement('div');
  n.id = 'diagNotification';
  n.style.cssText = `position: fixed; top: 80px; left: 50%; transform: translateX(-50%); padding: 12px 24px; border-radius: 8px; font-weight: 500; z-index: 10200; max-width: 90%; text-align: center; ${type === 'success' ? 'background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: white;' : 'background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%); color: white;'}`;
  n.textContent = msg;
  document.body.appendChild(n);
  setTimeout(() => { n.style.opacity = '0'; n.style.transition = 'opacity 0.3s'; setTimeout(() => n.remove(), 300); }, 3000);
}

function debounce(fn, wait) { let t; return function(...a) { clearTimeout(t); t = setTimeout(() => fn(...a), wait); }; }

export default { openDiagnosticsModal, closeDiagnosticsModal };
