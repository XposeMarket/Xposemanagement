/**
 * pages/jobs.js
 * Jobs page - List, CRUD, Status management, Parts finder
 * 
 * Handles:
 * - Loading jobs from Supabase (data.jobs JSONB)
 * - Creating jobs from appointments
 * - Status management (in_progress, awaiting_parts, completed)
 * - Assignment to staff
 * - Parts finder integration
 */

import { getSupabaseClient } from '../helpers/supabase.js';
import { LS } from '../helpers/constants.js';
import { saveAppointments } from './appointments.js?v=1767391500';
import { createShopNotification } from '../helpers/shop-notifications.js';
import { getCurrentShopId } from '../helpers/multi-shop.js';
import { getInspectionSummary } from '../helpers/inspection-api.js';
import { inspectionForm } from '../components/inspectionFormModal.js';
import { openDiagnosticsModal } from '../components/diagnostics/DiagnosticsModal.js';

// Current job being edited
let currentJobId = null;
let currentJobForStatus = null;
let currentJobForRemove = null;
let currentJobNotesAppointmentId = null;
let allJobs = [];
let allAppointments = [];
let allUsers = [];
let allStaff = []; // shop_staff rows (for assignment lookups)
// Track if current user is staff (not admin)
let isStaffUser = false;
let currentStaffUserId = null;
let currentStaffAuthId = null; // auth_id for consistent lookups
// Draft for newly-created or selected service to be used in add-flow
let newServiceDraft = null;
// Sorting state for jobs tables
let jobSortCol = 'created_at';
let jobSortDir = 'desc';

// Status options for jobs
const JOB_STATUSES = ['in_progress', 'awaiting_parts', 'completed'];

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
    if (!supabase || !allJobs.length) return;
    
    const appointmentIds = allJobs.map(j => j.appointment_id).filter(Boolean);
    if (!appointmentIds.length) return;
    
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
      console.log('[NotesPolling] Notes changed, refreshing jobs table...');
      lastKnownNotesHash = currentHash;
      await renderJobs();
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

// ========== Status Polling ==========
let statusPollingInterval = null;
let lastKnownStatusHash = null;
let lastKnownJobInvoiceHash = null;
const STATUS_POLL_INTERVAL = 15000; // 15 seconds - align with notifications and claim-board

function generateJobInvoiceHash(invoices) {
  if (!invoices || invoices.length === 0) return 'empty';
  return invoices.map(inv => {
    const itemsHash = (inv.items || []).map(i => `${i.name || ''}:${i.type || ''}`).join(',');
    return `${inv.id}:${inv.updated_at || ''}:${itemsHash}`;
  }).sort().join('|');
}

async function pollForInvoiceChanges() {
  try {
    const supabase = getSupabaseClient();
    const shopId = getCurrentShopId();
    if (!supabase || !shopId) return;

    const { data: invoiceRows } = await supabase
      .from('invoices')
      .select('id, appointment_id, items, updated_at')
      .eq('shop_id', shopId);
    
    const currentHash = generateJobInvoiceHash(invoiceRows || []);
    if (lastKnownJobInvoiceHash === null) { lastKnownJobInvoiceHash = currentHash; return; }
    if (currentHash !== lastKnownJobInvoiceHash) {
      console.log('[JobsPolling] Invoice items changed, refreshing table...');
      lastKnownJobInvoiceHash = currentHash;
      await renderJobs();
    }
  } catch (e) {
    console.warn('[JobsPolling] Error polling invoices:', e);
  }
}

function startInvoicePolling() {
  // Poll for invoice changes every 15 seconds (aligned with status polling)
  setInterval(pollForInvoiceChanges, STATUS_POLL_INTERVAL);
  pollForInvoiceChanges(); // Initial poll
}

// Highlighting for newly displayed job rows
let newJobHighlights = new Map();
const HIGHLIGHT_DURATION = 8000; // 8 seconds
const HIGHLIGHT_FADE_MS = 600; // fade out duration
let lastDisplayedJobIds = new Set();

function injectJobHighlightStyles() {
  if (document.getElementById('jobs-highlight-styles')) return;
    // Use the same layout as appointments' createNotePanel but without edit action
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
        await renderJobs();
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
      openDeleteNoteModal(note.id);
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

    // Create author row with name + role pill (inline)
    const authorRow = document.createElement('div');
    authorRow.style.cssText = 'display:flex; align-items:center; gap:8px;';
    authorRow.appendChild(authorName);

    // Determine pill label and color
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
    textContent.appendChild(content);
    contentWrapper.appendChild(textContent);

    // Right side - media thumbnails
    if (note.media_urls && note.media_urls.length > 0) {
      const mediaContainer = document.createElement('div');
      const rightMargin = noteIsRead ? '60px' : '100px';
      mediaContainer.style.cssText = `display: flex; flex-wrap: wrap; gap: 8px; max-width: 200px; justify-content: flex-end; margin-right: ${rightMargin};`;

      note.media_urls.forEach(media => {
        const thumb = document.createElement('div');
        thumb.style.cssText = 'width: 60px; height: 60px; border-radius: 6px; overflow: hidden; cursor: pointer; background: #ddd; display: flex; align-items: center; justify-content: center; flex-shrink: 0;';

        if (media.type === 'video') {
          thumb.innerHTML = `
            <div style="position: relative; width: 100%; height: 100%;">
              <video src="${media.url}" style="width: 100%; height: 100%; object-fit: cover;"></video>
              <div style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); background: rgba(0,0,0,0.6); border-radius: 50%; width: 24px; height: 24px; display: flex; align-items: center; justify-content: center;">
                <span style="color: white; font-size: 12px; margin-left: 2px;">▶</span>
              </div>
            </div>
          `;
        } else {
          const img = document.createElement('img');
          img.src = media.url;
          img.style.cssText = 'width: 100%; height: 100%; object-fit: cover;';
          img.alt = 'Note attachment';
          thumb.appendChild(img);
        }

        thumb.onclick = (e) => {
          e.stopPropagation();
          openMediaPreview(media.url, media.type);
        };

        mediaContainer.appendChild(thumb);
      });

      contentWrapper.appendChild(mediaContainer);
    }

    panel.appendChild(contentWrapper);

    return panel;
  }

  async function getCurrentAuthId() {
  const supabase = getSupabaseClient();
  if (!supabase) return null;
  
  try {
    const { data: authData } = await supabase.auth.getUser();
    return authData?.user?.id || null;
  } catch (error) {
    console.error('[Jobs] Error getting auth ID:', error);
    return null;
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
 * Load jobs from Supabase
 * Also cleans up orphaned jobs (jobs without valid appointments)
 */
async function loadJobs() {
  const shopId = getCurrentShopId();
  if (!shopId) {
    console.warn('No shop ID found');
    return [];
  }

  const supabase = getSupabaseClient();
  
  try {
    if (supabase) {
      // Load from jobs TABLE (source of truth) instead of data.jobs JSONB
      // This ensures deleted jobs stay deleted and don't get re-created from stale JSONB
      const { data: jobsData, error: jobsError } = await supabase
        .from('jobs')
        .select('*')
        .eq('shop_id', shopId);
      
      if (jobsError) {
        console.warn('Error loading jobs from jobs table:', jobsError);
        throw jobsError;
      }
      
      let jobs = jobsData || [];
      console.log(`[Jobs] Loaded ${jobs.length} jobs from jobs table`);
      
      // Also load appointments for orphan cleanup and hydration
      const { data: dataRow } = await supabase
        .from('data')
        .select('appointments')
        .eq('shop_id', shopId)
        .single();
      
      const appointments = dataRow?.appointments || [];
      
      // Clean up orphaned jobs: remove jobs whose appointment_id doesn't exist in appointments
      const appointmentIds = new Set(appointments.map(a => a.id));
      const originalCount = jobs.length;
      
      const validJobs = jobs.filter(job => {
        // Keep completed jobs regardless
        if (job.status === 'completed') return true;
        // Keep jobs with valid appointment references
        if (job.appointment_id && appointmentIds.has(job.appointment_id)) return true;
        // Keep jobs without appointment_id (edge case)
        if (!job.appointment_id) return true;
        // Remove orphaned jobs
        console.log(`🧹 [Jobs] Removing orphaned job: ${job.id} (appointment ${job.appointment_id} not found)`);
        return false;
      });
      
      // If we found orphaned jobs, delete them from the jobs table
      if (validJobs.length !== originalCount) {
        const orphanedJobs = jobs.filter(j => !validJobs.some(v => v.id === j.id));
        console.log(`🧹 [Jobs] Cleaning ${orphanedJobs.length} orphaned job(s)`);
        
        for (const orphan of orphanedJobs) {
          await supabase.from('jobs').delete().eq('id', orphan.id);
        }
        console.log('✅ [Jobs] Orphaned jobs deleted from jobs table');
      }
      
      jobs = validJobs;
      
      // Fix customer names if customer_first looks like a UUID
      try {
        const { data: customers } = await supabase
          .from('customers')
          .select('id, customer_first, customer_last')
          .eq('shop_id', shopId);
        const customerMap = new Map(customers?.map(c => [c.id, c]) || []);
        jobs.forEach(job => {
          if (job.customer_first && /^[0-9a-f-]{36}$/.test(job.customer_first) && customerMap.has(job.customer_first)) {
            const cust = customerMap.get(job.customer_first);
            job.customer_first = cust.customer_first;
            job.customer_last = cust.customer_last;
          }
          if (job.customer && /^[0-9a-f-]{36}$/.test(job.customer) && customerMap.has(job.customer)) {
            const cust = customerMap.get(job.customer);
            job.customer = `${cust.customer_first} ${cust.customer_last}`.trim();
          }
        });
      } catch (e) {
        console.warn('[jobs.js] Could not fix customer names:', e);
      }
      
      // Sync jobs to data.jobs JSONB for consistency (but jobs table is source of truth)
      try {
        await supabase
          .from('data')
          .update({ jobs: jobs, updated_at: new Date().toISOString() })
          .eq('shop_id', shopId);
      } catch (e) {
        console.warn('[Jobs] Failed to sync jobs to data.jobs JSONB:', e);
      }
      
      return jobs;
    }
  } catch (ex) {
    console.warn('Supabase load failed, using localStorage:', ex);
  }
  
  // Fallback to localStorage
  try {
    const localData = JSON.parse(localStorage.getItem('xm_data') || '{}');
    return (localData.jobs || []).filter(j => j.shop_id === shopId);
  } catch (e) {
    return [];
  }
}

/**
 * Load appointments from Supabase
 */
async function loadAppointments() {
  const shopId = getCurrentShopId();
  if (!shopId) return [];

  const supabase = getSupabaseClient();
  
  try {
    if (supabase) {
      const { data, error} = await supabase
        .from('data')
        .select('appointments')
        .eq('shop_id', shopId)
        .single();
      
      if (error && error.code !== 'PGRST116') throw error;
      return data?.appointments || [];
    }
  } catch (ex) {
    console.warn('Supabase appointments load failed:', ex);
  }
  
  // Fallback
  try {
    const localData = JSON.parse(localStorage.getItem('xm_data') || '{}');
    return (localData.appointments || []).filter(a => a.shop_id === shopId);
  } catch (e) {
    return [];
  }
}

/**
 * Load users (for assignment dropdown)
 */
async function loadUsers() {
  const shopId = getCurrentShopId();
  if (!shopId) return [];

  const supabase = getSupabaseClient();
  
  try {
    if (supabase) {
      const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('shop_id', shopId);
      
      if (error) throw error;
      return data || [];
    }
  } catch (ex) {
    console.warn('Supabase users load failed:', ex);
  }
  
  // Fallback
  try {
    const users = JSON.parse(localStorage.getItem('xm_users') || '[]');
    return users.filter(u => u.shop_id === shopId);
  } catch (e) {
    return [];
  }
}

/**
 * Save jobs to Supabase
 */
async function saveJobs(jobs, options = {}) {
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
      
      if (fetchError && fetchError.code !== 'PGRST116') {
        throw fetchError;
      }
      
      // Merge incoming jobs with existing `data.jobs` to avoid overwriting unrelated entries
      const existingJobs = currentData?.jobs || [];

      // Build a map of existing jobs by appointment_id for id preservation
      const existingByAppt = new Map();
      existingJobs.forEach(ej => { if (ej && ej.appointment_id) existingByAppt.set(String(ej.appointment_id), ej); });

      // Deduplicate incoming jobs by appointment_id, preserving existing id when available
      const incomingByAppt = new Map();
      for (const j of jobs) {
        if (!j) continue;
        const apptKey = j.appointment_id ? String(j.appointment_id) : null;
        if (apptKey && incomingByAppt.has(apptKey)) {
          // Prefer incoming item (latest) but keep existing id if present
          const prev = incomingByAppt.get(apptKey);
          // if previous lacked an id but existingByAppt has one, preserve it
          if ((!j.id || j.id.toString().startsWith('job_')) && existingByAppt.has(apptKey)) {
            j.id = existingByAppt.get(apptKey).id;
          } else if (prev && (!prev.id || prev.id.toString().startsWith('job_')) && j.id) {
            // replace previous with one that has a better id
          }
        }
        // ensure id is set: prefer existing job id if available
        if (apptKey && existingByAppt.has(apptKey)) {
          j.id = existingByAppt.get(apptKey).id;
        }
        incomingByAppt.set(apptKey || getUUID(), j);
      }

      const incomingUnique = Array.from(incomingByAppt.values());
      try {
        console.log('[Jobs.saveJobs] existingJobsCount=', existingJobs.length, 'incomingUniqueCount=', incomingUnique.length);
        console.log('[Jobs.saveJobs] incomingUnique ids=', incomingUnique.map(j => ({ id: j.id, appointment_id: j.appointment_id, status: j.status })));
      } catch (e) {}

      // Build merged jobs array: keep existing jobs for this shop that are not replaced by incoming, then append incomingUnique
      const mergedForShop = [];
      const replacedApptIds = new Set(incomingUnique.map(j => j.appointment_id).filter(Boolean));
      existingJobs.forEach(ej => {
        if (!ej) return;
        if (ej.appointment_id && replacedApptIds.has(ej.appointment_id)) return; // replaced
        mergedForShop.push(ej);
      });
      mergedForShop.push(...incomingUnique);

      const payload = {
        shop_id: shopId,
        jobs: mergedForShop,
        settings: currentData?.settings || {},
        appointments: currentData?.appointments || [],
        threads: currentData?.threads || [],
        invoices: currentData?.invoices || [],
        updated_at: new Date().toISOString()
      };
      
      const { error: upsertError } = await supabase
        .from('data')
        .upsert(payload, { onConflict: 'shop_id' });
      
      if (upsertError) throw upsertError;
      
      // Also insert/update jobs in jobs table — only upsert the incoming/delta jobs to avoid touching unrelated rows
      // IMPORTANT: Only upsert jobs that already exist in the jobs table OR are newly created
      // This prevents ghost jobs from being re-created after deletion
      if (!options.skipCanonicalUpsert) {
        // First, get the list of jobs that currently exist in the jobs table
        // Include appointment_id so we can decide whether to create a missing job
        const { data: existingJobRows } = await supabase
          .from('jobs')
          .select('id, appointment_id')
          .eq('shop_id', shopId);
        const existingJobIds = new Set((existingJobRows || []).map(r => r.id));
        const existingApptIds = new Set((existingJobRows || []).map(r => r.appointment_id).filter(Boolean));
        
        for (const job of incomingUnique) {
          // Skip jobs that were deleted (not in jobs table AND not newly created)
          // A job is "newly created" if it has a temp ID like job_xxx or was just added this session
          const isNewlyCreated = job.id && job.id.toString().startsWith('job_');
          const existsInTable = existingJobIds.has(job.id);

          // If job doesn't exist in the canonical jobs table and isn't a newly-created temp id,
          // decide whether to create it:
          // - If there's already a job row for the same appointment_id, skip to avoid duplicates.
          // - Otherwise proceed to upsert (create the job row) because no canonical row exists yet.
          if (!existsInTable && !isNewlyCreated) {
            if (job.appointment_id && existingApptIds.has(job.appointment_id)) {
              console.log(`[Jobs.saveJobs] Skipping job: ${job.id} (another job exists for appointment ${job.appointment_id})`);
              continue;
            }
            // No existing job for this appointment found in jobs table — proceed to upsert (create)
          }
          
          // Parse customer name from job or appointment
          let customer_first = '';
          let customer_last = '';
          try { console.log('[Jobs.saveJobs] upserting job:', job.id, 'appointment_id:', job.appointment_id, 'status:', job.status); } catch (e) {}
          if (job.customer) {
            const nameParts = job.customer.trim().split(' ');
            customer_first = nameParts[0] || '';
            customer_last = nameParts.slice(1).join(' ') || '';
          } else if (job.customer_first) {
            customer_first = job.customer_first;
            customer_last = job.customer_last || '';
          }
          
          const jobPayload = {
            id: job.id,
            shop_id: shopId,
            appointment_id: job.appointment_id || null,
            customer_first: customer_first,
            customer_last: customer_last,
            // keep a combined customer field if present
            customer: job.customer || `${customer_first} ${customer_last}`.trim(),
            // vehicle/service fields for better UI hydration
            vehicle: job.vehicle || job.vehicle_make || job.vehicle_name || '',
            service: job.service || job.service_requested || '',
            assigned_to: job.assigned_to || null,
            status: job.status,
            created_at: job.created_at || new Date().toISOString(),
            updated_at: job.updated_at || new Date().toISOString(),
            completed_at: job.completed_at || null
          };
          const { error: jobError } = await supabase
            .from('jobs')
            .upsert(jobPayload, { onConflict: 'id' });
          if (jobError) {
            console.error('Failed to upsert job:', jobError);
          } else {
            console.log(`✅ Job ${job.id} upserted to jobs table`);
          }
        }
      }
      
      // Keep local cache in sync and notify other pages
      try {
        localStorage.setItem(LS.data, JSON.stringify(payload));
        window.dispatchEvent(new Event('xm_data_updated'));
      } catch (e) { console.warn('Failed to update local cache after saving jobs', e); }

      console.log('✅ Jobs saved to Supabase');
      return true;
    }
  } catch (ex) {
    console.warn('Supabase save failed, using localStorage:', ex);
  }
  
  // Fallback to localStorage
  try {
    const localData = JSON.parse(localStorage.getItem('xm_data') || '{}');
    localData.jobs = localData.jobs || [];

    // Merge jobs intelligently to avoid duplicates: prefer incoming jobs by id, otherwise match by appointment_id
    const keep = localData.jobs.filter(j => j.shop_id !== shopId);

    const incomingMap = new Map();
    jobs.forEach(j => { if (j && j.id) incomingMap.set(String(j.id).toLowerCase(), j); });

    // Build a map of appointment_id -> job for incoming to allow overwrite by appointment
    const incomingByAppt = new Map();
    jobs.forEach(j => { if (j && j.appointment_id) incomingByAppt.set(String(j.appointment_id), j); });

    // Start with kept jobs (other shops), then merge existing jobs for this shop that are not overwritten
    // by incoming jobs (by id or appointment_id)
    const merged = [...keep];
    // Add existing jobs for this shop that are not matched by incoming
    localData.jobs.forEach(existing => {
      if (existing.shop_id !== shopId) return;
      const eid = String(existing.id || '').toLowerCase();
      if (eid && incomingMap.has(eid)) return; // incoming has newer by id
      if (existing.appointment_id && incomingByAppt.has(String(existing.appointment_id))) return; // incoming replaces by appointment
      merged.push(existing);
    });

    // Finally add/overwrite with incoming jobs
    merged.push(...jobs);

    localData.jobs = merged;
    localStorage.setItem('xm_data', JSON.stringify(localData));
    console.log('✅ Jobs saved to localStorage');
    return true;
  } catch (e) {
    console.error('Failed to save jobs:', e);
    return false;
  }
}

