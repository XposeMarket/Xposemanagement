/**
 * pages/appointments.js
 * Appointments page - List, CRUD, Status management
 * 
 * Handles:
 * - Loading appointments from Supabase (data.appointments JSONB)
 * - Creating, editing, deleting appointments
 * - Status management
 * - Search and filtering
 * - Customer save integration with automatic vehicle save
 */

import { getSupabaseClient } from '../helpers/supabase.js';
import { getUUID } from '../helpers/uuid.js';
import { currentUsesVehicles } from '../helpers/shop-config-loader.js';
import { createShopNotification } from '../helpers/shop-notifications.js';
import { getInspectionSummary } from '../helpers/inspection-api.js';
import { inspectionForm } from '../components/inspectionFormModal.js';
import { decodeVIN, isValidVIN, formatVehicleDisplay, getVehicleDetails } from '../helpers/vin-decoder.js';

// Current appointment being edited
let currentApptId = null;
let currentApptForStatus = null;
let allAppointments = [];
// Currently open view modal appointment id
let currentViewApptId = null;
// Track if current user is staff (not admin)
let isStaffUser = false;
// Cached role
let cachedUserRole = null;
// Sorting state for appointments table
let apptSortCol = 'created';
let apptSortDir = 'desc'; // 'asc' | 'desc'

// Status options
const STATUSES = ['new', 'scheduled', 'in_progress', 'awaiting_parts', 'completed'];

// Notes polling
let notesPollingInterval = null;
let lastKnownNotesHash = null;
const NOTES_POLL_INTERVAL = 15000; // 15 seconds

// ========== Read Notes Tracking ==========
/**
 * Get the storage key for read notes (per user)
 */
function getReadNotesKey() {
  const userId = localStorage.getItem('xm_user_id') || 'anonymous';
  return `xm_read_notes_${userId}`;
}

/**
 * Get set of read note IDs
 */
function getReadNoteIds() {
  try {
    const data = localStorage.getItem(getReadNotesKey());
    return new Set(data ? JSON.parse(data) : []);
  } catch (e) {
    return new Set();
  }
}

/**
 * Mark a note as read
 */
function markNoteAsRead(noteId) {
  const readIds = getReadNoteIds();
  readIds.add(noteId);
  localStorage.setItem(getReadNotesKey(), JSON.stringify([...readIds]));
}

/**
 * Check if a note is read
 */
function isNoteRead(noteId) {
  return getReadNoteIds().has(noteId);
}

// ========== Notes Polling ==========
/**
 * Generate a simple hash of notes data to detect changes
 */
function generateNotesHash(notes) {
  if (!notes || notes.length === 0) return 'empty';
  // Create a hash based on note IDs and updated_at timestamps
  return notes.map(n => `${n.id}:${n.updated_at}`).sort().join('|');
}

/**
 * Poll for new/updated notes and refresh the table if changes detected
 */
async function pollForNotes() {
  try {
    const supabase = getSupabaseClient();
    if (!supabase || !allAppointments.length) return;
    
    const appointmentIds = allAppointments.map(a => a.id);
    const { data: notesData } = await supabase
      .from('appointment_notes')
      .select('id, updated_at')
      .in('appointment_id', appointmentIds);
    
    const currentHash = generateNotesHash(notesData || []);
    
    // If this is the first poll, just store the hash
    if (lastKnownNotesHash === null) {
      lastKnownNotesHash = currentHash;
      return;
    }
    
    // If notes changed, refresh the table
    if (currentHash !== lastKnownNotesHash) {
      console.log('[NotesPolling] Notes changed, refreshing table...');
      lastKnownNotesHash = currentHash;
      await renderAppointments();
    }
  } catch (e) {
    console.warn('[NotesPolling] Error polling for notes:', e);
  }
}

/**
 * Start polling for notes updates
 */
function startNotesPolling() {
  if (notesPollingInterval) {
    clearInterval(notesPollingInterval);
  }
  // Initial poll
  pollForNotes();
  // Set up interval
  notesPollingInterval = setInterval(pollForNotes, NOTES_POLL_INTERVAL);
  console.log(`[NotesPolling] Started polling every ${NOTES_POLL_INTERVAL / 1000} seconds`);
}

/**
 * Stop polling for notes
 */
function stopNotesPolling() {
  if (notesPollingInterval) {
    clearInterval(notesPollingInterval);
    notesPollingInterval = null;
    console.log('[NotesPolling] Stopped polling');
  }
}

/**
 * Fetch the current user's role (shop_staff.role or users.role).
 * Caches result in `cachedUserRole`.
 */
async function fetchCurrentUserRole() {
  if (cachedUserRole) return cachedUserRole;
  const supabase = getSupabaseClient();
  const shopId = getCurrentShopId();
  try {
    if (supabase) {
      const { data: authData } = await supabase.auth.getUser();
      const authId = authData?.user?.id;
      if (authId && shopId) {
        try {
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
        } catch (e) {}

        try {
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
        } catch (e) {}
      }
    }
  } catch (e) {}

  try {
    const session = JSON.parse(localStorage.getItem('xm_session') || '{}');
    const users = JSON.parse(localStorage.getItem('xm_users') || '[]');
    const u = users.find(x => x.email === session.email) || {};
    cachedUserRole = u.role || u.shop_staff_role || 'staff';
    return cachedUserRole;
  } catch (e) { return 'staff'; }
}

// ========== Status Polling for Appointments ==========
let apptStatusPollingInterval = null;
let lastKnownApptStatusHash = null;
const APPT_STATUS_POLL_INTERVAL = 30000; // 30 seconds

function generateApptStatusHash(items) {
  if (!items || items.length === 0) return 'empty';
  return items.map(i => `${i.id}:${i.status}:${i.updated_at || ''}`).sort().join('|');
}

async function pollForAppointmentStatuses() {
  try {
    const supabase = getSupabaseClient();
    if (!supabase || !allAppointments.length) return;

    const apptIds = allAppointments.map(a => a.id).filter(Boolean);
    if (!apptIds.length) return;

    const { data: rows, error } = await supabase
      .from('appointments')
      .select('id,status,updated_at')
      .in('id', apptIds);

    if (error) { console.warn('[ApptStatusPolling] Supabase error:', error); return; }

    const currentHash = generateApptStatusHash(rows || []);
    if (lastKnownApptStatusHash === null) { lastKnownApptStatusHash = currentHash; return; }
    if (currentHash !== lastKnownApptStatusHash) {
      console.log('[ApptStatusPolling] Appointment statuses changed, merging and refreshing table...');
      lastKnownApptStatusHash = currentHash;

      // Merge the polled appointment status rows into the in-memory `allAppointments` array.
      const rowsMap = (rows || []).reduce((m, r) => { if (r && r.id) m[r.id] = r; return m; }, {});
      let didChange = false;
      allAppointments = allAppointments.map(a => {
        if (!a || !a.id) return a;
        const polled = rowsMap[a.id];
        if (!polled) return a;
        if (a.status !== polled.status || (polled.updated_at && a.updated_at !== polled.updated_at)) {
          didChange = true;
          return Object.assign({}, a, { status: polled.status, updated_at: polled.updated_at });
        }
        return a;
      });

      if (didChange) await renderAppointments();
    }
  } catch (e) {
    console.warn('[ApptStatusPolling] Error polling appointment statuses:', e);
  }
}

function startApptStatusPolling() {
  if (apptStatusPollingInterval) clearInterval(apptStatusPollingInterval);
  pollForAppointmentStatuses();
  apptStatusPollingInterval = setInterval(pollForAppointmentStatuses, APPT_STATUS_POLL_INTERVAL);
  console.log(`[ApptStatusPolling] Started polling every ${APPT_STATUS_POLL_INTERVAL / 1000} seconds`);
}

function stopApptStatusPolling() {
  if (apptStatusPollingInterval) { clearInterval(apptStatusPollingInterval); apptStatusPollingInterval = null; console.log('[ApptStatusPolling] Stopped polling'); }
}

// Format a time string (HH:MM or HH:MM:SS or ISO) to a 12-hour clock like "2:30 PM".
function formatTime12(timeStr) {
  if (!timeStr) return null;
  try {
    // If already contains AM/PM, assume it's formatted
    if (/(am|pm)$/i.test(timeStr) || /AM|PM/.test(timeStr)) return timeStr;

    // Handle simple HH:MM or HH:MM:SS
    const parts = timeStr.split(':');
    if (parts.length >= 2) {
      const h = parseInt(parts[0], 10);
      const m = parseInt(parts[1], 10) || 0;
      const s = parts[2] ? parseInt(parts[2], 10) : 0;
      if (!isNaN(h) && !isNaN(m)) {
        const d = new Date();
        d.setHours(h, m, s, 0);
        return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });
      }
    }

    // Fallback: try Date parsing
    const d = new Date(timeStr);
    if (!isNaN(d)) return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });
  } catch (e) {
    // ignore and fallback to raw
  }
  return timeStr;
}

// Auto-transition settings: how long to keep status 'new' for platform-created appts
const NEW_STATUS_TIMEOUT_MS = 1000 * 60 * 60; // 1 hour

/**
 * Ensure an appointment has a tracking token.
 * If one exists, returns it. If not, creates one and returns it.
 * This ensures every appointment always has a token for tracking purposes.
 * 
 * @param {string} appointmentId - The appointment UUID
 * @param {string} shopId - The shop UUID
 * @returns {Promise<{token: string, shortCode: string, isNew: boolean}|null>} Token info or null on error
 */
async function ensureAppointmentToken(appointmentId, shopId) {
  const supabase = getSupabaseClient();
  if (!supabase || !appointmentId || !shopId) {
    console.warn('[ensureAppointmentToken] Missing required params or supabase client');
    return null;
  }

  try {
    // Check if a valid (non-expired) token already exists
    const { data: existingTokens, error: fetchError } = await supabase
      .from('appointment_tokens')
      .select('token, short_code, expires_at')
      .eq('appointment_id', appointmentId)
      .eq('shop_id', shopId)
      .gte('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(1);

    if (fetchError) {
      console.warn('[ensureAppointmentToken] Error fetching existing token:', fetchError);
    }

    // If valid token exists, return it
    if (existingTokens && existingTokens.length > 0) {
      console.log('[ensureAppointmentToken] Using existing token for appointment:', appointmentId);
      return {
        token: existingTokens[0].token,
        shortCode: existingTokens[0].short_code,
        isNew: false
      };
    }

    // Generate new token
    const token = generateSecureToken();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30); // 30 days expiry

    // Insert new token (short_code is auto-generated by database trigger)
    const { data: newToken, error: insertError } = await supabase
      .from('appointment_tokens')
      .insert({
        token,
        appointment_id: appointmentId,
        shop_id: shopId,
        expires_at: expiresAt.toISOString(),
        sent_via: [],
        recipient_email: null,
        recipient_phone: null
      })
      .select('token, short_code')
      .single();

    if (insertError) {
      console.error('[ensureAppointmentToken] Error creating token:', insertError);
      return null;
    }

    console.log('[ensureAppointmentToken] Created new token for appointment:', appointmentId);
    return {
      token: newToken.token,
      shortCode: newToken.short_code,
      isNew: true
    };

  } catch (e) {
    console.error('[ensureAppointmentToken] Unexpected error:', e);
    return null;
  }
}

/**
 * Generate a cryptographically secure token (browser-compatible)
 * @returns {string} 64-character hex token
 */
