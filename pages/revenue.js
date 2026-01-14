// ...existing code...
// pages/revenue.js
// Revenue page logic: weekly overview, staff earnings, job assignments


import { getSupabaseClient } from '../helpers/supabase.js';
import { calcInvTotal } from '../helpers/invoices.js';


// Utility: format currency
function formatCurrency(val) {
  return `$${(val || 0).toFixed(2)}`;
}

// Utility: return YYYY-MM-DD string in local timezone (avoid UTC shift from toISOString())
function localIsoDate(input) {
  const d = new Date(input);
  if (isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Parse a date/time string preferring local timezone when the input has no timezone
function parseDatePreferLocal(raw) {
  if (!raw) return null;
  // If it's already a Date, return copy
  if (raw instanceof Date) return new Date(raw.getTime());
  // If contains explicit timezone (Z or +hh:mm), let Date handle it
  if (/[zZ]|[\+\-]\d{2}:?\d{2}$/.test(raw)) {
    const d = new Date(raw);
    return isNaN(d.getTime()) ? null : d;
  }
  // If looks like YYYY-MM-DDTHH:MM:SS (no zone) or YYYY-MM-DD HH:MM:SS, parse components as local
  const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}):(\d{2}))?/);
  if (isoMatch) {
    const y = parseInt(isoMatch[1], 10);
    const m = parseInt(isoMatch[2], 10) - 1;
    const d = parseInt(isoMatch[3], 10);
    const hh = isoMatch[4] ? parseInt(isoMatch[4], 10) : 0;
    const mm = isoMatch[5] ? parseInt(isoMatch[5], 10) : 0;
    const ss = isoMatch[6] ? parseInt(isoMatch[6], 10) : 0;
    const dt = new Date(y, m, d, hh, mm, ss);
    return isNaN(dt.getTime()) ? null : dt;
  }
  // Fallback to Date constructor
  const d = new Date(raw);
  return isNaN(d.getTime()) ? null : d;
}

// Format a Date as local YYYY-MM-DDTHH:MM:SS without timezone suffix
function formatLocalIsoNoZone(d) {
  if (!d) return null;
  const dt = d instanceof Date ? d : new Date(d);
  if (isNaN(dt.getTime())) return null;
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const day = String(dt.getDate()).padStart(2, '0');
  const hh = String(dt.getHours()).padStart(2, '0');
  const mm = String(dt.getMinutes()).padStart(2, '0');
  const ss = String(dt.getSeconds()).padStart(2, '0');
  return `${y}-${m}-${day}T${hh}:${mm}:${ss}`;
}

// Utility: get status class for colored pills
function getStatusClass(status) {
  if (!status) return '';
  const s = status.toLowerCase();
  if (s === 'done') return 'completed';
  return s;
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

// Global variable to store the chart instance
let revenueBreakdownChart = null;

// Render revenue breakdown circle chart
function renderRevenueBreakdownChart(weekTotalRevenue, weekStaffCost, weekPartsCost, weekNetRevenue) {
  const canvas = document.getElementById('revenue-breakdown-chart');
  if (!canvas) return;
  
  const ctx = canvas.getContext('2d');
  
  // Destroy existing chart if it exists
  if (revenueBreakdownChart) {
    revenueBreakdownChart.destroy();
  }
  
  // Calculate percentages for display
  const total = weekTotalRevenue;
  const staffPercent = total > 0 ? ((weekStaffCost / total) * 100).toFixed(1) : 0;
  const partsPercent = total > 0 ? ((weekPartsCost / total) * 100).toFixed(1) : 0;
  const netPercent = total > 0 ? ((weekNetRevenue / total) * 100).toFixed(1) : 0;
  
  revenueBreakdownChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: [
        `Staff Cost (${staffPercent}%)`,
        `Parts Cost (${partsPercent}%)`,
        `Net Revenue (${netPercent}%)`
      ],
      datasets: [{
        data: [weekStaffCost, weekPartsCost, weekNetRevenue],
        backgroundColor: [
          '#FF6384',  // Staff Cost - pink/red
          '#36A2EB',  // Parts Cost - blue
          '#4BC0C0'   // Net Revenue - teal/green
        ],
        borderColor: [
          '#FF6384',
          '#36A2EB',
          '#4BC0C0'
        ],
        borderWidth: 2
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            padding: 15,
            font: {
              size: 12
            }
          }
        },
        title: {
          display: true,
          text: `Total: ${formatCurrency(weekTotalRevenue)}`,
          font: {
            size: 18,
            weight: 'bold'
          },
          padding: {
            top: 10,
            bottom: 20
          }
        },
        tooltip: {
          callbacks: {
            label: function(context) {
              const label = context.label || '';
              const value = formatCurrency(context.parsed);
              return `${label}: ${value}`;
            }
          }
        }
      }
    }
  });
}