/**
 * Render jobs tables
 */
async function renderJobs() {
  // Fetch notes to show indicator dot for UNREAD notes only
  let unreadNotesMap = {};
  try {
    const supabase = getSupabaseClient();
    if (supabase) {
      const appointmentIds = allJobs.map(j => j.appointment_id).filter(Boolean);
      if (appointmentIds.length > 0) {
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
    }
  } catch (e) {
    console.warn('Could not fetch notes for indicators:', e);
  }
  
  // Fetch fresh invoice data for services display
  let freshInvoices = [];
  try {
    const supabase = getSupabaseClient();
    const shopId = getCurrentShopId();
    if (supabase && shopId) {
      const { data: invData } = await supabase
        .from('invoices')
        .select('id, appointment_id, items, status')
        .eq('shop_id', shopId);
      if (invData) freshInvoices = invData;
    }
    if (freshInvoices.length === 0) {
      const store = JSON.parse(localStorage.getItem('xm_data') || '{}');
      freshInvoices = store.invoices || [];
    }
  } catch (e) {
    console.warn('Could not fetch invoices for services display:', e);
    const store = JSON.parse(localStorage.getItem('xm_data') || '{}');
    freshInvoices = store.invoices || [];
  }
  
  // Create invoice lookup map and store globally for table rows
  window._jobsInvoiceLookup = new Map();
  freshInvoices.forEach(inv => {
    if (inv.appointment_id) window._jobsInvoiceLookup.set(inv.appointment_id, inv);
    if (inv.id) window._jobsInvoiceLookup.set(inv.id, inv);
  });
  
  // Active jobs (in_progress)
  const activeJobs = allJobs.filter(j => j.status === 'in_progress');
  renderJobsTable('jobsTable', 'jobsEmpty', activeJobs, 'No active jobs.', unreadNotesMap);
  
  // Awaiting parts
  const awaitingJobs = allJobs.filter(j => j.status === 'awaiting_parts');
  renderJobsTable('awaitTable', 'awaitEmpty', awaitingJobs, 'No jobs awaiting parts.', unreadNotesMap);

  // Ensure highlight styles loaded and apply highlights to any newly added rows
  try { injectJobHighlightStyles(); applyJobHighlightsToRows(); } catch (e) {}
}

/**
 * Render a specific jobs table
 */
function renderJobsTable(tableId, emptyId, jobs, emptyText, notesMap = {}) {
  const tbody = document.querySelector(`#${tableId} tbody`);
  const empty = document.getElementById(emptyId);
  
  if (!tbody) return;
  
  tbody.innerHTML = '';
  
  if (jobs.length === 0) {
    if (empty) empty.textContent = emptyText;
    return;
  }
  
  if (empty) empty.textContent = '';
  
  // Sort according to jobSortCol/jobSortDir
  const sorted = [...jobs].sort((a, b) => {
    const getVal = (job) => {
      const appt = allAppointments.find(x => x.id === job.appointment_id) || {};
      switch (jobSortCol) {
        case 'id': return (job.id || '').toLowerCase();
        case 'customer': return ((appt.customer || job.customer) || '').toLowerCase();
        case 'vehicle': return (appt.vehicle || '').toLowerCase();
        case 'service': return (appt.service || '').toLowerCase();
        case 'status': return (job.status || '').toLowerCase();
        case 'assigned': {
          const user = allUsers.find(u => u.id === job.assigned_to);
          return user ? `${user.first} ${user.last}`.toLowerCase() : 'unassigned';
        }
        default:
          return new Date(job.created_at || job.updated_at || 0).getTime();
      }
    };

    const va = getVal(a);
    const vb = getVal(b);

    // If values are numbers (dates), compare numerically
    if (typeof va === 'number' && typeof vb === 'number') return jobSortDir === 'asc' ? va - vb : vb - va;
    // fallback string compare
    if (va < vb) return jobSortDir === 'asc' ? -1 : 1;
    if (va > vb) return jobSortDir === 'asc' ? 1 : -1;
    return 0;
  });
  
  sorted.forEach(job => {
    const tr = document.createElement('tr');
    tr.dataset.jobId = job.id;
    // If this job was recently marked for highlight, add the class so animation runs
    try { if (job.id && newJobHighlights.has(job.id)) tr.classList.add('jobs-new-job-highlight'); } catch (e) {}
    
    // Add green highlight for staff's assigned jobs
    if (isStaffUser && currentStaffAuthId) {
      const assignedId = job.assigned_to || job.assigned || null;
      if (assignedId && (String(assignedId) === String(currentStaffAuthId))) {
        tr.classList.add('staff-claimed');
      }
    }
    
    // On mobile, make row clickable to open actions modal
    if (window.matchMedia && window.matchMedia('(max-width: 768px)').matches) {
      tr.classList.add('job-row-clickable');
      tr.addEventListener('click', (e) => {
        if (e.target.closest('button')) return;
        openJobActionsModal(job);
      });
    }
// Modal for job actions (mobile)
function openJobActionsModal(job) {
  let modal = document.getElementById('jobActionsModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'jobActionsModal';
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal-content card" style="max-width:340px;margin:18vh auto;">
        <h3>Job Actions</h3>
        <div id="jobActionsBtns" style="display:flex;flex-direction:column;gap:12px;margin:18px 0;"></div>
        <button class="btn" id="closeJobActions">Close</button>
      </div>
    `;
    document.body.appendChild(modal);
  }
  const btns = modal.querySelector('#jobActionsBtns');
  btns.innerHTML = '';
  
  // Find related appointment for YMM info
  const appt = allAppointments.find(a => a.id === job.appointment_id);
  
  // View button (always shown)
  const viewBtn = document.createElement('button');
  viewBtn.className = 'btn';
  viewBtn.textContent = 'View Details';
  viewBtn.onclick = () => { 
    modal.classList.add('hidden'); 
    openJobViewModal(job, appt);
  };
  btns.appendChild(viewBtn);
  
  // Note button (always shown)
  const noteBtn = document.createElement('button');
  noteBtn.className = 'btn';
  noteBtn.textContent = 'Add Note';
  noteBtn.onclick = () => {
    modal.classList.add('hidden');
    if (appt) {
      currentJobNotesAppointmentId = appt.id;
      openJobAddNoteModal();
    }
  };
  btns.appendChild(noteBtn);
  
  if (isStaffUser) {
    // Staff: Only show Unclaim button (if assigned to them)
    const assignedId = job.assigned_to || job.assigned || null;
    const isAssignedToMe = assignedId && (String(assignedId) === String(currentStaffAuthId));
    
    if (isAssignedToMe) {
      const unclaimBtn = document.createElement('button');
      unclaimBtn.className = 'btn danger';
      unclaimBtn.textContent = 'Unclaim';
      unclaimBtn.onclick = async () => {
        modal.classList.add('hidden');
        const supabase = getSupabaseClient();
        const shopId = getCurrentShopId();
        
        if (supabase && shopId) {
          try {
            const { error: jobError } = await supabase
              .from('jobs')
              .update({ 
                assigned_to: null,
                updated_at: new Date().toISOString()
              })
              .eq('id', job.id);
            
            if (jobError) {
              console.error('Error unclaiming job:', jobError);
              showNotification('Failed to unclaim job', 'error');
              return;
            }
            
            const { data } = await supabase.from('data').select('jobs').eq('shop_id', shopId).single();
            const jobs = data?.jobs || [];
            const jobIndex = jobs.findIndex(j => j.id === job.id);
            if (jobIndex >= 0) {
              jobs[jobIndex].assigned_to = null;
              jobs[jobIndex].updated_at = new Date().toISOString();
              await supabase.from('data').update({ jobs }).eq('shop_id', shopId);
            }
            
            job.assigned_to = null;
            job.updated_at = new Date().toISOString();
            
            await renderJobs();
            showNotification('Job unclaimed', 'success');
          } catch (e) {
            console.error('Error unclaiming job:', e);
            showNotification('Failed to unclaim job', 'error');
          }
        }
      };
      btns.appendChild(unclaimBtn);
    }
  } else {
    // Admin/Owner: Show all action buttons
    
    // Parts button - restrict to non-foreman users (check role explicitly)
    (async () => {
      try {
        const user = await getCurrentUserWithRole();
        if (user && user.role === 'foreman') return;
      } catch (e) {}
      const partsBtn = document.createElement('button');
      partsBtn.className = 'btn';
      partsBtn.textContent = 'Parts';
      partsBtn.onclick = () => { modal.classList.add('hidden'); openPartsModal(job, appt); };
      btns.appendChild(partsBtn);
    })();

    // Assign button
    const assignBtn = document.createElement('button');
    assignBtn.className = 'btn info';
    assignBtn.textContent = 'Assign';
    assignBtn.onclick = () => {
      modal.classList.add('hidden');
      openAssignModal(job);
    };
    btns.appendChild(assignBtn);

    // Add Parts Manually button
    const manualPartsBtn = document.createElement('button');
    manualPartsBtn.className = 'btn';
    manualPartsBtn.textContent = 'Add Parts Manually';
    manualPartsBtn.onclick = () => { 
      modal.classList.add('hidden'); 
      
      const pricingModal = window.partPricingModal || window.xm_partPricingModal;
      
      if (appt && pricingModal) {
        const manualPart = {
          manual_entry: true,
          name: '',
          part_name: '',
          part_number: '',
          id: 'manual'
        };
        
        const vehicle = appt.vehicle_year && appt.vehicle_make && appt.vehicle_model
          ? `${appt.vehicle_year} ${appt.vehicle_make} ${appt.vehicle_model}`
          : null;
        
        pricingModal.show(manualPart, job.id, vehicle);
      } else if (!pricingModal) {
        alert('Part pricing modal is not available. Please refresh the page.');
      } else if (!appt) {
        alert('Could not find appointment for this job.');
      }
    };
    btns.appendChild(manualPartsBtn);

    // Remove button
    const removeBtn = document.createElement('button');
    removeBtn.className = 'btn danger';
    removeBtn.textContent = 'Remove';
    removeBtn.onclick = () => { modal.classList.add('hidden'); openRemoveModal(job); };
    btns.appendChild(removeBtn);
  }
  
  modal.classList.remove('hidden');
  modal.querySelector('#closeJobActions').onclick = () => modal.classList.add('hidden');
}
    
    // Find related appointment
    const appt = allAppointments.find(a => a.id === job.appointment_id);
    
    // Note indicator dot (first column)
    const tdDot = document.createElement('td');
    tdDot.style.cssText = 'width: 20px; padding: 0; text-align: center; vertical-align: middle;';
    if (notesMap[job.appointment_id] > 0) {
      tdDot.innerHTML = '<span style="display: inline-block; width: 10px; height: 10px; background: #3b82f6; border-radius: 50%;" title="Has unread notes"></span>';
    }
    tr.appendChild(tdDot);
    
    // Job #
    const tdJobNum = document.createElement('td');
    tdJobNum.textContent = job.id.slice(-6).toUpperCase();
    tr.appendChild(tdJobNum);
    
    // Customer
    const tdCustomer = document.createElement('td');
    tdCustomer.textContent = appt?.customer || job.customer || 'N/A';
    tr.appendChild(tdCustomer);
    
    // Vehicle
    const tdVehicle = document.createElement('td');
    tdVehicle.textContent = appt?.vehicle || 'N/A';
    tr.appendChild(tdVehicle);
    
    // Service - check for multiple services from invoice
    const tdService = document.createElement('td');
    
    // Get services from fresh invoice data (use window._jobsInvoiceLookup from renderJobs)
    let invoiceServices = [];
    try {
      const invoiceLookup = window._jobsInvoiceLookup || new Map();
      let inv = null;
      if (appt?.invoice_id) inv = invoiceLookup.get(appt.invoice_id);
      if (!inv && appt?.id) inv = invoiceLookup.get(appt.id);
      if (inv && inv.items && Array.isArray(inv.items)) {
        invoiceServices = inv.items.filter(item => 
          item.type === 'service' || 
          (!item.type && item.name && !item.name.toLowerCase().startsWith('labor'))
        ).map(item => item.name || item.description || 'Unknown Service');
      }
    } catch (e) {
      console.warn('[Jobs] Could not get invoice services for table row', e);
    }
    
    // Combine appointment service with invoice services (deduplicated)
    const allServices = [];
    if (appt?.service) allServices.push(appt.service);
    invoiceServices.forEach(s => {
      if (!allServices.some(existing => existing.toLowerCase() === s.toLowerCase())) {
        allServices.push(s);
      }
    });
    
    const hasMultipleServices = allServices.length > 1;
    const primaryService = allServices[0] || 'N/A';
    
    if (hasMultipleServices) {
      // Create dropdown button for multiple services
      const serviceWrapper = document.createElement('div');
      serviceWrapper.className = 'service-dropdown-wrapper';
      serviceWrapper.style.cssText = 'position:relative;';
      
      const serviceBtn = document.createElement('button');
      serviceBtn.className = 'service-dropdown-btn';
      serviceBtn.innerHTML = `
        <span class="service-primary">${primaryService}</span>
        <span class="service-badge">+${allServices.length - 1}</span>
        <span class="service-chevron">▼</span>
      `;
      serviceBtn.onclick = (e) => {
        e.stopPropagation();
        toggleServiceDropdown(serviceWrapper, allServices);
      };
      
      serviceWrapper.appendChild(serviceBtn);
      tdService.appendChild(serviceWrapper);
    } else {
      tdService.textContent = primaryService;
    }
    
    tr.appendChild(tdService);
    
    // Status
    const tdStatus = document.createElement('td');
    const statusSpan = document.createElement('span');
    statusSpan.className = `tag ${getStatusClass(job.status)}`;
    statusSpan.textContent = job.status.replace(/_/g, ' ');
    statusSpan.style.cursor = 'pointer';
    statusSpan.title = 'Click to change status';
    statusSpan.addEventListener('click', (e) => {
      e.stopPropagation();
      openStatusModal(job);
    });
    tdStatus.appendChild(statusSpan);
    tr.appendChild(tdStatus);
    
    // Assigned To
    const tdAssigned = document.createElement('td');
    let assignedLabel = 'Unassigned';
    const assignedId = job.assigned_to || job.assigned || null;
    if (assignedId) {
      // Try to find a matching user by id or auth_id
      const u = allUsers.find(x => String(x.id) === String(assignedId) || String(x.auth_id || '') === String(assignedId));
      if (u) assignedLabel = `${u.first || u.first_name || ''} ${u.last || u.last_name || ''}`.trim();
      else {
        // Try shop_staff rows
        const s = allStaff.find(x => String(x.id) === String(assignedId) || String(x.auth_id || '') === String(assignedId) || String((x.email||'').toLowerCase()) === String((assignedId||'').toLowerCase()));
        if (s) assignedLabel = `${s.first_name || s.first || ''} ${s.last_name || s.last || ''}`.trim();
        else assignedLabel = String(assignedId);
      }
    }
    tdAssigned.textContent = assignedLabel || 'Unassigned';
    tr.appendChild(tdAssigned);
    
    // Actions
    const tdActions = document.createElement('td');
    const actionsDiv = document.createElement('div');
    actionsDiv.style.display = 'grid';
    actionsDiv.style.gridTemplateColumns = 'repeat(2, 1fr)';
    actionsDiv.style.gap = '4px';
    
    // View button (top-left)
    const viewBtn = document.createElement('button');
    viewBtn.className = 'btn small';
    viewBtn.textContent = 'View';
    viewBtn.onclick = () => openJobViewModal(job, appt);
    actionsDiv.appendChild(viewBtn);
    
    // Assign/Unclaim button (top-right)
    if (job.assigned_to) {
      const unclaimBtn = document.createElement('button');
      unclaimBtn.className = 'btn small danger';
      unclaimBtn.textContent = 'Unclaim';
      unclaimBtn.onclick = async () => {
        const supabase = getSupabaseClient();
        const shopId = getCurrentShopId();
        
        if (supabase && shopId) {
          try {
            // Update the jobs table
            const { error: jobError } = await supabase
              .from('jobs')
              .update({ 
                assigned_to: null,
                updated_at: new Date().toISOString()
              })
              .eq('id', job.id);
            
            if (jobError) {
              console.error('Error unclaiming job:', jobError);
              showNotification('Failed to unclaim job', 'error');
              return;
            }
            
            // Also update data table's jobs JSONB for consistency
            const { data } = await supabase.from('data').select('jobs').eq('shop_id', shopId).single();
            const jobs = data?.jobs || [];
            const jobIndex = jobs.findIndex(j => j.id === job.id);
            if (jobIndex >= 0) {
              jobs[jobIndex].assigned_to = null;
              jobs[jobIndex].updated_at = new Date().toISOString();
              await supabase.from('data').update({ jobs }).eq('shop_id', shopId);
            }
            
            // Update local
            job.assigned_to = null;
            job.updated_at = new Date().toISOString();
            
            await renderJobs();
            showNotification('Job unclaimed', 'success');
            console.log('✅ Job unclaimed in jobs table');
          } catch (e) {
            console.error('Error unclaiming job:', e);
            showNotification('Failed to unclaim job', 'error');
          }
        }
      };
      actionsDiv.appendChild(unclaimBtn);
    } else {
      // For staff: show Claim button, for admin: show Assign button
      if (isStaffUser) {
        const claimBtn = document.createElement('button');
        claimBtn.className = 'btn small info';
        claimBtn.textContent = 'Claim';
        claimBtn.onclick = async () => {
          const supabase = getSupabaseClient();
          const shopId = getCurrentShopId();
          
          if (supabase && shopId) {
            try {
              // Update the jobs table - use auth_id for consistent lookups
              const { error: jobError } = await supabase
                .from('jobs')
                .update({ 
                  assigned_to: currentStaffAuthId,
                  updated_at: new Date().toISOString()
                })
                .eq('id', job.id);
              
              if (jobError) {
                console.error('Error claiming job:', jobError);
                showNotification('Failed to claim job', 'error');
                return;
              }
              
              // Also update data table's jobs JSONB for consistency
              const { data } = await supabase.from('data').select('jobs').eq('shop_id', shopId).single();
              const jobs = data?.jobs || [];
              const jobIndex = jobs.findIndex(j => j.id === job.id);
              if (jobIndex >= 0) {
                jobs[jobIndex].assigned_to = currentStaffAuthId;
                jobs[jobIndex].updated_at = new Date().toISOString();
                await supabase.from('data').update({ jobs }).eq('shop_id', shopId);
              }
              
              // Update local
              job.assigned_to = currentStaffAuthId;
              job.updated_at = new Date().toISOString();
              
              await renderJobs();
              showNotification('Job claimed!', 'success');
            } catch (e) {
              console.error('Error claiming job:', e);
              showNotification('Failed to claim job', 'error');
            }
          }
        };
        actionsDiv.appendChild(claimBtn);
      } else {
        const assignBtn = document.createElement('button');
        assignBtn.className = 'btn small';
        assignBtn.textContent = 'Assign';
        assignBtn.onclick = () => openAssignModal(job);
        actionsDiv.appendChild(assignBtn);
      }
    }
    
    // Parts button (bottom-left) - Admin/Owner only; double-check role to exclude foreman
    if (!isStaffUser) {
      (async () => {
        try {
          const user = await getCurrentUserWithRole();
          if (user && user.role === 'foreman') return;
        } catch (e) {}
        const partsBtn = document.createElement('button');
        partsBtn.className = 'btn small info';
        partsBtn.textContent = 'Parts';
        partsBtn.onclick = () => openPartsModal(job, appt);
        actionsDiv.appendChild(partsBtn);
      })();
    }
    
    // Note or Remove button based on role
    if (isStaffUser) {
      // Staff users get Note button
      const noteBtn = document.createElement('button');
      noteBtn.className = 'btn small secondary';
      noteBtn.setAttribute('aria-label', 'Add note');
      noteBtn.textContent = 'Note';
      noteBtn.onclick = () => openJobNoteModal(job);
      actionsDiv.appendChild(noteBtn);
    } else {
      // Admin/Owner users get Remove button
      const removeBtn = document.createElement('button');
      removeBtn.className = 'btn small danger';
      removeBtn.textContent = 'Remove';
      removeBtn.onclick = () => openRemoveModal(job);
      actionsDiv.appendChild(removeBtn);
    }
    
    tdActions.appendChild(actionsDiv);
    tr.appendChild(tdActions);
    
    tbody.appendChild(tr);
  });
}

// Toggle sort when a jobs table header is clicked
function setupJobSorting() {
  ['jobsTable','awaitTable'].forEach(tableId => {
    const thead = document.querySelector(`#${tableId} thead`);
    if (!thead) return;
    thead.querySelectorAll('th.sortable').forEach(th => {
      th.style.cursor = 'pointer';
      th.addEventListener('click', async () => {
        const col = th.dataset.col;
        if (!col) return;
        if (jobSortCol === col) {
          jobSortDir = jobSortDir === 'asc' ? 'desc' : 'asc';
        } else {
          jobSortCol = col;
          jobSortDir = 'asc';
        }
        // update visual indicators
        document.querySelectorAll(`#${tableId} thead th.sortable`).forEach(h => h.classList.remove('asc','desc'));
        th.classList.add(jobSortDir);
        await renderJobs();
      });
    });
  });
}

/**
 * Get status class for styling
 */
function getStatusClass(status) {
  // Return the raw status string to match .tag.[status] CSS classes
  if (status === 'done') return 'completed';
  return status || 'in_progress';
}

/**
 * Open status modal
 */
function openStatusModal(job) {
  try {
    // Opening status modal for job
    currentJobForStatus = job;
    const modal = document.getElementById('statusModal');
    const pillsContainer = document.getElementById('statusPills');

    if (!modal) {
      console.error('Modal element not found');
      return;
    }

    if (!pillsContainer) {
      console.error('Pills container not found');
      return;
    }

    console.log('Modal element:', modal);
    console.log('Pills container:', pillsContainer);

    pillsContainer.innerHTML = '';

    if (!JOB_STATUSES || !Array.isArray(JOB_STATUSES)) {
      console.error('JOB_STATUSES not defined or not an array');
      return;
    }

    JOB_STATUSES.forEach(status => {
      try {
        const pill = document.createElement('button');
        pill.className = `btn ${job.status === status ? getStatusClass(status) : ''}`;
        pill.textContent = status.replace(/_/g, ' ').toUpperCase();
        pill.style.width = '100%';
        pill.style.textAlign = 'left';

        pill.addEventListener('click', async () => {
          try {
            await updateJobStatus(job.id, status);
            modal.classList.add('hidden');
          } catch (error) {
            console.error('Error updating job status:', error);
          }
        });

        pillsContainer.appendChild(pill);
      } catch (error) {
        console.error('Error creating status pill for', status, ':', error);
      }
    });

    modal.classList.remove('hidden');
    console.log('Status modal opened, hidden class removed');

  } catch (error) {
    console.error('Error in openStatusModal:', error);
  }
}

/**
 * Close status modal
 */
function closeStatusModal() {
  const modal = document.getElementById('statusModal');
  if (modal) modal.classList.add('hidden');
  currentJobForStatus = null;
}

// Make it global for onclick
window.closeStatusModal = closeStatusModal;

/**
 * Open remove modal
 */
function openRemoveModal(job) {
  currentJobForRemove = job;
  const modal = document.getElementById('removeModal');
  if (!modal) return;

  // Default copy
  const bodyP = modal.querySelector('.modal-body p');
  const removeApptBtn = modal.querySelector('#removeJobApptBtn');
  const removeBtn = modal.querySelector('#removeJobBtn');
  if (bodyP) bodyP.textContent = 'Are you sure you want to remove this job?';
  if (removeApptBtn) removeApptBtn.style.display = '';
  if (removeBtn) removeBtn.textContent = 'Remove Job';

  // Detect current user's role and adjust wording/choices for foreman
  try {
    getCurrentUserWithRole().then(user => {
      if (user && user.role === 'foreman') {
        if (bodyP) bodyP.textContent = 'This will send the job/appointment back to scheduled status — it will not delete the appointment. Proceed?';
        // Foreman should not see the "Remove Job & Appointment" option
        if (removeApptBtn) removeApptBtn.style.display = 'none';
        // Keep main button labeled "Remove Job" per UX request
        if (removeBtn) removeBtn.textContent = 'Remove Job';
      }
    }).catch(() => {
      // ignore role detection failures and show default modal
    });
  } catch (e) {}

  modal.classList.remove('hidden');
}

/**
 * Close remove modal
 */
function closeRemoveModal() {
  const modal = document.getElementById('removeModal');
  if (modal) modal.classList.add('hidden');
  currentJobForRemove = null;
}

// Make it global for onclick
window.closeRemoveModal = closeRemoveModal;

/**
 * Open job view modal - shows appointment details with notes
 */
async function openJobViewModal(job, appt) {
  const modal = document.getElementById('jobViewModal');
  const content = document.getElementById('jobViewContent');
  
  if (!modal || !content || !appt) return;
  
  // Helper function to format time
  const formatTime12 = (time24) => {
    if (!time24) return 'Not set';
    const [h, m] = time24.split(':');
    const hour = parseInt(h, 10);
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const hour12 = hour % 12 || 12;
    return `${hour12}:${m} ${ampm}`;
  };
  
  // Helper function to get status class
  const getStatusClass = (status) => {
    const map = {
      'new': 'tag-new',
      'scheduled': 'tag-scheduled',
      'in_progress': 'tag-progress',
      'awaiting_parts': 'tag-parts',
      'completed': 'tag-done'
    };
    return map[status] || '';
  };
  
  // Get services from invoice items - fetch fresh from Supabase
  let invoiceServices = [];
  try {
    const supabase = getSupabaseClient();
    const shopId = getCurrentShopId();
    let inv = null;
    
    if (supabase && shopId) {
      // Try to fetch from invoices table first (most up-to-date)
      if (appt.invoice_id) {
        const { data: invData } = await supabase.from('invoices').select('*').eq('id', appt.invoice_id).single();
        if (invData) inv = invData;
      }
      if (!inv) {
        const { data: invData } = await supabase.from('invoices').select('*').eq('appointment_id', appt.id).single();
        if (invData) inv = invData;
      }
    }
    
    // Fallback to lookup or localStorage
    if (!inv) {
      const invoiceLookup = window._jobsInvoiceLookup || new Map();
      if (appt.invoice_id) inv = invoiceLookup.get(appt.invoice_id);
      if (!inv) inv = invoiceLookup.get(appt.id);
    }
    
    if (inv && inv.items && Array.isArray(inv.items)) {
      invoiceServices = inv.items.filter(item => 
        item.type === 'service' || 
        (!item.type && item.name && !item.name.toLowerCase().startsWith('labor'))
      ).map(item => item.name || item.description || 'Unknown Service');
    }
  } catch (e) {
    console.warn('[Jobs] Could not get invoice services for view modal', e);
  }
  
  // Combine appointment service with invoice services (deduplicated)
  const allServices = [];
  if (appt.service) allServices.push(appt.service);
  invoiceServices.forEach(s => {
    if (!allServices.some(existing => existing.toLowerCase() === s.toLowerCase())) {
      allServices.push(s);
    }
  });
  
  // Build services HTML with expandable functionality
  const hasMultipleServices = allServices.length > 1;
  const servicesLabel = hasMultipleServices ? 'Services' : 'Service';
  const primaryService = allServices[0] || 'N/A';
  
  let servicesHTML = '';
  if (hasMultipleServices) {
    servicesHTML = `
      <div class="services-expandable">
        <div class="services-header" onclick="toggleServicesExpand(this)" style="display:flex;align-items:center;gap:8px;cursor:pointer;">
          <strong>${servicesLabel}:</strong>
          <span class="primary-service" style="flex:1;">${primaryService}</span>
          <span class="services-count" style="background:var(--accent, #3b82f6);color:white;padding:2px 8px;border-radius:12px;font-size:12px;">+${allServices.length - 1} more</span>
          <span class="expand-icon" style="transition:transform 0.2s;">▼</span>
        </div>
        <div class="services-list" style="display:none;margin-top:12px;padding-left:12px;border-left:2px solid var(--accent, #3b82f6);">
          ${allServices.map((svc, idx) => `
            <div class="service-item" style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;${idx < allServices.length - 1 ? 'border-bottom:1px solid var(--line, #e5e7eb);' : ''}">
              <span style="flex:1;">${svc}</span>
              <button class="btn small" onclick="openCortexForService('${svc.replace(/'/g, "\\'")}')"
                style="display:flex;align-items:center;gap:4px;padding:4px 10px;font-size:12px;">
                <img src="/assets/cortex-mark.png" alt="" style="width:14px;height:14px;">
                Cortex
              </button>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  } else {
    servicesHTML = `
      <div style="display:flex;align-items:center;gap:8px;">
        <strong>${servicesLabel}:</strong>
        <span style="flex:1;">${primaryService}</span>
        ${primaryService !== 'N/A' ? `
          <button class="btn small" onclick="openCortexForService('${primaryService.replace(/'/g, "\\'")}')"
            style="display:flex;align-items:center;gap:4px;padding:4px 10px;font-size:12px;">
            <img src="/assets/cortex-mark.png" alt="" style="width:14px;height:14px;">
            Cortex
          </button>
        ` : ''}
      </div>
    `;
  }
  
  content.innerHTML = `
    <div style="display: grid; gap: 12px;">
      <div><strong>Customer:</strong> ${appt.customer || 'N/A'}</div>
      <div><strong>Phone:</strong> ${appt.phone || 'N/A'}</div>
      <div><strong>Email:</strong> ${appt.email || 'N/A'}</div>
      <div><strong>Vehicle:</strong> ${appt.vehicle || 'N/A'}</div>
      ${appt.vin ? `<div><strong>VIN:</strong> ${appt.vin}</div>` : ''}
      ${servicesHTML}
      <div><strong>Date:</strong> ${appt.preferred_date ? new Date(appt.preferred_date).toLocaleDateString() : 'Not set'}</div>
      <div><strong>Time:</strong> ${formatTime12(appt.preferred_time)}</div>
      <div><strong>Status:</strong> <span class="tag ${getStatusClass(appt.status)}">${(appt.status || 'new').replace(/_/g, ' ')}</span></div>
      <div id="inspectionStatusRow"></div>
      ${appt.notes ? `<div><strong>Notes:</strong><br>${appt.notes}</div>` : ''}
    </div>
    
    <div style="margin-top: 24px; padding-top: 16px; border-top: 1px solid #ddd;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
        <strong style="font-size: 15px;">Appointment Notes</strong>
        <button type="button" id="jobViewAddNoteBtn" class="btn small info">Add Note</button>
      </div>
      <div id="jobViewNotesList" style="display: flex; flex-direction: column; gap: 12px;">
        <p style="color: #666; font-style: italic; text-align: center;">Loading notes...</p>
      </div>
    </div>
  `;
  
  // Load inspection status asynchronously
  loadInspectionStatusForJobViewModal(job, appt);
  
  modal.classList.remove('hidden');
  
  // Load and render notes
  await renderJobViewNotes(appt.id);
  
  // Add note button handler
  const addNoteBtn = document.getElementById('jobViewAddNoteBtn');
  if (addNoteBtn) {
    addNoteBtn.addEventListener('click', () => {
      currentJobNotesAppointmentId = appt.id;
      openJobAddNoteModal();
    });
  }
}

// Load and display inspection status in job view modal
async function loadInspectionStatusForJobViewModal(job, appt) {
  const container = document.getElementById('inspectionStatusRow');
  if (!container) return;
  
  try {
    const summary = await getInspectionSummary(appt.id, job.id);
    
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
        closeJobViewModal();
        openInspectionFromJob(summary.id, job, appt);
      });
    } else {
      // No inspection yet — show 'Not started' and a Start button
      container.innerHTML = `
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
          <strong>Inspection:</strong>
          <span style="color: #9ca3af; font-size: 13px;">Not started</span>
          <button id="startInspectionBtn" class="btn small info" style="margin-left:8px;">Start Inspection</button>
        </div>
      `;

      // Wire up start button to open the inspection template flow
      document.getElementById('startInspectionBtn')?.addEventListener('click', () => {
        try {
          // Close the job view modal to reveal the inspection UI
          closeJobViewModal();

          // Build vehicle info similarly to openInspectionFromJob
          let vehicleInfo = {};
          if (appt.vehicle) {
            const parts = appt.vehicle.split(' ');
            if (parts.length >= 3) {
              vehicleInfo.year = parts[0];
              vehicleInfo.make = parts[1];
              vehicleInfo.model = parts.slice(2).join(' ');
            } else {
              vehicleInfo.model = appt.vehicle;
            }
          }

          // Customer info
          const customerInfo = { name: appt.customer, phone: appt.phone, email: appt.email };

          // Open the inspection form (will show template selection when no inspection exists)
          inspectionForm.open({
            appointmentId: appt.id,
            jobId: job.id,
            vehicleInfo,
            customerInfo,
            onClose: async (inspection) => {
              if (inspection) {
                await loadJobs();
                await renderJobs();
              }
            }
          });
        } catch (e) {
          console.error('Failed to start inspection:', e);
          showNotification('Unable to start inspection', 'error');
        }
      });
    }
  } catch (e) {
    console.warn('Failed to load inspection status:', e);
    container.innerHTML = '';
  }
}