function generateSecureToken() {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Fetch and display the tracking code for an appointment in the modal
 * @param {string} appointmentId - The appointment UUID
 * @param {string} shopId - The shop UUID
 */
async function displayTrackingCode(appointmentId, shopId) {
  const trackingCodeSection = document.getElementById('trackingCodeSection');
  const trackingCodeDisplay = document.getElementById('trackingCodeDisplay');
  
  if (!trackingCodeSection || !trackingCodeDisplay) return;
  
  // Hide by default
  trackingCodeSection.style.display = 'none';
  trackingCodeDisplay.textContent = '';
  
  if (!appointmentId || !shopId) return;
  
  const supabase = getSupabaseClient();
  if (!supabase) return;
  
  try {
    // Check for existing token
    const { data: existingTokens, error: fetchError } = await supabase
      .from('appointment_tokens')
      .select('short_code, expires_at')
      .eq('appointment_id', appointmentId)
      .eq('shop_id', shopId)
      .gte('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(1);

    if (fetchError) {
      console.warn('[displayTrackingCode] Error fetching token:', fetchError);
      return;
    }

    if (existingTokens && existingTokens.length > 0 && existingTokens[0].short_code) {
      trackingCodeDisplay.textContent = existingTokens[0].short_code;
      trackingCodeSection.style.display = 'block';
      console.log('[displayTrackingCode] Showing code:', existingTokens[0].short_code);
    } else {
      // No token yet - that's okay, it will be created when they save or send tracker
      console.log('[displayTrackingCode] No tracking code yet for this appointment');
    }
  } catch (e) {
    console.error('[displayTrackingCode] Unexpected error:', e);
  }
}

/**
 * Check appointments and transition platform-created ones from 'new' -> 'scheduled'
 * if they were created more than NEW_STATUS_TIMEOUT_MS ago and they have a schedule.
 */
async function checkAndTransitionNewAppointments(appointments = allAppointments) {
  if (!appointments || !appointments.length) return;
  const now = Date.now();
  let changed = false;
  let transitionedCount = 0;

  for (const appt of appointments) {
    try {
      if (!appt) continue;
      // Only transition appointments created in-platform
      if ((appt.source || '').toLowerCase() !== 'platform') continue;
      if ((appt.status || '').toLowerCase() !== 'new') continue;

      // Must have a scheduled date/time to transition
      if (!appt.preferred_date && !appt.preferred_time) continue;

      const created = appt.created_at ? new Date(appt.created_at).getTime() : 0;
      if (!created) continue;

      if (created + NEW_STATUS_TIMEOUT_MS <= now) {
        appt.status = 'scheduled';
        appt.updated_at = new Date().toISOString();
        changed = true;
        transitionedCount++;
      }
    } catch (e) {
      console.warn('Failed to evaluate appointment for auto-transition', appt, e);
    }
  }

  if (changed) {
    await saveAppointments(appointments);
    console.log(`Auto-transitioned ${transitionedCount} appointment(s) from 'new' to 'scheduled'.`);
  }
}

// Vehicle data for dropdowns with year ranges
const VEHICLE_DATA = {
  'Acura': {
    years: [1990, 2025],
    models: {
      'CL': [1997, 2003],
      'ILX': [2013, 2025],
      'Integra': [1990, 2001],
      'Legend': [1990, 1995],
      'MDX': [2001, 2025],
      'NSX': [1991, 2005],
      'RDX': [2007, 2025],
      'RL': [1996, 2012],
      'RLX': [2014, 2025],
      'RSX': [2002, 2006],
      'TL': [1996, 2014],
      'TLX': [2015, 2025],
      'TSX': [2004, 2014],
      'ZDX': [2010, 2013]
    }
  },
  'Audi': {
    years: [1990, 2025],
    models: {
      'A3': [1997, 2025],
      'A4': [1995, 2025],
      'A5': [2008, 2025],
      'A6': [1994, 2025],
      'A7': [2011, 2025],
      'A8': [1994, 2025],
      'Q3': [2012, 2025],
      'Q5': [2009, 2025],
      'Q7': [2006, 2025],
      'Q8': [2010, 2025],
      'R8': [2007, 2025],
      'S3': [1999, 2025],
      'S4': [1992, 2025],
      'S5': [2008, 2025],
      'S6': [1995, 2025],
      'S7': [2013, 2025],
      'S8': [1995, 2025],
      'SQ5': [2013, 2025],
      'TT': [1999, 2025]
    }
  },
  'BMW': {
    years: [1990, 2025],
    models: {
      '1 Series': [2004, 2025],
      '2 Series': [2014, 2025],
      '3 Series': [1990, 2025],
      '4 Series': [2014, 2025],
      '5 Series': [1990, 2025],
      '6 Series': [1990, 2025],
      '7 Series': [1990, 2025],
      '8 Series': [1990, 2025],
      'M2': [2016, 2025],
      'M3': [1990, 2025],
      'M4': [2014, 2025],
      'M5': [1990, 2025],
      'M6': [1990, 2025],
      'M8': [1990, 2025],
      'X1': [2010, 2025],
      'X2': [2018, 2025],
      'X3': [2004, 2025],
      'X4': [2015, 2025],
      'X5': [2000, 2025],
      'X6': [2008, 2025],
      'X7': [2019, 2025],
      'Z3': [1996, 2002],
      'Z4': [2003, 2025]
    }
  },
  'Buick': {
    years: [1990, 2025],
    models: {
      'Cascada': [2016, 2019],
      'Enclave': [2008, 2025],
      'Encore': [2013, 2025],
      'Envision': [2016, 2025],
      'LaCrosse': [2005, 2025],
      'Lucerne': [2006, 2011],
      'Rainier': [2004, 2007],
      'Regal': [1990, 2025],
      'Rendezvous': [2002, 2007],
      'Terraza': [2005, 2007],
      'Verano': [2012, 2017]
    }
  },
  'Cadillac': {
    years: [1990, 2025],
    models: {
      'ATS': [2013, 2019],
      'BLS': [2006, 2009],
      'CT4': [2020, 2025],
      'CT5': [2020, 2025],
      'CT6': [2016, 2025],
      'CTS': [2003, 2019],
      'DeVille': [1990, 2005],
      'DTS': [2006, 2011],
      'Eldorado': [1990, 2002],
      'Escalade': [1999, 2025],
      'Fleetwood': [1990, 1996],
      'Seville': [1990, 2004],
      'SRX': [2004, 2016],
      'STS': [2005, 2011],
      'XLR': [2004, 2009],
      'XT4': [2019, 2025],
      'XT5': [2017, 2025],
      'XT6': [2020, 2025],
      'XTS': [2013, 2019]
    }
  },
  'Chevrolet': {
    years: [1990, 2025],
    models: {
      'Avalanche': [2002, 2013],
      'Aveo': [2004, 2011],
      'Blazer': [1995, 2025],
      'Bolt': [2017, 2025],
      'Camaro': [1993, 2025],
      'Caprice': [1990, 1996],
      'Captiva': [2012, 2015],
      'Cavalier': [1990, 2005],
      'Chevelle': [1990, 1990], // Limited production in 1990
      'Cobalt': [2005, 2010],
      'Colorado': [2004, 2025],
      'Corvette': [1990, 2025],
      'Cruze': [2011, 2025],
      'Equinox': [2005, 2025],
      'Express': [1997, 2025],
      'HHR': [2006, 2011],
      'Impala': [1994, 2025],
      'Malibu': [1997, 2025],
      'Monte Carlo': [1995, 2007],
      'Silverado': [1999, 2025],
      'Sonic': [2012, 2020],
      'Spark': [2013, 2025],
      'Suburban': [1992, 2025],
      'Tahoe': [1995, 2025],
      'Trailblazer': [2002, 2009],
      'Traverse': [2009, 2025],
      'Trax': [2015, 2025],
      'Uplander': [2005, 2008],
      'Volt': [2011, 2019]
    }
  },
  'Chrysler': {
    years: [1990, 2025],
    models: {
      '200': [2011, 2017],
      '300': [2005, 2025],
      'Aspen': [2007, 2009],
      'Concorde': [1993, 2004],
      'Crossfire': [2004, 2008],
      'Imperial': [1990, 1993],
      'LeBaron': [1990, 1995],
      'LHS': [1994, 2001],
      'Neon': [1995, 2005],
      'Pacifica': [2004, 2025],
      'PT Cruiser': [2001, 2010],
      'Sebring': [1995, 2010],
      'Town & Country': [1990, 2025],
      'Voyager': [2001, 2003]
    }
  },
  'Dodge': {
    years: [1990, 2025],
    models: {
      'Avenger': [1995, 2014],
      'Caliber': [2007, 2012],
      'Caravan': [1990, 2025],
      'Challenger': [2008, 2025],
      'Charger': [2006, 2025],
      'Colt': [1990, 1994],
      'Dakota': [1990, 2011],
      'Dart': [2013, 2016],
      'Durango': [1998, 2025],
      'Grand Caravan': [1990, 2025],
      'Intrepid': [1993, 2004],
      'Journey': [2009, 2020],
      'Magnum': [2005, 2008],
      'Neon': [1995, 2005],
      'Ram': [1994, 2025],
      'Shadow': [1990, 1994],
      'Spirit': [1990, 1995],
      'Sprinter': [2003, 2009],
      'Stealth': [1991, 1996],
      'Stratus': [1995, 2006],
      'Viper': [1992, 2017]
    }
  },
  'Ford': {
    years: [1990, 2025],
    models: {
      'Bronco': [1990, 2025],
      'C-Max': [2013, 2018],
      'Contour': [1995, 2000],
      'Crown Victoria': [1992, 2011],
      'E-Series': [1992, 2025],
      'EcoSport': [2018, 2025],
      'Edge': [2007, 2025],
      'Escape': [2001, 2025],
      'Excursion': [2000, 2005],
      'Expedition': [1997, 2025],
      'Explorer': [1991, 2025],
      'F-150': [1997, 2025],
      'F-250': [1999, 2025],
      'F-350': [1999, 2025],
      'Fiesta': [2011, 2025],
      'Five Hundred': [2005, 2007],
      'Flex': [2009, 2019],
      'Focus': [2000, 2025],
      'Freestar': [2004, 2007],
      'Freestyle': [2005, 2009],
      'Fusion': [2006, 2025],
      'GT': [2005, 2025],
      'Mustang': [1994, 2025],
      'Ranger': [1993, 2011],
      'Taurus': [1990, 2019],
      'Thunderbird': [2002, 2005],
      'Transit': [2015, 2025],
      'Windstar': [1995, 2003]
    }
  },
  'GMC': {
    years: [1990, 2025],
    models: {
      'Acadia': [2007, 2025],
      'Canyon': [2004, 2012],
      'Envoy': [1998, 2009],
      'Jimmy': [1990, 2005],
      'Safari': [1990, 2005],
      'Savana': [1996, 2025],
      'Sierra': [1999, 2025],
      'Sonoma': [1991, 2004],
      'Suburban': [1992, 2025],
      'Terrain': [2010, 2025],
      'Yukon': [1992, 2025],
      'Yukon XL': [2000, 2025]
    }
  },
  'Honda': {
    years: [1990, 2025],
    models: {
      'Accord': [1990, 2025],
      'Civic': [1990, 2025],
      'Clarity': [2017, 2025],
      'CR-V': [1997, 2025],
      'CR-Z': [2011, 2016],
      'Crosstour': [2010, 2015],
      'Element': [2003, 2011],
      'Fit': [2007, 2020],
      'HR-V': [2015, 2025],
      'Insight': [2000, 2025],
      'Odyssey': [1995, 2025],
      'Passport': [1994, 2002],
      'Pilot': [2003, 2025],
      'Prelude': [1990, 2001],
      'Ridgeline': [2006, 2025],
      'S2000': [2000, 2009]
    }
  },
  'Hyundai': {
    years: [1990, 2025],
    models: {
      'Accent': [1995, 2025],
      'Azera': [2006, 2017],
      'Elantra': [1992, 2025],
      'Entourage': [2007, 2009],
      'Equus': [2011, 2016],
      'Genesis': [2009, 2016],
      'Ioniq': [2017, 2025],
      'Kona': [2018, 2025],
      'Nexo': [2018, 2025],
      'Palisade': [2019, 2025],
      'Santa Fe': [2001, 2025],
      'Sonata': [1990, 2025],
      'Tucson': [2005, 2025],
      'Veloster': [2012, 2025],
      'Venue': [2020, 2025],
      'Veracruz': [2007, 2012]
    }
  },
  'Infiniti': {
    years: [1990, 2025],
    models: {
      'EX': [2010, 2013],
      'FX': [2003, 2013],
      'G': [1991, 2013],
      'I': [1996, 2002],
      'JX': [2013, 2014],
      'M': [2003, 2013],
      'Q': [2014, 2025],
      'QX': [2014, 2025]
    }
  },
  'Jeep': {
    years: [1990, 2025],
    models: {
      'Cherokee': [1990, 2025],
      'Comanche': [1990, 1992],
      'Commander': [2006, 2010],
      'Compass': [2007, 2025],
      'Gladiator': [2020, 2025],
      'Grand Cherokee': [1993, 2025],
      'Liberty': [2002, 2012],
      'Patriot': [2007, 2017],
      'Renegade': [2015, 2025],
      'Wrangler': [1990, 2025]
    }
  },
  'Kia': {
    years: [1990, 2025],
    models: {
      'Amanti': [2004, 2009],
      'Borrego': [2009, 2011],
      'Cadenza': [2010, 2025],
      'Carnival': [1999, 2025],
      'Forte': [2010, 2025],
      'K5': [2021, 2025],
      'K900': [2014, 2025],
      'Niro': [2017, 2025],
      'Optima': [2001, 2025],
      'Rio': [2001, 2025],
      'Sedona': [2002, 2025],
      'Seltos': [2020, 2025],
      'Sorento': [2003, 2025],
      'Soul': [2009, 2025],
      'Spectra': [2000, 2009],
      'Sportage': [1995, 2025],
      'Stinger': [2018, 2025],
      'Telluride': [2019, 2025]
    }
  },
  'Lexus': {
    years: [1990, 2025],
    models: {
      'CT': [2011, 2025],
      'ES': [1990, 2025],
      'GS': [1993, 2025],
      'GX': [2003, 2025],
      'HS': [2010, 2012],
      'IS': [1999, 2025],
      'LC': [2018, 2025],
      'LS': [1990, 2025],
      'LX': [1996, 2025],
      'NX': [2015, 2025],
      'RC': [2015, 2025],
      'RX': [1998, 2025],
      'SC': [1992, 2000],
      'UX': [2019, 2025]
    }
  },
  'Lincoln': {
    years: [1990, 2025],
    models: {
      'Aviator': [2003, 2025],
      'Blackwood': [2002, 2002],
      'Continental': [1990, 2025],
      'Corsair': [2020, 2025],
      'LS': [2000, 2006],
      'Mark LT': [2006, 2008],
      'MKC': [2015, 2019],
      'MKS': [2009, 2016],
      'MKT': [2010, 2019],
      'MKX': [2007, 2018],
      'MKZ': [2007, 2025],
      'Nautilus': [2019, 2025],
      'Navigator': [1998, 2025],
      'Town Car': [1990, 2011],
      'Zephyr': [2006, 2006]
    }
  },
  'Mazda': {
    years: [1990, 2025],
    models: {
      '2': [2003, 2025],
      '3': [2004, 2025],
      '5': [2006, 2010],
      '6': [2003, 2025],
      '626': [1990, 2002],
      'B-Series': [1990, 2009],
      'CX-3': [2016, 2025],
      'CX-30': [2020, 2025],
      'CX-5': [2013, 2025],
      'CX-7': [2007, 2012],
      'CX-9': [2007, 2025],
      'Mazda2': [2011, 2025],
      'Mazda3': [2004, 2025],
      'Mazda5': [2006, 2010],
      'Mazda6': [2003, 2025],
      'Mazdaspeed3': [2007, 2013],
      'Mazdaspeed6': [2006, 2007],
      'Miata': [1990, 2025],
      'MPV': [1990, 2006],
      'MX-5': [1990, 2025],
      'Protege': [1990, 2003],
      'RX-7': [1990, 2002],
      'RX-8': [2003, 2011],
      'Tribute': [2001, 2006]
    }
  },
  'Mercedes-Benz': {
    years: [1990, 2025],
    models: {
      'A-Class': [1997, 2025],
      'B-Class': [2005, 2025],
      'C-Class': [1994, 2025],
      'CL-Class': [1998, 2014],
      'CLA': [2014, 2025],
      'CLK': [1998, 2010],
      'CLS': [2005, 2025],
      'E-Class': [1990, 2025],
      'G-Class': [1990, 2025],
      'GL-Class': [2007, 2016],
      'GLA': [2014, 2025],
      'GLB': [2019, 2025],
      'GLC': [2016, 2025],
      'GLE': [2016, 2025],
      'GLK': [2010, 2015],
      'GLS': [2016, 2025],
      'M-Class': [1998, 2015],
      'ML': [1998, 2015],
      'R-Class': [2006, 2013],
      'S-Class': [1990, 2025],
      'SL': [1990, 2025],
      'SLC': [2016, 2025],
      'SLK': [1996, 2025],
      'SLS': [2010, 2014],
      'Sprinter': [2007, 2025]
    }
  },
  'Mercury': {
    years: [1990, 2025],
    models: {
      'Cougar': [1990, 2002],
      'Grand Marquis': [1990, 2011],
      'Marauder': [2003, 2004],
      'Mariner': [2005, 2011],
      'Milan': [2006, 2011],
      'Montego': [2005, 2007],
      'Monterey': [2004, 2007],
      'Mountaineer': [1997, 2010],
      'Mystique': [1995, 2000],
      'Sable': [1990, 2009],
      'Villager': [1993, 2002]
    }
  },
  'Mitsubishi': {
    years: [1990, 2025],
    models: {
      '3000GT': [1991, 2000],
      'Diamante': [1992, 2004],
      'Eclipse': [1990, 2012],
      'Endeavor': [2004, 2011],
      'Galant': [1990, 2012],
      'i-MiEV': [2011, 2013],
      'Lancer': [2002, 2025],
      'Mirage': [2014, 2025],
      'Montero': [1990, 2006],
      'Outlander': [2003, 2025],
      'Raider': [2006, 2009],
      'Sigma': [1990, 1990]
    }
  },
  'Nissan': {
    years: [1990, 2025],
    models: {
      '240SX': [1990, 1998],
      '300ZX': [1990, 2000],
      '350Z': [2003, 2009],
      '370Z': [2009, 2025],
      'Altima': [1993, 2025],
      'Armada': [2004, 2015],
      'Cube': [2009, 2014],
      'Frontier': [1998, 2025],
      'GT-R': [2009, 2025],
      'Juke': [2011, 2025],
      'Kicks': [2018, 2025],
      'Leaf': [2011, 2025],
      'Maxima': [1990, 2025],
      'Murano': [2003, 2025],
      'NV': [2012, 2025],
      'NV200': [2013, 2025],
      'Pathfinder': [1990, 2025],
      'Quest': [1993, 2025],
      'Rogue': [2008, 2025],
      'Rogue Sport': [2017, 2025],
      'Sentra': [1990, 2025],
      'Titan': [2004, 2025],
      'Titan XD': [2016, 2025],
      'Versa': [2007, 2025],
      'Xterra': [2000, 2015]
    }
  },
  'Pontiac': {
    years: [1990, 2025],
    models: {
      'Aztek': [2001, 2005],
      'Bonneville': [1990, 2005],
      'Firebird': [1990, 2002],
      'G5': [2005, 2010],
      'G6': [2005, 2010],
      'G8': [2008, 2009],
      'Grand Am': [1990, 2005],
      'Grand Prix': [1990, 2008],
      'GTO': [2004, 2006],
      'Montana': [1999, 2009],
      'Solstice': [2006, 2009],
      'Sunbird': [1990, 1994],
      'Sunfire': [1995, 2005],
      'Torrent': [2006, 2009],
      'Trans Sport': [1990, 1999],
      'Vibe': [2003, 2010]
    }
  },
  'Porsche': {
    years: [1990, 2025],
    models: {
      '718 Boxster': [2016, 2025],
      '718 Cayman': [2016, 2025],
      '718 Spyder': [2016, 2025],
      '911': [1990, 2025],
      '918 Spyder': [2013, 2015],
      '928': [1990, 1995],
      '944': [1990, 1991],
      '968': [1992, 1995],
      'Boxster': [1996, 2025],
      'Carrera GT': [2004, 2006],
      'Cayenne': [2003, 2025],
      'Cayman': [2006, 2025],
      'Macan': [2014, 2025],
      'Panamera': [2010, 2025],
      'Taycan': [2020, 2025]
    }
  },
  'Ram': {
    years: [1990, 2025],
    models: {
      '1500': [1994, 2025],
      '2500': [1994, 2025],
      '3500': [1994, 2025],
      '4500': [2010, 2025],
      '5500': [2010, 2025],
      'Chassis Cab': [2011, 2025],
      'Dakota': [1997, 2011],
      'Promaster': [2014, 2025],
      'Promaster City': [2015, 2025]
    }
  },
  'Saab': {
    years: [1990, 2025],
    models: {
      '3-Sep': [1990, 1993],
      '5-Sep': [1998, 2009],
      '9-2X': [2005, 2006],
      '9-3': [1999, 2011],
      '9-4X': [2011, 2016],
      '9-5': [1998, 2010],
      '9-7X': [2005, 2009]
    }
  },
  'Saturn': {
    years: [1991, 2010],
    models: {
      'Astra': [2008, 2009],
      'Aura': [2007, 2009],
      'Ion': [2003, 2007],
      'L-Series': [2000, 2005],
      'Outlook': [2007, 2010],
      'Relay': [2005, 2007],
      'S-Series': [1991, 2002],
      'Sky': [2007, 2009],
      'VUE': [2002, 2010]
    }
  },
  'Scion': {
    years: [2004, 2016],
    models: {
      'FR-S': [2013, 2016],
      'iA': [2016, 2016],
      'iM': [2016, 2016],
      'iQ': [2012, 2015],
      'tC': [2005, 2010],
      'xA': [2004, 2006],
      'xB': [2008, 2015],
      'xD': [2008, 2014]
    }
  },
  'Subaru': {
    years: [1990, 2025],
    models: {
      'Ascent': [2019, 2025],
      'B9 Tribeca': [2006, 2008],
      'BRZ': [2013, 2025],
      'Crosstrek': [2013, 2025],
      'Forester': [1998, 2025],
      'Impreza': [1993, 2025],
      'Legacy': [1990, 2025],
      'Outback': [1995, 2025],
      'STI': [2018, 2025],
      'Tribeca': [2006, 2008],
      'WRX': [2015, 2025],
      'XV Crosstrek': [2013, 2025]
    }
  },
  'Suzuki': {
    years: [1990, 2025],
    models: {
      'Aerio': [2002, 2007],
      'Equator': [2009, 2012],
      'Forenza': [2004, 2008],
      'Grand Vitara': [1999, 2013],
      'Kizashi': [2010, 2013],
      'Reno': [2005, 2008],
      'SX4': [2007, 2013],
      'Verona': [2004, 2006],
      'Vitara': [1999, 2003],
      'XL-7': [2000, 2009]
    }
  },
  'Tesla': {
    years: [2008, 2025],
    models: {
      'Model 3': [2017, 2025],
      'Model S': [2012, 2025],
      'Model X': [2016, 2025],
      'Model Y': [2020, 2025],
      'Roadster': [2008, 2025]
    }
  },
  'Toyota': {
    years: [1990, 2025],
    models: {
      '4Runner': [1990, 2025],
      '86': [2013, 2025],
      'Avalon': [1995, 2025],
      'Camry': [1990, 2025],
      'Celica': [1990, 2005],
      'Corolla': [1990, 2025],
      'Cressida': [1990, 1992],
      'Echo': [2000, 2005],
      'FJ Cruiser': [2007, 2025],
      'GR86': [2022, 2025],
      'Highlander': [2001, 2025],
      'Land Cruiser': [1990, 2025],
      'Matrix': [2003, 2013],
      'Mirai': [2016, 2025],
      'MR2': [1990, 2007],
      'Paseo': [1992, 1999],
      'Prius': [2001, 2025],
      'RAV4': [1996, 2025],
      'Sequoia': [2001, 2025],
      'Sienna': [1998, 2025],
      'Solara': [1999, 2008],
      'Supra': [1993, 2025],
      'Tacoma': [1995, 2025],
      'Tundra': [2000, 2025],
      'Venza': [2009, 2015],
      'Yaris': [2007, 2025]
    }
  },
  'Volkswagen': {
    years: [1990, 2025],
    models: {
      'Arteon': [2019, 2025],
      'Atlas': [2018, 2025],
      'Beetle': [1998, 2025],
      'CC': [2009, 2017],
      'Eos': [2007, 2015],
      'Golf': [1990, 2025],
      'GTI': [1990, 2025],
      'ID.4': [2021, 2025],
      'Jetta': [1990, 2025],
      'Passat': [1990, 2025],
      'Phaeton': [2004, 2006],
      'Rabbit': [2006, 2009],
      'Routan': [2009, 2013],
      'Tiguan': [2008, 2025],
      'Touareg': [2004, 2025]
    }
  },
  'Volvo': {
    years: [1990, 2025],
    models: {
      '240': [1990, 1993],
      '740': [1990, 1992],
      '850': [1993, 1997],
      '940': [1990, 1998],
      '960': [1990, 1998],
      'C30': [2007, 2013],
      'C70': [1998, 2013],
      'S40': [2004, 2011],
      'S60': [2001, 2025],
      'S70': [1997, 2000],
      'S80': [1999, 2006],
      'S90': [2017, 2025],
      'V40': [2013, 2019],
      'V50': [2004, 2012],
      'V60': [2015, 2025],
      'V70': [2000, 2007],
      'V90': [2017, 2025],
      'XC40': [2018, 2025],
      'XC60': [2009, 2025],
      'XC70': [2003, 2016],
      'XC90': [2003, 2025]
    }
  }
};

// Expose VEHICLE_DATA to the global window so other components
// (e.g. Parts Finder) can reuse the same vehicle catalog
if (typeof window !== 'undefined') {
  window.VEHICLE_DATA = window.VEHICLE_DATA || VEHICLE_DATA;
}

/**
 * Populate vehicle year dropdown
 */
function populateVehicleYears(selectElement) {
  const currentYear = new Date().getFullYear();
  selectElement.innerHTML = '<option value="">Select Year</option>';
  
  for (let year = currentYear; year >= 1990; year--) {
    const option = document.createElement('option');
    option.value = year.toString();
    option.textContent = year.toString();
    selectElement.appendChild(option);
  }
}

/**
 * Populate vehicle make dropdown, filtered by selected year
 */
function populateVehicleMakes(selectElement, yearSelect = null) {
  const selectedYear = yearSelect ? parseInt(yearSelect.value) : null;
  selectElement.innerHTML = '<option value="">Select Make</option>';
  
  Object.keys(VEHICLE_DATA).sort().forEach(make => {
    // If a year is selected, only include makes that were available in that year
    if (selectedYear && VEHICLE_DATA[make].years) {
      const [startYear, endYear] = VEHICLE_DATA[make].years;
      if (selectedYear < startYear || selectedYear > endYear) {
        return; // Skip this make if it wasn't available in the selected year
      }
    }
    
    const option = document.createElement('option');
    option.value = make;
    option.textContent = make;
    selectElement.appendChild(option);
  });
}

/**
 * Populate vehicle model dropdown based on selected make and year
 */
function populateVehicleModels(makeSelect, modelSelect, yearSelect = null) {
  const selectedMake = makeSelect.value;
  const selectedYear = yearSelect ? parseInt(yearSelect.value) : null;
  modelSelect.innerHTML = '<option value="">Select Model</option>';
  
  if (selectedMake && VEHICLE_DATA[selectedMake] && VEHICLE_DATA[selectedMake].models) {
    Object.keys(VEHICLE_DATA[selectedMake].models).sort().forEach(model => {
      // If a year is selected, only include models that were available in that year
      if (selectedYear && VEHICLE_DATA[selectedMake].models[model]) {
        const [startYear, endYear] = VEHICLE_DATA[selectedMake].models[model];
        if (selectedYear < startYear || selectedYear > endYear) {
          return; // Skip this model if it wasn't available in the selected year
        }
      }
      
      const option = document.createElement('option');
      option.value = model;
      option.textContent = model;
      modelSelect.appendChild(option);
    });
  }
}

// ========== VIN Decoder Functions ==========
let vinDecoderTargetModal = null; // 'new' or 'edit'
let vinDecodedData = null;

// Track which VINs we've already decoded to avoid duplicate decodes
let lastDecodedVin = { new: '', edit: '' };

// VIN Barcode Scanner state
let vinScanner = null;
let vinScannerTargetModal = null; // 'new' or 'edit'
let availableCameras = [];
let currentCameraIndex = 0;

/**
 * Initialize VIN decoder functionality
 * Auto-fires when user enters a valid 17-character VIN
 */
function initVinDecoder() {
  // VIN Decoder Modal buttons
  const closeVinBtn = document.getElementById('closeVinDecoderModal');
  const cancelVinBtn = document.getElementById('cancelVinDecoder');
  const confirmVinBtn = document.getElementById('confirmVinDecoder');
  const vinModal = document.getElementById('vinDecoderModal');
  
  if (closeVinBtn) closeVinBtn.addEventListener('click', closeVinDecoderModal);
  if (cancelVinBtn) cancelVinBtn.addEventListener('click', closeVinDecoderModal);
  if (confirmVinBtn) confirmVinBtn.addEventListener('click', confirmVinDecoder);
  if (vinModal) {
    vinModal.addEventListener('click', (e) => {
      if (e.target === vinModal) closeVinDecoderModal();
    });
  }
  
  // Auto-decode on VIN input (when 17 valid characters entered)
  const naVinInput = document.getElementById('naVin');
  const apptVinInput = document.getElementById('apptVin');
  
  if (naVinInput) {
    naVinInput.addEventListener('input', (e) => {
      const vin = e.target.value.trim().toUpperCase();
      naVinInput.classList.remove('vin-valid', 'vin-decoding');
      
      if (vin.length === 17 && isValidVIN(vin)) {
        // Only decode if this is a new VIN (not one we just decoded)
        if (vin !== lastDecodedVin.new) {
          naVinInput.classList.add('vin-valid');
          // Small delay to let user finish typing/pasting
          setTimeout(() => {
            if (naVinInput.value.trim().toUpperCase() === vin) {
              handleVinDecode('new');
            }
          }, 300);
        }
      }
    });
    
    // Also handle paste events for instant decode
    naVinInput.addEventListener('paste', (e) => {
      setTimeout(() => {
        const vin = naVinInput.value.trim().toUpperCase();
        if (vin.length === 17 && isValidVIN(vin) && vin !== lastDecodedVin.new) {
          naVinInput.classList.add('vin-valid');
          handleVinDecode('new');
        }
      }, 50);
    });
  }
  
  if (apptVinInput) {
    apptVinInput.addEventListener('input', (e) => {
      const vin = e.target.value.trim().toUpperCase();
      apptVinInput.classList.remove('vin-valid', 'vin-decoding');
      
      if (vin.length === 17 && isValidVIN(vin)) {
        if (vin !== lastDecodedVin.edit) {
          apptVinInput.classList.add('vin-valid');
          setTimeout(() => {
            if (apptVinInput.value.trim().toUpperCase() === vin) {
              handleVinDecode('edit');
            }
          }, 300);
        }
      }
    });
    
    apptVinInput.addEventListener('paste', (e) => {
      setTimeout(() => {
        const vin = apptVinInput.value.trim().toUpperCase();
        if (vin.length === 17 && isValidVIN(vin) && vin !== lastDecodedVin.edit) {
          apptVinInput.classList.add('vin-valid');
          handleVinDecode('edit');
        }
      }, 50);
    });
  }
  
  console.log('🔍 VIN Decoder initialized (auto-fire mode)');
  
  // Initialize VIN barcode scanner buttons
  initVinScanner();
}

/**
 * Handle VIN decode - auto-triggered when valid 17-char VIN is entered
 * @param {string} modalType - 'new' or 'edit'
 */
async function handleVinDecode(modalType) {
  vinDecoderTargetModal = modalType;
  
  // Get VIN from the appropriate input
  const vinInput = modalType === 'new' 
    ? document.getElementById('naVin')
    : document.getElementById('apptVin');
  
  const vin = vinInput?.value?.trim().toUpperCase() || '';
  
  if (!vin || !isValidVIN(vin)) {
    return; // Silent return for auto-fire mode
  }
  
  // Check if we already decoded this VIN
  if (vin === lastDecodedVin[modalType]) {
    return;
  }
  
  // Show loading state on the input
  vinInput.classList.remove('vin-valid');
  vinInput.classList.add('vin-decoding');
  
  // Open modal and show loading state
  const modal = document.getElementById('vinDecoderModal');
  const loadingEl = document.getElementById('vinDecoderLoading');
  const errorEl = document.getElementById('vinDecoderError');
  const resultEl = document.getElementById('vinDecoderResult');
  const confirmBtn = document.getElementById('confirmVinDecoder');
  
  if (modal) modal.classList.remove('hidden');
  if (loadingEl) loadingEl.style.display = 'block';
  if (errorEl) errorEl.style.display = 'none';
  if (resultEl) resultEl.style.display = 'none';
  if (confirmBtn) confirmBtn.style.display = 'none';
  
  try {
    const result = await decodeVIN(vin);
    
    if (loadingEl) loadingEl.style.display = 'none';
    
    if (!result.success && !result.partial) {
      if (errorEl) {
        errorEl.textContent = result.error || 'Failed to decode VIN';
        errorEl.style.display = 'block';
      }
      return;
    }
    
    vinDecodedData = result.data;
    
    // Display result
    const vehicleNameEl = document.getElementById('vinVehicleName');
    const vehicleDetailsEl = document.getElementById('vinVehicleDetails');
    const warningEl = document.getElementById('vinWarning');
    
    if (vehicleNameEl) {
      vehicleNameEl.textContent = formatVehicleDisplay(result.data);
    }
    
    if (vehicleDetailsEl) {
      const details = getVehicleDetails(result.data);
      vehicleDetailsEl.innerHTML = details.map(d => `
        <div style="background:var(--bg,#f9fafb);padding:8px;border-radius:6px;">
          <div style="font-size:0.7rem;color:var(--muted);text-transform:uppercase;">${d.label}</div>
          <div style="font-weight:500;">${d.value}</div>
        </div>
      `).join('');
    }
    
    if (warningEl) {
      if (result.warning || result.partial) {
        warningEl.textContent = '⚠️ ' + (result.warning || 'Some information may be incomplete. Please verify.');
        warningEl.style.display = 'block';
      } else {
        warningEl.style.display = 'none';
      }
    }
    
    if (resultEl) resultEl.style.display = 'block';
    if (confirmBtn) confirmBtn.style.display = 'block';
    
    // Clear loading state from input
    vinInput.classList.remove('vin-decoding');
    
  } catch (error) {
    console.error('[VIN Decoder] Error:', error);
    if (loadingEl) loadingEl.style.display = 'none';
    if (errorEl) {
      errorEl.textContent = 'Failed to decode VIN. Please try again.';
      errorEl.style.display = 'block';
    }
    // Clear loading state from input on error
    vinInput.classList.remove('vin-decoding');
  }
}

/**
 * Close VIN decoder modal
 */
function closeVinDecoderModal() {
  const modal = document.getElementById('vinDecoderModal');
  if (modal) modal.classList.add('hidden');
  vinDecodedData = null;
  
  // Clear any loading/valid styling from VIN inputs
  const naVinInput = document.getElementById('naVin');
  const apptVinInput = document.getElementById('apptVin');
  if (naVinInput) naVinInput.classList.remove('vin-valid', 'vin-decoding');
  if (apptVinInput) apptVinInput.classList.remove('vin-valid', 'vin-decoding');
}

/**
 * Confirm VIN decode and populate YMM fields
 */
function confirmVinDecoder() {
  if (!vinDecodedData) {
    closeVinDecoderModal();
    return;
  }
  
  const { year, make, model, vin } = vinDecodedData;
  
  // Get the VIN input element
  const vinInput = vinDecoderTargetModal === 'new'
    ? document.getElementById('naVin')
    : document.getElementById('apptVin');
  
  // Track this VIN as decoded to prevent re-decode
  if (vin) {
    lastDecodedVin[vinDecoderTargetModal] = vin;
  }
  
  if (vinDecoderTargetModal === 'new') {
    // Populate New Appointment modal
    setYMMDropdowns('naVehicleYear', 'naVehicleMake', 'naVehicleModel', year, make, model);
  } else {
    // Populate Edit Appointment modal
    setYMMDropdowns('vehicleYear', 'vehicleMake', 'vehicleModel', year, make, model);
  }
  
  // Clear any styling from VIN input
  if (vinInput) {
    vinInput.classList.remove('vin-valid', 'vin-decoding');
  }
  
  closeVinDecoderModal();
  showNotification(`✅ Vehicle set to ${year} ${make} ${model}`);
}

/**
 * Set Year/Make/Model dropdown values and their corresponding text inputs
 * @param {string} yearId - Year select element ID
 * @param {string} makeId - Make select element ID
 * @param {string} modelId - Model select element ID
 * @param {string} year - Year value
 * @param {string} make - Make value
 * @param {string} model - Model value
 */
function setYMMDropdowns(yearId, makeId, modelId, year, make, model) {
  const yearSelect = document.getElementById(yearId);
  const makeSelect = document.getElementById(makeId);
  const modelSelect = document.getElementById(modelId);
  
  // Also get the floating input elements (if they exist)
  const yearInput = document.getElementById(yearId + 'Input');
  const makeInput = document.getElementById(makeId + 'Input');
  const modelInput = document.getElementById(modelId + 'Input');
  
  // Set Year
  if (yearSelect && year) {
    // Ensure the year option exists
    let yearOption = Array.from(yearSelect.options).find(o => o.value === year.toString());
    if (!yearOption) {
      yearOption = new Option(year.toString(), year.toString());
      yearSelect.add(yearOption);
    }
    yearSelect.value = year.toString();
    yearSelect.dispatchEvent(new Event('change', { bubbles: true }));
    
    // Update floating input if it exists
    if (yearInput) {
      yearInput.value = year.toString();
      yearInput.placeholder = '';
    }
  }
  
  // Trigger make population based on year, then set make
  if (makeSelect && make) {
    // Repopulate makes with the selected year
    populateVehicleMakes(makeSelect, yearSelect);
    
    // Try to find matching make (case-insensitive)
    let makeOption = Array.from(makeSelect.options).find(
      o => o.value.toLowerCase() === make.toLowerCase() || o.text.toLowerCase() === make.toLowerCase()
    );
    
    // If not found, add it
    if (!makeOption) {
      makeOption = new Option(make, make);
      makeSelect.add(makeOption);
    }
    
    makeSelect.value = makeOption.value;
    makeSelect.dispatchEvent(new Event('change', { bubbles: true }));
    
    // Update floating input if it exists
    if (makeInput) {
      makeInput.value = makeOption.text || make;
      makeInput.placeholder = '';
    }
  }
  
  // Trigger model population, then set model
  if (modelSelect && model) {
    // Repopulate models based on make and year
    populateVehicleModels(makeSelect, modelSelect, yearSelect);
    
    // Try to find matching model
    let modelOption = Array.from(modelSelect.options).find(
      o => o.value.toLowerCase() === model.toLowerCase() || o.text.toLowerCase() === model.toLowerCase()
    );
    
    // If not found, add it
    if (!modelOption) {
      modelOption = new Option(model, model);
      modelSelect.add(modelOption);
    }
    
    modelSelect.value = modelOption.value;
    modelSelect.dispatchEvent(new Event('change', { bubbles: true }));
    
    // Update floating input if it exists
    if (modelInput) {
      modelInput.value = modelOption.text || model;
      modelInput.placeholder = '';
    }
  }
}

// ========== VIN Barcode Scanner Functions ==========

/**
 * Initialize VIN barcode scanner
 * Sets up camera scan buttons and modal controls
 */
function initVinScanner() {
  // Camera scan buttons
  const naVinScanBtn = document.getElementById('naVinScanBtn');
  const apptVinScanBtn = document.getElementById('apptVinScanBtn');
  
  if (naVinScanBtn) {
    naVinScanBtn.addEventListener('click', () => openVinScanner('new'));
  }
  if (apptVinScanBtn) {
    apptVinScanBtn.addEventListener('click', () => openVinScanner('edit'));
  }
  
  // Scanner modal controls
  const closeBtn = document.getElementById('closeVinScannerModal');
  const cancelBtn = document.getElementById('cancelVinScanner');
  const switchCameraBtn = document.getElementById('switchCameraBtn');
  const scannerModal = document.getElementById('vinScannerModal');
  
  if (closeBtn) closeBtn.addEventListener('click', closeVinScanner);
  if (cancelBtn) cancelBtn.addEventListener('click', closeVinScanner);
  if (switchCameraBtn) switchCameraBtn.addEventListener('click', switchCamera);
  if (scannerModal) {
    scannerModal.addEventListener('click', (e) => {
      if (e.target === scannerModal) closeVinScanner();
    });
  }
  
  console.log('📷 VIN Barcode Scanner initialized');
}

/**
 * Open VIN barcode scanner modal
 * @param {string} modalType - 'new' or 'edit'
 */
async function openVinScanner(modalType) {
  vinScannerTargetModal = modalType;
  
  const modal = document.getElementById('vinScannerModal');
  const statusEl = document.getElementById('vinScannerStatus');
  const video = document.getElementById('vinScannerVideo');
  
  if (!modal || !video) return;
  
  // Reset camera state
  availableCameras = [];
  currentCameraIndex = 0;
  
  // Reset status
  if (statusEl) {
    statusEl.textContent = 'Requesting camera access...';
    statusEl.className = 'scanner-status';
  }
  
  modal.classList.remove('hidden');
  
  try {
    // Check if browser supports camera
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('Camera not supported in this browser');
    }
    
    if (statusEl) {
      statusEl.textContent = 'Initializing camera...';
    }
    
    // First get permission and enumerate devices
    // Request any camera first to get permission
    const tempStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    
    // Now enumerate devices (will have labels after permission)
    const devices = await navigator.mediaDevices.enumerateDevices();
    availableCameras = devices.filter(d => d.kind === 'videoinput');
    
    console.log('[VIN Scanner] Available cameras:', availableCameras.map((c, i) => ({
      index: i,
      label: c.label || `Camera ${i + 1}`,
      deviceId: c.deviceId.substring(0, 10) + '...'
    })));
    
    // Stop temp stream
    tempStream.getTracks().forEach(track => track.stop());
    
    if (availableCameras.length === 0) {
      throw new Error('No camera found');
    }
    
    // Find back camera - look for keywords in label
    let backCamIndex = availableCameras.findIndex(cam => {
      const label = (cam.label || '').toLowerCase();
      return label.includes('back') || 
             label.includes('rear') || 
             label.includes('environment') ||
             label.includes('facing back');
    });
    
    // On mobile, if we have 2 cameras and no label match, back is usually index 0 or last
    // Try the last one first (common on iOS/Android)
    if (backCamIndex === -1 && availableCameras.length >= 2) {
      backCamIndex = availableCameras.length - 1;
    }
    
    currentCameraIndex = backCamIndex >= 0 ? backCamIndex : 0;
    
    console.log('[VIN Scanner] Using camera index:', currentCameraIndex, 
                'Label:', availableCameras[currentCameraIndex]?.label || 'Unknown');
    
    // Start the selected camera
    const selectedCamera = availableCameras[currentCameraIndex];
    let stream;
    
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: {
          deviceId: selectedCamera.deviceId ? { exact: selectedCamera.deviceId } : undefined,
          width: { ideal: 1280 },
          height: { ideal: 720 }
        },
        audio: false
      });
    } catch (e) {
      console.warn('[VIN Scanner] Specific camera failed, trying facingMode:', e);
      stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 }
        },
        audio: false
      });
    }
    
    // Attach stream to video element
    video.srcObject = stream;
    
    // Wait for video to be ready
    await new Promise((resolve, reject) => {
      video.onloadedmetadata = () => {
        video.play()
          .then(resolve)
          .catch(reject);
      };
      video.onerror = reject;
      setTimeout(() => reject(new Error('Video load timeout')), 5000);
    });
    
    console.log('[VIN Scanner] Camera started, video dimensions:', video.videoWidth, 'x', video.videoHeight);
    
    // Update status
    if (statusEl) {
      statusEl.textContent = 'Position the VIN barcode within the frame';
      statusEl.className = 'scanner-status';
    }
    
    // Start barcode scanning
    startBarcodeScanning();
    
  } catch (error) {
    console.error('[VIN Scanner] Error:', error);
    if (statusEl) {
      let errorMsg = error.message || 'Camera access failed';
      if (error.name === 'NotAllowedError') {
        errorMsg = 'Camera permission denied. Please allow camera access.';
      } else if (error.name === 'NotFoundError') {
        errorMsg = 'No camera found on this device.';
      } else if (error.name === 'NotReadableError') {
        errorMsg = 'Camera is in use by another app.';
      }
      statusEl.textContent = `❌ ${errorMsg}`;
      statusEl.className = 'scanner-status error';
    }
  }
}