// Render weekly days overview boxes with color-coded revenue
function renderWeeklyDaysOverview(currentWeek, invoices, appointments, jobs) {
  const container = document.getElementById('weekly-days-grid');
  if (!container) return;
  
  // Build the 7-day array (Mon-Sun)
  const weekStart = new Date(currentWeek.start);
  weekStart.setHours(0, 0, 0, 0);
  const days = [];
  
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart);
    d.setDate(weekStart.getDate() + i);
    const iso = localIsoDate(d);
    const dayName = d.toLocaleDateString(undefined, { weekday: 'short' });
    const dateStr = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    days.push({ iso, dayName, dateStr, date: d, revenue: 0 });
  }
  
  // Calculate revenue for each day
  days.forEach(day => {
    const dayStart = new Date(day.date);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(day.date);
    dayEnd.setHours(23, 59, 59, 999);
    
    // Find jobs/invoices for this day
    const dayJobs = jobs.filter(j => {
      const appt = appointments.find(a => a.id === j.appointment_id);
      const rawDate = appt?.preferred_date || appt?.preferred_time || j.created_at || j.updated_at;
      if (!rawDate) return false;
      const jDate = parseDatePreferLocal(rawDate);
      return jDate && jDate >= dayStart && jDate <= dayEnd;
    });
    
    // Calculate total revenue for the day
    dayJobs.forEach(j => {
      const inv = invoices.find(ii => 
        (ii.job_id && ii.job_id === j.id) || 
        (ii.appointment_id && ii.appointment_id === j.appointment_id)
      );
      if (inv) {
        day.revenue += calcInvTotal(inv);
      }
    });
  });
  
  // Filter out days with no revenue for color coding
  const daysWithRevenue = days.filter(d => d.revenue > 0);
  
  // Find min and max revenue for color coding (only for days with revenue)
  const revenues = daysWithRevenue.map(d => d.revenue);
  const maxRevenue = revenues.length > 0 ? Math.max(...revenues) : 0;
  const minRevenue = revenues.length > 0 ? Math.min(...revenues) : 0;
  const range = maxRevenue - minRevenue;
  
  // Assign color class based on revenue
  days.forEach(day => {
    // Days with no revenue get no color class (will use default theme colors)
    if (day.revenue === 0) {
      day.colorClass = '';
    } else if (daysWithRevenue.length === 1 || range === 0) {
      // Only one day has revenue or all revenue days have same amount
      day.colorClass = 'good';
    } else if (day.revenue === maxRevenue) {
      day.colorClass = 'best';
    } else if (day.revenue === minRevenue) {
      day.colorClass = 'worst';
    } else {
      // Calculate position in range (0 to 1)
      const position = (day.revenue - minRevenue) / range;
      if (position > 0.6) {
        day.colorClass = 'good'; // Yellow (closer to green)
      } else {
        day.colorClass = 'moderate'; // Orange (closer to red)
      }
    }
  });
  
  // Render the boxes
  container.innerHTML = days.map(day => `
    <div class="weekly-day-box ${day.colorClass}" data-date="${day.iso}">
      <div class="weekly-day-name">${day.dayName}</div>
      <div class="weekly-day-date">${day.dateStr}</div>
      <div class="weekly-day-amount">${formatCurrency(day.revenue)}</div>
    </div>
  `).join('');
}