// Open inspection from job view modal
function openInspectionFromJob(inspectionId, job, appt) {
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
    jobId: job.id,
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
        loadJobs().then(() => renderJobs());
      }
    }
  });
}

/**
 * Render notes in job view modal
 */
async function renderJobViewNotes(appointmentId) {
  const container = document.getElementById('jobViewNotesList');
  if (!container) return;
  
  const notes = await loadAppointmentNotes(appointmentId);
  
  container.innerHTML = '';
  
  if (notes.length === 0) {
    container.innerHTML = '<p style="color: #666; font-style: italic; padding: 12px; text-align: center;">No notes for this appointment.</p>';
    return;
  }
  
  notes.forEach(note => {
    const notePanel = createJobViewNotePanel(note);
    container.appendChild(notePanel);
  });
}

/**
 * Load appointment notes
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
        .select('id, first, last, email')
        .in('id', userIds);
      
      if (!userError && users) {
        users.forEach(u => {
          userMap.set(u.id, {
            first_name: u.first,
            last_name: u.last,
            email: u.email
          });
        });
      }
    } catch (e) {
      console.warn('[Jobs] Could not fetch users table data:', e);
    }
    
    // Fetch user data from shop_staff table (staff members)
    try {
      const { data: staff, error: staffError } = await supabase
        .from('shop_staff')
        .select('auth_id, first_name, last_name, email')
        .in('auth_id', userIds);
      
      if (!staffError && staff) {
        staff.forEach(s => {
          if (!userMap.has(s.auth_id)) {
            userMap.set(s.auth_id, {
              first_name: s.first_name,
              last_name: s.last_name,
              email: s.email
            });
          }
        });
      }
    } catch (e) {
      console.warn('[Jobs] Could not fetch shop_staff table data:', e);
    }
    
    // Normalize send_to and attach user data to each note
    // Also enforce send-to visibility: only return notes the current user may see
    const normalized = notes.map(note => {
      let sendTo = note.send_to;
      if (!Array.isArray(sendTo)) {
        if (typeof sendTo === 'string') {
          try { sendTo = JSON.parse(sendTo); } catch (e) { sendTo = [sendTo]; }
        } else {
          sendTo = [];
        }
      }
      return { ...note, user: userMap.get(note.created_by) || null, send_to: sendTo };
    });

    // Determine current user's role and identity
    let role = 'staff';
    try { role = await fetchCurrentUserRole(); } catch (e) {}
    const isAdminView = (role === 'admin' || role === 'owner');

    // Get current user identity to allow creators to always see their notes
    let currentUser = null;
    let currentAuthId = null;
    try {
      currentUser = await getCurrentUserWithRole().catch(() => null);
      const { data: authData } = await getSupabaseClient().auth.getUser();
      currentAuthId = authData?.user?.id || null;
    } catch (e) {}

    if (isAdminView) return normalized;

    return normalized.filter(n => {
      try {
        // Creator always sees their own notes
        if (n.created_by && (n.created_by === (currentUser?.id) || n.created_by === (currentUser?.auth_id) || n.created_by === currentAuthId)) return true;
        if (!n.send_to || n.send_to.length === 0) return true; // legacy visible to all
        if (Array.isArray(n.send_to)) {
          if (n.send_to.includes('all')) return true;
          if (n.send_to.includes(role)) return true;
        }
      } catch (e) {}
      return false;
    });
  } catch (err) {
    console.error('[Jobs] Error loading appointment notes:', err);
    return [];
  }
}

// Fetch the current user's role (similar to appointments.js)
let cachedUserRole = null;
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
          if (staffRow && staffRow.role) { cachedUserRole = staffRow.role; return cachedUserRole; }
        } catch (e) {}
        try {
          const { data: userRow } = await supabase
            .from('users')
            .select('role')
            .eq('id', authId)
            .limit(1)
            .single();
          if (userRow && userRow.role) { cachedUserRole = userRow.role; return cachedUserRole; }
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

/**
 * Create a read-only note panel for job view
 */
function createJobViewNotePanel(note) {
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
      await renderJobs();
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
    openDeleteNoteModal(note.id);
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
        openMediaPreview(media.url, media.type);
      };
      
      mediaContainer.appendChild(thumb);
    });
    
    contentWrapper.appendChild(mediaContainer);
  }
  
  panel.appendChild(contentWrapper);
  
  return panel;
}

/**
 * Close job view modal
 */
function closeJobViewModal() {
  const modal = document.getElementById('jobViewModal');
  if (modal) modal.classList.add('hidden');
}

// Make it global for onclick
window.closeJobViewModal = closeJobViewModal;

/**
 * Open modal to add a job note (from table action button)
 */
function openJobNoteModal(job) {
  // Find appointment for this job
  const appt = allAppointments.find(a => a.id === job.appointment_id);
  if (appt) {
    currentJobNotesAppointmentId = appt.id;
  }
  openJobAddNoteModal();
}

/**
 * Open modal to add a job note
 */
function openJobAddNoteModal() {
  const modal = document.getElementById('jobNoteModal');
  const title = document.getElementById('jobNoteModalTitle');
  const textarea = document.getElementById('jobNoteText');
  const subj = document.getElementById('noteSubject');
  
  if (!modal || !title || !textarea) return;
  
  title.textContent = 'Add Note';
  textarea.value = '';
  if (subj) subj.value = '';
  // reset send-to
  window.pendingJobNoteSendTo = new Set();
  renderNoteSendToPills();
  modal.classList.remove('hidden');
  textarea.focus();
}

/**
 * Close job note modal
 */
