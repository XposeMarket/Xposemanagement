/**
 * helpers/supabase.js
 * Supabase client initialization
 */

// Supabase configuration
const SUPABASE_URL = 'https://hxwufjzyhtwveyxbkkya.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh4d3Vmanp5aHR3dmV5eGJra3lhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjI3MjU0MjAsImV4cCI6MjA3ODMwMTQyMH0.nN7MGoYyqwhonOSPBJlFEZoZrOEAIRP79l43FZK5nh8';

/**
 * Initialize Supabase client lazily
 * This function gets called the first time supabase is accessed
 */
function getSupabaseClient() {
  // Check if already initialized
  if (window._supabaseClient) {
    return window._supabaseClient;
  }

  // Initialize if vendor library is available
  if (typeof window !== 'undefined' && window.supabase && window.supabase.createClient) {
    try {
      const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
      window._supabaseClient = client;
      console.log('✅ Supabase client initialized');
      return client;
    } catch (e) {
      console.warn('Supabase initialization failed:', e);
      return null;
    }
  }

  // Vendor library not available yet — start a one-time watcher to initialize when ready
  if (!window._supabaseInitWatcher) {
    let attempts = 0;
    const maxAttempts = 20; // ~4 seconds at 200ms interval
    window._supabaseInitWatcher = setInterval(() => {
      attempts += 1;
      try {
        if (window.supabase && window.supabase.createClient) {
          const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
          window._supabaseClient = client;
          console.log('✅ Supabase client initialized (delayed)');
          clearInterval(window._supabaseInitWatcher);
          window._supabaseInitWatcher = null;
        } else if (attempts >= maxAttempts) {
          // Stop trying after a short period
          clearInterval(window._supabaseInitWatcher);
          window._supabaseInitWatcher = null;
          console.debug('Supabase vendor library not found after polling');
        }
      } catch (err) {
        console.debug('Supabase init watcher error:', err);
        clearInterval(window._supabaseInitWatcher);
        window._supabaseInitWatcher = null;
      }
    }, 200);
  }

  // Return null for now — caller can retry later or rely on deferred initialization
  return null;
}

// Create a proxy that initializes on first access
const supabase = new Proxy({}, {
  get(target, prop) {
    const client = getSupabaseClient();
    if (!client) return undefined;
    return client[prop];
  }
});

// Also expose the getter function
export { supabase, getSupabaseClient };
