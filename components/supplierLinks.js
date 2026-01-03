/**
 * supplierLinks.js
 * Handles supplier quick links AND local dealerships in parts modal
 */

// Supplier configuration
const SUPPLIERS = [
  // DEFAULT VISIBLE SUPPLIERS (Top 6)
  {
    name: 'PartsTech',
    logo: 'assets/Parts Suppliers/partstech-logo.png',
    url: 'https://app.partstech.com/',
    fallbackLogo: '🔧',
    visible: true
  },
  {
    name: 'Carquest/Advance Auto',
    logo: 'assets/Parts Suppliers/CarwquestLogo.webp',
    url: 'https://app.partstech.com/',
    visible: true
  },
  {
    name: 'WorldPac',
    logo: 'assets/Parts Suppliers/Worldpaclogo.png',
    url: 'https://speeddial.worldpac.com/#/login',
    visible: true
  },
  {
    name: 'AutoZone',
    logo: 'assets/Parts Suppliers/AutoZone-Logo-640x400.png',
    url: 'https://www.autozone.com',
    visible: true
  },
  {
    name: 'NAPA',
    logo: 'assets/Parts Suppliers/NAPA_Auto_Parts_logo.svg.png',
    url: 'https://www.napaonline.com',
    visible: true
  },
  {
    name: "O'Reilly",
    logo: 'assets/Parts Suppliers/oreillyslogo.png',
    url: 'https://www.oreillyauto.com',
    visible: true
  },
  // HIDDEN BY DEFAULT
  {
    name: 'Summit Racing',
    logo: 'assets/Parts Suppliers/Summit-Racing-Equipment-Logo-1024x580.webp',
    url: 'https://www.summitracing.com',
    visible: false,
    preset: true
  },
  {
    name: 'Parts Authority',
    logo: 'assets/Parts Suppliers/partsauthoritylogo.jpg',
    url: 'https://www.partsauthority.com',
    visible: false,
    preset: true
  },
  {
    name: 'RockAuto',
    logo: 'assets/Parts Suppliers/rock-auto.jpg',
    url: 'https://www.rockauto.com',
    visible: false,
    preset: true
  },
  {
    name: 'FCP Euro',
    logo: 'assets/Parts Suppliers/FCP-Logo.jpg',
    url: 'https://www.fcpeuro.com',
    visible: false,
    preset: true
  },
  {
    name: 'LKQ',
    logo: 'assets/Parts Suppliers/lkq-corp-logo.jpg',
    url: 'https://www.lkqonline.com',
    visible: false,
    preset: true
  }
];

// Manufacturer logos for dealerships
const MANUFACTURERS = {
  'Acura': { logo: 'assets/Manufacturers/acura-logo.png' },
  'Audi': { logo: 'assets/Manufacturers/audi-logo.png' },
  'BMW': { logo: 'assets/Manufacturers/bmw-logo.png' },
  'Buick': { logo: 'assets/Manufacturers/buick-logo.png' },
  'Cadillac': { logo: 'assets/Manufacturers/cadillac-logo.png' },
  'Chevrolet': { logo: 'assets/Manufacturers/chevrolet-logo.png' },
  'Chrysler': { logo: 'assets/Manufacturers/chrysler-logo.png' },
  'Dodge': { logo: 'assets/Manufacturers/dodge-logo.png' },
  'Ford': { logo: 'assets/Manufacturers/ford-logo.png' },
  'GMC': { logo: 'assets/Manufacturers/gmc-logo.png' },
  'Honda': { logo: 'assets/Manufacturers/honda-logo.png' },
  'Hyundai': { logo: 'assets/Manufacturers/hyundai-logo.png' },
  'Infiniti': { logo: 'assets/Manufacturers/infiniti-logo.png' },
  'Jeep': { logo: 'assets/Manufacturers/jeep-logo.png' },
  'Kia': { logo: 'assets/Manufacturers/kia-logo.png' },
  'Lexus': { logo: 'assets/Manufacturers/lexus-logo.png' },
  'Lincoln': { logo: 'assets/Manufacturers/lincoln-logo.png' },
  'Mazda': { logo: 'assets/Manufacturers/mazda-logo.png' },
  'Mercedes-Benz': { logo: 'assets/Manufacturers/mercedes-logo.png' },
  'Nissan': { logo: 'assets/Manufacturers/nissan-logo.png' },
  'Ram': { logo: 'assets/Manufacturers/ram-logo.png' },
  'Subaru': { logo: 'assets/Manufacturers/subaru-logo.png' },
  'Tesla': { logo: 'assets/Manufacturers/tesla-logo.png' },
  'Toyota': { logo: 'assets/Manufacturers/toyota-logo.png' },
  'Volkswagen': { logo: 'assets/Manufacturers/vw-logo.png' },
  'Volvo': { logo: 'assets/Manufacturers/volvo-logo.png' }
};

