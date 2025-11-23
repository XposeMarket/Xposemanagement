/**
 * Parts Modal Integration
 * Handles the parts finder modal with catalog integration
 */

class PartsModalHandler {
  constructor() {
    this.currentJob = null;
    this.selectedYear = null;
    this.selectedMake = null;
    this.selectedModel = null;
    this.init();
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
      const response = await fetch('/api/catalog/categories');
      const data = await response.json();
      
      const categorySelect = document.getElementById('catalogCategory');
      if (!categorySelect) return;
      
      categorySelect.innerHTML = '<option value="">All Categories</option>';
      data.categories.forEach(cat => {
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
      const response = await fetch('/api/catalog/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          year: this.selectedYear,
          make: this.selectedMake,
          model: this.selectedModel,
          category: category,
          searchTerm: searchTerm
        })
      });

      const data = await response.json();
      this.displayResults(data.parts);
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

    let html = '<div style="display: grid; gap: 12px;">';
    html += `
      <div style="background: var(--card-bg); padding: 12px; border-radius: 8px; border: 1px solid var(--line); margin-bottom: 8px;">
        <p style="margin: 0; text-align: center; color: var(--muted); font-size: 0.9rem;">
          💡 <strong>Tip:</strong> Call suppliers or local auto parts stores for accurate pricing
        </p>
      </div>
    `;
    
    parts.forEach(part => {
      html += `
        <div class="part-result-card" style="background: var(--card-bg); border: 1px solid var(--line); border-radius: 8px; padding: 12px;">
          <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 8px;">
            <div>
              <strong>${part.part_name}</strong>
              ${part.part_number ? `<br><small style="color: var(--muted);">Part #: ${part.part_number}</small>` : ''}
            </div>
            <span class="badge" style="background: var(--accent); color: white; padding: 4px 8px; border-radius: 4px; font-size: 0.75rem;">
              ${part.category?.name || 'Part'}
            </span>
          </div>
          ${part.description ? `<p style="font-size: 0.9rem; color: var(--muted); margin: 8px 0;">${part.description}</p>` : ''}
          ${part.year && part.make && part.model ? 
            `<p style="font-size: 0.85rem; color: var(--accent); margin: 8px 0;">Fits: ${part.year} ${part.make} ${part.model}</p>` : ''}
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
  addPartToJob(part) {
    if (!this.currentJob) {
      alert('No job selected');
      return;
    }

    // Use the pricing modal component if available
    if (window.partPricingModal) {
      window.partPricingModal.show(part, this.currentJob.id, () => {
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

      const response = await fetch('/api/catalog/add-part', {
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
