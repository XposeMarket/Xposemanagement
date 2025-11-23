/**
 * admin-supabase-init.js
 * Initialize Supabase client for admin page
 */

(function() {
  console.log('🔧 Initializing Supabase for admin page...');
  
  // Supabase configuration
  const SUPABASE_URL = 'https://hxwufjzyhtwveyxbkkya.supabase.co';
  const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh4d3Vmanp5aHR3dmV5eGJra3lhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjI3MjU0MjAsImV4cCI6MjA3ODMwMTQyMH0.nN7MGoYyqwhonOSPBJlFEZoZrOEAIRP79l43FZK5nh8';
  
  // Wait for Supabase library to load
  let attempts = 0;
  const maxAttempts = 20;
  
  const initInterval = setInterval(() => {
    if (window.supabase && window.supabase.createClient) {
      clearInterval(initInterval);
      
      try {
        // Initialize the client
        const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
          auth: {
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: true
          }
        });
        
        // Store globally
        window._supabaseClient = client;
        window.getSupabaseClient = () => window._supabaseClient;
        
        console.log('✅ Supabase client initialized for admin page');
      } catch (e) {
        console.error('❌ Failed to initialize Supabase:', e);
      }
    } else {
      attempts++;
      if (attempts >= maxAttempts) {
        clearInterval(initInterval);
        console.error('❌ Supabase library not loaded after', maxAttempts, 'attempts');
      }
    }
  }, 100);
})();
