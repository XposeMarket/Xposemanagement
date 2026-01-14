// Notification functions are defined at the end of this file to avoid
// referencing `PartPricingModal` before the class is initialized.
/**
 * Part Pricing Modal Component
 * Allows manual entry of cost/sell prices after calling supplier
 * NOW WITH AUTOMATIC INVENTORY DEDUCTION + UI REFRESH!
 * NOW WITH EDITABLE PART NAME AND OPTIONAL PART NUMBER FOR MANUAL ENTRY!
 */

class PartPricingModal {
  constructor() {
    this.modal = null;
    this.currentPart = null;
    this.currentJobId = null;
    this.callback = null;
  }

  /**
   * Create the modal HTML structure
   */
  createModal() {
    const modalHTML = `
      <div id="partPricingOverlay" style="display:none; position:fixed; top:0; left:0; width:100vw; height:100vh; background:rgba(0,0,0,0.35); z-index:99998;">
        <div id="partPricingModal" class="card" style="position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); max-width: 500px; width: 95vw; z-index:99999; box-shadow: 0 20px 60px rgba(0,0,0,0.3); max-height: 90vh; overflow-y: auto;">
          <div class="modal-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
            <h3 style="margin: 0;">Add Part to Job</h3>
            <button class="modal-close" id="closePricingModal" style="background: none; border: none; font-size: 24px; cursor: pointer; padding: 0; line-height: 1;">&times;</button>
          </div>
          <!-- Job Context Banner - shows which job this part is being added to -->
          <div id="pricingJobContext" style="background: linear-gradient(135deg, #0284c7 0%, #0369a1 100%); color: white; padding: 12px 16px; border-radius: 8px; margin-bottom: 16px; display: none;">
            <div style="display: flex; align-items: center; gap: 8px;">
              <i class="fas fa-car" style="font-size: 16px;"></i>
              <div>
                <div id="pricingJobVehicle" style="font-weight: 600; font-size: 14px;"></div>
                <div id="pricingJobId" style="font-size: 12px; opacity: 0.85;"></div>
              </div>
            </div>
          </div>
          <div class="modal-body">
            <!-- P+R Group Title with placeholder -->
            <div class="form-field">
              <label for="prGroupTitle">Part Name / Group Title</label>
              <input type="text" id="prGroupTitle" class="form-control" placeholder="Add part name here...">
              <small style="color: #666;">This will be the section title for this Part+Rate group on the invoice.</small>
            </div>
            
            <!-- Part Number (Optional) -->
            <div class="form-field">
              <label for="pricingPartNumberInput">Part Number (Optional)</label>
              <input type="text" id="pricingPartNumberInput" class="form-control" placeholder="Enter part number (optional)">
            </div>
            
            <!-- Part Info Section (will be populated dynamically for inventory/catalog parts) -->
            <div id="partInfoSection" class="form-section" style="background: #f5f5f5; padding: 1rem; border-radius: 8px; margin-bottom: 1.5rem; display: none;">
              <h4 id="pricingPartName" style="margin: 0 0 0.5rem 0;"></h4>
              <p style="margin: 0; color: #666; font-size: 0.9rem;">
                Part #: <span id="pricingPartNumber"></span>
              </p>
              <p id="pricingStockInfo" style="margin: 0.5rem 0 0 0; color: #666; font-size: 0.9rem;"></p>
            </div>
            
            <!-- Pricing Form -->
            <div class="form-field">
              <label>Quantity</label>
              <input type="number" id="pricingQuantity" class="form-control" min="1" value="1" step="1">
            </div>
            <div class="form-field">
              <label>Cost Price (What you pay)</label>
              <input type="number" id="pricingCost" class="form-control" placeholder="0.00" step="0.01" min="0">
              <small style="color: #0284c7;"><i class="fas fa-phone"></i> Call supplier to confirm current price and availability</small>
            </div>
            <div class="form-field">
              <label>Sell Price (What customer pays)</label>
              <input type="number" id="pricingSell" class="form-control" placeholder="0.00" step="0.01" min="0">
            </div>
            <!-- Markup Calculation -->
            <div class="pricing-summary" style="background: #f0f9ff; padding: 1rem; border-radius: 8px; margin-top: 1rem;">
              <div style="display: flex; justify-content: space-between; margin-bottom: 0.5rem;">
                <span>Markup:</span>
                <strong id="pricingMarkup" style="color: #0066cc;">0%</strong>
              </div>
              <div style="display: flex; justify-content: space-between;">
                <span>Profit per unit:</span>
                <strong id="pricingProfit" style="color: #059669;">$0.00</strong>
              </div>
            </div>
            <!-- Notes -->
            <div class="form-field">
              <label>Notes (Optional)</label>
              <textarea id="pricingNotes" class="form-control" rows="2" placeholder="Supplier info, warranty, special notes..."></textarea>
            </div>
          </div>
          <div class="modal-footer" style="display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px;">
            <button class="btn" id="cancelPricingBtn">Cancel</button>
            <button class="btn primary" id="savePricingBtn">Add Part</button>
          </div>
        </div>
      </div>
    `;
    document.body.insertAdjacentHTML('beforeend', modalHTML);
    this.overlay = document.getElementById('partPricingOverlay');
    this.modal = document.getElementById('partPricingModal');
    // Attach event listeners
    this.attachEventListeners();
  }

