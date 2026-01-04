/**
 * Parts Modal Integration
 * Handles the parts finder modal with catalog integration
 * NOW WITH FRESH INVENTORY FETCHING!
 */

// Try to read centralized threshold from globals; fall back to 3 for non-module usage
const INVENTORY_LOW_THRESHOLD = (typeof window !== 'undefined' && window.INVENTORY_LOW_THRESHOLD) || 3;

class PartsModalHandler {
  constructor() {
    this.currentJob = null;
    this.selectedYear = null;
    this.selectedMake = null;
    this.selectedModel = null;
    this._inventoryResults = [];
    this.init();
  }

  /**
   * Display inventory parts (ALWAYS fetch fresh from Supabase)
   */
  async displayInventoryResults() {
    const resultsDiv = document.getElementById('catalogResults');
    if (!resultsDiv) return;
    
    // Show loading
    resultsDiv.innerHTML = '<p class="notice" style="text-align: center;">Loading inventory...</p>';
    
    let inv = [];
    let folders = [];
    
    // ALWAYS fetch fresh data from Supabase
    try {
      let shopId = null;
      try { shopId = JSON.parse(localStorage.getItem('xm_session')||'{}').shopId || null; } catch(e){}
      
      if (shopId) {
        console.log('🔄 Fetching FRESH inventory from Supabase...');
        const { supabase } = await import('../helpers/supabase.js');
        
        // Fetch regular inventory items
        const { data: invItems, error: invError } = await supabase
          .from('inventory_items')
          .select('*')
          .eq('shop_id', shopId)
          .order('name');
        
        if (!invError && invItems) {
          inv = invItems;
          console.log(`✅ Loaded ${inv.length} inventory items from Supabase`);
        }
        
        // Fetch folder inventory
        const { data: folderData, error: folderError } = await supabase
          .from('inventory_folders')
          .select(`
            *,
            items:inventory_folder_items(*)
          `)
          .eq('shop_id', shopId)
          .order('name');
        
        if (!folderError && folderData) {
          folders = folderData;
          console.log(`✅ Loaded ${folders.length} inventory folders from Supabase`);
        }
        
        // Update localStorage cache with fresh data
        try {
          localStorage.setItem('inventory', JSON.stringify(inv));
          localStorage.setItem('inventoryFolders', JSON.stringify(folders));
          console.log('✅ Updated localStorage cache with fresh inventory');
        } catch(e) {
          console.warn('Could not update localStorage:', e);
        }
      } else {
        // Fallback to localStorage if no shopId
        console.warn('⚠️ No shopId found, falling back to localStorage');
        try { inv = JSON.parse(localStorage.getItem('inventory') || '[]'); } catch (e) { inv = []; }
        try { folders = JSON.parse(localStorage.getItem('inventoryFolders') || '[]'); } catch (e) { folders = []; }
      }
    } catch(e) {
      console.error('❌ Failed to fetch inventory from Supabase:', e);
      // Fallback to localStorage
      try { inv = JSON.parse(localStorage.getItem('inventory') || '[]'); } catch (e2) { inv = []; }
      try { folders = JSON.parse(localStorage.getItem('inventoryFolders') || '[]'); } catch (e2) { folders = []; }
    }

    const combined = [];
    console.debug('[PartsModalHandler] inventory count:', (inv||[]).length, 'folders count:', (folders||[]).length);
    
    inv.forEach((it, i) => combined.push({
      source: 'inv',
      index: i,
      name: it.name,
      part_number: it.part_number || '',
      qty: it.qty || 0,
      description: it.description || '',
      cost_price: (typeof it.cost_price !== 'undefined') ? it.cost_price : null,
      sell_price: (typeof it.sell_price !== 'undefined') ? it.sell_price : null,
      markup_percent: (typeof it.markup_percent !== 'undefined') ? it.markup_percent : null,
      original_id: (typeof it.id !== 'undefined') ? it.id : null
    }));
    
    folders.forEach((f, fi) => {
      (f.items || []).forEach((it, ti) => {
        combined.push({
          source: 'folder',
          folderIndex: fi,
          typeIndex: ti,
          name: `${f.name} - ${it.name}`,
          part_number: it.part_number || '',
          qty: it.qty || 0,
          description: it.description || '',
          cost_price: (typeof it.cost_price !== 'undefined') ? it.cost_price : null,
          sell_price: (typeof it.sell_price !== 'undefined') ? it.sell_price : null,
          markup_percent: (typeof it.markup_percent !== 'undefined') ? it.markup_percent : null,
          original_id: (typeof it.id !== 'undefined') ? it.id : null
        });
      });
    });

    if (!combined.length) {
      resultsDiv.innerHTML = `<p class="notice" style="text-align:center; padding:2rem 1rem; color:var(--muted);">No inventory parts found.</p>`;
      return;
    }

    this._inventoryResults = combined;

    let html = '<div style="display: grid; gap: 12px;">';
    combined.forEach((item, ridx) => {
      const q = parseInt(item.qty, 10) || 0;
      const lowThreshold = typeof INVENTORY_LOW_THRESHOLD === 'number' ? INVENTORY_LOW_THRESHOLD : 3;
      let badgeBg = '#10b981'; // green
      if (q <= lowThreshold) badgeBg = '#ef4444';
      else if (q === lowThreshold + 1) badgeBg = '#f59e0b';
      html += `
        <div class="part-result-card" style="background: var(--card-bg); border: 1px solid var(--line); border-radius: 8px; padding: 12px;">
          <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 8px;">
            <div>
              <strong>${this.escapeHtml(item.name)}</strong>
              ${item.part_number ? `<br><small style="color: var(--muted);">Part #: ${this.escapeHtml(item.part_number)}</small>` : ''}
            </div>
            <span class="badge" data-inventory-item-id="${item.original_id}" style="background: ${badgeBg}; color: white; padding: 4px 8px; border-radius: 4px; font-size: 0.75rem;">
              In Stock: ${q}
            </span>
          </div>
          ${item.description ? `<p style="font-size: 0.9rem; color: var(--muted); margin: 8px 0;">${this.escapeHtml(item.description)}</p>` : ''}
          ${ (item.sell_price || item.cost_price) ? `
            <div style="font-size:0.9rem; color:var(--muted); margin-top:8px;">
              ${ item.sell_price ? `<div><strong>Price:</strong> $${Number(item.sell_price).toFixed(2)}</div>` : '' }
              ${ item.cost_price ? `<div><small>Cost:</small> $${Number(item.cost_price).toFixed(2)}</div>` : '' }
            </div>
          ` : ''}
          <div style="display: flex; justify-content: flex-end; margin-top: 8px;">
            <button class="btn info small add-inventory-part" data-ridx='${ridx}'>
              Add to Job
            </button>
          </div>
        </div>
      `;
    });
    html += '</div>';
    resultsDiv.innerHTML = html;

    // Attach click handlers
    resultsDiv.querySelectorAll('.add-inventory-part').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const ridx = parseInt(e.currentTarget.dataset.ridx, 10);
        const item = this._inventoryResults[ridx];
        if (!item) return;
        const resolvedId = (item.original_id) ? item.original_id : (item.source === 'inv' ? `inventory_${item.index}` : `folder_${item.folderIndex}_${item.typeIndex}`);
        const part = {
          id: resolvedId,
          name: item.name,
          part_number: item.part_number || '',
          qty_available: item.qty || 0,
          cost_price: item.cost_price,
          sell_price: item.sell_price,
          markup_percent: item.markup_percent,
          _source: item.source,
          _folderIndex: item.folderIndex,
          _typeIndex: item.typeIndex
        };
        this.addPartToJob(part);
      });
    });
  }

  // HTML escape helper
  escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, function(c) {
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
    });
  }

  init() {
    // Close button
    document.getElementById('closeParts')?.addEventListener('click', () => {
      this.closeModal();
    });

    // Close when clicking overlay
    const overlay = document.getElementById('partsModalOverlay');
    if (overlay) {
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
          this.closeModal();
        }
      });
    }

    // Cascading dropdowns
    document.getElementById('catalogYear')?.addEventListener('change', (e) => {
      this.selectedYear = e.target.value;
      this.loadMakes();
    });

    document.getElementById('catalogMake')?.addEventListener('change', (e) => {
      this.selectedMake = e.target.value;
      this.loadModels();
    });

    document.getElementById('catalogModel')?.addEventListener('change', (e) => {
      this.selectedModel = e.target.value;
    });

    // Search button
    document.getElementById('searchCatalogBtn')?.addEventListener('click', () => {
      this.searchParts();
    });

    // Enter key in search box
    document.getElementById('catalogSearch')?.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        this.searchParts();
      }
    });

    // Manual add button - now uses partPricingModal
    document.getElementById('openAddPartsFromFinder')?.addEventListener('click', () => {
      const jobRef = this.currentJob;
      this.closeModal();
      
      // Use partPricingModal instead of old addPartsModal
      const pricingModal = window.partPricingModal || window.xm_partPricingModal;
      
      if (pricingModal && jobRef) {
        // Create empty part object with manual_entry flag
        const manualPart = {
          manual_entry: true,
          name: '',
          part_name: '',
          part_number: '',
          id: 'manual'
        };
        
        // Get vehicle info for the job
        const vehicle = jobRef.year && jobRef.make && jobRef.model
          ? `${jobRef.year} ${jobRef.make} ${jobRef.model}`
          : null;
        
        console.log('[PartsModalHandler] Opening partPricingModal for manual entry', { jobId: jobRef.id, vehicle });
        
        // Open the part pricing modal with manual entry mode
        pricingModal.show(manualPart, jobRef.id, vehicle);
      } else {
        console.error('[PartsModalHandler] partPricingModal not available or no job');
        alert('Part pricing modal is not available. Please refresh the page.');
      }
    });

    // Inventory add button - shows inventory parts list
    document.getElementById('openInventoryPartsFromFinder')?.addEventListener('click', () => {
      try {
        this.displayInventoryResults();
      } catch (e) {
        console.error('[PartsModalHandler] failed to display inventory results', e);
      }
    });
  }

  async openModal(job) {
    this.currentJob = job;
    const modal = document.getElementById('partsModal');
    const overlay = document.getElementById('partsModalOverlay');
    if (!modal) return;

    // Store job ID in dataset for supplier links to access
    modal.dataset.currentJobId = job.id;
    modal.classList.remove('hidden');
    if (overlay) overlay.style.display = 'block';
    
    // Check if user is staff and hide supplier sections
    // Check window flag first, then try to determine from session
    let isStaffUser = window.xm_isStaffUser || false;
    if (!isStaffUser) {
      // Double check from session
      try {
        const session = JSON.parse(localStorage.getItem('xm_session') || '{}');
        isStaffUser = session.role === 'staff';
      } catch (e) {}
    }
    
    if (isStaffUser) {
      // Hide supplier column
      const supplierColumn = document.getElementById('suppliersColumn');
      if (supplierColumn) supplierColumn.style.display = 'none';
      
      // Hide dealerships column
      const dealershipsColumn = document.getElementById('dealershipsColumn');
      if (dealershipsColumn) dealershipsColumn.style.display = 'none';
      
      // Hide "Add Parts Manually" button - staff can only add from inventory or services
      const addPartsManuallyBtn = document.getElementById('openAddPartsFromFinder');
      if (addPartsManuallyBtn) addPartsManuallyBtn.style.display = 'none';
    } else {
      // Show all sections for non-staff users (owners/admins)
      const supplierColumn = document.getElementById('suppliersColumn');
      if (supplierColumn) supplierColumn.style.display = '';
      
      const dealershipsColumn = document.getElementById('dealershipsColumn');
      if (dealershipsColumn) dealershipsColumn.style.display = '';
      
      const addPartsManuallyBtn = document.getElementById('openAddPartsFromFinder');
      if (addPartsManuallyBtn) addPartsManuallyBtn.style.display = '';
    }

    const vehicleDisplay = document.getElementById('partsCurrentVehicle');
    if (vehicleDisplay) {
      const vehicleText = `${job.year || ''} ${job.make || ''} ${job.model || ''}`.trim() || 'No vehicle info';
      vehicleDisplay.textContent = vehicleText;
    }

    await this.loadYears();
    await this.loadCategories();

    if (job.year && job.make && job.model) {
      await this.prefillVehicle(job.year, job.make, job.model);
    }

    document.getElementById('catalogResults').innerHTML = '';
  }

  closeModal() {
    const modal = document.getElementById('partsModal');
    const overlay = document.getElementById('partsModalOverlay');
    if (modal) {
      modal.classList.add('hidden');
      delete modal.dataset.currentJobId;
    }
    if (overlay) overlay.style.display = 'none';
    this.currentJob = null;
  }

  async loadYears() {
    try {
      if (!window.VEHICLE_DATA) throw new Error('VEHICLE_DATA not found');
      const yearsSet = new Set();
      Object.values(window.VEHICLE_DATA).forEach(entry => {
        if (entry && Array.isArray(entry.years)) {
          const [s, e] = entry.years.map(n => Number(n) || 0);
          for (let y = s; y <= e; y++) yearsSet.add(y);
        }
        if (entry && entry.models) {
          Object.values(entry.models).forEach(range => {
            const [s2, e2] = range.map(n => Number(n) || 0);
            for (let y = s2; y <= e2; y++) yearsSet.add(y);
          });
        }
      });
      const yearArr = Array.from(yearsSet).filter(Boolean).sort((a,b)=>b-a);
      const yearSelect = document.getElementById('catalogYear');
      if (!yearSelect) {
        console.error('Year select element not found');
        return;
      }
      yearSelect.innerHTML = '<option value="">Select Year</option>';
      yearArr.forEach(year => {
        yearSelect.innerHTML += `<option value="${year}">${year}</option>`;
      });
      console.log(`Loaded ${yearArr.length} years into dropdown`);
    } catch (error) {
      console.error('Error loading years:', error);
    }
  }

  async loadMakes() {
    const makeSelect = document.getElementById('catalogMake');
    const modelSelect = document.getElementById('catalogModel');
    if (!makeSelect || !modelSelect) return;
    makeSelect.innerHTML = '<option value="">Select Make</option>';
    modelSelect.innerHTML = '<option value="">Select Model</option>';
    modelSelect.disabled = true;
    this.selectedMake = null;
    this.selectedModel = null;
    if (!this.selectedYear) {
      makeSelect.disabled = true;
      return;
    }
    try {
      if (!window.VEHICLE_DATA) throw new Error('VEHICLE_DATA not found');
      const makesSet = new Set();
      Object.keys(window.VEHICLE_DATA).forEach(make => {
        const entry = window.VEHICLE_DATA[make];
        if (!entry) return;
        if (Array.isArray(entry.years)) {
          const [s, e] = entry.years.map(n => Number(n) || 0);
          const y = Number(this.selectedYear);
          if (y >= s && y <= e) makesSet.add(make);
        } else if (entry.models) {
          const y = Number(this.selectedYear);
          Object.values(entry.models).forEach(range => {
            const [s2,e2] = range.map(n=>Number(n)||0);
            if (y >= s2 && y <= e2) makesSet.add(make);
          });
        }
      });
      Array.from(makesSet).sort().forEach(make => {
        makeSelect.innerHTML += `<option value="${make}">${make}</option>`;
      });
      makeSelect.disabled = false;
    } catch (error) {
      console.error('Error loading makes:', error);
    }
  }

  async loadModels() {
    const modelSelect = document.getElementById('catalogModel');
    if (!modelSelect) return;
    modelSelect.innerHTML = '<option value="">Select Model</option>';
    this.selectedModel = null;
    if (!this.selectedYear || !this.selectedMake) {
      modelSelect.disabled = true;
      return;
    }
    try {
      if (!window.VEHICLE_DATA || !window.VEHICLE_DATA[this.selectedMake]) throw new Error('VEHICLE_DATA not found for selected make');
      const modelsSet = new Set();
      const modelsObj = window.VEHICLE_DATA[this.selectedMake].models || {};
      const y = Number(this.selectedYear);
      Object.keys(modelsObj).forEach(model => {
        const range = modelsObj[model];
        const [s,e] = (range || []).map(n=>Number(n)||0);
        if (!s || !e || (y >= s && y <= e)) {
          modelsSet.add(model);
        }
      });
      Array.from(modelsSet).sort().forEach(model => {
        modelSelect.innerHTML += `<option value="${model}">${model}</option>`;
      });
      modelSelect.disabled = false;
    } catch (error) {
      console.error('Error loading models:', error);
    }
  }

  async loadCategories() {
    try {
      const { supabase } = await import('../helpers/supabase.js');
      const { data, error } = await supabase
        .from('catalog_categories')
        .select('*')
        .order('name');

      const categorySelect = document.getElementById('catalogCategory');
      if (!categorySelect) return;

      categorySelect.innerHTML = '<option value="">All Categories</option>';
      if (error) throw error;
      data.forEach(cat => {
        categorySelect.innerHTML += `<option value="${cat.id}">${cat.name}</option>`;
      });
    } catch (error) {
      console.error('Error loading categories:', error);
    }
  }

  async prefillVehicle(year, make, model) {
    const yearSelect = document.getElementById('catalogYear');
    if (yearSelect) {
      yearSelect.value = year;
      this.selectedYear = year;
    }

    await this.loadMakes();
    const makeSelect = document.getElementById('catalogMake');
    if (makeSelect) {
      makeSelect.value = make;
      this.selectedMake = make;
    }

    await this.loadModels();
    const modelSelect = document.getElementById('catalogModel');
    if (modelSelect) {
      modelSelect.value = model;
      this.selectedModel = model;
    }
  }

  async searchParts() {
    const searchTerm = document.getElementById('catalogSearch')?.value || '';
    const category = document.getElementById('catalogCategory')?.value || '';
    const resultsDiv = document.getElementById('catalogResults');
    
    if (!resultsDiv) return;

    resultsDiv.innerHTML = '<p class="notice" style="text-align: center;">Searching...</p>';

    try {
      const { supabase } = await import('../helpers/supabase.js');
      let mainQuery = supabase
        .from('catalog_parts')
        .select(`*, category:catalog_categories(name)`);

      if (category) mainQuery = mainQuery.eq('category_id', category);
      if (searchTerm) {
        mainQuery = mainQuery.or(`part_name.ilike.%${searchTerm}%,part_number.ilike.%${searchTerm}%,description.ilike.%${searchTerm}%`);
      }
      mainQuery = mainQuery.order('part_name').limit(100);

      const { data: allParts, error: mainErr } = await mainQuery;
      if (mainErr) throw mainErr;

      if (Array.isArray(allParts) && allParts.length > 0) {
        this.displayResults(allParts);
        return;
      }

      // Fallback to universal catalog
      let uQuery = supabase
        .from('universal_parts_catalog')
        .select(`*`);

      if (searchTerm) {
        uQuery = uQuery.or(`name.ilike.%${searchTerm}%,part_number.ilike.%${searchTerm}%,description.ilike.%${searchTerm}%`);
      }
      if (category) {
        uQuery = uQuery.eq('category', category);
      }
      
      uQuery = uQuery.order('name').limit(50);

      const { data: uData, error: uErr } = await uQuery;
      if (uErr) throw uErr;

      if (Array.isArray(uData) && uData.length > 0) {
        const normalized = uData.map(r => ({
          id: r.id,
          part_name: r.name || r.part_name || '',
          part_number: r.part_number || '',
          description: r.description || r.notes || '',
          year: r.year || null,
          make: r.make || null,
          model: r.model || null,
          category: { name: r.category_name || r.category || 'Part' }
        }));
        this.displayResults(normalized);
        return;
      }

      resultsDiv.innerHTML = `
        <p class="notice" style="text-align: center; padding: 2rem 1rem;">
          <strong>No parts found. Try adjusting your search.</strong>
        </p>
      `;
    } catch (error) {
      console.error('Error searching parts:', error);
      resultsDiv.innerHTML = '<p class="notice error">Search failed. Please try again.</p>';
    }
  }

  displayResults(parts) {
    const resultsDiv = document.getElementById('catalogResults');
    if (!resultsDiv) return;

    if (!parts || parts.length === 0) {
      resultsDiv.innerHTML = `
        <p class="notice" style="text-align: center; padding: 2rem 1rem;">
          <strong>No parts found.</strong>
        </p>
      `;
      return;
    }

    const jobVehicle = this.currentJob ? 
      `${this.currentJob.year || ''} ${this.currentJob.make || ''} ${this.currentJob.model || ''}`.trim() : '';

    let html = '<div style="display: grid; gap: 12px;">';
    
    parts.forEach(part => {
      let cleanPartName = part.part_name;
      cleanPartName = cleanPartName.replace(/\s*-\s*\d{4}\s+[\w\s]+$/i, '').trim();
      cleanPartName = cleanPartName.replace(/\s*-\s*[A-Z][\w\s]+$/i, '').trim();
      
      const displayName = jobVehicle ? `${cleanPartName} - ${jobVehicle}` : cleanPartName;
      
      let cleanDescription = part.description || '';
      cleanDescription = cleanDescription.replace(/for\s+[A-Z][\w\s]+around\s+model\s+years\s+\d{4}[-–]\d{4}/gi, '');
      cleanDescription = cleanDescription.replace(/for\s+\d{4}\s+[A-Z][\w\s]+/gi, '');
      cleanDescription = cleanDescription.replace(/for\s+[A-Z][\w\s]+\d{4}[-–]\d{4}/gi, '');
      cleanDescription = cleanDescription.trim();
      cleanDescription = cleanDescription.replace(/^[,\.\s]+|[,\.\s]+$/g, '').trim();
      
      html += `
        <div class="part-result-card" style="background: var(--card-bg); border: 1px solid var(--line); border-radius: 8px; padding: 12px;">
          <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 8px;">
            <div>
              <strong>${displayName}</strong>
              ${part.part_number ? `<br><small style="color: var(--muted);">Part #: ${part.part_number}</small>` : ''}
            </div>
            <span class="badge" style="background: var(--accent); color: white; padding: 4px 8px; border-radius: 4px; font-size: 0.75rem;">
              ${part.category?.name || 'Part'}
            </span>
          </div>
          ${cleanDescription ? `<p style="font-size: 0.9rem; color: var(--muted); margin: 8px 0;">${cleanDescription}</p>` : ''}
          <div style="display: flex; justify-content: flex-end; margin-top: 8px;">
            <button class="btn info small add-catalog-part" data-part='${JSON.stringify(part)}'>
              Add to Job
            </button>
          </div>
        </div>
      `;
    });
    
    html += '</div>';
    resultsDiv.innerHTML = html;

    resultsDiv.querySelectorAll('.add-catalog-part').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const partData = JSON.parse(e.target.dataset.part);
        this.addPartToJob(partData);
      });
    });
  }

  async addPartToJob(part) {
    if (!this.currentJob) {
      alert('No job selected');
      return;
    }

    let jobVehicle = null;
    try {
      if (this.currentJob.year || this.currentJob.make || this.currentJob.model) {
        jobVehicle = [this.currentJob.year, this.currentJob.make, this.currentJob.model].filter(Boolean).join(' ');
      } else if (this.currentJob.vehicle) {
        jobVehicle = this.currentJob.vehicle;
      }
    } catch (e) {
      console.warn('Could not get vehicle from job:', e);
    }

    const ppm = window.xm_partPricingModal || window.partPricingModal;
    if (ppm) {
      ppm.show(part, this.currentJob.id, jobVehicle, () => {
        this.closeModal();
        if (window.showNotification) {
          window.showNotification('Part added to job!', 'success');
        }
        if (window.loadJobs) {
          window.loadJobs();
        }
      });
    } else {
      const quantity = prompt('Quantity:', '1');
      const cost = prompt('Cost Price:', '0.00');
      const sell = prompt('Sell Price:', '0.00');
      
      if (quantity && cost && sell) {
        this.savePartToJob(part, quantity, cost, sell);
      }
    }
  }

  async savePartToJob(part, quantity, cost, sell) {
    try {
      const session = JSON.parse(localStorage.getItem('xm_session') || '{}');
      const shopId = session.shopId;

      const API_BASE = (window.XM_API_BASE !== 'undefined') ? window.XM_API_BASE : '';
      const response = await fetch(`${API_BASE}/api/catalog/add-part`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobId: this.currentJob.id,
          partId: part.id,
          quantity: parseInt(quantity),
          costPrice: parseFloat(cost),
          sellPrice: parseFloat(sell),
          shopId: shopId
        })
      });

      if (response.ok) {
        this.closeModal();
        if (window.showNotification) {
          window.showNotification('Part added successfully!', 'success');
        }
        if (window.loadJobs) {
          window.loadJobs();
        }
      } else {
        throw new Error('Failed to add part');
      }
    } catch (error) {
      console.error('Error adding part:', error);
      alert('Failed to add part to job');
    }
  }
}

// Initialize global instance
window.partsModalHandler = new PartsModalHandler();