function closeJobNoteModal() {
  const modal = document.getElementById('jobNoteModal');
  if (modal) modal.classList.add('hidden');
  // Clear media selections
  pendingNoteMedia = [];
  const preview = document.getElementById('jobNoteMediaPreview');
  if (preview) preview.innerHTML = '';
  const count = document.getElementById('jobNoteMediaCount');
  if (count) count.textContent = 'No files selected';
  const input = document.getElementById('jobNoteMedia');
  if (input) input.value = '';
}

// Make it global for onclick
window.closeJobNoteModal = closeJobNoteModal;

// Pending media files for note upload
let pendingNoteMedia = [];
let noteToDeleteId = null;
// Pending send-to roles for note modal
if (!window.pendingJobNoteSendTo) window.pendingJobNoteSendTo = new Set();

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
      pill.style.background = window.pendingJobNoteSendTo.has(r.key) ? '#10b981' : '#f3f4f6';
      pill.style.color = window.pendingJobNoteSendTo.has(r.key) ? '#fff' : '#111827';
      pill.onclick = (e) => {
        e.preventDefault();
        const key = pill.dataset.role;
        if (!key) return;
        if (key === 'all') {
          window.pendingJobNoteSendTo.clear();
          window.pendingJobNoteSendTo.add('all');
        } else {
          window.pendingJobNoteSendTo.delete('all');
          if (window.pendingJobNoteSendTo.has(key)) window.pendingJobNoteSendTo.delete(key);
          else window.pendingJobNoteSendTo.add(key);
        }
        renderNoteSendToPills();
      };
      container.appendChild(pill);
    });
  } catch (e) { console.warn('renderNoteSendToPills failed', e); }
}

/**
 * Handle media file selection for notes
 */
function handleNoteMediaSelect(input) {
  const files = Array.from(input.files);
  const preview = document.getElementById('jobNoteMediaPreview');
  const count = document.getElementById('jobNoteMediaCount');
  
  if (files.length === 0) {
    pendingNoteMedia = [];
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
  
  pendingNoteMedia = validFiles;
  
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
        // Video preview
        const video = document.createElement('video');
        video.src = URL.createObjectURL(file);
        video.style.cssText = 'width: 100%; height: 100%; object-fit: cover;';
        thumb.appendChild(video);
        // Add play icon overlay
        const playIcon = document.createElement('div');
        playIcon.style.cssText = 'position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); background: rgba(0,0,0,0.6); border-radius: 50%; width: 20px; height: 20px; display: flex; align-items: center; justify-content: center;';
        playIcon.innerHTML = '<span style="color: white; font-size: 10px; margin-left: 2px;">▶</span>';
        thumb.appendChild(playIcon);
      } else {
        // Image preview
        const img = document.createElement('img');
        img.src = URL.createObjectURL(file);
        img.style.cssText = 'width: 100%; height: 100%; object-fit: cover;';
        thumb.appendChild(img);
      }
      
      // Remove button
      const removeBtn = document.createElement('button');
      removeBtn.innerHTML = '&times;';
      removeBtn.style.cssText = 'position: absolute; top: 2px; right: 2px; width: 18px; height: 18px; border-radius: 50%; background: rgba(0,0,0,0.6); color: white; border: none; cursor: pointer; font-size: 12px; line-height: 1; padding: 0;';
      removeBtn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        pendingNoteMedia.splice(idx, 1);
        // Re-render previews
        handleNoteMediaSelect({ files: pendingNoteMedia });
      };
      thumb.appendChild(removeBtn);
      
      preview.appendChild(thumb);
    });
  }
}

window.handleNoteMediaSelect = handleNoteMediaSelect;

/**
 * Upload media files to Supabase storage
 */
async function uploadNoteMedia(files, appointmentId) {
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
      
      const fileExt = file.name.split('.').pop();
      const fileName = `${shopId}/${appointmentId}/${Date.now()}_${Math.random().toString(36).substr(2, 9)}.${fileExt}`;
      
      console.log('[NoteMedia] Target path:', fileName);
      
      const { data, error } = await supabase.storage
        .from('note-media')
        .upload(fileName, file, {
          cacheControl: '3600',
          upsert: false,
          contentType: file.type
        });
      
      if (error) {
        console.error('[NoteMedia] Upload error:', error);
        showNotification(`Failed to upload ${file.name}: ${error.message}`, 'error');
        continue;
      }
      
      console.log('[NoteMedia] Upload successful:', data);
      
      // Get public URL
      const { data: urlData } = supabase.storage
        .from('note-media')
        .getPublicUrl(fileName);
      
      console.log('[NoteMedia] Public URL:', urlData?.publicUrl);
      
      if (urlData?.publicUrl) {
        uploadedMedia.push({
          url: urlData.publicUrl,
          type: file.type.startsWith('video/') ? 'video' : 'image',
          name: file.name
        });
      }
    } catch (err) {
      console.error('[NoteMedia] Exception during upload:', err);
      showNotification(`Error uploading ${file.name}`, 'error');
    }
  }
  
  console.log('[NoteMedia] Upload complete, uploaded:', uploadedMedia.length, 'files');
  return uploadedMedia;
}

/**
 * Open media preview modal
 */
function openMediaPreview(url, type) {
  const modal = document.getElementById('mediaPreviewModal');
  const content = document.getElementById('mediaPreviewContent');
  
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

window.openMediaPreview = openMediaPreview;

/**
 * Close media preview modal
 */
function closeMediaPreview() {
  const modal = document.getElementById('mediaPreviewModal');
  if (modal) {
    modal.classList.add('hidden');
    // Stop any playing videos
    const video = modal.querySelector('video');
    if (video) video.pause();
  }
}

window.closeMediaPreview = closeMediaPreview;

/**
 * Open delete note confirmation modal
 */
function openDeleteNoteModal(noteId) {
  noteToDeleteId = noteId;
  const modal = document.getElementById('deleteNoteModal');
  if (modal) modal.classList.remove('hidden');
}

window.openDeleteNoteModal = openDeleteNoteModal;

/**
 * Close delete note modal
 */
function closeDeleteNoteModal() {
  const modal = document.getElementById('deleteNoteModal');
  if (modal) modal.classList.add('hidden');
  noteToDeleteId = null;
}

window.closeDeleteNoteModal = closeDeleteNoteModal;

/**
 * Confirm and delete the note
 */
async function confirmDeleteNote() {
  if (!noteToDeleteId) return;
  
  const supabase = getSupabaseClient();
  if (!supabase) {
    showNotification('Unable to delete note. Please try again.', 'error');
    return;
  }
  
  try {
    const { error } = await supabase
      .from('appointment_notes')
      .delete()
      .eq('id', noteToDeleteId);
    
    if (error) throw error;
    
    closeDeleteNoteModal();
    
    // Refresh notes list
    if (currentJobNotesAppointmentId) {
      await renderJobViewNotes(currentJobNotesAppointmentId);
    }
    
    showNotification('Note deleted', 'success');
  } catch (err) {
    console.error('[Jobs] Error deleting note:', err);
    showNotification('Failed to delete note. Please try again.', 'error');
  }
}

window.confirmDeleteNote = confirmDeleteNote;

/**
 * Save job note
 */
async function saveJobNote(e) {
  if (e) e.preventDefault();
  
  console.log('[SaveNote] ====== SAVING NOTE ======');
  console.log('[SaveNote] pendingNoteMedia:', pendingNoteMedia);
  console.log('[SaveNote] pendingNoteMedia.length:', pendingNoteMedia.length);
  
  const textarea = document.getElementById('jobNoteText');
  const saveBtn = document.getElementById('saveJobNoteBtn');
  const noteText = textarea.value.trim();
  
  console.log('[SaveNote] noteText:', noteText);
  console.log('[SaveNote] currentJobNotesAppointmentId:', currentJobNotesAppointmentId);
  
  if (!noteText && pendingNoteMedia.length === 0) {
    showNotification('Please enter a note or add media.', 'error');
    return;
  }
  
  const supabase = getSupabaseClient();
  const authId = await getCurrentAuthId();
  
  if (!supabase || !authId || !currentJobNotesAppointmentId) {
    showNotification('Unable to save note. Please try again.', 'error');
    return;
  }
  
  // Disable save button and show loading
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';
  }
  
  try {
    // Upload media files if any
    let mediaUrls = [];
    if (pendingNoteMedia.length > 0) {
      mediaUrls = await uploadNoteMedia(pendingNoteMedia, currentJobNotesAppointmentId);
    }
    
    // Create new note with media, subject and send_to
    const subject = document.getElementById('noteSubject')?.value || null;
    let sendToArr = Array.from(window.pendingJobNoteSendTo || []);
    if (sendToArr.includes('all') && sendToArr.length > 1) sendToArr = sendToArr.filter(s => s !== 'all');
    console.log('[SaveNote] creating note, send_to:', sendToArr);

    const noteData = {
      appointment_id: currentJobNotesAppointmentId,
      note: noteText || '(Media attached)',
      created_by: authId,
      subject: subject,
      send_to: sendToArr
    };
    
    // Add media_urls if we have any
    if (mediaUrls.length > 0) {
      noteData.media_urls = mediaUrls;
    }
    
    const { error } = await supabase
      .from('appointment_notes')
      .insert(noteData);
    
    if (error) throw error;
    
    // Refresh notes list
    await renderJobViewNotes(currentJobNotesAppointmentId);
    closeJobNoteModal();
    showNotification('Note saved successfully', 'success');
    
  } catch (err) {
    console.error('[Jobs] Error saving note:', err);
    showNotification('Failed to save note. Please try again.', 'error');
  } finally {
    // Re-enable save button
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save';
    }
  }
}

// Make it global for onclick
window.saveJobNote = saveJobNote;

/**
 * Update job status
 */
async function updateJobStatus(jobId, newStatus) {
  const index = allJobs.findIndex(j => j.id === jobId);
  if (index === -1) return;
  // updateJobStatus called for job

  const now = new Date().toISOString();
  allJobs[index].status = newStatus;
  allJobs[index].updated_at = now;
  
  // Update jobs table in database
  const supabase = getSupabaseClient();
  if (supabase) {
    try {
      const { error } = await supabase
        .from('jobs')
        .update({ 
          status: newStatus,
          updated_at: now
        })
        .eq('id', jobId);
      
      if (error) {
        console.error('Failed to update jobs table:', error);
      } else {
        console.log(`✅ Updated job ${jobId} status in database to ${newStatus}`);
      }
    } catch (err) {
      console.error('Error updating jobs table:', err);
    }
  }

  // If completed, set completed_at and handle invoice creation/closure
  if (newStatus === 'completed') {
    allJobs[index].completed_at = new Date().toISOString();

    // Find or create invoice for this job
    const job = allJobs[index];
    let invoices = [];
    let customerName = job.customer || '';
    let customerId = null;
    // Try to get customer name and ID from appointment if missing
    if (job.appointment_id) {
      const apptIdx = allAppointments.findIndex(a => a.id === job.appointment_id);
      if (apptIdx !== -1) {
        const appt = allAppointments[apptIdx];
        customerName = appt.customer || `${appt.customer_first || ''} ${appt.customer_last || ''}`.trim();
        // Try to find customer ID by matching appointment details
        try {
          const supabase = getSupabaseClient();
          const shopId = getCurrentShopId();
          if (supabase && shopId) {
            const { data: customers } = await supabase
              .from('customers')
              .select('id, customer_first, customer_last, phone, email')
              .eq('shop_id', shopId);
            const match = customers?.find(c =>
              (c.customer_first?.trim().toLowerCase() === (appt.customer_first?.trim().toLowerCase() || '')) &&
              (c.customer_last?.trim().toLowerCase() === (appt.customer_last?.trim().toLowerCase() || ''))
            ) || customers?.find(c => c.phone === appt.phone) || customers?.find(c => c.email === appt.email);
            if (match) customerId = match.id;
          }
        } catch (e) {
          console.warn('[jobs.js] Could not lookup customer ID:', e);
        }

        // Update linked appointment status to 'completed' so other pages reflect the change
        try {
          const apptNow = new Date().toISOString();
          allAppointments[apptIdx].status = 'completed';
          allAppointments[apptIdx].updated_at = apptNow;
          
          // Update appointments table in database
          if (supabase && allAppointments[apptIdx].id) {
            const { error: apptError } = await supabase
              .from('appointments')
              .update({ 
                status: 'completed',
                updated_at: apptNow
              })
              .eq('id', allAppointments[apptIdx].id);
            
            if (apptError) {
              console.error('Failed to update appointments table:', apptError);
            } else {
              console.log(`✅ Updated appointment ${allAppointments[apptIdx].id} status to completed`);
            }
          }
        } catch (e) {
          console.warn('[jobs.js] Failed to mark linked appointment completed:', e);
        }

        // Ensure appointments table is updated everywhere
        await saveAppointments(allAppointments);
      }
    }
    try {
      const localData = JSON.parse(localStorage.getItem('xm_data') || '{}');
      invoices = localData.invoices || [];
    } catch {}
    let inv = invoices.find(i => i.appointment_id === job.appointment_id || i.job_id === job.id);
    if (!inv) {
      // Create new invoice
      inv = {
        id: `inv_${Date.now()}`,
        number: invoices.length + 1001,
        customer: customerName || 'Walk-in',
        customer_id: customerId || '',
        appointment_id: job.appointment_id || '',
        job_id: job.id,
        status: 'paid',
        due: new Date().toISOString().slice(0,10),
        tax_rate: 6,
        discount: 0,
        items: job.items || [],
        paid_date: new Date().toISOString(),
        created_at: new Date().toISOString()
      };
    }
    // Make it global for onclick
    window.closeStatusModal = closeStatusModal;
    window.openLaborModal = openLaborModal;
    window.closeRemoveModal = closeRemoveModal;
    // `openLaborModal` is exposed above and used directly by other components.
    } else {
    // Handle 'scheduled' status specially - this should use sendJobBackToScheduled instead,
    // but if called here, redirect to proper handling
    if (newStatus === 'scheduled') {
      console.warn('[Jobs] updateJobStatus called with scheduled - redirecting to sendJobBackToScheduled');
      const job = allJobs[index];
      if (job) {
        await sendJobBackToScheduled(job);
      }
      return; // Exit early, sendJobBackToScheduled handles everything
    }
    
    if (!['in_progress', 'awaiting_parts'].includes(newStatus)) {
      // If status is not active, remove from jobs page (stays in appointments)
      allJobs = allJobs.filter(j => j.id !== allJobs[index].id);
    }

    // Always update linked appointment status for in_progress and awaiting_parts
    if (['in_progress', 'awaiting_parts'].includes(newStatus)) {
      const job = allJobs[index];
      if (job.appointment_id) {
        // Update appointment status locally
        const apptIdx = allAppointments.findIndex(a => a.id === job.appointment_id);
        if (apptIdx !== -1) {
          // Updating appointment status to newStatus
          const apptNow = new Date().toISOString();
          allAppointments[apptIdx].status = newStatus;
          allAppointments[apptIdx].updated_at = apptNow;
          
          // Update appointments table in database
          if (supabase && allAppointments[apptIdx].id) {
            try {
              const { error: apptError } = await supabase
                .from('appointments')
                .update({ 
                  status: newStatus,
                  updated_at: apptNow
                })
                .eq('id', allAppointments[apptIdx].id);
              
              if (apptError) {
                console.error('Failed to update appointments table:', apptError);
              } else {
                console.log(`✅ Updated appointment ${allAppointments[apptIdx].id} status to ${newStatus}`);
              }
            } catch (err) {
              console.error('Error updating appointments table:', err);
            }
          }
        } else {
          // Appointment not found for job
        }
        // Save to Supabase 'data' table
        try {
          const shopId = getCurrentShopId();
          const supabase = getSupabaseClient();
          if (supabase && shopId) {
            const { data: currentData, error: fetchError } = await supabase
              .from('data')
              .select('*')
              .eq('shop_id', shopId)
              .single();
            if (fetchError && fetchError.code !== 'PGRST116') {
              // Supabase fetchError
              throw fetchError;
            }
            const payload = {
              shop_id: shopId,
              appointments: allAppointments,
              settings: currentData?.settings || {},
              jobs: currentData?.jobs || [],
              threads: currentData?.threads || [],
              invoices: currentData?.invoices || [],
              updated_at: new Date().toISOString()
            };
            // Upserting appointments to Supabase
            await supabase.from('data').upsert(payload, { onConflict: 'shop_id' });
          }
        } catch (ex) {
          // Supabase save failed (appt status update)
        }
        // Fallback to localStorage
        try {
          const localData = JSON.parse(localStorage.getItem('xm_data') || '{}');
          localData.appointments = allAppointments;
          localStorage.setItem('xm_data', JSON.stringify(localData));
          // Saved appointments to localStorage
        } catch (e) {
          // Failed to save appointments to localStorage
        }
        // Ensure appointments table is updated everywhere
        // calling saveAppointments for full sync
        await saveAppointments(allAppointments);
      }
    }
  }
  // Create notification for status changes (awaiting_parts and completed)
  if (newStatus === 'awaiting_parts' || newStatus === 'completed') {
    try {
      const shopId = getCurrentShopId();
      const authId = await getCurrentAuthId();
      const job = allJobs[index];
      const appt = allAppointments.find(a => a.id === job.appointment_id);
      
      const titles = {
        'awaiting_parts': 'Job Awaiting Parts',
        'completed': 'Job Completed'
      };
      
      const messages = {
        'awaiting_parts': `Job for ${appt?.customer || 'customer'}'s ${appt?.vehicle || 'vehicle'} is awaiting parts. Review parts needed and place order.`,
        'completed': `Job for ${appt?.customer || 'customer'}'s ${appt?.vehicle || 'vehicle'} has been completed and is ready for invoicing.`
      };
      
      await createShopNotification({
        supabase: getSupabaseClient(),
        shopId,
        type: `job_${newStatus}`,
        category: 'job',
        title: titles[newStatus],
        message: messages[newStatus],
        relatedId: job.id,
        relatedType: 'job',
        metadata: {
          customer_name: appt?.customer || '',
          vehicle: appt?.vehicle || '',
          service: appt?.service || '',
          job_id: job.id,
          old_status: job.status,
          new_status: newStatus
        },
        priority: newStatus === 'awaiting_parts' ? 'high' : 'normal',
        createdBy: authId
        // No recipientUserId = sends to all shop owners
      });
    } catch (error) {
      console.error('[Jobs] Error creating status notification:', error);
    }
  }
  
  await saveJobs(allJobs);
  await renderJobs();
  showNotification(`Job status updated to ${newStatus.replace(/_/g, ' ')}`);
}

/**
 * Open assign modal (simple prompt for now)
 */