/**
 * Start camera video stream
 */
async function startCameraStream() {
  const video = document.getElementById('vinScannerVideo');
  if (!video) return;
  
  // Stop any existing stream
  if (video.srcObject) {
    video.srcObject.getTracks().forEach(track => track.stop());
  }
  
  const selectedCamera = availableCameras[currentCameraIndex];
  
  // Use less strict constraints to avoid OverconstrainedError
  let constraints = {
    video: {
      width: { ideal: 1280 },
      height: { ideal: 720 }
    }
  };
  
  // If we have a specific camera selected, use it
  if (selectedCamera && selectedCamera.deviceId) {
    constraints.video.deviceId = { ideal: selectedCamera.deviceId };
  } else {
    // Otherwise prefer back camera
    constraints.video.facingMode = { ideal: 'environment' };
  }
  
  try {
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    video.srcObject = stream;
    await video.play();
  } catch (error) {
    console.warn('[VIN Scanner] First attempt failed, trying basic constraints:', error);
    
    // Fallback to very basic constraints
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      video.srcObject = stream;
      await video.play();
    } catch (fallbackError) {
      console.error('[VIN Scanner] Camera access failed:', fallbackError);
      throw fallbackError;
    }
  }
}

/**
 * Switch between available cameras
 */
async function switchCamera() {
  if (availableCameras.length < 2) {
    showNotification('Only one camera available', 'error');
    return;
  }
  
  const video = document.getElementById('vinScannerVideo');
  const statusEl = document.getElementById('vinScannerStatus');
  
  if (statusEl) {
    statusEl.textContent = 'Switching camera...';
    statusEl.className = 'scanner-status';
  }
  
  try {
    // Stop current scanning
    if (vinScanner) {
      vinScanner.stop();
      vinScanner = null;
    }
    
    // Stop current stream
    if (video && video.srcObject) {
      video.srcObject.getTracks().forEach(track => track.stop());
      video.srcObject = null;
    }
    
    // Move to next camera
    currentCameraIndex = (currentCameraIndex + 1) % availableCameras.length;
    const selectedCamera = availableCameras[currentCameraIndex];
    
    console.log('[VIN Scanner] Switching to camera index:', currentCameraIndex, 
                'Label:', selectedCamera.label || 'Unknown',
                'DeviceId:', selectedCamera.deviceId?.substring(0, 10) + '...');
    
    // Get new stream with specific device - use ideal to avoid OverconstrainedError
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: {
          deviceId: { exact: selectedCamera.deviceId },
          width: { ideal: 1280 },
          height: { ideal: 720 }
        },
        audio: false
      });
    } catch (e) {
      console.warn('[VIN Scanner] Exact deviceId failed, trying ideal:', e);
      stream = await navigator.mediaDevices.getUserMedia({
        video: {
          deviceId: { ideal: selectedCamera.deviceId },
          width: { ideal: 1280 },
          height: { ideal: 720 }
        },
        audio: false
      });
    }
    
    video.srcObject = stream;
    
    // Wait for video to be ready
    await new Promise((resolve, reject) => {
      video.onloadedmetadata = () => {
        video.play().then(resolve).catch(reject);
      };
      video.onerror = reject;
      setTimeout(() => reject(new Error('Video load timeout')), 5000);
    });
    
    console.log('[VIN Scanner] Camera switched, dimensions:', video.videoWidth, 'x', video.videoHeight);
    
    // Restart scanning
    startBarcodeScanning();
    
    if (statusEl) {
      statusEl.textContent = 'Position the VIN barcode within the frame';
      statusEl.className = 'scanner-status';
    }
  } catch (error) {
    console.error('[VIN Scanner] Camera switch error:', error);
    if (statusEl) {
      statusEl.textContent = `❌ Failed to switch camera`;
      statusEl.className = 'scanner-status error';
    }
  }
}

/**
 * Start barcode scanning using BarcodeDetector API (native) or html5-qrcode fallback
 */
function startBarcodeScanning() {
  const video = document.getElementById('vinScannerVideo');
  if (!video || !video.srcObject) {
    console.error('[VIN Scanner] No video stream available');
    return;
  }
  
  // Create canvas for frame capture (not attached to DOM)
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  
  // Scan interval
  let scanInterval = null;
  let isScanning = true;
  
  // Check for native BarcodeDetector API (Chrome 83+, Edge 83+)
  let barcodeDetector = null;
  
  if ('BarcodeDetector' in window) {
    try {
      // CODE_39 and CODE_128 are common VIN barcode formats
      barcodeDetector = new BarcodeDetector({ 
        formats: ['code_39', 'code_128', 'code_93', 'codabar'] 
      });
      console.log('[VIN Scanner] Using native BarcodeDetector API');
    } catch (e) {
      console.log('[VIN Scanner] BarcodeDetector not fully supported');
    }
  }
  
  const performScan = async () => {
    if (!isScanning) return;
    
    // Make sure video is still playing
    if (!video.srcObject || video.readyState < 2) {
      return;
    }
    
    try {
      // Set canvas size to match video
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      
      if (vw === 0 || vh === 0) return;
      
      canvas.width = vw;
      canvas.height = vh;
      
      // Draw current video frame to canvas
      ctx.drawImage(video, 0, 0, vw, vh);
      
      let foundVin = null;
      
      // Try native BarcodeDetector first (faster)
      if (barcodeDetector) {
        try {
          const barcodes = await barcodeDetector.detect(canvas);
          for (const barcode of barcodes) {
            const cleanResult = barcode.rawValue.trim().toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/g, '');
            if (cleanResult.length === 17 && isValidVIN(cleanResult)) {
              foundVin = cleanResult;
              console.log('[VIN Scanner] Native detector found VIN:', foundVin);
              break;
            }
          }
        } catch (e) {
          // Native detector failed on this frame, continue
        }
      }
      
      // Fallback to html5-qrcode if no native result (slower, do less frequently)
      if (!foundVin && typeof Html5Qrcode !== 'undefined' && Math.random() < 0.3) {
        try {
          const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.8));
          if (blob && blob.size > 0) {
            const file = new File([blob], 'frame.jpg', { type: 'image/jpeg' });
            
            // Create a temporary hidden div for html5-qrcode (it needs a DOM element)
            let tempDiv = document.getElementById('vinScannerTemp');
            if (!tempDiv) {
              tempDiv = document.createElement('div');
              tempDiv.id = 'vinScannerTemp';
              tempDiv.style.cssText = 'position:absolute;left:-9999px;top:-9999px;width:1px;height:1px;overflow:hidden;';
              document.body.appendChild(tempDiv);
            }
            
            const html5QrCode = new Html5Qrcode('vinScannerTemp', { verbose: false });
            
            try {
              const result = await html5QrCode.scanFile(file, false);
              const cleanResult = result.trim().toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/g, '');
              if (cleanResult.length === 17 && isValidVIN(cleanResult)) {
                foundVin = cleanResult;
                console.log('[VIN Scanner] Html5Qrcode found VIN:', foundVin);
              }
            } catch (scanErr) {
              // No barcode found in this frame
            }
            
            try { 
              await html5QrCode.clear(); 
            } catch (e) {}
          }
        } catch (e) {
          // Fallback failed, continue
        }
      }
      
      // Handle found VIN
      if (foundVin) {
        isScanning = false;
        if (scanInterval) {
          clearInterval(scanInterval);
          scanInterval = null;
        }
        handleScannedVin(foundVin);
      }
      
    } catch (error) {
      // Frame capture error, continue
      console.warn('[VIN Scanner] Scan frame error:', error);
    }
  };
  
  // Store scanner reference for cleanup
  vinScanner = {
    stop: () => {
      isScanning = false;
      if (scanInterval) {
        clearInterval(scanInterval);
        scanInterval = null;
      }
      // Clean up temp div
      const tempDiv = document.getElementById('vinScannerTemp');
      if (tempDiv) tempDiv.remove();
    }
  };
  
  // Start scanning after video is ready
  const startScanning = () => {
    if (video.readyState >= 2) {
      console.log('[VIN Scanner] Starting barcode scanning loop');
      scanInterval = setInterval(performScan, 200);
      performScan();
    } else {
      video.addEventListener('loadeddata', () => {
        console.log('[VIN Scanner] Video loaded, starting scan loop');
        scanInterval = setInterval(performScan, 200);
        performScan();
      }, { once: true });
    }
  };
  
  startScanning();
}

/**
 * Handle successfully scanned VIN
 * @param {string} vin - The scanned VIN
 */
function handleScannedVin(vin) {
  const statusEl = document.getElementById('vinScannerStatus');
  
  // Show success state
  if (statusEl) {
    statusEl.textContent = `✅ VIN Found: ${vin}`;
    statusEl.className = 'scanner-status success';
  }
  
  // Populate VIN input
  const vinInput = vinScannerTargetModal === 'new'
    ? document.getElementById('naVin')
    : document.getElementById('apptVin');
  
  if (vinInput) {
    vinInput.value = vin;
    // Trigger input event to start auto-decode
    vinInput.dispatchEvent(new Event('input', { bubbles: true }));
  }
  
  // Close scanner after short delay
  setTimeout(() => {
    closeVinScanner();
  }, 800);
}

/**
 * Close VIN scanner modal and cleanup
 */
function closeVinScanner() {
  const modal = document.getElementById('vinScannerModal');
  const video = document.getElementById('vinScannerVideo');
  
  // Stop scanner
  if (vinScanner) {
    vinScanner.stop();
    vinScanner = null;
  }
  
  // Stop camera stream
  if (video && video.srcObject) {
    video.srcObject.getTracks().forEach(track => track.stop());
    video.srcObject = null;
  }
  
  // Hide modal
  if (modal) {
    modal.classList.add('hidden');
  }
  
  // Reset state
  vinScannerTargetModal = null;
}

/**
 * Get current user's shop ID
 */
function getCurrentShopId() {
  try {
    const session = JSON.parse(localStorage.getItem('xm_session') || '{}');
    return session.shopId || null;
  } catch (e) {
    return null;
  }
}

/**
 * Get current user info (sync - from localStorage)
 */
function getCurrentUser() {
  try {
    const session = JSON.parse(localStorage.getItem('xm_session') || '{}');
    const users = JSON.parse(localStorage.getItem('xm_users') || '[]');
    return users.find(u => u.email === session.email) || {};
  } catch (e) {
    return {};
  }
}

/**
 * Get current user with role (async - from Supabase shop_staff)
 */
async function getCurrentUserWithRole() {
  const supabase = getSupabaseClient();
  if (!supabase) return getCurrentUser();
  
  try {
    const { data: authData } = await supabase.auth.getUser();
    const authUser = authData?.user;
    if (!authUser) return getCurrentUser();
    
    // Check shop_staff table for role
    const { data: staffData } = await supabase
      .from('shop_staff')
      .select('*')
      .eq('auth_id', authUser.id)
      .limit(1);
    
    if (staffData && staffData.length > 0) {
      const staff = staffData[0];
      return {
        id: staff.id || authUser.id,
        auth_id: authUser.id,
        first: staff.first_name || '',
        last: staff.last_name || '',
        email: staff.email || authUser.email,
        role: staff.role || 'staff',
        shop_id: staff.shop_id
      };
    }
    
    // Fallback to email lookup
    if (authUser.email) {
      const { data: emailData } = await supabase
        .from('shop_staff')
        .select('*')
        .ilike('email', authUser.email)
        .limit(1);
      
      if (emailData && emailData.length > 0) {
        const staff = emailData[0];
        return {
          id: staff.id || authUser.id,
          auth_id: authUser.id,
          first: staff.first_name || '',
          last: staff.last_name || '',
          email: staff.email || authUser.email,
          role: staff.role || 'staff',
          shop_id: staff.shop_id
        };
      }
    }
    
    // Check users table for admin/owner
    const { data: userData } = await supabase
      .from('users')
      .select('*')
      .eq('id', authUser.id)
      .limit(1)
      .single();
    
    if (userData) {
      return {
        id: userData.id,
        auth_id: authUser.id,
        first: userData.first || '',
        last: userData.last || '',
        email: userData.email || authUser.email,
        role: userData.role || 'admin',
        shop_id: userData.shop_id
      };
    }
    
    return getCurrentUser();
  } catch (e) {
    console.warn('getCurrentUserWithRole failed:', e);
    return getCurrentUser();
  }
}

/**
 * Get current authenticated user's ID
 */
async function getCurrentAuthId() {
  const supabase = getSupabaseClient();
  if (!supabase) return null;
  
  try {
    const { data: authData } = await supabase.auth.getUser();
    return authData?.user?.id || null;
  } catch (error) {
    console.error('[Appointments] Error getting auth ID:', error);
    return null;
  }
}

/**
 * Claim appointment - assigns the current staff member to the related job
 */
async function claimAppointment(appt) {
  try {
    const currentUser = await getCurrentUserWithRole();
    if (!currentUser) {
      showNotification('Unable to claim: User not found', 'error');
      return;
    }
    
    // Use auth_id for consistent assignment tracking
    const assignToId = currentUser.auth_id || currentUser.id;
    if (!assignToId) {
      showNotification('Unable to claim: User ID not found', 'error');
      return;
    }
    
    const supabase = getSupabaseClient();
    const shopId = getCurrentShopId();
    
    // Find or create job for this appointment
    let job = null;
    let jobId = null;
    
    if (supabase) {
      // Get jobs from Supabase data table
      const { data } = await supabase.from('data').select('jobs').eq('shop_id', shopId).single();
      const jobs = data?.jobs || [];
      job = jobs.find(j => j.appointment_id === appt.id);
      
      if (!job) {
        // Create a job for this appointment
        jobId = `job_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        job = {
          id: jobId,
          appointment_id: appt.id,
          shop_id: shopId,
          customer: appt.customer || '',
          vehicle: appt.vehicle || '',
          service: appt.service || '',
          status: 'pending',
          assigned_to: assignToId,
          parts: [],
          labor: [],
          notes: [],
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        };
        jobs.push(job);
        
        // Save to data table's jobs JSONB
        await supabase.from('data').update({ jobs }).eq('shop_id', shopId);
        
        // Also insert into jobs table
        const { error: jobError } = await supabase.from('jobs').insert({
          id: jobId,
          shop_id: shopId,
          appointment_id: appt.id,
          assigned_to: assignToId,
          status: 'pending',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        });
        
        if (jobError) {
          console.error('Error creating job in jobs table:', jobError);
          throw jobError;
        }
      } else {
        // Update existing job assignment in jobs table
        const { error: updateError } = await supabase
          .from('jobs')
          .update({ 
            assigned_to: assignToId,
            updated_at: new Date().toISOString()
          })
          .eq('id', job.id);
        
        if (updateError) {
          console.error('Error updating job in jobs table:', updateError);
          throw updateError;
        }
        
        // Also update data table's jobs JSONB
        const jobIndex = jobs.findIndex(j => j.id === job.id);
        if (jobIndex >= 0) {
          jobs[jobIndex].assigned_to = assignToId;
          jobs[jobIndex].updated_at = new Date().toISOString();
          await supabase.from('data').update({ jobs }).eq('shop_id', shopId);
        }
      }
      
      console.log('Job claimed in jobs table');
    } else {
      // localStorage fallback
      const localData = JSON.parse(localStorage.getItem('xm_data') || '{}');
      localData.jobs = localData.jobs || [];
      job = localData.jobs.find(j => j.appointment_id === appt.id);
      
      if (!job) {
        job = {
          id: `job_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          appointment_id: appt.id,
          shop_id: shopId,
          customer: appt.customer || '',
          vehicle: appt.vehicle || '',
          service: appt.service || '',
          status: 'pending',
          assigned_to: assignToId,
          parts: [],
          labor: [],
          notes: [],
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        };
        localData.jobs.push(job);
      } else {
        const jobIndex = localData.jobs.findIndex(j => j.id === job.id);
        if (jobIndex >= 0) {
          localData.jobs[jobIndex].assigned_to = assignToId;
          localData.jobs[jobIndex].updated_at = new Date().toISOString();
        }
      }
      
      localStorage.setItem('xm_data', JSON.stringify(localData));
    }
    
    showNotification(`Job claimed successfully!`, 'success');
    
    // Refresh table to show claimed state
    await renderAppointments();
    
  } catch (error) {
    console.error('Error claiming appointment:', error);
    showNotification('Failed to claim appointment', 'error');
  }
}

/**
 * Unclaim appointment - removes the current staff member assignment from the job
 */
async function unclaimAppointment(appt) {
  try {
    const supabase = getSupabaseClient();
    const shopId = getCurrentShopId();
    
    if (supabase) {
      // Get jobs from Supabase data table
      const { data } = await supabase.from('data').select('jobs').eq('shop_id', shopId).single();
      const jobs = data?.jobs || [];
      const jobIndex = jobs.findIndex(j => j.appointment_id === appt.id);
      
      if (jobIndex >= 0) {
        const jobId = jobs[jobIndex].id;
        
        // Update jobs table
        const { error: jobsError } = await supabase
          .from('jobs')
          .update({ 
            assigned_to: null,
            updated_at: new Date().toISOString()
          })
          .eq('id', jobId);
        
        if (jobsError) {
          console.error('Error updating jobs table:', jobsError);
          throw jobsError;
        }
        
        // Update data table's jobs JSONB
        jobs[jobIndex].assigned_to = null;
        jobs[jobIndex].updated_at = new Date().toISOString();
        
        // Save jobs back to Supabase data table
        const { error } = await supabase.from('data').update({ jobs }).eq('shop_id', shopId);
        if (error) throw error;
        
        console.log('Job unclaimed in jobs table');
      }
    } else {
      // localStorage fallback
      const localData = JSON.parse(localStorage.getItem('xm_data') || '{}');
      localData.jobs = localData.jobs || [];
      const jobIndex = localData.jobs.findIndex(j => j.appointment_id === appt.id);
      
      if (jobIndex >= 0) {
        localData.jobs[jobIndex].assigned_to = null;
        localData.jobs[jobIndex].updated_at = new Date().toISOString();
        localStorage.setItem('xm_data', JSON.stringify(localData));
      }
    }
    
    showNotification(`Job unclaimed`, 'success');
    
    // Refresh table
    await renderAppointments();
    
  } catch (error) {
    console.error('Error unclaiming appointment:', error);
    showNotification('Failed to unclaim appointment', 'error');
  }
}