  /**
   * Show the pricing modal
   */
  show(part, jobId, jobVehicleOrCallback, callback) {
    // Handle both old signature (part, jobId, callback) and new (part, jobId, jobVehicle, callback)
    let jobVehicle = null;
    let actualCallback = null;
    
    if (typeof jobVehicleOrCallback === 'function') {
      // Old signature: show(part, jobId, callback)
      actualCallback = jobVehicleOrCallback;
    } else {
      // New signature: show(part, jobId, jobVehicle, callback)
      jobVehicle = jobVehicleOrCallback;
      actualCallback = callback;
    }
    // Defensive: if jobVehicle is an object, try to build a string
    if (jobVehicle && typeof jobVehicle === 'object') {
      const y = jobVehicle.year || jobVehicle.vehicle_year || 'Unknown';
      const m = jobVehicle.make || jobVehicle.vehicle_make || 'Unknown';
      const mo = jobVehicle.model || jobVehicle.vehicle_model || 'Unknown';
      jobVehicle = `${y} ${m} ${mo}`;
    }
    // Fallback if jobVehicle is missing or empty
    if (!jobVehicle || !String(jobVehicle).trim()) {
      jobVehicle = 'Unknown vehicle';
    }
    console.log('[partPricingModal] Received jobVehicle:', jobVehicle);
    
    console.log('🔵 Pricing modal show() called', { part, jobId, jobVehicle });
    this.currentPart = part;
    this.currentJobId = jobId;
    this.callback = actualCallback;
    this.jobVehicle = jobVehicle; // Store for later use
    
    if (!this.modal) {
      console.log('🔨 Creating modal for first time');
      this.createModal();
    }
    
    // Update job context banner
    const jobContextEl = document.getElementById('pricingJobContext');
    const jobVehicleEl = document.getElementById('pricingJobVehicle');
    const jobIdEl = document.getElementById('pricingJobId');
    
    if (jobContextEl && jobVehicleEl && jobIdEl) {
      if (jobId || jobVehicle) {
        jobVehicleEl.textContent = jobVehicle;
        jobIdEl.textContent = jobId ? `Job #${jobId.slice(-6).toUpperCase()}` : '';
        jobContextEl.style.display = 'block';
      } else {
        jobContextEl.style.display = 'none';
      }
    }
    
    // Detect part type
    const partId = this.currentPart.id;
    const isInventoryItem = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(partId));
    const isCatalogPart = !isInventoryItem && jobVehicle; // Catalog parts come with jobVehicle
    const isManualEntry = this.currentPart.manual_entry === true; // Supplier order manual entry
    const isManualPart = !isInventoryItem && !isCatalogPart;
    
    console.log('🔍 Part type detection:', { partId, isInventoryItem, isCatalogPart, isManualPart, isManualEntry });
    
