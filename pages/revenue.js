// pages/revenue.js
// Revenue page logic: weekly overview, staff earnings, job assignments

import { getSupabaseClient } from '../helpers/supabase.js';

// Utility: format currency
function formatCurrency(val) {
  return `$${(val || 0).toFixed(2)}`;
}

// Utility: get start/end of week for a given date
function getWeekRange(date = new Date()) {
  const d = new Date(date);
  const day = d.getDay();
  const diffToMonday = d.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(d.setDate(diffToMonday));
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return { start: monday, end: sunday };
}

// Render week selector
function renderWeekSelector(currentWeek, onChange) {
  const el = document.getElementById('week-selector');
  if (!el) return;
  el.innerHTML = '';
  const prevBtn = document.createElement('button');
  prevBtn.textContent = '← Previous Week';
  prevBtn.className = 'btn';
  prevBtn.onclick = () => onChange(-1);
  const nextBtn = document.createElement('button');
  nextBtn.textContent = 'Next Week →';
  nextBtn.className = 'btn';
  nextBtn.onclick = () => onChange(1);
  const weekLabel = document.createElement('span');
  weekLabel.style.margin = '0 16px';
  weekLabel.textContent = `${currentWeek.start.toLocaleDateString()} - ${currentWeek.end.toLocaleDateString()}`;
  el.appendChild(prevBtn);
  el.appendChild(weekLabel);
  el.appendChild(nextBtn);
}