/**
 * Save or update vehicle in Supabase vehicles table
 */
async function upsertVehicleToSupabase(customerId, shopId, vehicleData) {
  const supabase = getSupabaseClient();
  if (!supabase) return null;
  
  try {
    // Get year, make, model from separate fields
    const year = vehicleData.vehicle_year || vehicleData.year || '';
    const make = vehicleData.vehicle_make || vehicleData.make || '';
    const model = vehicleData.vehicle_model || vehicleData.model || '';
    
    // Check if vehicle already exists for this customer (by VIN if available)
    let existingVehicle = null;
    
    if (vehicleData.vin) {
      const { data: vinMatch } = await supabase
        .from('vehicles')
        .select('*')
        .eq('customer_id', customerId)
        .eq('vin', vehicleData.vin)
        .single();
      
      if (vinMatch) existingVehicle = vinMatch;
    }
    
    // If no VIN match, try matching by year/make/model
    if (!existingVehicle && year && make && model) {
      const { data: ymmMatch } = await supabase
        .from('vehicles')
        .select('*')
        .eq('customer_id', customerId)
        .eq('year', year)
        .eq('make', make)
        .eq('model', model)
        .single();
      
      if (ymmMatch) existingVehicle = ymmMatch;
    }
    
    const vehiclePayload = {
      id: existingVehicle?.id || getUUID(),
      customer_id: customerId,
      shop_id: shopId,
      vin: vehicleData.vin || '',
      year: year,
      make: make,
      model: model,
      trim: vehicleData.trim || '',
      plate: vehicleData.plate || '',
      vehicle_notes: vehicleData.vehicle_notes || '',
      is_primary: existingVehicle ? existingVehicle.is_primary : true, // First vehicle is primary
      created_at: existingVehicle?.created_at || new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    
    const { data, error } = await supabase
      .from('vehicles')
      .upsert(vehiclePayload, { onConflict: 'id' })
      .select()
      .single();
    
    if (error) {
      console.error('❌ Error upserting vehicle:', error);
      return null;
    }
    
    console.log('✅ Vehicle upserted to vehicles table:', data);
    return data;
  } catch (err) {
    console.error('❌ Exception upserting vehicle:', err);
    return null;
  }
}

/**
 * Save or update customer in Supabase customers table
 * Also saves vehicle to vehicles table if provided
 */
async function upsertCustomerToSupabase(customerData) {
  const supabase = getSupabaseClient();
  if (!supabase) return null;
  
  try {
    const shopId = getCurrentShopId();
    if (!shopId) return null;
    // Check if customer already exists by phone/email in this shop
    let existingCustomer = null;
    if (customerData.phone) {
      const { data: phoneMatch } = await supabase
        .from('customers')
        .select('*')
        .eq('shop_id', shopId)
        .eq('phone', customerData.phone)
        .maybeSingle();
      if (phoneMatch) existingCustomer = phoneMatch;
    }
    if (!existingCustomer && customerData.email) {
      const { data: emailMatch } = await supabase
        .from('customers')
        .select('*')
        .eq('shop_id', shopId)
        .eq('email', customerData.email)
        .maybeSingle();
      if (emailMatch) existingCustomer = emailMatch;
    }
    // Standardize customer fields
    customerData.customer_id = existingCustomer?.id || customerData.customer_id || getUUID();
    // Always fill customer_first and customer_last from appointment info, fallback to splitting combined customer string
    if (!customerData.customer_first || !customerData.customer_last) {
      if (customerData.customer) {
        const nameParts = customerData.customer.trim().split(' ');
        customerData.customer_first = customerData.customer_first || nameParts[0] || '';
        customerData.customer_last = customerData.customer_last || nameParts.slice(1).join(' ') || '';
      }
    }
    if (!customerData.customer_first || !customerData.customer_last) {
      console.error('❌ upsertCustomerToSupabase: customer_first or customer_last is blank!', customerData);
      throw new Error('customer_first and customer_last must not be blank');
    }
    // No fallback to 'Unknown' -- if blank, will remain blank and should be caught as a bug
    // Only use existingCustomer if both phone/email and name match
    let customerId;
    if (existingCustomer &&
        existingCustomer.customer_first === customerData.customer_first &&
        existingCustomer.customer_last === customerData.customer_last) {
      customerId = existingCustomer.id;
    } else {
      customerId = getUUID();
    }
    const customerPayload = {
      id: customerId,
      shop_id: shopId,
      customer_first: customerData.customer_first,
      customer_last: customerData.customer_last,
      email: customerData.email || '',
      phone: customerData.phone || '',
      // Only include a simple vehicle string on the customers row. Structured vehicle
      // fields are saved to the `vehicles` table via `upsertVehicleToSupabase` below.
      vehicle: customerData.vehicle || '',
      zipcode: customerData.zipcode || '',
      notes: customerData.notes || '',
      created_at: existingCustomer?.created_at || new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    // Payload prepared for upsert (debug logging removed)
    const { data, error } = await supabase
      .from('customers')
      .upsert(customerPayload, { onConflict: 'id' })
      .select()
      .single();
    if (error) {
      try {
        console.error('❌ Error upserting customer:', error, JSON.stringify(error));
      } catch (e) {
        console.error('❌ Error upserting customer (could not stringify):', error);
      }
      // If Supabase returned a detailed message, log it for debugging
      if (error?.message || error?.details) {
        console.error('Supabase error message:', error.message, 'details:', error.details);
      }
      return null;
    }
    console.log('✅ Customer upserted to customers table:', data);
    // Save vehicle with correct customer_id
    if (customerData.vehicle || customerData.vin) {
      await upsertVehicleToSupabase(customerId, shopId, customerData);
    }
    return data;
  } catch (err) {
    console.error('❌ Exception upserting customer:', err);
    return null;
  }
}

/**
 * Load appointments from Supabase
 */
async function loadAppointments() {
  const shopId = getCurrentShopId();
  if (!shopId) {
    console.warn('No shop ID found');
    return [];
  }

  const supabase = getSupabaseClient();
  
  try {
    if (supabase) {
      // Load from Supabase data table
      const { data, error } = await supabase
        .from('data')
        .select('appointments')
        .eq('shop_id', shopId)
        .single();
      
      if (error) {
        console.warn('Error loading appointments from Supabase:', error);
        throw error;
      }
      
      const appts = data?.appointments || [];
      // Ensure customer_first and customer_last are set for each appointment
      appts.forEach(appt => {
        if ((!appt.customer_first || !appt.customer_last) && appt.customer) {
          const nameParts = appt.customer.trim().split(' ');
          appt.customer_first = nameParts[0] || '';
          appt.customer_last = nameParts.slice(1).join(' ') || '';
        }
      });
      // Fix customer names from customer_id if available
      try {
        const { data: customers } = await supabase
          .from('customers')
          .select('id, customer_first, customer_last')
          .eq('shop_id', shopId);
        const customerMap = new Map(customers?.map(c => [c.id, c]) || []);
        appts.forEach(appt => {
          if (appt.customer_id && customerMap.has(appt.customer_id)) {
            const cust = customerMap.get(appt.customer_id);
            appt.customer_first = cust.customer_first;
            appt.customer_last = cust.customer_last;
          }
          // Also fix if customer_first is a UUID
          if (appt.customer_first && /^[0-9a-f-]{36}$/.test(appt.customer_first) && customerMap.has(appt.customer_first)) {
            const cust = customerMap.get(appt.customer_first);
            appt.customer_first = cust.customer_first;
            appt.customer_last = cust.customer_last;
          }
          // Also fix if customer is a UUID
          if (appt.customer && /^[0-9a-f-]{36}$/.test(appt.customer) && customerMap.has(appt.customer)) {
            const cust = customerMap.get(appt.customer);
            appt.customer = `${cust.customer_first} ${cust.customer_last}`.trim();
          }
        });
      } catch (e) {
        console.warn('[appointments.js] Could not fix customer names:', e);
      }
      return appts;
    }
  } catch (ex) {
    console.warn('Supabase load failed, using localStorage:', ex);
  }
  
  // Fallback to localStorage
  try {
    const localData = JSON.parse(localStorage.getItem('xm_data') || '{}');
    const appts = (localData.appointments || []).filter(a => a.shop_id === shopId);
    appts.forEach(appt => {
      if ((!appt.customer_first || !appt.customer_last) && appt.customer) {
        const nameParts = appt.customer.trim().split(' ');
        appt.customer_first = nameParts[0] || '';
        appt.customer_last = nameParts.slice(1).join(' ') || '';
      }
    });
    return appts;
  } catch (e) {
    return [];
  }
}

/**
 * Save appointments to Supabase
 */
async function saveAppointments(appointments) {
  const shopId = getCurrentShopId();
  if (!shopId) return false;

  const supabase = getSupabaseClient();
  
  try {
    if (supabase) {
      // Get current data
      const { data: currentData, error: fetchError } = await supabase
        .from('data')
        .select('*')
        .eq('shop_id', shopId)
        .single();
      
      if (fetchError && fetchError.code !== 'PGRST116') { // PGRST116 = no rows
        throw fetchError;
      }
      
      // Upsert with appointments
      const payload = {
        shop_id: shopId,
        appointments: appointments,
        settings: currentData?.settings || {},
        jobs: currentData?.jobs || [],
        threads: currentData?.threads || [],
        invoices: currentData?.invoices || [],
        updated_at: new Date().toISOString()
      };
      
      const { error: upsertError } = await supabase
        .from('data')
        .upsert(payload, { onConflict: 'shop_id' });
      
      if (upsertError) throw upsertError;
      
      // Also insert/update appointments in appointments table
      for (const appt of appointments) {
        // Skip appointments with old string IDs (not UUIDs)
        if (appt.id.includes('_')) {
          console.log('Skipping upsert for old appointment ID:', appt.id);
          continue;
        }
        // Use customer_first and customer_last directly
        const customer_first = appt.customer_first || '';
        const customer_last = appt.customer_last || '';
        
        // DON'T auto-upsert customer - only save customer when explicitly requested
        // Customer should only be saved via the "Save Customer" button
        
        // Save appointment with customer info (but no customer_id auto-linkage)
        const apptPayload = {
          id: appt.id,
          shop_id: shopId,
          customer_id: appt.customer_id || null,
          customer_first,
          customer_last,
          email: appt.email || '',
          phone: appt.phone || '',
          vehicle: appt.vehicle || '',
          vin: appt.vin || '',
          service: appt.service || '',
          preferred_date: appt.preferred_date || null,
          preferred_time: appt.preferred_time || null,
          status: appt.status || 'new',
          source: appt.source || 'walk-in',
          created_at: appt.created_at,
          updated_at: appt.updated_at
        };
        const { error: apptError } = await supabase
          .from('appointments')
          .upsert(apptPayload, { onConflict: 'id' });
        if (apptError) {
          console.log('Failed to upsert appointment:');
          console.log('Error code:', apptError.code);
          console.log('Error message:', apptError.message);
          console.log('Error details:', apptError.details);
          console.log('Full error object:', apptError);
          try {
            console.log('Error as JSON:', JSON.stringify(apptError, null, 2));
          } catch (e) {
            console.log('Could not stringify error');
          }
          console.log('Appointment payload that failed:', apptPayload);
        }
      }
      
      console.log('✅ Appointments saved to Supabase');
      return true;
    }
  } catch (ex) {
    console.warn('Supabase save failed, using localStorage:', ex);
  }
  
  // Fallback to localStorage
  try {
    const localData = JSON.parse(localStorage.getItem('xm_data') || '{}');
    localData.appointments = localData.appointments || [];
    
    // Remove old appointments for this shop
    localData.appointments = localData.appointments.filter(a => a.shop_id !== shopId);
    
    // Add new appointments
    localData.appointments.push(...appointments);
    
    localStorage.setItem('xm_data', JSON.stringify(localData));
    console.log('✅ Appointments saved to localStorage');
    return true;
  } catch (e) {
    console.error('Failed to save appointments:', e);
    return false;
  }
}

/**
 * Render appointments table
 */
// Store current user info for claim checking
let currentUserForClaim = null;

async function renderAppointments(appointments = allAppointments) {
  const tbody = document.querySelector('#apptTable tbody');
  const empty = document.getElementById('apptEmpty');
  
  if (!tbody) return;
  
  tbody.innerHTML = '';
  
  if (appointments.length === 0) {
    if (empty) empty.textContent = 'No appointments found.';
    return;
  }
  
  if (empty) empty.textContent = '';
  
  // For staff users, fetch fresh jobs data from Supabase to check assignments
  let jobsData = [];
  if (isStaffUser && currentUserForClaim) {
    try {
      const supabase = getSupabaseClient();
      const shopId = getCurrentShopId();
      if (supabase && shopId) {
        const { data } = await supabase
          .from('jobs')
          .select('id, appointment_id, assigned_to')
          .eq('shop_id', shopId);
        if (data) jobsData = data;
      }
    } catch (e) {
      console.warn('Could not fetch jobs for staff highlighting:', e);
    }

      // If view modal is open for an appointment, refresh its assigned-to display
      try {
        if (currentViewApptId) {
          updateViewModalAssignedTo(currentViewApptId).catch(() => {});
        }
      } catch (e) {}
  }
  
  // Fetch notes to show indicator dot for UNREAD notes only
  let unreadNotesMap = {};
  try {
    const supabase = getSupabaseClient();
    if (supabase) {
      const appointmentIds = appointments.map(a => a.id);
      const { data: notesData } = await supabase
        .from('appointment_notes')
        .select('id, appointment_id')
        .in('appointment_id', appointmentIds);
      
      if (notesData) {
        const readIds = getReadNoteIds();
        notesData.forEach(n => {
          // Only count unread notes
          if (!readIds.has(n.id)) {
            unreadNotesMap[n.appointment_id] = (unreadNotesMap[n.appointment_id] || 0) + 1;
          }
        });
      }
    }
  } catch (e) {
    console.warn('Could not fetch notes for indicators:', e);
  }
  
  // Get staff auth_id for consistent comparison
  const staffAuthId = currentUserForClaim?.auth_id || currentUserForClaim?.id;
  
  // Apply sorting based on header clicks
  const sorted = [...appointments].sort((a, b) => {
    const col = apptSortCol;
    const dir = apptSortDir === 'asc' ? 1 : -1;
    let va, vb;
    switch (col) {
      case 'created':
        va = new Date(a.created_at || 0).getTime();
        vb = new Date(b.created_at || 0).getTime();
        break;
      case 'customer':
        va = (a.customer || '').toLowerCase(); vb = (b.customer || '').toLowerCase();
        break;
      case 'vehicle':
        va = (a.vehicle || '').toLowerCase(); vb = (b.vehicle || '').toLowerCase();
        break;
      case 'service':
        va = (a.service || '').toLowerCase(); vb = (b.service || '').toLowerCase();
        break;
      case 'scheduled':
        va = new Date(a.preferred_date || 0).getTime(); vb = new Date(b.preferred_date || 0).getTime();
        break;
      case 'time':
        // compare preferred_date first then preferred_time
        va = (a.preferred_date || '') + ' ' + (a.preferred_time || '');
        vb = (b.preferred_date || '') + ' ' + (b.preferred_time || '');
        break;
      case 'status':
        va = (a.status || '').toLowerCase(); vb = (b.status || '').toLowerCase();
        break;
      default:
        va = (a.customer || '').toLowerCase(); vb = (b.customer || '').toLowerCase();
    }

    if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
    if (va < vb) return -1 * dir;
    if (va > vb) return 1 * dir;
    return 0;
  });
  
  sorted.forEach(appt => {
    // Check if this appointment has a job assigned to the current staff user
    let isAssignedToMe = false;
    if (isStaffUser && staffAuthId && jobsData.length > 0) {
      const job = jobsData.find(j => j.appointment_id === appt.id);
      isAssignedToMe = job && String(job.assigned_to) === String(staffAuthId);
    }
    
    const tr = document.createElement('tr');
    tr.dataset.apptId = appt.id;
    
    // Add green highlight for staff's assigned appointments
    if (isStaffUser && isAssignedToMe) {
      tr.classList.add('staff-claimed');
    }
    
    // On mobile, make row clickable
    if (window.matchMedia && window.matchMedia('(max-width: 768px)').matches) {
      tr.classList.add('appt-row-clickable');
      tr.addEventListener('click', (e) => {
        // Only trigger if not clicking a button inside the row
        if (e.target.closest('button')) return;
        // For staff users, show action modal with View/Claim options
        // For admin/owner, show admin action modal with full options
        if (isStaffUser) {
          openStaffActionModal(appt);
        } else {
          openAdminActionModal(appt);
        }
      });
    }
    
    // Note indicator dot (first column)
    const tdDot = document.createElement('td');
    tdDot.style.cssText = 'width: 20px; padding: 0; text-align: center; vertical-align: middle;';
    if (unreadNotesMap[appt.id] > 0) {
      tdDot.innerHTML = '<span style="display: inline-block; width: 10px; height: 10px; background: #3b82f6; border-radius: 50%;" title="Has unread notes"></span>';
    }
    tr.appendChild(tdDot);
    
    // Created date
    const tdCreated = document.createElement('td');
    try {
      const c = new Date(appt.created_at);
      const dateStr = c.toLocaleDateString();
      const timeStr = c.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });
      tdCreated.innerHTML = `<div class="stacked-datetime"><span class="dt-date">${dateStr}</span><span class="dt-time">${timeStr}</span></div>`;
    } catch (e) {
      tdCreated.textContent = appt.created_at || '';
    }
    tr.appendChild(tdCreated);
    
    // Customer
    const tdCustomer = document.createElement('td');
    if (appt.customer_first || appt.customer_last) {
      tdCustomer.textContent = `${appt.customer_first || ''} ${appt.customer_last || ''}`.trim();
    } else {
      tdCustomer.textContent = appt.customer || 'N/A';
    }
    tr.appendChild(tdCustomer);
    
    // Vehicle
    const tdVehicle = document.createElement('td');
    tdVehicle.textContent = appt.vehicle || 'N/A';
    tr.appendChild(tdVehicle);
    
    // Service
    const tdService = document.createElement('td');
    tdService.textContent = appt.service || 'N/A';
    tr.appendChild(tdService);
    
    // Scheduled (date only)
    const tdDate = document.createElement('td');
    if (appt.preferred_date) {
      try {
        // Parse as local date if format is YYYY-MM-DD
        let dateStr = appt.preferred_date;
        if (/^\d{4}-\d{2}-\d{2}$/.test(appt.preferred_date)) {
          const [y, m, d] = appt.preferred_date.split('-').map(Number);
          const localDate = new Date(y, m - 1, d);
          dateStr = localDate.toLocaleDateString();
        } else {
          // fallback for other formats
          const d = new Date(appt.preferred_date);
          dateStr = d.toLocaleDateString();
        }
        tdDate.textContent = dateStr;
      } catch (e) {
        tdDate.textContent = appt.preferred_date;
      }
    } else {
      tdDate.textContent = 'Not set';
    }
    tr.appendChild(tdDate);
    
    // Time
    const tdTime = document.createElement('td');
    tdTime.textContent = appt.preferred_time ? formatTime12(appt.preferred_time) : 'Not set';
    tr.appendChild(tdTime);
    
    // Status
    const tdStatus = document.createElement('td');
    const statusSpan = document.createElement('span');
    statusSpan.className = `tag ${getStatusClass(appt.status)}`;
    statusSpan.textContent = appt.status || 'new';
    // Only allow status changes for non-staff users
    if (!isStaffUser) {
      statusSpan.style.cursor = 'pointer';
      statusSpan.title = 'Click to change status';
      statusSpan.addEventListener('click', (e) => { e.stopPropagation(); openStatusModal(appt); });
    }
    tdStatus.appendChild(statusSpan);
    tr.appendChild(tdStatus);
    
    // Actions (2x2 grid: view/invoice on top row, edit/delete on bottom)
    // Staff only sees View and Claim buttons
    const tdActions = document.createElement('td');
    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'appt-actions-grid';

    // View button (always shown)
    const viewBtn = document.createElement('button');
    viewBtn.className = 'btn small';
    viewBtn.textContent = 'View';
    viewBtn.addEventListener('click', () => openViewModal(appt));
    actionsDiv.appendChild(viewBtn);

    if (isStaffUser) {
      // Staff: Show Claim/Unclaim button only
      // Check if this appointment's job is already assigned to current user
      const claimBtn = document.createElement('button');
      claimBtn.className = isAssignedToMe ? 'btn small danger' : 'btn small info';
      claimBtn.textContent = isAssignedToMe ? 'Unclaim' : 'Claim';
      claimBtn.title = isAssignedToMe ? 'Release this job' : 'Claim this job';
      claimBtn.addEventListener('click', () => isAssignedToMe ? unclaimAppointment(appt) : claimAppointment(appt));
      actionsDiv.appendChild(claimBtn);
    } else {
      // Admin/Owner: Show full action buttons
      // Open Invoice button (top-right)
      const invoiceBtn = document.createElement('button');
      invoiceBtn.className = 'btn small secondary';
      invoiceBtn.textContent = 'Invoice';
      invoiceBtn.title = 'Open related invoice';
      invoiceBtn.addEventListener('click', () => {
        try {
          // Prefer a direct invoice id on the appointment, then fall back to matching by appointment_id
          const store = JSON.parse(localStorage.getItem('xm_data') || '{}');
          const invoices = store.invoices || [];
          let inv = null;

          if (appt.invoice_id) {
            inv = invoices.find(i => i.id === appt.invoice_id);
          }

          if (!inv) {
            inv = invoices.find(i => i.appointment_id === appt.id);
          }

          if (inv) {
            // Store invoice id in session for modal open
            localStorage.setItem('openInvoiceId', inv.id);
            window.location.href = 'invoices.html';
            return;
          }

          // No invoice found — create one automatically and open it
          createInvoiceForAppointment(appt).then(newInv => {
            if (newInv && newInv.id) {
              localStorage.setItem('openInvoiceId', newInv.id);
              window.location.href = 'invoices.html';
            } else {
              alert('Failed to create invoice for this appointment.');
            }
          }).catch(err => {
            console.error('Error creating invoice for appointment:', err);
            alert('Failed to create invoice for this appointment.');
          });
        } catch (e) {
          console.error('[Appointments] Error handling Invoice button click:', e);
          alert('Failed to open or create invoice for this appointment.');
        }
      });
      actionsDiv.appendChild(invoiceBtn);

      // Edit button (bottom-left)
      const editBtn = document.createElement('button');
      // Use the blue "info" style for Edit to match New/Edit buttons
      editBtn.className = 'btn small info';
      editBtn.textContent = 'Edit';
      editBtn.addEventListener('click', () => openEditModal(appt));
      actionsDiv.appendChild(editBtn);

      // Delete button (bottom-right) — use a compact white trash icon to fit current size
      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'btn small danger';
      deleteBtn.setAttribute('aria-label', 'Delete appointment');
      // Inline SVG trash icon (white fill) sized to match text
      deleteBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false"><path fill="white" d="M3 6h18v2H3V6zm2 3h14l-1 12a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2l-1-12zM9 4V3a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v1h5v2H4V4h5z"/></svg>';
      deleteBtn.addEventListener('click', () => showDeleteApptModal(appt.id));
      actionsDiv.appendChild(deleteBtn);
    }

    tdActions.appendChild(actionsDiv);
    tr.appendChild(tdActions);
    
    tbody.appendChild(tr);
  });

  // Notify listeners that appointments were rendered (useful for pages that customize rows)
  try {
    window.dispatchEvent(new CustomEvent('appointmentsRendered', { detail: { appointments } }));
  } catch (e) {}
}

/**
 * Get status class for styling
 */
function getStatusClass(status) {
  // Return the raw status string to match .tag.[status] CSS classes
  // For legacy or alternate status names, map as needed
  if (status === 'done') return 'completed';
  return status || 'new';
}

// --- Services & Suggestions ---
let _svcCache = null;
async function loadServices() {
  try {
    const supabase = getSupabaseClient();
    const shopId = getCurrentShopId();
    let services = [];
    if (supabase && shopId) {
      try {
        const { data, error } = await supabase.from('data').select('settings').eq('shop_id', shopId).single();
        if (!error && data && data.settings && Array.isArray(data.settings.services)) {
          services = data.settings.services;
        }
      } catch (e) {
        // fallthrough to localStorage
      }
    }

    if (!services.length) {
      const data = JSON.parse(localStorage.getItem('xm_data') || '{}');
      services = (data.settings && data.settings.services) || [];
    }

    _svcCache = services;
    populateSvcOptions(services);
  } catch (ex) {
    console.error('Error loading services for suggestions:', ex);
  }
}

