/**
 * helpers/uuid.js
 * UUID generation with polyfill for crypto.randomUUID()
 */

/**
 * Generate a UUID v4
 * Falls back to polyfill if crypto.randomUUID() is not available
 */
export function getUUID() {
  // Use native crypto.randomUUID() if available
  if (typeof crypto !== 'undefined' && 
      typeof crypto.randomUUID === 'function') {
    try {
      return crypto.randomUUID();
    } catch (e) {
      console.warn('crypto.randomUUID() failed, using polyfill:', e);
    }
  }
  
  // Polyfill fallback
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// Also make it available globally for convenience
if (typeof window !== 'undefined') {
  window.getUUID = getUUID;
}