// Main page logic
async function setupRevenuePage() {
  const supabase = getSupabaseClient();
  let currentDate = new Date();
  let currentWeek = getWeekRange(currentDate);

  function updateWeek(offset) {
    currentDate.setDate(currentDate.getDate() + offset * 7);
    currentWeek = getWeekRange(currentDate);
    renderWeekSelector(currentWeek, updateWeek);
    loadRevenueData();
  }

  renderWeekSelector(currentWeek, updateWeek);
  await loadRevenueData();


  async function loadRevenueData() {
        // Fetch all customers for the current shop
        let customersArr = [];
        try {
          const { data: customers, error: custErr } = await supabase
            .from('customers')
            .select('*')
            .eq('shop_id', shopId);
          if (!custErr) customersArr = customers || [];
        } catch (e) {
          customersArr = [];
        }
    // Show loading indicators
    document.getElementById('revenue-totals').innerHTML = '<div>Loading...</div>';
    document.getElementById('staff-list').innerHTML = '';
    document.getElementById('job-list').innerHTML = '';

    // Get current shopId from localStorage/session
    let shopId = null;
    try {
      const session = JSON.parse(localStorage.getItem('xm_session') || '{}');
      shopId = session.shopId || null;
    } catch (e) {
      shopId = null;
    }
    if (!shopId) {
      document.getElementById('staff-list').innerHTML = '<div>Could not determine current shop.</div>';
      return;
    }

    // Fetch all staff for the current shop
    let staffList = [];
    try {
      const { data: staff, error } = await supabase
        .from('shop_staff')
        .select('*')
        .eq('shop_id', shopId);
      if (error) {
        document.getElementById('staff-list').innerHTML = `<div>Error loading staff: ${error.message}</div>`;
        return;
      }
      staffList = staff || [];
    } catch (ex) {
      document.getElementById('staff-list').innerHTML = `<div>Error loading staff: ${ex.message}</div>`;
      return;
    }

    // Render staff list
    if (staffList.length === 0) {
      document.getElementById('staff-list').innerHTML = '<div>No staff found for this shop.</div>';
    } else {
      const staffHtml = staffList.map((s, idx) => `
        <div class="staff-panel" style="padding:12px 16px; border-bottom:1px solid #eee; display:flex; align-items:center;">
          <div style="flex:1;">
            <div style="font-weight:bold; font-size:1.1em;">${s.first_name || ''} ${s.last_name || ''}</div>
            <div style="color:#555;">${s.email || ''}</div>
          </div>
          <div style="flex:1;display:flex;align-items:center;justify-content:space-between;">
            <div>
              <div style="margin-bottom:6px;"><span style="margin-right:8px;">Role: <strong>${s.role || 'staff'}</strong></span></div>
              <div>Hourly Rate: <strong>${s.hourly_rate ? formatCurrency(s.hourly_rate) : 'N/A'}</strong></div>
            </div>
            <div style="text-align:right;min-width:160px;">
              <div style="font-size:0.95em;">Hours (week): <strong data-staff-hours="${s.id}">...</strong></div>
              <div style="font-size:0.95em;margin-top:6px;">Earned (week): <strong data-staff-earned="${s.id}">...</strong></div>
            </div>
          </div>
        </div>
      `).join('');
      document.getElementById('staff-list').innerHTML = `<div style="border:1px solid #ddd; border-radius:8px; overflow:hidden; background:#fafbfc;">${staffHtml}</div>`;
      // Attach click handlers to staff panels to show weekly jobs for that staff
      Array.from(document.querySelectorAll('.staff-panel')).forEach(panel => {
        panel.style.cursor = 'pointer';
        panel.addEventListener('click', async (e) => {
          // Find staff id from panel content by matching the name/email rendered
          const nameEl = panel.querySelector('div[style*="font-weight:bold"]');
          const emailEl = panel.querySelector('div[style*="color:#555"]');
          let staffObj = null;
          if (nameEl && emailEl) {
            const nameText = nameEl.textContent.trim();
            const emailText = emailEl.textContent.trim();
            staffObj = staffList.find(s => `${(s.first_name||'')} ${(s.last_name||'')}`.trim() === nameText || (s.email || '') === emailText) || null;
          }
          // Fallback: try to locate by data attribute inside strong elems
          if (!staffObj) {
            const strong = panel.querySelector('strong');
            const maybe = strong ? strong.getAttribute('data-staff-hours') : null;
            if (maybe) staffObj = staffList.find(s => s.id === maybe || s.auth_id === maybe) || null;
          }
          if (!staffObj) return;

          // Collect jobs assigned to this staff in the current filtered week
          const staffJobs = (jobListFiltered || []).filter(j => (j.assigned_to === staffObj.id) || (j.assigned_to === staffObj.auth_id) || (j.assigned === staffObj.id) || (j.assigned === staffObj.auth_id));
          console.debug('[revenue] staff click', { staffId: staffObj.id, auth_id: staffObj.auth_id, staffJobsCount: staffJobs.length, jobListFilteredCount: (jobListFiltered || []).length });

          // Helper: normalize a raw date string to ISO yyyy-mm-dd
          function isoFromRaw(raw) {
            if (!raw) return null;
            if (typeof raw === 'string') {
              // ISO-like YYYY-MM-DD
              if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0,10);
              // US-style MM/DD/YYYY or M/D/YYYY
              const m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
              if (m) {
                const month = parseInt(m[1],10);
                const day = parseInt(m[2],10);
                const year = parseInt(m[3],10);
                const dt = new Date(year, month-1, day);
                return isNaN(dt.getTime()) ? null : dt.toISOString().slice(0,10);
              }
              // Other readable strings - try Date constructor
              let d = new Date(raw);
              if (!isNaN(d.getTime())) return d.toISOString().slice(0,10);
            } else {
              const d = new Date(raw);
              if (!isNaN(d.getTime())) return d.toISOString().slice(0,10);
            }
            return null;
          }

          // Build job details (invoice totals, scheduled/created date) and attach isoDate
          const jobsWithDetails = staffJobs.map(j => {
            const appt = appointments.find(a => a.id === j.appointment_id) || {};
            const inv = invoices.find(ii => (ii.job_id && ii.job_id === j.id) || (ii.appointment_id && ii.appointment_id === j.appointment_id)) || null;
            const items = inv ? (inv.items || []) : [];
            const totalRevenue = items.reduce((s, it) => s + ((Number(it.qty||0) * Number(it.price||0))||0), 0);
            const partsCost = items.reduce((s, it) => s + ((Number(it.qty||0) * Number(it.cost_price || it.cost || 0))||0), 0);
            const dateRaw = appt?.preferred_date || appt?.preferred_time || j.created_at || j.updated_at || null;
            const isoDate = isoFromRaw(dateRaw) || (j.created_at ? isoFromRaw(j.created_at) : null) || 'unknown';
            const display = (function(d) { if (!d || d === 'unknown') return 'Unknown'; try { return new Date(d + 'T00:00:00').toLocaleDateString(undefined,{month:'short',day:'numeric'}); } catch(e) { return d; } })(isoDate);
            return { job: j, appt, inv, totalRevenue, partsCost, isoDate, display };
          });

          // Build the 7-day week array based on currentWeek (Mon-Sun)
          const weekStart = new Date(currentWeek.start); weekStart.setHours(0,0,0,0);
          const days = [];
          for (let i=0;i<7;i++) {
            const d = new Date(weekStart);
            d.setDate(weekStart.getDate() + i);
            const iso = d.toISOString().slice(0,10);
            days.push({ iso, label: d.toLocaleDateString(undefined,{month:'short',day:'numeric'}), date: d });
          }

          // Group jobs by iso date (normalize dates to YYYY-MM-DD), ensure every day exists
          const grouped = {};
          days.forEach(dd => grouped[dd.iso] = []);
          jobsWithDetails.forEach(jd => {
            let key = 'unknown';
            if (jd && jd.isoDate && jd.isoDate !== 'unknown') {
              try {
                // Normalize by constructing a Date and taking the ISO date portion
                const d = new Date(jd.isoDate);
                if (!isNaN(d.getTime())) {
                  key = d.toISOString().slice(0,10);
                } else if (typeof jd.isoDate === 'string' && jd.isoDate.length >= 10) {
                  key = jd.isoDate.slice(0,10);
                }
              } catch (e) {
                if (typeof jd.isoDate === 'string' && jd.isoDate.length >= 10) key = jd.isoDate.slice(0,10);
              }
            }
            if (!grouped[key]) grouped[key] = [];
            grouped[key].push(jd);
          });

          // Debugging: log jobsWithDetails, days and grouped keys/counts
          try {
            console.debug('[revenue][staff-modal] jobsWithDetails', jobsWithDetails);
            console.debug('[revenue][staff-modal] days', days.map(d=>d.iso));
            const groupedSummary = Object.keys(grouped).reduce((acc,k)=>{acc[k]=grouped[k].length;return acc},{ });
            console.debug('[revenue][staff-modal] groupedSummary', groupedSummary);
          } catch(e) { /* ignore logging errors */ }

          // Render modal
          const existing = document.getElementById('staff-week-modal');
          if (existing) existing.remove();
          const modal = document.createElement('div');
          modal.id = 'staff-week-modal';
          modal.className = 'modal-overlay';
          modal.style.zIndex = 1300;
          modal.innerHTML = `
            <div class="modal-content card" style="max-width:640px;margin:8vh auto;padding:12px;">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
                <h3 style="margin:0;">${staffObj.first_name || ''} ${staffObj.last_name || ''} — Jobs This Week</h3>
                <button class="btn small" id="closeStaffWeek">Close</button>
              </div>
              <div id="staff-week-body" style="max-height:56vh;overflow:auto;"></div>
            </div>`;
          document.body.appendChild(modal);
          document.getElementById('closeStaffWeek').onclick = () => modal.remove();

          const body = document.getElementById('staff-week-body');
          // Build rows for the whole week (Mon-Sun) mirroring the dashboard 'Last 7 days' flow
          const rowsHtml = days.map(d => {
            const entries = grouped[d.iso] || [];
            const dayTotal = entries.reduce((s, e) => s + (e.totalRevenue || 0), 0);
            return `
              <div class="staff-week-row" style="padding:12px 0;border-bottom:1px solid #eee;display:flex;justify-content:space-between;align-items:center;">
                <div style="display:flex;align-items:center;gap:12px;"><div style="font-weight:600;">${d.label}</div><div style="width:28px;height:28px;border-radius:14px;background:#f1f3f5;display:flex;align-items:center;justify-content:center;font-size:0.9em;">${entries.length}</div></div>
                <div style="display:flex;align-items:center;gap:12px;"><div style="font-weight:600;">${formatCurrency(dayTotal)}</div><button class="btn small staff-expand" data-date="${d.iso}">Expand</button></div>
              </div>`;
          }).join('');
          body.innerHTML = rowsHtml + '<div style="height:8px"></div>';

          // Attach expand handlers similar to dashboard's rev-day-toggle behavior
          try {
            const toggles = body.querySelectorAll('.staff-expand');
            toggles.forEach(t => {
              t.addEventListener('click', (ev) => {
                const iso = t.getAttribute('data-date');
                const row = t.closest('.staff-week-row');
                if (!row) return;

                // If details container exists, toggle collapse
                let detailsEl = row.querySelector('.staff-day-details');
                const isOpen = detailsEl && detailsEl.classList.contains('open');
                // Close any other open details
                const open = document.querySelector('#staff-week-body .staff-day-details.open');
                if (open && open !== detailsEl) {
                  open.classList.remove('open');
                  open.style.maxHeight = '0';
                  open.style.opacity = '0';
                }

                if (isOpen) {
                  detailsEl.classList.remove('open');
                  detailsEl.style.maxHeight = '0';
                  detailsEl.style.opacity = '0';
                  t.textContent = 'Expand';
                  return;
                }

                // Build details element if missing
                if (!detailsEl) {
                  detailsEl = document.createElement('div');
                  detailsEl.className = 'staff-day-details';
                  detailsEl.style.overflow = 'hidden';
                  detailsEl.style.maxHeight = '0';
                  detailsEl.style.opacity = '0';
                  detailsEl.style.transition = 'max-height 260ms ease, opacity 200ms ease';
                  row.appendChild(detailsEl);
                }

                const entries = grouped[iso] || [];
                if (!entries.length) {
                  detailsEl.innerHTML = '<div class="notice" style="padding:8px 12px">No jobs for this day.</div>';
                } else {
                  const jobsHtml = entries.map(en => `
                    <div style="padding:8px 12px;border-top:1px dashed #eee;display:flex;justify-content:space-between;align-items:center;">
                      <div style="max-width:360px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${(en.appt?.service || en.job.description || en.job.id || '').slice(0,80)}</div>
                      <div style="display:flex;gap:12px;align-items:center;"><div>${formatCurrency(en.totalRevenue)}</div><button class="btn tiny staff-invoice" data-jobid="${en.job.id}">Invoice</button></div>
                    </div>
                  `).join('');
                  detailsEl.innerHTML = jobsHtml;

                  // Attach invoice handlers (open preview with job & staff context)
                  detailsEl.querySelectorAll('button.staff-invoice').forEach(b => {
                    b.addEventListener('click', async () => {
                      const jid = b.getAttribute('data-jobid');
                      const jobObjLocal = jobListFiltered.find(j => j.id === jid) || jobList.find(j => j.id === jid) || null;
                      const invLocal = invoices.find(ii => (ii.job_id && ii.job_id === jid) || (ii.appointment_id && ii.appointment_id === jid));
                      if (!invLocal) {
                        try {
                          const { data } = await supabase.from('data').select('invoices').eq('shop_id', shopId).single();
                          const invs = data?.invoices || [];
                          const found = invs.find(ii => (ii.job_id && ii.job_id === jid) || (ii.appointment_id && ii.appointment_id === jid));
                          await showInvoicePreview(found || null, jobObjLocal, shopId, staffList);
                        } catch (e) { await showInvoicePreview(null, jobObjLocal, shopId, staffList); }
                      } else {
                        await showInvoicePreview(invLocal || null, jobObjLocal, shopId, staffList);
                      }
                    });
                  });
                }

                // Open animation
                requestAnimationFrame(() => {
                  detailsEl.classList.add('open');
                  t.textContent = 'Collapse';
                  detailsEl.style.maxHeight = (detailsEl.scrollHeight) + 'px';
                  detailsEl.style.opacity = '1';
                });
              });
            });
          } catch (err) {
            console.warn('Failed to wire staff week toggles', err);
          }
        });
      });
    }

    // Fetch jobs from the 'data' table for this shop
      let jobList = [];
    try {
      const { data, error } = await supabase
        .from('data')
        .select('jobs')
        .eq('shop_id', shopId)
        .single();
      if (error && error.code !== 'PGRST116') {
        document.getElementById('job-list').innerHTML = `<div>Error loading jobs: ${error.message}</div>`;
        return;
      }
      jobList = data?.jobs || [];
    } catch (ex) {
      document.getElementById('job-list').innerHTML = `<div>Error loading jobs: ${ex.message}</div>`;
      return;
    }

      // Fetch appointments for the shop (used to show scheduled date/service)
      let appointments = [];
      try {
        const { data: aData, error: aErr } = await supabase
          .from('data')
          .select('appointments')
          .eq('shop_id', shopId)
          .single();
        if (!aErr) appointments = aData?.appointments || [];
      } catch (e) {
        // ignore - appointments optional
        appointments = [];
      }

      // Fetch users (for assigned_to lookup)
      let users = [];
      try {
        const { data: uData, error: uErr } = await supabase
          .from('users')
          .select('*')
          .eq('shop_id', shopId);
        if (!uErr) users = uData || [];
      } catch (e) {
        users = [];
      }

    // Fetch invoices (from data.invoices) to compute revenue breakdown per job
    let invoices = [];
    try {
      const { data: invData, error: invErr } = await supabase
        .from('data')
        .select('invoices')
        .eq('shop_id', shopId)
        .single();
      if (!invErr) invoices = invData?.invoices || [];
    } catch (e) {
      invoices = [];
    }

    // Diagnostic: check for a specific invoice id the user reported as missing
    try {
      const DIAG_INV_ID = '6b8bc77d-c354-4ec9-a891-3aa877976410';
      const targetInv = (invoices || []).find(ii => ii && ii.id === DIAG_INV_ID);
      if (!targetInv) {
        console.debug('[revenue][diag] target invoice NOT present in invoices[]:', DIAG_INV_ID);
      } else {
        console.debug('[revenue][diag] target invoice FOUND in invoices[]:', DIAG_INV_ID, targetInv);
        // report linked job/appointment and any related job record
        if (targetInv.job_id) console.debug('[revenue][diag] invoice.job_id ->', targetInv.job_id);
        if (targetInv.appointment_id) console.debug('[revenue][diag] invoice.appointment_id ->', targetInv.appointment_id);
        const linkedJob = (jobList || []).find(jj => jj.id === targetInv.job_id);
        const linkedAppt = (appointments || []).find(a => a.id === targetInv.appointment_id);
        console.debug('[revenue][diag] linkedJob ->', linkedJob || '[none]');
        console.debug('[revenue][diag] linkedAppt ->', linkedAppt || '[none]');
      }
    } catch (diagErr) {
      console.debug('[revenue][diag] diagnostic error', diagErr && diagErr.message);
    }

    // Filter jobs to the selected week using appointment date or job created_at
    const weekStart = new Date(currentWeek.start);
    weekStart.setHours(0,0,0,0);
    const weekEnd = new Date(currentWeek.end);
    weekEnd.setHours(23,59,59,999);
    let jobListFiltered = jobList.filter(j => {
      const appt = appointments.find(a => a.id === j.appointment_id) || {};
      const inv = invoices.find(ii => (ii.job_id && ii.job_id === j.id) || (ii.appointment_id && ii.appointment_id === j.appointment_id)) || null;

      // Collect candidate date fields from appointment and invoice to determine week membership.
      // NOTE: we intentionally avoid using last-updated timestamps (job.updated_at or appt.updated_at)
      // because they can reflect recent status changes and cause the same job to appear in multiple weeks.
      const candidateDates = [];
      if (appt.preferred_date) candidateDates.push(appt.preferred_date);
      if (appt.preferred_time) candidateDates.push(appt.preferred_time);
      if (j.created_at) candidateDates.push(j.created_at);
      if (inv) {
        if (inv.paid_date) candidateDates.push(inv.paid_date);
        // include created_at/updated_at for invoices as a secondary source (invoice creation/payment timestamps)
        if (inv.created_at) candidateDates.push(inv.created_at);
        if (inv.updated_at) candidateDates.push(inv.updated_at);
      }

      for (const rawDate of candidateDates) {
        if (!rawDate) continue;
        const d = new Date(rawDate);
        if (isNaN(d.getTime())) continue;
        if (d >= weekStart && d <= weekEnd) return true;
      }
      return false;
    });

    // Include invoice-only entries (invoices linked to appointments but without a job)
    try {
      const invoiceDerived = (invoices || [])
        .filter(inv => inv && inv.appointment_id && !inv.job_id)
        .filter(inv => {
          const appt = appointments.find(a => a.id === inv.appointment_id) || {};
          const candidates = [appt.preferred_date, appt.preferred_time, inv.paid_date, inv.created_at, inv.due].filter(Boolean);
          for (const raw of candidates) {
            const d = new Date(raw);
            if (!isNaN(d.getTime()) && d >= weekStart && d <= weekEnd) return true;
          }
          return false;
        })
        .map(inv => {
          const appt = appointments.find(a => a.id === inv.appointment_id) || {};
          return {
            id: inv.id,
            appointment_id: inv.appointment_id,
            created_at: inv.created_at || inv.due || inv.paid_date || new Date().toISOString(),
            description: inv.customer || ((inv.customer_first || '') + ' ' + (inv.customer_last || '')).trim() || ('Invoice ' + (inv.number || inv.id)),
            status: inv.status || 'paid',
            _isInvoiceDerived: true
          };
        });
      if (invoiceDerived.length) {
        // Remove any derived entries that would duplicate existing jobs (same appointment_id or id)
        const deduped = invoiceDerived.filter(inv => {
          // if a real job already exists for this appointment, skip derived invoice
          const hasJob = (jobListFiltered || []).some(j => j && j.appointment_id && j.appointment_id === inv.appointment_id);
          const hasId = (jobListFiltered || []).some(j => j && j.id && j.id === inv.id);
          return !hasJob && !hasId;
        });
        if (deduped.length) {
          console.debug('[revenue] invoice-derived entries added for week (deduped):', deduped.map(i => i.id));
          jobListFiltered = jobListFiltered.concat(deduped);
        } else {
          console.debug('[revenue] invoice-derived entries skipped (duplicates)');
        }
      }
    } catch (e) {
      console.debug('[revenue] invoice-derived error', e && e.message);
    }

    // Debug helper: directly query Supabase from the browser to check job_labor rows
    async function checkJobLaborDirectSamples() {
      try {
        const supabaseClient = getSupabaseClient();
        if (!supabaseClient) { console.debug('[revenue][direct] no supabase client available'); return; }
        const sample = jobListFiltered.slice(0, 3);
        for (const j of sample) {
          try {
            const { data: jl, error: jlErr } = await supabaseClient.from('job_labor').select('*').eq('job_id', j.id);
            console.debug('[revenue][direct] job_labor query', j.id, 'rows:', Array.isArray(jl) ? jl.length : 0, 'error:', jlErr || null, jl || null);
          } catch (e) {
            console.debug('[revenue][direct] query error', j.id, e && e.message);
          }
        }
      } catch (e) {
        console.debug('[revenue][direct] helper error', e && e.message);
      }
    }

    // Run direct checks (non-blocking)
    checkJobLaborDirectSamples();

    // Render jobs panel
    if (jobListFiltered.length === 0) {
      document.getElementById('job-list').innerHTML = '<div>No jobs scheduled for this week.</div>';
    } else {
      const jobHtml = jobListFiltered.map(j => {
        // Determine assigned user/staff name
        let staffName = 'Unassigned';
        if (j.assigned_to) {
          const usr = users.find(u => u.id === j.assigned_to);
          if (usr) staffName = `${usr.first || usr.first_name || ''} ${usr.last || usr.last_name || ''}`.trim();
          else {
            const staff = staffList.find(s => String(s.id) === String(j.assigned_to) || s.auth_id === j.assigned_to);
            if (staff) staffName = `${staff.first_name || ''} ${staff.last_name || ''}`.trim();
          }
        }

        // Get scheduled date from appointment if available, else fallback to created_at
        const appt = appointments.find(a => a.id === j.appointment_id);
        const rawDate = appt?.preferred_date || appt?.preferred_time || j.created_at || j.updated_at || null;
        const schedDate = rawDate ? new Date(rawDate).toLocaleDateString() : 'N/A';


        // Match jobs page logic for customer name
        let jobName = '';
        if (appt && appt.customer) {
          jobName = appt.customer;
        } else if (j.customer) {
          jobName = j.customer;
        }
        if (!jobName) {
          jobName = j.description || j.name || '';
        }
        if (!jobName) {
          const shortId = (j.id || '').slice(-6).toUpperCase();
          jobName = `Job #${shortId}`;
        }

        // Revenue breakdown (try to find invoice for this job)
        const inv = invoices.find(ii => (ii.job_id && ii.job_id === j.id) || (ii.appointment_id && ii.appointment_id === j.appointment_id));
        let totalRevenue = null;
        let partsCost = null;
        let staffRevenue = null;
        if (inv) {
          const items = inv.items || [];
          totalRevenue = items.reduce((sum, it) => sum + ((Number(it.qty || 0) * Number(it.price || 0)) || 0), 0);
          partsCost = items.reduce((sum, it) => sum + ((Number(it.qty || 0) * Number(it.cost_price || it.cost || 0)) || 0), 0);
          // Staff revenue: items without cost_price assumed to be labor/services
          staffRevenue = items.reduce((sum, it) => {
            const cost = Number(it.cost_price || it.cost || 0);
            const sell = Number(it.price || 0) * Number(it.qty || 0);
            return sum + (cost > 0 ? 0 : sell);
          }, 0);
        }

        // Render placeholders for revenue values; they'll be updated after fetching job labor
        return `
          <div class="job-panel" style="padding:12px 16px; border-bottom:1px solid #eee; display:flex; align-items:center; cursor:pointer;" data-job-id="${j.id}">
            <div style="flex:2;">
              <div style="font-weight:bold; font-size:1.1em;">${jobName}</div>
              <div style="color:#555;">Scheduled: ${schedDate}</div>
            </div>
            <div style="flex:2;">
              <span style="margin-right:16px;">Staff: <strong>${staffName}</strong></span>
              <span style="margin-right:16px;">Status: <strong>${j.status || 'N/A'}</strong></span>
              <div style="display:grid;grid-template-columns:repeat(2,1fr);grid-template-rows:repeat(2,auto);gap:4px 12px;align-items:center;">
                <div style="font-size:0.95em;">Total Revenue:</div>
                <strong data-total="${j.id}" style="font-size:0.95em;">...</strong>
                <div style="font-size:0.95em;">Parts Cost:</div>
                <strong data-parts="${j.id}" style="font-size:0.95em;">...</strong>
                <div style="font-size:0.95em;">Staff Revenue:</div>
                <strong data-staff="${j.id}" style="font-size:0.95em;">...</strong>
                <div style="font-size:0.95em;">Net:</div>
                <strong data-net="${j.id}" style="font-size:0.95em;">...</strong>
              </div>
            </div>
          </div>
        `;
      }).join('');
      document.getElementById('job-list').innerHTML = `<div style="border:1px solid #ddd; border-radius:8px; overflow:hidden; background:#fafbfc;">${jobHtml}</div>`;
    }

    // After rendering, fetch job labor for each job to compute staff revenue (staff hourly_rate * total_hours)
    (async function updateJobRevenueFields(){
      const panels = Array.from(document.querySelectorAll('.job-panel'));
      for (const panel of panels) {
        const jobId = panel.getAttribute('data-job-id');
        if (!jobId) continue;

        // Find job object and invoice
        const jobObj = jobListFiltered.find(x => x.id === jobId) || jobList.find(x => x.id === jobId);
        const inv = invoices.find(ii => (ii.job_id && ii.job_id === jobId) || (ii.appointment_id && ii.appointment_id === jobObj?.appointment_id));

        // Compute invoice totals and parts cost from invoice if present
        const items = inv ? (inv.items || []) : [];
        const totalRevenue = items.reduce((s, it) => s + ((Number(it.qty||0) * Number(it.price||0))||0), 0);
        const partsCost = items.reduce((s, it) => s + ((Number(it.qty||0) * Number(it.cost_price || it.cost || 0))||0), 0);

        // Find staff hourly rate
        let staffRate = 0;
        const assigned = jobObj && (jobObj.assigned_to || jobObj.assigned); // handle possible field names
        if (assigned) {
          const staff = staffList.find(s => s.id === assigned || s.auth_id === assigned) || [];
          staffRate = Number(staff.hourly_rate || staff.rate || 0);
        }

        // Fetch job labor entries from server endpoint
        let totalHours = 0;
        let laborFound = false;
        try {
          const res = await fetch(`/api/catalog/job-labor/${encodeURIComponent(jobId)}`);
          if (res && res.ok) {
            const json = await res.json();
            const labor = json.labor || [];
            totalHours = labor.reduce((s, it) => s + (Number(it.hours || it.h || 0)), 0);
            laborFound = labor.length > 0;
          }
        } catch (e) {
          // ignore
        }

        // Fallback: if no job_labor found, try to parse labor from invoice items
        if (!laborFound && items && items.length) {
          items.forEach(it => {
            const desc = (it.description || it.label || it.name || '').toLowerCase();
            const price = Number(it.price || it.unit_price || it.amount || it.total || it.rate || 0);
            const qty = Number(it.qty || it.quantity || it.count || 0);
            const itemType = (it.type || '').toLowerCase();
            // Consider labor if item.type === 'labor' OR description suggests hours, and price > 0
            const isLabor = price > 0 && (itemType === 'labor' || /hr|hour/.test(desc) || /\/\s*hr/i.test(desc) || (qty > 0 && /hour|hr|labor|service/i.test(desc)));
            if (isLabor) {
              let hours = 0;
              const match = desc.match(/(\d+(\.\d+)?)\s*(hr|hour)/);
              if (match) hours = parseFloat(match[1]);
              if (!hours && qty > 0) hours = qty; // qty likely denotes hours in your invoice structure
              totalHours += hours;
              console.debug('[revenue] detected labor item (fallback)', jobId, { price, qty, hours, desc, itemType });
            }
          });
        }

        const staffRevenue = staffRate * totalHours;
        const net = (totalRevenue || 0) - (partsCost || 0) - staffRevenue;

        // Update DOM placeholders
        const totalEl = document.querySelector(`[data-total="${jobId}"]`);
        const partsEl = document.querySelector(`[data-parts="${jobId}"]`);
        const staffEl = document.querySelector(`[data-staff="${jobId}"]`);
        const netEl = document.querySelector(`[data-net="${jobId}"]`);
        if (totalEl) totalEl.textContent = Number.isFinite(totalRevenue) ? formatCurrency(totalRevenue) : 'N/A';
        if (partsEl) partsEl.textContent = Number.isFinite(partsCost) ? formatCurrency(partsCost) : 'N/A';
        if (staffEl) staffEl.textContent = Number.isFinite(staffRevenue) ? formatCurrency(staffRevenue) : 'N/A';
        if (netEl) netEl.textContent = Number.isFinite(net) ? formatCurrency(net) : 'N/A';
      }
    })();

    // Placeholder UI for totals
    // Calculate weekly totals after all job labor fetches complete
    const jobTotalsPromises = jobListFiltered.map(async (j) => {
    const inv = invoices.find(ii => (ii.job_id && ii.job_id === j.id) || (ii.appointment_id && ii.appointment_id === j.appointment_id));
    const items = inv ? (inv.items || []) : [];
    try {
      console.debug('[revenue] job invoice', j.id, 'inv_found:', !!inv, 'items_len:', items.length);
      console.debug('[revenue] job invoice items JSON', j.id, JSON.stringify(items, null, 2));
    } catch (e) { /* ignore stringify errors */ }
      const totalRevenue = items.reduce((s, it) => s + ((Number(it.qty||0) * Number(it.price||0))||0), 0);
      const partsCost = items.reduce((s, it) => s + ((Number(it.qty||0) * Number(it.cost_price || it.cost || 0))||0), 0);
      let staffRate = 0;
      const assigned = j.assigned_to || j.assigned;
      if (assigned) {
        const staff = staffList.find(s => s.id === assigned || s.auth_id === assigned) || [];
        staffRate = Number(staff.hourly_rate || staff.rate || 0);
      }
      let totalHours = 0;
      let laborFound = false;
      try {
        const res = await fetch(`/api/catalog/job-labor/${encodeURIComponent(j.id)}`);
        if (res && res.ok) {
          const json = await res.json();
          const labor = json.labor || [];
          totalHours = labor.reduce((s, it) => s + (Number(it.hours || it.h || 0)), 0);
          laborFound = (labor.length > 0);
          console.debug('[revenue] job-labor', j.id, 'hours:', totalHours, 'entries:', labor.length);
        }
      } catch (e) { /* ignore fetch errors (use invoice fallback) */ }

      // Fallback: parse invoice items for labor if no job_labor rows
      if (!laborFound && items && items.length) {
        function getItemPrice(it) { return Number(it.price || it.unit_price || it.amount || it.total || it.rate || 0); }
        function getItemQty(it) { return Number(it.qty || it.quantity || it.count || 0); }
        let fallbackHours = 0;
        items.forEach(it => {
          const desc = (it.description || it.label || it.name || '').toLowerCase();
          const price = getItemPrice(it);
          const qty = getItemQty(it);
          const itemType = (it.type || '').toLowerCase();
          const isLabor = price > 0 && (itemType === 'labor' || /hr|hour/.test(desc) || /\/\s*hr/i.test(desc) || (qty > 0 && /hour|hr|labor|service/i.test(desc)));
          if (isLabor) {
            let hours = 0;
            const match = desc.match(/(\d+(\.\d+)?)\s*(hr|hour)/);
            if (match) hours = parseFloat(match[1]);
            if (!hours && qty > 0) hours = qty;
            fallbackHours += hours;
            console.debug('[revenue] fallback labor item', j.id, { price, qty, hours, desc, itemType });
          }
        });
        if (fallbackHours > 0) totalHours = fallbackHours;
      }

      const staffCost = staffRate * totalHours;
      return { jobId: j.id, assigned, totalHours, staffCost, totalRevenue, partsCost };
    });
    const jobTotals = await Promise.all(jobTotalsPromises);
    const weekTotalRevenue = jobTotals.reduce((sum, jt) => sum + jt.totalRevenue, 0);
    const weekPartsCost = jobTotals.reduce((sum, jt) => sum + jt.partsCost, 0);
    const weekStaffCost = jobTotals.reduce((sum, jt) => sum + jt.staffCost, 0);
    const weekNetRevenue = weekTotalRevenue - weekPartsCost - weekStaffCost;
    document.getElementById('revenue-totals').innerHTML = `
      <div>Total Revenue: <strong>${formatCurrency(weekTotalRevenue)}</strong></div>
      <div>Parts Cost: <strong>${formatCurrency(weekPartsCost)}</strong></div>
      <div>Total Staff Cost: <strong>${formatCurrency(weekStaffCost)}</strong></div>
      <div>Net Revenue: <strong>${formatCurrency(weekNetRevenue)}</strong></div>
    `;

    // Compute per-staff weekly totals and update staff panel placeholders
    try {
      const staffTotals = {};
      jobTotals.forEach(jt => {
        if (!jt.assigned) return;
        // Find staff record
        const staff = staffList.find(s => s.id === jt.assigned || s.auth_id === jt.assigned);
        const staffKey = staff ? (staff.id || staff.auth_id) : jt.assigned;
        if (!staffTotals[staffKey]) staffTotals[staffKey] = { hours: 0, earned: 0 };
        staffTotals[staffKey].hours += Number(jt.totalHours || 0);
        staffTotals[staffKey].earned += Number(jt.staffCost || 0);
      });

      // Update DOM placeholders for each staff
      staffList.forEach(s => {
        const key = s.id || s.auth_id;
        const totals = staffTotals[key] || { hours: 0, earned: 0 };
        const hoursEl = document.querySelector(`[data-staff-hours="${s.id}"]`);
        const earnedEl = document.querySelector(`[data-staff-earned="${s.id}"]`);
        if (hoursEl) hoursEl.textContent = (totals.hours ? totals.hours.toFixed(2) : '0.00') + ' h';
        if (earnedEl) earnedEl.textContent = totals.earned ? formatCurrency(totals.earned) : formatCurrency(0);
      });
    } catch (e) {
      // ignore aggregation errors
    }
  }
}

