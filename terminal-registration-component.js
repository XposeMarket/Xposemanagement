/**
 * Terminal Registration Component
 * Add this to your settings page (settings-subscription.js or similar)
 */
// Local helper: get authenticated user. Uses Supabase if available, otherwise falls back to local session.
async function getCurrentUser() {
  // If a global helper exists, prefer it
  if (
    typeof window !== 'undefined' &&
    typeof window.getCurrentUser === 'function' &&
    window.getCurrentUser !== getCurrentUser // Prevent infinite recursion
  ) {
    try { return await window.getCurrentUser(); } catch (e) { console.warn('window.getCurrentUser failed', e); }
  }

  // If a supabase client is available globally, try that
  try {
    if (typeof supabase !== 'undefined' && supabase && supabase.auth && typeof supabase.auth.getUser === 'function') {
      const r = await supabase.auth.getUser();
      if (r && r.data && r.data.user) return r.data.user;
    }
  } catch (e) {
    console.warn('supabase.getUser failed', e);
  }

  // Fallback to local session stored in localStorage (xm_session)
  try {
    const s = JSON.parse(localStorage.getItem('xm_session') || '{}');
    if (s && (s.email || s.shopId || s.current_shop_id || s.default_shop_id)) {
      // Normalize fields used by this component
      return {
        email: s.email,
        current_shop_id: s.shopId || s.current_shop_id || s.default_shop_id || null,
        default_shop_id: s.shopId || s.current_shop_id || s.default_shop_id || null
      };
    }
  } catch (e) { /* ignore */ }

  return null;
}

async function loadTerminalSettings() {
  const user = await getCurrentUser();
  const shopId = user && (user.current_shop_id || user.default_shop_id || user.shopId);

  if (!shopId) {
    console.error('No shop ID found');
    renderTerminalSection({ status: 'error', error: 'No shop ID found' }, null);
    return;
  }

  try {
    // Get terminal status from backend
    const response = await fetch(
      `https://xpose-stripe-server.vercel.app/api/terminal/status/${shopId}`
    );
    let data = { status: 'error' };
    try {
      if (response.ok) {
        const ct = (response.headers.get('content-type') || '').toLowerCase();
        if (ct.includes('application/json')) {
          data = await response.json();
        } else {
          console.warn('Expected JSON from terminal status but got:', ct);
          data = { status: 'error', error: 'Invalid response from status endpoint' };
        }
      } else {
        data = { status: 'error', error: `HTTP ${response.status}` };
      }
    } catch (parseErr) {
      console.error('Failed to parse terminal status response', parseErr);
      data = { status: 'error', error: 'Failed to parse response' };
    }

    renderTerminalSection(data, shopId);
  } catch (error) {
    console.error('Error loading terminal settings:', error);
    renderTerminalSection({ status: 'error' }, shopId);
  }
}

// Open and reset the terminal test modal
function openTerminalTestModal() {
  const modal = document.getElementById('terminalTestModal');
  if (!modal) throw new Error('Terminal test modal not found');
  const msgEl = modal.querySelector('.terminal-test-msg');
  const resultEl = modal.querySelector('.terminal-test-result');
  const closeBtn = modal.querySelector('.terminal-test-close');
  if (msgEl) msgEl.textContent = 'Checking Connection...';
  if (resultEl) { resultEl.textContent = ''; resultEl.className = 'terminal-test-result'; }
  if (closeBtn) closeBtn.disabled = true;
  modal.classList.remove('hidden');
  // ensure testing class used by animation
  modal.classList.add('testing');
}

