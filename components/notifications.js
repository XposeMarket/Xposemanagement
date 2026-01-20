// notifications.js
// Persistent notification panel logic for bell/dropdown UI

// Notification state (in-memory for now)
let notificationList = [];

// Add a notification to the panel
export function addNotificationToPanel({ type = 'info', message, data = {}, timestamp = null }) {
  const notif = {
    id: crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2),
    type,
    message,
    data,
    timestamp: timestamp || new Date().toISOString(),
    read: false
  };
  notificationList.unshift(notif);
  renderNotificationPanel();
}

// Render the notification panel (dropdown)
export function renderNotificationPanel() {
  let panel = document.getElementById('notificationPanel');
  if (!panel) {
    // Create panel if it doesn't exist
    panel = document.createElement('div');
    panel.id = 'notificationPanel';
    panel.className = 'notification-panel';
    document.body.appendChild(panel);
  }
  // Build header with actions and counts
  const total = notificationList.length;
  const unread = notificationList.filter(n => !n.read).length;
  const readCount = total - unread;

  if (total === 0) {
    panel.innerHTML = `
      <div class="notification-panel-header">
        <strong>Notifications</strong>
      </div>
      <div class="notification-empty">No notifications</div>
    `;
    return;
  }
  // Inject responsive styles for the panel (only once)
  if (!document.getElementById('notif-panel-styles')) {
    console.log('notifications.js: injecting notif-panel-styles');
    const s = document.createElement('style');
    s.id = 'notif-panel-styles';
    s.innerHTML = `
      .notification-panel { font-family: inherit; background: var(--bg); color: var(--text); border: 1px solid var(--line); box-shadow: 0 6px 18px rgba(0,0,0,0.08); width:320px; }
      .notification-panel .notification-panel-header{ display:flex; align-items:center; justify-content:space-between; padding:8px 12px; border-bottom:1px solid var(--line); }
      .notification-panel .desktop-actions{ display:flex; gap:8px; align-items:center; }
      .notification-panel .mobile-overflow{ display:none; align-items:center; }
      .notification-panel .btn.small{ padding:6px 8px; font-size:13px; }
      @media (max-width: 600px) {
        .notification-panel{ width:100%; max-width:420px; }
        .notification-panel .desktop-actions{ display:none; }
        .notification-panel .mobile-overflow{ display:inline-flex; }
      }
      .notif-action-modal-overlay{ position:fixed; inset:0; background: rgba(0,0,0,0.45); display:flex; align-items:center; justify-content:center; z-index:9999; }
      .notif-action-modal{ background:var(--bg); padding:16px; border-radius:8px; min-width:220px; box-shadow:0 8px 24px rgba(0,0,0,0.2); }
      .notif-action-modal .modal-actions{ display:flex; gap:8px; justify-content:flex-end; margin-top:8px; }
    `;
    document.head.appendChild(s);
  }

  // Action buttons: desktop actions plus a mobile overflow button
  const headerHtml = `
    <div class="notification-panel-header">
      <div><strong>Notifications</strong> <small style="color:var(--muted);">(${unread} unread)</small></div>
      <div style="display:flex;align-items:center;gap:8px;">
        <div class="desktop-actions">
          <button id="notifMarkAllRead" class="btn small">Mark all read</button>
          <button id="notifClearRead" class="btn small">Clear all read (${readCount})</button>
        </div>
        <button id="notifOverflow" class="mobile-overflow btn small" aria-haspopup="dialog" aria-expanded="false">&hellip;</button>
      </div>
    </div>
  `;
  console.log('notifications.js: rendering header, unread=', unread, 'readCount=', readCount);
  const listHtml = notificationList.map(n => `
      <div class="notification-card ${n.read ? 'read' : ''} ${n.type}" data-id="${n.id}">
        <div class="notif-msg">${n.message}</div>
        <div class="notif-meta">${new Date(n.timestamp).toLocaleString()}</div>
      </div>
    `).join('');

  panel.innerHTML = headerHtml + `<div style="max-height:360px;overflow:auto;">` + listHtml + `</div>`;

  // Wire up header buttons
  const markBtn = document.getElementById('notifMarkAllRead');
  if (markBtn) markBtn.addEventListener('click', () => { markAllNotificationsRead(); });
  const clearBtn = document.getElementById('notifClearRead');
  if (clearBtn) clearBtn.addEventListener('click', () => { clearAllReadNotifications(); });

  // Mobile overflow button -> opens modal with the same actions
  const overflowBtn = document.getElementById('notifOverflow');
  if (overflowBtn) {
    overflowBtn.addEventListener('click', () => { openNotifActionModal(); });
  }
}

// Mark all as read
export function markAllNotificationsRead() {
  notificationList.forEach(n => n.read = true);
  renderNotificationPanel();
}

// Permanently remove all notifications marked as read
export function clearAllReadNotifications() {
  const before = notificationList.length;
  notificationList = notificationList.filter(n => !n.read);
  const after = notificationList.length;
  console.log(`Notifications: cleared ${before - after} read items`);
  renderNotificationPanel();
}

// Expose for global use
window.addNotificationToPanel = addNotificationToPanel;
window.renderNotificationPanel = renderNotificationPanel;
window.markAllNotificationsRead = markAllNotificationsRead;
window.clearAllReadNotifications = clearAllReadNotifications;

// Create and open a simple modal containing the two action buttons (used on mobile)
function openNotifActionModal(){
  // don't open duplicate
  if (document.getElementById('notifActionModalOverlay')) return;

  const overlay = document.createElement('div');
  overlay.id = 'notifActionModalOverlay';
  overlay.className = 'notif-action-modal-overlay';
  overlay.tabIndex = -1;

  const dlg = document.createElement('div');
  dlg.className = 'notif-action-modal';
  dlg.setAttribute('role','dialog');
  dlg.setAttribute('aria-modal','true');
  dlg.innerHTML = `
    <div style="font-weight:600;margin-bottom:6px;">Notification actions</div>
    <div style="color:var(--muted);">Choose an action for your notifications</div>
    <div class="modal-actions">
      <button id="modalMarkAllRead" class="btn small">Mark all read</button>
      <button id="modalClearRead" class="btn small">Clear all read</button>
      <button id="modalClose" class="btn small">Close</button>
    </div>
  `;

  overlay.appendChild(dlg);
  document.body.appendChild(overlay);

  // listeners
  document.getElementById('modalMarkAllRead').addEventListener('click', () => { markAllNotificationsRead(); closeNotifActionModal(); });
  document.getElementById('modalClearRead').addEventListener('click', () => { clearAllReadNotifications(); closeNotifActionModal(); });
  document.getElementById('modalClose').addEventListener('click', () => { closeNotifActionModal(); });

  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeNotifActionModal(); });

  // ESC to close
  const escHandler = (e) => { if (e.key === 'Escape') closeNotifActionModal(); };
  overlay._escHandler = escHandler;
  window.addEventListener('keydown', escHandler);
}

function closeNotifActionModal(){
  const overlay = document.getElementById('notifActionModalOverlay');
  if (!overlay) return;
  const handler = overlay._escHandler;
  if (handler) window.removeEventListener('keydown', handler);
  overlay.remove();
}
