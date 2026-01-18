/**
 * pages/settings.js
 * Settings page setup - Shop info, services, labor rates, staff management
 * 
 * Updated: Added default labor rate support and labor-based services (ProDemand style)
 * 
 * Imported by: app.js
 * Imports from: helpers/
 */

import { getSupabaseClient } from '../helpers/supabase.js';

function setupSettings() {
  console.log('📄 Setting up Settings page...');
  
  const supabase = getSupabaseClient();
  let currentShopId = null;
  let currentUser = null;
  let shopData = null;
  let settings = {};
  
  // Current labor rate being managed
  let currentLaborRate = null;
  // Current service being managed
  let currentService = null;
  
  // Load shop data (prefer Supabase Auth -> users -> shops flow)
  async function loadShopData() {
    try {
      if (supabase) {
        // 1) Resolve authenticated user
        const { data: authData } = await supabase.auth.getUser();
        const authId = authData?.user?.id || null;
        const authEmail = authData?.user?.email || null;

        // 2) Find users row by auth_id, fall back to email if necessary
        if (!authId && !authEmail) {
          // No auth info available — fall back to localStorage behavior
          console.warn('[settings] No Supabase auth user; falling back to localStorage');
        }

        if (authId) {
          // Try matching against primary `id` first (most records use `id` = auth user id)
          const { data: byId } = await supabase.from('users').select('*').eq('id', authId).limit(1);
          currentUser = byId && byId[0] ? byId[0] : null;

          // Fallback to legacy `auth_id` column if present
          if (!currentUser) {
            const { data: userRows } = await supabase.from('users').select('*').eq('auth_id', authId).limit(1);
            currentUser = userRows && userRows[0] ? userRows[0] : null;
          }
        }

        if (!currentUser && authEmail) {
          const { data: byEmail } = await supabase.from('users').select('*').eq('email', authEmail).limit(1);
          currentUser = byEmail && byEmail[0] ? byEmail[0] : null;
        }

        // If we couldn't resolve a users row via Supabase, fall back to localStorage
        if (!currentUser) {
          const session = JSON.parse(localStorage.getItem('xm_session') || '{}');
          const users = JSON.parse(localStorage.getItem('xm_users') || '[]');
          currentUser = users.find(u => u.email === session.email) || null;
        }

        if (!currentUser) {
          console.error('No user record found for the authenticated account.');
          return;
        }

        currentShopId = currentUser.shop_id || null;
        if (!currentShopId) {
          console.error('User record does not have a shop_id assigned.');
          return;
        }

        // 3) Load shop from Supabase
        const { data: shop, error } = await supabase.from('shops').select('*').eq('id', currentShopId).single();
        if (error) throw error;
        shopData = shop;

        // ✅ CHECK IF USER OPTED OUT OF TERMINAL - HIDE TERMINAL SECTION
        if (shopData && shopData.terminal_opted_out === true) {
          console.log('🚫 User opted out of terminal - hiding terminal settings section');
          const terminalSection = document.getElementById('terminal-settings-section');
          if (terminalSection) {
            terminalSection.style.display = 'none';
          }
          // Also hide the parent card if it exists
          const terminalCard = terminalSection?.closest('.card');
          if (terminalCard) {
            terminalCard.style.display = 'none';
          }
        }

        // Load owner info from shops.owner_id (if present)
        if (shopData && shopData.owner_id) {
          const { data: ownerUser, error: ownerError } = await supabase
            .from('users')
            .select('email, first_name, last_name')
            .eq('id', shopData.owner_id)
            .single();
          if (!ownerError && ownerUser) shopData.owner = ownerUser;
        }

        // Load settings from data table
        const { data: dataRecord, error: dataError } = await supabase
          .from('data')
          .select('settings')
          .eq('shop_id', currentShopId)
          .single();
        if (!dataError && dataRecord) settings = dataRecord.settings || {};
      } else {
        // Supabase unavailable — fallback to localStorage for dev/offline
        const session = JSON.parse(localStorage.getItem('xm_session') || '{}');
        currentShopId = session.shopId || null;
        const users = JSON.parse(localStorage.getItem('xm_users') || '[]');
        currentUser = users.find(u => u.email === session.email) || {};
        const shops = JSON.parse(localStorage.getItem('xm_shops') || '[]');
        shopData = shops.find(s => s.id === currentShopId);
        const data = JSON.parse(localStorage.getItem('xm_data') || '{}');
        settings = data.settings || {};
      }

      populateForm();
    } catch (ex) {
      console.error('Error loading shop data:', ex);
    }
  }
  
  // Populate form fields
  function populateForm() {
    if (!shopData) return;
    document.getElementById('shopName').value = shopData.name || '';
    document.getElementById('shopPhone').value = shopData.phone || '';
    document.getElementById('shopEmail').value = shopData.email || '';
    document.getElementById('shopZipcode').value = shopData.zipcode || '';
    document.getElementById('shopStreet').value = shopData.street || '';
    document.getElementById('shopCity').value = shopData.city || '';
    document.getElementById('shopState').value = shopData.state || '';
    // Populate logo preview if present
    try{
      const logoEl = document.getElementById('shopLogoPreview');
      if(logoEl){
        if(shopData.logo){
          logoEl.src = shopData.logo;
          logoEl.style.display = 'block';
        } else {
          logoEl.src = '';
          logoEl.style.display = 'none';
        }
      }
    }catch(e){}
    // Populate owner info panel
    try {
      const ownerPanel = document.getElementById('shopOwnerPanel');
      if (ownerPanel && shopData.owner) {
        ownerPanel.innerHTML = `<strong>Shop Owner:</strong> ${shopData.owner.first_name || ''} ${shopData.owner.last_name || ''} (${shopData.owner.email})`;
      }
    } catch(e){}
    // Populate services
    renderServices();
    // Populate labor rates
    renderLaborRates();
    // Update labor rate dropdown for services
    updateLaborRateDropdown();
    
    // Update Google Business UI
    updateGoogleBusinessUI();
  }
  
  // ============================================
  // LABOR RATES - With Default Support
  // ============================================
  
  // Render labor rates with default indicator
  function renderLaborRates() {
    const labList = document.getElementById('labList');
    if (!labList) return;
    
    const laborRates = settings.labor_rates || [];
    
    if (laborRates.length === 0) {
      labList.innerHTML = '<div class="muted">No labor rates added yet. Add your first rate to set it as default.</div>';
      return;
    }
    
    labList.innerHTML = laborRates.map((rate, index) => {
      const isDefault = rate.is_default === true;
      const defaultBadge = isDefault ? '<span style="margin-left:8px;padding:2px 8px;background:linear-gradient(135deg,#10b981 0%,#34d399 100%);color:white;border-radius:12px;font-size:0.75rem;font-weight:600;">DEFAULT</span>' : '';
      return `
        <div class="chip" data-rate-name="${rate.name}" data-rate-index="${index}" style="cursor: pointer; display: inline-flex; align-items: center; gap: 4px;">
          ${rate.name} - $${rate.rate}/hr${defaultBadge}
        </div>
      `;
    }).join('');
    
    // Add click listeners to manage labor rates
    labList.querySelectorAll('.chip').forEach(chip => {
      chip.addEventListener('click', () => openLaborRateModal(chip.dataset.rateName));
    });
  }
  
  // Open labor rate management modal
  function openLaborRateModal(rateName) {
    const laborRates = settings.labor_rates || [];
    const rate = laborRates.find(r => r.name === rateName);
    if (!rate) return;
    
    currentLaborRate = rate;
    
    const modal = document.getElementById('laborRateModal');
    const nameEl = document.getElementById('laborRateModalName');
    const defaultBadge = document.getElementById('laborRateDefaultBadge');
    const switchDefaultBtn = document.getElementById('laborRateSwitchDefault');
    const removeBtn = document.getElementById('laborRateRemove');
    
    if (!modal || !nameEl) return;
    
    nameEl.textContent = `${rate.name} - $${rate.rate}/hr`;
    
    if (rate.is_default) {
      defaultBadge.style.display = 'block';
      switchDefaultBtn.style.display = 'none';
      // Cannot remove default rate
      removeBtn.innerHTML = `
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 9v2m0 4h.01M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z"/></svg>
        Cannot Remove (Default)
      `;
      removeBtn.disabled = true;
      removeBtn.style.opacity = '0.5';
      removeBtn.style.cursor = 'not-allowed';
    } else {
      defaultBadge.style.display = 'none';
      switchDefaultBtn.style.display = 'flex';
      removeBtn.innerHTML = `
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
        Remove Rate
      `;
      removeBtn.disabled = false;
      removeBtn.style.opacity = '1';
      removeBtn.style.cursor = 'pointer';
    }
    
    modal.classList.remove('hidden');
  }
  
  // Close labor rate modal
  function closeLaborRateModal() {
    const modal = document.getElementById('laborRateModal');
    if (modal) modal.classList.add('hidden');
    currentLaborRate = null;
  }
  
  // Switch labor rate to default
  async function switchToDefaultRate() {
    if (!currentLaborRate) return;
    
    const laborRates = settings.labor_rates || [];
    
    // Remove default from all rates
    laborRates.forEach(r => r.is_default = false);
    
    // Set current rate as default
    const rate = laborRates.find(r => r.name === currentLaborRate.name);
    if (rate) {
      rate.is_default = true;
    }
    
    await saveSettings();
    closeLaborRateModal();
    renderLaborRates();
    updateLaborRateDropdown();
    showNotification(`"${currentLaborRate.name}" is now the default labor rate`);
  }
  
  // Add labor rate (first one becomes default)
  async function addLaborRate() {
    const labName = document.getElementById('labName').value.trim();
    const labRate = parseFloat(document.getElementById('labRate').value) || 0;
    
    if (!labName) {
      showNotification('Please enter a rate name', 'error');
      return;
    }
    
    settings.labor_rates = settings.labor_rates || [];
    
    // Check if rate already exists
    if (settings.labor_rates.some(r => r.name === labName)) {
      showNotification('Labor rate already exists', 'error');
      return;
    }
    
    // First rate becomes default automatically
    const isFirst = settings.labor_rates.length === 0;
    
    settings.labor_rates.push({ 
      name: labName, 
      rate: labRate,
      is_default: isFirst
    });
    
    await saveSettings();
    
    // Clear inputs
    document.getElementById('labName').value = '';
    document.getElementById('labRate').value = '';
    
    renderLaborRates();
    updateLaborRateDropdown();
    
    if (isFirst) {
      showSectionNotice('labSaved', 'labList', `"${labName}" added as default rate!`);
    } else {
      showSectionNotice('labSaved', 'labList', 'Labor rate added!');
    }
  }
  
  // Remove labor rate (cannot remove default)
  async function removeLaborRate() {
    if (!currentLaborRate) return;
    
    if (currentLaborRate.is_default) {
      showNotification('Cannot remove the default rate. Set another rate as default first.', 'error');
      return;
    }
    
    const ok = await showConfirm(`Remove labor rate "${currentLaborRate.name}"?`, 'Remove', 'Cancel');
    if (!ok) {
      closeLaborRateModal();
      return;
    }

    settings.labor_rates = (settings.labor_rates || []).filter(r => r.name !== currentLaborRate.name);

    await saveSettings();
    closeLaborRateModal();
    renderLaborRates();
    updateLaborRateDropdown();
    showSectionNotice('labSaved', 'labList', 'Labor rate removed');
  }
  
  // Get default labor rate
  function getDefaultLaborRate() {
    const laborRates = settings.labor_rates || [];
    return laborRates.find(r => r.is_default) || laborRates[0] || null;
  }
  
  // Update labor rate dropdown in service form
  function updateLaborRateDropdown() {
    const select = document.getElementById('svcLaborRate');
    if (!select) return;
    
    const laborRates = settings.labor_rates || [];
    const defaultRate = getDefaultLaborRate();
    
    select.innerHTML = '<option value="">-- Select Rate --</option>';
    
    laborRates.forEach(rate => {
      const opt = document.createElement('option');
      opt.value = rate.name;
      opt.dataset.rate = rate.rate;
      const defaultLabel = rate.is_default ? ' (Default)' : '';
      opt.textContent = `${rate.name} - $${rate.rate}/hr${defaultLabel}`;
      if (rate.is_default) opt.selected = true;
      select.appendChild(opt);
    });
  }
  
  // ============================================
  // SERVICES - With Flat/Labor-Based Support
  // ============================================
  
  // Render services with pricing type indicator
  function renderServices() {
    const svcList = document.getElementById('svcList');
    if (!svcList) return;
    
    const services = settings.services || [];
    
    if (services.length === 0) {
      svcList.innerHTML = '<div class="muted">No services added yet.</div>';
      return;
    }
    
    svcList.innerHTML = services.map(svc => {
      const isLaborBased = svc.pricing_type === 'labor_based';
      let priceDisplay = '';
      
      if (isLaborBased) {
        const rate = (settings.labor_rates || []).find(r => r.name === svc.labor_rate_name);
        const hourlyRate = rate ? rate.rate : 0;
        const calculatedPrice = (svc.labor_hours || 0) * hourlyRate;
        priceDisplay = `${svc.labor_hours}hr × $${hourlyRate} = $${calculatedPrice.toFixed(2)}`;
      } else {
        priceDisplay = `$${svc.price || 0}`;
      }
      
      const typeIcon = isLaborBased ? '⏱️' : '💵';
      
      return `
        <div class="chip" data-service="${svc.name}" style="cursor: pointer;">
          ${typeIcon} ${svc.name} - ${priceDisplay}
        </div>
      `;
    }).join('');
    
    // Add click listeners to manage services
    svcList.querySelectorAll('.chip').forEach(chip => {
      chip.addEventListener('click', () => openServiceModal(chip.dataset.service));
    });
  }
  
  // Open service management modal
  function openServiceModal(serviceName) {
    const services = settings.services || [];
    const service = services.find(s => s.name === serviceName);
    if (!service) return;
    
    currentService = service;
    
    const modal = document.getElementById('serviceModal');
    const nameEl = document.getElementById('serviceModalName');
    const priceEl = document.getElementById('serviceModalPrice');
    
    if (!modal || !nameEl || !priceEl) return;
    
    nameEl.textContent = service.name;
    
    if (service.pricing_type === 'labor_based') {
      const rate = (settings.labor_rates || []).find(r => r.name === service.labor_rate_name);
      const hourlyRate = rate ? rate.rate : 0;
      const calculatedPrice = (service.labor_hours || 0) * hourlyRate;
      priceEl.innerHTML = `
        <span style="color:var(--muted);">Labor-based:</span> ${service.labor_hours}hr × $${hourlyRate}/hr<br>
        <strong style="font-size:1.1rem;">= $${calculatedPrice.toFixed(2)}</strong>
      `;
    } else {
      priceEl.innerHTML = `<span style="color:var(--muted);">Flat price:</span> <strong style="font-size:1.1rem;">$${service.price || 0}</strong>`;
    }
    
    modal.classList.remove('hidden');
  }
  
  // Close service modal
  function closeServiceModal() {
    const modal = document.getElementById('serviceModal');
    if (modal) modal.classList.add('hidden');
    currentService = null;
  }
  
  // Add service (flat or labor-based)
  async function addService() {
    const svcName = document.getElementById('svcName').value.trim();
    const pricingType = document.getElementById('svcPricingTypeValue')?.value || '';
    
    if (!svcName) {
      showSectionNotice('svcNotice', 'svcList', 'Please enter a service name', 'error');
      return;
    }
    
    if (!pricingType) {
      showSectionNotice('svcNotice', 'svcList', 'Please select a pricing type (Flat Price or Labor-based)', 'error');
      return;
    }
    
    settings.services = settings.services || [];
    
    // Check if service already exists
    if (settings.services.some(s => s.name === svcName)) {
      showSectionNotice('svcNotice', 'svcList', 'Service already exists', 'error');
      return;
    }
    
    let newService = { name: svcName, pricing_type: pricingType };
    
    if (pricingType === 'labor_based') {
      const laborHours = parseFloat(document.getElementById('svcLaborHours').value) || 0;
      const laborRateName = document.getElementById('svcLaborRate').value;
      
      if (!laborRateName) {
        showNotification('Please select a labor rate', 'error');
        return;
      }
      
      if (laborHours <= 0) {
        showNotification('Please enter labor hours', 'error');
        return;
      }
      
      const rate = (settings.labor_rates || []).find(r => r.name === laborRateName);
      const calculatedPrice = laborHours * (rate ? rate.rate : 0);
      
      newService.labor_hours = laborHours;
      newService.labor_rate_name = laborRateName;
      newService.price = calculatedPrice; // Store calculated price for compatibility
    } else {
      const svcPrice = parseFloat(document.getElementById('svcPrice').value) || 0;
      newService.price = svcPrice;
    }
    
    settings.services.push(newService);
    
    await saveSettings();
    
    // Clear inputs and reset pill buttons
    document.getElementById('svcName').value = '';
    document.getElementById('svcPrice').value = '';
    document.getElementById('svcLaborHours').value = '';
    
    // Reset pill buttons to unselected state
    const flatBtn = document.getElementById('svcPricingFlatBtn');
    const laborBtn = document.getElementById('svcPricingLaborBtn');
    const hiddenInput = document.getElementById('svcPricingTypeValue');
    if (flatBtn) flatBtn.classList.remove('active');
    if (laborBtn) laborBtn.classList.remove('active');
    if (hiddenInput) hiddenInput.value = '';
    
    document.getElementById('svcFlatFields').style.display = '';
    document.getElementById('svcLaborFields').style.display = 'none';
    document.getElementById('svcLaborPreview').textContent = '';
    
    renderServices();
    showSectionNotice('svcSaved', 'svcList', 'Service added!');
  }
  
  // Remove service
  async function removeService() {
    if (!currentService) return;
    
    const ok = await showConfirm(`Remove service "${currentService.name}"?`, 'Remove', 'Cancel');
    if (!ok) {
      closeServiceModal();
      return;
    }

    settings.services = (settings.services || []).filter(s => s.name !== currentService.name);

    await saveSettings();
    closeServiceModal();
    renderServices();
    showSectionNotice('svcSaved', 'svcList', 'Service removed');
  }
  
  // ============================================
  // SERVICE FORM - Toggle Flat/Labor UI (Pill Buttons)
  // ============================================
  
  function setupServiceFormToggle() {
    const flatBtn = document.getElementById('svcPricingFlatBtn');
    const laborBtn = document.getElementById('svcPricingLaborBtn');
    const hiddenInput = document.getElementById('svcPricingTypeValue');
    const flatFields = document.getElementById('svcFlatFields');
    const laborFields = document.getElementById('svcLaborFields');
    const laborHoursInput = document.getElementById('svcLaborHours');
    const laborRateSelect = document.getElementById('svcLaborRate');
    const laborPreview = document.getElementById('svcLaborPreview');
    
    if (!flatBtn || !laborBtn) return;
    
    function selectPill(type) {
      // Update hidden input
      if (hiddenInput) hiddenInput.value = type;
      
      // Update pill styles
      if (type === 'flat') {
        flatBtn.classList.add('active');
        laborBtn.classList.remove('active');
        flatFields.style.display = '';
        laborFields.style.display = 'none';
      } else {
        flatBtn.classList.remove('active');
        laborBtn.classList.add('active');
        flatFields.style.display = 'none';
        laborFields.style.display = '';
        updateLaborPreview();
      }
    }
    
    function updateLaborPreview() {
      const hours = parseFloat(laborHoursInput?.value) || 0;
      const rateName = laborRateSelect?.value || '';
      
      if (!rateName || hours <= 0) {
        laborPreview.textContent = '';
        return;
      }
      
      const rate = (settings.labor_rates || []).find(r => r.name === rateName);
      const hourlyRate = rate ? rate.rate : 0;
      const total = hours * hourlyRate;
      
      laborPreview.innerHTML = `<strong>Preview:</strong> ${hours}hr × ${hourlyRate}/hr = <strong>${total.toFixed(2)}</strong>`;
    }
    
    // Pill button click handlers
    flatBtn.addEventListener('click', () => selectPill('flat'));
    laborBtn.addEventListener('click', () => selectPill('labor_based'));
    
    // Labor preview updates
    laborHoursInput?.addEventListener('input', updateLaborPreview);
    laborRateSelect?.addEventListener('change', updateLaborPreview);
    
    // Initialize with nothing selected (no pill highlighted)
    flatBtn.classList.remove('active');
    laborBtn.classList.remove('active');
    if (hiddenInput) hiddenInput.value = '';
  }
  
  // ============================================
  // SHOP INFO
  // ============================================
  
  // Save shop info
  async function saveShopInfo() {
    const shopName = document.getElementById('shopName').value.trim();
    const shopPhone = document.getElementById('shopPhone').value.trim();
    const shopEmail = document.getElementById('shopEmail').value.trim();
    const shopZipcode = document.getElementById('shopZipcode').value.trim();
    const shopStreet = document.getElementById('shopStreet').value.trim();
    const shopCity = document.getElementById('shopCity').value.trim();
    const shopState = document.getElementById('shopState').value.trim();
    const shopLogoFile = document.getElementById('shopLogoFile')?.files?.[0];
    
    let shopLogo = shopData?.logo || '';
    
    // Handle logo upload
    if (shopLogoFile) {
      shopLogo = await new Promise(resolve => {
        const reader = new FileReader();
        reader.onload = e => resolve(e.target.result);
        reader.readAsDataURL(shopLogoFile);
      });
      // show preview immediately so user can see the logo before save completes
      try{
        const logoEl = document.getElementById('shopLogoPreview');
        if(logoEl){ logoEl.src = shopLogo; logoEl.style.display = 'block'; }
      }catch(e){}
    }
    
    try {
      if (supabase) {
        // Update in Supabase with defensive retries for missing columns
        let payload = {
          name: shopName,
          phone: shopPhone,
          email: shopEmail,
          zipcode: shopZipcode,
          street: shopStreet,
          city: shopCity,
          state: shopState,
          logo: shopLogo,
          updated_at: new Date().toISOString()
        };

        // Try updating, but if the DB schema doesn't include a column (PGRST204), strip it and retry
        const maxRetries = 6;
        let attempt = 0;
        while (attempt < maxRetries) {
          attempt += 1;
          const { error } = await supabase
            .from('shops')
            .update(payload)
            .eq('id', currentShopId);

          if (!error) break;

          // If column not found in schema cache, PostgREST returns PGRST204 with message mentioning the column
          const msg = (error && error.message) || '';
          const m = msg.match(/Could not find the '([^']+)' column of 'shops'/i) || msg.match(/relation "shops" has no column named "([^\"]+)"/i);
          if (m && m[1]) {
            const col = m[1];
            console.warn('[settings.js] Column not found in shops table, removing from payload and retrying:', col);
            delete payload[col];
            // continue loop to retry without this column
            continue;
          }

          // If it's some other error, throw it
          throw error;
        }
      } else {
        // Update in localStorage
        const shops = JSON.parse(localStorage.getItem('xm_shops') || '[]');
        const shopIndex = shops.findIndex(s => s.id === currentShopId);
        if (shopIndex !== -1) {
          shops[shopIndex] = {
            ...shops[shopIndex],
            name: shopName,
            phone: shopPhone,
            ...(shopEmail ? { email: shopEmail } : {}),
            ...(shopZipcode ? { zipcode: shopZipcode } : {}),
            ...(shopStreet ? { street: shopStreet } : {}),
            ...(shopCity ? { city: shopCity } : {}),
            ...(shopState ? { state: shopState } : {}),
            logo: shopLogo
          };
          localStorage.setItem('xm_shops', JSON.stringify(shops));
        }
      }
      
      showNotification('Shop info saved successfully!');
      await loadShopData(); // Reload
    } catch (ex) {
      console.error('Error saving shop info:', ex);
      showNotification('Error saving shop info: ' + ex.message, 'error');
    }
  }
  
  // ============================================
  // SETTINGS PERSISTENCE
  // ============================================
  
  // Save settings to Supabase or localStorage
  async function saveSettings() {
    try {
      if (supabase) {
        // Get current data
        const { data: currentData, error: fetchError } = await supabase
          .from('data')
          .select('*')
          .eq('shop_id', currentShopId)
          .single();
        
        if (fetchError && fetchError.code !== 'PGRST116') {
          throw fetchError;
        }
        
        // Upsert with updated settings
        const payload = {
          shop_id: currentShopId,
          settings: settings,
          appointments: currentData?.appointments || [],
          jobs: currentData?.jobs || [],
          threads: currentData?.threads || [],
          invoices: currentData?.invoices || [],
          updated_at: new Date().toISOString()
        };
        
        const { error } = await supabase
          .from('data')
          .upsert(payload, { onConflict: 'shop_id' });
        
        if (error) throw error;
        // Update local cache and notify other windows/tabs
        try {
          const localData = JSON.parse(localStorage.getItem('xm_data') || '{}');
          localData.settings = settings;
          localStorage.setItem('xm_data', JSON.stringify(localData));
          window.dispatchEvent(new Event('xm_data_updated'));
        } catch (e) { /* ignore local cache failures */ }
      } else {
        // Save to localStorage
        const data = JSON.parse(localStorage.getItem('xm_data') || '{}');
        data.settings = settings;
        localStorage.setItem('xm_data', JSON.stringify(data));
        // Notify other windows/tabs
        try { window.dispatchEvent(new Event('xm_data_updated')); } catch(e){}
      }
    } catch (ex) {
      console.error('Error saving settings:', ex);
      throw ex;
    }
  }
  
  // ============================================
  // NOTIFICATIONS
  // ============================================
  
  // Show notification
  function showNotification(message, type = 'success') {
    const shopSaved = document.getElementById('shopSaved');
    if (!shopSaved) return;
    
    shopSaved.textContent = message;
    shopSaved.className = 'notice ' + (type === 'error' ? 'danger' : 'success');
    
    setTimeout(() => {
      shopSaved.textContent = '';
      shopSaved.className = 'notice';
    }, 3000);
  }

  // Ensure a per-section notice element exists and show a message there
  function ensureSectionNotice(id, insertAfterId) {
    let el = document.getElementById(id);
    if (el) return el;
    const after = document.getElementById(insertAfterId);
    el = document.createElement('p');
    el.id = id;
    el.className = 'notice';
    el.style.marginTop = '8px';
    el.style.padding = '10px 12px';
    el.style.borderRadius = '6px';
    el.style.fontWeight = '500';
    if (after && after.parentNode) {
      // insert after the reference element
      if (after.nextSibling) after.parentNode.insertBefore(el, after.nextSibling);
      else after.parentNode.appendChild(el);
    } else if (after && after.parentElement) {
      after.parentElement.appendChild(el);
    } else {
      document.body.appendChild(el);
    }
    return el;
  }

  function showSectionNotice(id, insertAfterId, message, type = 'success') {
    try {
      const el = ensureSectionNotice(id, insertAfterId);
      el.textContent = message;
      
      // Style based on type
      if (type === 'error') {
        el.style.background = '#fee2e2';
        el.style.color = '#dc2626';
        el.style.border = '1px solid #fca5a5';
        el.className = 'notice danger';
      } else {
        el.style.background = '#d1fae5';
        el.style.color = '#065f46';
        el.style.border = '1px solid #6ee7b7';
        el.className = 'notice success';
      }
      
      setTimeout(() => {
        el.textContent = '';
        el.style.background = '';
        el.style.color = '';
        el.style.border = '';
        el.className = 'notice';
      }, 3500);
    } catch (e) {
      // fallback to global notification
      showNotification(message, type);
    }
  }
  
  // ============================================
  // GOOGLE BUSINESS
  // ============================================
  
  function quickSearchGoogle() {
    if (!shopData || !shopData.name) {
      showNotification('Please enter a shop name first', 'error');
      return;
    }
    
    const shopName = shopData.name.trim();
    const address = [shopData.street, shopData.city, shopData.state, shopData.zipcode]
      .filter(Boolean)
      .join(' ');
    
    // Open Google search in new tab
    const query = encodeURIComponent(`${shopName} ${address}`);
    window.open(`https://www.google.com/search?q=${query}`, '_blank');
    
    showNotification('Google search opened in new tab. Find your business and copy the review URL.', 'success');
  }
  
  async function confirmGoogleBusiness(businessName, businessUrl) {
    try {
      if (supabase) {
        // Save to shops table with defensive column handling
        let payload = {
          google_business_name: businessName,
          google_business_url: businessUrl
        };
        
        const maxRetries = 3;
        let attempt = 0;
        let lastError = null;
        
        while (attempt < maxRetries) {
          attempt++;
          const { error } = await supabase
            .from('shops')
            .update(payload)
            .eq('id', currentShopId);
          
          if (!error) {
            break; // Success!
          }
          
          // Check if column doesn't exist
          const msg = (error && error.message) || '';
          const columnMatch = msg.match(/Could not find the '([^']+)' column of 'shops'/i) || 
                            msg.match(/relation "shops" has no column named "([^\"]+)"/i);
          
          if (columnMatch && columnMatch[1]) {
            console.warn('[Google Business] Column not found, removing from payload:', columnMatch[1]);
            delete payload[columnMatch[1]];
            lastError = error;
            continue; // Retry without this column
          }
          
          // Some other error - throw it
          lastError = error;
          break;
        }
        
        if (lastError && Object.keys(payload).length === 0) {
          throw new Error('Database does not support Google Business fields yet. Please contact support.');
        }
        
        if (lastError && Object.keys(payload).length > 0) {
          throw lastError;
        }
      } else {
        // Save to localStorage
        const shops = JSON.parse(localStorage.getItem('xm_shops') || '[]');
        const shopIndex = shops.findIndex(s => s.id === currentShopId);
        if (shopIndex !== -1) {
          shops[shopIndex].google_business_name = businessName;
          shops[shopIndex].google_business_url = businessUrl;
          localStorage.setItem('xm_shops', JSON.stringify(shops));
        }
      }
      
      // Update shopData and UI
      shopData.google_business_name = businessName;
      shopData.google_business_url = businessUrl;
      
      updateGoogleBusinessUI();
      showNotification('Google Business saved successfully!');
    } catch (ex) {
      console.error('Error saving Google Business:', ex);
      showNotification('Failed to save. Please try again.', 'error');
    }
  }
  
  function updateGoogleBusinessUI() {
    const infoDiv = document.getElementById('googleBusinessInfo');
    const searchContainer = document.getElementById('googleSearchContainer');
    const businessNameEl = document.getElementById('googleBusinessName');
    const businessLinkEl = document.getElementById('googleBusinessLink');
    
    if (shopData?.google_business_name && shopData?.google_business_url) {
      businessNameEl.textContent = shopData.google_business_name;
      businessLinkEl.href = shopData.google_business_url;
      infoDiv.style.display = 'block';
      searchContainer.style.display = 'none';
    } else {
      infoDiv.style.display = 'none';
      searchContainer.style.display = 'block';
    }
  }
  
  // ============================================
  // CONFIRM MODAL
  // ============================================
  
  function showConfirm(message, okText = 'OK', cancelText = 'Cancel') {
    return new Promise((resolve) => {
      const modal = document.getElementById('confirmModal');
      const msgEl = document.getElementById('confirmMessage');
      const okBtn = document.getElementById('confirmOk');
      const cancelBtn = document.getElementById('confirmCancel');
      if (!modal || !msgEl || !okBtn || !cancelBtn) {
        // fallback to native confirm if modal not present
        resolve(window.confirm(message));
        return;
      }

      msgEl.textContent = message;
      okBtn.textContent = okText;
      cancelBtn.textContent = cancelText;

      function clean(result) {
        modal.classList.add('hidden');
        okBtn.removeEventListener('click', onOk);
        cancelBtn.removeEventListener('click', onCancel);
        resolve(result);
      }

      function onOk() { clean(true); }
      function onCancel() { clean(false); }

      okBtn.addEventListener('click', onOk);
      cancelBtn.addEventListener('click', onCancel);
      modal.classList.remove('hidden');
    });
  }
  
  // ============================================
  // EVENT LISTENERS
  // ============================================
  
  // Shop info save
  const saveShopBtn = document.getElementById('saveShop');
  if (saveShopBtn) {
    saveShopBtn.addEventListener('click', saveShopInfo);
  }

  // Preview logo when user picks a file (before hitting save)
  const logoFileInput = document.getElementById('shopLogoFile');
  if (logoFileInput) {
    logoFileInput.addEventListener('change', function(ev){
      const f = ev.target.files && ev.target.files[0];
      if(!f) return;
      const reader = new FileReader();
      reader.onload = function(e){
        try{ const logoEl = document.getElementById('shopLogoPreview'); if(logoEl){ logoEl.src = e.target.result; logoEl.style.display = 'block'; } }catch(err){}
      };
      reader.readAsDataURL(f);
    });
  }
  
  // Services
  const svcAddBtn = document.getElementById('svcAdd');
  if (svcAddBtn) {
    svcAddBtn.addEventListener('click', addService);
  }
  
  // Labor rates
  const labAddBtn = document.getElementById('labAdd');
  if (labAddBtn) {
    labAddBtn.addEventListener('click', addLaborRate);
  }
  
  // Labor rate modal buttons
  const laborRateSwitchBtn = document.getElementById('laborRateSwitchDefault');
  if (laborRateSwitchBtn) {
    laborRateSwitchBtn.addEventListener('click', switchToDefaultRate);
  }
  
  const laborRateRemoveBtn = document.getElementById('laborRateRemove');
  if (laborRateRemoveBtn) {
    laborRateRemoveBtn.addEventListener('click', removeLaborRate);
  }
  
  const laborRateCancelBtn = document.getElementById('laborRateCancel');
  if (laborRateCancelBtn) {
    laborRateCancelBtn.addEventListener('click', closeLaborRateModal);
  }
  
  // Close labor rate modal on backdrop click
  const laborRateModal = document.getElementById('laborRateModal');
  if (laborRateModal) {
    laborRateModal.addEventListener('click', (e) => {
      if (e.target === laborRateModal) closeLaborRateModal();
    });
  }
  
  // Service modal buttons
  const serviceRemoveBtn = document.getElementById('serviceRemove');
  if (serviceRemoveBtn) {
    serviceRemoveBtn.addEventListener('click', removeService);
  }
  
  const serviceCancelBtn = document.getElementById('serviceCancel');
  if (serviceCancelBtn) {
    serviceCancelBtn.addEventListener('click', closeServiceModal);
  }
  
  // Close service modal on backdrop click
  const serviceModal = document.getElementById('serviceModal');
  if (serviceModal) {
    serviceModal.addEventListener('click', (e) => {
      if (e.target === serviceModal) closeServiceModal();
    });
  }
  
  // Google Business search event listeners
  const quickSearchBtn = document.getElementById('quickSearchGoogle');
  if (quickSearchBtn) {
    quickSearchBtn.addEventListener('click', quickSearchGoogle);
  }
  
  const changeGoogleBtn = document.getElementById('changeGoogleBusiness');
  if (changeGoogleBtn) {
    changeGoogleBtn.addEventListener('click', () => {
      document.getElementById('googleBusinessInfo').style.display = 'none';
      document.getElementById('googleSearchContainer').style.display = 'block';
    });
  }
  
  // Manual Google Business entry
  const saveManualBtn = document.getElementById('saveManualGoogleBusiness');
  if (saveManualBtn) {
    saveManualBtn.addEventListener('click', async () => {
      const businessName = document.getElementById('manualBusinessName')?.value?.trim();
      const businessUrl = document.getElementById('manualGoogleUrl')?.value?.trim();
      
      if (!businessName || !businessUrl) {
        showNotification('Please enter both business name and Google Maps URL', 'error');
        return;
      }
      
      // Validate URL contains google.com or goo.gl
      if (!businessUrl.includes('google.com') && !businessUrl.includes('goo.gl')) {
        showNotification('Please enter a valid Google Maps URL', 'error');
        return;
      }
      
      await confirmGoogleBusiness(businessName, businessUrl);
      
      // Clear inputs on success
      document.getElementById('manualBusinessName').value = '';
      document.getElementById('manualGoogleUrl').value = '';
    });
  }
  
  // Setup service form toggle (flat vs labor-based)
  setupServiceFormToggle();
  
  // Initial load
  loadShopData();
  
  console.log('✅ Settings page setup complete');
}

export { setupSettings };