function renderTerminalSection(terminalData, shopId) {
  const container = document.getElementById('terminal-settings-section');
  
  if (!container) {
    console.error('Terminal settings container not found');
    return;
  }

  if (terminalData.status === 'not_registered') {
    // Show registration form and panel
    container.innerHTML = `
      <div class="terminal-status-section">
        <div class="terminal-header">
          <h3><i class="fas fa-credit-card"></i> Stripe Terminal Setup</h3>
          <p class="text-muted">Connect your Stripe terminal to accept in-person payments</p>
        </div>
        <div class="terminal-info-card warning">
          <div class="terminal-status-badge">
            <i class="fas fa-exclamation-triangle"></i>
            <span>Not Registered</span>
          </div>
          <div class="terminal-details">
            <p>No terminal is currently registered for this shop.</p>
          </div>
        </div>
        <div class="terminal-actions">
          <button class="btn btn-primary" onclick="document.getElementById('terminal-registration-form').classList.toggle('hidden')">
            <i class="fas fa-plug"></i> Register Terminal
          </button>
        </div>
        <form id="terminal-registration-form" class="registration-form hidden" style="margin-top:24px;">
          <div class="form-group">
            <label for="terminal-reg-code">
              <strong>Registration Code</strong>
              <small class="text-muted">Found on your terminal's screen</small>
            </label>
            <input 
              type="text" 
              id="terminal-reg-code" 
              class="form-control"
              placeholder="XXXXX-XXXXX"
              maxlength="11"
              style="text-transform: uppercase; font-family: monospace; font-size: 18px;"
            >
            <small class="form-text">
              The registration code appears on your terminal when it's ready to connect.
              It looks like: <code>ABCD1-23456</code>
            </small>
          </div>
          <button 
            type="button"
            onclick="registerTerminal('${shopId}')" 
            class="btn btn-primary btn-lg"
            id="register-terminal-btn"
          >
            <i class="fas fa-plug"></i> Register Terminal
          </button>
          <div class="registration-help">
            <h5><i class="fas fa-question-circle"></i> Need Help?</h5>
            <ol>
              <li>Power on your Stripe terminal</li>
              <li>Wait for it to connect to WiFi/internet</li>
              <li>The registration code will appear on the screen</li>
              <li>Enter the code above and click "Register Terminal"</li>
            </ol>
          </div>
        </form>
      </div>
    `;
    // Load and display terminal model
    loadTerminalModel(shopId);
  } else {
    // Terminal is registered - show status
    const statusClass = terminalData.status === 'online' ? 'success' : 'warning';
    const statusIcon = terminalData.status === 'online' ? 'fa-check-circle' : 'fa-exclamation-triangle';
    const statusText = terminalData.status === 'online' ? 'Online' : 'Offline';

    container.innerHTML = `
      <div class="terminal-status-section">
        <div class="terminal-header">
          <h3><i class="fas fa-credit-card"></i> Terminal Status</h3>
        </div>

        <div class="terminal-info-card ${statusClass}">
          <div class="terminal-status-badge">
            <i class="fas ${statusIcon}"></i>
            <span>${statusText}</span>
          </div>

          <div class="terminal-details">
            <p><strong>Model:</strong> ${getTerminalModelName(terminalData.model)}</p>
            <p><strong>Device:</strong> ${terminalData.device_type || 'Unknown'}</p>
            <p><strong>Label:</strong> ${terminalData.label || 'N/A'}</p>
            ${terminalData.action ? `<p><strong>Current Action:</strong> ${terminalData.action}</p>` : ''}
          </div>
        </div>

        <div class="terminal-actions">
          <button 
            onclick="testTerminal('${shopId}')" 
            class="btn btn-secondary"
          >
            <i class="fas fa-vial"></i> Test Connection
          </button>
        </div>
        <div class="terminal-remove-panel" style="margin-top:24px;">
          <button 
            onclick="unregisterTerminal('${shopId}')" 
            class="btn btn-danger"
          >
            <i class="fas fa-unlink"></i> Remove Terminal
          </button>
        </div>

        ${terminalData.status !== 'online' ? `
          <div class="alert alert-warning">
            <i class="fas fa-exclamation-triangle"></i>
            <strong>Terminal Offline</strong><br>
            Please check that your terminal is powered on and connected to the internet.
          </div>
        ` : ''}
      </div>
    `;
  }
}

async function loadTerminalModel(shopId) {
  try {
    const client = (typeof window !== 'undefined' && window._supabaseClient) ? window._supabaseClient : (typeof supabase !== 'undefined' ? supabase : null);
    if (!client) throw new Error('Supabase client not available');

    const { data: shop, error } = await client
      .from('shops')
      .select('terminal_model')
      .eq('id', shopId)
      .single();

    if (error) throw error;

    const modelCard = document.getElementById('current-terminal-model');
    const model = shop.terminal_model || 'reader_m2';
    const modelInfo = getTerminalModelInfo(model);

    if (modelCard) {
      modelCard.innerHTML = `
        <div class="model-icon">
          <i class="fas fa-tablet-alt"></i>
        </div>
        <div class="model-info">
          <h5>${modelInfo.name}</h5>
          <p>${modelInfo.description}</p>
          ${modelInfo.price > 0 ? `<span class="model-price">+$${(modelInfo.price / 100).toFixed(0)}/month</span>` : '<span class="model-price-free">Included</span>'}
        </div>
      `;
    }
  } catch (error) {
    console.error('Error loading terminal model:', error);
  }
}

function getTerminalModelInfo(model) {
  const models = {
    'reader_m2': {
      name: 'Stripe Reader M2',
      description: 'Countertop terminal, no screen',
      price: 0
    },
    'wisepos_e': {
      name: 'BBPOS WisePOS E',
      description: 'Handheld terminal with touchscreen',
      price: 3000
    },
    'reader_s700': {
      name: 'Stripe Reader S700',
      description: 'Premium terminal with large display',
      price: 5000
    }
  };

  return models[model] || models['reader_m2'];
}

function getTerminalModelName(model) {
  const info = getTerminalModelInfo(model);
  return info.name;
}

