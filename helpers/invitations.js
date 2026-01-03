/**
 * helpers/invitations.js
 * Manages shop invitations - notification bell, modal, accept/decline
 */

import { getSupabaseClient } from './supabase.js';
import { createNotification } from './invitations_functions.js';
import { getNotificationIcon, getPriorityBadge } from './shop-notifications.js';

let currentUserAuthId = null;
let currentUserEmail = null;
let pendingInvitations = [];

/**
 * Initialize the invitations system
 * Call this after auth is confirmed
 */
export async function initInvitations() {
  const supabase = getSupabaseClient();
  if (!supabase) {
    console.warn('[Invitations] Supabase not available');
    return;
  }

  try {
    // Get current user's auth info
    const { data: authData } = await supabase.auth.getUser();
    if (!authData?.user) {
      console.warn('[Invitations] No authenticated user');
      return;
    }

    currentUserAuthId = authData.user.id;
    currentUserEmail = authData.user.email?.toLowerCase();

    console.log('[Invitations] Initialized for user:', currentUserEmail);

    // Create notification bell
    createNotificationBell();

    // Fetch and display pending invitations
    await fetchPendingInvitations();

    // Set up polling instead of realtime (every 30 seconds)
    setupPolling();
  } catch (err) {
    console.error('[Invitations] Init error:', err);
  }
}

/**
 * Create the notification bell in the header
 */
function createNotificationBell() {
  // Check if bell already exists first
  if (document.getElementById('invitationBell')) return;

  // On mobile, add to header before burger menu
  // On desktop, add to button container
  const isMobile = window.innerWidth <= 768;
  let header;
  let insertBefore = null;
  
  if (isMobile) {
    // Find the .row container in the header
    header = document.querySelector('header.top .row');
    // We'll insert AFTER the burger menu this time
    const burgerMenu = document.getElementById('menuToggle');
    insertBefore = burgerMenu ? burgerMenu.nextSibling : null;
  } else {
    // Desktop: Insert in the buttons container (last div with Theme/Logout)
    const containers = document.querySelectorAll('header.top .row > div');
    header = containers[containers.length - 1]; // Last div
    insertBefore = document.getElementById('themeToggle');
  }
  
  if (!header) {
    console.warn('[Invitations] Could not find header container');
    return;
  }

  const bellBtn = document.createElement('button');
  bellBtn.id = 'invitationBell';
  bellBtn.setAttribute('aria-label', 'View notifications');
  
  // Different styles for mobile vs desktop
  if (isMobile) {
    bellBtn.style.cssText = `
      position: absolute;
      right: 60px;
      top: 50%;
      transform: translateY(-50%);
      display: none;
      background: none;
      border: none;
      cursor: pointer;
      padding: 8px;
      align-items: center;
      justify-content: center;
    `;
  } else {
    bellBtn.style.cssText = `
      position: relative;
      display: none;
      background: none;
      border: none;
      cursor: pointer;
      padding: 8px;
      align-items: center;
      justify-content: center;
    `;
  }
  
  bellBtn.innerHTML = `
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="display: block; transform: translateY(4px);">
      <path d="M18 8C18 6.4087 17.3679 4.88258 16.2426 3.75736C15.1174 2.63214 13.5913 2 12 2C10.4087 2 8.88258 2.63214 7.75736 3.75736C6.63214 4.88258 6 6.4087 6 8C6 15 3 17 3 17H21C21 17 18 15 18 8Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M13.73 21C13.5542 21.3031 13.3019 21.5547 12.9982 21.7295C12.6946 21.9044 12.3504 21.9965 12 21.9965C11.6496 21.9965 11.3054 21.9044 11.0018 21.7295C10.6982 21.5547 10.4458 21.3031 10.27 21" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
    <span id="invitationBadge" class="notification-badge" style="display:none;position:absolute;top:0;right:0;background:#ef4444;color:white;border-radius:50%;min-width:18px;height:18px;font-size:11px;font-weight:bold;display:flex;align-items:center;justify-content:center;padding:0 4px;box-shadow:0 2px 4px rgba(0,0,0,0.2);">0</span>
  `;

  bellBtn.addEventListener('click', openInvitationsModal);

  if (isMobile) {
    // On mobile, just append to header (will use absolute positioning)
    header.appendChild(bellBtn);
    console.log('[Invitations] Bell added to mobile header with absolute positioning');
  } else if (insertBefore && insertBefore.parentNode === header) {
    header.insertBefore(bellBtn, insertBefore);
    console.log(`[Invitations] Bell added on desktop before`, insertBefore.id);
  } else {
    header.appendChild(bellBtn);
    console.log(`[Invitations] Bell added at end`);
  }
}