let activeSuppliers = SUPPLIERS.filter(s => s.visible).map(s => s.name);
let activeDealerships = [];

/**
 * Get current shop info
 */
function getShopInfo() {
  try {
    const session = JSON.parse(localStorage.getItem('xm_session') || '{}');
    return {
      shopId: session.shopId || null,
      city: session.city || 'Frederick',
      state: session.state || 'Maryland'
    };
  } catch (e) {
    return { shopId: null, city: 'Frederick', state: 'Maryland' };
  }
}

/**
 * Initialize supplier links in the parts modal
 */
async function initSupplierLinks() {
  const partsModal = document.getElementById('partsModal');
  if (!partsModal) {
    console.warn('Parts modal not found');
    return;
  }

  const vehicleInfo = document.getElementById('partsVehicleInfo');
  if (!vehicleInfo) {
    console.warn('Vehicle info section not found');
    return;
  }

  // Create TWO-COLUMN layout
  const supplierDealerSection = document.createElement('div');
  supplierDealerSection.id = 'supplierDealerSection';
  supplierDealerSection.style.cssText = 'display: grid; grid-template-columns: 1.2fr 1.2fr; gap: 40px; margin-bottom: 20px; width: 100%; max-width: none; overflow: visible;';
  
  // LEFT COLUMN - Suppliers
  const suppliersCol = document.createElement('div');
  suppliersCol.id = 'suppliersColumn';
  
  const supplierHeader = document.createElement('div');
  supplierHeader.style.cssText = 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;';
  
  const supplierHeading = document.createElement('h4');
  supplierHeading.style.cssText = 'margin: 0; font-size: 1rem; font-weight: 600;';
  supplierHeading.textContent = 'Quick Order from Suppliers';
  
  const supplierBtnGroup = document.createElement('div');
  supplierBtnGroup.style.cssText = 'display: flex; gap: 8px;';
  
  const editSupplierBtn = document.createElement('button');
  editSupplierBtn.className = 'btn small';
  editSupplierBtn.innerHTML = '✏️ Edit';
  editSupplierBtn.style.cssText = 'padding: 6px 12px; font-size: 0.9rem;';
  editSupplierBtn.onclick = () => showEditSupplierModal();
  
  const addSupplierBtn = document.createElement('button');
  addSupplierBtn.className = 'btn small primary';
  addSupplierBtn.innerHTML = '+ Add';
  addSupplierBtn.style.cssText = 'padding: 6px 12px; font-size: 0.9rem;';
  addSupplierBtn.onclick = () => showAddSupplierModal();
  
  supplierBtnGroup.appendChild(editSupplierBtn);
  supplierBtnGroup.appendChild(addSupplierBtn);
  supplierHeader.appendChild(supplierHeading);
  supplierHeader.appendChild(supplierBtnGroup);
  
  const suppliersContainer = document.createElement('div');
  suppliersContainer.className = 'supplier-links-container';
  suppliersContainer.id = 'supplierLinksContainer';
  
  suppliersCol.appendChild(supplierHeader);
  suppliersCol.appendChild(suppliersContainer);
  
  // RIGHT COLUMN - Dealerships
  const dealershipsCol = document.createElement('div');
  dealershipsCol.id = 'dealershipsColumn';
  
  const dealerHeader = document.createElement('div');
  dealerHeader.style.cssText = 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;';
  
  const dealerHeading = document.createElement('h4');
  dealerHeading.style.cssText = 'margin: 0; font-size: 1rem; font-weight: 600;';
  dealerHeading.textContent = 'Local Dealerships';
  
  const dealerBtnGroup = document.createElement('div');
  dealerBtnGroup.style.cssText = 'display: flex; gap: 8px;';
  
  const editDealerBtn = document.createElement('button');
  editDealerBtn.className = 'btn small';
  editDealerBtn.innerHTML = '✏️ Edit';
  editDealerBtn.style.cssText = 'padding: 6px 12px; font-size: 0.9rem;';
  editDealerBtn.onclick = () => showEditDealerModal();
  
  const addDealerBtn = document.createElement('button');
  addDealerBtn.className = 'btn small primary';
  addDealerBtn.innerHTML = '+ Add Dealer';
  addDealerBtn.style.cssText = 'padding: 6px 12px; font-size: 0.9rem;';
  addDealerBtn.onclick = () => showAddDealerModal();
  
  dealerBtnGroup.appendChild(editDealerBtn);
  dealerBtnGroup.appendChild(addDealerBtn);
  dealerHeader.appendChild(dealerHeading);
  dealerHeader.appendChild(dealerBtnGroup);
  
  const dealershipsContainer = document.createElement('div');
  dealershipsContainer.className = 'supplier-links-container';
  dealershipsContainer.id = 'dealerLinksContainer';
  
  dealershipsCol.appendChild(dealerHeader);
  dealershipsCol.appendChild(dealershipsContainer);
  
  // Add both columns to section
  supplierDealerSection.appendChild(suppliersCol);
  supplierDealerSection.appendChild(dealershipsCol);
  
  // Insert after vehicle info
  vehicleInfo.parentNode.insertBefore(supplierDealerSection, vehicleInfo.nextSibling);
  
  // Load saved suppliers
  const savedSuppliers = localStorage.getItem('activeSuppliers');
  if (savedSuppliers) {
    try {
      activeSuppliers = JSON.parse(savedSuppliers);
    } catch (e) {}
  }
  
  // Load saved dealerships from Supabase
  await loadDealerships();
  
  // Render both
  renderSupplierLinks(suppliersContainer);
  renderDealerLinks(dealershipsContainer);
  
  console.log('✅ Supplier & Dealership sections initialized');
}