    // Get elements
    const prGroupTitleEl = document.getElementById('prGroupTitle');
    const partNumberInputEl = document.getElementById('pricingPartNumberInput');
    const partInfoSection = document.getElementById('partInfoSection');
    const partNameEl = document.getElementById('pricingPartName');
    const partNumberEl = document.getElementById('pricingPartNumber');
    const stockInfoEl = document.getElementById('pricingStockInfo');
    
    // Handle Manual Entry from Supplier Links
    if (isManualEntry) {
      console.log('✅ Manual entry mode - showing editable fields');
      
      // Show editable fields, hide info section
      if (partInfoSection) partInfoSection.style.display = 'none';
      if (prGroupTitleEl) {
        prGroupTitleEl.value = '';
        prGroupTitleEl.placeholder = 'Add part name here...';
      }
      if (partNumberInputEl) {
        partNumberInputEl.value = '';
        partNumberInputEl.style.display = 'block';
        partNumberInputEl.parentElement.style.display = 'block';
      }
    }
    // Handle Inventory or Catalog Parts  
    else {
      // Update part name based on type
      let displayName = this.currentPart.name || this.currentPart.part_name || '';
      
      if (isCatalogPart && jobVehicle) {
        // Catalog part: strip old vehicle and add job vehicle
        let baseName = displayName;
        const dashIndex = baseName.indexOf(' - ');
        if (dashIndex > 0) {
          baseName = baseName.substring(0, dashIndex).trim();
        }
        displayName = `${baseName} - ${jobVehicle}`;
        this.currentPart.name = displayName;
        this.currentPart.part_name = displayName;
        
        console.log('✅ Catalog part name updated:', {
          original: baseName,
          jobVehicle: jobVehicle,
          newName: displayName
        });
      } else if (isManualPart && jobVehicle) {
        // Manual part: add vehicle but no P+R in title
        displayName = `${displayName} - ${jobVehicle}`;
        this.currentPart.name = displayName;
        this.currentPart.part_name = displayName;
        
        console.log('✅ Manual part name updated with vehicle:', displayName);
      } else if (isInventoryItem) {
        // Inventory item: strip any vehicle info and keep just the base name
        let baseName = displayName;
        const dashIndex = baseName.indexOf(' - ');
        if (dashIndex > 0) {
          // Check if what comes after the dash looks like a vehicle
          const afterDash = baseName.substring(dashIndex + 3).trim();
          // If it has multiple words or looks like year/make/model, strip it
          if (afterDash.split(' ').length >= 2 || /\d{4}/.test(afterDash)) {
            baseName = baseName.substring(0, dashIndex).trim();
            displayName = baseName;
            this.currentPart.name = displayName;
            this.currentPart.part_name = displayName;
          }
        }
        console.log('✅ Inventory item, keeping original name:', displayName);
      }
      
      // Show info section for inventory/catalog parts
      if (partInfoSection) partInfoSection.style.display = 'block';
      if (partNameEl) partNameEl.textContent = this.currentPart.name || this.currentPart.part_name;
      if (partNumberEl) partNumberEl.textContent = this.currentPart.part_number || 'N/A';
      
      // Hide the editable part number input for inventory/catalog
      if (partNumberInputEl) {
        partNumberInputEl.style.display = 'none';
        partNumberInputEl.parentElement.style.display = 'none';
      }
      
      // Show stock info for inventory items - STORE ITEM ID FOR REFRESH
      if (stockInfoEl) {
        if (isInventoryItem && typeof this.currentPart.qty_available !== 'undefined') {
          const qty = parseInt(this.currentPart.qty_available) || 0;
          const stockColor = qty === 0 ? '#ef4444' : qty <= 5 ? '#f59e0b' : '#10b981';
          stockInfoEl.innerHTML = `<strong style="color: ${stockColor};">In Stock: ${qty}</strong>`;
          stockInfoEl.style.display = 'block';
          // Store item ID for later updates
          stockInfoEl.dataset.itemId = partId;
        } else {
          stockInfoEl.style.display = 'none';
          delete stockInfoEl.dataset.itemId;
        }
      }
      
      // Set default P+R group title based on part type
      if (prGroupTitleEl) {
        const partName = (this.currentPart.name || this.currentPart.part_name || '').trim();
        let defaultTitle;
        
        if (isCatalogPart) {
          // Catalog part: add P+R suffix
          defaultTitle = partName ? `${partName} P+R` : 'P+R';
        } else if (isInventoryItem) {
          // Inventory item: just the name, no vehicle, no P+R
          defaultTitle = partName || '';
        } else {
          // Manual part: name + vehicle, but no P+R
          defaultTitle = partName || '';
        }
        
        prGroupTitleEl.value = this.currentPart.groupName || defaultTitle;
        prGroupTitleEl.placeholder = defaultTitle || 'Add part name here...';
        console.log('🏷️ Group title set to:', defaultTitle);
      }
    }
    
