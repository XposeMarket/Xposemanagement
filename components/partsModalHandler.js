/**
 * Parts Modal Integration
 * Handles the parts finder modal with catalog integration
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
   * Display inventory parts (from localStorage) in the catalog results area
   */
  async displayInventoryResults() {
    const resultsDiv = document.getElementById('catalogResults');
    if (!resultsDiv) return;
    // Combine regular inventory and folder-type items so both appear
    let inv = [];
    try { inv = JSON.parse(localStorage.getItem('inventory') || '[]'); } catch (e) { inv = []; }
    let folders = [];
    try { folders = JSON.parse(localStorage.getItem('inventoryFolders') || '[]'); } catch (e) { folders = []; }
    // Fallback: some pages set folders on window.inventoryFolders without flushing to localStorage
    try { if ((!folders || folders.length === 0) && Array.isArray(window.inventoryFolders) && window.inventoryFolders.length > 0) { folders = window.inventoryFolders; console.debug('[PartsModalHandler] using window.inventoryFolders fallback'); } } catch(e) {}

    // If still empty, attempt to fetch remote inventory for the current shop (best-effort)
    try {
      if ((!folders || folders.length === 0)) {
        let shopId = null;
        try { shopId = JSON.parse(localStorage.getItem('xm_session')||'{}').shopId || null; } catch(e){}
        if (shopId) {
          try {
            const api = await import('../helpers/inventory-api.js');
            if (api && typeof api.fetchInventoryForShop === 'function') {
              const remote = await api.fetchInventoryForShop(shopId);
              if (remote && Array.isArray(remote.folders) && remote.folders.length > 0) {
                folders = remote.folders.map(f => ({ id: f.id, name: f.name, unit: f.unit, items: (f.items||[]).map(i=>({ id: i.id, name: i.name, qty: i.qty, cost_price: i.cost_price, sell_price: i.sell_price, markup_percent: i.markup_percent })) }));
                try { localStorage.setItem('inventoryFolders', JSON.stringify(folders)); } catch(e){}
                console.debug('[PartsModalHandler] fetched folders remotely as fallback');
              }
            }
          } catch(e) { console.debug('[PartsModalHandler] remote fetch failed', e); }
        }
      }
    } catch(e) {}

    const combined = [];
    // Debug: log parsed inventories to help diagnose missing folder items
    try { console.debug('[PartsModalHandler] inventory count:', (inv||[]).length, 'folders count:', (folders||[]).length, 'inventory sample:', inv.slice(0,3), 'folders sample:', (folders||[]).slice(0,3)); } catch (e) {}
    inv.forEach((it, i) => combined.push({
      source: 'inv',
      index: i,
      name: it.name,
      part_number: it.part_number || '',
      qty: it.qty || 0,
      description: it.description || '',
      cost_price: (typeof it.cost_price !== 'undefined') ? it.cost_price : null,
      sell_price: (typeof it.sell_price !== 'undefined') ? it.sell_price : null,
      markup_percent: (typeof it.markup_percent !== 'undefined') ? it.markup_percent : null
    ,
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
          markup_percent: (typeof it.markup_percent !== 'undefined') ? it.markup_percent : null
        ,
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
      // Use centralized inventory low-stock threshold
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
            <span class="badge" style="background: ${badgeBg}; color: white; padding: 4px 8px; border-radius: 4px; font-size: 0.75rem;">
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

    // Attach click handlers using the combined array
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

  // small HTML escape helper
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

    // Manual add button
    document.getElementById('openAddPartsFromFinder')?.addEventListener('click', () => {
      // Capture current job before closing modal
      const jobRef = this.currentJob;
      // Close parts finder
      this.closeModal();
      // Set job id on addPartsModal so manual add knows which job to attach to
      const addModal = document.getElementById('addPartsModal');
      if (addModal) {
        if (jobRef && jobRef.id) {
          addModal.dataset.jobId = jobRef.id;
          console.log('[PartsModalHandler] set addPartsModal.dataset.jobId to', jobRef.id);
        } else {
          console.warn('[PartsModalHandler] currentJob missing when opening addPartsModal', jobRef);
          delete addModal.dataset.jobId;
        }
        addModal.classList.remove('hidden');
      }
    });

    // Inventory add button - shows inventory parts list inside the catalog results area
    document.getElementById('openInventoryPartsFromFinder')?.addEventListener('click', () => {
      // Keep the parts modal open and render inventory into the results area
      try {
        this.displayInventoryResults();
      } catch (e) {
        console.error('[PartsModalHandler] failed to display inventory results', e);
      }
    });
  }

  /**
   * Open the modal for a specific job
   */
  async openModal(job) {
    this.currentJob = job;
    const modal = document.getElementById('partsModal');
    if (!modal) return;

    modal.classList.remove('hidden');

    // Display vehicle info
    const vehicleDisplay = document.getElementById('partsCurrentVehicle');
    if (vehicleDisplay) {
      const vehicleText = `${job.year || ''} ${job.make || ''} ${job.model || ''}`.trim() || 'No vehicle info';
      vehicleDisplay.textContent = vehicleText;
    }

    // Load initial data
    await this.loadYears();
    await this.loadCategories();

    // Pre-fill vehicle info if available
    if (job.year && job.make && job.model) {
      await this.prefillVehicle(job.year, job.make, job.model);
    }

    // Reset results
    document.getElementById('catalogResults').innerHTML = 
      '<p class="notice" style="text-align: center; color: var(--muted);">Select vehicle and search to find parts</p>';
  }

  /**
   * Close the modal
   */
  closeModal() {
    document.getElementById('partsModal')?.classList.add('hidden');
    this.currentJob = null;
  }

  /**
   * Load all years
   */
  async loadYears() {
    // Use VEHICLE_DATA for years
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
      console.log(`Loaded ${yearArr.length} years into dropdown (VEHICLE_DATA)`);
    } catch (error) {
      console.error('Error loading years:', error);
      alert('Failed to load years. Check console for details.');
    }
  }

  /**
   * Load makes for selected year
   */
  async loadMakes() {
    const makeSelect = document.getElementById('catalogMake');
    const modelSelect = document.getElementById('catalogModel');
    if (!makeSelect || !modelSelect) return;
    // Reset
    makeSelect.innerHTML = '<option value="">Select Make</option>';
    modelSelect.innerHTML = '<option value="">Select Model</option>';
    modelSelect.disabled = true;
    this.selectedMake = null;
    this.selectedModel = null;
    if (!this.selectedYear) {
      makeSelect.disabled = true;
      return;
    }
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

  /**
   * Load models for selected year + make
   */
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

  /**
   * Load categories
   */
  async loadCategories() {
    try {
      // Load categories directly from Supabase
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

  /**
   * Pre-fill vehicle dropdowns from job data
   */
  async prefillVehicle(year, make, model) {
    // Set year
    const yearSelect = document.getElementById('catalogYear');
    if (yearSelect) {
      yearSelect.value = year;
      this.selectedYear = year;
    }

    // Load and set make
    await this.loadMakes();
    const makeSelect = document.getElementById('catalogMake');
    if (makeSelect) {
      makeSelect.value = make;
      this.selectedMake = make;
    }

    // Load and set model
    await this.loadModels();
    const modelSelect = document.getElementById('catalogModel');
    if (modelSelect) {
      modelSelect.value = model;
      this.selectedModel = model;
    }
  }

  /**
   * Search for parts
   */
  async searchParts() {
    const searchTerm = document.getElementById('catalogSearch')?.value || '';
    const category = document.getElementById('catalogCategory')?.value || '';
    const resultsDiv = document.getElementById('catalogResults');
    
    if (!resultsDiv) return;

    // Show loading
    resultsDiv.innerHTML = '<p class="notice" style="text-align: center;">Searching...</p>';

    try {
      // NEW APPROACH: Search ALL parts from catalog_parts first (no vehicle filter)
      // This makes all 1000+ parts available for any vehicle
      const { supabase } = await import('../helpers/supabase.js');
      let mainQuery = supabase
        .from('catalog_parts')
        .select(`*, category:catalog_categories(name)`);

      // ONLY filter by category and search term - NO vehicle filtering!
      if (category) mainQuery = mainQuery.eq('category_id', category);
      if (searchTerm) {
        mainQuery = mainQuery.or(`part_name.ilike.%${searchTerm}%,part_number.ilike.%${searchTerm}%,description.ilike.%${searchTerm}%`);
      }
      mainQuery = mainQuery.order('part_name').limit(100);

      const { data: allParts, error: mainErr } = await mainQuery;
      if (mainErr) throw mainErr;

      console.debug('[PartsModalHandler] universal search returned', Array.isArray(allParts) ? allParts.length : 0, 'rows');
      if (Array.isArray(allParts) && allParts.length > 0) {
        this.displayResults(allParts);
        return;
      }

      // Fallback 2: query universal_parts_catalog - SHOW ALL PARTS regardless of vehicle
      console.debug('[PartsModalHandler] running fallback search against universal_parts_catalog');
      try {
        let uQuery = supabase
          .from('universal_parts_catalog')
          .select(`*`);

        // REMOVED vehicle filtering - show ALL parts for ANY vehicle
        if (searchTerm) {
          uQuery = uQuery.or(`name.ilike.%${searchTerm}%,part_number.ilike.%${searchTerm}%,description.ilike.%${searchTerm}%`);
        }
        if (category) {
          uQuery = uQuery.eq('category', category);
        }
        
        uQuery = uQuery.order('name').limit(50);

        const { data: uData, error: uErr } = await uQuery;
        if (uErr) throw uErr;
        console.debug('[PartsModalHandler] universal_parts_catalog returned', Array.isArray(uData) ? uData.length : 0, 'rows');

        if (Array.isArray(uData) && uData.length > 0) {
          // Normalize universal catalog rows into the shape expected by displayResults
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
      } catch (uErr) {
        console.error('[PartsModalHandler] universal catalog fallback failed', uErr);
        resultsDiv.innerHTML = `<p class="notice error">Search failed. Parts catalog fallback failed (network/CORS). Try again or contact support.</p>`;
        return;
      }

      // No results from any source
      resultsDiv.innerHTML = `
        <p class="notice" style="text-align: center; padding: 2rem 1rem;">
          <strong style="display: block; margin-bottom: 0.5rem;">No parts found. Try adjusting your search or selecting a different year/make/model.</strong>
          <small style="color: var(--muted); font-size: 0.85rem;">If a specific vehicle returns no results, check that the vehicle naming matches the parts data in your catalog (e.g., "Corvette" vs "Corvette Coupe").</small>
        </p>
      `;
    } catch (error) {
      console.error('Error searching parts:', error);
      resultsDiv.innerHTML = '<p class="notice error">Search failed. Please try again.</p>';
    }
  }

  /**
   * Display search results
   */
  displayResults(parts) {
    const resultsDiv = document.getElementById('catalogResults');
    if (!resultsDiv) return;

    if (!parts || parts.length === 0) {
      resultsDiv.innerHTML = `
        <p class="notice" style="text-align: center; padding: 2rem 1rem;">
          <strong style="display: block; margin-bottom: 0.5rem;">No parts found. Try adjusting your search.</strong>
          <small style="color: var(--muted); font-size: 0.85rem;">💡 Call suppliers or local auto parts stores for accurate pricing</small>
        </p>
      `;
      return;
    }

    // Get current job's vehicle info for display
    const jobVehicle = this.currentJob ? 
      `${this.currentJob.year || ''} ${this.currentJob.make || ''} ${this.currentJob.model || ''}`.trim() : '';

    let html = '<div style="display: grid; gap: 12px;">';
    html += `
      <div style="background: var(--card-bg); padding: 12px; border-radius: 8px; border: 1px solid var(--line); margin-bottom: 8px;">
        <p style="margin: 0; text-align: center; color: var(--muted); font-size: 0.9rem;">
          💡 <strong>Tip:</strong> Call suppliers or local auto parts stores for accurate pricing
        </p>
      </div>
    `;
    
    parts.forEach(part => {
      // Remove any existing vehicle from part name (e.g. "A/C Compressor - Audi Q5" -> "A/C Compressor")
      let cleanPartName = part.part_name;
      // Remove pattern like " - [vehicle]" from the end
      cleanPartName = cleanPartName.replace(/\s*-\s*\d{4}\s+[\w\s]+$/i, '').trim();
      cleanPartName = cleanPartName.replace(/\s*-\s*[A-Z][\w\s]+$/i, '').trim();
      
      // Add current job vehicle to part name
      const displayName = jobVehicle ? `${cleanPartName} - ${jobVehicle}` : cleanPartName;
      
      // Clean description - remove vehicle-specific info and keep only generic description
      let cleanDescription = part.description || '';
      // Remove patterns like "for Audi A6 around model years 2020-2025"
      cleanDescription = cleanDescription.replace(/for\s+[A-Z][\w\s]+around\s+model\s+years\s+\d{4}[-–]\d{4}/gi, '');
      cleanDescription = cleanDescription.replace(/for\s+\d{4}\s+[A-Z][\w\s]+/gi, '');
      cleanDescription = cleanDescription.replace(/for\s+[A-Z][\w\s]+\d{4}[-–]\d{4}/gi, '');
      cleanDescription = cleanDescription.trim();
      // Remove leading/trailing punctuation that might be left over
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

    // Attach click handlers
    resultsDiv.querySelectorAll('.add-catalog-part').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const partData = JSON.parse(e.target.dataset.part);
        this.addPartToJob(partData);
      });
    });
  }

  /**
   * Add part to job (opens pricing modal)
   */
  async addPartToJob(part) {
    if (!this.currentJob) {
      alert('No job selected');
      return;
    }

    // Get job vehicle for pricing modal
    let jobVehicle = null;
    try {
      if (this.currentJob.year || this.currentJob.make || this.currentJob.model) {
        jobVehicle = [this.currentJob.year, this.currentJob.make, this.currentJob.model].filter(Boolean).join(' ');
      } else if (this.currentJob.vehicle) {
        jobVehicle = this.currentJob.vehicle;
      }
      
      console.log('🚗 Job vehicle for pricing modal (partsModalHandler):', jobVehicle);
    } catch (e) {
      console.warn('Could not get vehicle from job:', e);
    }

    // Use the pricing modal component if available
    const ppm = window.xm_partPricingModal || window.partPricingModal;
    if (ppm) {
      ppm.show(part, this.currentJob.id, jobVehicle, () => {
        this.closeModal();
        if (window.showNotification) {
          window.showNotification('Part added to job!', 'success');
        }
        // Trigger refresh if jobs page has a refresh function
        if (window.loadJobs) {
          window.loadJobs();
        }
      });
    } else {
      // Fallback: show simple prompt
      const quantity = prompt('Quantity:', '1');
      const cost = prompt('Cost Price:', '0.00');
      const sell = prompt('Sell Price:', '0.00');
      
      if (quantity && cost && sell) {
        this.savePartToJob(part, quantity, cost, sell);
      }
    }
  }

  /**
   * Save part to job via API
   */
  async savePartToJob(part, quantity, cost, sell) {
    try {
      const session = JSON.parse(localStorage.getItem('xm_session') || '{}');
      const shopId = session.shopId;

      const API_BASE = (window.XM_API_BASE !== undefined) ? window.XM_API_BASE : '';
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