/**
 * Load dealerships from Supabase
 */
async function loadDealerships() {
  const { shopId } = getShopInfo();
  if (!shopId) return;
  
  try {
    const { supabase } = await import('../helpers/supabase.js');
    const { data, error } = await supabase
      .from('dealerships')
      .select('*')
      .eq('shop_id', shopId)
      .eq('is_active', true)
      .order('created_at', { ascending: false });
    
    if (!error && data) {
      activeDealerships = data;
      console.log('✅ Loaded', data.length, 'dealerships');
    }
  } catch (e) {
    console.warn('Failed to load dealerships:', e);
  }
}

/**
 * Render supplier links
 */
function renderSupplierLinks(container) {
  container.innerHTML = '';
  const suppliersToShow = SUPPLIERS.filter(s => activeSuppliers.includes(s.name));
  
  suppliersToShow.forEach(supplier => {
    const card = createSupplierCard(supplier);
    container.appendChild(card);
  });
}

/**
 * Render dealer links
 */
function renderDealerLinks(container) {
  container.innerHTML = '';
  
  if (activeDealerships.length === 0) {
    container.innerHTML = '<p style="color:#999;text-align:center;padding:20px;">No dealerships added yet</p>';
    return;
  }
  
  activeDealerships.forEach(dealer => {
    const card = createDealerCard(dealer);
    container.appendChild(card);
  });
}

/**
 * Create supplier card
 */
function createSupplierCard(supplier) {
  const linkCard = document.createElement('div');
  linkCard.className = 'supplier-link-card';
  linkCard.setAttribute('data-supplier', supplier.name);
  linkCard.setAttribute('title', `Open ${supplier.name}`);
  
  const logoWrapper = document.createElement('div');
  logoWrapper.className = 'supplier-logo-wrapper';
  
  const logo = document.createElement('img');
  logo.src = supplier.logo;
  logo.alt = supplier.name;
  logo.className = 'supplier-logo';
  logo.onerror = () => {
    if (supplier.fallbackLogo) {
      logoWrapper.innerHTML = `<span class="supplier-fallback-icon">${supplier.fallbackLogo}</span>`;
    }
  };
  
  logoWrapper.appendChild(logo);
  
  const nameLabel = document.createElement('div');
  nameLabel.className = 'supplier-name';
  nameLabel.textContent = supplier.name;
  
  linkCard.appendChild(logoWrapper);
  linkCard.appendChild(nameLabel);
  linkCard.addEventListener('click', () => handleSupplierClick(supplier));
  
  return linkCard;
}

/**
 * Create dealer card
 */
function createDealerCard(dealer) {
  const linkCard = document.createElement('div');
  linkCard.className = 'supplier-link-card';
  linkCard.setAttribute('data-dealer', dealer.id);
  linkCard.setAttribute('title', `Open ${dealer.name} in new tab`);
  
  const logoWrapper = document.createElement('div');
  logoWrapper.className = 'supplier-logo-wrapper';
  
  // Use manufacturer logo
  const manufacturerInfo = MANUFACTURERS[dealer.manufacturer];
  const logo = document.createElement('img');
  logo.src = manufacturerInfo?.logo || 'assets/Manufacturers/generic-dealer.png';
  logo.alt = dealer.manufacturer;
  logo.className = 'supplier-logo';
  logo.onerror = () => {
    logoWrapper.innerHTML = '<span class="supplier-fallback-icon">🏢</span>';
  };
  
  logoWrapper.appendChild(logo);
  
  const nameLabel = document.createElement('div');
  nameLabel.className = 'supplier-name';
  nameLabel.textContent = dealer.name;
  nameLabel.style.fontSize = '0.85rem'; // Slightly smaller for long dealer names
  
  linkCard.appendChild(logoWrapper);
  linkCard.appendChild(nameLabel);
  linkCard.addEventListener('click', () => handleDealerClick(dealer));
  
  return linkCard;
}

