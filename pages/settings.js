/**
 * pages/settings.js
 * Settings page setup - Shop info, services, labor rates, staff management
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
    
    // Update Google Business UI
    updateGoogleBusinessUI();
  }
  
  // Render services
  function renderServices() {
    const svcList = document.getElementById('svcList');
    if (!svcList) return;
    
    const services = settings.services || [];
    
    if (services.length === 0) {
      svcList.innerHTML = '<div class="muted">No services added yet.</div>';
      return;
    }
    
    svcList.innerHTML = services.map(svc => `
      <div class="chip" data-service="${svc.name}" style="cursor: pointer;">
        ${svc.name} - $${svc.price}
      </div>
    `).join('');
    
    // Add click listeners to remove
    svcList.querySelectorAll('.chip').forEach(chip => {
      chip.addEventListener('click', () => removeService(chip.dataset.service));
    });
  }
  
  // Render labor rates
  function renderLaborRates() {
    const labList = document.getElementById('labList');
    if (!labList) return;
    
    const laborRates = settings.labor_rates || [];
    
    if (laborRates.length === 0) {
      labList.innerHTML = '<div class="muted">No labor rates added yet.</div>';
      return;
    }
    
    labList.innerHTML = laborRates.map(rate => `
      <div class="chip" data-rate="${rate.name}" style="cursor: pointer;">
        ${rate.name} - $${rate.rate}/hr
      </div>
    `).join('');
    
    // Add click listeners to remove
    labList.querySelectorAll('.chip').forEach(chip => {
      chip.addEventListener('click', () => removeLaborRate(chip.dataset.rate));
    });
  }
  
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
  
  // Add service
  async function addService() {
    const svcName = document.getElementById('svcName').value.trim();
    const svcPrice = parseFloat(document.getElementById('svcPrice').value) || 0;
    
    if (!svcName) {
      showNotification('Please enter a service name', 'error');
      return;
    }
    
    settings.services = settings.services || [];
    
    // Check if service already exists
    if (settings.services.some(s => s.name === svcName)) {
      showNotification('Service already exists', 'error');
      return;
    }
    
    settings.services.push({ name: svcName, price: svcPrice });
    
    await saveSettings();
    
    // Clear inputs
    document.getElementById('svcName').value = '';
    document.getElementById('svcPrice').value = '';
    
    renderServices();
    showSectionNotice('svcSaved', 'svcList', 'Service added!');
  }
  
  // Remove service
  async function removeService(serviceName) {
    const ok = await showConfirm(`Remove service "${serviceName}"?`, 'Remove', 'Cancel');
    if (!ok) return;

    settings.services = (settings.services || []).filter(s => s.name !== serviceName);

    await saveSettings();
    renderServices();
    showSectionNotice('svcSaved', 'svcList', 'Service removed');
  }
  
  // Add labor rate
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
    
    settings.labor_rates.push({ name: labName, rate: labRate });
    
    await saveSettings();
    
    // Clear inputs
    document.getElementById('labName').value = '';
    document.getElementById('labRate').value = '';
    
    renderLaborRates();
    showSectionNotice('labSaved', 'labList', 'Labor rate added!');
  }
  
  // Remove labor rate
  async function removeLaborRate(rateName) {
    const ok = await showConfirm(`Remove labor rate "${rateName}"?`, 'Remove', 'Cancel');
    if (!ok) return;

    settings.labor_rates = (settings.labor_rates || []).filter(r => r.name !== rateName);

    await saveSettings();
    renderLaborRates();
    showSectionNotice('labSaved', 'labList', 'Labor rate removed');
  }
  
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
      el.className = 'notice ' + (type === 'error' ? 'danger' : 'success');
      setTimeout(() => {
        el.textContent = '';
        el.className = 'notice';
      }, 3500);
    } catch (e) {
      // fallback to global notification
      showNotification(message, type);
    }
  }

  
  // Google Business Search Functions
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
  
  // Event listeners
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
  
  const svcAddBtn = document.getElementById('svcAdd');
  if (svcAddBtn) {
    svcAddBtn.addEventListener('click', addService);
  }
  
  const labAddBtn = document.getElementById('labAdd');
  if (labAddBtn) {
    labAddBtn.addEventListener('click', addLaborRate);
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
      document.getElementById('googleSearchResults').style.display = 'none';
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
  
  const addManualGoogleBtn = document.getElementById('addManualGoogle');
  if (addManualGoogleBtn) {
    addManualGoogleBtn.addEventListener('click', async () => {
      const urlInput = document.getElementById('manualGoogleUrl');
      const url = urlInput.value.trim();
      
      if (!url) {
        showNotification('Please enter a Google Business URL', 'error');
        return;
      }
      
      if (!url.startsWith('http')) {
        showNotification('Please enter a valid URL starting with http:// or https://', 'error');
        return;
      }
      
      // Extract business name from URL or use shop name as fallback
      let businessName = shopData?.name || 'My Business';
      
      await confirmGoogleBusiness(businessName, url);
      urlInput.value = '';
    });
  }
  
  // Initial load
  loadShopData();
  
  console.log('✅ Settings page setup complete');
}

export { setupSettings };