function openAssignModal(job) {
  // Use the same foreman-style assign modal (id: assignJobModal)
  let modal = document.getElementById('assignJobModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'assignJobModal';
    modal.className = 'modal-overlay hidden';
    modal.innerHTML = `
      <div class="modal-content" onclick="event.stopPropagation()" style="max-width: 480px;">
        <div class="modal-head">
          <h3>Assign Job</h3>
          <button type="button" class="btn-close" onclick="closeAssignModal()">&times;</button>
        </div>
        <div class="modal-body">
          <p style="margin-bottom: 12px; color: var(--muted);">Select a staff member to assign this job to:</p>
          <div id="staffListContainer" style="display: flex; flex-direction: column; gap: 8px; max-height: 300px; overflow-y: auto;"></div>
        </div>
        <div class="modal-foot">
          <button onclick="closeAssignModal()" class="btn">Cancel</button>
        </div>
      </div>
    `;
    modal.onclick = () => closeAssignModal();
    document.body.appendChild(modal);
  }

  // Populate staff list and show modal
  (async function populateAndShow() {
    const container = modal.querySelector('#staffListContainer');
    modal.dataset.jobId = job.id;
    container.innerHTML = '<div class="notice">Loading staff...</div>';
      try {
      const sup = getSupabaseClient();
      const shop = getCurrentShopId();
      let staffRows = [];
      let userRows = [];
      if (sup && shop) {
        const { data: sdata, error: sErr } = await sup.from('shop_staff').select('*').eq('shop_id', shop);
        if (!sErr && Array.isArray(sdata) && sdata.length) staffRows = sdata.map(s => s);
        try {
          const { data: udata, error: uErr } = await sup.from('users').select('*').eq('shop_id', shop);
          if (!uErr && Array.isArray(udata) && udata.length) userRows = udata.map(u => u);
        } catch (ue) { /* ignore users fetch errors */ }
      }

      // Merge users and shop_staff (prefer shop_staff for role/display)
      const emailMap = new Map();
      (userRows || []).forEach(u => {
        const key = (u.email || '').toLowerCase();
        if (!key) return;
        emailMap.set(key, Object.assign({}, u, { source: 'users' }));
      });
      (staffRows || []).forEach(s => {
        const key = (s.email || '').toLowerCase();
        if (!key) return;
        const existing = emailMap.get(key);
        const staffObj = Object.assign({}, s, { source: 'shop_staff', shop_staff_id: s.id });
        if (!existing) {
          emailMap.set(key, staffObj);
        } else {
          // prefer shop_staff fields
          existing.source = 'shop_staff';
          existing.shop_staff_id = staffObj.shop_staff_id || existing.shop_staff_id;
          existing.role = staffObj.role || existing.role;
          existing.first = existing.first || staffObj.first_name || staffObj.first;
          existing.last = existing.last || staffObj.last_name || staffObj.last;
          existing.hourly_rate = (typeof staffObj.hourly_rate !== 'undefined') ? staffObj.hourly_rate : existing.hourly_rate;
          existing.pay_type = (typeof staffObj.pay_type !== 'undefined') ? staffObj.pay_type : existing.pay_type;
        }
      });

      const allStaff = Array.from(emailMap.values());
      if (!allStaff.length) {
        container.innerHTML = '<p class="notice">No staff available. Add staff in Settings.</p>';
      } else {
        // Normalize role helper
        function normalizeRole(r) {
          if (!r) return 'staff';
          let s = String(r).toLowerCase().trim();
          s = s.replace(/[_\-\/]+/g, ' ').replace(/\s+/g, ' ').trim();
          if (s.includes('admin') || s.includes('owner')) return 'admin';
          if (s === 'servicewriter' || s === 'service writer') return 'service writer';
          if (s === 'manager' || s === 'lead') return 'staff';
          return s;
        }

        const groups = { top: [], foreman: [], staff: [], service_writer: [], receptionist: [], others: [] };
        // Fetch shop owner id from shops table (if available)
        let shopOwnerId = null;
        try {
          if (sup && shop) {
            const { data: shopInfo, error: shopErr } = await sup.from('shops').select('owner_id').eq('id', shop).limit(1).single();
            if (!shopErr && shopInfo && shopInfo.owner_id) shopOwnerId = String(shopInfo.owner_id);
          }
        } catch (se) { /* ignore */ }
        allStaff.forEach(u => {
          const role = normalizeRole(u.role || u.role || 'staff');
          const isOwner = shopOwnerId && String(u.id) === shopOwnerId;
          if (isOwner || (u.role && (u.role === 'admin' || u.role === 'owner'))) groups.top.push(u);
          else if (role === 'foreman') groups.foreman.push(u);
          else if (role === 'service writer') groups.service_writer.push(u);
          else if (role === 'receptionist') groups.receptionist.push(u);
          else if (!role || role === 'staff') groups.staff.push(u);
          else groups.others.push(u);
        });

        const sections = [
          { title: 'Admin / Owner', items: groups.top },
          { title: 'Foreman', items: groups.foreman },
          { title: 'Staff', items: groups.staff },
          { title: 'Service Writer', items: groups.service_writer },
          { title: 'Receptionist', items: groups.receptionist },
          { title: 'Other', items: groups.others }
        ];

        const html = sections.map(sec => {
          if (!sec.items || sec.items.length === 0) return `'<div style="padding:8px 0;color:var(--muted);">No ${sec.title}</div>'`;
          const rows = sec.items.map(s => {
            const first = s.first || s.first_name || '';
            const last = s.last || s.last_name || '';
            const authId = s.auth_id || s.id || '';
            const safeName = ((first || '') + ' ' + (last || '')).replace(/'/g, "\\'");
            const displayRole = (s.role || 'staff');
            return `<button class="btn" style="display:flex;width:100%;text-align:left;justify-content:flex-start;padding:12px;border-radius:8px;margin-bottom:6px;box-sizing:border-box;" onclick="selectStaffForAssign('${authId}', '${safeName}')"><div style="display:flex;flex-direction:column;align-items:flex-start;width:100%;"><strong>${first} ${last}</strong><span style="font-size:12px;color:var(--muted);">${s.email || ''} • ${displayRole}</span></div></button>`;
          }).join('');
          return `<div style="margin-bottom:8px;">` +
                 `<div class="staff-role-header" style="background:linear-gradient(135deg,#111827,#374151);color:#fff;padding:8px 12px;font-weight:700;border-radius:6px;margin-bottom:8px;">${sec.title}</div>` +
                 `<div style="display:flex;flex-direction:column;gap:6px;">${rows}</div>` +
                 `</div>`;
        }).join('');

        container.innerHTML = html;
      }
      modal.classList.remove('hidden');
    } catch (e) {
      console.error('Failed to load staff for assign modal', e);
      container.innerHTML = '<p class="notice">Error loading staff list</p>';
      modal.classList.remove('hidden');
    }
  })();
}

window.closeAssignModal = function() {
  const m = document.getElementById('assignJobModal'); if (m) m.classList.add('hidden');
};

window.selectStaffForAssign = async function(staffAuthId, staffName) {
  try {
    const modal = document.getElementById('assignJobModal');
    const jobId = modal?.dataset?.jobId;
    if (!jobId || !staffAuthId) return;
    closeAssignModal();
    await assignJob(jobId, staffAuthId);
  } catch (e) {
    console.error('selectStaffForAssign failed', e);
    showErrorBanner('Failed to assign job');
  }
};

// Expose assign modal and assign helper globally so other pages can reuse it
try {
  window.openAssignModal = openAssignModal;
  window.assignJob = assignJob;
} catch (e) { /* ignore in strict contexts */ }

/**
 * Assign job to user
 */
async function assignJob(jobId, userId) {
  const index = allJobs.findIndex(j => j.id === jobId);
  if (index === -1) return;
  
  allJobs[index].assigned_to = userId;
  allJobs[index].updated_at = new Date().toISOString();
  
  await saveJobs(allJobs);
  await renderJobs();
  
  const user = allUsers.find(u => u.id === userId);
  let displayName = '';
  if (user) {
    displayName = `${user.first || user.first_name || ''} ${user.last || user.last_name || ''}`.trim();
  } else {
    // Fallback: try to resolve name from shop_staff table
    try {
      const supabase = getSupabaseClient();
      const shopId = getCurrentShopId();
      if (supabase && shopId) {
        const { data: staff } = await supabase
          .from('shop_staff')
          .select('first_name, last_name, email')
          .eq('auth_id', userId)
          .eq('shop_id', shopId)
          .single();
        if (staff) displayName = `${staff.first_name || ''} ${staff.last_name || ''}`.trim() || staff.email || '';
      }
    } catch (e) {
      console.warn('Could not resolve staff name for assignment', e);
    }
  }
  if (!displayName) displayName = `User ${String(userId).slice(0,6)}`;
  showNotification(`Job assigned to ${displayName}`);
  
  // Create notification for assigned technician
  try {
    const shopId = getCurrentShopId();
    const authId = await getCurrentAuthId();
    const job = allJobs[index];
    const appt = allAppointments.find(a => a.id === job.appointment_id);
    
    await createShopNotification({
      supabase: getSupabaseClient(),
      shopId,
      type: 'job_assigned',
      category: 'job',
      title: 'New Job Assigned',
      message: `You have been assigned to work on ${appt?.customer || 'a customer'}'s ${appt?.vehicle || 'vehicle'} - ${appt?.service || 'Service request'}`,
      relatedId: job.id,
      relatedType: 'job',
      metadata: {
        customer_name: appt?.customer || '',
        vehicle: appt?.vehicle || '',
        service: appt?.service || '',
        job_id: job.id
      },
      priority: 'high',
      createdBy: authId,
      recipientUserId: userId // Notify the assigned technician
    });
  } catch (error) {
    console.error('[Jobs] Error creating assignment notification:', error);
  }
}

/**
 * Complete job
 */
async function completeJob(jobId) {
  if (!confirm('Mark this job as completed?')) return;
  
  await updateJobStatus(jobId, 'completed');
}

/**
 * Handle remove job
 */
async function handleRemoveJob(removeAppointment = false) {
  if (!currentJobForRemove) return;
  
  const job = currentJobForRemove;
  // Determine current user's role
  let user = {};
  try { user = await getCurrentUserWithRole(); } catch (e) { user = {}; }

  // For all roles (foreman, admin, owner), send the job back to scheduled status
  // This ensures the appointment is updated to 'scheduled' and the job is
  // removed from the jobs lists to avoid creating ghost/duplicate jobs later.
  await sendJobBackToScheduled(job);

  if (removeAppointment && user.role !== 'foreman') {
    // Remove appointment from local array
    allAppointments = allAppointments.filter(a => a.id !== job.appointment_id);

    // Save to Supabase 'data' table
    const shopId = getCurrentShopId();
    const supabase = getSupabaseClient();
    if (supabase && shopId) {
      try {
        const { data: currentData, error: fetchError } = await supabase
          .from('data')
          .select('*')
          .eq('shop_id', shopId)
          .single();

        if (fetchError && fetchError.code !== 'PGRST116') {
          throw fetchError;
        }

        const payload = {
          shop_id: shopId,
          appointments: allAppointments,
          settings: currentData?.settings || {},
          jobs: currentData?.jobs || [],
          threads: currentData?.threads || [],
          invoices: currentData?.invoices || [],
          updated_at: new Date().toISOString()
        };

        await supabase.from('data').upsert(payload, { onConflict: 'shop_id' });

        // Also delete appointment from Supabase 'appointments' table
        if (job.appointment_id) {
          await supabase.from('appointments').delete().eq('id', job.appointment_id);
          console.log('✅ Deleted appointment from Supabase appointments table:', job.appointment_id);
        }
      } catch (ex) {
        console.warn('Supabase save failed:', ex);
      }
    }

    // Fallback to localStorage
    try {
      const localData = JSON.parse(localStorage.getItem('xm_data') || '{}');
      localData.appointments = allAppointments;
      localStorage.setItem('xm_data', JSON.stringify(localData));
    } catch (e) {
      console.error('Failed to save appointments to localStorage:', e);
    }
  }
  
  closeRemoveModal();
  try {
    if (user && user.role === 'foreman') {
      showNotification('Job sent back to scheduled');
    } else {
      showNotification('Job removed successfully');
    }
  } catch (e) { showNotification('Job removed'); }
}

/**
 * Send job back to scheduled status (used by foreman remove action)
 * This properly removes the job from the jobs table/data and updates
 * the linked appointment status to 'scheduled'.
 */
async function sendJobBackToScheduled(job) {
  if (!job) return;
  
  const supabase = getSupabaseClient();
  const shopId = getCurrentShopId();
  const appointmentId = job.appointment_id;
  
  console.log('[Jobs] Sending job back to scheduled:', job.id, 'appointment:', appointmentId);
  
  // 1. Remove job from local allJobs array
  allJobs = allJobs.filter(j => j.id !== job.id);
  
  // 2. Update appointment status to 'scheduled' in local array
  if (appointmentId) {
    const apptIdx = allAppointments.findIndex(a => a.id === appointmentId);
    if (apptIdx !== -1) {
      allAppointments[apptIdx].status = 'scheduled';
      allAppointments[apptIdx].updated_at = new Date().toISOString();
      // Set suppress_auto_job flag to prevent job from being auto-recreated
      allAppointments[apptIdx].suppress_auto_job = true;
      console.log('[Jobs] Updated appointment status to scheduled:', appointmentId);
    }
  }
  
  // 3. Save changes to Supabase
  if (supabase && shopId) {
    try {
      // Get current data
      const { data: currentData, error: fetchError } = await supabase
        .from('data')
        .select('*')
        .eq('shop_id', shopId)
        .single();
      
      if (fetchError && fetchError.code !== 'PGRST116') {
        throw fetchError;
      }
      
      // Remove the job from data.jobs
      const existingJobs = currentData?.jobs || [];
      const updatedJobs = existingJobs.filter(j => j.id !== job.id && j.appointment_id !== appointmentId);
      
      // Update the appointment in data.appointments
      const existingAppts = currentData?.appointments || [];
      const updatedAppts = existingAppts.map(a => {
        if (a.id === appointmentId) {
          return {
            ...a,
            status: 'scheduled',
            updated_at: new Date().toISOString(),
            suppress_auto_job: true
          };
        }
        return a;
      });
      
      // Save to data table
      const payload = {
        shop_id: shopId,
        jobs: updatedJobs,
        appointments: updatedAppts,
        settings: currentData?.settings || {},
        threads: currentData?.threads || [],
        invoices: currentData?.invoices || [],
        updated_at: new Date().toISOString()
      };
      
      const { error: upsertError } = await supabase
        .from('data')
        .upsert(payload, { onConflict: 'shop_id' });
      
      if (upsertError) throw upsertError;
      console.log('✅ [Jobs] Data table updated - job removed, appointment set to scheduled');
      
      // 4. Delete job from standalone jobs table
      // Add diagnostics: try to select matching rows first, then attempt deletions by id and/or appointment_id.
      try {
        let foundRows = [];
        try {
          // Try to find rows matching either id or appointment_id
          // Use OR filter; if this fails due to type mismatch we'll catch and log it
          const orFilter = [];
          if (job.id) orFilter.push(`id.eq.${job.id}`);
          if (appointmentId) orFilter.push(`appointment_id.eq.${appointmentId}`);
          if (orFilter.length) {
            const { data: selData, error: selErr } = await supabase
              .from('jobs')
              .select('id,appointment_id,shop_id,created_at')
              .or(orFilter.join(','));
            if (selErr) {
              console.warn('[Jobs] Could not select job rows for diagnostics:', selErr);
            } else if (selData && selData.length) {
              foundRows = selData;
              console.log('[Jobs] Diagnostic select found job rows:', foundRows.map(r => ({ id: r.id, appointment_id: r.appointment_id })));
            } else {
              console.log('[Jobs] Diagnostic select returned no job rows for id/appointment_id');
            }
          }
        } catch (selEx) {
          console.warn('[Jobs] Diagnostic select threw error (possibly type mismatch):', selEx);
        }

        // Attempt delete by id first (even temp ids) and catch errors
        let deleted = null;
        if (job.id) {
          try {
            const { data: delData, error: delErr } = await supabase
              .from('jobs')
              .delete()
              .eq('id', job.id)
              .select('id');
            if (delErr) {
              console.warn('[Jobs] Delete by id returned error:', delErr);
            } else if (delData && delData.length) {
              deleted = delData;
              console.log('✅ [Jobs] Job deleted from jobs table by id:', job.id);
            } else {
              console.log('[Jobs] Delete by id affected no rows for id:', job.id);
            }
          } catch (exDelById) {
            console.warn('[Jobs] Exception deleting by id (may be type mismatch):', exDelById);
          }
        }

        // If not deleted by id, try delete by appointment_id
        if (!deleted && appointmentId) {
          try {
            const { data: delByAppt, error: delByApptErr } = await supabase
              .from('jobs')
              .delete()
              .eq('appointment_id', appointmentId)
              .select('id');
            if (delByApptErr) {
              console.warn('[Jobs] Delete by appointment_id returned error:', delByApptErr);
            } else if (delByAppt && delByAppt.length) {
              deleted = delByAppt;
              console.log('✅ [Jobs] Job(s) deleted from jobs table by appointment_id:', delByAppt.map(d => d.id));
            } else {
              console.log('[Jobs] Delete by appointment_id affected no rows for appointment_id:', appointmentId);
            }
          } catch (exDelAppt) {
            console.warn('[Jobs] Exception deleting by appointment_id:', exDelAppt);
          }
        }

        // If still not deleted but diagnostic select found rows (type mismatch prevented direct eq), attempt delete by those exact ids
        if (!deleted && foundRows && foundRows.length) {
          const ids = foundRows.map(r => r.id).filter(Boolean);
          if (ids.length) {
            try {
              const { data: delData2, error: delErr2 } = await supabase
                .from('jobs')
                .delete()
                .in('id', ids)
                .select('id');
              if (delErr2) {
                console.warn('[Jobs] Final delete by discovered ids returned error:', delErr2);
              } else if (delData2 && delData2.length) {
                deleted = delData2;
                console.log('[Jobs] Deleted job rows by discovered ids:', delData2.map(d => d.id));
              } else {
                console.log('[Jobs] Final delete by discovered ids affected no rows');
              }
            } catch (exFinal) {
              console.warn('[Jobs] Exception during final delete attempt:', exFinal);
            }
          }
        }

        // If no deletion succeeded, attempt to 'soft remove' by updating the discovered rows
        if (!deleted && foundRows && foundRows.length) {
          const ids = foundRows.map(r => r.id).filter(Boolean);
          if (ids.length) {
            try {
              const { data: updData, error: updErr } = await supabase
                .from('jobs')
                .update({ status: 'deleted', updated_at: new Date().toISOString() })
                .in('id', ids)
                .select('id');
              if (updErr) {
                console.warn('[Jobs] Could not soft-delete job rows by id:', updErr);
              } else if (updData && updData.length) {
                console.log('[Jobs] Soft-deleted job rows by id:', updData.map(d => d.id));
                deleted = updData;
              } else {
                console.log('[Jobs] Soft-delete affected no rows for ids:', ids);
              }
            } catch (exUpd) {
              console.warn('[Jobs] Exception during soft-delete attempt:', exUpd);
            }
          }
        }

        if (!deleted) {
          console.log('[Jobs] No job deletion performed (no matching id/appointment_id or type mismatch)');
        }
      } catch (delEx) {
        console.warn('[Jobs] Exception while deleting job from jobs table:', delEx);
      }
      
      // 5. Update appointment in standalone appointments table
      if (appointmentId) {
        const { error: updateApptError } = await supabase
          .from('appointments')
          .update({
            status: 'scheduled',
            updated_at: new Date().toISOString()
          })
          .eq('id', appointmentId);
        
        if (updateApptError) {
          console.warn('[Jobs] Could not update appointment in appointments table:', updateApptError);
        } else {
          console.log('✅ [Jobs] Appointment status updated to scheduled in appointments table');
        }
      }
      
    } catch (ex) {
      console.error('[Jobs] Supabase update failed during sendJobBackToScheduled:', ex);
    }
  }
  
  // 6. Also update localStorage for offline/fallback consistency
  try {
    const localData = JSON.parse(localStorage.getItem('xm_data') || '{}');
    localData.jobs = (localData.jobs || []).filter(j => j.id !== job.id && j.appointment_id !== appointmentId);
    localData.appointments = (localData.appointments || []).map(a => {
      if (a.id === appointmentId) {
        return { ...a, status: 'scheduled', updated_at: new Date().toISOString(), suppress_auto_job: true };
      }
      return a;
    });
    localStorage.setItem('xm_data', JSON.stringify(localData));
    window.dispatchEvent(new Event('xm_data_updated'));
  } catch (e) {
    console.warn('[Jobs] Failed to update localStorage:', e);
  }
  
  // 7. Re-render the jobs page
  await renderJobs();
}

/**
 * Open parts finder modal
 */
function openPartsModal(job, appt) {
  // Hydrate job with vehicle info from appointment before opening modal
  if (appt) {
    job.year = appt.vehicle_year || '';
    job.make = appt.vehicle_make || '';
    job.model = appt.vehicle_model || '';
    job.vehicle = (appt.vehicle_year && appt.vehicle_make && appt.vehicle_model)
      ? `${appt.vehicle_year} ${appt.vehicle_make} ${appt.vehicle_model}`
      : '';
  }
  // Use the new parts modal handler if available
  if (window.partsModalHandler) {
    window.partsModalHandler.openModal(job);
  } else {
    // Fallback to old modal
    const modal = document.getElementById('partsModal');
    if (modal) {
      modal.dataset.jobId = job.id;
      modal.classList.remove('hidden');
    }
  }
}

/**
 * Close parts modal
 */
function closePartsModal() {
  const modal = document.getElementById('partsModal');
  if (modal) modal.classList.add('hidden');
}

/**
 * Open add parts modal
 */
function openAddPartsModal(job, appt) {
  // openAddPartsModal called
  const modal = document.getElementById('addPartsModal');
  if (!modal) {
    // addPartsModal not found
    return;
  }
  // Clear form
  document.getElementById('partName').value = '';
  document.getElementById('partQty').value = '1';
  document.getElementById('partPrice').value = '';
  document.getElementById('addPartsNote').textContent = '';
  // Store current job for later
  // openAddPartsModal job
  if (job && job.id) {
    modal.dataset.jobId = job.id;
    // modal.dataset.jobId set
  } else {
    // openAddPartsModal: job or job.id missing
    delete modal.dataset.jobId;
  }
  modal.classList.remove('hidden');
}

/**
 * Close add parts modal
 */
function closeAddPartsModal() {
  const modal = document.getElementById('addPartsModal');
  if (modal) modal.classList.add('hidden');
}

/**
 * Handle add to invoice
 */
async function handleAddToInvoice() {
  // handleAddToInvoice called
  const modal = document.getElementById('addPartsModal');
  const jobId = modal?.dataset.jobId;
  if (!jobId) {
    // jobId undefined
    return;
  }
  
  const partName = document.getElementById('partName').value.trim();
  const partQty = parseInt(document.getElementById('partQty').value) || 1;
  const partPrice = parseFloat(document.getElementById('partPrice').value) || 0;
  
  if (!partName) {
    document.getElementById('addPartsNote').textContent = 'Part name is required';
    return;
  }
  
  if (partPrice <= 0) {
    document.getElementById('addPartsNote').textContent = 'Price must be greater than 0';
    return;
  }
  
  try {
    // Add part to invoice and get its ID for linking
    const partItemId = await addPartToInvoice(jobId, partName, partQty, partPrice, undefined, partName);
    // Part added to invoice
    // Close add parts modal
    closeAddPartsModal();
    // Open labor modal with part ID for linking
    openLaborModal(jobId, partItemId, partName);
    // Opened labor modal (user action)
  } catch (error) {
    console.error('Error adding part to invoice:', error);
    document.getElementById('addPartsNote').textContent = 'Error adding part to invoice';
  }
}

/**
 * Open labor modal
 * @param {string} jobId - The job ID
 * @param {string} partItemId - Optional part item ID to link labor with
 * @param {string} partName - Optional part name for display
 */
async function openLaborModal(jobId, partItemId, partName) {
  console.log('[openLaborModal] called with jobId:', jobId);
  const modal = document.getElementById('laborModal');
  const overlay = document.getElementById('laborModalOverlay');
  if (!modal) {
    console.error('[openLaborModal] laborModal element not found!');
    return;
  }
  
  // Clear form
  const labDescEl = document.getElementById('labDesc');
  const labHoursEl = document.getElementById('labHours');
  const labRateSel = document.getElementById('labRateSel');
  const labRateCustom = document.getElementById('labRateCustom');
  if (labDescEl) labDescEl.value = '';
  // Default to 1 hour
  if (labHoursEl) labHoursEl.value = '1';
  // Populate rate select from settings (local cache)
  try {
    let settings = JSON.parse(localStorage.getItem('xm_data') || '{}').settings || {};
    let rates = settings.labor_rates || [];
    console.log('[openLaborModal] labor_rates from localStorage:', rates);
    // Attempt to fetch latest settings from Supabase (if available) to avoid stale local cache
    try {
      const supabase = getSupabaseClient();
      const shopId = getCurrentShopId();
      if (supabase && shopId) {
        const { data: dataRecord, error } = await supabase
          .from('data')
          .select('settings')
          .eq('shop_id', shopId)
          .single();
        if (!error && dataRecord && dataRecord.settings) {
          const fetchedSettings = dataRecord.settings || {};
          const fetchedRates = fetchedSettings.labor_rates || [];
          // Always replace local cached settings with authoritative Supabase settings
          settings = fetchedSettings;
          rates = fetchedRates;
          console.log('[openLaborModal] loaded labor_rates from Supabase:', rates);
          try {
            const localData = JSON.parse(localStorage.getItem('xm_data') || '{}');
            localData.settings = Object.assign(localData.settings || {}, settings);
            localStorage.setItem('xm_data', JSON.stringify(localData));
          } catch (e) { /* ignore local cache failures */ }
        }
      }
    } catch (e) {
      console.warn('[openLaborModal] Supabase fetch failed', e);
    }
    if (labRateSel) {
      // populate select with only saved labor rates (no placeholder/custom option)
      labRateSel.innerHTML = '';
      // top option: Custom (default) so user can immediately type a custom rate
      const optCustom = document.createElement('option');
      optCustom.value = '__custom__';
      optCustom.text = 'Custom';
      labRateSel.appendChild(optCustom);
      rates.forEach(r => {
        const opt = document.createElement('option');
        opt.value = r.name;
        opt.dataset.rate = r.rate;
        opt.text = `${r.name} - $${r.rate}/hr`;
        labRateSel.appendChild(opt);
      });
      // ensure numeric rate input is visible
      if (labRateCustom) labRateCustom.style.display = '';
      // default to Custom so users can type a rate immediately
      labRateSel.value = '__custom__';
      if (labRateCustom) { labRateCustom.value = ''; labRateCustom.focus(); }
    }
  } catch (e) {
    console.warn('[openLaborModal] failed to populate rates', e);
    if (labRateSel) labRateSel.innerHTML = '<option value="__custom__" selected>Custom</option>';
  }
  document.getElementById('labNote').textContent = '';
  
  // Store current job and part linkage info
  modal.dataset.jobId = jobId;
  modal.dataset.partItemId = partItemId || '';
  modal.dataset.partName = partName || '';
  
  // Update modal title if linking to a part
  const modalTitle = modal.querySelector('h3');
  if (modalTitle && partName) {
    modalTitle.textContent = `Add Labor for: ${partName}`;
  } else if (modalTitle) {
    modalTitle.textContent = 'Add Labor';
  }
  
  // Show overlay and modal
  if (overlay) overlay.style.display = 'block';
  modal.classList.remove('hidden');
  modal.style.display = 'block';
  console.log('[openLaborModal] Modal opened successfully');
}

/**
 * Handle add labor
 */
async function handleAddLabor() {
  const modal = document.getElementById('laborModal');
  const jobId = modal?.dataset.jobId;
  if (!jobId) return;
  
  const partItemId = modal?.dataset.partItemId || null;
  const partName = modal?.dataset.partName || null;
  
  const labDesc = (document.getElementById('labDesc') || {}).value?.trim() || '';
  const labHours = parseFloat((document.getElementById('labHours') || {}).value) || 0;
  // Determine rate from select (preset) or custom numeric input
  let labRate = 0;
  const sel = document.getElementById('labRateSel');
  const custom = document.getElementById('labRateCustom');
  if (sel && sel.value) {
    labRate = parseFloat(sel.selectedOptions[0]?.dataset?.rate) || parseFloat((custom || {}).value) || 0;
  } else {
    // Backwards compat fallback to numeric input id 'labRate'
    labRate = parseFloat((document.getElementById('labRate') || {}).value) || parseFloat((custom || {}).value) || 0;
  }
  
  const usingPreset = sel && sel.value && sel.value !== '__custom__';
  // If using Custom (or no select), require a description. If using a preset and no description provided,
  // use the preset label as the description so invoice/labor lines are meaningful.
  if (!usingPreset && !labDesc) {
    document.getElementById('labNote').textContent = 'Labor description is required for custom rates';
    return;
  }
  let finalDesc = labDesc;
  if (usingPreset && !finalDesc) {
    // Use the option value (preset name) rather than the display text (which includes price)
    finalDesc = sel.value || sel.selectedOptions[0]?.value || '';
  }
  
  if (labHours <= 0) {
    document.getElementById('labNote').textContent = 'Hours must be greater than 0';
    return;
  }
  
  if (labRate <= 0) {
    document.getElementById('labNote').textContent = 'Rate must be greater than 0';
    return;
  }
  
  try {
    // Add labor to invoice, linking to part if applicable
    await addLaborToInvoice(jobId, finalDesc, labHours, labRate, partItemId);
    // Labor added to invoice
    // Close labor modal
    const overlay = document.getElementById('laborModalOverlay');
    if (overlay) overlay.style.display = 'none';
    modal.style.display = 'none';
    // Clear modal data attributes
    delete modal.dataset.partItemId;
    delete modal.dataset.partName;
    // Show success notification
    const message = partItemId ? `${partName} (Part & Labor) added to invoice successfully!` : 'Labor added to invoice successfully!';
    showNotification(message, 'success');
  } catch (error) {
    console.error('Error adding labor to invoice:', error);
    document.getElementById('labNote').textContent = 'Error adding labor to invoice';
  }
}

/**
 * Handle skip labor
 */
function handleSkipLabor() {
  const modal = document.getElementById('laborModal');
  if (modal) modal.classList.add('hidden');
  
  // Show success notification for part only
  showNotification('Part added to invoice successfully!', 'success');
}

/**
 * Add part to invoice
 * @param {string} jobId - The job ID
 * @param {string} partName - Name of the part
 * @param {number} quantity - Quantity
 * @param {number} price - Price per unit
 * @param {number} cost - Cost price (optional)
 * @param {string} groupName - Optional group name for P&R (Part & Replace) grouping
 * @param {boolean} inventoryAlreadyDeducted - If true, skip inventory deduction (already handled)
 * @returns {Promise<string>} - Returns the part item ID for linking
 */
async function addPartToInvoice(jobId, partName, quantity, price, cost, groupName, inventoryAlreadyDeducted = false) {
  // Find the job and related appointment
  const job = allJobs.find(j => j.id === jobId);
  if (!job) throw new Error('Job not found');
  
  const appt = allAppointments.find(a => a.id === job.appointment_id);
  if (!appt) throw new Error('Appointment not found');
  
  // Get or create invoice for this appointment
  let invoice = await getInvoiceForAppointment(appt.id);
  if (!invoice) {
    invoice = await createInvoiceForAppointment(appt);
  }
  
  // Generate unique ID for this item
  const itemId = `item_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  // Add part item to invoice
  const partItem = {
    id: itemId,
    name: partName,
    qty: quantity,
    price: price,
    cost_price: (typeof cost !== 'undefined') ? Number(cost) : undefined,
    type: 'part',
    groupName: groupName || partName, // Store group name for invoice display
    inventoryAlreadyDeducted: inventoryAlreadyDeducted // Track if inventory was already deducted
  };
  
  invoice.items = invoice.items || [];
  invoice.items.push(partItem);
  
  // If cost_price is missing, try to fetch job_parts for a fallback
  if (typeof partItem.cost_price === 'undefined' || partItem.cost_price === null) {
    try {
      const API_BASE = (window.XM_API_BASE !== undefined) ? window.XM_API_BASE : '';
      const resp = await fetch(`${API_BASE}/api/catalog/job-parts/${encodeURIComponent(jobId)}`);
      if (resp && resp.ok) {
        const json = await resp.json();
        const parts = json.parts || [];
        // Try to match by part name or close match
        const match = parts.find(p => (p.part_name || '').toString().trim() === (partName || '').toString().trim() || (p.part_number && partName && partName.includes(p.part_number)));
        if (match && typeof match.cost_price !== 'undefined') {
          partItem.cost_price = Number(match.cost_price) || 0;
        }
      }
    } catch (e) {
      console.warn('[addPartToInvoice] failed to fetch job parts for fallback cost_price', e);
    }
  }

  // Save invoice
  await saveInvoice(invoice);
  // Dispatch event to trigger UI refresh
  window.dispatchEvent(new CustomEvent('partAdded', { detail: { jobId } }));
  console.log('Part added to invoice:', partItem);
  
  // Show success notification (only if inventory wasn't already deducted)
  // This prevents duplicate success messages when inventory was handled by addInventoryToJob
  if (!inventoryAlreadyDeducted) {
    try { showNotification('Part added to invoice', 'success'); } catch (e) {}
  }
  
  // Return item ID for linking with labor
  return itemId;
}

/**
 * Add labor to invoice
 * @param {string} jobId - The job ID
 * @param {string} description - Labor description
 * @param {number} hours - Hours of labor
 * @param {number} rate - Hourly rate
 * @param {string} linkedItemId - Optional ID of the part item to link with
 * @param {string} groupName - Optional group name for P&R grouping
 */
async function addLaborToInvoice(jobId, description, hours, rate, linkedItemId, groupName) {
  // Find the job and related appointment
  const job = allJobs.find(j => j.id === jobId);
  if (!job) throw new Error('Job not found');
  
  const appt = allAppointments.find(a => a.id === job.appointment_id);
  if (!appt) throw new Error('Appointment not found');
  
  // Get invoice for this appointment
  const invoice = await getInvoiceForAppointment(appt.id);
  if (!invoice) throw new Error('Invoice not found');
  
  // Add labor item to invoice
  const laborItem = {
    id: `item_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    // Store the description WITHOUT 'Labor:' prefix so it matches saved labor rates in settings
    name: description,
    qty: hours,
    price: rate,
    type: 'labor',
    linkedItemId: linkedItemId || undefined, // Link to part if provided
    groupName: groupName || undefined // Store group name for P&R display
  };
  
  invoice.items = invoice.items || [];
  invoice.items.push(laborItem);
  
  // Save invoice
  await saveInvoice(invoice);
  try { window.dispatchEvent(new CustomEvent('partAdded', { detail: { jobId } })); } catch(e) {}
  
  console.log('Labor added to invoice:', laborItem);
}