/**
 * Fetch pending invitations AND notifications from database
 */
async function fetchPendingInvitations() {
  const supabase = getSupabaseClient();
  if (!supabase || !currentUserAuthId) {
    console.warn('[Invitations] Cannot fetch - missing supabase or auth_id');
    return;
  }

  try {
    console.log('[Invitations] Fetching invitations for auth_id:', currentUserAuthId, 'email:', currentUserEmail);
    
    // Fetch ALL invitations (not just pending)
    const { data, error } = await supabase
      .from('shop_invitations')
      .select('*')
      .or(`invited_auth_id.eq.${currentUserAuthId},invited_email.ilike.${currentUserEmail}`)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[Invitations] Error fetching invitations:', error);
      throw error;
    }

    // Manually fetch shop and inviter details for each invitation
    const invitationsWithDetails = [];
    for (const inv of (data || [])) {
      const invWithDetails = { ...inv };
      
      // Fetch shop details
      if (inv.shop_id) {
        const { data: shopData } = await supabase
          .from('shops')
          .select('id, name, logo')
          .eq('id', inv.shop_id)
          .single();
        invWithDetails.shops = shopData;
      }
      
      // Fetch inviter details
      if (inv.invited_by_user_id) {
        const { data: inviterData} = await supabase
          .from('users')
          .select('first_name, last_name, email')
          .eq('id', inv.invited_by_user_id)
          .single();
        invWithDetails.invited_by = inviterData;
      }
      
      invitationsWithDetails.push(invWithDetails);
    }

    // Fetch ALL notifications (not just unread)
    let notificationsData = [];
    try {
      const { data: notifData, error: notifError } = await supabase
        .from('notifications')
        .select('*')
        .eq('user_id', currentUserAuthId)
        .order('created_at', { ascending: false });

      if (notifError) {
        // Only log error if it's not a "table doesn't exist" error
        if (!notifError.message?.includes('does not exist')) {
          console.error('[Invitations] Error fetching notifications:', notifError);
        }
      } else {
        notificationsData = notifData || [];
      }
    } catch (notifErr) {
      // Silently handle if notifications table doesn't exist yet
      console.log('[Invitations] Notifications table not available yet');
    }

    // Combine invitations and notifications into pendingInvitations array
    // Filter to show only pending/unread in badge, but keep all for display
    const allItems = [
      ...invitationsWithDetails.map(inv => ({ ...inv, itemType: 'invitation' })),
      ...(notificationsData || []).map(notif => ({ ...notif, itemType: 'notification' }))
    ];
    
    // Count only pending invitations and unread notifications for badge
    const pendingCount = allItems.filter(item => 
      (item.itemType === 'invitation' && item.status === 'pending') ||
      (item.itemType === 'notification' && !item.is_read)
    ).length;
    
    pendingInvitations = allItems;
    updateNotificationBadge(pendingCount);

    console.log(`[Invitations] Found ${pendingInvitations.length} total items (${pendingCount} unread)`, pendingInvitations);
  } catch (err) {
    console.error('[Invitations] Error fetching invitations:', err);
  }
}

/**
 * Update the notification badge count and visibility
 */
