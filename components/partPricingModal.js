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
      <div id="partPricingOverlay" style="display:none; position:fixed; top:0; left:0; width:100vw; height:100vh; background:rgba(0,0,0,0.35); z-index:100;">
        <div id="partPricingModal" class="card" style="position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); max-width: 500px; width: 95vw; z-index: 101; box-shadow: 0 20px 60px rgba(0,0,0,0.3);">
          <div class="modal-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
            <h3 style="margin: 0;">Add Part to Job</h3>
            <button class="modal-close" id="closePricingModal" style="background: none; border: none; font-size: 24px; cursor: pointer; padding: 0; line-height: 1;">&times;</button>
          </div>
          <div class="modal-body">
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
  show(part, jobId, callback) {
    console.log('🔵 Pricing modal show() called', { part, jobId });
    this.currentPart = part;
    this.currentJobId = jobId;
    this.callback = callback;
    if (!this.modal) {
      console.log('🔨 Creating modal for first time');
      this.createModal();
    }
    // Populate part info
    const nameEl = document.getElementById('pricingPartName');
    const numberEl = document.getElementById('pricingPartNumber');
    if (nameEl) nameEl.textContent = part.name || part.part_name; // Support both field names
    if (numberEl) numberEl.textContent = part.part_number || 'N/A';
    // Reset form
    const qtyEl = document.getElementById('pricingQuantity');
    const costEl = document.getElementById('pricingCost');
    const sellEl = document.getElementById('pricingSell');
    if (qtyEl) qtyEl.value = '1';
    if (costEl) costEl.value = '';
    if (sellEl) sellEl.value = '';
    const markupEl = document.getElementById('pricingMarkup');
    const profitEl = document.getElementById('pricingProfit');
    if (markupEl) markupEl.textContent = '0%';
    if (profitEl) profitEl.textContent = '$0.00';
    // Show overlay and modal
    if (this.overlay) this.overlay.style.display = 'block';
    if (this.modal) this.modal.style.display = 'block';
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
    const shopId = this.getCurrentShopId();

    if (!shopId) {
      showNotification('Shop ID not found', 'error');
      return;
    }

    // Validation
    if (quantity < 1) {
      showNotification('Quantity must be at least 1', 'error');
      return;
    }

    if (costPrice < 0 || sellPrice < 0) {
      showNotification('Prices cannot be negative', 'error');
      return;
    }

    if (sellPrice < costPrice) {
      const confirm = await this.showConfirmation(
        'Sell price is lower than cost. Continue anyway?'
      );
      if (!confirm) return;
    }

    // Show loading state
    document.getElementById('savePricingBtn').disabled = true;
    document.getElementById('savePricingBtn').textContent = 'Adding...';

    try {
      const response = await fetch('/api/catalog/add-part', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobId: this.currentJobId,
          partId: this.currentPart.id,
          quantity: quantity,
          costPrice: costPrice,
          sellPrice: sellPrice,
          shopId: shopId,
          notes: notes
        })
      });

      if (!response.ok) throw new Error('Failed to add part');

      const data = await response.json();
      
      // Close modal
      this.modal.style.display = 'none';
      
      // Call callback if provided
      if (this.callback) {
        this.callback(data);
      }

      // Also add to invoice via client-side invoice flow if available
      try {
        const partName = data.part_name || this.currentPart.name || this.currentPart.part_name || '';
        const qty = data.quantity || quantity;
        const price = data.sell_price || sellPrice || 0;
        const cost = (typeof data.cost_price !== 'undefined') ? data.cost_price : costPrice;
        if (typeof window.addPartToInvoice === 'function') {
          await window.addPartToInvoice(this.currentJobId, partName, qty, price, cost);
          console.log('[PartPricingModal] added part to invoice via addPartToInvoice', { jobId: this.currentJobId, partName, qty, price, cost });
        } else if (typeof addPartToInvoice === 'function') {
          await addPartToInvoice(this.currentJobId, partName, qty, price, cost);
        } else {
          console.warn('[PartPricingModal] addPartToInvoice not available on window');
        }
      } catch (err) {
        console.error('[PartPricingModal] failed to add part to invoice locally', err);
      }
      // Show a success notification to the user
      try { showNotification('Part added to invoice', 'success'); } catch (e) {}

    } catch (error) {
      console.error('Error adding part:', error);
      showNotification('Failed to add part to job', 'error');
    } finally {
      // Reset button state
      document.getElementById('savePricingBtn').disabled = false;
      document.getElementById('savePricingBtn').textContent = 'Add Part';
    }
  }

  /**
   * Show confirmation modal after part pricing
   */
  showConfirmationModal() {
    if (!document.getElementById('partLaborConfirmModal')) {
      const confirmHTML = `
        <div id="partLaborConfirmModal" style="display:none; position:fixed; top:0; left:0; width:100vw; height:100vh; background:rgba(0,0,0,0.35); z-index:110;">
          <div class="card" style="position:absolute; left:50%; top:50%; transform:translate(-50%,-50%); max-width:400px; width:95vw; z-index:111; box-shadow:0 20px 60px rgba(0,0,0,0.3);">
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
      // First save the part so invoice contains the part before adding labor
      try {
        await this.savePart();
      } catch (err) {
        console.error('[PartPricingModal] savePart failed before opening labor modal', err);
        return;
      }
      // Prefer opening the global jobs labor modal if present so flow is consistent
      const globalLaborModal = document.getElementById('laborModal');
      if (globalLaborModal) {
        // Close pricing modal/overlay
        if (this.overlay) this.overlay.style.display = 'none';
        if (this.modal) this.modal.style.display = 'none';
        // Open jobs page labor modal and set job id
        globalLaborModal.classList.remove('hidden');
        globalLaborModal.dataset.jobId = this.currentJobId;
        // Ensure the global labor modal appears above the pricing modal overlay
        try {
          globalLaborModal.style.zIndex = '10005';
          // If modal contains inner card, also raise it
          const inner = globalLaborModal.querySelector('.card') || globalLaborModal;
          if (inner) inner.style.zIndex = '10006';
        } catch (e) {
          console.warn('[PartPricingModal] failed to set z-index on global labor modal', e);
        }
        // Clear / reset fields if present
        const labDesc = document.getElementById('labDesc');
        const labHours = document.getElementById('labHours');
        const labRate = document.getElementById('labRate');
        const labNote = document.getElementById('labNote');
        if (labDesc) labDesc.value = '';
        if (labHours) labHours.value = '';
        if (labRate) labRate.value = '';
        if (labNote) labNote.textContent = '';
      } else {
        this.showLaborModal();
      }
    };
    document.getElementById('confirmPartAddInvoice').onclick = () => {
      modal.style.display = 'none';
      this.savePart();
    };
  }

  /**
   * Show labor modal for adding labor to job
   */
  showLaborModal() {
    console.log('[LaborModal] showLaborModal called');
    let modal = document.getElementById('laborModal');
    if (!modal) {
      console.log('[LaborModal] Creating labor modal HTML');
      const laborHTML = `
        <div id="laborModal" style="display:none; position:fixed; top:0; left:0; width:100vw; height:100vh; background:rgba(0,0,0,0.45); z-index:9999;">
          <div class="card" style="position:absolute; left:50%; top:50%; transform:translate(-50%,-50%); max-width:400px; width:95vw; z-index:10000; box-shadow:0 20px 60px rgba(0,0,0,0.3);">
            <div style="padding:1.5rem;">
              <h3>Add Labor</h3>
              <div class="form-field">
                <label>Description</label>
                <input type="text" id="labDesc" class="form-control" placeholder="Labor description" />
              </div>
              <div class="form-field">
                <label>Hours</label>
                <input type="number" id="labHours" class="form-control" min="0.1" step="0.1" value="1" />
              </div>
              <div class="form-field">
                <label>Rate</label>
                <select id="labRateSel" class="form-control"></select>
                <input id="labRateCustom" type="number" step="0.01" placeholder="Custom $/hr" style="margin-top:6px; width:100%;">
                <div id="laborRateChips" style="margin-top:8px;"></div>
              </div>
              <div class="form-field">
                <label>Notes (Optional)</label>
                <textarea id="laborNotes" class="form-control" rows="2" placeholder="Special notes..."></textarea>
              </div>
              <div style="display:flex; justify-content:flex-end; gap:8px; margin-top:1.5rem;">
                <button class="btn" id="cancelLaborBtn" type="button">Cancel</button>
                <button class="btn primary" id="addLaborInvoiceBtn" type="button">Add to Invoice</button>
              </div>
            </div>
          </div>
        </div>
      `;
      document.body.insertAdjacentHTML('beforeend', laborHTML);
      modal = document.getElementById('laborModal');
      console.log('[LaborModal] Labor modal created:', modal);
    }
    modal.style.display = 'block';
    modal.style.zIndex = '9999';
    // Populate labor rates into the select and chips
    let chipsDiv = document.getElementById('laborRateChips');
    const sel = document.getElementById('labRateSel');
    const customInp = document.getElementById('labRateCustom');
    if (chipsDiv) chipsDiv.innerHTML = '';
    try {
      const settings = JSON.parse(localStorage.getItem('xm_data') || '{}').settings || {};
      const laborRates = settings.labor_rates || [];
      if (sel) {
        // populate only saved presets
        sel.innerHTML = '';
        // Insert top 'Custom' option so users can immediately type a custom rate
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
      }
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
    }
    // When a preset is chosen, populate the numeric rate input with the preset value
    if (sel) {
      sel.addEventListener('change', () => {
        const rateVal = sel.selectedOptions[0]?.dataset?.rate;
        if (rateVal && customInp) customInp.value = rateVal;
      });
    }
    const cancelBtn = document.getElementById('cancelLaborBtn');
    if (cancelBtn) {
      cancelBtn.onclick = () => { modal.style.display = 'none'; };
    } else {
      console.log('[LaborModal] cancelLaborBtn not found');
    }
    const addBtn = document.getElementById('addLaborInvoiceBtn');
    if (addBtn) {
      addBtn.onclick = () => {
        modal.style.display = 'none';
        this.saveLabor();
      };
    } else {
      console.log('[LaborModal] addLaborInvoiceBtn not found');
    }
    console.log('[LaborModal] showLaborModal finished');
  }

  /**
   * Save labor to job/invoice
   */
  async saveLabor() {
    const desc = (document.getElementById('labDesc') || {}).value?.trim() || '';
    const hours = parseFloat((document.getElementById('labHours') || {}).value) || 0;
    // get rate from preset select (if chosen) or custom numeric input
    let rate = 0;
    const sel = document.getElementById('labRateSel');
    const custom = document.getElementById('labRateCustom');
    if (sel && sel.value) {
      rate = parseFloat(sel.selectedOptions[0]?.dataset?.rate) || parseFloat((custom || {}).value) || 0;
    } else {
      // backwards compat
      rate = parseFloat((document.getElementById('laborRate') || {}).value) || parseFloat((custom || {}).value) || 0;
    }
    const notes = document.getElementById('laborNotes').value.trim();
    // Require description only when using Custom rate (or when select is missing)
    const usingPreset = sel && sel.value && sel.value !== '__custom__';
    if (hours <= 0 || rate <= 0) {
      showNotification('Please enter valid labor hours and rate', 'error');
      return;
    }
    if (!usingPreset && !desc) {
      showNotification('Please enter a labor description for custom rates', 'error');
      return;
    }
    // If using a preset and description is empty, use preset label as description
    let finalDesc = desc;
    if (usingPreset && !finalDesc) finalDesc = sel.selectedOptions[0]?.text || sel.value || '';

    // Save labor to backend
    try {
      const response = await fetch('/api/catalog/add-labor', {
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
      // Add part as well
      await this.savePart();
      // Also add labor to invoice via client-side function if available
      try {
        // prefer the final description used for backend (falls back to input value)
        const descVal = finalDesc || document.getElementById('labDesc')?.value.trim() || '';
        const hoursVal = parseFloat(document.getElementById('labHours')?.value) || hours || 0;
        // try select/custom first
        const selEl = document.getElementById('labRateSel');
        const customEl = document.getElementById('labRateCustom');
        let rateVal = rate || 0;
        if (selEl && selEl.value) {
          if (selEl.value === '__custom__') rateVal = parseFloat((customEl || {}).value) || rateVal;
          else rateVal = parseFloat(selEl.selectedOptions[0]?.dataset?.rate) || rateVal;
        } else {
          rateVal = parseFloat(document.getElementById('laborRate')?.value) || rateVal;
        }
        if (typeof window.addLaborToInvoice === 'function') {
          await window.addLaborToInvoice(this.currentJobId, descVal, hoursVal, rateVal);
          console.log('[PartPricingModal] added labor to invoice via addLaborToInvoice', { jobId: this.currentJobId, descVal, hoursVal, rateVal });
        } else if (typeof addLaborToInvoice === 'function') {
          await addLaborToInvoice(this.currentJobId, descVal, hoursVal, rateVal);
        } else {
          console.warn('[PartPricingModal] addLaborToInvoice not available on window');
        }
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
      const result = confirm(message);
      resolve(result);
    });
  }
}

// Export as global instance
window.partPricingModal = new PartPricingModal();
