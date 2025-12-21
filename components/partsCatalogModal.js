/**
 * Parts Catalog Modal Component
 * Provides universal parts search with category filtering
 */

class PartsCatalogModal {
  constructor() {
    this.modal = null;
    this.currentJobId = null;
    this.currentJobVehicle = null;
    this.selectedCategory = null;
  }

  /**
   * Show the modal for a specific job
   */
  async show(jobId) {
    this.currentJobId = jobId;
    
    // Get the current job's vehicle info
    await this.loadJobVehicle(jobId);
    
    if (!this.modal) {
      this.createModal();
    } else {
      // Update vehicle info banner if modal already exists
      this.updateVehicleBanner();
    }

    // Reset selections
    this.selectedCategory = null;

    // Load initial data
    await this.loadCategories();

    this.modal.classList.add('active');
  }
  
  /**
   * Update the vehicle info banner in existing modal
   */
  updateVehicleBanner() {
    const existingBanner = this.modal.querySelector('.vehicle-banner');
    if (existingBanner) {
      existingBanner.remove();
    }
    
    if (this.currentJobVehicle) {
      const vehicleBanner = document.createElement('div');
      vehicleBanner.className = 'vehicle-banner';
      vehicleBanner.style.cssText = 'background: #f0fdf4; border-left: 4px solid #10b981; padding: 0.75rem 1rem; margin-bottom: 1rem; border-radius: 4px;';
      vehicleBanner.innerHTML = `<span style="color: #059669; font-weight: 600;"><i class="fas fa-car"></i> Shopping for: ${this.currentJobVehicle}</span>`;
      
      const modalBody = this.modal.querySelector('.modal-body');
      modalBody.insertBefore(vehicleBanner, modalBody.firstChild);
    }
  }

  /**
   * Load current job's vehicle information
   */
  async loadJobVehicle(jobId) {
    try {
      // Try to get from jobs table first
      const { data: job, error: jobError } = await window.supabase
        .from('jobs')
        .select('vehicle, year, make, model')
        .eq('id', jobId)
        .single();
      
      if (!jobError && job) {
        // If we have year/make/model, construct vehicle string
        if (job.year || job.make || job.model) {
          this.currentJobVehicle = [job.year, job.make, job.model].filter(Boolean).join(' ');
        } else if (job.vehicle) {
          this.currentJobVehicle = job.vehicle;
        }
      }
      
      // If still no vehicle, try from appointment
      if (!this.currentJobVehicle) {
        const { data: appt } = await window.supabase
          .from('appointments')
          .select('vehicle, year, make, model')
          .eq('id', job?.appointment_id)
          .single();
        
        if (appt) {
          if (appt.year || appt.make || appt.model) {
            this.currentJobVehicle = [appt.year, appt.make, appt.model].filter(Boolean).join(' ');
          } else if (appt.vehicle) {
            this.currentJobVehicle = appt.vehicle;
          }
        }
      }
      
      console.log('🚗 Job vehicle loaded:', this.currentJobVehicle);
    } catch (error) {
      console.warn('Could not load job vehicle:', error);
      this.currentJobVehicle = null;
    }
  }

