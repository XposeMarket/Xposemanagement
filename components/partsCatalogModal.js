/**
 * Parts Catalog Modal Component
 * Provides universal parts search with category filtering
 */

class PartsCatalogModal {
  constructor() {
    this.modal = null;
    this.currentJobId = null;
    this.selectedCategory = null;
  }

  /**
   * Show the modal for a specific job
   */
  async show(jobId) {
    this.currentJobId = jobId;
    
    if (!this.modal) {
      this.createModal();
    }

    // Reset selections
    this.selectedCategory = null;

    // Load initial data
    await this.loadCategories();

    this.modal.classList.add('active');
  }

  /**
   * Create the modal HTML structure
   */
  createModal() {
    const modalHTML = `
      <div class="modal" id="partsCatalogModal">
        <div class="modal-content" style="max-width: 900px;">
          <div class="modal-header">
            <h3>Find Parts</h3>
            <button class="modal-close" id="closeCatalogModal">&times;</button>
          </div>
          
          <div class="modal-body">
            <!-- Important Notice -->
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
              <div class="form-grid" style="grid-template-columns: 1fr 2fr auto;">
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
      
      const { data, error } = await query.limit(50);
      
      if (error) throw error;
      
      // Hide loading, show results
      document.getElementById('catalogLoading').style.display = 'none';
      document.getElementById('catalogResults').style.display = 'block';
      
      this.displayResults(data);
    } catch (error) {
      console.error('Error searching parts:', error);
      showNotification('Search failed', 'error');
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
      html += `
        <div class="part-card" data-part-id="${part.id}">
          <div class="part-header">
            <h4>${part.name}</h4>
            ${part.category ? `<span class="badge">${part.category}</span>` : ''}
          </div>
          <div class="part-details">
            ${part.part_number ? `<p><strong>Part #:</strong> ${part.part_number}</p>` : ''}
            ${part.manufacturer ? `<p><strong>Manufacturer:</strong> ${part.manufacturer}</p>` : ''}
            ${part.oem_number ? `<p><strong>OEM #:</strong> ${part.oem_number}</p>` : ''}
            ${part.description ? `<p>${part.description}</p>` : ''}
            ${part.fits_models ? `<p class="vehicle-fit"><i class="fas fa-car"></i> Fits: ${part.fits_models}</p>` : ''}
            ${part.suggested_retail_price ? `<p><strong>Est. Price:</strong> $${parseFloat(part.suggested_retail_price).toFixed(2)}</p>` : ''}
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
        this.showPricingModal(partData);
      });
    });
  }

  /**
   * Show pricing modal to enter cost/sell prices
   */
  showPricingModal(part) {
    // This will be handled by the separate PartPricingModal component
    if (window.partPricingModal) {
      window.partPricingModal.show(part, this.currentJobId, () => {
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