/**
 * Show Add Dealer Modal
 */
function showAddDealerModal() {
  let modal = document.getElementById('addDealerModal');
  if (modal) modal.remove();
  
  const { city, state } = getShopInfo();
  
  const modalHTML = `
    <div id="addDealerModal" style="position:fixed;top:0;left:0;width:100vw;height:100vh;background:rgba(0,0,0,0.5);z-index:100003;display:flex;align-items:center;justify-content:center;">
      <div class="card" style="max-width:600px;width:95%;max-height:80vh;overflow-y:auto;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
          <h3 style="margin:0;">Add Local Dealership</h3>
          <button class="btn" onclick="document.getElementById('addDealerModal').remove()">×</button>
        </div>
        
        <div style="margin-bottom:20px;">
          <label style="display:block;margin-bottom:8px;font-weight:600;">Select Manufacturer:</label>
          <select id="dealerManufacturer" class="form-control" style="width:100%;padding:10px;border:1px solid #ddd;border-radius:6px;">
            <option value="">-- Select Brand --</option>
            ${Object.keys(MANUFACTURERS).sort().map(m => `<option value="${m}">${m}</option>`).join('')}
          </select>
        </div>
        
        <div style="margin-bottom:20px;">
          <p style="color:#666;margin:0;">Search location: <strong>${city}, ${state}</strong></p>
        </div>
        
        <button id="searchDealerBtn" class="btn primary" style="width:100%;padding:12px;" disabled>
          Search Dealerships
        </button>
        
        <div id="dealerSearchResults" style="margin-top:20px;"></div>
      </div>
    </div>
  `;
  
  document.body.insertAdjacentHTML('beforeend', modalHTML);
  
  // Enable search button when manufacturer is selected
  document.getElementById('dealerManufacturer').onchange = (e) => {
    document.getElementById('searchDealerBtn').disabled = !e.target.value;
  };
  
  // Handle search
  document.getElementById('searchDealerBtn').onclick = async () => {
    const manufacturer = document.getElementById('dealerManufacturer').value;
    if (!manufacturer) return;
    
    await searchDealerships(manufacturer, `${city}, ${state}`);
  };
}

/**
 * Search dealerships via API
 */
async function searchDealerships(manufacturer, location) {
  const resultsDiv = document.getElementById('dealerSearchResults');
  const searchBtn = document.getElementById('searchDealerBtn');
  
  searchBtn.disabled = true;
  searchBtn.textContent = 'Searching...';
  resultsDiv.innerHTML = '<p style="text-align:center;color:#666;">🔍 Searching for dealerships...</p>';
  
  try {
    let response;
    let data;
    let isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    
    // Try production API first (for both local and live)
    try {
      console.log('🔍 Trying production API...');
      const prodUrl = isLocal ? 'https://xpose.management/api/search-dealers' : '/api/search-dealers';
      
      response = await fetch(prodUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ manufacturer, location, shopId: getShopInfo().shopId })
      });
      
      // Check if we got HTML instead of JSON (404 error page)
      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        throw new Error('API endpoint not available - got HTML response');
      }
      
      data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || `HTTP ${response.status}: Search failed`);
      }
      
      console.log('✅ Production API success');
    } catch (prodError) {
      console.warn('❌ Production API failed:', prodError.message);
      
      // If local development, try the local stripe-server as fallback
      if (isLocal) {
        console.log('🔄 Trying local stripe-server fallback...');
        try {
          response = await fetch('http://localhost:3000/api/search-dealers', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ manufacturer, location, shopId: getShopInfo().shopId })
          });
          
          const contentType = response.headers.get('content-type');
          if (!contentType || !contentType.includes('application/json')) {
            throw new Error('Local API endpoint not available');
          }
          
          data = await response.json();
          
          if (!response.ok) {
            throw new Error(data.error || `HTTP ${response.status}: Local API failed`);
          }
          
          console.log('✅ Local API success');
        } catch (localError) {
          console.error('❌ Local API also failed:', localError.message);
          throw new Error('Both production and local APIs failed. Please check API configuration.');
        }
      } else {
        // On production, re-throw the original error
        throw prodError;
      }
    }
    
    if (data.results && data.results.length > 0) {
      displaySearchResults(data.results, manufacturer);
    } else {
      showNoResultsMessage(manufacturer);
    }
    
  } catch (error) {
    console.error('Search error:', error);
    
    if (error.message.includes('Unexpected token') || error.message.includes('API endpoint not available')) {
      // API not available - show manual option
      resultsDiv.innerHTML = `
        <p style="color:#666;text-align:center;margin-bottom:20px;">Dealer search not available. Add manually instead.</p>
        <button class="btn primary" onclick="addManualDealer('${manufacturer}')" style="width:100%;">
          Add ${manufacturer} Dealer Manually
        </button>
      `;
    } else {
      showNoResultsMessage(manufacturer);
    }
  } finally {
    searchBtn.disabled = false;
    searchBtn.textContent = 'Search Dealerships';
  }
}

