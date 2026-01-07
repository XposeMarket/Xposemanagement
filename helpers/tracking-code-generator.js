/**
 * Tracking Code Generator
 * 
 * Generates simple, human-friendly tracking codes for appointments
 * Format: ABC-1234 (3 letters + 4 numbers)
 */

/**
 * Generate a random tracking code
 * @returns {string} Format: ABC-1234
 */
function generateTrackingCode() {
  // Generate 3 random uppercase letters (excluding confusing ones: I, O, Q)
  const letters = 'ABCDEFGHJKLMNPRSTUVWXYZ';
  let code = '';
  
  for (let i = 0; i < 3; i++) {
    code += letters.charAt(Math.floor(Math.random() * letters.length));
  }
  
  code += '-';
  
  // Generate 4 random numbers
  for (let i = 0; i < 4; i++) {
    code += Math.floor(Math.random() * 10);
  }
  
  return code;
}

/**
 * Validate a tracking code format
 * Accepts both formats:
 *   - XX-1234 (2 letters, hyphen, 4 numbers) - legacy format
 *   - ABC-1234 (3 letters, hyphen, 4 numbers) - new format
 * @param {string} code 
 * @returns {boolean}
 */
function validateTrackingCode(code) {
  if (!code || typeof code !== 'string') return false;
  
  // Accept 2-letter or 3-letter format: XX-1234 or ABC-1234
  const pattern = /^[A-Z]{2,3}-\d{4}$/;
  return pattern.test(code.toUpperCase());
}

/**
 * Normalize tracking code (uppercase, trim)
 * @param {string} code 
 * @returns {string}
 */
function normalizeTrackingCode(code) {
  if (!code) return '';
  return code.trim().toUpperCase();
}

// Export for Node.js
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    generateTrackingCode,
    validateTrackingCode,
    normalizeTrackingCode
  };
}

// Export for browser
if (typeof window !== 'undefined') {
  window.trackingCodeGenerator = {
    generateTrackingCode,
    validateTrackingCode,
    normalizeTrackingCode
  };
}
