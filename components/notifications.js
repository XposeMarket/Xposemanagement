// notifications.js
// Persistent notification panel logic for bell/dropdown UI

// Notification state (in-memory for now)
const notificationList = [];

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
  panel.innerHTML = notificationList.length
    ? notificationList.map(n => `
      <div class="notification-card ${n.read ? 'read' : ''} ${n.type}">
        <div class="notif-msg">${n.message}</div>
        <div class="notif-meta">${new Date(n.timestamp).toLocaleString()}</div>
      </div>
    `).join('')
    : '<div class="notification-empty">No notifications</div>';
}

// Mark all as read
export function markAllNotificationsRead() {
  notificationList.forEach(n => n.read = true);
  renderNotificationPanel();
}

// Expose for global use
window.addNotificationToPanel = addNotificationToPanel;
window.renderNotificationPanel = renderNotificationPanel;
window.markAllNotificationsRead = markAllNotificationsRead;