/**
 * Show no results message with manual option
 */
function showNoResultsMessage(manufacturer) {
  const resultsDiv = document.getElementById('dealerSearchResults');
  if (resultsDiv) {
    resultsDiv.innerHTML = `
      <p style="color:#666;text-align:center;margin-bottom:20px;">No dealerships found in this area. Try a nearby city.</p>
      <button class="btn primary" onclick="addManualDealer('${manufacturer}')" style="width:100%;">
        Add ${manufacturer} Dealer Manually
      </button>
    `;
  }
}

/**
 * Display search results
 */
function displaySearchResults(results, manufacturer) {
  const resultsDiv = document.getElementById('dealerSearchResults');
  
  if (!results || results.length === 0) {
    resultsDiv.innerHTML = '<p style="color:#888;text-align:center;">No dealerships found. Try a different search.</p>';
    return;
  }
  
  resultsDiv.innerHTML = '<h4 style="margin:0 0 12px 0;">Select a dealership:</h4>';
  
  results.forEach(result => {
    const item = document.createElement('div');
    item.style.cssText = 'padding:12px;border:1px solid #e5e5e5;border-radius:8px;margin-bottom:8px;cursor:pointer;transition:background 0.2s;';
    item.onmouseover = () => item.style.background = '#f5f5f5';
    item.onmouseout = () => item.style.background = 'transparent';
    
    item.innerHTML = `
      <div style="font-weight:600;margin-bottom:4px;">${result.title}</div>
      <div style="font-size:0.9rem;color:#666;margin-bottom:4px;">${result.snippet}</div>
      <div style="font-size:0.85rem;color:#0066cc;">${result.link}</div>
    `;
    
    item.onclick = () => saveDealership({
      name: result.title,
      manufacturer: manufacturer,
      website: result.link,
      snippet: result.snippet
    });
    
    resultsDiv.appendChild(item);
  });
}

/**
 * Save dealership to Supabase
 */
async function saveDealership(dealerData) {
  const { shopId } = getShopInfo();
  if (!shopId) {
    alert('Shop ID not found');
    return;
  }
  
  try {
    const { supabase } = await import('../helpers/supabase.js');
    
    const { data, error } = await supabase
      .from('dealerships')
      .insert({
        shop_id: shopId,
        name: dealerData.name,
        manufacturer: dealerData.manufacturer,
        website: dealerData.website,
        google_snippet: dealerData.snippet,
        is_active: true
      })
      .select()
      .single();
    
    if (error) throw error;
    
    // Add to active list
    activeDealerships.unshift(data);
    
    // Re-render
    const container = document.getElementById('dealerLinksContainer');
    if (container) renderDealerLinks(container);
    
    // Close modal
    document.getElementById('addDealerModal').remove();
    
    // Show notification
    if (typeof showNotification === 'function') {
      showNotification(`${dealerData.name} added!`, 'success');
    }
    
  } catch (error) {
    console.error('Save error:', error);
    alert('Failed to save dealership');
  }
}

/**
 * Handle dealer card click
 */
function handleDealerClick(dealer) {
  console.log(`Opening ${dealer.name}...`);
  
  // Open dealer website
  if (dealer.website) {
    window.open(dealer.website, '_blank', 'noopener,noreferrer');
  }
  
  // Open part pricing modal
  setTimeout(() => {
    openPartPricingModalForSupplier(dealer.name);
  }, 100);
}

/**
 * Show Edit Dealer Modal
 */