function populateSvcOptions(services) {
  try {
    const dl = document.getElementById('svcOptions');
    if (!dl) return;
    dl.innerHTML = '';
    (services || []).forEach(s => {
      const opt = document.createElement('option');
      opt.value = s.name || '';
      dl.appendChild(opt);
    });
  } catch (e) { console.warn(e); }
}

/**
 * Add a service item to the invoice associated with an appointment (if exists)
 */
async function addServiceToInvoice(apptId, serviceName) {
  if (!apptId || !serviceName) return;
  const shopId = getCurrentShopId();
  const supabase = getSupabaseClient();

  // find service price from cache or settings
  let price = 0;
  if (!_svcCache) await loadServices();
  const svc = (_svcCache || []).find(s => s.name === serviceName);
  if (svc) price = parseFloat(svc.price) || 0;

  try {
    if (supabase && shopId) {
      const { data: currentData, error: fetchError } = await supabase.from('data').select('*').eq('shop_id', shopId).single();
      if (fetchError && fetchError.code !== 'PGRST116') {
        console.warn('Error fetching data for adding service to invoice:', fetchError);
        return;
      }

      const invoices = currentData?.invoices || [];
      const inv = invoices.find(i => i.appointment_id === apptId);
      if (!inv) return; // nothing to update

      inv.items = inv.items || [];
      // Avoid duplicates of same service name
      if (!inv.items.some(it => (it.name || '').toLowerCase() === serviceName.toLowerCase())) {
        inv.items.push({ name: serviceName, qty: 1, price: price || 0, type: 'part' });
      }

      // Upsert data record
      const payload = {
        shop_id: shopId,
        settings: currentData?.settings || {},
        appointments: currentData?.appointments || [],
        jobs: currentData?.jobs || [],
        threads: currentData?.threads || [],
        invoices: invoices,
        updated_at: new Date().toISOString()
      };

      await supabase.from('data').upsert(payload, { onConflict: 'shop_id' });

      // Upsert invoice to invoices table
      const invoicePayload = {
        id: inv.id,
        shop_id: shopId,
        number: inv.number,
        customer: inv.customer || '',
        customer_first: inv.customer_first || '',
        customer_last: inv.customer_last || '',
        appointment_id: inv.appointment_id || null,
        job_id: inv.job_id || null,
        status: inv.status || 'open',
        due: inv.due || null,
        tax_rate: inv.tax_rate || 6,
        discount: inv.discount || 0,
        items: inv.items || [],
        paid_date: inv.paid_date || null,
        created_at: inv.created_at || new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      await supabase.from('invoices').upsert(invoicePayload, { onConflict: 'id' });
      console.log('Added service to invoice', inv.id, serviceName);
    } else {
      // localStorage path
      const data = JSON.parse(localStorage.getItem('xm_data') || '{}');
      data.invoices = data.invoices || [];
      const inv = data.invoices.find(i => i.appointment_id === apptId);
      if (!inv) return;
      inv.items = inv.items || [];
      if (!inv.items.some(it => (it.name || '').toLowerCase() === serviceName.toLowerCase())) {
        inv.items.push({ name: serviceName, qty: 1, price: price || 0, type: 'part' });
      }
      localStorage.setItem('xm_data', JSON.stringify(data));
      console.log('Added service to local invoice', inv.id, serviceName);
    }
  } catch (ex) {
    console.error('Failed to add service to invoice:', ex);
  }
}

/**
 * Create a blank invoice for an appointment (includes customer/shop info and optionally the service as an item)
 */
async function createInvoiceForAppointment(appt) {
  if (!appt || !appt.id) return null;
  const shopId = getCurrentShopId();
  const supabase = getSupabaseClient();

  // Compose invoice object
  const id = getUUID();
  // Generate a sequential invoice number to match Jobs flow (fallback to 1001+)
  let number;
  try {
    if (supabase && shopId) {
      const { data: currentData, error: fetchError } = await supabase.from('data').select('invoices').eq('shop_id', shopId).single();
      if (!fetchError) {
        const invoices = currentData?.invoices || [];
        const maxNumber = invoices.reduce((max, inv) => Math.max(max, parseInt(inv.number) || 0), 1000);
        number = String(maxNumber + 1);
      } else {
        // fall back to timestamp if fetch failed
        number = `INV-${Date.now().toString().slice(-6)}`;
      }
    } else {
      // localStorage path
      const data = JSON.parse(localStorage.getItem('xm_data') || '{}');
      const invoices = data.invoices || [];
      const maxNumber = invoices.reduce((max, inv) => Math.max(max, parseInt(inv.number) || 0), 1000);
      number = String(maxNumber + 1);
    }
  } catch (e) {
    console.error('Error generating invoice number:', e);
    number = `INV-${Date.now().toString().slice(-6)}`;
  }
  const customer = appt.customer || '';
  const nameParts = (customer || '').trim().split(' ');
  const customer_first = nameParts[0] || '';
  const customer_last = nameParts.slice(1).join(' ') || '';
  // Lookup customer ID
  let customer_id = '';
  try {
    if (supabase && shopId) {
      const { data: customers } = await supabase
        .from('customers')
        .select('id, customer_first, customer_last, phone, email')
        .eq('shop_id', shopId);
      const match = customers?.find(c =>
        (c.customer_first?.trim().toLowerCase() === customer_first?.trim().toLowerCase()) &&
        (c.customer_last?.trim().toLowerCase() === customer_last?.trim().toLowerCase())
      ) || customers?.find(c => c.phone === appt.phone) || customers?.find(c => c.email === appt.email);
      if (match) customer_id = match.id;
    }
  } catch (e) {
    console.warn('[appointments.js] Could not lookup customer ID:', e);
  }
  // Attempt to get service price
  let items = [];
  if (appt.service) {
    if (!_svcCache) await loadServices();
    const svc = (_svcCache || []).find(s => s.name === appt.service);
    const price = svc ? (parseFloat(svc.price) || 0) : 0;
    items.push({ name: appt.service, qty: 1, price: price, type: 'part' });
  }

  const inv = {
    id,
    shop_id: shopId,
    number,
    customer,
    customer_id,
    customer_first,
    customer_last,
    appointment_id: appt.id,
    job_id: null,
    status: 'open',
    due: null,
    tax_rate: 6,
    discount: 0,
    items,
    paid_date: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  try {
    if (supabase && shopId) {
      // Upsert into data table
      const { data: currentData, error: fetchError } = await supabase.from('data').select('*').eq('shop_id', shopId).single();
      if (fetchError && fetchError.code !== 'PGRST116') {
        console.warn('Error fetching data for invoice creation:', fetchError);
      }

      const invoices = currentData?.invoices || [];
      invoices.push(inv);

      const payload = {
        shop_id: shopId,
        settings: currentData?.settings || {},
        appointments: currentData?.appointments || [],
        jobs: currentData?.jobs || [],
        threads: currentData?.threads || [],
        invoices: invoices,
        updated_at: new Date().toISOString()
      };

      await supabase.from('data').upsert(payload, { onConflict: 'shop_id' });

      // Also insert into invoices table
      const { error: upsertError } = await supabase.from('invoices').upsert(inv, { onConflict: 'id' });
      if (upsertError) console.warn('Error upserting invoice to invoices table:', upsertError);

      console.log('Created invoice for appointment (supabase):', inv.id);
      return inv;
    } else {
      // localStorage path
      const data = JSON.parse(localStorage.getItem('xm_data') || '{}');
      data.invoices = data.invoices || [];
      data.invoices.push(inv);
      localStorage.setItem('xm_data', JSON.stringify(data));
      console.log('Created invoice for appointment (local):', inv.id);
      return inv;
    }
  } catch (ex) {
    console.error('Failed to create invoice for appointment:', ex);
    return null;
  }
}

// UUID generation is now imported from helpers/uuid.js

/**
 * Open view modal
 */
async function openViewModal(appt) {
  const modal = document.getElementById('viewApptModal');
  const content = document.getElementById('viewApptContent');
  const editBtn = document.getElementById('editFromViewBtn');
  
  if (!modal || !content) return;

  // Determine invoice status (prefer appt.invoice_id, then appointment_id)
  let invStatusHTML = `<div style="display:flex;align-items:center;gap:8px;"><strong>Invoice Status:</strong> <span class=\"tag open\" style=\"flex:0 0 auto;display:inline-flex;\">No Invoice</span></div>`;
  try {
    const store = JSON.parse(localStorage.getItem('xm_data') || '{}');
    const invoices = store.invoices || window.invoices || [];
    let inv = null;
    if (appt.invoice_id) inv = invoices.find(i => i.id === appt.invoice_id);
    if (!inv) inv = invoices.find(i => i.appointment_id === appt.id);
    if (inv) {
      const s = (inv.status || 'open').toString().trim().toLowerCase();
      const cls = (s === 'paid') ? 'completed' : 'open';
      const label = (inv.status || 'open').toString().replace(/_/g, ' ');
      invStatusHTML = `<div style="display:flex;align-items:center;gap:8px;"><strong>Invoice Status:</strong> <span class=\"tag ${cls}\" style=\"flex:0 0 auto;display:inline-flex;\">${label}</span></div>`;
    }
  } catch (e) {
    console.warn('[Appointments] Could not determine invoice status for view modal', e);
  }
  
  content.innerHTML = `
    <div style="display: grid; gap: 12px;">
      <div><strong>Customer:</strong> ${appt.customer || 'N/A'}</div>
      <div><strong>Phone:</strong> ${appt.phone || 'N/A'}</div>
      <div><strong>Email:</strong> ${appt.email || 'N/A'}</div>
      <div><strong>Vehicle:</strong> ${appt.vehicle || 'N/A'}</div>
      ${appt.vin ? `<div><strong>VIN:</strong> ${appt.vin}</div>` : ''}
      <div><strong>Service:</strong> ${appt.service || 'N/A'}</div>
      <div><strong>Date:</strong> ${appt.preferred_date ? new Date(appt.preferred_date).toLocaleDateString() : 'Not set'}</div>
      <div><strong>Time:</strong> ${appt.preferred_time ? formatTime12(appt.preferred_time) : 'Not set'}</div>
      <div><strong>Status:</strong> <span class="tag ${getStatusClass(appt.status)}">${appt.status || 'new'}</span></div>
      ${invStatusHTML}
      <div id="inspectionStatusRow"></div>
      <div><strong>Assigned to:</strong> <span id="viewModalAssignedTo">${appt.assigned_to ? 'Loading...' : 'Unassigned'}</span></div>
      ${appt.notes ? `<div><strong>Notes:</strong><br>${appt.notes}</div>` : ''}
    </div>
    
    <div style="margin-top: 24px; padding-top: 16px; border-top: 1px solid #ddd;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
        <strong style="font-size: 15px;">Appointment Notes</strong>
        <button type="button" id="viewModalAddNoteBtn" class="btn small info">Add Note</button>
      </div>
      <div id="viewModalNotesList" style="display: flex; flex-direction: column; gap: 12px;">
        <p style="color: #666; font-style: italic; text-align: center;">Loading notes...</p>
      </div>
    </div>
  `;
  
  // Load inspection status asynchronously
  loadInspectionStatusForViewModal(appt);
  
  editBtn.onclick = () => {
    modal.classList.add('hidden');
    openEditModal(appt);
  };
  
  modal.classList.remove('hidden');
  // Track currently viewed appointment
  currentViewApptId = appt.id;
  
  // Load and render notes
  await renderViewModalNotes(appt.id);

  // Update assigned-to display (may query jobs/shop_staff)
  try { updateViewModalAssignedTo(appt.id); } catch (e) { console.warn('updateViewModalAssignedTo failed', e); }
  
  // Add note button handler
  const addNoteBtn = document.getElementById('viewModalAddNoteBtn');
  if (addNoteBtn) {
    addNoteBtn.addEventListener('click', () => {
      currentNotesAppointmentId = appt.id;
      openAddNoteModal();
    });
  }
}

// Load and display inspection status in view modal
async function loadInspectionStatusForViewModal(appt) {
  const container = document.getElementById('inspectionStatusRow');
  if (!container) return;
  
  try {
    // Get job ID if exists
    let jobId = null;
    try {
      const store = JSON.parse(localStorage.getItem('xm_data') || '{}');
      const jobs = store.jobs || [];
      const job = jobs.find(j => j.appointment_id === appt.id);
      if (job) jobId = job.id;
    } catch (e) {}
    
    const summary = await getInspectionSummary(appt.id, jobId);
    
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
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
          <strong>Inspection:</strong>
          <span class="tag" style="background: ${gradeStyle.bg}; color: ${gradeStyle.color}; font-weight: 700;">
            Grade ${summary.grade}
          </span>
          <span style="color: #6b7280; font-size: 13px;">${statusLabel}</span>
          ${summary.failCount > 0 ? `<span style="color: #ef4444; font-size: 12px;">${summary.failCount} failed</span>` : ''}
        </div>
        <button id="viewInspectionBtn" class="btn small" style="margin-top: 8px; background: #3b82f6; color: white; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer; font-size: 13px;">
          📋 View Inspection
        </button>
      `;
      
      // Add click handler for view button
      document.getElementById('viewInspectionBtn')?.addEventListener('click', () => {
        closeViewModal();
        openInspectionFromAppt(summary.id, appt, jobId);
      });
    } else {
      // No inspection yet
      container.innerHTML = `
        <div style="display:flex;align-items:center;gap:8px;">
          <strong>Inspection:</strong>
          <span style="color: #9ca3af; font-size: 13px;">Not started</span>
        </div>
      `;
    }
  } catch (e) {
    console.warn('Failed to load inspection status:', e);
    container.innerHTML = '';
  }
}

// Open inspection from appointment view modal
function openInspectionFromAppt(inspectionId, appt, jobId) {
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
  
  // Open the inspection form
  inspectionForm.open({
    appointmentId: appt.id,
    jobId: jobId,
    inspectionId: inspectionId,
    vehicleInfo: vehicleInfo,
    customerInfo: {
      name: appt.customer,
      phone: appt.phone,
      email: appt.email
    },
    onClose: (inspection) => {
      // Refresh if inspection was saved
      if (inspection) {
        loadAppointments();
      }
    }
  });
}

/**
 * Render notes in view modal
 */
async function renderViewModalNotes(appointmentId) {
  const container = document.getElementById('viewModalNotesList');
  if (!container) return;
  
  const notes = await loadAppointmentNotes(appointmentId);
  currentNotesAppointmentId = appointmentId;
  
  container.innerHTML = '';
  
  if (notes.length === 0) {
    container.innerHTML = '<p style="color: #666; font-style: italic; padding: 12px; text-align: center;">No notes yet. Click "Add Note" above to create one.</p>';
    return;
  }
  
  notes.forEach(note => {
    const notePanel = createNotePanel(note, false);
    container.appendChild(notePanel);
  });
}

/**
 * Close view modal
 */
function closeViewModal() {
  const modal = document.getElementById('viewApptModal');
  if (modal) modal.classList.add('hidden');
}

// Make it global for onclick
window.closeViewApptModal = closeViewModal;

/**
 * Update the "Assigned to" span inside the view modal for a specific appointment
 */
async function updateViewModalAssignedTo(apptId) {
  try {
    const el = document.getElementById('viewModalAssignedTo');
    if (!el || !apptId) return;

    const supabase = getSupabaseClient();
    const shopId = getCurrentShopId();
    if (!supabase || !shopId) {
      el.textContent = apptId ? 'Loading...' : 'Unassigned';
      return;
    }

    // Find job for this appointment
    const { data: job, error: jobErr } = await supabase
      .from('jobs')
      .select('assigned_to')
      .eq('appointment_id', apptId)
      .eq('shop_id', shopId)
      .single();

    if (jobErr || !job || !job.assigned_to) {
      el.textContent = 'Unassigned';
      return;
    }

    const assignedId = job.assigned_to;

    // Try to resolve staff name from shop_staff
    try {
      const { data: staff } = await supabase
        .from('shop_staff')
        .select('first_name, last_name, email')
        .eq('auth_id', assignedId)
        .eq('shop_id', shopId)
        .single();

      if (staff) {
        const name = `${staff.first_name || ''} ${staff.last_name || ''}`.trim() || staff.email || 'Assigned';
        el.textContent = name;
        return;
      }
    } catch (e) {
      // ignore and fallback
    }

    // Fallback: show partial id or assigned marker
    el.textContent = `Assigned (${String(assignedId).slice(0,6)})`;
  } catch (e) {
    console.warn('updateViewModalAssignedTo error', e);
  }
}

// ========================================
// STAFF ACTION MODAL (Mobile)
// ========================================

let currentStaffActionAppt = null;

/**
 * Open staff action modal (for mobile staff users)
 * Shows View and Claim/Unclaim options
 */
async function openStaffActionModal(appt) {
  currentStaffActionAppt = appt;
  const modal = document.getElementById('staffActionModal');
  const customerDisplay = document.getElementById('staffActionCustomer');
  const claimBtn = document.getElementById('staffActionClaim');
  
  if (!modal) return;
  
  // Set customer name
  const customerName = appt.customer_first && appt.customer_last 
    ? `${appt.customer_first} ${appt.customer_last}`.trim()
    : appt.customer || 'Unknown Customer';
  if (customerDisplay) {
    customerDisplay.textContent = customerName;
  }
  
  // Check assignment status from Supabase
  let isAssignedToMe = false;
  const staffAuthId = currentUserForClaim?.auth_id || currentUserForClaim?.id;
  
  if (staffAuthId) {
    try {
      const supabase = getSupabaseClient();
      const shopId = getCurrentShopId();
      if (supabase && shopId) {
        const { data: job } = await supabase
          .from('jobs')
          .select('assigned_to')
          .eq('appointment_id', appt.id)
          .eq('shop_id', shopId)
          .single();
        
        if (job) {
          isAssignedToMe = String(job.assigned_to) === String(staffAuthId);
        }
      }
    } catch (e) {
      // Job might not exist yet, that's ok
    }
  }
  
  // Update claim button based on current state
  if (claimBtn) {
    if (isAssignedToMe) {
      claimBtn.className = 'btn danger';
      claimBtn.textContent = 'Unclaim Job';
      claimBtn.style.width = '100%';
      claimBtn.style.padding = '14px';
      claimBtn.style.fontSize = '1rem';
    } else {
      claimBtn.className = 'btn info';
      claimBtn.textContent = 'Claim Job';
      claimBtn.style.width = '100%';
      claimBtn.style.padding = '14px';
      claimBtn.style.fontSize = '1rem';
    }
  }
  
  modal.classList.remove('hidden');
}

/**
 * Close staff action modal
 */
function closeStaffActionModal() {
  const modal = document.getElementById('staffActionModal');
  if (modal) modal.classList.add('hidden');
  currentStaffActionAppt = null;
}

/**
 * Handle View button click from staff action modal
 */
function handleStaffActionView() {
  if (currentStaffActionAppt) {
    // Save reference before closing modal (which sets currentStaffActionAppt to null)
    const appt = currentStaffActionAppt;
    closeStaffActionModal();
    openViewModal(appt);
  }
}

/**
 * Handle Claim/Unclaim button click from staff action modal
 */
async function handleStaffActionClaim() {
  if (!currentStaffActionAppt) return;
  
  // Check current assignment status from Supabase
  let isAssignedToMe = false;
  const staffAuthId = currentUserForClaim?.auth_id || currentUserForClaim?.id;
  
  if (staffAuthId) {
    try {
      const supabase = getSupabaseClient();
      const shopId = getCurrentShopId();
      if (supabase && shopId) {
        const { data: job } = await supabase
          .from('jobs')
          .select('assigned_to')
          .eq('appointment_id', currentStaffActionAppt.id)
          .eq('shop_id', shopId)
          .single();
        
        if (job) {
          isAssignedToMe = String(job.assigned_to) === String(staffAuthId);
        }
      }
    } catch (e) {
      // Job might not exist yet
    }
  }
  
  if (isAssignedToMe) {
    await unclaimAppointment(currentStaffActionAppt);
  } else {
    await claimAppointment(currentStaffActionAppt);
  }
  
  closeStaffActionModal();
}

// Make functions global for onclick handlers
window.closeStaffActionModal = closeStaffActionModal;
window.handleStaffActionView = handleStaffActionView;
window.handleStaffActionClaim = handleStaffActionClaim;

// ========== Admin Action Modal (for mobile admin/owner users) ==========
let currentAdminActionAppt = null;

/**
 * Open admin action modal (for mobile admin/owner users)
 * Shows View, Invoice, Edit, Delete options
 */
function openAdminActionModal(appt) {
  currentAdminActionAppt = appt;
  const modal = document.getElementById('adminActionModal');
  const customerDisplay = document.getElementById('adminActionCustomer');
  
  if (!modal) return;
  
  // Set customer name
  const customerName = appt.customer_first && appt.customer_last 
    ? `${appt.customer_first} ${appt.customer_last}`.trim()
    : appt.customer || 'Unknown Customer';
  if (customerDisplay) {
    customerDisplay.textContent = customerName;
  }
  
  modal.classList.remove('hidden');
}

/**
 * Close admin action modal
 */
function closeAdminActionModal() {
  const modal = document.getElementById('adminActionModal');
  if (modal) modal.classList.add('hidden');
  currentAdminActionAppt = null;
}

/**
 * Handle admin action - View
 */
function handleAdminActionView() {
  if (!currentAdminActionAppt) return;
  const appt = currentAdminActionAppt;
  closeAdminActionModal();
  openViewModal(appt);
}

/**
 * Handle admin action - Invoice
 */
function handleAdminActionInvoice() {
  if (!currentAdminActionAppt) return;
  const appt = currentAdminActionAppt;
  closeAdminActionModal();
  
  // Find invoice for this appointment
  const invoices = JSON.parse(localStorage.getItem('xm_data') || '{}').invoices || [];
  const invoice = invoices.find(inv => inv.appointment_id === appt.id);
  if (invoice) {
    window.location.href = `invoices.html?id=${invoice.id}`;
  } else {
    showNotification('No invoice found for this appointment', 'error');
  }
}

/**
 * Handle admin action - Edit
 */
function handleAdminActionEdit() {
  if (!currentAdminActionAppt) return;
  const appt = currentAdminActionAppt;
  closeAdminActionModal();
  openEditModal(appt);
}

/**
 * Handle admin action - Delete
 */
function handleAdminActionDelete() {
  if (!currentAdminActionAppt) return;
  const apptId = currentAdminActionAppt.id;
  closeAdminActionModal();
  showDeleteApptModal(apptId);
}

// Make admin modal functions global
window.closeAdminActionModal = closeAdminActionModal;
window.handleAdminActionView = handleAdminActionView;
window.handleAdminActionInvoice = handleAdminActionInvoice;
window.handleAdminActionEdit = handleAdminActionEdit;
window.handleAdminActionDelete = handleAdminActionDelete;

/**
 * Open status modal
 */
function openStatusModal(appt) {
  currentApptForStatus = appt;
  const modal = document.getElementById('statusModal');
  const pillsContainer = document.getElementById('statusPills');
  
  if (!modal || !pillsContainer) return;
  
  pillsContainer.innerHTML = '';
  
  STATUSES.forEach(status => {
    const pill = document.createElement('button');
    pill.className = `btn ${appt.status === status ? getStatusClass(status) : ''}`;
    pill.textContent = status.replace(/_/g, ' ').toUpperCase();
    pill.style.width = '100%';
    pill.style.textAlign = 'left';
    
    pill.addEventListener('click', async () => {
      await updateAppointmentStatus(appt.id, status);
      modal.classList.add('hidden');
    });
    
    pillsContainer.appendChild(pill);
  });
  
  modal.classList.remove('hidden');
}

/**
 * Close status modal
 */
function closeStatusModal() {
  const modal = document.getElementById('statusModal');
  if (modal) modal.classList.add('hidden');
  currentApptForStatus = null;
}

// Make it global for onclick
window.closeStatusModal = closeStatusModal;

/**
 * Update appointment status
 */
async function updateAppointmentStatus(apptId, newStatus) {
  const index = allAppointments.findIndex(a => a.id === apptId);
  if (index === -1) return;
  
  const oldStatus = allAppointments[index].status;
  const now = new Date().toISOString();
  allAppointments[index].status = newStatus;
  allAppointments[index].updated_at = now;

  // Update JSONB data
  await saveAppointments(allAppointments);
  
  // ALSO update the appointments table
  const supabase = getSupabaseClient();
  if (supabase) {
    try {
      const { error } = await supabase
        .from('appointments')
        .update({ 
          status: newStatus,
          updated_at: now
        })
        .eq('id', apptId);
      
      if (error) {
        console.error('Failed to update appointments table:', error);
      } else {
        console.log(`✅ Updated appointment ${apptId} status in database to ${newStatus}`);
      }
    } catch (err) {
      console.error('Error updating appointments table:', err);
    }
  }
  
  await renderAppointments();

  // Create notification for status changes
  try {
    const shopId = getCurrentShopId();
    const authId = await getCurrentAuthId();
    const appt = allAppointments[index];
    
    const statusTitles = {
      'scheduled': 'Appointment Scheduled',
      'in_progress': 'Appointment In Progress',
      'awaiting_parts': 'Appointment Awaiting Parts',
      'completed': 'Appointment Completed'
    };
    
    const statusMessages = {
      'scheduled': `${appt.customer || 'Customer'}'s appointment for ${appt.service || 'service'} has been scheduled for ${appt.preferred_date || 'TBD'}.`,
      'in_progress': `${appt.customer || 'Customer'}'s ${appt.vehicle || 'vehicle'} is now in progress for ${appt.service || 'service'}.`,
      'awaiting_parts': `${appt.customer || 'Customer'}'s appointment is waiting for parts to continue.`,
      'completed': `${appt.customer || 'Customer'}'s appointment for ${appt.vehicle || 'vehicle'} has been completed.`
    };
    
    // Only notify for meaningful status changes (not 'new')
    if (newStatus !== 'new' && newStatus !== oldStatus && statusTitles[newStatus]) {
      await createShopNotification({
        supabase: getSupabaseClient(),
        shopId,
        type: `appointment_${newStatus}`,
        category: 'appointment',
        title: statusTitles[newStatus],
        message: statusMessages[newStatus],
        relatedId: appt.id,
        relatedType: 'appointment',
        metadata: {
          customer_name: appt.customer || '',
          vehicle: appt.vehicle || '',
          service: appt.service || '',
          appointment_id: appt.id,
          old_status: oldStatus,
          new_status: newStatus
        },
        priority: newStatus === 'awaiting_parts' ? 'high' : 'normal',
        createdBy: authId
      });
    }
  } catch (error) {
    console.error('[Appointments] Error creating status notification:', error);
  }

  // Auto-create or update job if status is in_progress or awaiting_parts
  if (['in_progress', 'awaiting_parts'].includes(newStatus)) {
    console.log(`[updateAppointmentStatus] Status is ${newStatus}, creating/updating job...`);
    const appt = allAppointments[index];
    
    // Clear any suppress_auto_job flag when manually changing status
    // This allows admins to override the foreman workflow if needed
    if (appt.suppress_auto_job) {
      console.log('[updateAppointmentStatus] Clearing suppress_auto_job flag (manual status change)');
      delete appt.suppress_auto_job;
      allAppointments[index] = appt;
      // Save the updated appointment without the flag
      await saveAppointments(allAppointments);
    }
    // Load jobs from localStorage
    let jobs = [];
    try {
      const localData = JSON.parse(localStorage.getItem('xm_data') || '{}');
      jobs = localData.jobs || [];
    } catch (e) {}
    // Check if job already exists for this appointment
    let job = jobs.find(j => j.appointment_id === appt.id);
    // If not found in local cache, try to find canonical job in `jobs` table
    if (!job) {
      try {
        const { data: canonicalJob, error: jobFetchErr } = await getSupabaseClient()
          .from('jobs')
          .select('*')
          .eq('appointment_id', appt.id)
          .limit(1)
          .single();
        if (!jobFetchErr && canonicalJob) {
          // Normalize canonical row into local job shape
          job = {
            id: canonicalJob.id,
            shop_id: canonicalJob.shop_id,
            appointment_id: canonicalJob.appointment_id,
            customer: `${canonicalJob.customer_first || ''} ${canonicalJob.customer_last || ''}`.trim() || (appt.customer || ''),
            customer_first: canonicalJob.customer_first || appt.customer_first || '',
            customer_last: canonicalJob.customer_last || appt.customer_last || '',
            assigned_to: canonicalJob.assigned_to || null,
            status: canonicalJob.status || newStatus,
            created_at: canonicalJob.created_at || new Date().toISOString(),
            updated_at: canonicalJob.updated_at || new Date().toISOString(),
            completed_at: canonicalJob.completed_at || null
          };
          jobs.push(job);
        }
      } catch (e) {
        console.warn('[Appointments] Failed to fetch canonical job for appointment', appt.id, e);
      }
    }

    if (!job) {
      const shopId = getCurrentShopId();
      job = {
        // Use a temporary 'job_' prefixed id for newly created jobs so saveJobs
        // recognizes them as newly-created and will upsert into the canonical jobs table.
        id: `job_${Date.now()}_${Math.random().toString(36).substr(2,9)}`,
        shop_id: shopId,
        appointment_id: appt.id,
        customer: appt.customer || '',
        customer_first: appt.customer_first || '',
        customer_last: appt.customer_last || '',
        assigned_to: null,
        status: newStatus,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      jobs.push(job);
      console.log(`[updateAppointmentStatus] Created new job:`, job);
    } else {
      job.status = newStatus;
      job.updated_at = new Date().toISOString();
      console.log(`[updateAppointmentStatus] Updated existing job:`, job);
    }
    // Save jobs to localStorage
    try {
      const localData = JSON.parse(localStorage.getItem('xm_data') || '{}');
      localData.jobs = jobs;
      localStorage.setItem('xm_data', JSON.stringify(localData));
      console.log('✅ Job created/updated for appointment', appt.id);
    } catch (e) {
      console.error('Failed to save job:', e);
    }
    // Also sync jobs to Supabase
    try {
      console.log('[updateAppointmentStatus] Importing jobs.js...');
      const { saveJobs } = await import('./jobs.js');
      console.log('[updateAppointmentStatus] saveJobs imported successfully');
      try {
        console.log('[Appointments] saveJobs called with job:', { id: job.id, appointment_id: job.appointment_id, status: job.status, shop_id: job.shop_id });
      } catch (e) {}
      // Only sync the single changed job to avoid upserting unrelated rows
      console.log('[updateAppointmentStatus] Calling saveJobs([job])...');
      await saveJobs([job]);
      console.log('✅ [updateAppointmentStatus] Jobs synced to Supabase successfully');
    } catch (e) {
      console.error('[updateAppointmentStatus] Failed to sync jobs to Supabase:', e);
      console.error('[updateAppointmentStatus] Error stack:', e.stack);
    }
  } else {
    // If status is not active (new/scheduled/completed), COMPLETELY remove job and all related data
    console.log(`[updateAppointmentStatus] Status is ${newStatus}, removing job completely...`);
    const appt = allAppointments[index];
    const shopId = getCurrentShopId();
    const supabase = getSupabaseClient();
    
    if (supabase && shopId) {
      try {
        // Find all jobs for this appointment
        const { data: jobsToDelete } = await supabase
          .from('jobs')
          .select('id')
          .eq('appointment_id', appt.id)
          .eq('shop_id', shopId);
        
        if (jobsToDelete && jobsToDelete.length > 0) {
          const jobIds = jobsToDelete.map(j => j.id);
          console.log(`[updateAppointmentStatus] Found ${jobIds.length} jobs to delete:`, jobIds);

          // Only pass valid UUIDs to tables where job_id is a UUID foreign key
          const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
          const validJobIds = jobIds.filter(id => uuidRe.test(String(id)));
          const skippedIds = jobIds.filter(id => !uuidRe.test(String(id)));
          if (skippedIds.length) console.warn('[updateAppointmentStatus] Found non-UUID job ids (will attempt join-based deletes):', skippedIds);

          // First, delete job_parts for valid UUID job IDs
          if (validJobIds.length) {
            const { error: partsError } = await supabase
              .from('job_parts')
              .delete()
              .in('job_id', validJobIds);
            if (partsError) console.error('[updateAppointmentStatus] Error deleting job_parts by job_id:', partsError);
            else console.log('✅ Deleted parts for UUID jobs');
          } else {
            console.log('No valid UUID job_ids to delete job_parts for.');
          }

          // For any non-UUID job ids (temporary ids), attempt to delete related job_parts
          // by joining to the jobs table via appointment_id. This avoids passing
          // non-UUID values to UUID columns and removes orphaned parts/labor.
          if (skippedIds.length) {
            try {
              // Delete job_parts where the parent job has this appointment_id
              const { error: partsJoinErr } = await supabase
                .from('job_parts')
                .delete()
                .eq('jobs.appointment_id', appt.id);
              if (partsJoinErr) console.error('[updateAppointmentStatus] Error deleting job_parts via jobs join:', partsJoinErr);
              else console.log('✅ Deleted parts for jobs via jobs.appointment_id join');
            } catch (e) {
              console.error('[updateAppointmentStatus] Exception deleting job_parts via join:', e);
            }
          }

          // Delete labor for valid UUID job IDs
          if (validJobIds.length) {
            const { error: laborError } = await supabase
              .from('job_labor')
              .delete()
              .in('job_id', validJobIds);
            if (laborError) console.error('[updateAppointmentStatus] Error deleting job_labor by job_id:', laborError);
            else console.log('✅ Deleted labor for UUID jobs');
          } else {
            console.log('No valid UUID job_ids to delete job_labor for.');
          }

          // For any non-UUID job ids, delete job_labor via jobs.appointment_id join
          if (skippedIds.length) {
            try {
              const { error: laborJoinErr } = await supabase
                .from('job_labor')
                .delete()
                .eq('jobs.appointment_id', appt.id);
              if (laborJoinErr) console.error('[updateAppointmentStatus] Error deleting job_labor via jobs join:', laborJoinErr);
              else console.log('✅ Deleted labor for jobs via jobs.appointment_id join');
            } catch (e) {
              console.error('[updateAppointmentStatus] Exception deleting job_labor via join:', e);
            }
          }

          // Delete the jobs themselves (use original jobIds returned from jobs table)
          const { error: jobsError } = await supabase
            .from('jobs')
            .delete()
            .in('id', jobIds);
          if (jobsError) console.error('[updateAppointmentStatus] Error deleting jobs:', jobsError);
          else console.log('✅ Deleted jobs from jobs table');
        }
      } catch (e) {
        console.error('[updateAppointmentStatus] Error deleting job records:', e);
      }
    }
    
    // Remove from localStorage jobs
    let jobs = [];
    try {
      const localData = JSON.parse(localStorage.getItem('xm_data') || '{}');
      jobs = localData.jobs || [];
    } catch (e) {}
    
    jobs = jobs.filter(j => j.appointment_id !== appt.id);
    
    try {
      const localData = JSON.parse(localStorage.getItem('xm_data') || '{}');
      localData.jobs = jobs;
      localStorage.setItem('xm_data', JSON.stringify(localData));
      console.log('✅ Job removed from localStorage for appointment', appt.id);
    } catch (e) {
      console.error('Failed to remove job from localStorage:', e);
    }
    
    // Also sync jobs to Supabase data.jobs JSONB (update data.jobs but skip canonical upsert to avoid touching unrelated rows)
    try {
      const { saveJobs } = await import('./jobs.js');
      await saveJobs(jobs, { skipCanonicalUpsert: true });
      console.log('✅ Jobs synced to Supabase data.jobs JSONB');
    } catch (e) {
      console.error('Failed to sync jobs to Supabase:', e);
    }
  }

  showNotification(`Status updated to ${newStatus}`);
}

/**
 * Open new appointment modal
 */
function openNewModal() {
  const modal = document.getElementById('newApptModal');
  if (!modal) return;
  // Check localStorage for newApptCustomer and newApptVehicle
  let customer = null;
  let vehicle = null;
  try {
    customer = JSON.parse(localStorage.getItem('newApptCustomer') || 'null');
  } catch (e) {}
  try {
    vehicle = JSON.parse(localStorage.getItem('newApptVehicle') || 'null');
  } catch (e) {}
  // Populate fields if available
  document.getElementById('naFirst').value = customer?.customer_first || '';
  document.getElementById('naLast').value = customer?.customer_last || '';
  document.getElementById('naEmail').value = customer?.email || '';
  document.getElementById('naPhone').value = customer?.phone || '';
  document.getElementById('naVehicleYear').value = vehicle?.year || customer?.vehicle_year || '';
  document.getElementById('naVehicleMake').value = vehicle?.make || customer?.vehicle_make || '';
  document.getElementById('naVehicleModel').value = vehicle?.model || customer?.vehicle_model || '';
  // Populate model dropdown based on selected make
  const naMakeSelect = document.getElementById('naVehicleMake');
  const naModelSelect = document.getElementById('naVehicleModel');
  const naYearSelect = document.getElementById('naVehicleYear');
  if (naMakeSelect.value) {
    populateVehicleModels(naMakeSelect, naModelSelect, naYearSelect);
    naModelSelect.value = vehicle?.model || customer?.vehicle_model || '';
  }
  document.getElementById('naVin').value = vehicle?.vin || '';
  document.getElementById('naService').value = '';
  document.getElementById('naDate').value = '';
  document.getElementById('naTime').value = '';
  // Clear localStorage after use
  localStorage.removeItem('newApptCustomer');
  localStorage.removeItem('newApptVehicle');
  modal.classList.remove('hidden');
  document.getElementById('naFirst').focus();
}

/**
 * Close new appointment modal
 */
function closeNewModal() {
  const modal = document.getElementById('newApptModal');
  if (modal) modal.classList.add('hidden');
}

/**
 * Save new appointment
 */
async function saveNewAppointment() {
  const first = document.getElementById('naFirst').value.trim();
  const last = document.getElementById('naLast').value.trim();
  const email = document.getElementById('naEmail').value.trim();
  const phone = document.getElementById('naPhone').value.trim();
  const vehicle_year = document.getElementById('naVehicleYear').value.trim();
  const vehicle_make = document.getElementById('naVehicleMake').value.trim();
  const vehicle_model = document.getElementById('naVehicleModel').value.trim();
  const vehicle = [vehicle_year, vehicle_make, vehicle_model].filter(v => v).join(' ') || '';
  const vin = document.getElementById('naVin').value.trim();
  const service = document.getElementById('naService').value.trim();
  const date = document.getElementById('naDate').value;
  const time = document.getElementById('naTime').value;
  const newAppt = {
    id: getUUID(),
    shop_id: getCurrentShopId(),
    customer: `${first} ${last}`,
    customer_first: first,
    customer_last: last,
    email,
    phone,
    vehicle,
    vehicle_year,
    vehicle_make,
    vehicle_model,
    vin,
    service,
    preferred_date: date || null,
    preferred_time: time || null,
    status: 'new',
    source: 'platform',
    notes: '',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  allAppointments.push(newAppt);
  await saveAppointments(allAppointments);
  
  // 🆕 Create tracking token for this appointment immediately
  // This ensures every appointment always has a token for tracking
  const tokenResult = await ensureAppointmentToken(newAppt.id, getCurrentShopId());
  if (tokenResult) {
    console.log('✅ Tracking token created for new appointment:', tokenResult.shortCode);
  } else {
    console.warn('⚠️ Failed to create tracking token for new appointment');
  }
  
  // If there's an invoice for this appointment, add the chosen service to it
  await addServiceToInvoice(newAppt.id, newAppt.service);
  
  // After save, run auto-transition in case other appointments need updating
  await checkAndTransitionNewAppointments(allAppointments);

  closeNewModal();
  await renderAppointments();
  showNotification('Appointment created successfully!');
}

/**
 * Open edit modal
 */
async function openEditModal(appt) {
  currentApptId = appt.id;
  window.currentEditingAppointmentId = appt.id;
  const modal = document.getElementById('apptModal');
  const form = document.getElementById('apptForm');
  const title = document.getElementById('apptModalTitle');
  
  if (!modal || !form) return;
  
  title.textContent = 'Edit Appointment';
  
  // Populate form
  // Always populate customer_first and customer_last, falling back to splitting combined customer string
  let first = appt.customer_first;
  let last = appt.customer_last;
  if ((!first || !last) && appt.customer) {
    const nameParts = appt.customer.trim().split(' ');
    first = first || nameParts[0] || '';
    last = last || nameParts.slice(1).join(' ') || '';
  }
  form.elements['customer_first'].value = first || '';
  form.elements['customer_last'].value = last || '';
  form.elements['phone'].value = appt.phone || '';
  form.elements['email'].value = appt.email || '';
  
  // Handle vehicle data - use separate fields if available, otherwise parse combined vehicle string
  let vehicle_year = appt.vehicle_year || '';
  let vehicle_make = appt.vehicle_make || '';
  let vehicle_model = appt.vehicle_model || '';
  
  if (!vehicle_year && !vehicle_make && !vehicle_model && appt.vehicle) {
    // Parse the combined vehicle string for backward compatibility
    const vehicleParts = appt.vehicle.trim().split(/\s+/);
    if (vehicleParts.length >= 1 && /^\d{4}$/.test(vehicleParts[0])) {
      vehicle_year = vehicleParts.shift();
    }
    if (vehicleParts.length >= 1) {
      vehicle_make = vehicleParts.shift();
    }
    if (vehicleParts.length >= 1) {
      vehicle_model = vehicleParts.join(' ');
    }
  }
  
  // Step 1: Set year first
  const yearSelect = form.elements['vehicle_year'];
  yearSelect.value = vehicle_year;
  yearSelect.dispatchEvent(new Event('change', { bubbles: true }));

  // Step 2: Populate makes for selected year, then set make (with delay)
  const makeSelect = form.elements['vehicle_make'];
  const modelSelect = form.elements['vehicle_model'];
  setTimeout(() => {
    populateVehicleMakes(makeSelect, yearSelect);
    makeSelect.value = vehicle_make;
    makeSelect.dispatchEvent(new Event('change', { bubbles: true }));

    // Step 3: Populate models for selected make/year, then set model (with another delay)
    setTimeout(() => {
      populateVehicleModels(makeSelect, modelSelect, yearSelect);
      modelSelect.value = vehicle_model;
      modelSelect.dispatchEvent(new Event('change', { bubbles: true }));

      // Step 4: Fallback for missing VEHICLE_DATA (legacy/custom makes/models)
      try {
        let vehicleDataOk = typeof VEHICLE_DATA === 'object' && Object.keys(VEHICLE_DATA).length > 0;
        if (!vehicleDataOk) {
          // Add current make/model as options if not present
          if (![...makeSelect.options].some(o => o.value === vehicle_make) && vehicle_make) {
            makeSelect.appendChild(new Option(vehicle_make, vehicle_make));
            makeSelect.value = vehicle_make;
          }
          if (![...modelSelect.options].some(o => o.value === vehicle_model) && vehicle_model) {
            modelSelect.appendChild(new Option(vehicle_model, vehicle_model));
            modelSelect.value = vehicle_model;
          }
        }
      } catch (e) {
        console.warn('Failed fallback for make/model in edit modal', e);
      }
    }, 50); // Delay for model population
  }, 50); // Delay for make population

  // Dispatch change events so floating inputs (if initialized) stay in sync
  try {
    if (yearSelect) yearSelect.dispatchEvent(new Event('change', { bubbles: true }));
    if (makeSelect) makeSelect.dispatchEvent(new Event('change', { bubbles: true }));
    if (modelSelect) modelSelect.dispatchEvent(new Event('change', { bubbles: true }));
  } catch (e) {}

  // Fallback: if custom input elements exist, update their values/placeholders
  try {
    const yi = document.getElementById('vehicleYearInput');
    const mi = document.getElementById('vehicleMakeInput');
    const mo = document.getElementById('vehicleModelInput');
    if (yi) {
      const so = yearSelect?.options[yearSelect.selectedIndex];
      if (so && !so.value) { yi.value = ''; yi.placeholder = so.text || '-- Select --'; } else { yi.value = so?.text || yearSelect?.value || ''; yi.placeholder = ''; }
    }
    if (mi) {
      const so = makeSelect?.options[makeSelect.selectedIndex];
      if (so && !so.value) { mi.value = ''; mi.placeholder = so.text || '-- Select --'; } else { mi.value = so?.text || makeSelect?.value || ''; mi.placeholder = ''; }
    }
    if (mo) {
      const so = modelSelect?.options[modelSelect.selectedIndex];
      if (so && !so.value) { mo.value = ''; mo.placeholder = so.text || '-- Select --'; } else { mo.value = so?.text || modelSelect?.value || ''; mo.placeholder = ''; }
    }
  } catch (e) {}
  
  form.elements['vin'].value = appt.vin || '';
  form.elements['service'].value = appt.service || '';
  form.elements['preferred_date'].value = appt.preferred_date || '';
  form.elements['preferred_time'].value = appt.preferred_time || '';
  
  // Load notes for this appointment
  await renderAppointmentNotes(appt.id);
  
  // Fetch and display tracking code
  await displayTrackingCode(appt.id, getCurrentShopId());
  
  modal.classList.remove('hidden');
}

/**
 * Close edit modal
 */
function closeEditModal() {
  const modal = document.getElementById('apptModal');
  if (modal) modal.classList.add('hidden');
  currentApptId = null;
}

/**
 * Save edited appointment
 */
async function saveEditedAppointment(e) {
  if (e) e.preventDefault();
  
  if (!currentApptId) return;
  
  const form = document.getElementById('apptForm');
  const index = allAppointments.findIndex(a => a.id === currentApptId);
  
  if (index === -1) return;
  
  const customer_first = form.elements['customer_first'].value.trim();
  const customer_last = form.elements['customer_last'].value.trim();

  const vehicle_year = form.elements['vehicle_year'].value.trim();
  const vehicle_make = form.elements['vehicle_make'].value.trim();
  const vehicle_model = form.elements['vehicle_model'].value.trim();
  const vehicle = [vehicle_year, vehicle_make, vehicle_model].filter(v => v).join(' ') || '';

  allAppointments[index] = {
    ...allAppointments[index],
    customer: `${customer_first} ${customer_last}`.trim(),
    customer_first,
    customer_last,
    phone: form.elements['phone'].value.trim(),
    email: form.elements['email'].value.trim(),
    vehicle,
    vehicle_year,
    vehicle_make,
    vehicle_model,
    vin: form.elements['vin'].value.trim(),
    service: form.elements['service'].value.trim(),
    preferred_date: form.elements['preferred_date'].value || null,
    preferred_time: form.elements['preferred_time'].value || null,
    updated_at: new Date().toISOString()
  };

  await saveAppointments(allAppointments);

  // 🆕 Ensure appointment has a tracking token (creates one if missing, reuses if exists)
  // This covers cases where old appointments didn't have tokens created on initial save
  const tokenResult = await ensureAppointmentToken(currentApptId, getCurrentShopId());
  if (tokenResult) {
    if (tokenResult.isNew) {
      console.log('✅ Tracking token created for existing appointment:', tokenResult.shortCode);
    } else {
      console.log('ℹ️ Appointment already has tracking token:', tokenResult.shortCode);
    }
    // Update the tracking code display in the modal
    const trackingCodeSection = document.getElementById('trackingCodeSection');
    const trackingCodeDisplay = document.getElementById('trackingCodeDisplay');
    if (trackingCodeSection && trackingCodeDisplay && tokenResult.shortCode) {
      trackingCodeDisplay.textContent = tokenResult.shortCode;
      trackingCodeSection.style.display = 'block';
    }
  }

  // NOTE: Customer upsert to customers table is handled by the "Save Customer" button only
  // NOT by the regular save button
  // If there's an invoice linked to this appointment, ensure the service is added
  await addServiceToInvoice(currentApptId, allAppointments[index].service);
  
  closeEditModal();
  await renderAppointments();
  showNotification('Appointment updated successfully!');
}

/**
 * Delete appointment
 */

let pendingDeleteApptId = null;

async function showDeleteApptModal(apptId) {
  pendingDeleteApptId = apptId;
  const modal = document.getElementById('deleteApptModal');
  const msgEl = document.getElementById('deleteApptMsg');
  if (modal) {
    // Count related records
    let jobCount = 0;
    let invoiceCount = 0;
    const supabase = getSupabaseClient();
    if (supabase) {
      try {
        const { data: jobs } = await supabase
          .from('jobs')
          .select('id')
          .eq('appointment_id', apptId);
        jobCount = jobs?.length || 0;
        
        if (jobCount > 0) {
          const jobIds = jobs.map(j => j.id);
          const { data: invs } = await supabase
            .from('invoices')
            .select('id')
            .or(`appointment_id.eq.${apptId},job_id.in.(${jobIds.join(',')})`);
          invoiceCount = invs?.length || 0;
        } else {
          const { data: invs } = await supabase
            .from('invoices')
            .select('id')
            .eq('appointment_id', apptId);
          invoiceCount = invs?.length || 0;
        }
      } catch (e) {
        console.warn('Error counting related records:', e);
      }
    }
    
    if (msgEl) {
      let msg = 'Delete this appointment?';
      if (jobCount > 0 || invoiceCount > 0) {
        msg += ` This will also delete ${jobCount} related job(s) and ${invoiceCount} related invoice(s).`;
      }
      msgEl.textContent = msg;
    }
    
    modal.classList.remove('hidden');
  }
}

function hideDeleteApptModal() {
  pendingDeleteApptId = null;
  const modal = document.getElementById('deleteApptModal');
  if (modal) modal.classList.add('hidden');
}

async function confirmDeleteAppointment() {
  if (!pendingDeleteApptId) return;
  
  const supabase = getSupabaseClient();
  const shopId = getCurrentShopId();
  if (supabase && shopId) {
    try {
      // Find related jobs
      const { data: relatedJobs } = await supabase
        .from('jobs')
        .select('id')
        .eq('appointment_id', pendingDeleteApptId);
      
      // Find related invoices (by appointment_id or job_id)
      let relatedInvoices = [];
      if (relatedJobs && relatedJobs.length > 0) {
        const jobIds = relatedJobs.map(j => j.id);
        const { data: invs } = await supabase
          .from('invoices')
          .select('id')
          .or(`appointment_id.eq.${pendingDeleteApptId},job_id.in.(${jobIds.join(',')})`);
        relatedInvoices = invs || [];
      } else {
        const { data: invs } = await supabase
          .from('invoices')
          .select('id')
          .eq('appointment_id', pendingDeleteApptId);
        relatedInvoices = invs || [];
      }
      
      // Load current data
      const { data: currentData, error: fetchError } = await supabase
        .from('data')
        .select('*')
        .eq('shop_id', shopId)
        .single();
      
      if (fetchError && fetchError.code !== 'PGRST116') {
        throw fetchError;
      }
      
      // Delete related invoices from table
      for (const inv of relatedInvoices) {
        await supabase
          .from('invoices')
          .delete()
          .eq('id', inv.id);
        console.log('✅ Related invoice deleted:', inv.id);
      }
      
      // Delete related jobs from table
      for (const job of relatedJobs || []) {
        await supabase
          .from('jobs')
          .delete()
          .eq('id', job.id);
        console.log('✅ Related job deleted:', job.id);
      }
      
      // Update data table: remove related jobs and invoices
      const allJobs = currentData?.jobs || [];
      const updatedJobs = allJobs.filter(j => j.appointment_id !== pendingDeleteApptId);
      const allInvoices = currentData?.invoices || [];
      const updatedInvoices = allInvoices.filter(inv => 
        inv.appointment_id !== pendingDeleteApptId && 
        !relatedJobs.some(j => j.id === inv.job_id)
      );
      
      await supabase
        .from('data')
        .upsert({
          shop_id: shopId,
          jobs: updatedJobs,
          invoices: updatedInvoices,
          settings: currentData?.settings || {},
          appointments: currentData?.appointments || [],
          threads: currentData?.threads || []
        });
      
      // Delete the appointment
      await supabase
        .from('appointments')
        .delete()
        .eq('id', pendingDeleteApptId);
      console.log('✅ Appointment deleted from Supabase:', pendingDeleteApptId);
    } catch (e) {
      console.error('Error deleting appointment and related records from Supabase:', e);
    }
  }
  
  // Remove from local array
  allAppointments = allAppointments.filter(a => a.id !== pendingDeleteApptId);
  await saveAppointments(allAppointments);
  await renderAppointments();
  showNotification('Appointment and related jobs/invoices deleted');
  hideDeleteApptModal();
}

/**
 * Apply filters
 */
function applyFilters() {
  const searchTerm = document.getElementById('apptSearch').value.toLowerCase();
  const statusFilter = document.getElementById('apptStatus').value;
  
  let filtered = [...allAppointments];
  
  if (searchTerm) {
    filtered = filtered.filter(a => 
      (a.customer || '').toLowerCase().includes(searchTerm) ||
      (a.vehicle || '').toLowerCase().includes(searchTerm) ||
      (a.service || '').toLowerCase().includes(searchTerm) ||
      (a.phone || '').includes(searchTerm)
    );
  }
  
  if (statusFilter) {
    filtered = filtered.filter(a => a.status === statusFilter);
  }
  
  renderAppointments(filtered);
}

/**
 * Show notification
 */
function showNotification(message, type = 'success') {
  const notification = document.getElementById('notification');
  if (!notification) return;
  
  notification.textContent = message;
  notification.className = 'notification';
  
  if (type === 'error') {
    notification.style.background = '#ef4444';
  } else {
    notification.style.background = '#10b981';
  }
  
  notification.classList.remove('hidden');
  
  setTimeout(() => {
    notification.classList.add('hidden');
  }, 3000);
}

// ========================================
// APPOINTMENT NOTES SYSTEM
// ========================================

let currentNoteId = null;
let currentNotesAppointmentId = null;
let allNotes = [];
// Pending send-to roles selection for note modal (Set of role strings)
if (!window.pendingApptNoteSendTo) window.pendingApptNoteSendTo = new Set();

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
      pill.style.background = window.pendingApptNoteSendTo.has(r.key) ? '#10b981' : '#f3f4f6';
      pill.style.color = window.pendingApptNoteSendTo.has(r.key) ? '#fff' : '#111827';
      pill.onclick = (e) => {
        e.preventDefault();
        const key = pill.dataset.role;
        if (!key) return;
        // If selecting 'all', clear others; if selecting others, remove 'all'
        if (key === 'all') {
          window.pendingApptNoteSendTo.clear();
          window.pendingApptNoteSendTo.add('all');
        } else {
          window.pendingApptNoteSendTo.delete('all');
          if (window.pendingApptNoteSendTo.has(key)) window.pendingApptNoteSendTo.delete(key);
          else window.pendingApptNoteSendTo.add(key);
        }
        renderNoteSendToPills();
      };
      container.appendChild(pill);
    });
  } catch (e) { console.warn('renderNoteSendToPills failed', e); }
}