function updateNotificationBadge(count) {
  const badge = document.getElementById('invitationBadge');
  const bell = document.getElementById('invitationBell');
  if (!badge || !bell) return;

  // If count not provided, calculate it
  if (count === undefined) {
    count = pendingInvitations.filter(item => 
      (item.itemType === 'invitation' && item.status === 'pending') ||
      (item.itemType === 'notification' && !item.is_read)
    ).length;
  }
  
  if (count > 0) {
    // Show bell and badge - DON'T override display, let .btn class handle it
    bell.style.display = 'inline-flex'; // Match the .btn class default
    badge.textContent = count > 9 ? '9+' : count;
    badge.style.display = 'flex';
  } else {
    // Hide bell completely when no notifications
    bell.style.display = 'none';
    badge.style.display = 'none';
  }
}

/**
 * Set up polling to refresh notifications every 30 seconds
 */
function setupPolling() {
  // Poll every 30 seconds
  setInterval(async () => {
    console.log('[Invitations] Polling for new notifications...');
    await fetchPendingInvitations();
  }, 30000); // 30 seconds
  
  console.log('[Invitations] Polling active (every 30 seconds)');
}

/**
 * Open the invitations modal
 */
function openInvitationsModal() {
  let modal = document.getElementById('invitationsModal');
  
  if (!modal) {
    modal = createInvitationsModal();
    document.body.appendChild(modal);
  }

  renderInvitationsList();
  modal.classList.remove('hidden');
}

/**
 * Create the invitations modal HTML
 */
