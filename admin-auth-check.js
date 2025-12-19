/**
 * admin-auth-check.js
 * Standalone authentication check for admin page
 * Loads BEFORE admin.js to ensure user is authenticated
 */

(async function() {
  console.log('🔐 Admin page: Starting authentication check...');
  
  // DEBUGGING: Log everything to see what's happening
  window.__adminDebugLogs = [];
  function debugLog(msg, data) {
    const log = `[${new Date().toISOString()}] ${msg}`;
    console.log(log, data || '');
    window.__adminDebugLogs.push({ msg, data, timestamp: Date.now() });
  }
  
  debugLog('Step 1: Waiting for getSupabaseClient...');
  
  // Wait for Supabase library AND getSupabaseClient to be available
  let getSupabaseClient = null;
  let waitCount = 0;
  const maxWait = 20; // 10 seconds
  
  while (!getSupabaseClient && waitCount < maxWait) {
    // Try to get the function from the global scope
    if (window.getSupabaseClient && typeof window.getSupabaseClient === 'function') {
      getSupabaseClient = window.getSupabaseClient;
      debugLog('Step 2: Found getSupabaseClient in global scope');
      break;
    }
    await new Promise(resolve => setTimeout(resolve, 500));
    waitCount++;
    debugLog(`Step 2: Waiting for getSupabaseClient... (attempt ${waitCount}/${maxWait})`);
  }
  
  if (!getSupabaseClient) {
    debugLog('ERROR: getSupabaseClient not available after waiting', { waitCount, maxWait });
    alert('Authentication system not available. Check console for debug logs.\n\nwindow.__adminDebugLogs has full details.');
    // DON'T redirect - let user see the error
    return;
  }
  
  debugLog('Step 3: Getting Supabase client...');
  
  // Get the Supabase client
  const supabase = getSupabaseClient();
  
  if (!supabase) {
    debugLog('ERROR: Could not get Supabase client', { supabase });
    alert('Could not get Supabase client. Check console for debug logs.\n\nwindow.__adminDebugLogs has full details.');
    // DON'T redirect - let user see the error
    return;
  }
  
  debugLog('Step 4: Supabase client obtained', { hasAuth: !!supabase.auth });
  
  // RETRY LOGIC - Check authentication with retries
  let user = null;
  let retries = 10; // Increased to 10 retries
  
  while (retries > 0 && !user) {
    try {
      debugLog(`Step 5: Auth attempt ${11-retries}/10...`);
      const { data, error } = await supabase.auth.getUser();
      
      debugLog(`Auth attempt ${11-retries} result:`, { 
        hasData: !!data, 
        hasUser: !!data?.user, 
        hasError: !!error,
        errorMsg: error?.message 
      });
      
      if (data?.user) {
        user = data.user;
        debugLog('SUCCESS: User authenticated', { email: user.email, id: user.id });
        break;
      }
      
      if (error) {
        debugLog(`Auth attempt ${11-retries} error:`, error);

        // Auto-clear invalid session when Supabase returns the specific 'missing sub claim' error
        // This prevents an unrecoverable 403 loop caused by a corrupted/old token. Only run once.
        try {
          const msg = String(error?.message || '');
          const status = error?.status || null;
          if (/missing sub claim/i.test(msg) && status === 403 && !window.__adminAuthAutoCleared) {
            debugLog('Detected invalid token (missing sub claim). Redirecting to login.');
            window.__adminAuthAutoCleared = true;
            
            // Sign out from Supabase server-side session
            try {
              if (supabase && supabase.auth && typeof supabase.auth.signOut === 'function') {
                await supabase.auth.signOut();
                debugLog('Signed out from Supabase');
              }
            } catch (e) { debugLog('signOut failed during auto-clear', e); }

            // Remove ALL storage keys to ensure clean slate
            try {
              localStorage.clear();
              sessionStorage.clear();
              debugLog('Cleared all storage');
            } catch (e) { debugLog('Failed clearing storage', e); }

            // Redirect to login (DON'T reload to avoid infinite loop)
            debugLog('Redirecting to login page');
            window.location.href = 'login.html';
            return;
          }
        } catch (e) {
          debugLog('Error while handling missing-sub-claim auto-clear', e);
        }

      } else {
        debugLog(`Auth attempt ${11-retries} - no user yet`);
      }
    } catch (e) {
      debugLog(`Auth attempt ${11-retries} exception:`, { message: e.message, stack: e.stack });
    }
    
    retries--;
    if (retries > 0) {
      debugLog(`Retrying... (${retries} left)`);
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
  
  if (!user) {
    debugLog('Step 6: No user after retries, trying getSession...');
    
    // Try to get session as a last resort
    try {
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      debugLog('Session check result:', { 
        hasData: !!sessionData, 
        hasSession: !!sessionData?.session,
        hasUser: !!sessionData?.session?.user,
        hasError: !!sessionError,
        errorMsg: sessionError?.message
      });
      
      if (sessionData?.session?.user) {
        user = sessionData.session.user;
        debugLog('SUCCESS: Got user from session', { email: user.email, id: user.id });
      }
    } catch (e) {
      debugLog('Session check exception:', { message: e.message, stack: e.stack });
    }
  }
  
  if (!user) {
    debugLog('FINAL ERROR: All authentication methods failed');
    alert('Authentication failed after all attempts.\n\nCheck console: window.__adminDebugLogs\n\nA debug panel is shown so you can inspect logs before redirect.');

    // Render an in-page debug panel so the console won't be immediately cleared by navigation.
    try{
      const overlay = document.createElement('div');
      overlay.style.position = 'fixed';
      overlay.style.left = 0;
      overlay.style.top = 0;
      overlay.style.right = 0;
      overlay.style.bottom = 0;
      overlay.style.background = 'rgba(0,0,0,0.6)';
      overlay.style.zIndex = 99999;
      overlay.style.color = '#111';
      overlay.style.padding = '20px';
      overlay.style.overflow = 'auto';

      const panel = document.createElement('div');
      panel.style.maxWidth = '980px';
      panel.style.margin = '6vh auto';
      panel.style.background = '#fff';
      panel.style.borderRadius = '8px';
      panel.style.padding = '16px';
      panel.style.boxShadow = '0 8px 32px rgba(0,0,0,0.3)';

      const title = document.createElement('h2');
      title.textContent = 'Admin Auth Debug — Authentication failed';
      panel.appendChild(title);

      const msg = document.createElement('p');
      msg.textContent = 'The page could not confirm your authentication. Below are debug logs captured during the attempt.';
      panel.appendChild(msg);

      const pre = document.createElement('pre');
      pre.style.maxHeight = '50vh';
      pre.style.overflow = 'auto';
      pre.style.background = '#f6f8fa';
      pre.style.padding = '8px';
      pre.style.borderRadius = '6px';
      pre.textContent = JSON.stringify(window.__adminDebugLogs || [], null, 2);
      panel.appendChild(pre);

      const btnRow = document.createElement('div');
      btnRow.style.marginTop = '12px';
      btnRow.style.display = 'flex';
      btnRow.style.gap = '8px';

      const retryBtn = document.createElement('button');
      retryBtn.textContent = 'Retry Authentication';
      retryBtn.className = 'btn';
      retryBtn.addEventListener('click', () => { window.location.reload(); });
      btnRow.appendChild(retryBtn);

      const proceedBtn = document.createElement('button');
      proceedBtn.textContent = 'Go to Login';
      proceedBtn.className = 'btn danger';
      proceedBtn.addEventListener('click', () => { window.location.href = 'login.html'; });
      btnRow.appendChild(proceedBtn);

      panel.appendChild(btnRow);
      overlay.appendChild(panel);
      document.body.appendChild(overlay);
    }catch(e){
      // fallback to timed redirect if DOM appending fails
      console.log('=== FULL DEBUG LOG ===');
      console.table(window.__adminDebugLogs);
      setTimeout(() => { window.location.href = 'login.html'; }, 15000);
    }
    return;
  }
  
  debugLog('Step 7: Authentication successful!', { email: user.email });
  console.log('✅ Admin page authentication successful');
  
  // Set the authenticated user for admin.js to use
  window.__adminAuthUser = user;
})();