/**
 * Load notes for a specific appointment
 */
async function loadAppointmentNotes(appointmentId) {
  const supabase = getSupabaseClient();
  if (!supabase || !appointmentId) return [];
  
  try {
    // Fetch notes
    const { data: notes, error } = await supabase
      .from('appointment_notes')
      .select('*')
      .eq('appointment_id', appointmentId)
      .order('created_at', { ascending: false });
    
    if (error) throw error;
    if (!notes || notes.length === 0) return [];
    
    // Get unique user IDs from notes
    const userIds = [...new Set(notes.map(n => n.created_by).filter(Boolean))];
    if (userIds.length === 0) return notes;
    
    // Create a map of userId -> user for easy lookup
    const userMap = new Map();
    
    // Fetch user data from users table (admins/shop owners)
    try {
      const { data: users, error: userError } = await supabase
        .from('users')
        .select('id, first, last, email, role')
        .in('id', userIds);

      if (!userError && Array.isArray(users)) {
        users.forEach(u => {
          userMap.set(u.id, {
            first_name: u.first,
            last_name: u.last,
            email: u.email,
            role: u.role || 'admin'
          });
        });
      }
    } catch (e) {
      console.warn('Could not fetch users table data:', e);
    }
    
    // Fetch user data from shop_staff table (staff members).
    // Note: created_by may contain a shop_staff.auth_id (uuid) OR the numeric shop_staff.id
    try {
      const shopId = getCurrentShopId();
      const { data: staffRows, error: staffErr } = await supabase
        .from('shop_staff')
        .select('id, auth_id, first_name, last_name, email, role')
        .eq('shop_id', shopId);

      if (!staffErr && Array.isArray(staffRows)) {
        staffRows.forEach(s => {
          const entry = {
            first_name: s.first_name,
            last_name: s.last_name,
            email: s.email,
            role: s.role || 'staff'
          };
          // Map by auth_id (uuid) if present
          if (s.auth_id) userMap.set(s.auth_id, entry);
          // Also map by numeric id (string) to cover older notes that stored shop_staff.id
          if (s.id !== undefined && s.id !== null) userMap.set(String(s.id), entry);
        });
      }
    } catch (e) {
      console.warn('Could not fetch shop_staff table data:', e);
    }
    
    // Attach user data to each note
    // Enforce send-to visibility: only return notes the current user may see
    const role = await fetchCurrentUserRole().catch(() => 'staff');
    const isAdminView = (role === 'admin' || role === 'owner');

    // Get current user identity so creators always see their own notes
    let currentUser = null;
    let currentAuthId = null;
    try {
      currentUser = await getCurrentUserWithRole().catch(() => null);
      const { data: authData } = await getSupabaseClient().auth.getUser();
      currentAuthId = authData?.user?.id || null;
    } catch (e) {}

    const enriched = notes.map(note => {
      // Normalize send_to: allow text[] or JSON-encoded string
      let sendTo = note.send_to;
      if (!Array.isArray(sendTo)) {
        if (typeof sendTo === 'string') {
          try { sendTo = JSON.parse(sendTo); } catch (e) { sendTo = [sendTo]; }
        } else {
          sendTo = [];
        }
      }
      const key = (note.created_by !== undefined && note.created_by !== null) ? String(note.created_by) : note.created_by;
      return { ...note, user: (userMap.get(key) || userMap.get(note.created_by) || null), send_to: sendTo };
    });

    if (isAdminView) return enriched;

    // Filter notes by send_to array (allow if send_to includes 'all' or current role, or if send_to missing)
    return enriched.filter(n => {
      try {
        // Creator always sees their own notes
        if (n.created_by && (n.created_by === (currentUser?.id) || n.created_by === (currentUser?.auth_id) || n.created_by === currentAuthId)) return true;
        if (!n.send_to || n.send_to.length === 0) return true; // legacy notes visible to all
        if (Array.isArray(n.send_to)) {
          if (n.send_to.includes('all')) return true;
          if (n.send_to.includes(role)) return true;
          // support keys like 'admin' meaning admin/owner group - skip here
        }
      } catch (e) {}
      return false;
    });
  } catch (err) {
    console.error('Error loading appointment notes:', err);
    return [];
  }
}