async function showEditDealerModal() {
  await loadDealerships(); // Refresh list
  
  let modal = document.getElementById('editDealerModal');
  if (modal) modal.remove();
  
  const modalHTML = `
    <div id="editDealerModal" style="position:fixed;top:0;left:0;width:100vw;height:100vh;background:rgba(0,0,0,0.5);z-index:100003;display:flex;align-items:center;justify-content:center;">
      <div class="card" style="max-width:500px;width:95%;max-height:80vh;overflow-y:auto;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
          <h3 style="margin:0;">Edit Dealerships</h3>
          <button class="btn" onclick="document.getElementById('editDealerModal').remove()">×</button>
        </div>
        <p style="color:#666;margin-bottom:16px;">Click to remove dealerships:</p>
        <div id="editDealersList"></div>
      </div>
    </div>
  `;
  
  document.body.insertAdjacentHTML('beforeend', modalHTML);
  
  const editList = document.getElementById('editDealersList');
  
  if (activeDealerships.length === 0) {
    editList.innerHTML = '<p style="color:#888;text-align:center;padding:24px;">No dealerships added yet.</p>';
    return;
  }
  
  editList.innerHTML = '';
  activeDealerships.forEach(dealer => {
    const item = document.createElement('div');
    item.style.cssText = 'display:flex;align-items:center;gap:12px;padding:12px;border:1px solid #e5e5e5;border-radius:8px;margin-bottom:8px;';
    
    const manufacturerInfo = MANUFACTURERS[dealer.manufacturer];
    const logo = document.createElement('img');
    logo.src = manufacturerInfo?.logo || '';
    logo.alt = dealer.manufacturer;
    logo.style.cssText = 'width:40px;height:40px;object-fit:contain;';
    logo.onerror = () => logo.style.display = 'none';
    
    const name = document.createElement('div');
    name.style.cssText = 'flex:1;font-weight:600;';
    name.textContent = dealer.name;
    
    const removeBtn = document.createElement('button');
    removeBtn.className = 'btn small danger';
    removeBtn.textContent = 'Remove';
    removeBtn.onclick = () => removeDealership(dealer.id);
    
    item.appendChild(logo);
    item.appendChild(name);
    item.appendChild(removeBtn);
    editList.appendChild(item);
  });
}

/**
 * Remove dealership
 */
async function removeDealership(dealerId) {
  try {
    const { supabase } = await import('../helpers/supabase.js');
    
    const { error } = await supabase
      .from('dealerships')
      .delete()
      .eq('id', dealerId);
    
    if (error) throw error;
    
    // Remove from active list
    activeDealerships = activeDealerships.filter(d => d.id !== dealerId);
    
    // Re-render
    const container = document.getElementById('dealerLinksContainer');
    if (container) renderDealerLinks(container);
    
    // Refresh edit modal
    document.getElementById('editDealerModal').remove();
    showEditDealerModal();
    
    if (typeof showNotification === 'function') {
      showNotification('Dealership removed', 'success');
    }
    
  } catch (error) {
    console.error('Remove error:', error);
    alert('Failed to remove dealership');
  }
}

/**
 * Handle supplier click
 */
function handleSupplierClick(supplier) {
  // Open supplier website in new tab
  if (supplier.url) {
    window.open(supplier.url, '_blank');
  }
  
  // Also open parts pricing modal for manual entry
  if (typeof window.xm_partPricingModal !== 'undefined' && window.xm_partPricingModal) {
    // Get current job ID from the page
    const jobId = getCurrentJobId();
    if (!jobId) {
      if (typeof showNotification === 'function') {
        showNotification('No job selected for adding parts', 'error');
      } else {
        alert('Please select a job first');
      }
      return;
    }
    
    // Create a manual entry part object
    const manualPart = {
      id: `manual_${Date.now()}`,
      name: '',
      part_name: '',
      part_number: '',
      supplier: supplier.name,
      manual_entry: true
    };
    
    // Show the pricing modal
    window.xm_partPricingModal.show(manualPart, jobId, () => {
      // Callback after part is added
      console.log(`Part added from ${supplier.name}`);
    });
  }
}

/**
 * Add manual dealer when search fails
 */
function addManualDealer(manufacturer) {
  const dealerData = {
    name: `${manufacturer} Dealership`,
    manufacturer: manufacturer,
    address: 'Contact for address',
    phone: '',
    website: '',
    latitude: null,
    longitude: null
  };
  
  saveDealership(dealerData);
}

/**
 * Get current job ID from the page
 */
function getCurrentJobId() {
  // Try multiple ways to get the current job ID
  if (window.currentJobId) {
    return window.currentJobId;
  }
  
  // Try to get from URL or page context
  const urlParams = new URLSearchParams(window.location.search);
  const jobIdFromUrl = urlParams.get('jobId');
  if (jobIdFromUrl) {
    return jobIdFromUrl;
  }
  
  // Try to get from active job elements
  const activeJobElement = document.querySelector('[data-job-id]');
  if (activeJobElement) {
    return activeJobElement.dataset.jobId;
  }
  
  return null;
}

/**
 * Handle dealer click
 */
function handleDealerClick(dealer) {
  // Open dealer website or show contact info
  if (dealer.website) {
    window.open(dealer.website, '_blank');
  } else if (dealer.phone) {
    // Format and dial phone number
    const cleanPhone = dealer.phone.replace(/[^\d]/g, '');
    window.open(`tel:${cleanPhone}`, '_self');
  }
}

/**
 * Show Add Supplier Modal
 */
