// ============================================================================
// INIT-GLOBALS.JS - Sets up global functions BEFORE multi-tenant.js loads
// ============================================================================
// This script MUST be loaded BEFORE multi-tenant.js in your HTML
// Include in HTML as: <script src="init-globals.js"></script>
// ORDER: supabase → init-globals → multi-tenant → modules
// ============================================================================

// Define globals that multi-tenant.js expects
// These will be overridden by module imports if needed, but provide fallbacks

window.readLS = function(k, f) {
  try {
    const v = localStorage.getItem(k);
    return v ? JSON.parse(v) : (f ?? null);
  } catch (e) { 
    return f ?? null; 
  }
};

window.writeLS = function(k, v) {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch (e) { }
};

// Expose LS keys globally
window.LS = {
  users: 'xm_users',
  shops: 'xm_shops', 
  session: 'xm_session',
  data: 'xm_data',
  seeded: 'xm_seeded'
};

console.log('✅ Global functions initialized (init-globals.js)');