/**
 * Render notes list in the appointment modal
 */
async function renderAppointmentNotes(appointmentId) {
  const container = document.getElementById('appointmentNotesList');
  if (!container) return;
  
  allNotes = await loadAppointmentNotes(appointmentId);
  currentNotesAppointmentId = appointmentId;
  
  container.innerHTML = '';
  
  if (allNotes.length === 0) {
    container.innerHTML = '<p style="color: #666; font-style: italic; padding: 12px; text-align: center;">No notes yet. Click "Add Note" below to create one.</p>';
    return;
  }
  
  allNotes.forEach(note => {
    const notePanel = createNotePanel(note);
    container.appendChild(notePanel);
  });
}

/**
 * Create a single note panel element
 */
function createNotePanel(note, showActions = true) {
  const panel = document.createElement('div');
  const noteIsRead = isNoteRead(note.id);
  panel.style.cssText = `border: 1px solid ${noteIsRead ? '#ddd' : '#3b82f6'}; border-radius: 8px; padding: 12px; background: ${noteIsRead ? '#f9f9f9' : '#f0f7ff'}; position: relative;`;
  panel.dataset.noteId = note.id;
  
  // Button container (top right)
  const btnContainer = document.createElement('div');
  btnContainer.style.cssText = 'position: absolute; top: 8px; right: 8px; display: flex; gap: 4px;';
  
  // Mark as read button (checkmark) - only show if unread
  if (!noteIsRead) {
    const readBtn = document.createElement('button');
    readBtn.className = 'btn small';
    readBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false"><path fill="currentColor" d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>';
    readBtn.style.cssText = 'padding: 4px 8px; border-radius: 4px; background: #10b981; color: white;';
    readBtn.title = 'Mark as read';
    readBtn.onclick = async (e) => {
      e.stopPropagation();
      markNoteAsRead(note.id);
      // Update panel styling
      panel.style.border = '1px solid #ddd';
      panel.style.background = '#f9f9f9';
      // Hide the read button
      readBtn.style.display = 'none';
      // Refresh the table to update dot indicator
      await renderAppointments();
      showNotification('Note marked as read', 'success');
    };
    btnContainer.appendChild(readBtn);
  }
  
  // Delete button
  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'btn small danger';
  deleteBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false"><path fill="white" d="M3 6h18v2H3V6zm2 3h14l-1 12a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2l-1-12zM9 4V3a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v1h5v2H4V4h5z"/></svg>';
  deleteBtn.style.cssText = 'padding: 4px 8px; border-radius: 4px;';
  deleteBtn.title = 'Delete note';
  deleteBtn.onclick = (e) => {
    e.stopPropagation();
    openDeleteApptNoteModal(note.id);
  };
  btnContainer.appendChild(deleteBtn);
  
  panel.appendChild(btnContainer);
  
  // Main content wrapper (flex row for text left, media right)
  const contentWrapper = document.createElement('div');
  contentWrapper.style.cssText = 'display: flex; gap: 16px; align-items: flex-start;';
  
  // Left side - text content
  const textContent = document.createElement('div');
  textContent.style.cssText = 'flex: 1; min-width: 0; padding-right: 30px;';
  
  // Header with author and date
  const header = document.createElement('div');
  header.style.cssText = 'display: flex; flex-direction: column; gap: 2px; margin-bottom: 8px;';
  
  const authorName = document.createElement('strong');
  authorName.style.fontSize = '14px';
  authorName.style.color = '#333';
  let userName = 'Unknown User';
  let senderRole = null;
  if (note.user) {
    const fullName = `${note.user.first_name || note.user.first || ''} ${note.user.last_name || note.user.last || ''}`.trim();
    userName = fullName || note.user.email || 'Unknown User';
    senderRole = note.user.role || note.user.role_name || null;
  }
  authorName.textContent = userName;

  const dateInfo = document.createElement('span');
  dateInfo.style.cssText = 'font-size: 12px; color: #666;';
  const createdDate = new Date(note.created_at);
  dateInfo.textContent = createdDate.toLocaleString();

  const authorRow = document.createElement('div');
  authorRow.style.cssText = 'display:flex; align-items:center; gap:8px;';
  authorRow.appendChild(authorName);
  let roleKey = (senderRole || '').toString().toLowerCase();
  let pillLabel = '';
  let pillBg = '#fbbf24';
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
  header.appendChild(dateInfo);
  // Show subject if present
  if (note.subject) {
    const subj = document.createElement('div');
    subj.style.cssText = 'font-size: 13px; color: #111827; font-weight: 600; margin-top:4px;';
    subj.textContent = note.subject;
    header.appendChild(subj);
  }
  // Show Sent To info
  try {
    const sentToText = (note.send_to && Array.isArray(note.send_to) && note.send_to.length) ? note.send_to.map(s => {
      const mapping = NOTE_ROLES.find(r => r.key === s);
      return mapping ? mapping.label : s;
    }).join(', ') : 'All';
    const sentTo = document.createElement('div');
    sentTo.style.cssText = 'font-size:12px; color: #4b5563;';
    sentTo.textContent = `Sent to: ${sentToText}`;
    header.appendChild(sentTo);
  } catch (e) {}
  
  // Note text content
  const content = document.createElement('p');
  content.style.cssText = 'margin: 0; font-size: 14px; line-height: 1.5; white-space: pre-wrap; color: #333;';
  content.textContent = note.note;
  
  textContent.appendChild(header);
  
  // Edit button (optional, only if showActions)
  if (showActions) {
    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'btn small';
    editBtn.textContent = 'Edit';
    editBtn.style.marginBottom = '8px';
    editBtn.addEventListener('click', () => openEditNoteModal(note));
    textContent.appendChild(editBtn);
  }
  
  textContent.appendChild(content);
  contentWrapper.appendChild(textContent);
  
  // Right side - media thumbnails
  if (note.media_urls && note.media_urls.length > 0) {
    const mediaContainer = document.createElement('div');
    // More margin when there's a checkmark button (unread) - 2 buttons need more space
    const rightMargin = noteIsRead ? '60px' : '100px';
    mediaContainer.style.cssText = `display: flex; flex-wrap: wrap; gap: 8px; max-width: 200px; justify-content: flex-end; margin-right: ${rightMargin};`;
    
    note.media_urls.forEach(media => {
      const thumb = document.createElement('div');
      thumb.style.cssText = 'width: 60px; height: 60px; border-radius: 6px; overflow: hidden; cursor: pointer; background: #ddd; display: flex; align-items: center; justify-content: center; flex-shrink: 0;';
      
      if (media.type === 'video') {
        // Video thumbnail with play icon
        thumb.innerHTML = `
          <div style="position: relative; width: 100%; height: 100%;">
            <video src="${media.url}" style="width: 100%; height: 100%; object-fit: cover;"></video>
            <div style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); background: rgba(0,0,0,0.6); border-radius: 50%; width: 24px; height: 24px; display: flex; align-items: center; justify-content: center;">
              <span style="color: white; font-size: 12px; margin-left: 2px;">▶</span>
            </div>
          </div>
        `;
      } else {
        // Image thumbnail
        const img = document.createElement('img');
        img.src = media.url;
        img.style.cssText = 'width: 100%; height: 100%; object-fit: cover;';
        img.alt = 'Note attachment';
        thumb.appendChild(img);
      }
      
      thumb.onclick = (e) => {
        e.stopPropagation();
        openApptMediaPreview(media.url, media.type);
      };
      
      mediaContainer.appendChild(thumb);
    });
    
    contentWrapper.appendChild(mediaContainer);
  }
  
  panel.appendChild(contentWrapper);
  
  return panel;
}

/**
 * Open modal to add a new note
 */
function openAddNoteModal() {
  currentNoteId = null;
  const modal = document.getElementById('noteModal');
  const title = document.getElementById('noteModalTitle');
  const textarea = document.getElementById('noteText');
  const subj = document.getElementById('noteSubject');
  
  if (!modal || !title || !textarea) return;
  
  title.textContent = 'Add Note';
  textarea.value = '';
  if (subj) subj.value = '';
  // reset send-to selection
  window.pendingApptNoteSendTo = new Set();
  renderNoteSendToPills();
  // Ensure this modal appears above any other open modal by temporarily raising z-index
  try {
    modal.dataset._prevZ = modal.style.zIndex || '';
    modal.style.zIndex = '40000';
  } catch (e) {}
  modal.classList.remove('hidden');
  textarea.focus();
}

/**
 * Open modal to edit an existing note
 */
function openEditNoteModal(note) {
  currentNoteId = note.id;
  const modal = document.getElementById('noteModal');
  const title = document.getElementById('noteModalTitle');
  const textarea = document.getElementById('noteText');
  const subj = document.getElementById('noteSubject');
  
  if (!modal || !title || !textarea) return;
  
  title.textContent = 'Edit Note';
  textarea.value = note.note;
  if (subj) subj.value = note.subject || '';
  // populate send-to selection
  try {
    // Normalize: if note.send_to contains 'all' plus others, drop 'all'
    let initSend = Array.isArray(note.send_to) ? note.send_to.slice() : [];
    if (initSend.includes('all') && initSend.length > 1) initSend = initSend.filter(s => s !== 'all');
    window.pendingApptNoteSendTo = new Set(initSend);
  } catch (e) { window.pendingApptNoteSendTo = new Set(); }
  renderNoteSendToPills();
  // Ensure this modal appears above any other open modal by temporarily raising z-index
  try {
    modal.dataset._prevZ = modal.style.zIndex || '';
    modal.style.zIndex = '40000';
  } catch (e) {}
  modal.classList.remove('hidden');
  textarea.focus();
}

// Pending media files for appointment note upload - use window to share across module instances
if (!window.pendingApptNoteMedia) window.pendingApptNoteMedia = [];
let apptNoteToDeleteId = null;

/**
 * Close note modal
 */
function closeNoteModal() {
  const modal = document.getElementById('noteModal');
  if (modal) modal.classList.add('hidden');
  currentNoteId = null;
  // Clear media selections
  window.pendingApptNoteMedia = [];
  const preview = document.getElementById('noteMediaPreview');
  if (preview) preview.innerHTML = '';
  const count = document.getElementById('noteMediaCount');
  if (count) count.textContent = 'No files selected';
  const input = document.getElementById('noteMediaInput');
  if (input) input.value = '';
}

/**
 * Handle media file selection for appointment notes
 */
function handleApptNoteMediaSelect(input) {
  console.log('[ApptNoteMedia] handleApptNoteMediaSelect called', input);
  const files = Array.from(input.files);
  console.log('[ApptNoteMedia] Files selected:', files.length, files);
  const preview = document.getElementById('noteMediaPreview');
  const count = document.getElementById('noteMediaCount');
  
  if (files.length === 0) {
    window.pendingApptNoteMedia = [];
    if (preview) preview.innerHTML = '';
    if (count) count.textContent = 'No files selected';
    return;
  }
  
  // Validate file sizes (max 10MB each)
  const maxSize = 10 * 1024 * 1024;
  const validFiles = files.filter(f => {
    if (f.size > maxSize) {
      alert(`File "${f.name}" is too large. Maximum size is 10MB.`);
      return false;
    }
    return true;
  });
  
  window.pendingApptNoteMedia = validFiles;
  console.log('[ApptNoteMedia] window.pendingApptNoteMedia set to:', window.pendingApptNoteMedia.length, 'files');
  
  if (count) {
    count.textContent = `${validFiles.length} file${validFiles.length !== 1 ? 's' : ''} selected`;
  }
  
  // Show previews
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
        e.preventDefault();
        e.stopPropagation();
        window.pendingApptNoteMedia.splice(idx, 1);
        handleApptNoteMediaSelect({ files: window.pendingApptNoteMedia });
      };
      thumb.appendChild(removeBtn);
      
      preview.appendChild(thumb);
    });
  }
}

window.handleApptNoteMediaSelect = handleApptNoteMediaSelect;

/**
 * Upload media files to Supabase storage for appointments
 */
async function uploadApptNoteMedia(files, appointmentId) {
  console.log('[NoteMedia] Starting upload for', files.length, 'files');
  
  const supabase = getSupabaseClient();
  if (!supabase || !files.length) {
    console.log('[NoteMedia] No supabase client or no files');
    return [];
  }
  
  const shopId = getCurrentShopId();
  console.log('[NoteMedia] Shop ID:', shopId, 'Appointment ID:', appointmentId);
  
  const uploadedMedia = [];
  
  for (const file of files) {
    try {
      console.log('[NoteMedia] Uploading file:', file.name, 'Type:', file.type, 'Size:', file.size);
      
      const fileExt = file.name.split('.').pop().toLowerCase();
      const timestamp = Date.now();
      const random = Math.random().toString(36).substr(2, 9);
      const fileName = `${shopId}/${appointmentId}/${timestamp}_${random}.${fileExt}`;
      
      console.log('[NoteMedia] Target path:', fileName);
      console.log('[NoteMedia] Attempting upload to bucket: note-media');
      
      // Use 'note-media' bucket (with hyphen, not camelCase)
      const { data, error } = await supabase.storage
        .from('note-media')
        .upload(fileName, file, {
          cacheControl: '3600',
          upsert: false,
          contentType: file.type
        });
      
      if (error) {
        console.error('[NoteMedia] Upload error:', error);
        console.error('[NoteMedia] Error details:', JSON.stringify(error));
        showNotification(`Failed to upload ${file.name}: ${error.message}`, 'error');
        continue;
      }
      
      console.log('[NoteMedia] Upload successful:', data);
      
      // Get public URL
      const { data: urlData } = supabase.storage
        .from('note-media')
        .getPublicUrl(fileName);
      
      console.log('[NoteMedia] Public URL data:', urlData);
      
      if (urlData?.publicUrl) {
        const mediaObj = {
          url: urlData.publicUrl,
          type: file.type.startsWith('video/') ? 'video' : 'image',
          name: file.name
        };
        uploadedMedia.push(mediaObj);
        console.log('[NoteMedia] Added to uploadedMedia:', mediaObj);
      } else {
        console.error('[NoteMedia] No public URL returned for file:', file.name);
      }
    } catch (err) {
      console.error('[NoteMedia] Exception during upload:', err);
      console.error('[NoteMedia] Exception stack:', err.stack);
      showNotification(`Error uploading ${file.name}`, 'error');
    }
  }
  
  console.log('[NoteMedia] Upload complete. Total uploaded:', uploadedMedia.length, 'files');
  console.log('[NoteMedia] Uploaded media array:', JSON.stringify(uploadedMedia));
  return uploadedMedia;
}

/**
 * Open media preview modal for appointments
 */