async function registerTerminal(shopId) {
  const codeInput = document.getElementById('terminal-reg-code');
  const registerBtn = document.getElementById('register-terminal-btn');
  const code = codeInput.value.trim().toUpperCase();

  if (!code) {
    showNotification('Please enter a registration code', 'error');
    codeInput.focus();
    return;
  }

  // Validate format (basic check)
  if (!/^[A-Z0-9]{5}-[A-Z0-9]{5}$/.test(code)) {
    showNotification('Invalid registration code format. Should be: XXXXX-XXXXX', 'error');
    codeInput.focus();
    return;
  }

  // Disable button and show loading
  registerBtn.disabled = true;
  registerBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Registering...';

  try {
    const response = await fetch('https://xpose-stripe-server.vercel.app/api/terminal/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        shopId: shopId,
        registrationCode: code
      })
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || 'Registration failed');
    }

    showNotification('Terminal registered successfully!', 'success');
    
    // Reload terminal settings to show status
    setTimeout(() => {
      loadTerminalSettings();
    }, 1500);

  } catch (error) {
    console.error('Registration error:', error);
    showNotification(`Registration failed: ${error.message}`, 'error');
    
    // Re-enable button
    registerBtn.disabled = false;
    registerBtn.innerHTML = '<i class="fas fa-plug"></i> Register Terminal';
  }
}

async function testTerminal(shopId) {
  // Open test modal and run a 10s polling test with animated heartbeat
  try {
    openTerminalTestModal();
  } catch (e) { console.warn('Could not open test modal', e); }

  const messages = [
    'Checking Connection...',
    'Please Stand by...',
    "We're still checking",
    'Did you ensure the terminal is powered on?',
    'Should be just a moment',
    'Hold on tight!',
    'So...nice weather huh?',
    'Make sure the device youre holding matches the registered device',
    'Loading....',
    'Running tests :testing device connection',
    'Checking registered device'
  ];

  const statusUrl = `https://xpose-stripe-server.vercel.app/api/terminal/status/${shopId}`;
  const start = Date.now();
  const maxMs = 10000; // 10 seconds
  let msgIdx = 0;
  const modal = document.getElementById('terminalTestModal');
  const msgEl = modal && modal.querySelector('.terminal-test-msg');
  const resultEl = modal && modal.querySelector('.terminal-test-result');
  const closeBtn = modal && modal.querySelector('.terminal-test-close');

  // start message cycling
  const msgTimer = setInterval(() => {
    if (msgEl) {
      // pick a random message each tick
      const rand = messages[Math.floor(Math.random() * messages.length)];
      msgEl.textContent = rand;
    }
  }, 2000);

  // start heartbeat animation class
  if (modal) modal.classList.add('testing');

  let succeeded = false;

  // poll every 1s until timeout or success
  const poll = async () => {
    try {
      const resp = await fetch(statusUrl);
      if (!resp.ok) {
        console.warn('Poll status HTTP', resp.status);
      } else {
        const ct = (resp.headers.get('content-type') || '').toLowerCase();
        if (ct.includes('application/json')) {
          const data = await resp.json();
          if (data && data.status === 'online') {
            succeeded = true;
            finish(true);
            return;
          }
        } else {
          console.warn('Poll non-JSON response, content-type:', ct);
        }
      }
    } catch (err) {
      console.warn('Poll error', err);
    }

    if (Date.now() - start >= maxMs) {
      finish(false);
      return;
    }

    setTimeout(poll, 1000);
  };

  function finish(ok) {
    clearInterval(msgTimer);
    if (modal) modal.classList.remove('testing');
    if (resultEl) {
      resultEl.textContent = ok ? 'Connected ✅' : 'Failed ❌';
      resultEl.className = 'terminal-test-result ' + (ok ? 'success' : 'failed');
    }
    if (msgEl) msgEl.textContent = ok ? "Terminal is online and ready!" : "Could not reach terminal. Please check the device.";
    if (closeBtn) closeBtn.disabled = false;
    // reload to reflect updated status (optional)
    setTimeout(() => { loadTerminalSettings(); }, 1200);
  }

  // start polling
  poll();
}

async function unregisterTerminal(shopId) {
  // Use themed modal from settings.html
  if (typeof showConfirm === 'function') {
    const confirmed = await showConfirm(
      'Are you sure you want to unregister this terminal? You will need to re-register it to accept payments.',
      'Unregister',
      'Cancel'
    );
    if (!confirmed) return;
  } else {
    const confirmed = confirm('Are you sure you want to unregister this terminal? You will need to re-register it to accept payments.');
    if (!confirmed) return;
  }

    try {
    const client = (typeof window !== 'undefined' && window._supabaseClient) ? window._supabaseClient : (typeof supabase !== 'undefined' ? supabase : null);
    if (!client) throw new Error('Supabase client not available');

    const { error } = await client
      .from('shops')
      .update({
        terminal_id: null,
        terminal_serial: null,
        terminal_status: 'offline'
      })
      .eq('id', shopId);

    if (error) throw error;

    showNotification('Terminal unregistered', 'info');
    loadTerminalSettings();
  } catch (error) {
    console.error('Unregister error:', error);
    showNotification('Failed to unregister terminal', 'error');
  }
}

// Add to your settings page initialization
document.addEventListener('DOMContentLoaded', () => {
  // ... your other initialization code
  
  // Load terminal settings if section exists
  if (document.getElementById('terminal-settings-section')) {
    loadTerminalSettings();
  }
});