document.addEventListener('DOMContentLoaded', setupRevenuePage);

// Invoice preview modal helper
async function showInvoicePreview(inv, jobObj, shopId, staffList = []) {
  // Remove existing preview if present
  const existing = document.getElementById('invoice-preview-modal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'invoice-preview-modal';
  modal.style.position = 'fixed';
  modal.style.left = '50%';
  modal.style.top = '50%';
  modal.style.transform = 'translate(-50%, -50%)';
  modal.style.background = '#fff';
  modal.style.border = '1px solid #ddd';
  modal.style.borderRadius = '8px';
  modal.style.boxShadow = '0 6px 18px rgba(0,0,0,0.12)';
  modal.style.zIndex = 1200;
  modal.style.minWidth = '320px';
  modal.style.maxWidth = '600px';
  modal.style.padding = '12px 16px';

  const closeBtn = document.createElement('button');
  closeBtn.className = 'btn small';
  closeBtn.style.float = 'right';
  closeBtn.textContent = 'Close';
  closeBtn.onclick = () => modal.remove();

  const title = document.createElement('div');
  title.style.marginBottom = '8px';
  title.innerHTML = `<strong>Invoice Preview</strong> ${inv && inv.id ? ' — ' + (inv.id || '').slice(-6).toUpperCase() : ''}`;

  const content = document.createElement('div');
  if (!inv && !jobObj) {
    content.innerHTML = '<div>No invoice found for this job.</div>';
  } else {
    const items = inv ? (inv.items || []) : [];
    const rows = items.map(it => `<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid #f1f1f1;"><div>${it.name || it.description || it.label || 'Item'}</div><div>${formatCurrency((Number(it.qty||0) * Number(it.price||0))||0)}</div></div>`).join('');
    const total = items.reduce((s, it) => s + ((Number(it.qty||0) * Number(it.price||0))||0), 0);
    const partsCost = items.reduce((s, it) => s + ((Number(it.qty||0) * Number(it.cost_price || it.cost || 0))||0), 0);

    // Compute labor for this job (total hours) and staff revenue if possible
    let totalHours = 0;
    try {
      const id = jobObj?.id || (inv && inv.job_id) || null;
      if (id) {
        const res = await fetch(`/api/catalog/job-labor/${encodeURIComponent(id)}`);
        if (res && res.ok) {
          const json = await res.json();
          const labor = json.labor || [];
          totalHours = labor.reduce((s, it) => s + (Number(it.hours || it.h || 0)), 0);
        }
      }
    } catch (e) {
      totalHours = 0;
    }

    // Fallback: if no job_labor rows, try to parse labor from the invoice items (same logic as weekly totals)
    if ((!totalHours || totalHours === 0) && items && items.length) {
      function getItemPrice(it) { return Number(it.price || it.unit_price || it.amount || it.total || it.rate || 0); }
      function getItemQty(it) { return Number(it.qty || it.quantity || it.count || 0); }
      let fallbackHours = 0;
      items.forEach(it => {
        const desc = (it.description || it.label || it.name || '').toLowerCase();
        const price = getItemPrice(it);
        const qty = getItemQty(it);
        const itemType = (it.type || '').toLowerCase();
        const isLabor = price > 0 && (itemType === 'labor' || /hr|hour/.test(desc) || /\/\s*hr/i.test(desc) || (qty > 0 && /hour|hr|labor|service/i.test(desc)));
        if (isLabor) {
          let hours = 0;
          const match = desc.match(/(\d+(\.\d+)?)\s*(hr|hour)/);
          if (match) hours = parseFloat(match[1]);
          if (!hours && qty > 0) hours = qty;
          // If still no hours, assume qty=1 for labor items
          if (!hours) hours = qty || 1;
          fallbackHours += hours;
        }
      });
      if (fallbackHours > 0) totalHours = fallbackHours;
    }

    // Determine staff rate from passed staffList and jobObj assigned field
    let staffRate = 0;
    let assignedLabel = 'Unassigned';
    if (jobObj) {
      const assigned = jobObj.assigned_to || jobObj.assigned;
      if (assigned) {
        const staff = (staffList || []).find(s => s.id === assigned || s.auth_id === assigned || String(s.id) === String(assigned));
        if (staff) {
          staffRate = Number(staff.hourly_rate || staff.rate || 0);
          assignedLabel = `${staff.first_name || ''} ${staff.last_name || ''}`.trim() || assigned;
        } else {
          assignedLabel = assigned;
        }
      }
    }

    const staffRevenue = staffRate * totalHours;
    const net = total - partsCost - staffRevenue;

    content.innerHTML = `
      <div style="max-height:320px;overflow:auto;padding-bottom:8px;">${rows}</div>
      <div style="margin-top:8px;font-weight:bold;display:flex;flex-direction:column;gap:6px;">
        <div style="display:flex;justify-content:space-between;"><div>Total</div><div>${formatCurrency(total)}</div></div>
        <div style="display:flex;justify-content:space-between;"><div>Parts Cost</div><div>${formatCurrency(partsCost)}</div></div>
        <div style="display:flex;justify-content:space-between;"><div>Assigned</div><div>${assignedLabel}</div></div>
        <div style="display:flex;justify-content:space-between;"><div>Labor Hours</div><div>${totalHours.toFixed(2)} h</div></div>
        <div style="display:flex;justify-content:space-between;"><div>Staff Revenue</div><div>${formatCurrency(staffRevenue)}</div></div>
        <div style="display:flex;justify-content:space-between;font-weight:700;border-top:1px solid #eee;padding-top:6px;"><div>Net</div><div>${formatCurrency(net)}</div></div>
      </div>
    `;
  }

  modal.appendChild(closeBtn);
  modal.appendChild(title);
  modal.appendChild(content);
  document.body.appendChild(modal);
}

// Delegate click handler on job panels to open invoice preview
document.addEventListener('click', async (e) => {
  const panel = e.target.closest && e.target.closest('.job-panel');
  if (!panel) return;
  const jobId = panel.getAttribute('data-job-id');
  if (!jobId) return;
  try {
    const supabase = getSupabaseClient();
    const session = JSON.parse(localStorage.getItem('xm_session') || '{}');
    const shopId = session.shopId || null;
    if (!shopId || !supabase) return await showInvoicePreview(null, null, null, []);
    const { data } = await supabase.from('data').select('jobs,appointments,invoices').eq('shop_id', shopId).single();
    const jobs = data?.jobs || [];
    const appointments = data?.appointments || [];
    const invs = data?.invoices || [];
    const jobObj = jobs.find(j => j.id === jobId);
    let appointmentId = jobObj?.appointment_id;
    // fallback: try to get appointment id from job panel if not found
    if (!appointmentId) {
      const appt = appointments.find(a => a.id === jobObj?.appointment_id);
      appointmentId = appt?.id;
    }
    const inv = invs.find(ii => (ii.job_id && ii.job_id === jobId) || (ii.appointment_id && appointmentId && ii.appointment_id === appointmentId));
    // Fetch shop staff so the preview can compute staff hours/revenue
    try {
      const { data: staffData } = await supabase.from('shop_staff').select('*').eq('shop_id', shopId);
      const staffList = staffData || [];
      await showInvoicePreview(inv || null, jobObj, shopId, staffList);
    } catch (e) {
      await showInvoicePreview(inv || null, jobObj, shopId, []);
    }
  } catch (ex) {
    await showInvoicePreview(null, null, null, []);
  }
});