function openApptMediaPreview(url, type) {
  const modal = document.getElementById('apptMediaPreviewModal');
  const content = document.getElementById('apptMediaPreviewContent');
  
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

window.openApptMediaPreview = openApptMediaPreview;

/**
 * Close media preview modal for appointments
 */
function closeApptMediaPreview() {
  const modal = document.getElementById('apptMediaPreviewModal');
  if (modal) {
    modal.classList.add('hidden');
    const video = modal.querySelector('video');
    if (video) video.pause();
  }
}

window.closeApptMediaPreview = closeApptMediaPreview;

/**
 * Open delete note confirmation modal for appointments
 */
function openDeleteApptNoteModal(noteId) {
  console.log('[Notes] Opening delete modal for note:', noteId);
  apptNoteToDeleteId = noteId;
  const modal = document.getElementById('deleteApptNoteModal');
  if (modal) {
    // Store noteId on the modal element as well for redundancy
    modal.dataset.noteId = noteId;
    modal.classList.remove('hidden');
  }
}

window.openDeleteApptNoteModal = openDeleteApptNoteModal;

/**
 * Close delete note modal for appointments
 */
function closeDeleteApptNoteModal() {
  const modal = document.getElementById('deleteApptNoteModal');
  if (modal) modal.classList.add('hidden');
  apptNoteToDeleteId = null;
}

window.closeDeleteApptNoteModal = closeDeleteApptNoteModal;

/**
 * Confirm and delete the appointment note
 */
async function confirmDeleteApptNote() {
  // Try to get noteId from variable first, then from modal dataset as fallback
  const modal = document.getElementById('deleteApptNoteModal');
  const noteId = apptNoteToDeleteId || (modal ? modal.dataset.noteId : null);
  
  console.log('[Notes] confirmDeleteApptNote called, noteId:', noteId);
  
  if (!noteId) {
    console.error('[Notes] No note ID to delete');
    return;
  }
  
  const supabase = getSupabaseClient();
  if (!supabase) {
    showNotification('Unable to delete note. Please try again.', 'error');
    return;
  }
  
  // Close the delete confirmation modal first
  closeDeleteApptNoteModal();
  
  try {
    console.log('[Notes] Deleting note from database...');
    const { error } = await supabase
      .from('appointment_notes')
      .delete()
      .eq('id', noteId);
    
    if (error) throw error;
    
    console.log('[Notes] Note deleted successfully');
    
    // Immediately refresh both note lists to show the deletion
    if (currentNotesAppointmentId) {
      // Reload notes from database
      const freshNotes = await loadAppointmentNotes(currentNotesAppointmentId);
      allNotes = freshNotes;
      
      // Refresh edit modal notes list (appointmentNotesList) if it exists
      const editModalNotesList = document.getElementById('appointmentNotesList');
      if (editModalNotesList) {
        editModalNotesList.innerHTML = '';
        if (freshNotes.length === 0) {
          editModalNotesList.innerHTML = '<p style="color: #666; font-style: italic; padding: 12px; text-align: center;">No notes yet. Click "Add Note" below to create one.</p>';
        } else {
          freshNotes.forEach(note => {
            const notePanel = createNotePanel(note, true);
            editModalNotesList.appendChild(notePanel);
          });
        }
      }
      
      // Refresh view modal notes list (viewModalNotesList) if it exists
      const viewModalNotesList = document.getElementById('viewModalNotesList');
      if (viewModalNotesList) {
        viewModalNotesList.innerHTML = '';
        if (freshNotes.length === 0) {
          viewModalNotesList.innerHTML = '<p style="color: #666; font-style: italic; padding: 12px; text-align: center;">No notes yet. Click "Add Note" above to create one.</p>';
        } else {
          freshNotes.forEach(note => {
            const notePanel = createNotePanel(note, false);
            viewModalNotesList.appendChild(notePanel);
          });
        }
      }
    }
    
    showNotification('Note deleted', 'success');
  } catch (err) {
    console.error('[Appointments] Error deleting note:', err);
    showNotification('Failed to delete note. Please try again.', 'error');
  }
}

window.confirmDeleteApptNote = confirmDeleteApptNote;

/**
 * Save note (create or update)
 */
async function saveNote(e) {
  if (e) e.preventDefault();
  
  console.log('[ApptNotes] ====== SAVING NOTE ======');
  console.log('[ApptNotes] window.pendingApptNoteMedia:', window.pendingApptNoteMedia);
  console.log('[ApptNotes] window.pendingApptNoteMedia.length:', window.pendingApptNoteMedia.length);
  
  const textarea = document.getElementById('noteText');
  const saveBtn = document.getElementById('saveNoteBtn');
  const noteText = textarea.value.trim();
  
  console.log('[ApptNotes] noteText:', noteText);
  console.log('[ApptNotes] currentNotesAppointmentId:', currentNotesAppointmentId);
  console.log('[ApptNotes] currentNoteId:', currentNoteId);
  
  if (!noteText && window.pendingApptNoteMedia.length === 0) {
    showNotification('Please enter a note or add media.', 'error');
    return;
  }
  
  const supabase = getSupabaseClient();
  const authId = await getCurrentAuthId();
  
  if (!supabase || !authId || !currentNotesAppointmentId) {
    showNotification('Unable to save note. Please try again.', 'error');
    return;
  }
  
  // Disable save button and show loading
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';
  }
  
  try {
    // Upload media files if any (only for new notes)
    let mediaUrls = [];
    if (window.pendingApptNoteMedia.length > 0 && !currentNoteId) {
      mediaUrls = await uploadApptNoteMedia(window.pendingApptNoteMedia, currentNotesAppointmentId);
    }
    
    if (currentNoteId) {
      // Update existing note (no media update for edits)
        const subject = document.getElementById('noteSubject')?.value || null;
        let sendToArr = Array.from(window.pendingApptNoteSendTo || []);
        // If both 'all' and specific roles are present, prefer specific roles (remove 'all')
        if (sendToArr.includes('all') && sendToArr.length > 1) sendToArr = sendToArr.filter(s => s !== 'all');
        console.log('[ApptNotes] saving update, send_to:', sendToArr);
      const { error } = await supabase
        .from('appointment_notes')
        .update({ note: noteText, subject: subject, send_to: sendToArr })
        .eq('id', currentNoteId);
      
      if (error) throw error;
    } else {
      // Create new note with media
      const subject = document.getElementById('noteSubject')?.value || null;
      let sendToArr = Array.from(window.pendingApptNoteSendTo || []);
      if (sendToArr.includes('all') && sendToArr.length > 1) sendToArr = sendToArr.filter(s => s !== 'all');
      console.log('[ApptNotes] creating note, send_to:', sendToArr);
      const noteData = {
        appointment_id: currentNotesAppointmentId,
        note: noteText || '(Media attached)',
        created_by: authId,
        subject: subject,
        send_to: sendToArr
      };
      
      if (mediaUrls.length > 0) {
        noteData.media_urls = mediaUrls;
      }
      
      const { error } = await supabase
        .from('appointment_notes')
        .insert(noteData);
      
      if (error) throw error;
    }
    
    // Refresh notes list in both edit modal and view modal
    await renderAppointmentNotes(currentNotesAppointmentId);
    
    // Also refresh view modal notes if it's visible
    const viewModalNotesList = document.getElementById('viewModalNotesList');
    if (viewModalNotesList) {
      await renderViewModalNotes(currentNotesAppointmentId);
    }
    
    closeNoteModal();
    showNotification('Note saved successfully', 'success');
    
  } catch (err) {
    console.error('Error saving note:', err);
    showNotification('Failed to save note. Please try again.', 'error');
  } finally {
    // Re-enable save button
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save Note';
    }
  }
}

/**
 * Delete a note
 */
async function deleteAppointmentNote(noteId) {
  if (!confirm('Are you sure you want to delete this note?')) return;
  
  const supabase = getSupabaseClient();
  if (!supabase) return;
  
  try {
    const { error } = await supabase
      .from('appointment_notes')
      .delete()
      .eq('id', noteId);
    
    if (error) throw error;
    
    console.log('✅ Note deleted');
    
    // Refresh notes list in both edit modal and view modal
    await renderAppointmentNotes(currentNotesAppointmentId);
    
    // Also refresh view modal notes if it's visible
    const viewModalNotesList = document.getElementById('viewModalNotesList');
    if (viewModalNotesList) {
      await renderViewModalNotes(currentNotesAppointmentId);
    }
    
  } catch (err) {
    console.error('Error deleting note:', err);
    showNotification('Failed to delete note. Please try again.', 'error');
  }
}

// ========================================
// END APPOINTMENT NOTES SYSTEM
// ========================================

/**
 * Setup appointments page
 */
async function setupAppointments() {
  console.log('📅 Setting up Appointments page...');
  
  // Check if current user is staff (not admin) - use async version to get role from Supabase
  const currentUser = await getCurrentUserWithRole();
  isStaffUser = currentUser.role === 'staff';
  currentUserForClaim = currentUser; // Store for claim/unclaim checking
  console.log(`👤 User role: ${currentUser.role || 'unknown'}, isStaffUser: ${isStaffUser}`);
  
  // Hide New Appointment button for staff
  const newBtn = document.getElementById('newAppt');
  if (newBtn && isStaffUser) {
    newBtn.style.display = 'none';
  }
  
  // Load appointments
  allAppointments = await loadAppointments();
  console.log(`✅ Loaded ${allAppointments.length} appointments`);
  // Load services for suggestions
  await loadServices();
  // Auto-transition any platform-created 'new' appointments older than configured timeout
  await checkAndTransitionNewAppointments(allAppointments);
  
  // Render initial table
  await renderAppointments();
  
  // Event listeners
  if (newBtn) newBtn.addEventListener('click', openNewModal);
  
  const closeNewBtn = document.getElementById('closeAppt');
  if (closeNewBtn) closeNewBtn.addEventListener('click', closeNewModal);
  
  const saveNewBtn = document.getElementById('saveAppt');
  if (saveNewBtn) saveNewBtn.addEventListener('click', saveNewAppointment);
  
  const closeEditBtn = document.getElementById('closeApptModal');
  if (closeEditBtn) closeEditBtn.addEventListener('click', closeEditModal);
  
  const saveEditBtn = document.getElementById('saveApptEdit');
  if (saveEditBtn) saveEditBtn.addEventListener('click', saveEditedAppointment);
  
  const apptForm = document.getElementById('apptForm');
  if (apptForm) apptForm.addEventListener('submit', saveEditedAppointment);
  
  // Note modal event listeners
  const addNoteBtn = document.getElementById('addNoteBtn');
  if (addNoteBtn) addNoteBtn.addEventListener('click', openAddNoteModal);
  
  const closeNoteBtn = document.getElementById('closeNoteModal');
  if (closeNoteBtn) closeNoteBtn.addEventListener('click', closeNoteModal);
  
  const noteForm = document.getElementById('noteForm');
  if (noteForm) noteForm.addEventListener('submit', saveNote);
  
  const filterBtn = document.getElementById('apptFilter');
  if (filterBtn) filterBtn.addEventListener('click', applyFilters);
  
  const searchInput = document.getElementById('apptSearch');
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      // Real-time search
      setTimeout(applyFilters, 300);
    });
  }

  // Make headers sortable
  try {
    document.querySelectorAll('#apptTable thead th.sortable').forEach(h => {
      h.style.cursor = 'pointer';
      h.addEventListener('click', async () => {
        const col = h.dataset.col;
        if (!col) return;
        if (apptSortCol === col) apptSortDir = apptSortDir === 'asc' ? 'desc' : 'asc';
        else { apptSortCol = col; apptSortDir = 'asc'; }
        // update header classes
        document.querySelectorAll('#apptTable thead th.sortable').forEach(x => x.classList.remove('asc','desc'));
        h.classList.add(apptSortDir === 'asc' ? 'asc' : 'desc');
        await renderAppointments();
      });
    });
  } catch (e) {}
  
  // Check for #new hash
  if (window.location.hash === '#new') {
    openNewModal();
  }
  // Delete modal event listeners
  const deleteModal = document.getElementById('deleteApptModal');
  const deleteModalClose = document.getElementById('deleteApptModalClose');
  const deleteModalCancel = document.getElementById('deleteApptModalCancel');
  const deleteModalConfirm = document.getElementById('deleteApptModalConfirm');
  if (deleteModalClose) deleteModalClose.addEventListener('click', hideDeleteApptModal);
  if (deleteModalCancel) deleteModalCancel.addEventListener('click', hideDeleteApptModal);
  if (deleteModalConfirm) deleteModalConfirm.addEventListener('click', confirmDeleteAppointment);
  if (deleteModal) deleteModal.addEventListener('click', (e) => { if (e.target === deleteModal) hideDeleteApptModal(); });
  
  // Staff action modal event listeners
  const staffActionModal = document.getElementById('staffActionModal');
  const closeStaffActionBtn = document.getElementById('closeStaffActionModal');
  const staffActionViewBtn = document.getElementById('staffActionView');
  const staffActionClaimBtn = document.getElementById('staffActionClaim');
  
  if (closeStaffActionBtn) closeStaffActionBtn.addEventListener('click', closeStaffActionModal);
  if (staffActionViewBtn) staffActionViewBtn.addEventListener('click', handleStaffActionView);
  if (staffActionClaimBtn) staffActionClaimBtn.addEventListener('click', handleStaffActionClaim);
  if (staffActionModal) staffActionModal.addEventListener('click', (e) => { if (e.target === staffActionModal) closeStaffActionModal(); });
  
  // Admin action modal event listeners
  const adminActionModal = document.getElementById('adminActionModal');
  const closeAdminActionBtn = document.getElementById('closeAdminActionModal');
  const adminActionViewBtn = document.getElementById('adminActionView');
  const adminActionInvoiceBtn = document.getElementById('adminActionInvoice');
  const adminActionEditBtn = document.getElementById('adminActionEdit');
  const adminActionDeleteBtn = document.getElementById('adminActionDelete');
  
  if (closeAdminActionBtn) closeAdminActionBtn.addEventListener('click', closeAdminActionModal);
  if (adminActionViewBtn) adminActionViewBtn.addEventListener('click', handleAdminActionView);
  if (adminActionInvoiceBtn) adminActionInvoiceBtn.addEventListener('click', handleAdminActionInvoice);
  if (adminActionEditBtn) adminActionEditBtn.addEventListener('click', handleAdminActionEdit);
  if (adminActionDeleteBtn) adminActionDeleteBtn.addEventListener('click', handleAdminActionDelete);
  if (adminActionModal) adminActionModal.addEventListener('click', (e) => { if (e.target === adminActionModal) closeAdminActionModal(); });
  
  // Initialize vehicle dropdowns
  const vehicleYearSelect = document.getElementById('vehicleYear');
  const vehicleMakeSelect = document.getElementById('vehicleMake');
  const vehicleModelSelect = document.getElementById('vehicleModel');
  const naVehicleYearSelect = document.getElementById('naVehicleYear');
  const naVehicleMakeSelect = document.getElementById('naVehicleMake');
  const naVehicleModelSelect = document.getElementById('naVehicleModel');
  
  // Hide vehicle fields for non-auto industries
  if (!currentUsesVehicles()) {
    console.log('🚗 Hiding vehicle fields for non-auto industry');
    
    // Use setTimeout to ensure DOM is ready
    setTimeout(() => {
      // Hide in edit modal - more specific selector
      const editModalBody = document.querySelector('#apptModal .modal-body');
      if (editModalBody) {
        console.log('🔍 Found edit modal body, searching for vehicle grids...');
        // Find the vehicle dropdown container (grid cols-3 with Year/Make/Model)
        const vehicleGrids = editModalBody.querySelectorAll('.grid.cols-3');
        console.log(`🔍 Found ${vehicleGrids.length} .grid.cols-3 containers in edit modal`);
        
        vehicleGrids.forEach((grid, index) => {
          console.log(`🔍 Checking grid ${index}:`, grid.innerHTML.substring(0, 100));
          // Check if this grid contains vehicle selects
          if (grid.querySelector('select[name="vehicle_year"]') || 
              grid.querySelector('#vehicleYear') ||
              (grid.innerHTML.includes('Year') && grid.innerHTML.includes('Make'))) {
            grid.style.display = 'none';
            console.log(`✅ Hidden edit modal vehicle grid ${index}`);
          }
        });
      } else {
        console.warn('⚠️ Edit modal body not found');
      }
      
      // Hide VIN field in edit modal
      const editVinField = document.querySelector('#apptModal input[name="vin"], #apptModal #apptVin');
      if (editVinField) {
        const vinContainer = editVinField.closest('div');
        if (vinContainer) {
          vinContainer.style.display = 'none';
          console.log('✅ Hidden edit modal VIN field');
        }
      }
      
      // Hide in new modal
      const newModalBody = document.querySelector('#newApptModal .modal-body');
      if (newModalBody) {
        const newVehicleGrid = newModalBody.querySelector('.grid.cols-3');
        if (newVehicleGrid) {
          newVehicleGrid.style.display = 'none';
          console.log('✅ Hidden new modal vehicle grid');
        }
      }
      
      // Hide VIN field in new modal  
      const newVinField = document.getElementById('naVin');
      if (newVinField) {
        const vinContainer = newVinField.closest('div');
        if (vinContainer) {
          vinContainer.style.display = 'none';
          console.log('✅ Hidden new modal VIN field');
        }
      }
      
      // Hide vehicle column in table
      const vehicleHeader = document.querySelector('#apptTable th[data-col="vehicle"]');
      if (vehicleHeader) {
        vehicleHeader.style.display = 'none';
        console.log('✅ Hidden vehicle table column');
      }
      
      console.log('✅ Vehicle field hiding complete');
    }, 100); // Small delay to ensure DOM is ready
  }
  
  if (vehicleYearSelect) populateVehicleYears(vehicleYearSelect);
  if (vehicleMakeSelect) {
    populateVehicleMakes(vehicleMakeSelect, vehicleYearSelect);
    vehicleMakeSelect.addEventListener('change', () => populateVehicleModels(vehicleMakeSelect, vehicleModelSelect, vehicleYearSelect));
  }
  if (vehicleYearSelect && vehicleMakeSelect) {
    vehicleYearSelect.addEventListener('change', () => {
      populateVehicleMakes(vehicleMakeSelect, vehicleYearSelect);
      populateVehicleModels(vehicleMakeSelect, vehicleModelSelect, vehicleYearSelect);
    });
  }
  
  if (naVehicleYearSelect) populateVehicleYears(naVehicleYearSelect);
  if (naVehicleMakeSelect) {
    populateVehicleMakes(naVehicleMakeSelect, naVehicleYearSelect);
    naVehicleMakeSelect.addEventListener('change', () => populateVehicleModels(naVehicleMakeSelect, naVehicleModelSelect, naVehicleYearSelect));
  }
  if (naVehicleYearSelect && naVehicleMakeSelect) {
    naVehicleYearSelect.addEventListener('change', () => {
      populateVehicleMakes(naVehicleMakeSelect, naVehicleYearSelect);
      populateVehicleModels(naVehicleMakeSelect, naVehicleModelSelect, naVehicleYearSelect);
    });
  }

  // Create themed floating dropdowns for Y/M/M selects so they always open downward
  function initFloatingSelect(selectId) {
    const sel = document.getElementById(selectId);
    if (!sel) return;

    // Hide native select but keep it in the form for submission and for existing populate functions
    sel.style.display = 'none';

    // Create text input trigger so users can type or pick from list
    const inputEl = document.createElement('input');
    inputEl.type = 'text';
    inputEl.className = 'custom-select-input';
    inputEl.id = selectId + 'Input';
    inputEl.autocomplete = 'off';
    inputEl.style.cssText = 'width:100%;padding:10px;border:1px solid var(--line);border-radius:6px;background:white;';
    const selectedOpt = sel.options[sel.selectedIndex];
    if (selectedOpt && !selectedOpt.value) {
      inputEl.value = '';
      inputEl.placeholder = selectedOpt.text || '-- Select --';
    } else {
      inputEl.value = selectedOpt?.text || '';
      inputEl.placeholder = '';
    }

    // Insert the input before the hidden select
    sel.parentNode.insertBefore(inputEl, sel);

    // Create floating list container appended to body
    const floatingId = 'floating-' + selectId;
    let floating = document.getElementById(floatingId);
    if (!floating) {
      floating = document.createElement('div');
      floating.id = floatingId;
      floating.className = 'custom-select-list floating';
      floating.style.cssText = 'position:fixed;left:0;top:0;background:white;border:1px solid #e6e6e6;border-radius:6px;box-shadow:0 8px 24px rgba(13,38,59,0.08);max-height:260px;overflow:auto;display:none;z-index:200020;';
      document.body.appendChild(floating);
    }

    const closeList = () => { floating.style.display = 'none'; };
    const openList = (filter = '') => {
      // Build items from current select options each time (keeps in sync with populateX functions)
      floating.innerHTML = '';
      const q = (filter || '').trim().toLowerCase();
      Array.from(sel.options).forEach(opt => {
        const text = opt.text || opt.value || '';
        if (q && !text.toLowerCase().includes(q)) return;
        const it = document.createElement('div');
        it.className = 'custom-select-item';
        it.dataset.value = opt.value;
        it.style.cssText = 'padding:10px;border-bottom:1px solid #f3f4f6;cursor:pointer;';
        it.textContent = text;
        if (!opt.value) it.style.opacity = '0.6';
        floating.appendChild(it);
      });

      const rect = inputEl.getBoundingClientRect();
      floating.style.minWidth = rect.width + 'px';
      floating.style.left = rect.left + 'px';
      floating.style.top = (rect.bottom + 6) + 'px';
      floating.style.display = 'block';

      // Wire item clicks
      floating.querySelectorAll('.custom-select-item').forEach(it => {
        it.onclick = (ev) => {
          const v = ev.currentTarget.dataset.value;
          const label = ev.currentTarget.textContent || v;
          if (v === '') {
            // User picked the ghost prompt - clear value and show placeholder
            sel.value = '';
            inputEl.value = '';
            inputEl.placeholder = label || '-- Select --';
          } else {
            // Ensure option exists and select it
            if (![...sel.options].some(o => o.value === v)) {
              sel.appendChild(new Option(label, v));
            }
            sel.value = v;
            inputEl.value = label;
            inputEl.placeholder = '';
          }
          // Notify any listeners (populateVehicleModels/listeners rely on change events)
          sel.dispatchEvent(new Event('change', { bubbles: true }));
          closeList();
        };
      });
    };

    // Keep input in sync when select changes programmatically
    sel.addEventListener('change', () => {
      const so = sel.options[sel.selectedIndex];
      if (so && !so.value) {
        inputEl.value = '';
        inputEl.placeholder = so.text || '-- Select --';
      } else {
        inputEl.value = so?.text || sel.value || '';
        inputEl.placeholder = '';
      }
    });

    // Typing behavior: filter list and allow creating new option on Enter
    let ignoreBlur = false;
    inputEl.addEventListener('input', (e) => {
      openList(e.target.value);
    });
    inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const v = inputEl.value.trim();
        if (!v) return;
        // Try to find matching option
        const match = [...sel.options].find(o => (o.text || '').toLowerCase() === v.toLowerCase() || o.value === v);
        if (match) {
          sel.value = match.value;
        } else {
          // Add new option and select it
          sel.appendChild(new Option(v, v));
          sel.value = v;
        }
        // Update input/placeholder
        inputEl.value = sel.value === '' ? '' : inputEl.value;
        inputEl.placeholder = sel.value === '' ? (sel.options[sel.selectedIndex]?.text || '') : '';
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        closeList();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        // Focus first item if present
        const first = floating.querySelector('.custom-select-item');
        if (first) first.focus();
      }
    });

    // Open list on focus
    inputEl.addEventListener('focus', (e) => { openList(e.target.value); });

    // Improved: Only close if click is outside both input and floating list
    function handleDocClick(e) {
      if (e.target === inputEl || floating.contains(e.target)) return;
      closeList();
    }
    document.addEventListener('mousedown', handleDocClick);

    // Clean up event on removal
    inputEl.addEventListener('blur', () => {
      setTimeout(() => {
        if (document.activeElement !== inputEl && !floating.contains(document.activeElement)) {
          closeList();
        }
      }, 150);
    });
  }

  // Initialize floating selects for appointment Y/M/M and new-appointment (na) Y/M/M
  ['vehicleYear','vehicleMake','vehicleModel','naVehicleYear','naVehicleMake','naVehicleModel'].forEach(id => initFloatingSelect(id));
  
  // ========== VIN Decoder Setup ==========
  initVinDecoder();
  
  // Start polling for notes updates
  startNotesPolling();
  // Start appointment status polling to keep statuses in sync across users
  if (typeof startApptStatusPolling === 'function') startApptStatusPolling();
  
  console.log('✅ Appointments page setup complete');
}

// Export the customer upsert function so it can be used from the modal save buttons
export { setupAppointments, upsertCustomerToSupabase, saveAppointments, loadAppointments, renderAppointments, openViewModal };

// Initialize note modal bindings for pages that reuse the appointment modals
function initAppointmentNotes() {
  // Expose saveNote for pages that don't run full setupAppointments
  try { window.saveNote = saveNote; } catch (e) {}
  try { window.openAddNoteModal = openAddNoteModal; } catch (e) {}
  try { window.closeNoteModal = closeNoteModal; } catch (e) {}

  // Attach DOM listeners if elements are present
  const addNoteBtn = document.getElementById('addNoteBtn');
  if (addNoteBtn) addNoteBtn.addEventListener('click', openAddNoteModal);
  const closeNoteBtn = document.getElementById('closeNoteModal');
  if (closeNoteBtn) closeNoteBtn.addEventListener('click', closeNoteModal);
  const noteForm = document.getElementById('noteForm');
  if (noteForm) noteForm.addEventListener('submit', saveNote);

  // Ensure file input handler is exposed (already done above but re-export for safety)
  if (window.handleApptNoteMediaSelect) window.handleApptNoteMediaSelect = handleApptNoteMediaSelect;
}

// Allow other pages to set which appointments are currently displayed
function setDisplayedAppointments(list) {
  if (!Array.isArray(list)) return;
  allAppointments = list;
}

export { initAppointmentNotes, startNotesPolling, stopNotesPolling, setDisplayedAppointments };