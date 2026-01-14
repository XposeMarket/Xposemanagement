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

  // Action buttons: Mark all read (existing) and Clear all read (new)
  const headerHtml = `
    <div class="notification-panel-header" style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;border-bottom:1px solid var(--line);">
      <div><strong>Notifications</strong> <small style="color:var(--muted);">(${unread} unread)</small></div>
      <div style="display:flex;gap:8px;align-items:center;">
        <button id="notifMarkAllRead" class="btn small">Mark all read</button>
        <button id="notifClearRead" class="btn small">Clear all read (${readCount})</button>
      </div>
    </div>
  `;

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