    // Reset form
    const qtyEl = document.getElementById('pricingQuantity');
    const costEl = document.getElementById('pricingCost');
    const sellEl = document.getElementById('pricingSell');
    if (qtyEl) qtyEl.value = '1';
    if (costEl) {
      costEl.value = (typeof this.currentPart.cost_price !== 'undefined' && this.currentPart.cost_price !== null) ? this.currentPart.cost_price : '';
    }
    if (sellEl) {
      sellEl.value = (typeof this.currentPart.sell_price !== 'undefined' && this.currentPart.sell_price !== null) ? this.currentPart.sell_price : '';
    }
    const markupEl = document.getElementById('pricingMarkup');
    const profitEl = document.getElementById('pricingProfit');
    if (markupEl) markupEl.textContent = '0%';
    if (profitEl) profitEl.textContent = '$0.00';
    
    // Recalculate markup based on provided part pricing
    try { this.calculateMarkup(); } catch (e) {}

    // Show overlay and modal
    if (this.overlay) this.overlay.style.display = 'block';
    if (this.modal) this.modal.style.display = 'block';
    
    // Focus on part name for manual entry
    if (isManualEntry && prGroupTitleEl) {
      setTimeout(() => prGroupTitleEl.focus(), 150);
    }
  }

  /**
   * Get current shop ID
   */
  getCurrentShopId() {
    try {
      const session = JSON.parse(localStorage.getItem('xm_session') || '{}');
      return session.shopId || null;
    } catch (e) {
      return null;
    }
  }

  /**
   * Attach all event listeners
   */
  attachEventListeners() {
    // Close modal and overlay
    const closeBtn = document.getElementById('closePricingModal');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        if (this.overlay) this.overlay.style.display = 'none';
        if (this.modal) this.modal.style.display = 'none';
      });
    }
    const cancelBtn = document.getElementById('cancelPricingBtn');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', () => {
        if (this.overlay) this.overlay.style.display = 'none';
        if (this.modal) this.modal.style.display = 'none';
      });
    }
    // Clicking the overlay closes modal
    if (this.overlay) {
      this.overlay.addEventListener('click', (e) => {
        if (e.target === this.overlay) {
          this.overlay.style.display = 'none';
          this.modal.style.display = 'none';
        }
      });
    }
    // Calculate markup on price changes
    document.getElementById('pricingCost').addEventListener('input', () => {
      this.calculateMarkup();
    });
    document.getElementById('pricingSell').addEventListener('input', () => {
      this.calculateMarkup();
    });
    // Save button - now shows confirmation modal
    document.getElementById('savePricingBtn').addEventListener('click', () => {
      this.showConfirmationModal();
    });
  }

  /**
   * Calculate and display markup percentage and profit
   */
  calculateMarkup() {
    const cost = parseFloat(document.getElementById('pricingCost').value) || 0;
    const sell = parseFloat(document.getElementById('pricingSell').value) || 0;

    if (cost > 0 && sell > 0) {
      const markup = ((sell - cost) / cost * 100).toFixed(2);
      const profit = (sell - cost).toFixed(2);
      
      document.getElementById('pricingMarkup').textContent = `${markup}%`;
      document.getElementById('pricingProfit').textContent = `$${profit}`;
      
      // Change color based on markup
      const markupEl = document.getElementById('pricingMarkup');
      if (markup < 0) {
        markupEl.style.color = '#dc2626'; // Red for negative
      } else if (markup < 20) {
        markupEl.style.color = '#f59e0b'; // Orange for low
      } else {
        markupEl.style.color = '#059669'; // Green for good
      }
    } else {
      document.getElementById('pricingMarkup').textContent = '0%';
      document.getElementById('pricingProfit').textContent = '$0.00';
    }
  }

  /**
   * Save the part with pricing to the job
   * NOW WITH AUTOMATIC INVENTORY DEDUCTION + PROPER UI REFRESH!
   * NOW WITH SUPPORT FOR MANUAL ENTRY FIELDS!
   */
  async savePart() {
    const quantity = parseInt(document.getElementById('pricingQuantity').value) || 1;
    const costPrice = parseFloat(document.getElementById('pricingCost').value) || 0;
    const sellPrice = parseFloat(document.getElementById('pricingSell').value) || 0;
    const notes = document.getElementById('pricingNotes').value.trim();
    const groupName = document.getElementById('prGroupTitle')?.value?.trim() || '';
    const partNumber = document.getElementById('pricingPartNumberInput')?.value?.trim() || '';
    const shopId = this.getCurrentShopId();

    // For manual entry, update the part object with user inputs
    if (this.currentPart?.manual_entry) {
      if (!groupName) {
        try { showNotification('Part name is required', 'error'); } catch (e) { PartPricingModal._fallbackNotification('Part name is required', 'error'); }
        return;
      }
      this.currentPart.name = groupName;
      this.currentPart.part_name = groupName;
      this.currentPart.part_number = partNumber || '';
      console.log('✅ Updated manual entry part:', { name: groupName, partNumber });
    }

    if (!shopId) {
      try { showNotification('Shop ID not found', 'error'); } catch (e) { PartPricingModal._fallbackNotification('Shop ID not found', 'error'); }
      return;
    }

    // Validation
    if (quantity < 1) {
      try { showNotification('Quantity must be at least 1', 'error'); } catch (e) { PartPricingModal._fallbackNotification('Quantity must be at least 1', 'error'); }
      return;
    }

    if (costPrice < 0 || sellPrice < 0) {
      try { showNotification('Prices cannot be negative', 'error'); } catch (e) { PartPricingModal._fallbackNotification('Prices cannot be negative', 'error'); }
      return;
    }

    // Round prices to 2 decimals to avoid numeric precision issues
    const roundedCost = Math.round(costPrice * 100) / 100;
    const roundedSell = Math.round(sellPrice * 100) / 100;

    // Enforce database column limits (numeric(5,2) -> max 999.99)
    const MAX_PRICE = 999.99;
    if (roundedCost > MAX_PRICE || roundedSell > MAX_PRICE) {
      try { showNotification('Price exceeds allowed maximum of $999.99', 'error'); } catch (e) { PartPricingModal._fallbackNotification('Price exceeds allowed maximum of $999.99', 'error'); }
      return;
    }

    // Use numeric markup (as a Number) to avoid inserting string values
    let markupPercent = (roundedSell && roundedCost) ? parseFloat((((roundedSell - roundedCost) / roundedCost) * 100).toFixed(2)) : 0;

    // Cap markup percent to database limits (numeric(5,2) -> max 999.99)
    const MAX_MARKUP = 999.99;
    if (markupPercent > MAX_MARKUP) {
      // silently cap markup to avoid DB numeric overflow
      markupPercent = MAX_MARKUP;
    }

    // Replace original cost/sell variables for subsequent logic
    const costPriceFinal = roundedCost;
    const sellPriceFinal = roundedSell;

    if (sellPrice < costPrice) {
      const confirm = await this.showConfirmation('Sell price is lower than cost. Continue anyway?');
      if (!confirm) return;
    }

    // Show loading state
    const saveBtn = document.getElementById('savePricingBtn');
    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.textContent = 'Adding...';
    }

    try {
      // Detect part type
      const partId = this.currentPart && this.currentPart.id;
      const isInventoryUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(partId));
      
      console.log('💾 Saving part:', { partId, isInventoryUUID, quantity, shopId });
      
      // If it's an inventory item, use the NEW automatic deduction API FIRST
      if (isInventoryUUID && partId) {
        console.log('📦 Inventory item detected - using automatic deduction API');
        try {
          const inventoryAPI = await import('../helpers/inventory-api.js');
          const { supabase } = await import('../helpers/supabase.js');
          
          // Check if it's regular inventory or folder inventory
          const { data: invItem } = await supabase
            .from('inventory_items')
            .select('id, qty, name')
            .eq('id', partId)
            .single();
          
          if (invItem) {
            // Regular inventory - use addInventoryToJob (auto-deducts)
            console.log('🔄 Adding regular inventory via addInventoryToJob (auto-deduct)');
            await inventoryAPI.addInventoryToJob(
              this.currentJobId,
              partId,
              quantity,
              shopId,
              {
                part_name: this.currentPart.name || this.currentPart.part_name || '',
                part_number: this.currentPart.part_number || '',
                cost_price: costPriceFinal,
                sell_price: sellPriceFinal,
                markup_percent: markupPercent
              }
            );
            console.log('✅ Inventory auto-deducted successfully!');
          } else {
            // Try folder inventory
            const { data: folderItem } = await supabase
              .from('inventory_folder_items')
              .select('id, qty, name')
              .eq('id', partId)
              .single();
            
            if (folderItem) {
              console.log('🔄 Adding folder inventory via addFolderInventoryToJob (auto-deduct)');
              await inventoryAPI.addFolderInventoryToJob(
                this.currentJobId,
                partId,
                quantity,
                shopId,
                {
                    part_name: this.currentPart.name || this.currentPart.part_name || '',
                    part_number: this.currentPart.part_number || '',
                    cost_price: costPriceFinal,
                    sell_price: sellPriceFinal,
                    markup_percent: markupPercent
                  }
              );
              console.log('✅ Folder inventory auto-deducted successfully!');
            }
          }
          
          // Refresh inventory UI
          try { 
            if (typeof window.renderInventory === 'function') window.renderInventory(); 
          } catch(e){}
          
        } catch (invError) {
          console.error('❌ Inventory deduction failed:', invError);
          if (invError.message && invError.message.includes('Insufficient inventory')) {
            throw new Error(invError.message);
          }
          throw invError;
        }
      } else {
        // Not an inventory item - handle two flows:
        // 1) Invoice-only (no job_id) -> call window.addPartToInvoice if available
        // 2) Job-based -> insert into job_parts as before
        console.log('📝 Creating job_part for catalog/manual part');

        // If there's no job context, prefer adding directly to the open invoice via a modal-scoped handler
        if (!this.currentJobId) {
          if (typeof window.addPartToInvoice === 'function') {
            console.log('📨 No job_id present — adding part to open invoice via window.addPartToInvoice');
            const partName = this.currentPart.name || this.currentPart.part_name || '';
            try {
              const addedId = await window.addPartToInvoice(null, partName, quantity, sellPriceFinal, costPriceFinal, groupName);
              if (addedId) {
                console.log('✅ Part added to invoice with id:', addedId);
                // record invoice item id for later labor linking
                this.lastAddedPartData = this.lastAddedPartData || {};
                this.lastAddedPartData.invoiceItemId = addedId;
              } else {
                console.warn('⚠️ window.addPartToInvoice returned no id');
              }
            } catch (e) {
              console.error('❌ window.addPartToInvoice failed:', e);
              throw e;
            }
          } else {
            // No invoice handler available — cannot insert into job_parts without job_id
            throw new Error('No job context and invoice handler not available');
          }
        } else {
          const { supabase } = await import('../helpers/supabase.js');

          // Ensure we only insert valid UUIDs into `part_id` column
          const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(partId));
          const dbPartId = isUUID ? partId : null;
          const { data, error } = await supabase
            .from('job_parts')
            .insert({
              shop_id: shopId,
              job_id: this.currentJobId,
              part_id: dbPartId,
              part_name: this.currentPart.name || this.currentPart.part_name || '',
              part_number: this.currentPart.part_number || '',
              quantity: quantity || 1,
              cost_price: costPriceFinal || 0,
              sell_price: sellPriceFinal || 0,
              markup_percent: markupPercent,
              notes: notes || ''
            })
            .select()
            .single();

          if (error) throw error;
          console.log('✅ Job_part created:', data);
        }
      }

      // Close modal
      if (this.overlay) this.overlay.style.display = 'none';
      if (this.modal) this.modal.style.display = 'none';

      // Call callback if provided
      if (this.callback) {
        try { this.callback(); } catch (e) { console.warn('[PartPricingModal] callback threw', e); }
      }

      // Store part data for linking with labor later
      this.lastAddedPartData = {
        name: this.currentPart.name || this.currentPart.part_name || '',
        qty: quantity,
        price: sellPrice || 0,
        cost: costPrice,
        groupName: groupName
      };

      // Also add to invoice
      try {
        const partName = this.currentPart.name || this.currentPart.part_name || '';
        if (typeof window.addPartToInvoice === 'function') {
          const partItemId = await window.addPartToInvoice(this.currentJobId, partName, quantity, sellPrice, costPrice, groupName);
          console.log('[PartPricingModal] added part to invoice', { partItemId });
          if (partItemId) this.lastAddedPartData.invoiceItemId = partItemId;
        }
      } catch (err) {
        console.error('[PartPricingModal] failed to add part to invoice', err);
      }

      // Show success notification
      showNotification('Part added to job successfully!', 'success');

    } catch (error) {
      console.error('Error adding part:', error);
      const errorMsg = error.message || 'Failed to add part to job';
      try { showNotification(errorMsg, 'error'); } catch (e) { PartPricingModal._fallbackNotification(errorMsg, 'error'); }

    } finally {
      // Reset button state
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Add Part';
      }
    }
  }

  /**
   * Show confirmation modal after part pricing
   */
  showConfirmationModal() {
    if (!document.getElementById('partLaborConfirmModal')) {
      const confirmHTML = `
        <div id="partLaborConfirmModal" style="display:none; position:fixed; top:0; left:0; width:100vw; height:100vh; background:rgba(0,0,0,0.35); z-index:100000;">
          <div class="card" style="position:absolute; left:50%; top:50%; transform:translate(-50%,-50%); max-width:400px; width:95vw; z-index:100001; box-shadow:0 20px 60px rgba(0,0,0,0.3);">
            <div style="padding:1.5rem; text-align:center;">
              <h3>Add Part Confirmation</h3>
              <p>Would you like to add labor for this part?</p>
              <div style="display:flex; justify-content:center; gap:12px; margin-top:2rem;">
                <button class="btn" id="confirmPartCancel">Cancel</button>
                <button class="btn info" id="confirmPartAddLabor">Add Labor</button>
                <button class="btn primary" id="confirmPartAddInvoice">Add to Invoice</button>
              </div>
            </div>
          </div>
        </div>
      `;
      document.body.insertAdjacentHTML('beforeend', confirmHTML);
    }
    const modal = document.getElementById('partLaborConfirmModal');
    modal.style.display = 'block';
    document.getElementById('confirmPartCancel').onclick = () => { modal.style.display = 'none'; };
    document.getElementById('confirmPartAddLabor').onclick = async () => {
      // Hide confirmation modal AND its overlay
      modal.style.display = 'none';
      const confirmOverlay = document.getElementById('partLaborConfirmModal');
      if (confirmOverlay) confirmOverlay.style.display = 'none';
      
      try {
        await this.savePart();
        
        // FORCEFULLY HIDE ALL OVERLAYS AND MODALS
        // Part pricing modal
        if (this.overlay) {
          this.overlay.style.display = 'none';
        }
        if (this.modal) {
          this.modal.style.display = 'none';
        }
        
        // Main parts panel and related modals
        const partsModal = document.getElementById('partsModal');
        const partsOverlay = document.getElementById('partsModalOverlay');
        const addPartsModal = document.getElementById('addPartsModal');
        
        if (partsModal) {
          partsModal.classList.add('hidden');
          partsModal.style.display = 'none';
        }
        if (partsOverlay) {
          partsOverlay.style.display = 'none';
        }
        if (addPartsModal) {
          addPartsModal.classList.add('hidden');
          addPartsModal.style.display = 'none';
        }
        
        // Hide ANY element with overlay-like classes or IDs (except labor modal)
        document.querySelectorAll('[id*="overlay"], [id*="Overlay"], [class*="overlay"], [class*="modal-overlay"]').forEach(el => {
          if (el.id !== 'laborModalOverlay' && el.id !== 'laborOverlay') {
            el.style.display = 'none';
          }
        });
        
        console.log('[PartPricingModal] All overlays hidden, opening labor modal...');
        
        // Wait for everything to close, then open labor modal
        setTimeout(() => {
          if (typeof window.openLaborModal === 'function') {
            window.openLaborModal(
              this.currentJobId, 
              this.lastAddedPartData?.invoiceItemId, 
              this.lastAddedPartData?.name
            );
          } else {
            console.error('[PartPricingModal] window.openLaborModal not available');
            try {
              showNotification('Labor modal not available. Please try adding labor manually.', 'error');
            } catch (e) {
              alert('Labor modal not available.');
            }
          }
        }, 200); // Longer delay to ensure cleanup
        
      } catch (err) {
        console.error('[PartPricingModal] savePart failed', err);
        try {
          showNotification('Failed to save part: ' + err.message, 'error');
        } catch (e) {
          alert('Failed to save part: ' + err.message);
        }
      }
    };
    document.getElementById('confirmPartAddInvoice').onclick = () => {
      (async () => {
        console.log('[PartPricingModal] confirm Add to Invoice clicked, jobId:', this.currentJobId);
        modal.style.display = 'none';
        try {
          await this.savePart();
        } catch (e) {
          console.error('[PartPricingModal] savePart threw in confirmAddInvoice', e);
        }
      })();
    };
  }

  /**
   * Show confirmation dialog
   */
  showConfirmation(message) {
    return new Promise((resolve) => {
      let banner = document.getElementById('partConfirmBanner');
      if (banner) banner.remove();
      banner = document.createElement('div');
      banner.id = 'partConfirmBanner';
      banner.style.position = 'fixed';
      banner.style.top = '24px';
      banner.style.left = '50%';
      banner.style.transform = 'translateX(-50%)';
      banner.style.background = '#0284c7';
      banner.style.color = '#fff';
      banner.style.padding = '16px 24px';
      banner.style.borderRadius = '8px';
      banner.style.zIndex = '100002';
      banner.style.boxShadow = '0 2px 12px rgba(0,0,0,0.15)';
      banner.style.display = 'flex';
      banner.style.alignItems = 'center';
      banner.style.gap = '18px';
      banner.innerHTML = `<span>${message}</span>`;
      const yesBtn = document.createElement('button');
      yesBtn.textContent = 'Yes';
      yesBtn.className = 'btn info';
      yesBtn.style.marginLeft = '12px';
      const noBtn = document.createElement('button');
      noBtn.textContent = 'No';
      noBtn.className = 'btn danger';
      banner.appendChild(yesBtn);
      banner.appendChild(noBtn);
      document.body.appendChild(banner);
      yesBtn.onclick = () => {
        banner.remove();
        resolve(true);
      };
      noBtn.onclick = () => {
        banner.remove();
        resolve(false);
      };
    });
  }
}