/**
 * Get invoice for appointment
 */
async function getInvoiceForAppointment(appointmentId) {
  try {
    const supabase = getSupabaseClient();
    if (supabase) {
      const shopId = getCurrentShopId();
      const { data, error } = await supabase
        .from('data')
        .select('invoices')
        .eq('shop_id', shopId)
        .single();
      
      if (error && error.code !== 'PGRST116') throw error; // PGRST116 = not found
      
      const invoices = data?.invoices || [];
      return invoices.find(inv => inv.appointment_id === appointmentId);
    } else {
      // LocalStorage fallback
      const data = JSON.parse(localStorage.getItem('xm_data') || '{}');
      const invoices = data.invoices || [];
      return invoices.find(inv => inv.appointment_id === appointmentId);
    }
  } catch (error) {
    console.error('Error getting invoice:', error);
    return null;
  }
}

/**
 * Create invoice for appointment
 */
async function createInvoiceForAppointment(appt) {
  const shopId = getCurrentShopId();
  const nextNumber = await getNextInvoiceNumber();
  
  const invoice = {
    id: `inv_${Date.now()}`,
    number: nextNumber,
    customer_id: appt.customer_id || appt.customer || '',
    customer_first: appt.customer_first || '',
    customer_last: appt.customer_last || '',
    customer: `${appt.customer_first || ''} ${appt.customer_last || ''}`.trim() || appt.customer || 'Walk-in',
    appointment_id: appt.id,
    status: 'open',
    due: new Date().toISOString().split('T')[0], // Today
    tax_rate: 6,
    discount: 0,
    items: [],
    created_at: new Date().toISOString()
  };
  
  await saveInvoice(invoice);
  return invoice;
}

/**
 * Get next invoice number
 */
async function getNextInvoiceNumber() {
  try {
    const supabase = getSupabaseClient();
    if (supabase) {
      const shopId = getCurrentShopId();
      const { data, error } = await supabase
        .from('data')
        .select('invoices')
        .eq('shop_id', shopId)
        .single();
      
      if (error && error.code !== 'PGRST116') throw error;
      
      const invoices = data?.invoices || [];
      const maxNumber = invoices.reduce((max, inv) => Math.max(max, parseInt(inv.number) || 0), 1000);
      return maxNumber + 1;
    } else {
      const data = JSON.parse(localStorage.getItem('xm_data') || '{}');
      const invoices = data.invoices || [];
      const maxNumber = invoices.reduce((max, inv) => Math.max(max, parseInt(inv.number) || 0), 1000);
      return maxNumber + 1;
    }
  } catch (error) {
    console.error('Error getting next invoice number:', error);
    return Date.now(); // Fallback
  }
}

/**
 * Save invoice
 */
