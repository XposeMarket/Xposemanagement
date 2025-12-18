// Notification functions are defined at the end of this file to avoid
// referencing `PartPricingModal` before the class is initialized.
/**
 * Part Pricing Modal Component
 * Allows manual entry of cost/sell prices after calling supplier
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
      <div id="partPricingOverlay" style="display:none; position:fixed; top:0; left:0; width:100vw; height:100vh; background:rgba(0,0,0,0.35); z-index:10050;">
        <div id="partPricingModal" class="card" style="position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); max-width: 500px; width: 95vw; z-index:10051; box-shadow: 0 20px 60px rgba(0,0,0,0.3);">
          <div class="modal-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
            <h3 style="margin: 0;">Add Part to Job</h3>
            <button class="modal-close" id="closePricingModal" style="background: none; border: none; font-size: 24px; cursor: pointer; padding: 0; line-height: 1;">&times;</button>
          </div>
          <div class="modal-body">
            <!-- P+R Group Title -->
            <div class="form-field">
              <label for="prGroupTitle">P+R Group Title</label>
              <input type="text" id="prGroupTitle" class="form-control" placeholder="Group Title (e.g. Front Brakes P+R)">
              <small style="color: #666;">This will be the section title for this Part+Rate group on the invoice. Default is part name + 'P+R'.</small>
            </div>
            <!-- Part Info -->
            <div class="form-section" style="background: #f5f5f5; padding: 1rem; border-radius: 8px; margin-bottom: 1.5rem;">
              <h4 id="pricingPartName" style="margin: 0 0 0.5rem 0;"></h4>
              <p style="margin: 0; color: #666; font-size: 0.9rem;">
                Part #: <span id="pricingPartNumber"></span>
              </p>
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
    
    console.log('🔵 Pricing modal show() called', { part, jobId, jobVehicle });
    this.currentPart = part;
    this.currentJobId = jobId;
    this.callback = actualCallback;
    this.jobVehicle = jobVehicle; // Store for later use
    
    if (!this.modal) {
      console.log('🔨 Creating modal for first time');
      this.createModal();
    }
    
    // Detect part type
    const partId = this.currentPart.id;
    const isInventoryItem = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(partId));
    const isCatalogPart = !isInventoryItem && jobVehicle; // Catalog parts come with jobVehicle
    const isManualPart = !isInventoryItem && !isCatalogPart;
    
    console.log('🔍 Part type detection:', { partId, isInventoryItem, isCatalogPart, isManualPart });
    
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
    
    // Populate part info with corrected name
    const nameEl = document.getElementById('pricingPartName');
    const numberEl = document.getElementById('pricingPartNumber');
    if (nameEl) nameEl.textContent = this.currentPart.name || this.currentPart.part_name;
    if (numberEl) numberEl.textContent = this.currentPart.part_number || 'N/A';
    
    // Set default P+R group title based on part type
    const prGroupTitleEl = document.getElementById('prGroupTitle');
    if (prGroupTitleEl) {
      const partName = (this.currentPart.name || this.currentPart.part_name || '').trim();
      let defaultTitle;
      
      if (isCatalogPart) {
        // Catalog part: add P+R suffix
        defaultTitle = partName ? `${partName} P+R` : 'P+R';
      } else if (isInventoryItem) {
        // Inventory item: just the name, no vehicle, no P+R
        defaultTitle = partName || 'Part';
      } else {
        // Manual part: name + vehicle, but no P+R
        defaultTitle = partName || 'Part';
      }
      
      prGroupTitleEl.value = this.currentPart.groupName || defaultTitle;
      console.log('🏷️ Group title set to:', defaultTitle);
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
  }

  /**
   * Load job vehicle and update current part name
   */
  async loadJobVehicleAndUpdatePart() {
    try {
      const { supabase } = await import('../helpers/supabase.js');
      
      // Get job vehicle
      const { data: job, error: jobError } = await supabase
        .from('jobs')
        .select('vehicle, year, make, model, appointment_id')
        .eq('id', this.currentJobId)
        .single();
      
      let jobVehicle = null;
      if (!jobError && job) {
        if (job.year || job.make || job.model) {
          jobVehicle = [job.year, job.make, job.model].filter(Boolean).join(' ');
        } else if (job.vehicle) {
          jobVehicle = job.vehicle;
        }
        
        // If still no vehicle, try from appointment
        if (!jobVehicle && job.appointment_id) {
          const { data: appt } = await supabase
            .from('appointments')
            .select('vehicle, year, make, model')
            .eq('id', job.appointment_id)
            .single();
          
          if (appt) {
            if (appt.year || appt.make || appt.model) {
              jobVehicle = [appt.year, appt.make, appt.model].filter(Boolean).join(' ');
            } else if (appt.vehicle) {
              jobVehicle = appt.vehicle;
            }
          }
        }
      }
      
      console.log('🚗 Job vehicle for pricing modal:', jobVehicle);
      console.log('📋 Job data:', job);
      
      // Update part name with job vehicle
      if (jobVehicle) {
        let baseName = this.currentPart.name || this.currentPart.part_name || '';
        const dashIndex = baseName.indexOf(' - ');
        if (dashIndex > 0) {
          baseName = baseName.substring(0, dashIndex).trim();
        }
        
        const newName = `${baseName} - ${jobVehicle}`;
        this.currentPart.name = newName;
        this.currentPart.part_name = newName;
        
        console.log('✅ Part name updated:', {
          original: baseName,
          newName: newName
        });
      } else {
        console.warn('⚠️ No vehicle found for job, keeping original part name');
      }
    } catch (error) {
      console.warn('Could not load job vehicle:', error);
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
   */
  async savePart() {
    const quantity = parseInt(document.getElementById('pricingQuantity').value) || 1;
    const costPrice = parseFloat(document.getElementById('pricingCost').value) || 0;
    const sellPrice = parseFloat(document.getElementById('pricingSell').value) || 0;
    const notes = document.getElementById('pricingNotes').value.trim();
    const groupName = document.getElementById('prGroupTitle')?.value?.trim() || '';
    const shopId = this.getCurrentShopId();

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
      // Use Supabase client directly to insert part into job_parts
      const { supabase } = await import('../helpers/supabase.js');
      const partId = this.currentPart && this.currentPart.id;
      
      // Check if partId is a UUID (Supabase inventory item)
      const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(partId));
      
      const { data, error } = await supabase
        .from('job_parts')
        .insert({
          shop_id: shopId,
          job_id: this.currentJobId,
          part_id: isUUID ? null : partId, // Only use if numeric catalog part
          part_name: this.currentPart.name || this.currentPart.part_name || '',
          part_number: this.currentPart.part_number || '',
          quantity: quantity || 1,
          cost_price: costPrice || 0,
          sell_price: sellPrice || 0,
          markup_percent: sellPrice && costPrice ? ((sellPrice - costPrice) / costPrice * 100).toFixed(2) : 0,
          notes: notes || ''
        })
        .select()
        .single();

      if (error) {
        console.error('[PartPricingModal] Supabase error adding part:', error);
        throw new Error(`Failed to add part: ${error.message}`);
      }

      console.log('✅ Part added to job_parts:', data);

      // Link to inventory and auto-deduct via Supabase
      try {
        const partIdRaw = this.currentPart && this.currentPart.id;
        const qtyToRemove = parseInt(quantity, 10) || 0;
        console.log('[PartPricingModal] Linking to inventory', { partIdRaw, qtyToRemove, jobPartId: data.id });
        
        if (partIdRaw && qtyToRemove > 0 && isUUID && data.id) {
          // This is a Supabase inventory item - link it to the job_part
          // The database trigger will automatically deduct inventory
          try {
            // Determine if it's a regular inventory item or folder item
            // Try inventory_items first
            const { data: invItem } = await supabase
              .from('inventory_items')
              .select('id')
              .eq('id', partIdRaw)
              .single();
            
            if (invItem) {
              // It's a regular inventory item - update job_part with linkage
              const { error: updateError } = await supabase
                .from('job_parts')
                .update({ 
                  inventory_item_id: partIdRaw,
                  inventory_deducted: false // Trigger will set this to true and deduct
                })
                .eq('id', data.id);
              
              if (updateError) throw updateError;
              console.log('✅ Linked job_part to inventory_item - auto-deduction will occur');
            } else {
              // Try folder items
              const { data: folderItem } = await supabase
                .from('inventory_folder_items')
                .select('id')
                .eq('id', partIdRaw)
                .single();
              
              if (folderItem) {
                const { error: updateError } = await supabase
                  .from('job_parts')
                  .update({ 
                    inventory_folder_item_id: partIdRaw,
                    inventory_deducted: false // Trigger will set this to true and deduct
                  })
                  .eq('id', data.id);
                
                if (updateError) throw updateError;
                console.log('✅ Linked job_part to folder inventory - auto-deduction will occur');
              }
            }
            
            // Refresh inventory UI if available
            try { 
              if (typeof window.renderInventory === 'function') window.renderInventory(); 
            } catch(e){}
            
          } catch (e) {
            console.warn('[PartPricingModal] Failed to link inventory:', e);
          }
        }
      } catch (e) {
        console.warn('[PartPricingModal] Inventory linking error:', e);
      }

      // Close modal
      if (this.overlay) this.overlay.style.display = 'none';
      if (this.modal) this.modal.style.display = 'none';

      // Call callback if provided
      if (this.callback) {
        try { this.callback(data); } catch (e) { console.warn('[PartPricingModal] callback threw', e); }
      }

      // Store part data for linking with labor later
      this.lastAddedPartData = {
        id: data.id,
        name: data.part_name || this.currentPart.name || this.currentPart.part_name || '',
        qty: data.quantity || quantity,
        price: data.sell_price || sellPrice || 0,
        cost: (typeof data.cost_price !== 'undefined') ? data.cost_price : costPrice,
        groupName: groupName
      };

      // Also add to invoice via client-side invoice flow if available
      try {
        const partName = data.part_name || this.currentPart.name || this.currentPart.part_name || '';
        const qty = data.quantity || quantity;
        const price = data.sell_price || sellPrice || 0;
        const cost = (typeof data.cost_price !== 'undefined') ? data.cost_price : costPrice;
        if (typeof window.addPartToInvoice === 'function') {
          const partItemId = await window.addPartToInvoice(this.currentJobId, partName, qty, price, cost, groupName);
          console.log('[PartPricingModal] added part to invoice via addPartToInvoice', { jobId: this.currentJobId, partName, qty, price, cost, partItemId });
          // Store the invoice item ID for linking
          if (partItemId) this.lastAddedPartData.invoiceItemId = partItemId;
        } else if (typeof addPartToInvoice === 'function') {
          const partItemId = await addPartToInvoice(this.currentJobId, partName, qty, price, cost, groupName);
          if (partItemId) this.lastAddedPartData.invoiceItemId = partItemId;
        } else {
          console.warn('[PartPricingModal] addPartToInvoice not available on window');
        }
      } catch (err) {
        console.error('[PartPricingModal] failed to add part to invoice locally', err);
      }

      // Show a success notification to the user
      showNotification('Part added to invoice', 'success');

    } catch (error) {
      console.error('Error adding part:', error);
      try { showNotification('Failed to add part to job', 'error'); } catch (e) { PartPricingModal._fallbackNotification('Failed to add part to job', 'error'); }

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
        <div id="partLaborConfirmModal" style="display:none; position:fixed; top:0; left:0; width:100vw; height:100vh; background:rgba(0,0,0,0.35); z-index:10060;">
          <div class="card" style="position:absolute; left:50%; top:50%; transform:translate(-50%,-50%); max-width:400px; width:95vw; z-index:10061; box-shadow:0 20px 60px rgba(0,0,0,0.3);">
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
      modal.style.display = 'none';
      // Save the part first
      try {
        await this.savePart();
      } catch (err) {
        console.error('[PartPricingModal] savePart failed before opening labor modal', err);
        return;
      }
      // Route to the same workflow as manual parts: open the jobs page labor modal
      try {
        this.showLaborModal();
      } catch (err) {
        console.error('[PartPricingModal] showLaborModal call failed', err);
      }
      if (this.overlay) this.overlay.style.display = 'none';
      if (this.modal) this.modal.style.display = 'none';
      return;
    };
    document.getElementById('confirmPartAddInvoice').onclick = () => {
      modal.style.display = 'none';
      this.savePart();
    };
  }

  /**
   * Show labor modal for adding labor to job
   */
  async showLaborModal() {
    console.log('[LaborModal] showLaborModal called');
    let modal = document.getElementById('laborModal');
    if (modal) {
      modal.classList.remove('hidden');
      modal.style.zIndex = '9999';
    }
    // Clear description and default hours to 1
    const labDescEl = document.getElementById('labDesc');
    const labHoursEl = document.getElementById('labHours');
    const labNoteEl = document.getElementById('labNote');
    if (labDescEl) labDescEl.value = '';
    if (labHoursEl) labHoursEl.value = '1';
    if (labNoteEl) labNoteEl.textContent = '';
    
    // Populate labor rates
    let chipsDiv = document.getElementById('laborRateChips');
    const sel = document.getElementById('labRateSel');
    const customInp = document.getElementById('labRateCustom');
    if (chipsDiv) chipsDiv.innerHTML = '';
    
    try {
      let settings = JSON.parse(localStorage.getItem('xm_data') || '{}').settings || {};
      let laborRates = settings.labor_rates || [];
      
      // Try fetching from Supabase if not in localStorage
      if ((!laborRates || laborRates.length === 0)) {
        try {
          const { getSupabaseClient } = await import('../helpers/supabase.js');
          const supabase = getSupabaseClient();
          let shopId = null;
          try { shopId = JSON.parse(localStorage.getItem('xm_session')||'{}').shopId || null; } catch(e){}
          if (supabase && shopId) {
            const { data: dataRecord, error } = await supabase
              .from('data')
              .select('settings')
              .eq('shop_id', shopId)
              .single();
            if (!error && dataRecord && dataRecord.settings) {
              settings = dataRecord.settings || {};
              laborRates = settings.labor_rates || [];
              try {
                const localData = JSON.parse(localStorage.getItem('xm_data') || '{}');
                localData.settings = Object.assign(localData.settings || {}, settings);
                localStorage.setItem('xm_data', JSON.stringify(localData));
              } catch (e) {}
            }
          }
        } catch (e) {
          console.warn('[PartPricingModal] Supabase fallback failed', e);
        }
      }
      
      if (sel) {
        sel.innerHTML = '';
        const optCustom = document.createElement('option');
        optCustom.value = '__custom__';
        optCustom.text = 'Custom';
        sel.appendChild(optCustom);
        laborRates.forEach(r => {
          const opt = document.createElement('option');
          opt.value = r.name;
          opt.dataset.rate = r.rate;
          opt.text = `${r.name} - $${r.rate}/hr`;
          sel.appendChild(opt);
        });
        if (customInp) customInp.style.display = '';
        sel.value = '__custom__';
        if (customInp) { customInp.value = ''; try { customInp.focus(); } catch(e){} }
      }
      
      // Add chips for quick selection
      laborRates.forEach(rate => {
        if (!chipsDiv) return;
        const chip = document.createElement('button');
        chip.className = 'chip';
        chip.textContent = `${rate.name} - $${rate.rate}/hr`;
        chip.style.marginRight = '6px';
        chip.onclick = () => {
          if (sel) {
            sel.value = rate.name;
            if (customInp) customInp.value = rate.rate;
          }
        };
        chipsDiv.appendChild(chip);
      });
    } catch (e) {
      console.warn('[LaborModal] failed to populate labor rates', e);
      if (sel) sel.innerHTML = '<option value="__custom__" selected>Custom</option>';
    }
    
    // When preset is chosen, populate custom input
    if (sel) {
      sel.addEventListener('change', () => {
        const rateVal = sel.selectedOptions[0]?.dataset?.rate;
        if (rateVal && customInp) customInp.value = rateVal;
      });
    }
    
    // Ensure modal knows which job
    try {
      modal.dataset.jobId = this.currentJobId;
    } catch (e) {}

    // Bind buttons
    const cancelBtn = document.getElementById('cancelLaborBtn') || document.getElementById('labClose');
    if (cancelBtn) {
      cancelBtn.onclick = () => { if (modal) modal.classList.add('hidden'); };
    }

    const addBtn = document.getElementById('addLaborInvoiceBtn') || document.getElementById('labConfirm');
    if (addBtn) {
      addBtn.onclick = () => {
        if (modal) modal.classList.add('hidden');
        this.saveLabor();
      };
    }
  }

  /**
   * Save labor to job/invoice
   */
  async saveLabor() {
    const desc = (document.getElementById('labDesc') || {}).value?.trim() || '';
    const hours = parseFloat((document.getElementById('labHours') || {}).value) || 0;
    let rate = 0;
    const sel = document.getElementById('labRateSel');
    const custom = document.getElementById('labRateCustom');
    if (sel && sel.value) {
      rate = parseFloat(sel.selectedOptions[0]?.dataset?.rate) || parseFloat((custom || {}).value) || 0;
    } else {
      rate = parseFloat((document.getElementById('laborRate') || {}).value) || parseFloat((custom || {}).value) || 0;
    }
    const notes = (document.getElementById('laborNotes') || {}).value?.trim() || '';
    
    const usingPreset = sel && sel.value && sel.value !== '__custom__';
    if (hours <= 0 || rate <= 0) {
      showNotification('Please enter valid labor hours and rate', 'error');
      return;
    }
    if (!usingPreset && !desc) {
      showNotification('Please enter a labor description for custom rates', 'error');
      return;
    }
    
    let finalDesc = desc;
    if (usingPreset && !finalDesc) finalDesc = sel.selectedOptions[0]?.text || sel.value || '';

    // Save labor to backend
    try {
      const API_BASE = (window.XM_API_BASE !== undefined) ? window.XM_API_BASE : '';
      const response = await fetch(`${API_BASE}/api/catalog/add-labor`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobId: this.currentJobId,
          description: finalDesc,
          hours: hours,
          rate: rate,
          notes: notes
        })
      });
      if (!response.ok) throw new Error('Failed to add labor');
      
      // Add labor to invoice WITH LINKING to the last added part
      try {
        const descVal = finalDesc || document.getElementById('labDesc')?.value.trim() || '';
        const hoursVal = parseFloat(document.getElementById('labHours')?.value) || hours || 0;
        const selEl = document.getElementById('labRateSel');
        const customEl = document.getElementById('labRateCustom');
        let rateVal = rate || 0;
        if (selEl && selEl.value) {
          if (selEl.value === '__custom__') rateVal = parseFloat((customEl || {}).value) || rateVal;
          else rateVal = parseFloat(selEl.selectedOptions[0]?.dataset?.rate) || rateVal;
        } else {
          rateVal = parseFloat(document.getElementById('laborRate')?.value) || rateVal;
        }
        
        // Get the linkedItemId and groupName from the last added part
        const linkedItemId = this.lastAddedPartData?.invoiceItemId || null;
        const groupName = this.lastAddedPartData?.groupName || null;
        
        console.log('[PartPricingModal] Adding labor with linkedItemId:', linkedItemId, 'groupName:', groupName);
        
        if (typeof window.addLaborToInvoice === 'function') {
          await window.addLaborToInvoice(this.currentJobId, descVal, hoursVal, rateVal, linkedItemId, groupName);
        } else if (typeof addLaborToInvoice === 'function') {
          await addLaborToInvoice(this.currentJobId, descVal, hoursVal, rateVal, linkedItemId, groupName);
        }
        
        // Clear the last added part data after linking
        this.lastAddedPartData = null;
      } catch (err) {
        console.error('[PartPricingModal] failed to add labor to invoice locally', err);
      }
      
      showNotification('Part and labor successfully added!', 'success');
    } catch (error) {
      showNotification('Failed to add labor', 'error');
    }
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
      banner.style.zIndex = '9999';
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
