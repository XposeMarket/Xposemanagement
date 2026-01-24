/**
 * components/diagnostics/DiagnosticsModal.js
 * Unified Repair Intelligence Tool
 */

import { 
  unifiedSearch, getPlaybookById, getOperationById, logSearchRequest, recordFixOutcome,
  getFixStatistics, submitFeedback, getCommonDtcInfo, COMMON_MAKES, getYearOptions, getModelsForMake,
  getVehicleSpecificLabor, getAiDiagnosticAnalysis, getAiDynamicTriage
} from '../../helpers/diagnostics-api.js';
import { getAiGeneralDiagnosis } from '../../helpers/diagnostics-api.js';
import { getSupabaseClient } from '../../helpers/supabase.js';

// State
let currentJob = null, currentAppt = null, currentVehicle = null, currentResult = null;
let onCloseCallback = null, availableJobs = [], availableAppointments = [];
let shopSettings = null, shopData = null;
let selectedVehicle = { year: '', make: '', model: '' };
let triageAnswers = {}; // Store triage question answers

// AI Labor State
let aiLaborState = {
  loading: false,
  result: null,
  needsEngineSelection: false,
  engineVariants: [],
  selectedEngine: null,
  error: null
};

// AI Diagnostic cache to avoid re-requesting while modal re-renders
let aiDiagCache = {}; // { [playbookId]: { requested: bool, loading: bool, result: object|null, error: string|null } }

// Dynamic AI Triage State
let dynamicTriageState = {
  active: false,
  loading: false,
  conversation: [],    // Array of {role: 'assistant'|'user', content: string}
  questionCount: 0,
  currentQuestion: null,
  diagnosis: null,
  error: null,
  playbookId: null,
  symptom: null
};

// Search results state for client-side filtering
let diagSearchState = { combined: [], query: '', filter: 'all' };

function escapeHtml(s){ return String(s||'').replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }

