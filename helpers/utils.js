/**
 * utils.js - Helper Utilities
 * Common utility functions used across the CRM
 */

/**
 * Get element by ID
 */
export function byId(id) {
  return document.getElementById(id);
}

/**
 * Get today's date in ISO format (YYYY-MM-DD)
 */
export function todayISO() {
  return new Date().toISOString().split('T')[0];
}

/**
 * Format money to 2 decimal places
 */
export function fmtMoney(n) {
  return Number(n || 0).toFixed(2);
}

/**
 * Add CSS for invoices styling
 */
export function addInvoiceCSS() {
  if (document.getElementById('invoiceStyles')) return;
  
  const style = document.createElement('style');
  style.id = 'invoiceStyles';
  style.textContent = `
    .invoice-item {
      display: grid;
      grid-template-columns: 1fr auto auto;
      gap: 1rem;
      padding: 1rem;
      border-bottom: 1px solid #e0e0e0;
      align-items: center;
    }
    
    .invoice-item:hover {
      background-color: #f9f9f9;
    }
    
    .invoice-total {
      font-weight: bold;
      color: #2c3e50;
      font-size: 1.1rem;
    }
    
    .invoice-status {
      padding: 0.25rem 0.75rem;
      border-radius: 4px;
      font-size: 0.875rem;
      font-weight: 500;
    }
    
    .invoice-status.paid {
      background-color: #d4edda;
      color: #155724;
    }
    
    .invoice-status.pending {
      background-color: #fff3cd;
      color: #856404;
    }
    
    .invoice-status.overdue {
      background-color: #f8d7da;
      color: #721c24;
    }
  `;
  
  document.head.appendChild(style);
}

/**
 * Format currency
 */
export function formatCurrency(amount) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD'
  }).format(amount);
}

/**
 * Format date
 */
export function formatDate(dateString) {
  if (!dateString) return '';
  const date = new Date(dateString);
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  }).format(date);
}

/**
 * Format a time string (HH:MM or ISO) to 12-hour like "2:30 PM".
 */
export function formatTime12(timeStr) {
  if (!timeStr) return '';
  try {
    if (/(am|pm)$/i.test(timeStr) || /AM|PM/.test(timeStr)) return timeStr;
    const parts = String(timeStr).split(':');
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
    const d = new Date(timeStr);
    if (!isNaN(d)) return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });
  } catch (e) {}
  return String(timeStr);
}

/**
 * Check if date is overdue
 */
export function isOverdue(dueDate) {
  if (!dueDate) return false;
  return new Date(dueDate) < new Date();
}

/**
 * Debounce function
 */
export function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

/**
 * Deep clone object
 */
export function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

/**
 * Capitalize string
 */
export function capitalize(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

/**
 * Validate email
 */
export function isValidEmail(email) {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(email);
}