// Show modal for hourly staff member with daily time clock breakdown
function showHourlyStaffModal(staffObj, clockEntries, currentWeek) {
  console.debug('[modal] showHourlyStaffModal', { staffObj, clockEntries, currentWeek });
  // Remove existing modal if present
  const existing = document.getElementById('hourly-staff-modal');
  if (existing) existing.remove();
  
  // Build the 7-day week array (Mon-Sun)
  const weekStart = new Date(currentWeek.start);
  weekStart.setHours(0, 0, 0, 0);
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart);
    d.setDate(weekStart.getDate() + i);
    const iso = localIsoDate(d);
    const dayName = d.toLocaleDateString(undefined, { weekday: 'short' });
    const dateStr = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    days.push({ iso, dayName, dateStr, date: d, entries: [], totalMinutes: 0 });
  }
  
  // Group clock entries by day
  clockEntries.forEach(entry => {
    if (!entry.clock_in) return;
    const clockInDate = parseDatePreferLocal(entry.clock_in);
    // Debug: show raw vs parsed for troubleshooting timezone issues
    try { console.debug('[revenue][clock-entry] raw:', entry.clock_in, 'parsedLocal:', clockInDate && clockInDate.toString(), 'localTime:', clockInDate && clockInDate.toLocaleTimeString()); } catch(e) {}
    const iso = localIsoDate(clockInDate);
    const day = days.find(d => d.iso === iso);
    if (day) {
      day.entries.push(entry);
      if (entry.clock_out) {
        const clockOut = parseDatePreferLocal(entry.clock_out);
        const diffMs = clockOut - clockInDate;
        day.totalMinutes += diffMs / 1000 / 60;
      }
    }
  });
  console.debug('[modal] days after grouping', days);
  
  // Calculate totals
  const totalWeekMinutes = days.reduce((sum, d) => sum + d.totalMinutes, 0);
  const totalWeekHours = totalWeekMinutes / 60;
  const hourlyRate = Number(staffObj.hourly_rate || 0);
  const totalEarned = totalWeekHours * hourlyRate;
  
  // Build modal HTML
  const modal = document.createElement('div');
  modal.id = 'hourly-staff-modal';
  modal.className = 'modal-overlay';
  modal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:1300;display:flex;align-items:center;justify-content:center;';
  
  const daysHtml = days.map(day => {
    const hours = (day.totalMinutes / 60).toFixed(2);
    const earned = (day.totalMinutes / 60) * hourlyRate;
    const hasEntries = day.entries.length > 0;
    
    // Build entries detail for this day
    let entriesHtml = '';
    if (hasEntries) {
      entriesHtml = day.entries.map(entry => {
            const clockIn = parseDatePreferLocal(entry.clock_in);
        const clockInTime = clockIn.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        let clockOutTime = 'Still clocked in';
        let duration = '—';
        if (entry.clock_out) {
          const clockOut = parseDatePreferLocal(entry.clock_out);
          clockOutTime = clockOut.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          const diffMs = clockOut - clockIn;
          const diffMins = Math.round(diffMs / 1000 / 60);
          const hrs = Math.floor(diffMins / 60);
          const mins = diffMins % 60;
          duration = hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`;
        }
        return `
          <div style="display:flex;justify-content:space-between;padding:6px 12px;background:var(--bg);border-radius:4px;margin-top:4px;font-size:0.9em;">
            <span>${clockInTime} → ${clockOutTime}</span>
            <span style="font-weight:600;">${duration}</span>
          </div>
        `;
      }).join('');
    }
    
    return `
      <div style="padding:12px 0;border-bottom:1px solid var(--line);">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <div style="display:flex;align-items:center;gap:12px;">
            <div style="font-weight:600;min-width:80px;">${day.dayName}, ${day.dateStr}</div>
            <div style="width:24px;height:24px;border-radius:12px;background:${hasEntries ? '#10b981' : 'var(--line)'};color:${hasEntries ? 'white' : 'var(--muted)'};display:flex;align-items:center;justify-content:center;font-size:0.8em;font-weight:600;">${day.entries.length}</div>
          </div>
          <div style="display:flex;align-items:center;gap:16px;">
            <div style="text-align:right;">
              <div style="font-weight:600;">${hours} hrs</div>
              <div style="font-size:0.85em;color:var(--muted);">${formatCurrency(earned)}</div>
            </div>
          </div>
        </div>
        ${entriesHtml ? `<div style="margin-top:8px;">${entriesHtml}</div>` : ''}
      </div>
    `;
  }).join('');
  
  modal.innerHTML = `
    <div class="modal-content card" style="max-width:540px;width:90%;max-height:85vh;overflow:hidden;display:flex;flex-direction:column;">
      <div style="display:flex;justify-content:space-between;align-items:center;padding:16px;border-bottom:1px solid var(--line);">
        <div>
          <h3 style="margin:0;">${staffObj.first_name || ''} ${staffObj.last_name || ''}</h3>
          <div style="color:var(--muted);font-size:0.9em;">Hourly Rate: ${formatCurrency(hourlyRate)}/hr</div>
        </div>
        <button class="btn small" id="closeHourlyModal">Close</button>
      </div>
      
      <div style="padding:16px;background:linear-gradient(135deg, #10b981 0%, #34d399 100%);color:white;">
        <div style="display:flex;justify-content:space-around;text-align:center;">
          <div>
            <div style="font-size:2em;font-weight:700;">${totalWeekHours.toFixed(2)}</div>
            <div style="font-size:0.9em;opacity:0.9;">Total Hours</div>
          </div>
          <div>
            <div style="font-size:2em;font-weight:700;">${formatCurrency(totalEarned)}</div>
            <div style="font-size:0.9em;opacity:0.9;">Total Earned</div>
          </div>
        </div>
      </div>
      
      <div style="flex:1;overflow-y:auto;padding:0 16px;">
        <div style="padding:12px 0;font-weight:600;color:var(--muted);font-size:0.9em;border-bottom:1px solid var(--line);">Daily Breakdown</div>
        ${daysHtml}
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
  
  // Close handlers
  document.getElementById('closeHourlyModal').onclick = () => modal.remove();
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.remove();
  });
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

    // ...existing code...

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
      // Fetch time_clock daily summary data for hourly staff for the current week
      let timeClockData = [];
      try {
        const startDate = localIsoDate(currentWeek.start);
        const endDate = localIsoDate(currentWeek.end);
        const { data: clockData, error: clockErr } = await supabase
          .from('time_clock_daily_summary')
          .select('*')
          .eq('shop_id', shopId)
          .gte('work_date', startDate)
          .lte('work_date', endDate);
        if (!clockErr) timeClockData = clockData || [];
      } catch (e) {
        console.warn('Could not fetch time_clock_daily_summary data:', e);
      }

      // Group daily summary rows by staff_id
      const staffClockData = {};
      console.debug('[revenue] time_clock_daily_summary rows fetched:', (timeClockData || []).length, timeClockData && timeClockData.slice && timeClockData.slice(0,5));
      timeClockData.forEach(entry => {
        const staffId = entry.staff_id;
        if (!staffId) return;
        if (!staffClockData[staffId]) staffClockData[staffId] = [];
        staffClockData[staffId].push(entry);
      });

      // Regardless of daily-summary results, try to fetch raw `time_clock` rows for the week.
      // If raw rows are returned, prefer them (they contain actual clock_in/clock_out timestamps).
      try {
        const startIso = currentWeek.start.toISOString();
        const endIso = currentWeek.end.toISOString();
        const { data: rawClock, error: rawErr } = await supabase
          .from('time_clock')
          .select('*')
          .eq('shop_id', shopId)
          .gte('clock_in', startIso)
          .lte('clock_in', endIso);
        const rawRows = (rawErr || !rawClock) ? [] : (rawClock || []);
        if (rawRows && rawRows.length) {
          try { console.debug('[revenue][raw-time_clock] rows fetched:', rawRows.length, rawRows.slice(0,5)); } catch(e) {}
          // Populate staffClockData entries keyed by staff id / auth id / email so later code can prefer raw rows
          rawRows.forEach(r => {
            const sid = r.staff_id || r.staff_auth_id || r.staff_email || null;
            if (!sid) return;
            if (!staffClockData[sid]) staffClockData[sid] = [];
            // push raw row directly — downstream code will detect presence of clock_in/clock_out
            staffClockData[sid].push(r);
          });
        } else {
          try { console.debug('[revenue][raw-time_clock] no raw rows returned for week'); } catch(e) {}
        }
      } catch (e) {
        console.warn('[revenue] raw time_clock fetch failed:', e);
      }

      // Calculate weekly hours for each hourly staff member from daily summaries
      function calcWeeklyHoursFromClock(entries) {
        let totalMinutes = 0;
        entries.forEach(entry => {
          if (!entry) return;
          // If this entry is a raw time_clock row, compute minutes from clock_in/clock_out
          if (entry.clock_in) {
            try {
              const inT = parseDatePreferLocal(entry.clock_in);
              const outT = entry.clock_out ? parseDatePreferLocal(entry.clock_out) : null;
              if (inT && outT && !isNaN(inT.getTime()) && !isNaN(outT.getTime())) {
                totalMinutes += Math.round((outT - inT) / 60000);
                return;
              }
            } catch (e) { /* fallthrough to summary handling */ }
          }
          // daily summary may provide total_minutes or total_hours
          const mins = Number(entry.total_minutes || Math.round(Number(entry.total_hours || 0) * 60) || 0);
          totalMinutes += mins;
        });
        return totalMinutes / 60; // Return hours
      }

      const staffHtml = staffList.map((s, idx) => {
        const isHourly = s.hourly_rate && Number(s.hourly_rate) > 0;
        const clockEntries = staffClockData[s.auth_id] || staffClockData[s.id] || staffClockData[s.email] || [];
        const weeklyHours = isHourly ? calcWeeklyHoursFromClock(clockEntries) : 0;
        const weeklyEarned = isHourly ? weeklyHours * Number(s.hourly_rate) : 0;
        console.debug('[revenue] staff weekly calc', { staffId: s.id, auth_id: s.auth_id, email: s.email, isHourly, clockEntriesLength: (clockEntries||[]).length, weeklyHours, weeklyEarned });
        
        return `
        <div class="staff-panel ${isHourly ? 'hourly-staff' : 'flat-rate-staff'}" 
             style="padding:12px 16px; border-bottom:1px solid var(--line);${isHourly ? 'cursor:pointer;' : ''}"
             data-staff-id="${s.id}"
             data-staff-auth-id="${s.auth_id}"
             data-is-hourly="${isHourly}">
          <div class="staff-left">
            <div class="staff-name" style="font-weight:bold; font-size:1.05em;">
              ${s.first_name || ''} ${s.last_name || ''}
              ${isHourly ? '<span style="background:#10b981;color:white;padding:2px 8px;border-radius:12px;font-size:0.75em;margin-left:8px;">Hourly</span>' : '<span style="background:#6366f1;color:white;padding:2px 8px;border-radius:12px;font-size:0.75em;margin-left:8px;">Flat Rate</span>'}
            </div>
            <div class="staff-email" style="color:var(--muted);">${s.email || ''}</div>
          </div>
          <div class="staff-right">
            <div class="staff-meta">
              <div style="margin-bottom:6px;"><span style="margin-right:8px;">Role: <strong>${s.role || 'staff'}</strong></span></div>
              <div>Hourly Rate: <strong>${s.hourly_rate ? formatCurrency(Number(s.hourly_rate)) : 'N/A (Flat Rate)'}</strong></div>
            </div>
            <div class="staff-stats">
              ${isHourly ? `
                <div style="font-size:0.95em;">Hours (week): <strong>${weeklyHours.toFixed(2)} h</strong></div>
                <div style="font-size:0.95em;margin-top:6px;">Earned (week): <strong>${formatCurrency(weeklyEarned)}</strong></div>
                <div style="font-size:0.8em;color:var(--muted);margin-top:4px;">Click to view daily breakdown</div>
              ` : `
                <div style="font-size:0.95em;">Hours (week): <strong data-staff-hours="${s.id}">...</strong></div>
                <div style="font-size:0.95em;margin-top:6px;">Earned (week): <strong data-staff-earned="${s.id}">...</strong></div>
              `}
            </div>
          </div>
        </div>
      `}).join('');
      document.getElementById('staff-list').innerHTML = `<div style="border:1px solid var(--line); border-radius:8px; overflow:hidden; background:var(--card);">${staffHtml}</div>`;
      
      // Attach click handlers for HOURLY staff to show time clock modal
      document.querySelectorAll('.staff-panel.hourly-staff').forEach(panel => {
        panel.addEventListener('click', async (e) => {
          const staffId = panel.getAttribute('data-staff-id');
          const staffAuthId = panel.getAttribute('data-staff-auth-id');
          const staffObj = staffList.find(s => s.id === staffId || s.auth_id === staffAuthId);
          if (!staffObj) return;

          // Use same fallback as main panel: try auth_id, id, then email
          let clockEntries = staffClockData[staffObj.auth_id] || staffClockData[staffObj.id] || staffClockData[staffObj.email] || [];

          // If entries are from time_clock_daily_summary (no clock_in), try to fetch raw time_clock rows
          if (clockEntries.length && !clockEntries[0].clock_in && clockEntries[0].work_date) {
            try {
              const startIso = currentWeek.start.toISOString();
              const endIso = currentWeek.end.toISOString();
              let rawRows = [];
              // Try by numeric staff id first
              if (staffObj.id) {
                try {
                  const { data: byId, error: byIdErr } = await supabase.from('time_clock')
                    .select('*')
                    .eq('shop_id', shopId)
                    .eq('staff_id', staffObj.id)
                    .gte('clock_in', startIso)
                    .lte('clock_in', endIso);
                  if (!byIdErr && byId && byId.length) rawRows = byId;
                } catch (e) { /* ignore */ }
              }
              // If none, try by staff auth id
              if ((!rawRows || rawRows.length === 0) && staffObj.auth_id) {
                try {
                  const { data: byAuth, error: byAuthErr } = await supabase.from('time_clock')
                    .select('*')
                    .eq('shop_id', shopId)
                    .eq('staff_auth_id', staffObj.auth_id)
                    .gte('clock_in', startIso)
                    .lte('clock_in', endIso);
                  if (!byAuthErr && byAuth && byAuth.length) rawRows = byAuth;
                } catch (e) { /* ignore */ }
              }

              if (rawRows && rawRows.length) {
                // Debug: show rawRows fetched (useful to detect RLS filtering)
                try { console.debug('[revenue][raw-time_clock] rows fetched:', rawRows.length, rawRows.slice(0,5)); } catch(e) {}
                // Map raw rows into modal-friendly entries preserving actual clock_in/out
                clockEntries = rawRows.filter(r => r.clock_in).map(r => ({
                  clock_in: formatLocalIsoNoZone(parseDatePreferLocal(r.clock_in)),
                  clock_out: r.clock_out ? formatLocalIsoNoZone(parseDatePreferLocal(r.clock_out)) : null,
                  _raw: true,
                  _src: r
                }));
              } else {
                try { console.debug('[revenue][raw-time_clock] no raw rows returned, falling back to daily_summary synthesis'); } catch(e) {}
                // Fallback: synthesize a pseudo-entry for the modal: one per day, with total_minutes as duration
                clockEntries = clockEntries.map(row => {
                  const day = row.work_date;
                  const mins = Number(row.total_minutes || Math.round(Number(row.total_hours || 0) * 60) || 0);
                  const parts = (day || '').split('-');
                  const y = parseInt(parts[0],10);
                  const mo = parseInt(parts[1]||'1',10) - 1;
                  const da = parseInt(parts[2]||'1',10);
                  const clockInDate = new Date(y, mo, da, 9, 0, 0);
                  const clockOutDate = new Date(clockInDate.getTime() + mins * 60000);
                  return { clock_in: formatLocalIsoNoZone(clockInDate), clock_out: formatLocalIsoNoZone(clockOutDate), _summary: true };
                });
              }
            } catch (err) {
              // On any error, fallback to synthesis
              clockEntries = clockEntries.map(row => {
                const day = row.work_date;
                const mins = Number(row.total_minutes || Math.round(Number(row.total_hours || 0) * 60) || 0);
                const parts = (day || '').split('-');
                const y = parseInt(parts[0],10);
                const mo = parseInt(parts[1]||'1',10) - 1;
                const da = parseInt(parts[2]||'1',10);
                const clockInDate = new Date(y, mo, da, 9, 0, 0);
                const clockOutDate = new Date(clockInDate.getTime() + mins * 60000);
                return { clock_in: formatLocalIsoNoZone(clockInDate), clock_out: formatLocalIsoNoZone(clockOutDate), _summary: true };
              });
            }
          }

          // Build the weekly breakdown modal
          showHourlyStaffModal(staffObj, clockEntries, currentWeek);
        });
      });
      
      // Attach click handlers for FLAT RATE staff (existing behavior - show jobs)
      Array.from(document.querySelectorAll('.staff-panel.flat-rate-staff')).forEach(panel => {
        panel.style.cursor = 'pointer';
        panel.addEventListener('click', async (e) => {
          // Find staff id from panel content by matching the name/email rendered
          const nameEl = panel.querySelector('.staff-name') || panel.querySelector('div[style*="font-weight:bold"]');
          const emailEl = panel.querySelector('.staff-email') || panel.querySelector('div[style*="color:#555"]');
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
                return isNaN(dt.getTime()) ? null : localIsoDate(dt);
              }
              // Other readable strings - try Date constructor
              let d = new Date(raw);
              if (!isNaN(d.getTime())) return localIsoDate(d);
            } else {
              const d = new Date(raw);
              if (!isNaN(d.getTime())) return localIsoDate(d);
            }
            return null;
          }

          // Build job details (invoice totals, scheduled/created date) and attach isoDate
          const jobsWithDetails = staffJobs.map(j => {
            const appt = appointments.find(a => a.id === j.appointment_id) || {};
            const inv = invoices.find(ii => (ii.job_id && ii.job_id === j.id) || (ii.appointment_id && ii.appointment_id === j.appointment_id)) || null;
            let totalRevenue = 0;
            let partsCost = 0;
            let items = [];
            if (inv) {
              totalRevenue = calcInvTotal(inv); // includes tax
              items = inv.items || [];
              partsCost = items.reduce((s, it) => s + ((Number(it.qty||0) * Number(it.cost_price || it.cost || 0))||0), 0);
            }
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
            const iso = localIsoDate(d);
            days.push({ iso, label: d.toLocaleDateString(undefined,{month:'short',day:'numeric'}), date: d });
          }

          // Group jobs by iso date (normalize dates to YYYY-MM-DD), ensure every day exists
          const grouped = {};
          days.forEach(dd => grouped[dd.iso] = []);
          jobsWithDetails.forEach(jd => {
            let key = 'unknown';
            if (jd && jd.isoDate && jd.isoDate !== 'unknown') {
              try {
                // Normalize by parsing date preferring local timezone
                const d = parseDatePreferLocal(jd.isoDate);
                if (d) {
                  key = localIsoDate(d);
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
              <div class="staff-week-row" style="padding:12px 0;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;align-items:center;">
                <div style="display:flex;align-items:center;gap:12px;"><div style="font-weight:600;">${d.label}</div><div style="width:28px;height:28px;border-radius:14px;background:var(--card);border:1px solid var(--line);display:flex;align-items:center;justify-content:center;font-size:0.9em;color:var(--text);">${entries.length}</div></div>
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
                        <div style="padding:8px 12px;border-top:1px dashed var(--line);display:flex;justify-content:space-between;align-items:center;">
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
      // Skip jobs with 'pending' status (these are likely from deleted invoices/appointments)
      if (j.status && j.status.toLowerCase() === 'pending') {
        console.debug('[revenue] filtering out pending job:', j.id);
        return false;
      }
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
        const d = parseDatePreferLocal(rawDate);
        if (!d) continue;
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
            const d = parseDatePreferLocal(raw);
            if (d && d >= weekStart && d <= weekEnd) return true;
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
        const schedDate = rawDate ? (function(r){ const dd = parseDatePreferLocal(r); return dd ? dd.toLocaleDateString() : 'N/A'; })(rawDate) : 'N/A';


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
        let items = [];
        if (inv) {
          totalRevenue = calcInvTotal(inv); // includes tax
          items = inv.items || [];
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
          <div class="job-panel" style="padding:12px 16px; border-bottom:1px solid var(--line); display:flex; align-items:center; cursor:pointer;" data-job-id="${j.id}">
            <div style="flex:2;">
              <div style="font-weight:bold; font-size:1.1em;">${jobName}</div>
              <div style="color:var(--muted);">Scheduled: ${schedDate}</div>
            </div>
            <div style="flex:2;">
              <div style="margin-bottom:8px; display:flex; align-items:center; gap:16px;">
                <span>Staff: <strong>${staffName}</strong></span>
                <span style="display:inline-flex; align-items:center; gap:6px;">Status: <span class="tag ${getStatusClass(j.status || 'open')}" style="flex-shrink:0;">${j.status || 'Open'}</span></span>
              </div>
              <div style="display:grid;grid-template-columns:repeat(2,1fr);grid-template-rows:repeat(2,auto);gap:4px 12px;align-items:center;">
                <div style="font-size:0.95em;">Total Revenue:</div>
                <strong data-total="${j.id}" style="font-size:0.95em;">${Number.isFinite(totalRevenue) ? formatCurrency(totalRevenue) : '...'}</strong>
                <div style="font-size:0.95em;">Parts Cost:</div>
                <strong data-parts="${j.id}" style="font-size:0.95em;">${Number.isFinite(partsCost) ? formatCurrency(partsCost) : '...'}</strong>
                <div style="font-size:0.95em;">Staff Revenue:</div>
                <strong data-staff="${j.id}" style="font-size:0.95em;">${Number.isFinite(staffRevenue) ? formatCurrency(staffRevenue) : '...'}</strong>
                <div style="font-size:0.95em;">Net:</div>
                <strong data-net="${j.id}" style="font-size:0.95em;">...</strong>
              </div>
            </div>
          </div>
        `;
      }).join('');
      document.getElementById('job-list').innerHTML = `<div style="border:1px solid var(--line); border-radius:8px; overflow:hidden; background:var(--card);">${jobHtml}</div>`;
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

        // Always show labor value, even if unassigned
        let staffRate = 0;
        let staff = null;
        // Try to get staff rate from assigned staff, else fallback to default (or 0)
        const assigned = jobObj && (jobObj.assigned_to || jobObj.assigned);
        if (assigned) {
          staff = staffList.find(s => s.id === assigned || s.auth_id === assigned) || null;
          staffRate = Number(staff ? (staff.hourly_rate || staff.rate || 0) : 0);
        }
        // If no assigned staff, but there is labor, use the first labor item's rate if available
        if (!assigned && items && items.length) {
          const laborItem = items.find(it => (it.type || '').toLowerCase() === 'labor' && Number(it.price || it.unit_price || it.amount || it.total || it.rate || 0) > 0);
          if (laborItem) {
            staffRate = Number(laborItem.price || laborItem.unit_price || laborItem.amount || laborItem.total || laborItem.rate || 0);
          }
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

        // If the assigned staff is hourly-paid, do NOT treat job labor as staff revenue here.
        // Hourly staff payroll is derived from time_clock; leaving labor revenue inside the job's net.
        const assignedIsHourly = staff && Number(staff.hourly_rate || 0) > 0;
        const staffRevenue = assignedIsHourly ? 0 : (staffRate * totalHours);
        const net = (totalRevenue || 0) - (partsCost || 0) - staffRevenue;

        // Update DOM placeholders
        const totalEl = document.querySelector(`[data-total="${jobId}"]`);
        const partsEl = document.querySelector(`[data-parts="${jobId}"]`);
        const staffEl = document.querySelector(`[data-staff="${jobId}"]`);
        const netEl = document.querySelector(`[data-net="${jobId}"]`);
        if (totalEl) totalEl.textContent = Number.isFinite(totalRevenue) ? formatCurrency(totalRevenue) : 'N/A';
        if (partsEl) partsEl.textContent = Number.isFinite(partsCost) ? formatCurrency(partsCost) : 'N/A';
        if (staffEl) staffEl.textContent = assignedIsHourly ? 'N/A (Hourly)' : (Number.isFinite(staffRevenue) ? formatCurrency(staffRevenue) : 'N/A');
        if (netEl) netEl.textContent = Number.isFinite(net) ? formatCurrency(net) : 'N/A';
      }
    })();

    // Placeholder UI for totals
    // Calculate weekly totals after all job labor fetches complete
    const jobTotalsPromises = jobListFiltered.map(async (j) => {
    const inv = invoices.find(ii => (ii.job_id && ii.job_id === j.id) || (ii.appointment_id && ii.appointment_id === j.appointment_id));
    let totalRevenue = 0;
    let partsCost = 0;
    let items = [];
    if (inv) {
      totalRevenue = calcInvTotal(inv); // includes tax
      items = inv.items || [];
      partsCost = items.reduce((s, it) => s + ((Number(it.qty||0) * Number(it.cost_price || it.cost || 0))||0), 0);
    }
      // Always show labor value, even if unassigned
      let staffRate = 0;
      let staff = null;
      const assigned = j.assigned_to || j.assigned;
      if (assigned) {
        staff = staffList.find(s => s.id === assigned || s.auth_id === assigned) || null;
        staffRate = Number(staff ? (staff.hourly_rate || staff.rate || 0) : 0);
      }
      // If no assigned staff, but there is labor, use the first labor item's rate if available
      if (!assigned && items && items.length) {
        const laborItem = items.find(it => (it.type || '').toLowerCase() === 'labor' && Number(it.price || it.unit_price || it.amount || it.total || it.rate || 0) > 0);
        if (laborItem) {
          staffRate = Number(laborItem.price || laborItem.unit_price || laborItem.amount || laborItem.total || laborItem.rate || 0);
        }
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

      const assignedIsHourly = staff && Number(staff.hourly_rate || 0) > 0;
      const staffCost = assignedIsHourly ? 0 : (staffRate * totalHours);
      return { jobId: j.id, assigned, totalHours, staffCost, totalRevenue, partsCost };
    });
    const jobTotals = await Promise.all(jobTotalsPromises);
    const weekTotalRevenue = jobTotals.reduce((sum, jt) => sum + jt.totalRevenue, 0);
    const weekPartsCost = jobTotals.reduce((sum, jt) => sum + jt.partsCost, 0);
    const jobWeekStaffCost = jobTotals.reduce((sum, jt) => sum + jt.staffCost, 0);

    // Additionally include time_clock-based staff hours (for hourly-paid staff)
    let timeClockStaffCost = 0;
      try {
        // Use daily summary to aggregate minutes per staff for the week
        const startDate = localIsoDate(currentWeek.start);
        const endDate = localIsoDate(currentWeek.end);
        const { data: tcData, error: tcErr } = await supabase
          .from('time_clock_daily_summary')
          .select('*')
          .eq('shop_id', shopId)
          .gte('work_date', startDate)
          .lte('work_date', endDate);
        const tcRows = (tcErr || !tcData) ? [] : (tcData || []);

        // Map staff_id (auth uid) to minutes summed across days
        const clockMinutesByStaff = {};
        tcRows.forEach(r => {
          const staffKey = r.staff_id || null;
          if (!staffKey) return;
          const mins = Number(r.total_minutes || Math.round(Number(r.total_hours || 0) * 60) || 0);
          clockMinutesByStaff[staffKey] = (clockMinutesByStaff[staffKey] || 0) + Math.max(0, mins);
        });

        // For each staff in staffList, compute earned amount from clock minutes using their hourly_rate
        staffList.forEach(s => {
          const staffKey = s.auth_id || s.id;
          const minutes = clockMinutesByStaff[staffKey] || 0;
          if (minutes <= 0) return;
          const hours = minutes / 60;
          const rate = Number(s.hourly_rate || s.rate || 0);
          const earned = hours * rate;
          timeClockStaffCost += earned;
        });
      } catch (e) {
        console.warn('Could not fetch/aggregate time_clock_daily_summary for staff costs:', e);
      }

    const weekStaffCost = jobWeekStaffCost + timeClockStaffCost;
    // Subtract tax from net profit in weekly overview
    let weekTax = 0;
    for (const jt of jobTotals) {
      const inv = invoices.find(ii => (ii.job_id && ii.job_id === jt.jobId) || (ii.appointment_id && ii.appointment_id === jobListFiltered.find(j => j.id === jt.jobId)?.appointment_id));
      if (inv) {
        const items = inv.items || [];
        const subtotal = items.reduce((sum, itm) => sum + ((Number(itm.qty) || 0) * (Number(itm.price) || 0)), 0);
        weekTax += subtotal * ((inv.tax_rate || 0) / 100);
      }
    }
    const weekNetRevenue = weekTotalRevenue - weekPartsCost - weekStaffCost - weekTax;

    document.getElementById('revenue-totals').innerHTML = `
      <div>Total Revenue: <strong>${formatCurrency(weekTotalRevenue)}</strong></div>
      <div>Parts Cost: <strong>${formatCurrency(weekPartsCost)}</strong></div>
      <div>Total Staff Cost: <strong>${formatCurrency(weekStaffCost)}</strong></div>
      <div>Net Revenue: <strong>${formatCurrency(weekNetRevenue)}</strong></div>
    `;

    // Render the revenue breakdown chart
    renderRevenueBreakdownChart(weekTotalRevenue, weekStaffCost, weekPartsCost, weekNetRevenue);

    // Render the weekly days overview boxes
    renderWeeklyDaysOverview(currentWeek, invoices, appointments, jobListFiltered);



    // Calculate all-time gross (grand total) and all-time net after platform fees
    let allTimeGrossTotal = 0;
    let allTimeNetAfterPlatformFees = 0;
    for (const inv of invoices) {
      if (inv) {
        allTimeGrossTotal += typeof window.calcInvTotal === 'function' ? window.calcInvTotal(inv) : calcInvTotal(inv);
        if (typeof window.calcNetTotal === 'function') {
          allTimeNetAfterPlatformFees += window.calcNetTotal(inv);
        }
      }
    }
    // Update Stripe Express panel with all-time gross and all-time net after platform fees
    const stripeTotalRevenue = document.getElementById('stripe-total-revenue');
    if (stripeTotalRevenue) {
      stripeTotalRevenue.textContent = formatCurrency(allTimeGrossTotal);
    }
    const stripeAvailablePayout = document.getElementById('stripe-available-payout');
    if (stripeAvailablePayout) {
      stripeAvailablePayout.textContent = formatCurrency(allTimeNetAfterPlatformFees);
    }
    const stripeCurrentBalance = document.getElementById('stripe-current-balance');
    if (stripeCurrentBalance) {
      stripeCurrentBalance.textContent = formatCurrency(allTimeNetAfterPlatformFees);
    }

    // (No longer update available for payout weekly; now always all-time net)

    // Compute per-staff weekly totals and update staff panel placeholders
    try {
      const staffTotals = {};
      jobTotals.forEach(jt => {
        // Always sum total labor, even if unassigned
        const assignedRaw = jt.assigned || 'unassigned';
        let staffKey = assignedRaw;
        if (assignedRaw !== 'unassigned') {
          const found = staffList.find(s => s.id === assignedRaw || s.auth_id === assignedRaw || (`${(s.first_name||'')} ${(s.last_name||'')}`).trim() === assignedRaw || (s.email && s.email === assignedRaw));
          if (found) staffKey = found.id;
        }
        if (!staffTotals[staffKey]) staffTotals[staffKey] = { hours: 0, earned: 0 };
        staffTotals[staffKey].hours += Number(jt.totalHours || 0);
        staffTotals[staffKey].earned += Number(jt.staffCost || 0);
      });

      // Incorporate time_clock totals (fetch again to ensure fresh aggregation)
      try {
        const { data: tcData2, error: tcErr2 } = await supabase
          .from('time_clock')
          .select('*')
          .eq('shop_id', shopId)
          .gte('clock_in', currentWeek.start.toISOString())
          .lte('clock_in', currentWeek.end.toISOString());
        const tcRows2 = (tcErr2 || !tcData2) ? [] : (tcData2 || []);
        const clockMinutesByStaff2 = {};
        tcRows2.forEach(r => {
          if (!r.clock_in) return;
          if (!r.clock_out) return;
          const staffKey = r.staff_id || r.staff_auth_id || null;
          if (!staffKey) return;
          const inT = parseDatePreferLocal(r.clock_in);
          const outT = parseDatePreferLocal(r.clock_out);
          if (isNaN(inT.getTime()) || isNaN(outT.getTime())) return;
          const mins = Math.round((outT - inT) / 60000);
          clockMinutesByStaff2[staffKey] = (clockMinutesByStaff2[staffKey] || 0) + Math.max(0, mins);
        });

        // Add clock-derived hours/earnings into staffTotals
        staffList.forEach(s => {
          const staffKey = s.auth_id || s.id;
          const minutes = clockMinutesByStaff2[staffKey] || 0;
          if (minutes <= 0) return;
          const hours = minutes / 60;
          const rate = Number(s.hourly_rate || s.rate || 0);
          const earned = hours * rate;
          if (!staffTotals[staffKey]) staffTotals[staffKey] = { hours: 0, earned: 0 };
          staffTotals[staffKey].hours += hours;
          staffTotals[staffKey].earned += earned;
        });
      } catch (e) {
        console.warn('Failed to incorporate time_clock into staff totals:', e);
      }

      // Update DOM placeholders for each staff
      staffList.forEach(s => {
        const keyId = s.id;
        const keyAuth = s.auth_id;
        const totals = (staffTotals[keyId] || staffTotals[keyAuth]) || { hours: 0, earned: 0 };
        const hoursEl = document.querySelector(`[data-staff-hours="${s.id}"]`);
        const earnedEl = document.querySelector(`[data-staff-earned="${s.id}"]`);
        if (hoursEl) hoursEl.textContent = (totals.hours ? totals.hours.toFixed(2) : '0.00') + ' h';
        if (earnedEl) earnedEl.textContent = totals.earned ? formatCurrency(totals.earned) : formatCurrency(0);
      });
    } catch (e) {
      console.warn('Error aggregating staff totals:', e);
    }

    // Load and display ordered parts
    await loadOrderedParts(shopId, currentWeek);
  }

  // Helper function to map supplier name to logo path
  function getSupplierLogo(supplier) {
    const supplierMap = {
      'partstech': 'assets/Parts Suppliers/partstech-logo.png',
      'carquest': 'assets/Parts Suppliers/CarwquestLogo.webp',
      'carquest/advance auto': 'assets/Parts Suppliers/CarwquestLogo.webp',
      'advance auto': 'assets/Parts Suppliers/CarwquestLogo.webp',
      'worldpac': 'assets/Parts Suppliers/Worldpaclogo.png',
      'autozone': 'assets/Parts Suppliers/AutoZone-Logo-640x400.png',
      'napa': 'assets/Parts Suppliers/NAPA_Auto_Parts_logo.svg.png',
      "o'reilly": 'assets/Parts Suppliers/oreillyslogo.png',
      'oreilly': 'assets/Parts Suppliers/oreillyslogo.png',
      'summit racing': 'assets/Parts Suppliers/Summit-Racing-Equipment-Logo-1024x580.webp',
      'parts authority': 'assets/Parts Suppliers/partsauthoritylogo.jpg',
      'rockauto': 'assets/Parts Suppliers/rock-auto.jpg',
      'manual entry': null // No logo for manual entry
    };
    
    const normalized = (supplier || '').toLowerCase().trim();
    console.log('🔍 Logo lookup:', { supplier, normalized, found: supplierMap[normalized] });
    return supplierMap[normalized] || null;
  }

  // Load ordered parts from job_parts table
  async function loadOrderedParts(shopId, week) {
    const partsListEl = document.getElementById('parts-list');
    const weeklyCostEl = document.getElementById('parts-weekly-cost');
    const totalCostEl = document.getElementById('parts-total-cost');
    
    if (!partsListEl) return;
    
    try {
      // Fetch all job_parts for this shop
      const { data: allParts, error } = await supabase
        .from('job_parts')
        .select('*')
        .eq('shop_id', shopId)
        .order('created_at', { ascending: false });
      
      if (error) {
        console.error('Error loading parts:', error);
        partsListEl.innerHTML = '<div style="text-align:center; color:var(--muted); padding:24px;">Error loading parts</div>';
        return;
      }
      
      const parts = allParts || [];
      
      // Calculate all-time total
      const allTimeCost = parts.reduce((sum, part) => {
        const qty = Number(part.quantity || 0);
        const cost = Number(part.cost_price || 0);
        return sum + (qty * cost);
      }, 0);
      
      // Filter parts for the selected week
      const weekStart = new Date(week.start);
      weekStart.setHours(0, 0, 0, 0);
      const weekEnd = new Date(week.end);
      weekEnd.setHours(23, 59, 59, 999);
      
      const weeklyParts = parts.filter(part => {
        if (!part.created_at) return false;
        const partDate = new Date(part.created_at);
        return partDate >= weekStart && partDate <= weekEnd;
      });
      
      // Calculate weekly cost
      const weeklyCost = weeklyParts.reduce((sum, part) => {
        const qty = Number(part.quantity || 0);
        const cost = Number(part.cost_price || 0);
        return sum + (qty * cost);
      }, 0);
      
      // Update cost displays
      if (weeklyCostEl) weeklyCostEl.textContent = formatCurrency(weeklyCost);
      if (totalCostEl) totalCostEl.textContent = formatCurrency(allTimeCost);
      
      // Render parts list
      if (weeklyParts.length === 0) {
        partsListEl.innerHTML = '<div style="text-align:center; color:var(--muted); padding:24px;">No parts ordered this week</div>';
        return;
      }
      
      const partsHtml = weeklyParts.map(part => {
        const partName = part.part_name || 'Unknown Part';
        const partNumber = part.part_number || '';
        const price = Number(part.cost_price || 0);
        const qty = Number(part.quantity || 1);
        const totalCost = price * qty;
        const supplier = part.supplier || 'Manual Entry';
        const dateOrdered = part.created_at ? new Date(part.created_at).toLocaleDateString() : 'N/A';
        
        // Get supplier logo
        const logoPath = getSupplierLogo(supplier);
        const logoHtml = logoPath 
          ? `<img src="${logoPath}" alt="${supplier}" class="parts-supplier-logo" onerror="this.style.display='none'">`
          : `<div style="width:24px;height:24px;display:flex;align-items:center;justify-content:center;background:var(--line);border-radius:4px;font-size:10px;font-weight:bold;color:var(--muted);">${supplier.charAt(0).toUpperCase()}</div>`;
        
        return `
          <div class="parts-list-item">
            ${logoHtml}
            <div>
              <div style="font-weight:600;">${partName}</div>
              ${partNumber ? `<div style="font-size:0.85em;color:var(--muted);">Part #${partNumber}</div>` : ''}
            </div>
            <div style="text-align:right;">
              <div style="font-weight:600;">${formatCurrency(totalCost)}</div>
              <div style="font-size:0.85em;color:var(--muted);">Qty: ${qty}</div>
            </div>
            <div style="font-size:0.9em;color:var(--muted);">${supplier}</div>
            <div style="font-size:0.85em;color:var(--muted);">${dateOrdered}</div>
          </div>
        `;
      }).join('');
      
      partsListEl.innerHTML = partsHtml;
      
    } catch (ex) {
      console.error('Exception loading parts:', ex);
      partsListEl.innerHTML = '<div style="text-align:center; color:var(--muted); padding:24px;">Error loading parts</div>';
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
  modal.style.background = 'var(--card)';
  modal.style.border = '1px solid var(--line)';
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
    const rows = items.map(it => `<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--line);"><div>${it.name || it.description || it.label || 'Item'}</div><div>${formatCurrency((Number(it.qty||0) * Number(it.price||0))||0)}</div></div>`).join('');
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
        <div style="display:flex;justify-content:space-between;font-weight:700;border-top:1px solid var(--line);padding-top:6px;"><div>Net</div><div>${formatCurrency(net)}</div></div>
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