  /**
   * Create the modal HTML structure
   */
  createModal() {
    const vehicleInfo = this.currentJobVehicle 
      ? `<div class="vehicle-banner" style="background: #f0fdf4; border-left: 4px solid #10b981; padding: 0.75rem 1rem; margin-bottom: 1rem; border-radius: 4px;">
           <span style="color: #059669; font-weight: 600;"><i class="fas fa-car"></i> Shopping for: ${this.currentJobVehicle}</span>
         </div>`
      : '';
    
    const modalHTML = `
      <div id="partsCatalogModal" class="modal-backdrop hidden" role="dialog" aria-modal="true">
        <div class="modal-card" style="max-width: 900px;">
          <div class="modal-head">
            <h3 style="display: inline-block; margin-right: 1rem;">Find Parts</h3>
            <button class="modal-close btn-close" id="closeCatalogModal" aria-label="Close">&times;</button>
          </div>

          <div class="modal-body">
            ${vehicleInfo}

            <div class="alert alert-info" style="margin-bottom: 1.5rem; padding: 1rem; background: #e0f2fe; border-left: 4px solid #0284c7; border-radius: 4px;">
              <div style="display: flex; align-items: start; gap: 0.75rem;">
                <i class="fas fa-info-circle" style="color: #0284c7; margin-top: 2px;"></i>
                <div>
                  <strong style="display: block; margin-bottom: 0.25rem;">Important:</strong>
                  <span style="font-size: 0.9rem;">Prices shown are estimates only. Please contact your supplier directly to confirm current pricing and availability before ordering.</span>
                </div>
              </div>
            </div>

            <!-- Category & Search -->
            <div class="form-section">
              <h4>Search Parts</h4>
              <div class="form-grid" style="grid-template-columns: 1fr 2fr auto; gap: 8px;">
                <div class="form-field">
                  <label>Category</label>
                  <select id="catalogCategory" class="form-control">
                    <option value="">All Categories</option>
                  </select>
                </div>
                <div class="form-field">
                  <label>Search</label>
                  <input type="text" id="catalogSearch" class="form-control" 
                         placeholder="Search by part name, number, or vehicle...">
                </div>
                <div class="form-field" style="align-self: flex-end;">
                  <button class="btn primary" id="searchPartsBtn">
                    Search Parts
                  </button>
                </div>
              </div>
            </div>

            <!-- Results -->
            <div id="catalogResults" class="parts-results">
              <div class="empty-state">
                <p>Enter a search term or select a category to find parts</p>
              </div>
            </div>

            <!-- Loading State -->
            <div id="catalogLoading" class="loading-state" style="display: none;">
              <div class="spinner"></div>
              <p>Searching parts...</p>
            </div>
          </div>
        </div>
      </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHTML);
    this.modal = document.getElementById('partsCatalogModal');
    
    // Attach event listeners
    this.attachEventListeners();
  }

  /**
   * Attach all event listeners
   */
  attachEventListeners() {
    // Close modal
    document.getElementById('closeCatalogModal').addEventListener('click', () => {
      this.modal.classList.remove('active');
    });

    // Search button
    document.getElementById('searchPartsBtn').addEventListener('click', () => {
      this.searchParts();
    });

    // Search on Enter key
    document.getElementById('catalogSearch').addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        this.searchParts();
      }
    });

    // Close on outside click
    this.modal.addEventListener('click', (e) => {
      if (e.target === this.modal) {
        this.modal.classList.remove('active');
      }
    });
  }

  /**
   * Load all categories
   */
  async loadCategories() {
    try {
      const { data, error } = await window.supabase
        .from('catalog_categories')
        .select('id, name')
        .order('name');
      
      if (error) throw error;
      
      const categorySelect = document.getElementById('catalogCategory');
      categorySelect.innerHTML = '<option value="">All Categories</option>';
      
      data.forEach(cat => {
        categorySelect.innerHTML += `<option value="${cat.name}">${cat.name}</option>`;
      });
    } catch (error) {
      console.error('Error loading categories:', error);
      showNotification('Failed to load categories', 'error');
    }
  }

  /**
   * Search for parts in universal catalog
   */
  async searchParts() {
    const searchTerm = document.getElementById('catalogSearch').value.trim();
    const category = document.getElementById('catalogCategory').value;
    
    // Show loading state
    document.getElementById('catalogResults').style.display = 'none';
    document.getElementById('catalogLoading').style.display = 'flex';

    try {
      let query = window.supabase
        .from('universal_parts_catalog')
        .select('*');
      
      // Filter by category if selected
      if (category) {
        query = query.eq('category', category);
      }
      
      // Filter by search term (searches name, description, part_number, fits_models)
      if (searchTerm) {
        query = query.or(
          `name.ilike.%${searchTerm}%,` +
          `description.ilike.%${searchTerm}%,` +
          `part_number.ilike.%${searchTerm}%,` +
          `fits_models.ilike.%${searchTerm}%,` +
          `manufacturer.ilike.%${searchTerm}%`
        );
      }
      
      // ALWAYS return something - if no filters applied, show all parts (limited)
      // This ensures parts show for ALL vehicles when searching with no query
      const { data, error } = await query.order('name').limit(50);
      
      console.log('🔍 Parts search query:', { searchTerm, category });
      console.log('✅ Parts search results:', data ? data.length : 0, 'parts found');
      console.log('📦 Sample result:', data && data[0] ? data[0] : 'none');
      
      if (error) {
        console.error('❌ Parts search error:', error);
        throw error;
      }
      
      // Hide loading, show results
      document.getElementById('catalogLoading').style.display = 'none';
      document.getElementById('catalogResults').style.display = 'block';
      
      this.displayResults(data);
    } catch (error) {
      console.error('❌ Error searching parts:', error);
      showNotification('Search failed: ' + error.message, 'error');
      document.getElementById('catalogLoading').style.display = 'none';
      document.getElementById('catalogResults').style.display = 'block';
    }
  }

  /**
   * Display search results from universal catalog
   */
  displayResults(parts) {
    const resultsDiv = document.getElementById('catalogResults');
    
    if (!parts || parts.length === 0) {
      resultsDiv.innerHTML = `
        <div class="empty-state">
          <p>No parts found. Try adjusting your search.</p>
        </div>
      `;
      return;
    }

    let html = '<div class="parts-list">';
    
    parts.forEach(part => {
      // Construct part name with current job vehicle FOR DISPLAY ONLY
      const partDisplayName = this.currentJobVehicle 
        ? `${part.name} - ${this.currentJobVehicle}`
        : part.name;
      
      // Store the ORIGINAL part in the button (without vehicle modifications)
      // The pricing modal will handle adding the vehicle when it opens
      
      html += `
        <div class="part-card" data-part-id="${part.id}">
          <div class="part-header">
            <h4>${partDisplayName}</h4>
            ${part.category ? `<span class="badge">${part.category}</span>` : ''}
          </div>
          <div class="part-details">
            ${part.part_number ? `<p><strong>Part #:</strong> ${part.part_number}</p>` : ''}
            ${part.manufacturer ? `<p><strong>Manufacturer:</strong> ${part.manufacturer}</p>` : ''}
            ${part.oem_number ? `<p><strong>OEM #:</strong> ${part.oem_number}</p>` : ''}
            ${part.description ? `<p>${part.description}</p>` : ''}
            ${this.currentJobVehicle ? `<p class="vehicle-fit" style="color: #059669; font-weight: 500;"><i class="fas fa-car"></i> For: ${this.currentJobVehicle}</p>` : ''}
            ${part.fits_models ? `<p class="vehicle-fit" style="color: #6b7280; font-size: 0.9rem;"><i class="fas fa-info-circle"></i> Generally fits: ${part.fits_models}</p>` : ''}
            ${part.suggested_retail_price ? `<p><strong>Est. Price:</strong> ${parseFloat(part.suggested_retail_price).toFixed(2)}</p>` : ''}
          </div>
          <div class="part-actions">
            <button class="btn small primary add-part-btn" data-part='${JSON.stringify(part).replace(/'/g, "&#39;")}'>
              Add to Job
            </button>
          </div>
        </div>
      `;
    });
    
    html += '</div>';
    resultsDiv.innerHTML = html;

    // Attach click handlers to "Add to Job" buttons
    resultsDiv.querySelectorAll('.add-part-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const partData = JSON.parse(e.target.dataset.part.replace(/&#39;/g, "'"));
        // Pass the ORIGINAL part from the button, not the modified one
        // The pricing modal will handle vehicle name properly
        this.showPricingModal(partData);
      });
    });
  }

  /**
   * Show pricing modal to enter cost/sell prices
   */
  showPricingModal(part) {
    // Part already has the correct vehicle name from displayResults()
    // No need to modify it further
    
    // This will be handled by the separate PartPricingModal component
      const ppm = window.xm_partPricingModal || window.partPricingModal;
      if (ppm) {
        // Pass the current job vehicle to the pricing modal
        ppm.show(part, this.currentJobId, this.currentJobVehicle, () => {
        // Callback after part is added
        // Keep the parts catalog open so the user can continue browsing
        showNotification('Part added to job!', 'success');

        // Open labor modal after adding part (attach to current job)
        const laborModal = document.getElementById('laborModal');
        if (laborModal) {
          laborModal.classList.remove('hidden');
          laborModal.dataset.jobId = this.currentJobId;
          // Clear form fields if present
          const labDescEl = document.getElementById('labDesc');
          const labHoursEl = document.getElementById('labHours');
          const labRateEl = document.getElementById('labRate');
          const labNoteEl = document.getElementById('labNote');
          if (labDescEl) labDescEl.value = '';
          if (labHoursEl) labHoursEl.value = '';
          if (labRateEl) labRateEl.value = '';
          if (labNoteEl) labNoteEl.textContent = '';
        }

        // Trigger event for jobs page to refresh parts list
        window.dispatchEvent(new CustomEvent('partAdded', { detail: { jobId: this.currentJobId } }));
      });
    }
  }
}

// Export as global instance
window.partsCatalogModal = new PartsCatalogModal();
