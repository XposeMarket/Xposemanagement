/**
 * helpers/validation.js
 * Input validation and sanitization
 */

/**
 * Sanitize string input - remove dangerous characters
 */
function sanitizeString(str) {
  if (!str || typeof str !== 'string') return '';
  
  // Remove HTML tags, script tags, and special chars that could be used for injection
  return str
    .replace(/<[^>]*>/g, '') // Remove HTML tags
    .replace(/[<>"']/g, '') // Remove dangerous chars
    .trim()
    .slice(0, 500); // Limit length
}

/**
 * Validate and sanitize email
 */
function validateEmail(email) {
  if (!email || typeof email !== 'string') {
    return { valid: false, sanitized: '', error: 'Email is required' };
  }
  
  const sanitized = email.toLowerCase().trim();
  const emailRegex = /^[a-zA-Z0-9._+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  
  if (!emailRegex.test(sanitized)) {
    return { valid: false, sanitized: '', error: 'Invalid email format' };
  }
  
  if (sanitized.length > 254) {
    return { valid: false, sanitized: '', error: 'Email too long' };
  }
  
  return { valid: true, sanitized, error: null };
}

/**
 * Validate and sanitize phone number
 */
function validatePhone(phone) {
  if (!phone) {
    return { valid: true, sanitized: '', error: null }; // Phone is optional
  }
  
  if (typeof phone !== 'string') {
    return { valid: false, sanitized: '', error: 'Invalid phone format' };
  }
  
  // Remove all non-numeric characters
  const sanitized = phone.replace(/\D/g, '');
  
  // Check if it's a valid length (10-15 digits for international)
  if (sanitized.length < 10 || sanitized.length > 15) {
    return { valid: false, sanitized: '', error: 'Phone must be 10-15 digits' };
  }
  
  return { valid: true, sanitized, error: null };
}

/**
 * Validate and sanitize name (first/last)
 */
function validateName(name, fieldName = 'Name') {
  if (!name || typeof name !== 'string') {
    return { valid: false, sanitized: '', error: `${fieldName} is required` };
  }
  
  const sanitized = sanitizeString(name);
  
  if (sanitized.length < 1) {
    return { valid: false, sanitized: '', error: `${fieldName} is required` };
  }
  
  if (sanitized.length > 100) {
    return { valid: false, sanitized: '', error: `${fieldName} too long (max 100 characters)` };
  }
  
  // Only allow letters, spaces, hyphens, apostrophes
  if (!/^[a-zA-Z\s'-]+$/.test(sanitized)) {
    return { valid: false, sanitized: '', error: `${fieldName} can only contain letters, spaces, hyphens, and apostrophes` };
  }
  
  return { valid: true, sanitized, error: null };
}

/**
 * Validate and sanitize zipcode
 */
function validateZipcode(zipcode) {
  if (!zipcode) {
    return { valid: true, sanitized: '', error: null }; // Zipcode is optional
  }
  
  if (typeof zipcode !== 'string') {
    return { valid: false, sanitized: '', error: 'Invalid zipcode format' };
  }
  
  const sanitized = zipcode.replace(/\D/g, ''); // Remove non-digits
  
  if (sanitized.length !== 5 && sanitized.length !== 9) {
    return { valid: false, sanitized: '', error: 'Zipcode must be 5 or 9 digits' };
  }
  
  return { valid: true, sanitized, error: null };
}

/**
 * Validate and sanitize VIN (Vehicle Identification Number)
 */
function validateVIN(vin) {
  if (!vin) {
    return { valid: true, sanitized: '', error: null }; // VIN is optional
  }
  
  if (typeof vin !== 'string') {
    return { valid: false, sanitized: '', error: 'Invalid VIN format' };
  }
  
  // VINs are exactly 17 characters, alphanumeric (excluding I, O, Q)
  const sanitized = vin.toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/g, '');
  
  if (sanitized.length !== 17) {
    return { valid: false, sanitized: '', error: 'VIN must be exactly 17 characters' };
  }
  
  return { valid: true, sanitized, error: null };
}

/**
 * Validate and sanitize password
 */
function validatePassword(password) {
  if (!password || typeof password !== 'string') {
    return { valid: false, error: 'Password is required' };
  }
  
  if (password.length < 8) {
    return { valid: false, error: 'Password must be at least 8 characters' };
  }
  
  if (password.length > 128) {
    return { valid: false, error: 'Password too long (max 128 characters)' };
  }
  
  // Check for at least one number and one letter
  if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
    return { valid: false, error: 'Password must contain both letters and numbers' };
  }
  
  return { valid: true, error: null };
}

/**
 * Validate and sanitize shop name
 */
function validateShopName(name) {
  if (!name || typeof name !== 'string') {
    return { valid: false, sanitized: '', error: 'Shop name is required' };
  }
  
  const sanitized = sanitizeString(name);
  
  if (sanitized.length < 2) {
    return { valid: false, sanitized: '', error: 'Shop name must be at least 2 characters' };
  }
  
  if (sanitized.length > 100) {
    return { valid: false, sanitized: '', error: 'Shop name too long (max 100 characters)' };
  }
  
  return { valid: true, sanitized, error: null };
}

/**
 * Validate and sanitize monetary amount
 */
function validateAmount(amount) {
  if (amount === null || amount === undefined || amount === '') {
    return { valid: false, sanitized: 0, error: 'Amount is required' };
  }
  
  const num = parseFloat(amount);
  
  if (isNaN(num)) {
    return { valid: false, sanitized: 0, error: 'Invalid amount' };
  }
  
  if (num < 0) {
    return { valid: false, sanitized: 0, error: 'Amount cannot be negative' };
  }
  
  if (num > 1000000) {
    return { valid: false, sanitized: 0, error: 'Amount too large (max $1,000,000)' };
  }
  
  // Round to 2 decimal places
  const sanitized = Math.round(num * 100) / 100;
  
  return { valid: true, sanitized, error: null };
}

/**
 * Validate date string
 */
function validateDate(dateStr) {
  if (!dateStr) {
    return { valid: false, error: 'Date is required' };
  }
  
  const date = new Date(dateStr);
  
  if (isNaN(date.getTime())) {
    return { valid: false, error: 'Invalid date format' };
  }
  
  // Check if date is reasonable (not more than 100 years in past or 10 years in future)
  const now = new Date();
  const hundredYearsAgo = new Date(now.getFullYear() - 100, 0, 1);
  const tenYearsFromNow = new Date(now.getFullYear() + 10, 11, 31);
  
  if (date < hundredYearsAgo || date > tenYearsFromNow) {
    return { valid: false, error: 'Date out of valid range' };
  }
  
  return { valid: true, error: null };
}

/**
 * Sanitize object for database insertion
 * Recursively sanitizes all string values in an object
 */
function sanitizeObject(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  
  const sanitized = {};
  
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string') {
      sanitized[key] = sanitizeString(value);
    } else if (Array.isArray(value)) {
      sanitized[key] = value.map(item => 
        typeof item === 'string' ? sanitizeString(item) : sanitizeObject(item)
      );
    } else if (typeof value === 'object' && value !== null) {
      sanitized[key] = sanitizeObject(value);
    } else {
      sanitized[key] = value;
    }
  }
  
  return sanitized;
}

export {
  sanitizeString,
  sanitizeObject,
  validateEmail,
  validatePhone,
  validateName,
  validateZipcode,
  validateVIN,
  validatePassword,
  validateShopName,
  validateAmount,
  validateDate
};
