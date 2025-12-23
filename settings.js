// settings.js
// Helper wrappers for terminal settings page
const API_URL = window.API_URL || 'https://xpose-stripe-server.vercel.app/api';

function getAuthToken(){
  try{
    const s = JSON.parse(localStorage.getItem('xm_session') || '{}');
    // common shape may include access_token or token
    return s?.access_token || s?.token || null;
  }catch(e){ return null; }
}

// Lightweight loader that follows the recommended pattern and calls
// the existing renderer functions in terminal-registration-component.js
async function loadTerminalSettings_viaApi(){
  const container = document.getElementById('terminal-settings-section');
  if(!container) return;

  // try to determine shop id from existing global helpers
  let shopId = null;
  try{
    if(window._supabaseClient){
      const sup = window._supabaseClient;
      const { data: userRes } = await sup.auth.getUser();
      shopId = userRes?.data?.user?.current_shop_id || userRes?.data?.user?.default_shop_id || null;
    }
  }catch(e){ /* ignore */ }

  try{
    const token = getAuthToken();
    const headers = { 'Content-Type': 'application/json' };
    if(token) headers['Authorization'] = `Bearer ${token}`;

    const url = shopId ? `${API_URL}/terminal/status/${shopId}` : `${API_URL}/terminal/status`;
    const resp = await fetch(url, { headers });
    if(!resp.ok){
      // fall back to component loader
      console.warn('Terminal status fetch failed', resp.status);
      if(typeof loadTerminalSettings === 'function') return loadTerminalSettings();
      return;
    }

    const data = await resp.json();
    // If the terminal component exposes renderTerminalSection, use it
    if(typeof renderTerminalSection === 'function'){
      renderTerminalSection(data, shopId || data?.shopId || null);
      return;
    }

    // Otherwise, write a basic UI
    container.innerHTML = `<pre style="white-space:pre-wrap">${JSON.stringify(data,null,2)}</pre>`;
  }catch(err){
    console.warn('loadTerminalSettings_viaApi failed', err);
    if(typeof loadTerminalSettings === 'function') loadTerminalSettings();
  }
}

// Expose functions globally for the settings page to call if desired
window.loadTerminalSettings_viaApi = loadTerminalSettings_viaApi;
window.getSettingsApiToken = getAuthToken;

// Auto-run when the page has a terminal section (non-blocking)
document.addEventListener('DOMContentLoaded', () => {
  if(document.getElementById('terminal-settings-section')){
    // Prefer the new API loader but fall back to existing component
    loadTerminalSettings_viaApi().catch(() => {
      if(typeof loadTerminalSettings === 'function') loadTerminalSettings();
    });
  }
});