let currentIsStaff = false;
export function openDiagnosticsModal({ jobs = [], appointments = [], onClose, isStaff = false }) {
  availableJobs = jobs.filter(j => j.status !== 'completed');
  availableAppointments = appointments;
  onCloseCallback = onClose || null;
  currentJob = currentAppt = currentVehicle = currentResult = null;
  selectedVehicle = { year: '', make: '', model: '' };
  triageAnswers = {};
  // Reset dynamic triage state
  dynamicTriageState = {
    active: false, loading: false, conversation: [], questionCount: 0,
    currentQuestion: null, diagnosis: null, error: null, playbookId: null, symptom: null
  };
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
  triageAnswers = {};
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
          <img src="/assets/cortex-mark.png" alt="Cortex" style="width:28px;height:28px;object-fit:contain;" />
          <div style="display:flex;align-items:center;gap:10px;">
            <h3 style="margin: 0; font-size: 1.2rem;">Cortex</h3>
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
window.diagChangeJob = function() { currentJob = currentAppt = currentVehicle = null; selectedVehicle = { year: '', make: '', model: '' }; triageAnswers = {}; showJobSelectionView(); };

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
      ${currentJob ? `<div style="margin-bottom:12px;"><button id="diagAddServiceBtn" class="btn" onclick="window.dispatchEvent(new CustomEvent('openServiceFromDiagnostics',{detail:{jobId:'${currentJob.id}'}}))" style="background: linear-gradient(135deg, #06b6d4, #0ea5a4); color: white; padding: 10px 16px; font-weight:600;">➕ Add Service to Job</button></div>` : ''}
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
  const prevMake = selectedVehicle.make;
  const prevModel = selectedVehicle.model;

  selectedVehicle.year = document.getElementById('diagYearSelect')?.value || '';
  selectedVehicle.make = document.getElementById('diagMakeSelect')?.value || '';
  // read model after we update make/year
  const modelSel = document.getElementById('diagModelSelect');

  // Only rebuild the model list if the make changed (or if models are empty)
  if (modelSel) {
    if (selectedVehicle.make && selectedVehicle.make !== prevMake) {
      const models = getModelsForMake(selectedVehicle.make) || [];
      modelSel.innerHTML = `<option value="">Model</option>` + models.map(m => `<option value="${m}">${m}</option>`).join('');
      modelSel.disabled = models.length === 0;
      // try to restore previous model if it still exists
      if (prevModel && models.includes(prevModel)) {
        modelSel.value = prevModel;
        selectedVehicle.model = prevModel;
      } else {
        // clear selected model when make changed
        modelSel.value = '';
        selectedVehicle.model = '';
      }
    } else {
      // make didn't change — simply read the current model value
      selectedVehicle.model = modelSel.value || '';
    }
  }

  // Wire Add Service button in modal to parts/service flows
  const diagAddBtn = document.getElementById('diagAddServiceBtn');
  if (diagAddBtn) {
    diagAddBtn.addEventListener('click', () => {
      try {
        console.log('[DiagnosticsModal] dispatching openServiceFromDiagnostics', currentJob);
        // Dispatch an app-level event so the Jobs page (which owns the service flow)
        // can open the service modal without creating a circular import.
        window.dispatchEvent(new CustomEvent('openServiceFromDiagnostics', { detail: { job: currentJob } }));
      } catch (e) { console.error('Failed to dispatch openServiceFromDiagnostics:', e); alert('Unable to open Add Service.'); }
    });
  }

  updateVehicleDisplay();
};
window.diagQuickSearch = function(q) {
  const mi = document.getElementById('diagSearchInput');
  if (mi) mi.value = q;
  diagSearchState.query = q;
  window.diagDoSearch();
};

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
  const query = (document.getElementById('diagSearchInput')?.value?.trim()) || (diagSearchState.query || '').trim();
  if (!query) { alert('Please enter a search term'); return; }

  const body = document.getElementById('diagModalBody');
  body.innerHTML = `<div style="text-align: center; padding: 60px 20px;"><div style="width: 40px; height: 40px; border: 3px solid var(--line); border-top-color: #3b82f6; border-radius: 50%; animation: spin 1s linear infinite; margin: 0 auto;"></div><p style="margin-top: 16px; color: var(--muted);">Searching...</p></div><style>@keyframes spin { to { transform: rotate(360deg); } }</style>`;

  const dtcCodes = query.split(/[\s,]+/).filter(p => /^[PBCU]\d{4}$/i.test(p)).map(c => c.toUpperCase());
  const vehicle = currentVehicle || selectedVehicle;
  const vehicleTags = { make: vehicle?.make || '', model: vehicle?.model || '', year: vehicle?.year || '' };

  try {
    const results = await unifiedSearch({ query, dtcCodes, symptoms: dtcCodes.length ? [] : [query], vehicleTags });
    // Cache combined results for client-side filtering
    diagSearchState.combined = results.combined || [];
    diagSearchState.query = query;
    diagSearchState.filter = 'all';
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

  // Build results HTML - staff can see all results but won't have "Add to Invoice" buttons
  // We'll render a search input + filter buttons on the results page and allow client-side filtering
  // The actual list is rendered below by renderResultsList()

  body.innerHTML = `
    <div style="max-width: 800px; margin: 0 auto;">
      <button onclick="window.diagShowSearch()" class="btn small" style="margin-bottom: 16px;">← New Search</button>
      <div id="diagResultsControls" style="display:flex;gap:8px;align-items:center;margin-bottom:12px;flex-wrap:wrap;">
        <div id="diagResultsSearchRow" style="display:flex;gap:8px;align-items:center;flex:1;min-width:0;">
          <input id="diagResultsSearchInput" type="text" placeholder="Search again (press Enter)" value="${escapeHtml(query)}" style="flex:1;padding:10px;border:1px solid var(--line);border-radius:8px;min-width:0;" onkeypress="if(event.key==='Enter') { const v=this.value; const mi=document.getElementById('diagSearchInput'); if(mi) mi.value=v; diagSearchState.query=v; window.diagDoSearch(); }" />
          <button id="diagResultsSearchBtn" class="btn info small" style="margin-left:8px;padding:10px 12px;">Search</button>
        </div>
        <div id="diagFilters" style="display:flex;gap:8px;margin-left:8px;">
          <button id="diagFilterAll" class="btn small" style="border-radius:20px;">All</button>
          <button id="diagFilterServices" class="btn small" style="border-radius:20px;">Services</button>
          <button id="diagFilterDiagnosis" class="btn small" style="border-radius:20px;">Diagnostics</button>
        </div>
      </div>
      <style>
        @media (max-width: 600px) {
          #diagResultsControls { flex-direction: column; align-items: stretch; }
          #diagResultsSearchRow { width: 100%; }
          #diagFilters { margin-left: 0; justify-content: flex-start; flex-wrap: wrap; }
          #diagFilters .btn { margin-top: 6px; }
        }
      </style>
      <div style="background: var(--bg); padding: 12px 16px; border-radius: 8px; margin-bottom: 20px;">
        <p style="margin: 0; font-size: 0.9rem; color: var(--muted);"><strong>Searched:</strong> "${query}" | Found: ${playbooks.length} diagnostics, ${operations.length} services</p>
      </div>
      <div id="diagResultsContainer"></div>
    </div>`;
  window._diagResults = results;
  // Build item HTML (copied from previous rendering logic)
  function buildItemHtml(item) {
    const isPB = item.resultType === 'playbook';
    const icon = isPB ? '🩺' : '🔧';
    const typeLabel = isPB ? 'Diagnostic' : 'Service';
    const color = isPB ? '#8b5cf6' : '#10b981';
    if (isPB) {
      const pb = item.playbook || {};
      const hasTriageQ = pb.triage_questions && pb.triage_questions.length > 0;
      const triageIndicator = hasTriageQ ? `<span style="font-size: 0.7rem; padding: 2px 6px; border-radius: 8px; background: #fef3c7; color: #92400e; margin-left: 8px;">🎯 Quick Questions</span>` : '';
      return `<div style="border: 1px solid var(--line); border-radius: 12px; margin-bottom: 12px; padding: 16px; cursor: pointer;" onclick="window.diagViewPlaybook('${item.id}')">
              <div style="display: flex; align-items: center; flex-wrap: wrap; gap: 4px;">
                <span style="font-size: 0.75rem; padding: 2px 8px; border-radius: 12px; background: ${color}20; color: ${color};">${icon} ${typeLabel}</span>
                ${triageIndicator}
              </div>
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
  }

  function renderResultsList() {
    const listEl = document.getElementById('diagResultsContainer');
    const textFilter = (document.getElementById('diagResultsSearchInput')?.value || '').trim().toLowerCase();
    let items = diagSearchState.combined || results.combined || [];
    if (diagSearchState.filter === 'services') items = items.filter(i => i.resultType === 'operation');
    else if (diagSearchState.filter === 'diagnosis') items = items.filter(i => i.resultType === 'playbook');
    if (textFilter) {
      items = items.filter(i => (((i.title||i.name||'') + ' ' + (i.playbook?.summary||i.summary||i.description||'')).toLowerCase().includes(textFilter)));
    }
    listEl.innerHTML = items.map(buildItemHtml).join('') || `<p class="notice">No results match your filters.</p>`;
    const countEl = document.getElementById('diagResultsContainer')?.previousElementSibling?.querySelector('p');
    if (countEl) countEl.innerHTML = `<strong>Searched:</strong> "${escapeHtml(diagSearchState.query||query)}" | Found: ${items.filter(i=>i.resultType==='playbook').length} diagnostics, ${items.filter(i=>i.resultType==='operation').length} services`;
  }

  // Wire up filters
  document.getElementById('diagFilterAll')?.addEventListener('click', () => { diagSearchState.filter='all'; renderResultsList(); });
  document.getElementById('diagFilterServices')?.addEventListener('click', () => { diagSearchState.filter='services'; renderResultsList(); });
  document.getElementById('diagFilterDiagnosis')?.addEventListener('click', () => { diagSearchState.filter='diagnosis'; renderResultsList(); });
  // Search button triggers a new full search (same as main search input)
  document.getElementById('diagResultsSearchBtn')?.addEventListener('click', () => {
    const q = (document.getElementById('diagResultsSearchInput')?.value || '').trim();
    if (!q) return alert('Please enter a search term');
    const mi = document.getElementById('diagSearchInput');
    if (mi) mi.value = q;
    diagSearchState.query = q;
    window.diagDoSearch();
  });

  // Initialize and render
  diagSearchState.combined = combined;
  diagSearchState.query = query;
  diagSearchState.filter = 'all';
  renderResultsList();
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

// Helper to get recommended actions based on triage answers
function getTriageRecommendation(playbookId, triageQuestions) {
  // Get the answers for this playbook
  const answers = triageAnswers[playbookId] || {};
  const answeredCount = Object.keys(answers).length;
  
  if (answeredCount === 0 || !triageQuestions?.length) return null;
  
  // Build recommendation based on common patterns
  const recommendations = [];
  
  triageQuestions.forEach((tq, idx) => {
    const answer = answers[idx];
    if (!answer) return;
    
    const q = tq.q.toLowerCase();
    const a = answer.toLowerCase();
    
    // No start patterns
    if (q.includes('click') && a.includes('single')) {
      recommendations.push({ priority: 1, text: 'Single click typically indicates starter solenoid/motor failure', service: 'Starter Replacement' });
    }
    if (q.includes('click') && a.includes('multiple')) {
      recommendations.push({ priority: 1, text: 'Multiple clicks typically indicates weak battery or poor connection', service: 'Battery Replacement' });
    }
    if (q.includes('dashboard') && a.includes('dim')) {
      recommendations.push({ priority: 2, text: 'Dim lights suggest battery/charging issue', service: 'Battery Test & Replacement' });
    }
    if (q.includes('dashboard') && a === 'no') {
      recommendations.push({ priority: 1, text: 'No power - check fuses, ignition switch, battery cables', service: 'Electrical Diagnosis' });
    }
    
    // Brake noise patterns
    if (q.includes('type of noise') && a.includes('grinding')) {
      recommendations.push({ priority: 1, text: 'Grinding = pads worn to metal. URGENT - rotors likely damaged', service: 'Brake Pad & Rotor Replacement' });
    }
    if (q.includes('type of noise') && a.includes('squeal')) {
      recommendations.push({ priority: 2, text: 'High-pitched squeal may be wear indicators or glazed pads', service: 'Brake Pad Replacement' });
    }
    if (q.includes('which end') && a.includes('front')) {
      recommendations.push({ priority: 3, text: 'Focus diagnosis on front brakes' });
    }
    if (q.includes('which end') && a.includes('rear')) {
      recommendations.push({ priority: 3, text: 'Focus diagnosis on rear brakes' });
    }
    
    // AC patterns
    if (q.includes('compressor') && a === 'no') {
      recommendations.push({ priority: 1, text: 'Compressor not engaging - check clutch, pressure switch, fuse', service: 'AC Diagnosis' });
    }
    if (q.includes('blower') && a === 'no') {
      recommendations.push({ priority: 1, text: 'Blower not working - check fuse, resistor, motor', service: 'Blower Motor Replacement' });
    }
    if (q.includes('temperature dial') && a === 'no') {
      recommendations.push({ priority: 2, text: 'Blend door actuator may be stuck', service: 'Blend Door Actuator Replacement' });
    }
  });
  
  // Sort by priority and return
  recommendations.sort((a, b) => a.priority - b.priority);
  return recommendations.length > 0 ? recommendations : null;
}

// View Playbook Detail - WITH TRIAGE QUESTIONS
window.diagViewPlaybook = async function(id) {
  const body = document.getElementById('diagModalBody');
  body.innerHTML = `<div style="text-align: center; padding: 60px;"><p>Loading...</p></div>`;
  const playbook = await getPlaybookById(id);
  if (!playbook) { showErrorView('Could not load playbook'); return; }
  currentResult = playbook;
  const pb = playbook.playbook || {}, rate = getDefaultLaborRate();
  const canAdd = !!currentJob && !currentIsStaff;
  const noJobMsg = currentIsStaff ? '' : '<span style="font-size: 0.8rem; color: var(--muted); font-style: italic;">Select job to add</span>';

  // Initialize triage answers for this playbook if not exists
  if (!triageAnswers[id]) triageAnswers[id] = {};

  // Check if has triage questions
  const hasTriageQ = pb.triage_questions && pb.triage_questions.length > 0;
  const recommendations = hasTriageQ ? getTriageRecommendation(id, pb.triage_questions) : null;

  // --- AI Diagnostic Analysis State (non-blocking) ---
  let aiDiagHtml = '';
  let aiDiagResult = null;
  let aiDiagLoading = false;
  let aiDiagError = null;

  // General AI HTML for playbooks without triage
  let generalAiHtml = '';

  // Determine cache entry for this playbook
  const cacheKey = id;
  if (!aiDiagCache[cacheKey]) aiDiagCache[cacheKey] = { requested: false, loading: false, result: null, error: null };
  const entry = aiDiagCache[cacheKey];

  // If all triage questions are answered, trigger AI analysis asynchronously (non-blocking)
  let answeredAll = false;
  if (hasTriageQ) {
    answeredAll = pb.triage_questions.every((_, i) => triageAnswers[id][i]);
    if (answeredAll && !entry.requested) {
      // mark requested and loading, then fetch in background
      entry.requested = true;
      entry.loading = true;
      // Re-render immediately so users see the loading panel
      try { window.diagViewPlaybook(id); } catch (e) { /* ignore */ }
      (async () => {
        try {
          const triageQA = pb.triage_questions.map((q, i) => ({ question: q.q, answer: triageAnswers[id][i] }));
          const likelyCauses = (pb.likely_causes || []).map(c => typeof c === 'string' ? c : (c.name || c));
          const vehicle = currentVehicle || selectedVehicle;
          const res = await getAiDiagnosticAnalysis({
            playbookId: id,
            playbookTitle: playbook.title,
            vehicleYear: vehicle?.year,
            vehicleMake: vehicle?.make,
            vehicleModel: vehicle?.model,
            engineType: vehicle?.engine,
            triageAnswers: triageQA,
            likelyCauses
          });
          entry.result = res;
          entry.loading = false;
        } catch (e) {
          entry.error = e.message || 'AI analysis failed';
          entry.loading = false;
        }
        // Re-render the playbook view to show results
        try { window.diagViewPlaybook(id); } catch (e) { /* ignore */ }
      })();
    }
  }

  // If there are NO triage questions, trigger the general diagnosis AI asynchronously
  if (!hasTriageQ) {
    const vehicle = currentVehicle || selectedVehicle;
    if (vehicle?.year && vehicle?.make && vehicle?.model && !entry.requested) {
      entry.requested = true;
      entry.loading = true;
      // Re-render immediately to show loading state
      try { window.diagViewPlaybook(id); } catch (e) { /* ignore */ }
      (async () => {
        try {
          const res = await getAiGeneralDiagnosis({
            diagnosisTitle: playbook.title,
            vehicleYear: vehicle.year,
            vehicleMake: vehicle.make,
            vehicleModel: vehicle.model
          });
          entry.result = res;
          entry.loading = false;
        } catch (e) {
          entry.error = e.message || 'General analysis failed';
          entry.loading = false;
        }
        try { window.diagViewPlaybook(id); } catch (e) { /* ignore */ }
      })();
    }
  }

  // Read values from cache for rendering
  aiDiagResult = entry.result;
  aiDiagLoading = entry.loading;
  aiDiagError = entry.error;

  // Build triage questions HTML
  let triageHtml = '';
  if (hasTriageQ) {
    triageHtml = `
      <div style="background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%); border: 2px solid #f59e0b; border-radius: 12px; padding: 16px 20px; margin-bottom: 20px;">
        <h4 style="margin: 0 0 16px 0; color: #92400e; display: flex; align-items: center; gap: 8px;">
          <span style="font-size: 1.2rem;">🎯</span> Quick Triage Questions
          <span style="font-size: 0.75rem; font-weight: normal; color: #b45309;">(Answer to narrow down the cause)</span>
        </h4>
        <div style="display: flex; flex-direction: column; gap: 16px;">
          ${pb.triage_questions.map((tq, idx) => {
            const currentAnswer = triageAnswers[id][idx] || '';
            return `
              <div style="background: white; border-radius: 8px; padding: 12px 16px;">
                <p style="margin: 0 0 10px 0; font-weight: 600; color: #1f2937;">${idx + 1}. ${tq.q}</p>
                <div style="display: flex; flex-wrap: wrap; gap: 8px;">
                  ${tq.answers.map(ans => {
                    const isSelected = currentAnswer === ans;
                    const btnStyle = isSelected 
                      ? 'background: #10b981; color: white; border-color: #10b981;' 
                      : 'background: white; color: #374151; border: 1px solid #d1d5db;';
                    return `<button 
                      onclick=\"window.diagAnswerTriage('${id}', ${idx}, '${ans.replace(/'/g, "\\'")}')\" 
                      class=\"btn small\" 
                      style=\"${btnStyle} padding: 8px 16px; border-radius: 20px; font-size: 0.9rem; transition: all 0.2s;\">
                      ${isSelected ? '✓ ' : ''}${ans}
                    </button>`;
                  }).join('')}
                </div>
              </div>
            `;
          }).join('')}
        </div>
        <!-- Recommendations based on answers -->
        <div id=\"triageRecommendations\" style=\"margin-top: 16px; ${recommendations ? '' : 'display: none;'}\">
          ${recommendations ? `
            <div style=\"background: white; border-radius: 8px; padding: 12px 16px; border-left: 4px solid #10b981;\">
              <h5 style=\"margin: 0 0 8px 0; color: #166534; display: flex; align-items: center; gap: 6px;\">
                <span>💡</span> Based on your answers:
              </h5>
              <ul style=\"margin: 0; padding-left: 20px; color: #1f2937;\">
                ${recommendations.map(r => `<li style=\"margin-bottom: 4px;\">${r.text}${r.service ? ` → <strong>${r.service}</strong>` : ''}</li>`).join('')}
              </ul>
            </div>
          ` : ''}
        </div>
        <!-- Triage questions area: questions + recommendations + inline triage analysis -->
        ${(answeredAll && (aiDiagLoading || aiDiagResult)) ? `
          <div style="margin-top: 20px;">
            <h4 style="margin: 0 0 8px 0; color: #0e7490; display: flex; align-items: center; gap: 8px;"><img src="/assets/cortex-mark.png" alt="Cortex" style="width:22px;height:22px;object-fit:contain;display:block;"> Cortex Triage Analysis</h4>
            ${aiDiagLoading ? `
              <div style="background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%); border: 2px solid #f59e0b; border-radius: 8px; padding: 16px; margin-top: 8px; position: relative;">
                <div style="position: absolute; left: 16px; top: 50%; transform: translateY(-50%); width: 24px; height: 24px;">
                  <div style="width:24px;height:24px;border:3px solid #f59e0b;border-top-color:transparent;border-radius:50%;animation: spin 1s linear infinite;position:absolute;top:0;left:0;"></div>
                </div>
                <div style="margin-left: 56px;">
                  <div style="font-weight:600;color:#92400e;">🔍 Cortex is analyzing your answers...</div>
                </div>
              </div>
            ` : ''}
            ${aiDiagError ? `
              <div style="background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 14px 16px; margin-top: 8px;">
                <div style="display: flex; align-items: center; gap: 10px;">
                  <span style="font-size: 1.5rem;">⚠️</span>
                  <div style="flex: 1;">
                    <div style="font-weight: 600; color: #991b1b;">Cortex Unavailable</div>
                    <div style="font-size: 0.85rem; color: #7f1d1d; margin-top: 2px;">${aiDiagError}</div>
                  </div>
                  <button onclick="window.diagRetryAiAnalysis('${id}', 'triage')" class="btn small" style="background: #ef4444; color: white; border-color: #ef4444;">🔄 Try Again</button>
                </div>
              </div>
            ` : ''}
            ${aiDiagResult && aiDiagResult.status !== 'error' ? (() => {
              let confColor = '#64748b', confBg = '#f1f5f9', confBorder = '#cbd5e1';
              if (aiDiagResult.confidence === 'high') { confColor = '#166534'; confBg = '#dcfce7'; confBorder = '#86efac'; }
              else if (aiDiagResult.confidence === 'medium') { confColor = '#92400e'; confBg = '#fef3c7'; confBorder = '#fcd34d'; }
              else if (aiDiagResult.confidence === 'low') { confColor = '#991b1b'; confBg = '#fee2e2'; confBorder = '#fecaca'; }
              return `
                <div style="background: #f0f9ff; border: 1px solid #bae6fd; border-radius: 8px; padding: 14px 16px; margin-top: 8px;">
                  <div style="font-size: 1.1rem; color: #0369a1; font-weight: 600;">Most Probable Cause: <span style="color: #0e7490;">${aiDiagResult.probableCause || aiDiagResult.cause || 'N/A'}</span></div>
                  ${aiDiagResult.explanation ? `<div style="margin-top: 8px; color: #334155;">${aiDiagResult.explanation}</div>` : ''}
                  ${aiDiagResult.whatToCheck ? `<div style="margin-top: 8px; color: #0e7490;"><strong>What to check:</strong> ${aiDiagResult.whatToCheck}</div>` : ''}
                  ${aiDiagResult.confidence ? `<div style="margin-top: 8px;"><span style="font-size: 0.85rem; padding: 4px 12px; border-radius: 12px; background: ${confBg}; color: ${confColor}; font-weight: 600; border: 1px solid ${confBorder};">${(aiDiagResult.confidence || '').toUpperCase()} CONFIDENCE</span></div>` : ''}
                </div>
              `;
            })() : ''}
          </div>
        ` : ''}
      </div>
    `;
  }

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

          <!-- AI Dynamic Triage Section -->
          <div id="dynamicTriageContainer" style="margin-bottom: 20px;">
            ${(() => {
              const vehicle = currentVehicle || selectedVehicle;
              const hasVehicle = vehicle?.year && vehicle?.make && vehicle?.model;
              // Initialize state for this playbook
              if (!dynamicTriageState.playbookId) {
                dynamicTriageState.symptom = playbook.title;
                dynamicTriageState.playbookId = id;
              }
              if (hasVehicle) {
                return `
                  <div style="background: linear-gradient(135deg, #f3e8ff 0%, #e9d5ff 100%); border: 2px solid #a855f7; border-radius: 12px; padding: 20px; text-align: center;">
                    <div style="margin-bottom: 12px;"><img src="/assets/cortex-mark.png" alt="Cortex" style="width:40px;height:40px;object-fit:contain;display:block;margin:0 auto;"></div>
                    <h4 style="margin: 0 0 8px 0; color: #6d28d9;">Cortex-Powered Diagnosis</h4>
                    <p style="margin: 0 0 16px 0; color: #7c3aed; font-size: 0.9rem;">
                      Cortex will ask 3-5 smart questions to pinpoint the issue for your <strong>${vehicle.year} ${vehicle.make} ${vehicle.model}</strong>, then provide TSBs, recalls, and recommendations.
                    </p>
                    <button onclick="window.diagStartDynamicTriage('${id}', '${playbook.title.replace(/'/g, "\\'")}')" 
                      class="btn" style="background: linear-gradient(135deg, #8b5cf6, #6d28d9); color: white; border: none; padding: 12px 32px; font-size: 1rem;">
                      🚀 Start Cortex Diagnosis
                    </button>
                  </div>
                `;
              } else {
                return `
                  <div style="background: #f1f5f9; border: 2px dashed #94a3b8; border-radius: 12px; padding: 20px; text-align: center;">
                    <div style="font-size: 1.5rem; margin-bottom: 8px;">🚗</div>
                    <p style="margin: 0; color: #64748b; font-size: 0.9rem;">
                      <strong>Select a vehicle</strong> to unlock Cortex-powered diagnosis with TSBs, recalls, and personalized recommendations.
                    </p>
                  </div>
                `;
              }
            })()}
          </div>

          ${ (!hasTriageQ && (aiDiagLoading || aiDiagResult)) ? `
            <div style="margin-top: 20px;">
              <h4 style="margin: 0 0 8px 0; color: #0e7490; display: flex; align-items: center; gap: 8px;"><img src="/assets/cortex-mark.png" alt="Cortex" style="width:22px;height:22px;object-fit:contain;display:block;"> Cortex Analysis</h4>
              ${aiDiagLoading ? `
                <div style="background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%); border: 2px solid #f59e0b; border-radius: 8px; padding: 16px; margin-top: 8px; position: relative;">
                  <div style="position: absolute; left: 16px; top: 50%; transform: translateY(-50%); width: 24px; height: 24px;">
                    <div style="width: 24px; height: 24px; border: 3px solid #f59e0b; border-top-color: transparent; border-radius: 50%; animation: spin 1s linear infinite; position:absolute; top:0; left:0;"></div>
                  </div>
                  <div style="margin-left: 56px;">
                    <div style="font-weight:600;color:#92400e;">🔍 Cortex is researching most probable causes...</div>
                    <div style="font-size:0.85rem;color:#b45309;">${(currentVehicle || selectedVehicle)?.year || ''} ${(currentVehicle || selectedVehicle)?.make || ''} ${(currentVehicle || selectedVehicle)?.model || ''}</div>
                  </div>
                </div>
              ` : ''}
              ${aiDiagError ? `
                <div style="background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 14px 16px; margin-top: 8px;">
                  <div style="display: flex; align-items: center; gap: 10px;">
                    <span style="font-size: 1.5rem;">⚠️</span>
                    <div style="flex: 1;">
                      <div style="font-weight: 600; color: #991b1b;">Cortex Unavailable</div>
                      <div style="font-size: 0.85rem; color: #7f1d1d; margin-top: 2px;">${aiDiagError}</div>
                    </div>
                    <button onclick="window.diagRetryAiAnalysis('${id}', 'general')" class="btn small" style="background: #ef4444; color: white; border-color: #ef4444;">🔄 Try Again</button>
                  </div>
                </div>
              ` : ''}
              ${aiDiagResult && aiDiagResult.status !== 'error' ? (() => {
                let confColor = '#64748b', confBg = '#f1f5f9', confBorder = '#cbd5e1';
                if (aiDiagResult.confidence === 'high') { confColor = '#166534'; confBg = '#dcfce7'; confBorder = '#86efac'; }
                else if (aiDiagResult.confidence === 'medium') { confColor = '#92400e'; confBg = '#fef3c7'; confBorder = '#fcd34d'; }
                else if (aiDiagResult.confidence === 'low') { confColor = '#991b1b'; confBg = '#fee2e2'; confBorder = '#fecaca'; }
                return `
                  <div style="background: #f0f9ff; border: 1px solid #bae6fd; border-radius: 8px; padding: 14px 16px; margin-top: 8px;">
                    <div style="font-size: 1.1rem; color: #0369a1; font-weight: 600;">Most Probable Cause: <span style="color: #0e7490;">${aiDiagResult.probableCause || aiDiagResult.cause || 'N/A'}</span></div>
                    ${aiDiagResult.explanation ? `<div style="margin-top: 8px; color: #334155;">${aiDiagResult.explanation}</div>` : ''}
                    ${aiDiagResult.whatToCheck ? `<div style="margin-top: 8px; color: #0e7490;"><strong>What to check:</strong> ${aiDiagResult.whatToCheck}</div>` : ''}
                    ${aiDiagResult.confidence ? `<div style="margin-top: 8px;"><span style="font-size: 0.85rem; padding: 4px 12px; border-radius: 12px; background: ${confBg}; color: ${confColor}; font-weight: 600; border: 1px solid ${confBorder};">${(aiDiagResult.confidence || '').toUpperCase()} CONFIDENCE</span></div>` : ''}
                  </div>
                `;
              })() : ''}
            </div>
          ` : ''}

          <!-- TRIAGE QUESTIONS (if available) -->
          ${triageHtml}
          ${pb.likely_causes?.length ? `<h4 style="margin: 0 0 12px 0;">🎯 Likely Causes</h4><ol style="margin: 0 0 20px 0; padding-left: 20px;">${pb.likely_causes.map((c, i) => `<li style="margin-bottom: 8px; ${i === 0 ? 'color: #10b981; font-weight: 600;' : ''}"><strong>${c.name || c}</strong>${c.description ? `<br><span style="font-size: 0.9rem; color: var(--muted);">${c.description}</span>` : ''}</li>`).join('')}</ol>` : ''}
          ${pb.diagnostic_steps?.length ? `<h4 style="margin: 0 0 12px 0;">🔍 Diagnostic Steps</h4><div style="border: 1px solid var(--line); border-radius: 8px; margin-bottom: 20px;">${pb.diagnostic_steps.map((s, i) => `<div style="padding: 12px 16px; ${i < pb.diagnostic_steps.length - 1 ? 'border-bottom: 1px solid var(--line);' : ''} display: flex; gap: 12px;"><span style="background: #3b82f6; color: white; width: 24px; height: 24px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 0.85rem; flex-shrink: 0;">${i + 1}</span><div><strong>${s.title || s}</strong>${s.description ? `<p style="margin: 4px 0 0 0; font-size: 0.9rem; color: var(--muted);">${s.description}</p>` : ''}</div></div>`).join('')}</div>` : ''}
          ${pb.what_results_mean?.length ? `
            <h4 style="margin: 0 0 12px 0;">📋 What Results Mean</h4>
            <div style="border: 1px solid var(--line); border-radius: 8px; margin-bottom: 20px; overflow: hidden;">
              ${pb.what_results_mean.map((r, i) => `
                <div style="padding: 10px 16px; ${i < pb.what_results_mean.length - 1 ? 'border-bottom: 1px solid var(--line);' : ''} display: flex; gap: 8px; align-items: flex-start;">
                  <span style="color: #3b82f6; font-weight: bold;">IF:</span>
                  <span style="flex: 1;">${r.condition}</span>
                  <span style="color: #10b981; font-weight: bold;">→</span>
                  <span style="flex: 1; color: #10b981; font-weight: 500;">${r.then}</span>
                </div>
              `).join('')}
            </div>
          ` : ''}
          ${pb.safety_warnings?.length ? `<div style="background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 14px 16px; margin-bottom: 20px;"><h4 style="margin: 0 0 8px 0; color: #991b1b;">⚠️ Safety Warnings</h4><ul style="margin: 0; padding-left: 20px; color: #991b1b;">${pb.safety_warnings.map(w => `<li>${w}</li>`).join('')}</ul></div>` : ''}
          ${!currentIsStaff && pb.suggested_services?.length ? `<h4 style="margin: 0 0 12px 0;">🛠️ Suggested Services</h4><div style="display: flex; flex-direction: column; gap: 8px; margin-bottom: 20px;">${pb.suggested_services.map(svc => {
            const name = svc.name || svc, hrs = svc.labor_hours || 1, est = hrs * rate.rate;
            return `<div style="padding: 12px 16px; background: var(--bg); border: 1px solid var(--line); border-radius: 8px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;">
              <div><strong>${name}</strong><div style="font-size: 0.85rem; color: var(--muted);">${hrs} hr × $${rate.rate}/hr = <strong>$${est.toFixed(2)}</strong></div></div>
              ${canAdd ? `<button class="btn small info" onclick="event.stopPropagation(); window.diagAddToInvoice('${name.replace(/'/g, "\\'")}', ${hrs}, 'playbook', '${id}')">+ Add ${est.toFixed(2)}</button>` : noJobMsg}
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

// Handle triage question answer
window.diagAnswerTriage = function(playbookId, questionIdx, answer) {
  // Store the answer
  if (!triageAnswers[playbookId]) triageAnswers[playbookId] = {};
  triageAnswers[playbookId][questionIdx] = answer;
  
  // Re-render the playbook view to update UI
  window.diagViewPlaybook(playbookId);
};

// Retry AI analysis (for playbook diagnostics)
window.diagRetryAiAnalysis = function(playbookId, type) {
  // Clear the cache entry to force a new request
  if (aiDiagCache[playbookId]) {
    aiDiagCache[playbookId] = { requested: false, loading: false, result: null, error: null };
  }
  // Re-render the playbook view which will trigger a new AI request
  window.diagViewPlaybook(playbookId);
};

// Retry AI labor lookup (for service operations)
window.diagRetryAiLabor = function(operationId) {
  // Reset AI labor state and re-fetch
  aiLaborState = {
    loading: false,
    result: null,
    needsEngineSelection: false,
    engineVariants: [],
    selectedEngine: null,
    error: null
  };
  // Re-load the operation view with fresh AI lookup
  window.diagViewOperation(operationId, false);
};

// View Operation Detail - WITH AI LABOR LOOKUP!
window.diagViewOperation = async function(id, skipAiLookup = false) {
  const body = document.getElementById('diagModalBody');
  body.innerHTML = `<div style="text-align: center; padding: 60px;"><p>Loading...</p></div>`;
  
  const op = await getOperationById(id);
  if (!op) { showErrorView('Could not load operation'); return; }
  currentResult = op;
  
  const vehicle = currentVehicle || selectedVehicle;
  const rate = getDefaultLaborRate();
  const hrs = op.labor_hours_typical || 1;
  
  // Reset AI state if this is a fresh load (not from engine selection)
  if (!skipAiLookup) {
    aiLaborState = {
      loading: true,
      result: null,
      needsEngineSelection: false,
      engineVariants: [],
      selectedEngine: null,
      error: null
    };
  }
  
  // Render initial view
  renderOperationView(op, rate, hrs, vehicle);
  
  // Fetch AI labor data if we have vehicle info and not skipping
  if (!skipAiLookup && vehicle?.year && vehicle?.make && vehicle?.model) {
    try {
      const aiResponse = await getVehicleSpecificLabor({
        operationId: id,
        operationName: op.name,
        dbLaborHours: {
          low: op.labor_hours_low || hrs,
          typical: op.labor_hours_typical || hrs,
          high: op.labor_hours_high || hrs
        },
        vehicle,
        engineType: aiLaborState.selectedEngine
      });
      
      aiLaborState.loading = false;
      
      if (aiResponse.status === 'needs_engine_selection') {
        aiLaborState.needsEngineSelection = true;
        aiLaborState.engineVariants = aiResponse.variants || [];
      } else if (aiResponse.status === 'complete') {
        aiLaborState.result = aiResponse.data;
        aiLaborState.needsEngineSelection = false;
      } else if (aiResponse.status === 'error') {
        aiLaborState.error = aiResponse.error || 'Failed to get vehicle-specific labor';
      }
      
      // Re-render with AI data
      renderOperationView(op, rate, hrs, vehicle);
      
    } catch (e) {
      console.error('[DiagnosticsModal] AI labor lookup error:', e);
      aiLaborState.loading = false;
      aiLaborState.error = e.message;
      renderOperationView(op, rate, hrs, vehicle);
    }
  } else {
    aiLaborState.loading = false;
  }
};

// Handle engine selection for AI labor
window.diagSelectEngine = async function(operationId, engineType) {
  const vehicle = currentVehicle || selectedVehicle;
  
  aiLaborState.loading = true;
  aiLaborState.selectedEngine = engineType;
  aiLaborState.needsEngineSelection = false;
  
  // Re-render to show loading
  const op = currentResult;
  const rate = getDefaultLaborRate();
  renderOperationView(op, rate, op.labor_hours_typical || 1, vehicle);
  
  try {
    const aiResponse = await getVehicleSpecificLabor({
      operationId,
      operationName: op.name,
      dbLaborHours: {
        low: op.labor_hours_low,
        typical: op.labor_hours_typical,
        high: op.labor_hours_high
      },
      vehicle,
      engineType
    });
    
    aiLaborState.loading = false;
    
    if (aiResponse.status === 'complete') {
      aiLaborState.result = aiResponse.data;
    } else if (aiResponse.status === 'error') {
      aiLaborState.error = aiResponse.error;
    }
    
    renderOperationView(op, rate, op.labor_hours_typical || 1, vehicle);
    
  } catch (e) {
    console.error('[DiagnosticsModal] Engine selection error:', e);
    aiLaborState.loading = false;
    aiLaborState.error = e.message;
    renderOperationView(op, rate, op.labor_hours_typical || 1, vehicle);
  }
};

// Render the operation view with AI labor integration
function renderOperationView(op, rate, hrs, vehicle) {
  const body = document.getElementById('diagModalBody');
  if (!body) return;
  
  const canAdd = !!currentJob && !currentIsStaff;
  const noJobMsg = currentIsStaff ? '' : '<span style="font-size: 0.8rem; color: var(--muted); font-style: italic;">Select job to add</span>';
  const esc = (s) => (s || '').replace(/'/g, "\\'").replace(/"/g, '\\"');
  
  // Build AI Labor Section HTML
  let aiLaborHtml = '';
  const hasVehicle = vehicle?.year && vehicle?.make && vehicle?.model;
  
  if (hasVehicle) {
    if (aiLaborState.loading) {
      // Loading state
      aiLaborHtml = `
        <div style="background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%); border: 2px solid #f59e0b; border-radius: 8px; padding: 16px; margin-top: 16px;">
          <div style="display: flex; align-items: center; gap: 12px;">
            <div style="width: 24px; height: 24px; border: 3px solid #f59e0b; border-top-color: transparent; border-radius: 50%; animation: spin 1s linear infinite;"></div>
            <div>
              <div style="font-weight: 600; color: #92400e;">🔍 Cortex is Researching labor times...</div>
              <div style="font-size: 0.85rem; color: #b45309;">${vehicle.year} ${vehicle.make} ${vehicle.model}</div>
            </div>
          </div>
        </div>`;
        
    } else if (aiLaborState.needsEngineSelection && aiLaborState.engineVariants?.length > 0) {
      // Engine selection state
      aiLaborHtml = `
        <div style="background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%); border: 2px solid #f59e0b; border-radius: 8px; padding: 16px; margin-top: 16px;">
          <h4 style="margin: 0 0 12px 0; color: #92400e; display: flex; align-items: center; gap: 8px;">
            <span>🔧</span> Select Engine Type
          </h4>
          <p style="margin: 0 0 12px 0; font-size: 0.9rem; color: #78350f;">
            ${vehicle.year} ${vehicle.make} ${vehicle.model} has multiple engine options with different labor times:
          </p>
          <div style="display: flex; flex-direction: column; gap: 8px;">
            ${aiLaborState.engineVariants.map(v => {
              const isCommon = v.is_most_common;
              return `
                <button onclick="window.diagSelectEngine('${op.id}', '${esc(v.engine_type)}')"
                  class="btn" style="text-align: left; padding: 12px 16px; background: white; border: 2px solid ${isCommon ? '#10b981' : '#e5e7eb'}; border-radius: 8px;">
                  <div style="display: flex; justify-content: space-between; align-items: center;">
                    <div>
                      <strong>${v.engine_type}</strong>
                      ${isCommon ? '<span style="font-size: 0.7rem; background: #dcfce7; color: #166534; padding: 2px 8px; border-radius: 12px; margin-left: 8px;">Most Common</span>' : ''}
                      ${v.notes ? `<p style="margin: 4px 0 0 0; font-size: 0.85rem; color: var(--muted);">${v.notes}</p>` : ''}
                    </div>
                    <div style="text-align: right;">
                      <strong style="color: #10b981;">${v.labor_hours_typical} hrs</strong>
                      <div style="font-size: 0.8rem; color: var(--muted);">${v.labor_hours_low}-${v.labor_hours_high}</div>
                    </div>
                  </div>
                </button>`;
            }).join('')}
          </div>
        </div>`;
        
    } else if (aiLaborState.result) {
      // AI Result state
      const ai = aiLaborState.result;
      const confidenceColors = {
        high: { bg: '#dcfce7', text: '#166534', border: '#86efac' },
        medium: { bg: '#fef3c7', text: '#92400e', border: '#fcd34d' },
        low: { bg: '#fee2e2', text: '#991b1b', border: '#fecaca' }
      };
      const conf = confidenceColors[ai.confidence] || confidenceColors.medium;
      const aiHrs = ai.labor_hours_typical || hrs;
      
      aiLaborHtml = `
        <div style="background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%); border: 2px solid #f59e0b; border-radius: 8px; padding: 16px; margin-top: 16px;">
          <div style="display: flex; justify-content: space-between; align-items: start; flex-wrap: wrap; gap: 12px;">
            <div>
              <div style="font-size: 0.85rem; color: #92400e; margin-bottom: 4px;">
                🚗 ${vehicle.year} ${vehicle.make} ${vehicle.model} ${ai.engine_type && ai.engine_type !== 'all' && ai.engine_type !== 'All engines similar' ? `<span style="font-weight: 600;">(${ai.engine_type})</span>` : ''}
              </div>
              <div style="font-size: 1.5rem; font-weight: 700; color: #78350f;">
                ${aiHrs} hrs
                <span style="font-size: 0.9rem; font-weight: normal; color: #92400e;">
                  (${ai.labor_hours_low || aiHrs}-${ai.labor_hours_high || aiHrs})
                </span>
              </div>
            </div>
            <div style="text-align: right;">
              <span style="font-size: 0.75rem; padding: 4px 12px; border-radius: 12px; background: ${conf.bg}; color: ${conf.text}; font-weight: 600; border: 1px solid ${conf.border};">
                ${(ai.confidence || 'medium').toUpperCase()} CONFIDENCE
              </span>
              ${ai.sources?.length ? `<div style="font-size: 0.75rem; color: #92400e; margin-top: 4px;">Sources: ${ai.sources.slice(0, 3).join(', ')}</div>` : ''}
            </div>
          </div>
          
          ${ai.labor_notes ? `<p style="margin: 12px 0 0 0; font-size: 0.9rem; color: #78350f; padding-top: 12px; border-top: 1px solid #fcd34d;">${ai.labor_notes}</p>` : ''}
          
          ${ai.required_tools?.length ? `
            <div style="margin-top: 12px; padding-top: 12px; border-top: 1px solid #fcd34d;">
              <strong style="font-size: 0.85rem; color: #92400e;">🔧 Required Tools:</strong>
              <div style="display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px;">
                ${ai.required_tools.map(t => `<span style="font-size: 0.8rem; background: white; padding: 4px 10px; border-radius: 12px; border: 1px solid #fcd34d;">${t}</span>`).join('')}
              </div>
            </div>
          ` : ''}
          
          ${ai.vehicle_specific_tips?.length ? `
            <div style="margin-top: 12px; padding-top: 12px; border-top: 1px solid #fcd34d;">
              <strong style="font-size: 0.85rem; color: #92400e;">💡 Vehicle-Specific Tips:</strong>
              <ul style="margin: 6px 0 0 0; padding-left: 20px; font-size: 0.85rem; color: #78350f;">
                ${ai.vehicle_specific_tips.map(t => `<li>${t}</li>`).join('')}
              </ul>
            </div>
          ` : ''}
          
          <!-- Add to Invoice with AI hours -->
          <div style="margin-top: 16px; padding-top: 12px; border-top: 1px solid #fcd34d; text-align: center;">
            ${canAdd ? `
              <button class="btn" style="background: #f59e0b; color: white; border-color: #f59e0b; font-weight: 600;" 
                onclick="window.diagAddToInvoice('${esc(op.name)}', ${aiHrs}, 'operation', '${op.id}')">
                + Add to Invoice (${aiHrs} hrs = ${(aiHrs * rate.rate).toFixed(2)})
              </button>
              <div style="font-size: 0.75rem; color: #92400e; margin-top: 6px;">Using vehicle-specific labor time</div>
            ` : noJobMsg}
          </div>
        </div>`;
        
    } else if (aiLaborState.error) {
      // Error state with retry button
      const defaultPrice = (hrs * rate.rate).toFixed(2);
      aiLaborHtml = `
        <div style="background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 14px 16px; margin-top: 16px;">
          <div style="display: flex; align-items: center; gap: 10px;">
            <span style="font-size: 1.5rem;">⚠️</span>
            <div style="flex: 1;">
              <div style="font-weight: 600; color: #991b1b;">Cortex Unavailable</div>
              <div style="font-size: 0.85rem; color: #7f1d1d; margin-top: 2px;">Couldn't get vehicle-specific labor time</div>
              <div style="font-size: 0.8rem; color: #9f1239; margin-top: 4px;">${aiLaborState.error}</div>
            </div>
            <button onclick="window.diagRetryAiLabor('${op.id}')" class="btn small" style="background: #ef4444; color: white; border-color: #ef4444;">🔄 Try Again</button>
          </div>
          <div style="margin-top: 12px; padding-top: 12px; border-top: 1px solid #fecaca; text-align: center;">
            <span style="font-size: 0.85rem; color: #7f1d1d;">Using Cortex database defaults instead</span>
            ${canAdd ? `
              <div style="margin-top: 8px;">
                <button class="btn small info" onclick="window.diagAddToInvoice('${esc(op.name)}', ${hrs}, 'operation', '${op.id}')">
                  + Add with Default (${hrs} hrs = ${defaultPrice})
                </button>
              </div>
            ` : ''}
          </div>
        </div>`;
    }
  }
  
  // Build the full view
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
          
          <!-- Labor Time Section -->
          <div style="background: #f0fdf4; border: 1px solid #86efac; border-radius: 8px; padding: 16px;">
            <h4 style="margin: 0 0 12px 0; color: #166534;">⏱️ Labor Time</h4>
            
            <!-- DB Baseline -->
            <div style="background: white; border-radius: 6px; padding: 12px;">
              <div style="font-size: 0.8rem; color: var(--muted); margin-bottom: 4px;">📊 Cortex Labor Intelligence™ (OEM + Field Data)</div>
              <div style="display: flex; justify-content: space-between; flex-wrap: wrap; gap: 12px;">
                <div><span style="color: var(--muted);">Range:</span> <strong>${op.labor_hours_low || hrs} – ${op.labor_hours_high || hrs} hrs</strong></div>
                <div><span style="color: var(--muted);">Typical:</span> <strong>${hrs} hrs</strong></div>
                <div><span style="color: var(--muted);">Est. Labor:</span> <strong>${(hrs * rate.rate).toFixed(2)}</strong></div>
              </div>
              ${!hasVehicle ? `
                <div style="margin-top: 12px; text-align: center; padding-top: 12px; border-top: 1px solid #86efac;">
                  ${canAdd ? `<button class="btn info" onclick="window.diagAddToInvoice('${esc(op.name)}', ${hrs}, 'operation', '${op.id}')">+ Add to Invoice (${(hrs * rate.rate).toFixed(2)})</button>` : noJobMsg}
                </div>
                <div style="margin-top: 8px; text-align: center; font-size: 0.8rem; color: var(--muted);">
                  💡 Select a vehicle for more accurate estimates
                </div>
              ` : ''}
            </div>
            
            <!-- AI Vehicle-Specific Section -->
            ${aiLaborHtml}
          </div>
          
          <!-- Common Variations -->
          ${!currentIsStaff && op.common_variations?.length ? `
            <h4 style="margin: 20px 0 12px 0;">📋 Common Variations</h4>
            <div style="display: flex; flex-direction: column; gap: 8px; margin-bottom: 20px;">
              ${op.common_variations.map(v => {
                const vHrs = v.hours || v.add_hours || hrs;
                const vEst = vHrs * rate.rate;
                const vName = `${op.name} - ${v.name}`;
                return `<div style="padding: 12px 16px; background: var(--bg); border: 1px solid var(--line); border-radius: 8px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;">
                  <div>
                    <strong>${v.name}</strong>
                    <div style="font-size: 0.85rem; color: var(--muted);">
                      <strong>${vHrs} hrs</strong> × ${rate.rate}/hr = <strong>${vEst.toFixed(2)}</strong>
                      ${v.note ? ` — <span style="font-style: italic;">${v.note}</span>` : ''}
                    </div>
                  </div>
                  ${canAdd ? `<button class="btn small info" onclick="event.stopPropagation(); window.diagAddToInvoice('${esc(vName)}', ${vHrs}, 'operation', '${op.id}')">+ Add ${vEst.toFixed(2)}</button>` : noJobMsg}
                </div>`;
              }).join('')}
            </div>
          ` : ''}
          
          <!-- Procedure Checklist -->
          ${op.checklist_steps?.length ? `
            <h4 style="margin: 20px 0 12px 0;">📝 Procedure Checklist</h4>
            <div style="border: 1px solid var(--line); border-radius: 8px; margin-bottom: 20px;">
              ${op.checklist_steps.map((s, i) => `<div style="padding: 10px 16px; ${i < op.checklist_steps.length - 1 ? 'border-bottom: 1px solid var(--line);' : ''} display: flex; gap: 10px; align-items: center;">
                <span style="width: 20px; height: 20px; border: 2px solid var(--line); border-radius: 4px; flex-shrink: 0;"></span>
                <span>${s.step || s}</span>
              </div>`).join('')}
            </div>
          ` : ''}
          
          <!-- Recommended Add-ons -->
          ${!currentIsStaff && op.recommended_addons?.length ? `
            <h4 style="margin: 20px 0 12px 0;">➕ Recommended Add-ons</h4>
            <div style="display: flex; flex-direction: column; gap: 8px; margin-bottom: 20px;">
              ${op.recommended_addons.map(a => {
                const aHrs = a.labor_hours || 0.5;
                const aEst = aHrs * rate.rate;
                return `<div style="padding: 12px 16px; background: #fef3c7; border: 1px solid #fcd34d; border-radius: 8px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;">
                  <div>
                    <strong>${a.name}</strong>
                    ${a.reason ? ` — <span style="font-size: 0.9rem; color: #92400e;">${a.reason}</span>` : ''}
                    <div style="font-size: 0.85rem; color: var(--muted); margin-top: 2px;">Est: ${aHrs} hr = <strong>${aEst.toFixed(2)}</strong></div>
                  </div>
                  ${canAdd ? `<button class="btn small" style="background: #f59e0b; color: white; border-color: #f59e0b;" onclick="event.stopPropagation(); window.diagAddToInvoice('${esc(a.name)}', ${aHrs}, 'addon', '${op.id}')">+ Add ${aEst.toFixed(2)}</button>` : noJobMsg}
                </div>`;
              }).join('')}
            </div>
          ` : ''}
          
          ${op.notes ? `<div style="background: var(--bg); border-radius: 8px; padding: 12px 16px; margin-bottom: 20px;"><strong>💡 Tech Notes:</strong> ${op.notes}</div>` : ''}
        </div>
        
        <div style="padding: 16px 20px; border-top: 1px solid var(--line); display: flex; gap: 12px; flex-wrap: wrap;">
          <button onclick="window.diagShowFeedback('operation', '${op.id}')" class="btn" style="flex: 1;">📝 Feedback on Labor Time</button>
        </div>
      </div>
    </div>
    <style>@keyframes spin { to { transform: rotate(360deg); } }</style>`;
}

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

// ============================================
// RECORD OUTCOME MODAL
// ============================================
window.diagRecordOutcome = function(type, id) {
  const vehicle = currentVehicle || selectedVehicle;
  const result = currentResult;
  const title = result?.title || result?.name || 'This Issue';
  
  // Create modal overlay
  const overlay = document.createElement('div');
  overlay.id = 'diagOutcomeModal';
  overlay.style.cssText = 'position: fixed; inset: 0; background: rgba(0,0,0,0.5); z-index: 10200; display: flex; align-items: center; justify-content: center;';
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
  
  overlay.innerHTML = `
    <div style="background: var(--card-bg, white); border-radius: 12px; max-width: 500px; width: 95%; max-height: 90vh; overflow-y: auto; box-shadow: 0 20px 50px rgba(0,0,0,0.3);" onclick="event.stopPropagation()">
      <div style="padding: 16px 20px; border-bottom: 1px solid var(--line); display: flex; justify-content: space-between; align-items: center;">
        <h3 style="margin: 0;">✅ Record What Fixed It</h3>
        <button onclick="document.getElementById('diagOutcomeModal').remove()" style="background: none; border: none; font-size: 24px; cursor: pointer; color: var(--muted);">&times;</button>
      </div>
      <div style="padding: 20px;">
        <p style="margin: 0 0 16px 0; color: var(--muted);">What service/repair resolved <strong>${title}</strong>?</p>
        
        <div style="margin-bottom: 16px;">
          <label style="font-weight: 600; display: block; margin-bottom: 8px;">Service/Repair Name *</label>
          <input type="text" id="outcomeServiceName" placeholder="e.g., Replaced Spark Plugs, New Battery" 
            style="width: 100%; padding: 12px; border: 1px solid var(--line); border-radius: 8px; font-size: 14px;">
        </div>
        
        <div style="margin-bottom: 16px;">
          <label style="font-weight: 600; display: block; margin-bottom: 8px;">Did it resolve the issue?</label>
          <div style="display: flex; gap: 12px;">
            <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
              <input type="radio" name="outcomeResolved" value="yes" checked> Yes, fixed it
            </label>
            <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
              <input type="radio" name="outcomeResolved" value="no"> No, issue persists
            </label>
          </div>
        </div>
        
        ${vehicle?.year ? `
          <div style="background: var(--bg); padding: 12px; border-radius: 8px; margin-bottom: 16px;">
            <div style="font-size: 0.85rem; color: var(--muted);">Vehicle</div>
            <div style="font-weight: 600;">${vehicle.year} ${vehicle.make} ${vehicle.model}</div>
          </div>
        ` : ''}
        
        <div style="margin-bottom: 20px;">
          <label style="font-weight: 600; display: block; margin-bottom: 8px;">Notes (optional)</label>
          <textarea id="outcomeNotes" rows="3" placeholder="Any additional details about the fix..." 
            style="width: 100%; padding: 12px; border: 1px solid var(--line); border-radius: 8px; font-size: 14px; resize: vertical;"></textarea>
        </div>
        
        <div style="display: flex; gap: 12px;">
          <button onclick="document.getElementById('diagOutcomeModal').remove()" class="btn" style="flex: 1;">Cancel</button>
          <button onclick="window.diagSubmitOutcome('${type}', '${id}')" class="btn info" style="flex: 1;">✅ Save Outcome</button>
        </div>
      </div>
    </div>
  `;
  
  document.body.appendChild(overlay);
  document.getElementById('outcomeServiceName')?.focus();
};

window.diagSubmitOutcome = async function(type, id) {
  const serviceName = document.getElementById('outcomeServiceName')?.value?.trim();
  const resolved = document.querySelector('input[name="outcomeResolved"]:checked')?.value === 'yes';
  const notes = document.getElementById('outcomeNotes')?.value?.trim() || '';
  
  if (!serviceName) {
    showNotification('Please enter the service/repair name', 'error');
    return;
  }
  
  const vehicle = currentVehicle || selectedVehicle;
  
  try {
    const result = await recordFixOutcome({
      playbookId: type === 'playbook' ? id : null,
      operationId: type === 'operation' ? id : null,
      jobId: currentJob?.id || null,
      serviceName,
      resolved,
      vehicleYear: vehicle?.year ? parseInt(vehicle.year) : null,
      vehicleMake: vehicle?.make || null,
      vehicleModel: vehicle?.model || null,
      mileage: vehicle?.mileage ? parseInt(vehicle.mileage) : null,
      notes
    });
    
    if (result) {
      showNotification('✅ Outcome recorded - thanks for helping improve diagnostics!', 'success');
      document.getElementById('diagOutcomeModal')?.remove();
    } else {
      throw new Error('Failed to save');
    }
  } catch (e) {
    console.error('[DiagnosticsModal] recordFixOutcome error:', e);
    showNotification('Failed to save outcome: ' + e.message, 'error');
  }
};

// ============================================
// FEEDBACK MODAL
// ============================================
window.diagShowFeedback = function(type, id) {
  const result = currentResult;
  const title = result?.title || result?.name || 'This Item';
  const isOperation = type === 'operation';
  
  // Define verdict options based on type
  const verdictOptions = isOperation ? [
    { value: 'worked', label: '✅ Labor time was accurate', color: '#10b981' },
    { value: 'inaccurate_time', label: '⏱️ Labor time was inaccurate', color: '#f59e0b' },
    { value: 'partially_worked', label: '⚠️ Partially accurate', color: '#f59e0b' },
    { value: 'needs_oem', label: '📋 Needs OEM data', color: '#3b82f6' }
  ] : [
    { value: 'worked', label: '✅ Guide was helpful', color: '#10b981' },
    { value: 'partially_worked', label: '⚠️ Partially helpful', color: '#f59e0b' },
    { value: 'did_not_work', label: '❌ Did not help', color: '#ef4444' },
    { value: 'needs_oem', label: '📋 Needs OEM reference', color: '#3b82f6' },
    { value: 'unsafe', label: '🚨 Safety concern', color: '#ef4444' }
  ];
  
  const overlay = document.createElement('div');
  overlay.id = 'diagFeedbackModal';
  overlay.style.cssText = 'position: fixed; inset: 0; background: rgba(0,0,0,0.5); z-index: 10200; display: flex; align-items: center; justify-content: center;';
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
  
  overlay.innerHTML = `
    <div style="background: var(--card-bg, white); border-radius: 12px; max-width: 500px; width: 95%; max-height: 90vh; overflow-y: auto; box-shadow: 0 20px 50px rgba(0,0,0,0.3);" onclick="event.stopPropagation()">
      <div style="padding: 16px 20px; border-bottom: 1px solid var(--line); display: flex; justify-content: space-between; align-items: center;">
        <h3 style="margin: 0;">📝 ${isOperation ? 'Feedback on Labor Time' : 'Give Feedback'}</h3>
        <button onclick="document.getElementById('diagFeedbackModal').remove()" style="background: none; border: none; font-size: 24px; cursor: pointer; color: var(--muted);">&times;</button>
      </div>
      <div style="padding: 20px;">
        <p style="margin: 0 0 16px 0; color: var(--muted);">How was <strong>${title}</strong>?</p>
        
        <div style="margin-bottom: 20px;">
          <label style="font-weight: 600; display: block; margin-bottom: 12px;">Your Rating *</label>
          <div style="display: flex; flex-direction: column; gap: 8px;">
            ${verdictOptions.map((opt, i) => `
              <label style="display: flex; align-items: center; gap: 10px; padding: 12px; border: 2px solid var(--line); border-radius: 8px; cursor: pointer; transition: all 0.2s;" 
                onmouseover="this.style.borderColor='${opt.color}'" onmouseout="this.style.borderColor=document.querySelector('input[name=feedbackVerdict][value=${opt.value}]')?.checked ? '${opt.color}' : 'var(--line)'">
                <input type="radio" name="feedbackVerdict" value="${opt.value}" ${i === 0 ? 'checked' : ''} 
                  onchange="this.closest('label').style.borderColor='${opt.color}'; document.querySelectorAll('input[name=feedbackVerdict]').forEach(r => { if(r!==this) r.closest('label').style.borderColor='var(--line)'; });">
                <span>${opt.label}</span>
              </label>
            `).join('')}
          </div>
        </div>
        
        <div style="margin-bottom: 20px;">
          <label style="font-weight: 600; display: block; margin-bottom: 8px;">Additional Comments (optional)</label>
          <textarea id="feedbackNotes" rows="3" placeholder="${isOperation ? 'What was the actual time? Any issues?' : 'What could be improved?'}" 
            style="width: 100%; padding: 12px; border: 1px solid var(--line); border-radius: 8px; font-size: 14px; resize: vertical;"></textarea>
        </div>
        
        <div style="display: flex; gap: 12px;">
          <button onclick="document.getElementById('diagFeedbackModal').remove()" class="btn" style="flex: 1;">Cancel</button>
          <button onclick="window.diagSubmitFeedback('${type}', '${id}')" class="btn info" style="flex: 1;">📝 Submit Feedback</button>
        </div>
      </div>
    </div>
  `;
  
  document.body.appendChild(overlay);
};

window.diagSubmitFeedback = async function(type, id) {
  const verdict = document.querySelector('input[name="feedbackVerdict"]:checked')?.value;
  const notes = document.getElementById('feedbackNotes')?.value?.trim() || '';
  
  if (!verdict) {
    showNotification('Please select a rating', 'error');
    return;
  }
  
  try {
    const result = await submitFeedback({
      playbookId: type === 'playbook' ? id : null,
      operationId: type === 'operation' ? id : null,
      verdict,
      notes
    });
    
    if (result) {
      showNotification('📝 Feedback submitted - thank you!', 'success');
      document.getElementById('diagFeedbackModal')?.remove();
    } else {
      throw new Error('Failed to save');
    }
  } catch (e) {
    console.error('[DiagnosticsModal] submitFeedback error:', e);
    showNotification('Failed to submit feedback: ' + e.message, 'error');
  }
};

// ============================================
// AI DYNAMIC TRIAGE (Conversational Diagnosis)
// ============================================

/**
 * Start a dynamic AI triage conversation for a playbook
 */
window.diagStartDynamicTriage = async function(playbookId, symptom) {
  const vehicle = currentVehicle || selectedVehicle;
  
  // Check if vehicle is selected
  if (!vehicle?.year || !vehicle?.make || !vehicle?.model) {
    showNotification('Please select a vehicle first for AI-powered diagnosis', 'error');
    return;
  }
  
  // Reset and initialize dynamic triage state
  dynamicTriageState = {
    active: true,
    loading: true,
    conversation: [],
    questionCount: 0,
    currentQuestion: null,
    diagnosis: null,
    error: null,
    playbookId: playbookId,
    symptom: symptom
  };
  
  // Render initial loading state
  renderDynamicTriageUI(playbookId);
  
  // Start the conversation - AI asks first question
  try {
    const response = await getAiDynamicTriage({
      symptom,
      vehicleYear: vehicle.year,
      vehicleMake: vehicle.make,
      vehicleModel: vehicle.model,
      engineType: vehicle.engine || null,
      conversation: [],
      questionCount: 0
    });
    
    dynamicTriageState.loading = false;
    
    if (response.type === 'error') {
      dynamicTriageState.error = response.error;
    } else if (response.type === 'question') {
      dynamicTriageState.currentQuestion = response;
      dynamicTriageState.questionCount = response.questionCount || 1;
      // Add AI's question to conversation
      dynamicTriageState.conversation.push({
        role: 'assistant',
        content: response.question
      });
    } else if (response.type === 'diagnosis') {
      dynamicTriageState.diagnosis = response;
    }
    
    renderDynamicTriageUI(playbookId);
    
  } catch (e) {
    console.error('[DiagnosticsModal] Dynamic triage start error:', e);
    dynamicTriageState.loading = false;
    dynamicTriageState.error = e.message;
    renderDynamicTriageUI(playbookId);
  }
};

/**
 * Handle user's answer to a triage question
 */
window.diagAnswerDynamicTriage = async function(playbookId, answer) {
  const vehicle = currentVehicle || selectedVehicle;
  
  // Add user's answer to conversation
  dynamicTriageState.conversation.push({
    role: 'user',
    content: answer
  });
  
  dynamicTriageState.loading = true;
  dynamicTriageState.currentQuestion = null;
  
  renderDynamicTriageUI(playbookId);
  
  try {
    const response = await getAiDynamicTriage({
      symptom: dynamicTriageState.symptom,
      vehicleYear: vehicle.year,
      vehicleMake: vehicle.make,
      vehicleModel: vehicle.model,
      engineType: vehicle.engine || null,
      conversation: dynamicTriageState.conversation,
      questionCount: dynamicTriageState.questionCount
    });
    
    dynamicTriageState.loading = false;
    
    if (response.type === 'error') {
      dynamicTriageState.error = response.error;
    } else if (response.type === 'question') {
      dynamicTriageState.currentQuestion = response;
      dynamicTriageState.questionCount = response.questionCount || (dynamicTriageState.questionCount + 1);
      // Add AI's question to conversation
      dynamicTriageState.conversation.push({
        role: 'assistant',
        content: response.question
      });
    } else if (response.type === 'diagnosis') {
      dynamicTriageState.diagnosis = response;
    }
    
    renderDynamicTriageUI(playbookId);
    
  } catch (e) {
    console.error('[DiagnosticsModal] Dynamic triage answer error:', e);
    dynamicTriageState.loading = false;
    dynamicTriageState.error = e.message;
    renderDynamicTriageUI(playbookId);
  }
};

/**
 * Render the dynamic triage UI section
 */
function renderDynamicTriageUI(playbookId) {
  const container = document.getElementById('dynamicTriageContainer');
  if (!container) return;
  
  const vehicle = currentVehicle || selectedVehicle;
  const state = dynamicTriageState;
  const rate = getDefaultLaborRate();
  const canAdd = !!currentJob && !currentIsStaff;
  
  // Build conversation history HTML
  let conversationHtml = '';
  if (state.conversation.length > 0) {
    conversationHtml = `
      <div style="margin-bottom: 16px; max-height: 200px; overflow-y: auto;">
        ${state.conversation.map((msg, idx) => {
          const isAi = msg.role === 'assistant';
          return `
            <div style="display: flex; gap: 8px; margin-bottom: 8px; ${isAi ? '' : 'flex-direction: row-reverse;'}">
              <div style="width: 28px; height: 28px; border-radius: 50%; overflow: hidden; display:flex;align-items:center;justify-content:center;flex-shrink:0; background: ${isAi ? 'transparent' : '#e5e7eb'};">
                ${isAi ? `<img src="/assets/cortex-mark.png" alt="Cortex" style="width:28px;height:28px;object-fit:contain;display:block;">` : (shopData && shopData.logo ? `<img src="${shopData.logo}" alt="Shop" style="width:28px;height:28px;object-fit:cover;display:block;">` : '<span style="font-size:12px;">👤</span>')}
              </div>
              <div style="background: ${isAi ? 'var(--bg)' : '#3b82f6'}; color: ${isAi ? 'inherit' : 'white'}; padding: 8px 12px; border-radius: 12px; max-width: 80%; font-size: 0.9rem;">
                ${msg.content}
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }
  
  let html = '';
  
  if (state.loading) {
    // Loading state
    html = `
      ${conversationHtml}
      <div style="display: flex; align-items: center; gap: 12px; padding: 16px; background: var(--bg); border-radius: 8px;">
        <div style="width: 24px; height: 24px; border: 3px solid #8b5cf6; border-top-color: transparent; border-radius: 50%; animation: spin 1s linear infinite;"></div>
        <div>
          <div style="font-weight: 600; color: #6d28d9;">Cortex is thinking...</div>
          <div style="font-size: 0.85rem; color: var(--muted);">Analyzing ${vehicle.year} ${vehicle.make} ${vehicle.model}</div>
        </div>
      </div>
    `;
    
  } else if (state.error) {
    // Error state
    html = `
      ${conversationHtml}
      <div style="background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 16px;">
        <div style="display: flex; align-items: center; gap: 10px;">
          <span style="font-size: 1.5rem;">⚠️</span>
          <div style="flex: 1;">
            <div style="font-weight: 600; color: #991b1b;">Cortex Unavailable</div>
            <div style="font-size: 0.85rem; color: #7f1d1d;">${state.error}</div>
          </div>
          <button onclick="window.diagStartDynamicTriage('${playbookId}', '${state.symptom?.replace(/'/g, "\\'") || ''}')" class="btn small" style="background: #ef4444; color: white;">🔄 Retry</button>
        </div>
      </div>
    `;
    
  } else if (state.currentQuestion) {
    // Question state
    const q = state.currentQuestion;
    html = `
      ${conversationHtml}
      <div style="background: linear-gradient(135deg, #f3e8ff 0%, #e9d5ff 100%); border: 2px solid #a855f7; border-radius: 12px; padding: 16px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
          <span style="font-size: 0.8rem; color: #7c3aed; font-weight: 600;">Question ${state.questionCount} of ~3</span>
          <span style="font-size: 0.75rem; color: #9333ea; background: white; padding: 2px 8px; border-radius: 12px;">
            ${state.questionCount >= 3 ? '🎯 Almost there!' : '🤔 Narrowing down...'}
          </span>
        </div>
        <p style="margin: 0 0 16px 0; font-weight: 600; color: #581c87; font-size: 1.05rem;">${q.question}</p>
        ${q.reasoning ? `<p style="margin: 0 0 12px 0; font-size: 0.85rem; color: #7c3aed; font-style: italic;">💡 ${q.reasoning}</p>` : ''}
        <div style="display: flex; flex-wrap: wrap; gap: 8px;">
          ${(q.options && q.options.length > 0) ? 
            q.options.map(opt => `
              <button onclick="window.diagAnswerDynamicTriage('${playbookId}', '${opt.replace(/'/g, "\\'")}')" 
                class="btn" style="background: white; border: 2px solid #a855f7; color: #7c3aed; padding: 10px 20px; border-radius: 20px; font-weight: 500; transition: all 0.2s;"
                onmouseover="this.style.background='#a855f7';this.style.color='white';" 
                onmouseout="this.style.background='white';this.style.color='#7c3aed';">
                ${opt}
              </button>
            `).join('') :
            `<div style="width: 100%;">
              <input type="text" id="triageCustomAnswer" placeholder="Type your answer..." 
                style="width: 100%; padding: 12px; border: 2px solid #a855f7; border-radius: 8px; font-size: 14px;"
                onkeypress="if(event.key==='Enter') window.diagSubmitCustomAnswer('${playbookId}')">
              <button onclick="window.diagSubmitCustomAnswer('${playbookId}')" class="btn" style="margin-top: 8px; background: #a855f7; color: white;">Submit Answer</button>
            </div>`
          }
        </div>
      </div>
    `;
    
  } else if (state.diagnosis) {
    // Final diagnosis state
    const d = state.diagnosis;
    const confColors = {
      high: { bg: '#dcfce7', text: '#166534', border: '#86efac' },
      medium: { bg: '#fef3c7', text: '#92400e', border: '#fcd34d' },
      low: { bg: '#fee2e2', text: '#991b1b', border: '#fecaca' }
    };
    const conf = confColors[d.confidence] || confColors.medium;
    
    html = `
      ${conversationHtml}
      <div style="background: linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%); border: 2px solid #22c55e; border-radius: 12px; padding: 20px;">
        <div style="display: flex; justify-content: space-between; align-items: start; flex-wrap: wrap; gap: 12px; margin-bottom: 16px;">
          <div>
            <div style="font-size: 0.8rem; color: #16a34a; font-weight: 600; margin-bottom: 4px;">🎯 DIAGNOSIS COMPLETE</div>
            <div style="font-size: 1.3rem; font-weight: 700; color: #166534;">${d.probableCause}</div>
          </div>
          <span style="font-size: 0.8rem; padding: 6px 14px; border-radius: 20px; background: ${conf.bg}; color: ${conf.text}; font-weight: 600; border: 1px solid ${conf.border};">
            ${(d.confidence || 'medium').toUpperCase()} CONFIDENCE
          </span>
        </div>
        
        ${d.explanation ? `<p style="margin: 0 0 16px 0; color: #166534; line-height: 1.5;">${d.explanation}</p>` : ''}
        
        ${d.whatToCheck ? `
          <div style="background: white; border-radius: 8px; padding: 12px; margin-bottom: 16px;">
            <strong style="color: #166534;">🔍 What to Check:</strong>
            <p style="margin: 4px 0 0 0; color: #15803d;">${d.whatToCheck}</p>
          </div>
        ` : ''}
        
        ${d.recommendedService ? `
          <div style="background: white; border-radius: 8px; padding: 12px; margin-bottom: 16px; border-left: 4px solid #22c55e;">
            <strong style="color: #166534;">🛠️ Recommended Service:</strong>
            <div style="font-size: 1.1rem; font-weight: 600; color: #166534; margin-top: 4px;">${d.recommendedService}</div>
            ${d.estimatedRepairComplexity ? `<span style="font-size: 0.8rem; color: #16a34a;">Complexity: ${d.estimatedRepairComplexity}</span>` : ''}
          </div>
        ` : ''}
        
        ${d.additionalPossibilities?.length ? `
          <div style="margin-bottom: 16px;">
            <strong style="color: #166534; font-size: 0.9rem;">Other Possibilities:</strong>
            <ul style="margin: 4px 0 0 0; padding-left: 20px; color: #15803d;">
              ${d.additionalPossibilities.map(p => `<li>${p}</li>`).join('')}
            </ul>
          </div>
        ` : ''}
        
        <!-- TSBs Section -->
        ${(() => {
          const tsbs = d.tsbs || [];
          const validTsbs = tsbs.filter(t => {
            const src = (t.source || t.url || '').toString().toLowerCase();
            const title = (t.title || t.description || '').toString().toLowerCase();
            const num = (t.number || t.id || '').toString().toLowerCase();

            // Require an explicit source/url that looks credible (nhtsa, .gov, manufacturer, or an http(s) link)
            if (src && (src.includes('nhtsa') || src.includes('.gov') || src.includes('service bulletin') || src.includes('technical service bulletin') || /https?:\/\//.test(src))) return true;

            // Fallback: require a plausible TSB number pattern AND a sufficiently descriptive title
            const plausibleNumber = /[a-zA-Z]{1,}|\d{2,}-\d{2,}|tsb[-_\s]?\d{2,}/i.test(num) || (num.length >= 4 && !/^0+$/.test(num));
            const descriptiveTitle = title.split(/\s+/).filter(Boolean).length >= 6;
            return plausibleNumber && descriptiveTitle;
          });

          if (!validTsbs.length) return '';

          return `
            <div style="background: #fef3c7; border-radius: 8px; padding: 12px; margin-bottom: 12px;">
              <strong style="color: #92400e;">📋 Technical Service Bulletins:</strong>
              ${validTsbs.map(t => `
                <div style="margin-top: 8px; padding: 8px; background: white; border-radius: 6px;">
                  <div style="font-weight: 600; color: #78350f;">${t.number || 'TSB'}: ${t.title || 'Related Bulletin'}</div>
                  ${t.relevance ? `<div style="font-size: 0.85rem; color: #92400e;">${t.relevance}</div>` : ''}
                  ${t.source || t.url ? `<div style="margin-top:6px;font-size:0.85rem;color:#334155;">Source: ${t.url ? `<a href="${t.url}" target="_blank" rel="noopener noreferrer">${t.url}</a>` : `${t.source}`}</div>` : ''}
                </div>
              `).join('')}
            </div>
          `;
        })()}

        <!-- Recalls Section -->
        ${(() => {
          const recalls = d.recalls || [];
          const validRecalls = recalls.filter(r => {
            const src = (r.source || r.url || r.campaign || r.description || '').toString().toLowerCase();
            if (!src) return false;
            // Require explicit campaign number or credible URL/domain
            if ((r.campaign && r.campaign.toString().trim().length > 2) || /https?:\/\//.test(r.url || '')) return true;
            if (src.includes('nhtsa') || src.includes('.gov') || src.includes('recall')) return true;
            return false;
          });

          if (!validRecalls.length) return '';

          return `
            <div style="background: #fee2e2; border-radius: 8px; padding: 12px; margin-bottom: 12px;">
              <strong style="color: #991b1b;">⚠️ Recalls:</strong>
              ${validRecalls.map(r => `
                <div style="margin-top: 8px; padding: 8px; background: white; border-radius: 6px;">
                  <div style="font-weight: 600; color: #7f1d1d;">${r.campaign || 'Campaign'}: ${r.description || 'Related Recall'}</div>
                  ${r.relevance ? `<div style="font-size: 0.85rem; color: #991b1b;">${r.relevance}</div>` : ''}
                  ${r.url ? `<div style="margin-top:6px;font-size:0.85rem;color:#334155;">Source: <a href="${r.url}" target="_blank" rel="noopener noreferrer">${r.url}</a></div>` : ''}
                </div>
              `).join('')}
            </div>
          `;
        })()}
        
        <!-- Known Issues Section -->
        ${d.knownIssues?.length ? `
          <div style="background: #e0f2fe; border-radius: 8px; padding: 12px; margin-bottom: 12px;">
            <strong style="color: #0369a1;">💡 Known Issues for This Vehicle:</strong>
            ${d.knownIssues.map(k => `
              <div style="margin-top: 8px; padding: 8px; background: white; border-radius: 6px;">
                <div style="color: #0c4a6e;">${k.description}</div>
                ${k.frequency ? `<span style="font-size: 0.75rem; padding: 2px 8px; background: #bae6fd; color: #0369a1; border-radius: 10px;">${k.frequency}</span>` : ''}
              </div>
            `).join('')}
          </div>
        ` : ''}
        
        <!-- Safety Warnings -->
        ${d.warningsSafety?.length ? `
          <div style="background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 12px; margin-bottom: 12px;">
            <strong style="color: #991b1b;">🚨 Safety Warnings:</strong>
            <ul style="margin: 4px 0 0 0; padding-left: 20px; color: #991b1b;">
              ${d.warningsSafety.map(w => `<li>${w}</li>`).join('')}
            </ul>
          </div>
        ` : ''}
        
        <!-- Actions -->
        <div style="display: flex; gap: 12px; flex-wrap: wrap; margin-top: 16px; padding-top: 16px; border-top: 1px solid #86efac;">
          ${canAdd && d.recommendedService ? `
            <button onclick="window.diagAddToInvoice('${d.recommendedService.replace(/'/g, "\\'") || ''}', 1, 'ai-diagnosis', '${playbookId}')" 
              class="btn" style="background: #22c55e; color: white; border-color: #22c55e; flex: 1;">
              + Add "${d.recommendedService}" to Invoice
            </button>
          ` : ''}
          <button onclick="window.diagStartDynamicTriage('${playbookId}', '${state.symptom?.replace(/'/g, "\\'") || ''}')" 
            class="btn small" style="border-color: #22c55e; color: #22c55e;">
            🔄 Start Over
          </button>
        </div>
      </div>
    `;
  } else {
    // Initial state - show start button
    html = `
      <div style="background: linear-gradient(135deg, #f3e8ff 0%, #e9d5ff 100%); border: 2px solid #a855f7; border-radius: 12px; padding: 20px; text-align: center;">
        <div style="margin-bottom: 12px;"><img src="/assets/cortex-mark.png" alt="Cortex" style="width:40px;height:40px;object-fit:contain;display:block;margin:0 auto;"></div>
        <h4 style="margin: 0 0 8px 0; color: #6d28d9;">Cortex-Powered Diagnosis</h4>
        <p style="margin: 0 0 16px 0; color: #7c3aed; font-size: 0.9rem;">
          Cortex will ask 3-5 smart questions to pinpoint the issue, then provide TSBs, recalls, and recommendations.
        </p>
        <button onclick="window.diagStartDynamicTriage('${playbookId}', '${state.symptom?.replace(/'/g, "\\'") || ''}')" 
          class="btn" style="background: linear-gradient(135deg, #8b5cf6, #6d28d9); color: white; border: none; padding: 12px 32px; font-size: 1rem;">
          🚀 Start Cortex Diagnosis
        </button>
      </div>
    `;
  }
  
  container.innerHTML = html;
}

/**
 * Submit custom text answer for triage
 */
window.diagSubmitCustomAnswer = function(playbookId) {
  const input = document.getElementById('triageCustomAnswer');
  const answer = input?.value?.trim();
  if (!answer) {
    showNotification('Please enter an answer', 'error');
    return;
  }
  window.diagAnswerDynamicTriage(playbookId, answer);
};

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