function showAddSupplierModal() {
  let modal = document.getElementById('addSupplierModal');
  if (modal) modal.remove();
  
  const modalHTML = `
    <div id="addSupplierModal" style="position:fixed;top:0;left:0;width:100vw;height:100vh;background:rgba(0,0,0,0.5);z-index:100003;display:flex;align-items:center;justify-content:center;">
      <div class="card" style="max-width:500px;width:95%;max-height:80vh;overflow-y:auto;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
          <h3 style="margin:0;">Add Custom Supplier</h3>
          <button class="btn" onclick="document.getElementById('addSupplierModal').remove()">×</button>
        </div>
        
        <div style="margin-bottom:20px;">
          <label style="display:block;margin-bottom:8px;font-weight:600;">Supplier Name:</label>
          <input type="text" id="newSupplierName" class="form-control" placeholder="Enter supplier name">
        </div>
        
        <div style="margin-bottom:20px;">
          <label style="display:block;margin-bottom:8px;font-weight:600;">Website URL:</label>
          <input type="url" id="newSupplierUrl" class="form-control" placeholder="https://example.com">
        </div>
        
        <div style="margin-bottom:20px;">
          <label style="display:block;margin-bottom:8px;font-weight:600;">Logo:</label>
          <div id="logoDropZone" style="border:2px dashed #ccc;border-radius:8px;padding:30px;text-align:center;cursor:pointer;transition:all 0.2s;">
            <div id="logoPreview" style="display:none;margin-bottom:15px;">
              <img id="logoImg" style="max-width:80px;max-height:80px;object-fit:contain;border-radius:6px;">
            </div>
            <div id="logoDropText">
              <p style="margin:0;color:#666;font-size:0.9rem;">📁 Drag & drop logo here or click to upload</p>
              <p style="margin:5px 0 0 0;color:#999;font-size:0.8rem;">Supports JPG, PNG, WebP (max 2MB)</p>
            </div>
            <input type="file" id="logoFileInput" accept="image/*" style="display:none;">
          </div>
        </div>
        
        <button id="saveSupplierBtn" class="btn primary" style="width:100%;padding:12px;">
          Add Supplier
        </button>
      </div>
    </div>
  `;
  
  document.body.insertAdjacentHTML('beforeend', modalHTML);
  
  let uploadedLogo = null;
  
  // Drag and drop functionality
  const dropZone = document.getElementById('logoDropZone');
  const fileInput = document.getElementById('logoFileInput');
  const logoPreview = document.getElementById('logoPreview');
  const logoImg = document.getElementById('logoImg');
  const logoDropText = document.getElementById('logoDropText');
  
  // Click to upload
  dropZone.onclick = () => fileInput.click();
  
  // Handle file selection
  fileInput.onchange = (e) => handleFile(e.target.files[0]);
  
  // Drag and drop events
  dropZone.ondragover = (e) => {
    e.preventDefault();
    dropZone.style.borderColor = '#0066cc';
    dropZone.style.backgroundColor = '#f0f9ff';
  };
  
  dropZone.ondragleave = (e) => {
    e.preventDefault();
    dropZone.style.borderColor = '#ccc';
    dropZone.style.backgroundColor = 'transparent';
  };
  
  dropZone.ondrop = (e) => {
    e.preventDefault();
    dropZone.style.borderColor = '#ccc';
    dropZone.style.backgroundColor = 'transparent';
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) {
      handleFile(file);
    }
  };
  
  function handleFile(file) {
    if (!file || !file.type.startsWith('image/')) {
      alert('Please select a valid image file');
      return;
    }
    
    if (file.size > 2 * 1024 * 1024) {
      alert('File size must be less than 2MB');
      return;
    }
    
    const reader = new FileReader();
    reader.onload = (e) => {
      uploadedLogo = e.target.result;
      logoImg.src = uploadedLogo;
      logoPreview.style.display = 'block';
      logoDropText.innerHTML = '<p style="margin:0;color:#059669;font-size:0.9rem;">✅ Logo uploaded successfully</p>';
    };
    reader.readAsDataURL(file);
  }
  
  // Handle save
  document.getElementById('saveSupplierBtn').onclick = () => {
    const name = document.getElementById('newSupplierName').value.trim();
    const url = document.getElementById('newSupplierUrl').value.trim();
    
    if (!name) {
      alert('Please enter a supplier name');
      return;
    }
    
    if (!url) {
      alert('Please enter a website URL');
      return;
    }
    
    // Use uploaded logo or default
    const logo = uploadedLogo || 'assets/Parts Suppliers/Customsupplier.webp';
    
    addSupplier(name, url, logo);
  };
}

/**
 * Show Edit Supplier Modal
 */
