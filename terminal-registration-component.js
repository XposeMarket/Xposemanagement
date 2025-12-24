/**
 * Terminal Registration Component - UPDATED with Edit Serial & Real Test
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
    // Check terminal status
    const statusResponse = await fetch(
      `https://xpose-stripe-server.vercel.app/api/terminal/status/${shopId}`
    );
    const terminalData = await statusResponse.json();

    renderTerminalSection(terminalData, shopId);

  } catch (error) {
    console.error('Error loading terminal settings:', error);
    renderTerminalSection({ status: 'error', error: error.message }, shopId);
  }
}

function showNotification(message, type = 'success') {
  // Create or reuse a top-level banner container that sits above the main header
  let container = document.getElementById('terminal_notification_banner_container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'terminal_notification_banner_container';
    container.style.position = 'fixed';
    container.style.left = '0';
    container.style.right = '0';
    container.style.top = '0';
    container.style.zIndex = '2147483647';
    container.style.display = 'flex';
    container.style.justifyContent = 'center';
    container.style.pointerEvents = 'none';
    // Insert before header if present so it visually sits above it
    const header = document.querySelector('header');
    if (header && header.parentNode) header.parentNode.insertBefore(container, header);
    else document.body.insertBefore(container, document.body.firstChild);
  }

  // Create the banner element
  let banner = document.getElementById('terminal_notification_banner');
  if (banner) banner.remove();
  banner = document.createElement('div');
  banner.id = 'terminal_notification_banner';
  banner.style.pointerEvents = 'auto';
  banner.style.margin = '8px';
  banner.style.minWidth = '280px';
  banner.style.maxWidth = '980px';
  banner.style.padding = '12px 18px';
  banner.style.borderRadius = '8px';
  banner.style.boxShadow = '0 8px 30px rgba(2,6,23,0.15)';
  banner.style.fontWeight = '600';
  banner.style.fontSize = '14px';
  banner.style.color = '#fff';

  if (type === 'error') {
    banner.style.background = '#ef4444';
  } else if (type === 'info') {
    banner.style.background = '#3b82f6';
  } else {
    banner.style.background = '#10b981';
    banner.style.color = '#064e3b';
  }

  banner.textContent = message;
  container.appendChild(banner);

  // Animate in
  banner.style.opacity = '0';
  banner.style.transform = 'translateY(-6px)';
  requestAnimationFrame(() => { banner.style.transition = 'all 220ms ease'; banner.style.opacity = '1'; banner.style.transform = 'translateY(0)'; });

  // Auto-remove after 4s
  setTimeout(() => {
    try { banner.style.opacity = '0'; banner.style.transform = 'translateY(-6px)'; } catch (e){}
    setTimeout(() => { try { banner.remove(); } catch (e){} }, 240);
  }, 4000);
}

function openTerminalTestModal() {
  let modal = document.getElementById('terminalTestModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'terminalTestModal';
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal-content card" style="max-width:480px;text-align:center;padding:32px;">
        <div class="terminal-test-icon">
          <svg class="heartbeat-icon" width="64" height="64" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            <path fill="#667eea" d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
          </svg>
        </div>
        <h3 style="margin:16px 0 8px 0;">Testing Connection</h3>
        <p class="terminal-test-msg" style="color:#666;margin-bottom:24px;">Initializing test...</p>
        <div class="terminal-test-result" style="font-size:1.2rem;font-weight:600;margin:16px 0;min-height:32px;"></div>
        <button class="btn terminal-test-close" disabled onclick="document.getElementById('terminalTestModal').classList.add('hidden')">Close</button>
      </div>
      <style>
        .heartbeat-icon { animation: heartbeat 1.5s ease-in-out infinite; }
        @keyframes heartbeat {
          0%, 100% { transform: scale(1); }
          25% { transform: scale(1.1); }
          50% { transform: scale(1); }
        }
        #terminalTestModal.testing .heartbeat-icon { animation: heartbeat 0.8s ease-in-out infinite; }
        .terminal-test-result.success { color: #10b981; }
        .terminal-test-result.failed { color: #ef4444; }
      </style>
    `;
    document.body.appendChild(modal);
  }
  modal.classList.remove('hidden');
  // Reset content
  const msgEl = modal.querySelector('.terminal-test-msg');
  const resultEl = modal.querySelector('.terminal-test-result');
  const closeBtn = modal.querySelector('.terminal-test-close');
  if (msgEl) msgEl.textContent = 'Initializing test...';
  if (resultEl) {
    resultEl.textContent = '';
    resultEl.className = 'terminal-test-result';
  }
  if (closeBtn) closeBtn.disabled = true;
}

function renderTerminalSection(terminalData, shopId) {
  const container = document.getElementById('terminal-settings-section');
  if (!container) return;

  // Status not_registered: show registration form
  if (terminalData.status === 'not_registered' || terminalData.status === 'error') {
    container.innerHTML = `
      <div class="terminal-registration-section">
        <div class="terminal-header">
          <h3><i class="fas fa-credit-card"></i> Terminal Setup</h3>
          <p>Connect a Stripe Terminal to accept in-person payments</p>
        </div>

        <div id="current-terminal-model" class="terminal-model-card">
          <!-- Populated by loadTerminalModel() -->
        </div>

        <div class="registration-form">
          <div class="form-group">
            <label for="terminal-reg-code">
              Registration Code
              <small>Enter the code displayed on your terminal</small>
            </label>
            <input 
              type="text" 
              id="terminal-reg-code" 
              class="form-control" 
              placeholder="XXXXX-XXXXX"
              maxlength="11"
              style="text-transform:uppercase"
            >
            <small class="form-text">
              Code format: <code>XXXXX-XXXXX</code>
            </small>
          </div>

          <button 
            onclick="registerTerminal('${shopId}')" 
            id="register-terminal-btn"
            class="btn btn-primary btn-lg"
          >
            <i class="fas fa-plug"></i> Register Terminal
          </button>

          <div class="registration-help">
            <h5><i class="fas fa-question-circle"></i> How to Register</h5>
            <ol>
              <li>Power on your Stripe Terminal</li>
              <li id="terminal-serial-help">
                ${terminalData.model === 'reader_m2' || !terminalData.model ? 
                  'For M2 Reader: <strong>Check the back of the M2 reader for the Serial Number</strong>' : 
                  'The registration code will appear on the terminal screen'
                }
              </li>
              <li>Enter the code above and click Register</li>
              <li>Wait for confirmation</li>
            </ol>
          </div>
        </div>
      </div>
    `;
    
    // Load and display current terminal model
    loadTerminalModel(shopId);
    return;
  }

  // Status registered: show terminal info + test/unregister controls
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
          <p style="display:flex;align-items:center;gap:8px;">
            <strong>Serial:</strong> 
            <span id="terminal-serial-display">${terminalData.serial || 'N/A'}</span>
            <button 
              onclick="openEditSerialModal('${shopId}', '${terminalData.serial || ''}')"
              class="btn small"
              style="padding:4px 8px;font-size:12px;"
              title="Edit Serial Number"
            >
              <i class="fas fa-ellipsis-h"></i>
            </button>
          </p>
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

function openEditSerialModal(shopId, currentSerial) {
  let modal = document.getElementById('editSerialModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'editSerialModal';
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal-content card" style="max-width:420px;">
        <h3>Edit Terminal Serial Number</h3>
        <div class="form-group">
          <label for="edit-serial-input">Serial Number</label>
          <input 
            type="text" 
            id="edit-serial-input" 
            class="form-control" 
            placeholder="Enter serial number"
          >
          <small class="form-text">
            For M2 Reader: Check the back of the device
          </small>
        </div>
        <div style="display:flex;gap:8px;margin-top:16px;">
          <button 
            onclick="saveSerialNumber('${shopId}')" 
            id="save-serial-btn"
            class="btn btn-primary"
          >
            Save
          </button>
          <button 
            onclick="document.getElementById('editSerialModal').classList.add('hidden')" 
            class="btn"
          >
            Cancel
          </button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  }
  
  // Populate current serial
  const input = modal.querySelector('#edit-serial-input');
  if (input) input.value = currentSerial || '';
  
  modal.classList.remove('hidden');
  input.focus();
}

async function saveSerialNumber(shopId) {
  const input = document.getElementById('edit-serial-input');
  const saveBtn = document.getElementById('save-serial-btn');
  const newSerial = input.value.trim();
  
  if (!newSerial) {
    showNotification('Please enter a serial number', 'error');
    input.focus();
    return;
  }
  
  // Disable button
  saveBtn.disabled = true;
  saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
  
  try {
    const client = (typeof window !== 'undefined' && window._supabaseClient) ? window._supabaseClient : (typeof supabase !== 'undefined' ? supabase : null);
    if (!client) throw new Error('Supabase client not available');

    const { error } = await client
      .from('shops')
      .update({
        terminal_serial: newSerial,
        updated_at: new Date().toISOString()
      })
      .eq('id', shopId);

    if (error) throw error;

    showNotification('Serial number updated successfully!', 'success');
    document.getElementById('editSerialModal').classList.add('hidden');
    
    // Reload terminal settings
    setTimeout(() => {
      loadTerminalSettings();
    }, 500);
    
  } catch (error) {
    console.error('Save serial error:', error);
    showNotification(`Failed to save: ${error.message}`, 'error');
    
    // Re-enable button
    saveBtn.disabled = false;
    saveBtn.innerHTML = 'Save';
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
  // Open test modal and run REAL polling test
  openTerminalTestModal();

  const statusUrl = `https://xpose-stripe-server.vercel.app/api/terminal/status/${shopId}`;
  const start = Date.now();
  const maxMs = 10000; // 10 seconds
  
  const modal = document.getElementById('terminalTestModal');
  const msgEl = modal && modal.querySelector('.terminal-test-msg');
  const resultEl = modal && modal.querySelector('.terminal-test-result');
  const closeBtn = modal && modal.querySelector('.terminal-test-close');

  const messages = [
    'Checking connection...',
    'Contacting terminal...',
    'Verifying status...',
    'Ensure terminal is powered on...',
    'Checking network...',
    'Almost there...',
    'Testing connection...'
  ];

  // Cycle messages
  let msgIdx = 0;
  const msgTimer = setInterval(() => {
    if (msgEl) {
      msgEl.textContent = messages[msgIdx % messages.length];
      msgIdx++;
    }
  }, 1500);

  // Start heartbeat animation
  if (modal) modal.classList.add('testing');

  let succeeded = false;

  // Real polling function
  const poll = async () => {
    try {
      const resp = await fetch(statusUrl);
      
      if (!resp.ok) {
        console.warn('Status check HTTP', resp.status);
      } else {
        const data = await resp.json();
        
        // Check if terminal is online
        if (data && data.status === 'online') {
          succeeded = true;
          finish(true);
          return;
        } else {
          console.log('Terminal status:', data.status);
        }
      }
    } catch (err) {
      console.warn('Poll error', err);
    }

    // Check timeout
    if (Date.now() - start >= maxMs) {
      finish(false);
      return;
    }

    // Poll again in 1 second
    setTimeout(poll, 1000);
  };

  function finish(ok) {
    clearInterval(msgTimer);
    if (modal) modal.classList.remove('testing');
    
    if (resultEl) {
      resultEl.textContent = ok ? 'Connected ✅' : 'Failed ❌';
      resultEl.className = 'terminal-test-result ' + (ok ? 'success' : 'failed');
    }
    
    if (msgEl) {
      msgEl.textContent = ok 
        ? "Terminal is online and ready!" 
        : "Could not reach terminal. Please check the device is powered on and connected.";
    }
    
    if (closeBtn) closeBtn.disabled = false;
    
    // Reload settings to reflect updated status
    setTimeout(() => { loadTerminalSettings(); }, 1200);
  }

  // Start polling
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
  // Load terminal settings if section exists
  if (document.getElementById('terminal-settings-section')) {
    loadTerminalSettings();
  }
});