// Export as global instance
window.xm_partPricingModal = new PartPricingModal();
try {
  window.partPricingModal = window.xm_partPricingModal;
} catch (e) {
  console.warn('[PartPricingModal] could not set legacy global window.partPricingModal', e);
}

// === Notification functions ===
if (typeof window.showNotification !== 'function') {
  window.showNotification = function(message, type = 'success') {
    const notifIds = ['notification', 'notifBanner', 'notificationBanner', 'errorBanner'];
    for (const id of notifIds) {
      const el = document.getElementById(id);
      if (el) {
        try {
          el.textContent = message;
          el.className = 'notification';
          if (type === 'error') el.style.background = '#ef4444'; else el.style.background = '#10b981';
          el.classList.remove('hidden');
          setTimeout(() => { if (el) el.classList.add('hidden'); }, 3000);
          return;
        } catch (e) { break; }
      }
    }
    alert((type === 'error' ? 'Error: ' : '') + message);
  };
}

if (typeof PartPricingModal._fallbackNotification !== 'function') {
  PartPricingModal._fallbackNotification = function(msg, type) {
    if (typeof window.showNotification === 'function') {
      try { window.showNotification(msg, type); return; } catch (e) {}
    }
    alert((type === 'error' ? 'Error: ' : '') + msg);
  };
}