function createInvitationsModal() {
  const modal = document.createElement('div');
  modal.id = 'invitationsModal';
  modal.className = 'modal-overlay hidden';
  modal.innerHTML = `
    <div class="modal-content card" style="max-width: 600px; margin: 0 auto; max-height: 90vh; display: flex; flex-direction: column;">
      <div style="display: flex; justify-content: space-between; align-items: center; padding: 16px; border-bottom: 1px solid var(--line);    modal.innerHTML = `
    <div class="modal-content card" style="max-width: 600px; margin: 0 auto; max-height: 90vh; display: flex; flex-direction: column;">
      <div style="display: flex; justify-content: space-between; align-items: center; padding: 16px; border-bottom: 1px solid var(--line);">
        <h2 style="margin: 0;">Notifications</h2>
        <div style="display:flex; gap:8px; align-items:center;">
          <button id="markAllInvitationsRead" class="btn" style="font-size:13px;">Mark all read</button>
          <button id="closeInvitationsModal" class="btn" aria-label="Close">✕</button>
        </div>
      </div>
      <div id="invitationsListContainer" style="max-height: 400px; overflow-y: auto; padding: 16px;">
        <div class="muted">Loading notifications...</div>
      </div>
    </div>
  `;

  // Close button handler
  modal.querySelector('#closeInvitationsModal').addEventListener('click', () => {
    modal.classList.add('hidden');
  });

  // Click outside to close
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.classList.add('hidden');
    }
  });

  // Mark all read handler
  modal.querySelector('#markAllInvitationsRead').addEventListener('click', async () => {
    try {
      // Find unread notifications from the pendingInvitations list
      const unread = pendingInvitations.filter(i => i.itemType === 'notification' && !i.is_read);
      for (const n of unread) {
        // reuse existing function to mark each as read
        await markNotificationAsRead(n.id);
      }
    } catch (err) {
      console.error('[Invitations] Error marking all notifications read:', err);
      alert('Failed to mark all notifications as read. Please try again.');
s="muted">No notifications.</div>';
    return;
  }

  container.innerHTML = pendingInvitations.map(item => {
    if (item.itemType === 'invitation') {
      // Render invitation card
      const shopName = item.shops?.name || 'Unknown Shop';
      const shopLogo = (item.shops?.logo && item.shops.logo.trim() !== '') 
        ? item.shops.logo 
        : 'assets/logo.png';
      const inviterName = item.invited_by 
        ? `${item.invited_by.first_name || ''} ${item.invited_by.last_name || ''}`.trim() || item.invited_by.email
        : 'Someone';
      const roleDisplay = (item.role || 'staff').replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase());
      const dateStr = new Date(item.created_at).toLocaleDateString();
      const isPending = item.status === 'pending';
      const isAccepted = item.status === 'accepted';
      const isDeclined = item.status === 'declined';
      const isDismissed = item.status === 'dismissed';
      
      // Grey out non-pending invitations
      const cardStyle = !isPending ? 'opacity: 0.6; background: var(--line);' : '';
      
      // Status badge
      let statusBadge = '';
      if (isAccepted) {
        statusBadge = '<span style="display: inline-flex; align-items: center; gap: 4px; padding: 4px 10px; background: #dcfce7; color: #065f46; border-radius: 12px; font-size: 12px; font-weight: 600;">✓ Accepted</span>';
      } else if (isDeclined) {
        statusBadge = '<span style="display: inline-flex; align-items: center; gap: 4px; padding: 4px 10px; background: #fee2e2; color: #991b1b; border-radius: 12px; font-size: 12px; font-weight: 600;">✗ Declined</span>';
      } else if (isDismissed) {
        statusBadge = '<span style="display: inline-flex; align-items: center; gap: 4px; padding: 4px 10px; background: var(--line); color: var(--muted); border-radius: 12px; font-size: 12px; font-weight: 600;">Dismissed</span>';
      }

      return `
        <div class="card" style="margin-bottom: 8px; padding: 10px; ${cardStyle}">
          <div style="display: flex; gap: 10px; align-items: start;">
            <img src="${shopLogo}" alt="${shopName}" style="width: 36px; height: 36px; border-radius: 6px; object-fit: contain; background: var(--card); border: 1px solid var(--line); padding: 3px;">
            <div style="flex: 1;">
              <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 2px;">
                <h3 style="margin: 0; font-size: 14px;">${shopName}</h3>
                ${statusBadge}
              </div>
              <p style="margin: 0; color: var(--muted); font-size: 13px;">
                ${inviterName} invited you to join as <strong>${roleDisplay}</strong>
              </p>
              <p style="margin: 2px 0 0 0; color: var(--muted); font-size: 11px;">Invited on ${dateStr}</p>
            </div>
          </div>
          ${isPending ? `
          <div style="display: flex; gap: 6px; margin-top: 8px;">
            <button class="btn primary" data-action="accept" data-invite-id="${item.id}">Accept</button>
            <button class="btn" data-action="decline" data-invite-id="${item.id}">Decline</button>
            <button class="btn" data-action="dismiss" data-invite-id="${item.id}" style="margin-left: auto;">Dismiss</button>
          </div>
          ` : ''}
        </div>
      `;
    } else {
      // Render notification card
      const dateStr = new Date(item.created_at).toLocaleDateString();
      const timeStr = new Date(item.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const isRead = item.is_read;
      
      // Grey out read notifications
      const cardStyle = isRead ? 'opacity: 0.6; background: var(--line);' : '';
      
      // Get icon based on category/type
      const { icon, iconBg } = getNotificationIcon(item.category || 'invitation', item.type);
      
      // Get priority badge if priority exists
      let priorityBadge = '';
      if (item.priority && item.priority !== 'normal') {
        const priority = getPriorityBadge(item.priority);
        priorityBadge = `<span style="display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; background: ${priority.bg}; color: ${priority.color}; border-radius: 12px; font-size: 11px; font-weight: 600; margin-left: 8px;">${priority.text}</span>`;
      }

      return `
        <div class="card" style="margin-bottom: 8px; padding: 10px; ${cardStyle}">
          <div style="display: flex; gap: 10px; align-items: start;">
            <div style="width: 36px; height: 36px; border-radius: 50%; background: ${iconBg}; display: flex; align-items: center; justify-content: center; font-size: 20px;">
              ${icon}
            </div>
            <div style="flex: 1;">
              <div style="display: flex; align-items: center; gap: 4px;">
                <h3 style="margin: 0 0 2px 0; font-size: 14px;">${item.title}</h3>
                ${priorityBadge}
              </div>
              <p style="margin: 0; color: var(--muted); font-size: 13px;">${item.message}</p>
              <p style="margin: 2px 0 0 0; color: var(--muted); font-size: 11px;">${dateStr} at ${timeStr}</p>
            </div>
          </div>
          ${!isRead ? `
          <div style="display: flex; gap: 6px; margin-top: 8px; justify-content: flex-end;">
            <button class="btn" data-action="mark-read" data-notif-id="${item.id}">Mark as Read</button>
          </div>
          ` : ''}
        </div>
      `;
    }
  }).join('');

  // Wire up buttons
  container.querySelectorAll('button[data-action]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const action = btn.getAttribute('data-action');
      const inviteId = btn.getAttribute('data-invite-id');
      const notifId = btn.getAttribute('data-notif-id');
      
      if (action === 'accept') {
        await acceptInvitation(inviteId);
      } else if (action === 'decline') {
        await declineInvitation(inviteId);
      } else if (action === 'dismiss') {
        await dismissInvitation(inviteId);
      } else if (action === 'mark-read') {
        await markNotificationAsRead(notifId);
      }
    });
  });
}

/**
 * Accept an invitation
 */
async function acceptInvitation(inviteId) {
  const supabase = getSupabaseClient();
  if (!supabase || !currentUserAuthId) return;

  try {
    // Get the invitation details
    const invitation = pendingInvitations.find(inv => inv.id === inviteId && inv.itemType === 'invitation');
    if (!invitation) {
      alert('Invitation not found');
      return;
    }

    // Get current user info to populate shop_staff
    const { data: authData } = await supabase.auth.getUser();
    const userEmail = authData?.user?.email || currentUserEmail;

    // Check if user already exists in shop_staff for this shop (safety check)
    const { data: existingStaff } = await supabase
      .from('shop_staff')
      .select('id')
      .eq('auth_id', currentUserAuthId)
      .eq('shop_id', invitation.shop_id)
      .limit(1);

    if (existingStaff && existingStaff.length > 0) {
      alert('You are already a member of this shop.');
      await declineInvitation(inviteId); // Clean up the invitation
      return;
    }

    // Get user's name from existing shop_staff or users record
    let firstName = '';
    let lastName = '';

    const { data: staffRecord } = await supabase
      .from('shop_staff')
      .select('first_name, last_name')
      .eq('auth_id', currentUserAuthId)
      .limit(1);

    if (staffRecord && staffRecord.length > 0) {
      firstName = staffRecord[0].first_name || '';
      lastName = staffRecord[0].last_name || '';
    }

    // If not found in shop_staff, try users table
    if (!firstName && !lastName) {
      const { data: userRecord } = await supabase
        .from('users')
        .select('first_name, last_name, first, last')
        .eq('id', currentUserAuthId)
        .limit(1);

      if (userRecord && userRecord.length > 0) {
        firstName = userRecord[0].first_name || userRecord[0].first || '';
        lastName = userRecord[0].last_name || userRecord[0].last || '';
      }
    }

    // Create new shop_staff entry
    const { error: insertError } = await supabase
      .from('shop_staff')
      .insert({
        shop_id: invitation.shop_id,
        auth_id: currentUserAuthId,
        email: userEmail,
        first_name: firstName,
        last_name: lastName,
        role: invitation.role || 'staff',
        hourly_rate: 0
      });

    if (insertError) throw insertError;

    // Mark invitation as accepted
    const { error: updateError } = await supabase
      .from('shop_invitations')
      .update({ status: 'accepted', updated_at: new Date().toISOString() })
      .eq('id', inviteId);

    if (updateError) throw updateError;

    // Create notification for the inviter
    const inviterName = `${firstName} ${lastName}`.trim() || userEmail;
    const shopName = invitation.shops?.name || 'your shop';
    await createNotification(
      supabase,
      invitation.invited_by_user_id,
      'invitation_accepted',
      'Invitation Accepted',
      `${inviterName} has accepted your invitation to join ${shopName}.`,
      invitation.id,
      { shop_id: invitation.shop_id, invitee_email: userEmail }
    );

    // Show success banner
    const notifBanner = document.createElement('div');
    notifBanner.className = 'notification';
    notifBanner.textContent = `Successfully joined ${invitation.shops?.name || 'the shop'}!`;
    notifBanner.style.background = '#10b981';
    document.body.appendChild(notifBanner);
    setTimeout(() => notifBanner.remove(), 3000);

    // Refresh invitations list
    await fetchPendingInvitations();
    renderInvitationsList();

    // Reload page to update shop switcher
    setTimeout(() => {
      window.location.reload();
    }, 1000);

  } catch (err) {
    console.error('[Invitations] Error accepting invitation:', err);
    alert('Failed to accept invitation. Please try again.');
  }
}

/**
 * Decline an invitation
 */
async function declineInvitation(inviteId) {
  const supabase = getSupabaseClient();
  if (!supabase) return;

  try {
    // Get the invitation details before declining
    const invitation = pendingInvitations.find(inv => inv.id === inviteId && inv.itemType === 'invitation');
    
    const { error } = await supabase
      .from('shop_invitations')
      .update({ status: 'declined', updated_at: new Date().toISOString() })
      .eq('id', inviteId);

    if (error) throw error;

    // Create notification for the inviter (if invitation found)
    if (invitation) {
      const { data: authData } = await supabase.auth.getUser();
      const userEmail = authData?.user?.email || currentUserEmail;
      
      // Get user name
      let userName = userEmail;
      const { data: userRecord } = await supabase
        .from('users')
        .select('first_name, last_name')
        .eq('id', currentUserAuthId)
        .limit(1);
      
      if (userRecord && userRecord.length > 0) {
        const firstName = userRecord[0].first_name || '';
        const lastName = userRecord[0].last_name || '';
        userName = `${firstName} ${lastName}`.trim() || userEmail;
      }
      
      const shopName = invitation.shops?.name || 'your shop';
      await createNotification(
        supabase,
        invitation.invited_by_user_id,
        'invitation_declined',
        'Invitation Declined',
        `${userName} has declined your invitation to join ${shopName}.`,
        invitation.id,
        { shop_id: invitation.shop_id, invitee_email: userEmail }
      );
    }

    // Show notification banner
    const notifBanner = document.createElement('div');
    notifBanner.className = 'notification';
    notifBanner.textContent = 'Invitation declined.';
    notifBanner.style.background = '#10b981';
    document.body.appendChild(notifBanner);
    setTimeout(() => notifBanner.remove(), 3000);

    // Refresh invitations list
    await fetchPendingInvitations();
    renderInvitationsList();

  } catch (err) {
    console.error('[Invitations] Error declining invitation:', err);
    alert('Failed to decline invitation. Please try again.');
  }
}

/**
 * Dismiss an invitation (mark as read without accepting/declining)
 */
async function dismissInvitation(inviteId) {
  const supabase = getSupabaseClient();
  if (!supabase) return;

  try {
    const { error } = await supabase
      .from('shop_invitations')
      .update({ status: 'dismissed', updated_at: new Date().toISOString() })
      .eq('id', inviteId);

    if (error) throw error;

    // Refresh invitations list (no alert needed for dismiss)
    await fetchPendingInvitations();
    renderInvitationsList();

    // Close modal if no more invitations
    if (pendingInvitations.length === 0) {
      const modal = document.getElementById('invitationsModal');
      if (modal) modal.classList.add('hidden');
    }

  } catch (err) {
    console.error('[Invitations] Error dismissing invitation:', err);
    alert('Failed to dismiss invitation. Please try again.');
  }
}

/**
 * Mark a notification as read
 */
async function markNotificationAsRead(notifId) {
  const supabase = getSupabaseClient();
  if (!supabase) return;

  try {
    const { error } = await supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('id', notifId);

    if (error) throw error;

    // Refresh invitations/notifications list
    await fetchPendingInvitations();
    renderInvitationsList();

  } catch (err) {
    console.error('[Invitations] Error marking notification as read:', err);
    alert('Failed to mark notification as read. Please try again.');
  }
}
