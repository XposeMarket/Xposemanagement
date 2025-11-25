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

  // Vendor library not available yet. Only warn once to avoid noisy logs.
  if (!getSupabaseClient._warned) {
    console.warn('⚠️ Supabase vendor library not loaded yet');
    getSupabaseClient._warned = true;
  }
  return null;
}

/**
 * Wait for the UMD vendor library to load and initialize the client.
 * Returns a Promise that resolves to the supabase client or null if timeout.
 */
async function waitForSupabaseClient(timeout = 5000, interval = 150) {
  const start = Date.now();
  // Fast-path if already available
  const sync = getSupabaseClient();
  if (sync) return sync;

  return new Promise((resolve) => {
    const iv = setInterval(() => {
      const client = getSupabaseClient();
      if (client) {
        clearInterval(iv);
        resolve(client);
        return;
      }
      if (Date.now() - start > timeout) {
        clearInterval(iv);
        resolve(null);
      }
    }, interval);
  });
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
export { supabase, getSupabaseClient, waitForSupabaseClient };