function showEditSupplierModal() {
  let modal = document.getElementById('editSupplierModal');
  if (modal) modal.remove();
  
  const modalHTML = `
    <div id="editSupplierModal" style="position:fixed;top:0;left:0;width:100vw;height:100vh;background:rgba(0,0,0,0.5);z-index:100003;display:flex;align-items:center;justify-content:center;">
      <div class="card" style="max-width:600px;width:95%;max-height:80vh;overflow-y:auto;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
          <h3 style="margin:0;">Edit Visible Suppliers</h3>
          <button class="btn" onclick="document.getElementById('editSupplierModal').remove()">×</button>
        </div>
        
        <div id="editSupplierList"></div>
        
        <button onclick="document.getElementById('editSupplierModal').remove()" class="btn primary" style="width:100%;margin-top:20px;">
          Done
        </button>
      </div>
    </div>
  `;
  
  document.body.insertAdjacentHTML('beforeend', modalHTML);
  
  // Populate list
  const editList = document.getElementById('editSupplierList');
  editList.innerHTML = '';
  
  SUPPLIERS.forEach(supplier => {
    const item = document.createElement('div');
    item.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:12px;border:1px solid #e5e5e5;border-radius:8px;margin-bottom:8px;';
    
    // Left side - Logo and Name
    const leftSide = document.createElement('div');
    leftSide.style.cssText = 'display:flex;align-items:center;gap:12px;';
    
    const logo = document.createElement('img');
    logo.src = supplier.logo;
    logo.alt = supplier.name;
    logo.style.cssText = 'width:40px;height:40px;object-fit:contain;';
    logo.onerror = () => {
      if (supplier.fallbackLogo) {
        logo.style.display = 'none';
        const fallback = document.createElement('span');
        fallback.textContent = supplier.fallbackLogo;
        fallback.style.cssText = 'width:40px;height:40px;display:flex;align-items:center;justify-content:center;font-size:1.5rem;';
        leftSide.replaceChild(fallback, logo);
      } else {
        logo.style.display = 'none';
      }
    };
    
    const name = document.createElement('div');
    name.style.cssText = 'font-weight:600;';
    name.textContent = supplier.name;
    
    leftSide.appendChild(logo);
    leftSide.appendChild(name);
    
    // Right side - Add/Remove button
    const isActive = activeSuppliers.includes(supplier.name);
    const actionBtn = document.createElement('button');
    actionBtn.className = isActive ? 'btn small danger' : 'btn small primary';
    actionBtn.textContent = isActive ? 'Remove' : 'Add';
    actionBtn.onclick = () => {
      if (isActive) {
        // Remove from active suppliers
        activeSuppliers = activeSuppliers.filter(s => s !== supplier.name);
        actionBtn.className = 'btn small primary';
        actionBtn.textContent = 'Add';
      } else {
        // Add to active suppliers
        if (!activeSuppliers.includes(supplier.name)) {
          activeSuppliers.push(supplier.name);
        }
        actionBtn.className = 'btn small danger';
        actionBtn.textContent = 'Remove';
      }
      localStorage.setItem('activeSuppliers', JSON.stringify(activeSuppliers));
      const container = document.getElementById('supplierLinksContainer');
      if (container) renderSupplierLinks(container);
    };
    
    item.appendChild(leftSide);
    item.appendChild(actionBtn);
    editList.appendChild(item);
  });
}

/**
 * Add supplier
 */
function addSupplier(name, url, logo = 'assets/Parts Suppliers/Customsupplier.webp') {
  // Add to SUPPLIERS array
  SUPPLIERS.push({
    name: name,
    logo: logo,
    url: url,
    visible: true,
    custom: true
  });
  
  // Add to active suppliers
  if (!activeSuppliers.includes(name)) {
    activeSuppliers.push(name);
  }
  
  // Save to localStorage
  localStorage.setItem('activeSuppliers', JSON.stringify(activeSuppliers));
  localStorage.setItem('customSuppliers', JSON.stringify(SUPPLIERS.filter(s => s.custom)));
  
  // Re-render
  const container = document.getElementById('supplierLinksContainer');
  if (container) renderSupplierLinks(container);
  
  // Close modal
  document.getElementById('addSupplierModal').remove();
  
  if (typeof showNotification === 'function') {
    showNotification('Supplier added successfully!', 'success');
  }
}

// ... (keep all existing supplier functions: showAddSupplierModal, showEditSupplierModal, 
//      addSupplier, removeSupplier, handleSupplierClick, openPartPricingModalForSupplier, etc.)

// Export for use in jobs.js
if (typeof window !== 'undefined') {
  window.supplierLinks = {
    init: initSupplierLinks,
    onModalOpened: () => {
      if (!document.getElementById('supplierDealerSection')) {
        initSupplierLinks();
      }
    }
  };
}

// Auto-initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initSupplierLinks);
} else {
  initSupplierLinks();
}