async function saveInvoice(invoice) {
  try {
    const supabase = getSupabaseClient();
    if (supabase) {
      const shopId = getCurrentShopId();
      
      // Get current data
      const { data: currentData, error: fetchError } = await supabase
        .from('data')
        .select('*')
        .eq('shop_id', shopId)
        .single();
      
      if (fetchError && fetchError.code !== 'PGRST116') throw fetchError;
      
      const data = currentData || { shop_id: shopId, settings: {}, appointments: [], jobs: [], threads: [], invoices: [] };
      data.invoices = data.invoices || [];
      
      // Update or add invoice
      const index = data.invoices.findIndex(inv => inv.id === invoice.id);
      if (index >= 0) {
        data.invoices[index] = invoice;
      } else {
        data.invoices.push(invoice);
      }
      
      // Save to data table
      const { error: saveError } = await supabase
        .from('data')
        .upsert(data);
      
      if (saveError) throw saveError;
      console.log('✅ Invoice saved to data table:', invoice.id);
      
      // Also upsert to invoices table
      // Parse customer name
      const nameParts = (invoice.customer || '').trim().split(' ');
      const customer_first = nameParts[0] || '';
      const customer_last = nameParts.slice(1).join(' ') || '';
      
      const invoicePayload = {
        id: invoice.id,
        shop_id: shopId,
        number: invoice.number,
        customer_id: invoice.customer_id || '',
        customer_first: customer_first,
        customer_last: customer_last,
        appointment_id: invoice.appointment_id || null,
        job_id: invoice.job_id || null,
        status: invoice.status || 'open',
        due: invoice.due || null,
        tax_rate: invoice.tax_rate || 6,
        discount: invoice.discount || 0,
        items: invoice.items || [],
        paid_date: invoice.paid_date || null,
        created_at: invoice.created_at || new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      
      const { error: invoiceError } = await supabase
        .from('invoices')
        .upsert(invoicePayload, { onConflict: 'id' });
      
      if (invoiceError) throw invoiceError;
      console.log('✅ Invoice saved to invoices table:', invoice.id);
      
    } else {
      // LocalStorage fallback
      const data = JSON.parse(localStorage.getItem('xm_data') || '{}');
      data.invoices = data.invoices || [];
      
      const index = data.invoices.findIndex(inv => inv.id === invoice.id);
      if (index >= 0) {
        data.invoices[index] = invoice;
      } else {
        data.invoices.push(invoice);
      }
      
      localStorage.setItem('xm_data', JSON.stringify(data));
    }
    
    console.log('Invoice saved:', invoice);
    
  } catch (error) {
    console.error('Error saving invoice:', error);
    throw error;
  }
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

/**
 * Close service modal
 */
function closeServiceModal() {
  const serviceModal = document.getElementById('serviceModal');
  if (serviceModal) {
    serviceModal.classList.add('hidden');
  }
}

/**
 * Open service modal and populate available services
 */
async function openServiceModal() {
  const serviceModal = document.getElementById('serviceModal');
  const serviceContainer = document.getElementById('serviceOptionsContainer');
  
  if (!serviceModal || !serviceContainer) return;
  
  // Get available services and labor rates from shop settings
  const supabase = getSupabaseClient();
  const shopId = getCurrentShopId();
  let services = [];
  let laborRates = [];
  
  try {
    if (supabase && shopId) {
      const { data } = await supabase.from('data').select('settings').eq('shop_id', shopId).single();
      if (data?.settings?.services && Array.isArray(data.settings.services)) {
        services = data.settings.services;
      }
      if (data?.settings?.labor_rates && Array.isArray(data.settings.labor_rates)) {
        laborRates = data.settings.labor_rates;
      }
    }
  } catch (e) {
    // Fallback to localStorage
    const localData = JSON.parse(localStorage.getItem('xm_data') || '{}');
    services = (localData.settings?.services) || [];
    laborRates = (localData.settings?.labor_rates) || [];
  }
  
  // Populate service options
  serviceContainer.innerHTML = '';
  
  if (services.length === 0) {
    serviceContainer.innerHTML = '<p style="color: var(--muted); font-size: 0.9rem;">No services configured in your shop settings.</p>';
    serviceModal.classList.remove('hidden');
    return;
  }
  
  services.forEach(service => {
    const btn = document.createElement('button');
    btn.className = 'btn';
    btn.type = 'button';
    btn.style.textAlign = 'left';
    btn.style.display = 'flex';
    btn.style.justifyContent = 'space-between';
    btn.style.alignItems = 'center';
    
    const serviceName = service.name || service;
    const isLaborBased = service.pricing_type === 'labor_based';
    
    let priceDisplay = '';
    if (isLaborBased) {
      const rate = laborRates.find(r => r.name === service.labor_rate_name);
      const hourlyRate = rate ? rate.rate : 0;
      const calculatedPrice = (service.labor_hours || 0) * hourlyRate;
      // Show only service hours and total (no hourly breakdown)
      priceDisplay = `${service.labor_hours}hr • $${calculatedPrice.toFixed(2)}`;
    } else {
      priceDisplay = `${parseFloat(service.price || 0).toFixed(2)}`;
    }
    
    const typeIcon = isLaborBased ? '⏱️' : '💵';
    
    btn.innerHTML = `
      <span>${typeIcon} ${serviceName}</span>
      <span style="font-size: 0.9rem; color: var(--muted);">${priceDisplay}</span>
    `;
    
    btn.addEventListener('click', () => handleServiceSelection(service, serviceModal, laborRates));
    serviceContainer.appendChild(btn);
  });
  
  serviceModal.classList.remove('hidden');
}

/**
 * Handle service selection
 */
async function handleServiceSelection(service, serviceModal, laborRates = []) {
  try {
    // Get current job from partsModalHandler
    const partsHandler = window.partsModalHandler;
    if (!partsHandler || !partsHandler.currentJob) {
      showNotification('No job selected', 'error');
      return;
    }
    
    const currentJob = partsHandler.currentJob;
    const appointment = allAppointments.find(a => a.id === currentJob.appointment_id);
    
    if (!appointment) {
      showNotification('Appointment not found', 'error');
      return;
    }
    
    // Instead of adding immediately, open the Customize Service flow so user can add parts/labor or skip.
    const serviceName = service.name || service;
    const isLaborBased = service.pricing_type === 'labor_based';
    
    if (isLaborBased) {
      // Labor-based service: prepare draft and immediately add to invoice (skip customize flow)
      const rate = laborRates.find(r => r.name === service.labor_rate_name);
      const hourlyRate = rate ? rate.rate : 0;
      const calculatedPrice = (service.labor_hours || 0) * hourlyRate;
      newServiceDraft = { 
        name: serviceName, 
        price: calculatedPrice, 
        type: 'service', 
        qty: 1,
        pricing_type: 'labor_based',
        labor_hours: service.labor_hours,
        labor_rate_name: service.labor_rate_name,
        labor_rate: hourlyRate
      };

      // Auto-add labor-based service to invoice immediately, matching Skip & Add flow
      try {
        closeServiceModal();
        const partsHandler = window.partsModalHandler;
        // Ensure there's a job for this appointment
        let existingJob = allJobs.find(j => j.appointment_id === appointment.id);
        if (!existingJob) {
          const jobId = `job_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
          existingJob = {
            id: jobId,
            appointment_id: appointment.id,
            shop_id: appointment.shop_id,
            status: 'in_progress',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            service: newServiceDraft.name,
            service_price: newServiceDraft.price,
            type: 'service',
            qty: newServiceDraft.qty || 1,
            year: appointment.vehicle_year || '',
            make: appointment.vehicle_make || '',
            model: appointment.vehicle_model || ''
          };
          allJobs.push(existingJob);
          await saveJobs(allJobs);
        } else {
          existingJob.service = existingJob.service || newServiceDraft.name;
          existingJob.service_price = existingJob.service_price || newServiceDraft.price;
          existingJob.year = existingJob.year || appointment.vehicle_year || '';
          existingJob.make = existingJob.make || appointment.vehicle_make || '';
          existingJob.model = existingJob.model || appointment.vehicle_model || '';
          await saveJobs(allJobs);
        }
        if (partsHandler) partsHandler.currentJob = existingJob;

        // Add to invoice (split into service + labor rows)
        let invoice = await getInvoiceForAppointment(appointment.id);
        if (!invoice) invoice = await createInvoiceForAppointment(appointment);
        if (invoice) {
          invoice.items = invoice.items || [];
          const alreadyHasService = invoice.items.some(item => item.type === 'service' && item.name === newServiceDraft.name);
          if (!alreadyHasService) {
            const serviceId = `item_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            const laborId = `item_${Date.now()}_${Math.random().toString(36).substr(2, 9)}_labor`;
            invoice.items.push({
              id: serviceId,
              name: newServiceDraft.name,
              type: 'service',
              qty: 1,
              price: 0,
              pricing_type: 'labor_based',
              linkedItemId: laborId
            });
            invoice.items.push({
              id: laborId,
              name: `Labor - ${newServiceDraft.name}`,
              type: 'labor',
              qty: newServiceDraft.labor_hours || 1,
              price: newServiceDraft.labor_rate || 0,
              linkedItemId: serviceId
            });
            await saveInvoice(invoice);
            try { window.dispatchEvent(new CustomEvent('partAdded', { detail: { jobId: existingJob.id } })); } catch(e) {}
            showNotification(`Service "${newServiceDraft.name}" added to invoice`, 'success');
          }
        }
      } catch (e) {
        console.error('[jobs] Auto-add labor-based service failed:', e);
        showNotification('Failed to add labor-based service automatically', 'error');
      }

      newServiceDraft = null;
      // Done — skip the customize modal
      return;
    } else {
      // Flat rate service: simple object
      const servicePrice = parseFloat(service.price) || 0;
      newServiceDraft = { name: serviceName, price: servicePrice, type: 'service', qty: 1, pricing_type: 'flat' };
    }

    // Close service modal and any parts modal overlay, then show the add-flow modal
    closeServiceModal();
    const partsModal = document.getElementById('partsModal');
    const partsOverlay = document.getElementById('partsModalOverlay');
    if (partsModal) partsModal.classList.add('hidden');
    if (partsOverlay) partsOverlay.style.display = 'none';

    const flow = document.getElementById('serviceAddFlowModal');
    if (flow) flow.classList.remove('hidden');
  } catch (error) {
    console.error('Error adding service:', error);
    showNotification('Failed to add service', 'error');
  }
}

/**
 * Setup jobs page
 */
async function setupJobs() {
  console.log('💼 Setting up Jobs page...');
  
  // Check if current user is staff (not admin) - use async version to get role from Supabase
  const currentUser = await getCurrentUserWithRole();
  isStaffUser = currentUser.role === 'staff';
  currentStaffUserId = currentUser.id;
  currentStaffAuthId = currentUser.auth_id || currentUser.id; // Store auth_id for consistent lookups
  // Set global for other components to check
  window.xm_isStaffUser = isStaffUser;
  // Also store in session for partsModalHandler
  try {
    const session = JSON.parse(localStorage.getItem('xm_session') || '{}');
    session.role = currentUser.role;
    localStorage.setItem('xm_session', JSON.stringify(session));
  } catch (e) {}
  console.log(`👤 User role: ${currentUser.role || 'unknown'}, isStaffUser: ${isStaffUser}`);
  
  // For staff: hide supplier and dealer sections in parts modal
  if (isStaffUser) {
    const supplierSection = document.getElementById('supplierQuickLinks');
    if (supplierSection) supplierSection.style.display = 'none';
    
    // Also hide the "Add Parts Manually" button - staff can only add from inventory or add service
    const addPartsManuallyBtn = document.getElementById('openAddPartsFromFinder');
    if (addPartsManuallyBtn) addPartsManuallyBtn.style.display = 'none';
  }
  
  // Load all data
  allJobs = await loadJobs();
  allAppointments = await loadAppointments();
  // Expose appointments for other components that may need to lookup vehicle info
  window.allAppointments = allAppointments;
  allUsers = await loadUsers();
  // Hydrate jobs with vehicle info from their appointment
  for (const job of allJobs) {
    const appt = allAppointments.find(a => a.id === job.appointment_id);
    if (appt) {
      job.year = appt.vehicle_year || '';
      job.make = appt.vehicle_make || '';
      job.model = appt.vehicle_model || '';
    }
  }
  // Load shop_staff for richer assignment lookup
  try {
    const supabase = getSupabaseClient();
    const shopId = getCurrentShopId();
    if (supabase && shopId) {
      const { data: sdata, error: sErr } = await supabase.from('shop_staff').select('*').eq('shop_id', shopId);
      if (!sErr && Array.isArray(sdata)) allStaff = sdata;
    }
  } catch (e) { console.warn('Could not load shop_staff for assignments', e); }
  
  console.log(`✅ Loaded ${allJobs.length} jobs`);
  console.log(`✅ Loaded ${allAppointments.length} appointments`);
  console.log(`✅ Loaded ${allUsers.length} users`);
  
  // Render tables
  await renderJobs();
  // Setup sortable headers for jobs
  setupJobSorting();
  
  // Event listeners
  const closePartsBtn = document.getElementById('closeParts');
  if (closePartsBtn) closePartsBtn.addEventListener('click', closePartsModal);
  
  const closeAddPartsBtn = document.getElementById('closeAddParts');
  if (closeAddPartsBtn) closeAddPartsBtn.addEventListener('click', closeAddPartsModal);
  
  const addToInvoiceBtn = document.getElementById('addToInvoiceBtn');
  if (addToInvoiceBtn) addToInvoiceBtn.addEventListener('click', handleAddToInvoice);
  
  const addLaborBtn = document.getElementById('addLaborBtn');
  if (addLaborBtn) addLaborBtn.addEventListener('click', handleAddLabor);
  
  const skipLaborBtn = document.getElementById('skipLaborBtn');
  if (skipLaborBtn) skipLaborBtn.addEventListener('click', handleSkipLabor);

  // New: hook up the unified labor confirm button (jobs.html uses `labConfirm`)
  const labConfirmBtn = document.getElementById('labConfirm');
  if (labConfirmBtn) labConfirmBtn.addEventListener('click', handleAddLabor);

  // Toggle custom rate input when select changes
  const labRateSel = document.getElementById('labRateSel');
  const labRateCustom = document.getElementById('labRateCustom');
  if (labRateSel) {
    labRateSel.addEventListener('change', () => {
      // when a preset is selected, populate the numeric rate input with its value
      try {
        const sel = labRateSel;
        const custom = labRateCustom;
        if (sel && sel.value && custom) {
          const rate = parseFloat(sel.selectedOptions[0]?.dataset?.rate) || 0;
          custom.value = rate || '';
          custom.style.display = '';
        }
      } catch (e) { console.warn('[labRateSel change] error', e); }
    });
  }
  
  const searchPartsBtn = document.getElementById('pfSearch');
  if (searchPartsBtn) {
    searchPartsBtn.addEventListener('click', () => {
      showNotification('Parts search coming soon!', 'info');
    });
  }
  
  const openAddPartsFromFinderBtn = document.getElementById('openAddPartsFromFinder');
  if (openAddPartsFromFinderBtn) {
    openAddPartsFromFinderBtn.addEventListener('click', () => {
      // Close the find parts modal and open partPricingModal
      closePartsModal();
      // Get the job ID from the parts modal that was just closed
      const jobId = document.getElementById('partsModal').dataset.jobId;
      if (jobId) {
        const job = allJobs.find(j => j.id === jobId);
        if (job) {
          // Use vehicle info from job object
          const vehicle = job.year && job.make && job.model
            ? `${job.year} ${job.make} ${job.model}`
            : null;
          const pricingModal = window.partPricingModal || window.xm_partPricingModal;
          if (pricingModal) {
            const manualPart = {
              manual_entry: true,
              name: '',
              part_name: '',
              part_number: '',
              id: 'manual'
            };
            pricingModal.show(manualPart, job.id, vehicle);
          }
        }
      }
    });
  }
  
  const openAddServiceFromFinderBtn = document.getElementById('openAddServiceFromFinder');
  if (openAddServiceFromFinderBtn) {
    openAddServiceFromFinderBtn.addEventListener('click', openServiceModal);
  }
  
  const closeLabBtn = document.getElementById('labClose');
  if (closeLabBtn) {
    closeLabBtn.addEventListener('click', () => {
      const laborModal = document.getElementById('laborModal');
      const overlay = document.getElementById('laborModalOverlay');
      if (overlay) overlay.style.display = 'none';
      if (laborModal) {
        laborModal.classList.add('hidden');
        laborModal.style.display = 'none';
      }
    });
  }
  
  // Close labor modal when clicking overlay
  const laborOverlay = document.getElementById('laborModalOverlay');
  if (laborOverlay) {
    laborOverlay.addEventListener('click', (e) => {
      if (e.target === laborOverlay) {
        const laborModal = document.getElementById('laborModal');
        laborOverlay.style.display = 'none';
        if (laborModal) {
          laborModal.classList.add('hidden');
          laborModal.style.display = 'none';
        }
      }
    });
  }
  
  const removeJobBtn = document.getElementById('removeJobBtn');
  if (removeJobBtn) removeJobBtn.addEventListener('click', () => handleRemoveJob(false));
  
  const removeJobApptBtn = document.getElementById('removeJobApptBtn');
  if (removeJobApptBtn) removeJobApptBtn.addEventListener('click', () => handleRemoveJob(true));
  
  const cancelRemoveBtn = document.getElementById('cancelRemoveBtn');
  if (cancelRemoveBtn) cancelRemoveBtn.addEventListener('click', closeRemoveModal);
  // Listen for partAdded event to refresh invoice items
  window.addEventListener('partAdded', async (e) => {
    const jobId = e.detail.jobId;
    const job = allJobs.find(j => j.id === jobId);
    const appt = allAppointments.find(a => a.id === job?.appointment_id);
    if (job && appt) {
      // Optionally reload invoice and re-render modal/items
      const invoice = await getInvoiceForAppointment(appt.id);
      if (invoice) {
        // You may want to call openInvoiceModal(invoice) or a similar function to update the UI
        // Example:
        if (typeof openInvoiceModal === 'function') {
          openInvoiceModal(invoice);
        }
      }
    }
  });
  // Expose invoice helper functions to global scope for other components
  window.addPartToInvoice = addPartToInvoice;
  window.addLaborToInvoice = addLaborToInvoice;
  window.getInvoiceForAppointment = getInvoiceForAppointment;
  window.openLaborModal = openLaborModal;
  window.openServiceModal = openServiceModal;
  window.closeServiceModal = closeServiceModal;

  function initJobsDOMBindings() {
    // New service draft used across the add-flow (module-level `newServiceDraft` is used)

    // 'Other' input + confirm in service modal (inline add)
    const otherServiceInput = document.getElementById('otherServiceInput');
    const otherServiceConfirm = document.getElementById('otherServiceConfirm');
    const otherServiceRate = document.getElementById('otherServiceRate');
    console.log('[jobs] DOMContentLoaded: otherServiceInput=', !!otherServiceInput, 'otherServiceConfirm=', !!otherServiceConfirm, 'otherServiceRate=', !!otherServiceRate);
    if (otherServiceConfirm && otherServiceInput) {
      // When user clicks the checkmark, show a small confirm modal asking whether to save this service.
      otherServiceConfirm.addEventListener('click', async () => {
        const name = otherServiceInput.value.trim();
        const price = parseFloat((otherServiceRate && otherServiceRate.value) || 0) || 0;
        if (!name) { alert('Please enter a service name.'); return; }

        // Append the service in the UI immediately so it appears like regular services
        const serviceContainer = document.getElementById('serviceOptionsContainer');
        if (serviceContainer) {
          const svc = { name, price };
          const btn = document.createElement('button');
          btn.className = 'btn';
          btn.type = 'button';
          btn.style.textAlign = 'left';
          btn.style.display = 'flex';
          btn.style.justifyContent = 'space-between';
          btn.style.alignItems = 'center';
          btn.innerHTML = `\n              <span>${svc.name}</span>\n              <span style="font-size: 0.9rem; color: var(--muted);">$${parseFloat(svc.price||0).toFixed(2)}</span>\n            `;
          btn.addEventListener('click', () => handleServiceSelection(svc, document.getElementById('serviceModal')));
          serviceContainer.appendChild(btn);
        }

        // Prepare draft used by the add-flow (custom/Other is always flat rate)
        newServiceDraft = { name, price, type: 'service', qty: 1, pricing_type: 'flat' };
        // Close service modal and show the save-confirm modal
        document.getElementById('serviceModal').classList.add('hidden');
        const confirmModal = document.getElementById('saveServiceConfirmModal');
        if (confirmModal) {
          confirmModal.classList.remove('hidden');

          // Wire buttons (overwrite previous handlers safely)
          const yes = document.getElementById('saveServiceYesBtn');
          const no = document.getElementById('saveServiceNoBtn');

          yes.onclick = async () => {
            try {
              await addServiceToSettings(name, price);
              showNotification('Service saved to settings', 'success');
            } catch (e) {
              console.error('[jobs] Failed to save service:', e);
              showNotification('Failed to save service', 'error');
            }
            confirmModal.classList.add('hidden');
            document.getElementById('serviceAddFlowModal').classList.remove('hidden');
          };

          no.onclick = () => {
            // Do not persist, just proceed to add-flow
            confirmModal.classList.add('hidden');
            document.getElementById('serviceAddFlowModal').classList.remove('hidden');
          };
        } else {
          // Fallback: directly open add-flow
          document.getElementById('serviceAddFlowModal').classList.remove('hidden');
        }
      });
    }

    // Close new service modal (kept for compatibility)
    window.closeNewServiceModal = function() {
      document.getElementById('newServiceModal').classList.add('hidden');
      document.getElementById('serviceModal').classList.remove('hidden');
    };

    // Close service add flow modal
    window.closeServiceAddFlowModal = function() {
      document.getElementById('serviceAddFlowModal').classList.add('hidden');
    };

    // Handle Add in new service modal (legacy path)
    const confirmAddServiceBtn = document.getElementById('confirmAddServiceBtn');
    if (confirmAddServiceBtn) {
      confirmAddServiceBtn.addEventListener('click', async () => {
        const name = document.getElementById('newServiceName').value.trim();
        const rate = parseFloat(document.getElementById('newServiceRate').value);
        if (!name || isNaN(rate)) {
          alert('Please enter a service name and rate.');
          return;
        }
        newServiceDraft = { name, price: rate, type: 'service', qty: 1, pricing_type: 'flat' };
        document.getElementById('newServiceModal').classList.add('hidden');
        document.getElementById('serviceAddFlowModal').classList.remove('hidden');
      });
    }

    // Handle Add Parts to Service
    document.getElementById('addPartsToServiceBtn').addEventListener('click', async () => {
      // If newServiceDraft exists, create a job for it first
      if (newServiceDraft) {
        const partsHandler = window.partsModalHandler;
        const appointment = partsHandler?.currentJob?.appointment_id ? allAppointments.find(a => a.id === partsHandler.currentJob.appointment_id) : null;
        if (appointment) {
          // Check for existing job for this appointment (regardless of service)
          let existingJob = allJobs.find(j => j.appointment_id === appointment.id);
          if (!existingJob) {
            // Create job object with vehicle info
            const jobId = `job_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            existingJob = {
              id: jobId,
              appointment_id: appointment.id,
              shop_id: appointment.shop_id,
              status: 'in_progress',
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
              service: newServiceDraft.name,
              service_price: newServiceDraft.price,
              type: 'service',
              qty: newServiceDraft.qty || 1,
              year: appointment.vehicle_year || '',
              make: appointment.vehicle_make || '',
              model: appointment.vehicle_model || ''
            };
            allJobs.push(existingJob);
            await saveJobs(allJobs);
          } else {
            // Always update vehicle info and service info on existing job
            existingJob.year = appointment.vehicle_year || '';
            existingJob.make = appointment.vehicle_make || '';
            existingJob.model = appointment.vehicle_model || '';
            // If service is not set, set it
            if (!existingJob.service) existingJob.service = newServiceDraft.name;
            if (!existingJob.service_price) existingJob.service_price = newServiceDraft.price;
            await saveJobs(allJobs);
          }
          if (partsHandler) partsHandler.currentJob = existingJob;
          // Add service to invoice only if not already present
          let invoice = await getInvoiceForAppointment(appointment.id);
          if (!invoice) {
            invoice = await createInvoiceForAppointment(appointment);
          }
          if (invoice) {
            invoice.items = invoice.items || [];
            const alreadyHasService = invoice.items.some(item => item.type === 'service' && item.name === newServiceDraft.name);
            if (!alreadyHasService) {
              // Check if labor-based service - split into 2 rows
              if (newServiceDraft.pricing_type === 'labor_based') {
                // Generate IDs for linking
                const serviceId = `item_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
                const laborId = `item_${Date.now()}_${Math.random().toString(36).substr(2, 9)}_labor`;
                
                // Row 1: Service name with no price
                invoice.items.push({
                  id: serviceId,
                  name: newServiceDraft.name,
                  type: 'service',
                  qty: 1,
                  price: 0,
                  pricing_type: 'labor_based',
                  linkedItemId: laborId
                });
                // Row 2: Labor row with hours as qty and rate as price
                invoice.items.push({
                  id: laborId,
                  name: `Labor - ${newServiceDraft.name}`,
                  type: 'labor',
                  qty: newServiceDraft.labor_hours || 1,
                  price: newServiceDraft.labor_rate || 0,
                  linkedItemId: serviceId
                });
              } else {
                // Flat rate service
                invoice.items.push({
                  id: `item_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                  name: newServiceDraft.name,
                  price: newServiceDraft.price,
                  qty: newServiceDraft.qty || 1,
                  type: 'service'
                });
              }
              await saveInvoice(invoice);
              try { window.dispatchEvent(new CustomEvent('partAdded', { detail: { jobId: existingJob.id } })); } catch(e) {}
            }
          }
          newServiceDraft = null;
        }
      }
      // Open partPricingModal for custom part
      if (window.partPricingModal) {
        document.getElementById('serviceAddFlowModal').classList.add('hidden');
        // Pass jobId and vehicle to modal
        const jobId = window.partsModalHandler?.currentJob?.id || null;
        let vehicle = null;
        // Try to get vehicle from currentJob
        const jobObj = window.partsModalHandler?.currentJob || (jobId ? allJobs.find(j => j.id === jobId) : null);
        if (jobObj) {
          vehicle = jobObj.year && jobObj.make && jobObj.model
            ? `${jobObj.year} ${jobObj.make} ${jobObj.model}`
            : (jobObj.vehicle || '');
        }
        // Fallback to appointment lookup
        if ((!vehicle || !String(vehicle).trim()) && jobObj && jobObj.appointment_id && window.allAppointments) {
          const appt = (window.allAppointments || []).find(a => a.id === jobObj.appointment_id);
          if (appt) vehicle = (appt.vehicle_year && appt.vehicle_make && appt.vehicle_model)
            ? `${appt.vehicle_year} ${appt.vehicle_make} ${appt.vehicle_model}`
            : (appt.vehicle || '');
        }
        window.partPricingModal.show({ manual_entry: true, name: '', part_name: '', part_number: '', id: 'manual' }, jobId, vehicle || null);
      } else {
        document.getElementById('serviceAddFlowModal').classList.add('hidden');
      }
    });
    // Run bindings immediately (invoked after function ends)

    // Handle Add Labor to Service
    document.getElementById('addLaborToServiceBtn').addEventListener('click', async () => {
      // If newServiceDraft exists, create a job for it first
      if (newServiceDraft) {
        const partsHandler = window.partsModalHandler;
        const appointment = partsHandler?.currentJob?.appointment_id ? allAppointments.find(a => a.id === partsHandler.currentJob.appointment_id) : null;
        if (appointment) {
          // Reuse existing job for this appointment if present, otherwise create a new one
          let existingJob = allJobs.find(j => j.appointment_id === appointment.id);
          if (!existingJob) {
            const jobId = `job_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            const newJob = {
              id: jobId,
              appointment_id: appointment.id,
              shop_id: appointment.shop_id,
              status: 'in_progress',
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
              service: newServiceDraft.name,
              service_price: newServiceDraft.price,
              type: 'service',
              qty: newServiceDraft.qty || 1
            };
            allJobs.push(newJob);
            await saveJobs(allJobs);
            existingJob = newJob;
          } else {
            // Ensure service and vehicle info are set on existing job
            existingJob.service = existingJob.service || newServiceDraft.name;
            existingJob.service_price = existingJob.service_price || newServiceDraft.price;
            existingJob.year = existingJob.year || appointment.vehicle_year || '';
            existingJob.make = existingJob.make || appointment.vehicle_make || '';
            existingJob.model = existingJob.model || appointment.vehicle_model || '';
            await saveJobs(allJobs);
          }
          if (partsHandler) partsHandler.currentJob = existingJob;
          // Add service to invoice immediately
          let invoice = await getInvoiceForAppointment(appointment.id);
          if (!invoice) {
            invoice = await createInvoiceForAppointment(appointment);
          }
          if (invoice) {
            invoice.items = invoice.items || [];
            // Check if labor-based service - split into 2 rows
            if (newServiceDraft.pricing_type === 'labor_based') {
              // Generate IDs for linking
              const serviceId = `item_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
              const laborId = `item_${Date.now()}_${Math.random().toString(36).substr(2, 9)}_labor`;
              
              // Row 1: Service name with no price
              invoice.items.push({
                id: serviceId,
                name: newServiceDraft.name,
                type: 'service',
                qty: 1,
                price: 0,
                pricing_type: 'labor_based',
                linkedItemId: laborId
              });
              // Row 2: Labor row with hours as qty and rate as price
              invoice.items.push({
                id: laborId,
                name: `Labor - ${newServiceDraft.name}`,
                type: 'labor',
                qty: newServiceDraft.labor_hours || 1,
                price: newServiceDraft.labor_rate || 0,
                linkedItemId: serviceId
              });
            } else {
              // Flat rate service
              invoice.items.push({
                id: `item_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                name: newServiceDraft.name,
                price: newServiceDraft.price,
                qty: newServiceDraft.qty || 1,
                type: 'service'
              });
            }
            await saveInvoice(invoice);
            try { window.dispatchEvent(new CustomEvent('partAdded', { detail: { jobId: existingJob.id } })); } catch(e) {}
          }
          newServiceDraft = null;
        }
      }
      // Hide the service flow and open the labor modal using openLaborModal so it populates rates
      document.getElementById('serviceAddFlowModal').classList.add('hidden');
      const partsHandler = window.partsModalHandler;
      const jobId = partsHandler?.currentJob?.id || null;
      try {
        await openLaborModal(jobId);
      } catch (e) {
        console.error('[jobs] Failed to open labor modal:', e);
        const overlay = document.getElementById('laborModalOverlay'); if (overlay) overlay.style.display = 'block';
        const lm = document.getElementById('laborModal'); if (lm) { lm.classList.remove('hidden'); lm.style.display = 'block'; }
      }
    });

    // Handle Skip & Add to Invoice
    document.getElementById('skipToInvoiceBtn').addEventListener('click', async () => {
      if (!newServiceDraft) return;
      // Add the new service to the current job's invoice
      const partsHandler = window.partsModalHandler;
      if (!partsHandler || !partsHandler.currentJob) {
        alert('No job selected');
        return;
      }
      const currentJob = partsHandler.currentJob;
      const appointment = allAppointments.find(a => a.id === currentJob.appointment_id);
      if (!appointment) {
        alert('Appointment not found');
        return;
      }
      let invoice = await getInvoiceForAppointment(appointment.id);
      if (!invoice) {
        invoice = await createInvoiceForAppointment(appointment);
      }
      if (!invoice) {
        alert('Could not create invoice');
        return;
      }
      invoice.items = invoice.items || [];
      
      // Check if this is a labor-based service - split into 2 rows
      if (newServiceDraft.pricing_type === 'labor_based') {
        // Generate IDs for linking
        const serviceId = `item_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const laborId = `item_${Date.now()}_${Math.random().toString(36).substr(2, 9)}_labor`;
        
        // Row 1: Service name with no price (qty 1)
        const serviceItem = {
          id: serviceId,
          name: newServiceDraft.name,
          type: 'service',
          qty: 1,
          price: 0, // No price on service row for labor-based
          pricing_type: 'labor_based',
          linkedItemId: laborId // Link to labor item
        };
        invoice.items.push(serviceItem);
        
        // Row 2: Labor row with hours as qty and rate as price
        const laborItem = {
          id: laborId,
          name: `Labor - ${newServiceDraft.name}`,
          type: 'labor',
          qty: newServiceDraft.labor_hours || 1,
          price: newServiceDraft.labor_rate || 0,
          linkedItemId: serviceId // Link back to service item
        };
        invoice.items.push(laborItem);
      } else {
        // Flat rate service - add as single item
        invoice.items.push({ ...newServiceDraft, id: `item_${Date.now()}_${Math.random().toString(36).substr(2, 9)}` });
      }
      
      await saveInvoice(invoice);
      try { window.dispatchEvent(new CustomEvent('partAdded', { detail: { jobId: partsHandler?.currentJob?.id || null } })); } catch(e) {}
      // Close the flow modal and notify
      closeServiceAddFlowModal();
      showNotification(`Service "${newServiceDraft.name}" added to invoice`, 'success');
      newServiceDraft = null;
    });

  }

  // Run bindings immediately
  initJobsDOMBindings();

  // Start polling for notes updates
  startNotesPolling();
  // Start polling for status updates so other users see live status changes
  if (typeof startStatusPolling === 'function') startStatusPolling();
  // Start polling for invoice changes (services updates)
  startInvoicePolling();

  // Wire up Diagnostics button
  const diagBtn = document.getElementById('openDiagnosticsBtn');
  if (diagBtn) {
    diagBtn.addEventListener('click', () => {
      // Get all active jobs
      const activeJobs = allJobs.filter(j => j.status !== 'completed');
      
      openDiagnosticsModal({
        jobs: activeJobs,
        appointments: allAppointments,
        onClose: (playbook) => {
          if (playbook) {
            console.log('[jobs] Diagnostics closed with playbook:', playbook.title);
            // Refresh the page to show any invoice updates
            renderJobs();
          }
        }
      });
    });
  }

  // Handle Add Service requests originating from the Diagnostics modal
  window.addEventListener('openServiceFromDiagnostics', (e) => {
    try {
      const jobId = e?.detail?.jobId || null;
      let job = e?.detail?.job || null;
      if (!job && jobId) job = allJobs.find(j => j.id === jobId) || null;
      console.log('[jobs] openServiceFromDiagnostics received', { jobId, job });
      if (!job) return;
      if (window.partsModalHandler) window.partsModalHandler.currentJob = job;
      else window.partsModalHandler = { currentJob: job };
      if (typeof openServiceModal === 'function') {
        openServiceModal();
      } else if (typeof window.openServiceModal === 'function') {
        window.openServiceModal();
      } else {
        console.warn('[jobs] openServiceModal not available');
      }
    } catch (ex) { console.error('[jobs] openServiceFromDiagnostics handler failed:', ex); }
  });

  // Expose openServiceModal globally for compatibility with event-based callers
  try { if (typeof openServiceModal === 'function') window.openServiceModal = openServiceModal; } catch(e) {}

  console.log('✅ Jobs page setup complete');
}

// Persist a service preset into settings (data table) from Jobs page
async function addServiceToSettings(name, price) {
  if (!name) throw new Error('Name required');
  try {
    const supabase = getSupabaseClient();
    const shopId = getCurrentShopId();
    if (!supabase || !shopId) throw new Error('Supabase client or shop ID not available');

    // Load current data from Supabase
    const { data, error } = await supabase.from('data').select('*').eq('shop_id', shopId).single();
    if (error && error.code !== 'PGRST116') throw error;

    const settings = (data?.settings) || {};
    settings.services = settings.services || [];
    if (settings.services.some(s => s.name === name)) {
      // Already exists - nothing to do
      return true;
    }

    settings.services.push({ name: name, price: price });

    const payload = {
      shop_id: shopId,
      settings: settings,
      appointments: data?.appointments || [],
      jobs: data?.jobs || [],
      threads: data?.threads || [],
      invoices: data?.invoices || [],
      updated_at: new Date().toISOString()
    };

    const { error: upErr } = await supabase.from('data').upsert(payload, { onConflict: 'shop_id' });
    if (upErr) throw upErr;

    // notify other pages
    window.dispatchEvent(new Event('xm_data_updated'));
    return true;
  } catch (ex) {
    console.error('[jobs] addServiceToSettings failed:', ex);
    throw ex;
  }
}

// === Services Expand & Cortex Integration ===

// Toggle services expand/collapse (if not already defined)
if (typeof window.toggleServicesExpand !== 'function') {
  window.toggleServicesExpand = function(headerEl) {
    const container = headerEl.closest('.services-expandable');
    if (!container) return;
    const list = container.querySelector('.services-list');
    const icon = container.querySelector('.expand-icon');
    if (!list) return;
    
    const isExpanded = list.style.display !== 'none';
    list.style.display = isExpanded ? 'none' : 'block';
    if (icon) icon.style.transform = isExpanded ? 'rotate(0deg)' : 'rotate(180deg)';
  };
}

// Open Cortex modal with pre-filled search for a specific service (if not already defined)
if (typeof window.openCortexForService !== 'function') {
  window.openCortexForService = async function(serviceName) {
    try {
      // Use the already imported openDiagnosticsModal
      openDiagnosticsModal({
        jobs: allJobs.filter(j => j.status !== 'completed'),
        appointments: allAppointments,
        initialSearch: serviceName,
        onClose: () => {
          console.log('[Jobs] Cortex modal closed for service:', serviceName);
          renderJobs(); // Refresh in case changes were made
        }
      });
    } catch (err) {
      console.error('[Jobs] Failed to open Cortex for service:', err);
      alert('Could not open Cortex. Please try again.');
    }
  };
}

// === Services Expand & Cortex Integration ===

// Toggle services expand/collapse (if not already defined)
if (typeof window.toggleServicesExpand !== 'function') {
  window.toggleServicesExpand = function(headerEl) {
    const container = headerEl.closest('.services-expandable');
    if (!container) return;
    const list = container.querySelector('.services-list');
    const icon = container.querySelector('.expand-icon');
    if (!list) return;
    
    const isExpanded = list.style.display !== 'none';
    list.style.display = isExpanded ? 'none' : 'block';
    if (icon) icon.style.transform = isExpanded ? 'rotate(0deg)' : 'rotate(180deg)';
  };
}

// Toggle service dropdown in table rows (if not already defined)
if (typeof window.toggleServiceDropdown !== 'function') {
  window.toggleServiceDropdown = function(wrapperEl, services) {
    // Close any other open dropdowns first
    document.querySelectorAll('.service-dropdown-menu.open').forEach(menu => {
      if (menu.parentElement !== wrapperEl) {
        menu.parentElement.closest('tr')?.classList.remove('dropdown-open');
        menu.remove();
      }
    });

    // Check if dropdown already exists
    let dropdown = wrapperEl.querySelector('.service-dropdown-menu');
    if (dropdown) {
      wrapperEl.closest('tr')?.classList.remove('dropdown-open');
      dropdown.remove();
      return;
    }

    // Add class to parent row for z-index
    wrapperEl.closest('tr')?.classList.add('dropdown-open');

    // Create dropdown
    dropdown = document.createElement('div');
    dropdown.className = 'service-dropdown-menu open';
    dropdown.innerHTML = services.map((svc) => `
      <div class="service-dropdown-item">
        <span class="service-name">${svc}</span>
        <button class="btn small cortex-btn" onclick="event.stopPropagation(); openCortexForService('${svc.replace(/'/g, "\\'")}')">
          <img src="/assets/cortex-mark.png" alt="" style="width:14px;height:14px;">
          Cortex
        </button>
      </div>
    `).join('');

    wrapperEl.appendChild(dropdown);

    // Close dropdown when clicking outside
    const closeHandler = (e) => {
      if (!wrapperEl.contains(e.target)) {
        wrapperEl.closest('tr')?.classList.remove('dropdown-open');
        dropdown.remove();
        document.removeEventListener('click', closeHandler);
      }
    };
    setTimeout(() => document.addEventListener('click', closeHandler), 0);
  };
}

// Open Cortex modal with pre-filled search for a specific service (if not already defined)
if (typeof window.openCortexForService !== 'function') {
  window.openCortexForService = async function(serviceName) {
    try {
      // Use the already imported openDiagnosticsModal
      openDiagnosticsModal({
        jobs: allJobs.filter(j => j.status !== 'completed'),
        appointments: allAppointments,
        initialSearch: serviceName,
        onClose: () => {
          console.log('[Jobs] Cortex modal closed for service:', serviceName);
          renderJobs(); // Refresh in case changes were made
        }
      });
    } catch (err) {
      console.error('[Jobs] Failed to open Cortex for service:', err);
      alert('Could not open Cortex. Please try again.');
    }
  };
}

export { setupJobs, saveJobs };
