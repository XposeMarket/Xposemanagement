/**
 * components/inspectionFormModal.js
 * Mobile-first Digital Vehicle Inspection Form
 * 
 * Main inspection form that techs use to perform inspections.
 * Supports swipe gestures, photo capture, and offline-ish resilience.
 */

import { 
  INSPECTION_TEMPLATES, 
  INSPECTION_STATUSES, 
  INSPECTION_PRIORITIES,
  INSPECTION_GRADES,
  getTemplateById,
  createInspectionFromTemplate,
  calculateCounts,
  calculateGrade,
  getStatusInfo,
  getGradeInfo
} from '../helpers/inspection-templates.js';

import {
  createInspection,
  getInspectionById,
  updateInspectionSections,
  updateInspectionStatus,
  updateInspectionNotes,
  setUnsafeToDrive,
  uploadInspectionMedia,
  getInspectionMedia,
  deleteInspectionMedia,
  deleteInspection,
  checkForInspection
} from '../helpers/inspection-api.js';

// =============================================
// INSPECTION FORM MODAL CLASS
// =============================================

export class InspectionFormModal {
  constructor() {
    this.modalElement = null;
    this.inspection = null;
    this.sections = [];
    this.currentSectionIndex = 0;
    this.appointmentId = null;
    this.jobId = null;
    this.vehicleInfo = null;
    this.customerInfo = null;
    this.mediaCache = new Map(); // mediaId -> {url, type}
    this.isDirty = false;
    this.autoSaveTimeout = null;
    this.touchStartX = 0;
    this.touchStartY = 0;
    this.onCloseCallback = null;
    this.statusFilter = null; // null = show all, 'pass' | 'attention' | 'fail' = filter
    
    // Bind methods
    this.handleTouchStart = this.handleTouchStart.bind(this);
    this.handleTouchEnd = this.handleTouchEnd.bind(this);
    this.handleKeydown = this.handleKeydown.bind(this);
  }

  // =============================================
  // OPEN MODAL
  // =============================================

  /**
   * Open the inspection form
   * @param {object} options
   * @param {string} options.appointmentId - Required
   * @param {string} options.jobId - Optional
   * @param {object} options.vehicleInfo - { year, make, model, vin, mileage }
   * @param {object} options.customerInfo - { name, phone, email }
   * @param {string} options.inspectionId - If editing existing
   * @param {function} options.onClose - Callback when modal closes
   */
  async open(options = {}) {
    this.appointmentId = options.appointmentId;
    this.jobId = options.jobId;
    this.vehicleInfo = options.vehicleInfo || {};
    this.customerInfo = options.customerInfo || {};
    this.onCloseCallback = options.onClose;

    // Check for existing inspection
    if (options.inspectionId) {
      this.inspection = await getInspectionById(options.inspectionId);
    } else {
      const { inspection } = await checkForInspection(this.appointmentId, this.jobId);
      this.inspection = inspection;
    }

    if (this.inspection) {
      // Load existing inspection
      this.sections = this.inspection.sections || [];
      this.statusFilter = null; // Reset filter
      await this.loadMedia();
    } else {
      // Show template selection first
      this.showTemplateSelection();
      return;
    }

    this.render();
    this.attachEventListeners();
  }

  // =============================================
  // TEMPLATE SELECTION
  // =============================================

  showTemplateSelection() {
    const templates = Object.values(INSPECTION_TEMPLATES);
    
    const html = `
      <div class="modal-backdrop inspection-modal-backdrop" id="inspectionTemplateModal">
        <div class="modal-card inspection-template-modal">
          <div class="modal-head">
            <span class="modal-title">Select Inspection Type</span>
            <button class="modal-close" id="closeTemplateModal">&times;</button>
          </div>
          <div class="modal-body template-selection-body">
            <div class="vehicle-info-banner">
              <span class="vehicle-text">
                ${this.vehicleInfo.year || ''} ${this.vehicleInfo.make || ''} ${this.vehicleInfo.model || ''}
              </span>
              ${this.vehicleInfo.mileage ? `<span class="mileage-text">${this.vehicleInfo.mileage.toLocaleString()} mi</span>` : ''}
            </div>
            <div class="template-cards-grid">
              ${templates.map(t => `
                <div class="template-card" data-template-id="${t.id}">
                  <div class="template-icon">${t.icon}</div>
                  <div class="template-info">
                    <div class="template-name">${t.name}</div>
                    <div class="template-desc">${t.description}</div>
                    <div class="template-time">${t.estimatedTime}</div>
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
        </div>
      </div>
    `;

    document.body.insertAdjacentHTML('beforeend', html);
    
    // Add styles if not already present
    this.injectStyles();

    // Attach events
    document.getElementById('closeTemplateModal')?.addEventListener('click', () => {
      this.closeTemplateSelection();
    });

    document.querySelectorAll('.template-card').forEach(card => {
      card.addEventListener('click', async () => {
        const templateId = card.dataset.templateId;
        await this.startInspection(templateId);
      });
    });

    // Close on backdrop click
    document.getElementById('inspectionTemplateModal')?.addEventListener('click', (e) => {
      if (e.target.classList.contains('inspection-modal-backdrop')) {
        this.closeTemplateSelection();
      }
    });
  }

  closeTemplateSelection() {
    document.getElementById('inspectionTemplateModal')?.remove();
    if (this.onCloseCallback) {
      this.onCloseCallback(null);
    }
  }

  async startInspection(templateId) {
    // Close template selection
    document.getElementById('inspectionTemplateModal')?.remove();

    // Show loading
    this.showLoading('Creating inspection...');

    // Create the inspection
    this.inspection = await createInspection({
      appointmentId: this.appointmentId,
      jobId: this.jobId,
      templateId,
      vehicleId: this.vehicleInfo?.id,
      customerId: this.customerInfo?.id
    });

    this.hideLoading();

    if (!this.inspection) {
      this.showError('Failed to create inspection');
      return;
    }

    this.sections = this.inspection.sections || [];
    this.currentSectionIndex = 0;
    this.statusFilter = null; // Reset filter for new inspection
    
    this.render();
    this.attachEventListeners();
  }

  // =============================================
  // MAIN RENDER
  // =============================================

  render() {
    // Remove any existing modal
    this.modalElement?.remove();

    const currentSection = this.sections[this.currentSectionIndex];
    const counts = calculateCounts(this.sections);
    const grade = calculateGrade(counts, this.inspection?.unsafe_to_drive);
    const gradeInfo = getGradeInfo(grade);

    const html = `
      <div class="modal-backdrop inspection-modal-backdrop" id="inspectionFormModal">
        <div class="modal-card inspection-form-modal">
          <!-- Header -->
          <div class="inspection-header">
            <div class="inspection-header-top">
              <button class="inspection-back-btn" id="inspectionBackBtn">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M19 12H5M12 19l-7-7 7-7"/>
                </svg>
              </button>
              <div class="inspection-title-area">
                <div class="inspection-title">${this.inspection?.template_name || 'Inspection'}</div>
                <div class="inspection-subtitle">
                  ${this.vehicleInfo.year || ''} ${this.vehicleInfo.make || ''} ${this.vehicleInfo.model || ''}
                </div>
              </div>
              <div class="inspection-grade-badge" style="background-color: ${gradeInfo.bgColor}; color: ${gradeInfo.color}">
                ${grade}
              </div>
            </div>
            
            <!-- Progress bar (hidden when filter active) -->
            ${!this.statusFilter ? `
            <div class="inspection-progress">
              <div class="inspection-progress-bar">
                <div class="inspection-progress-fill" style="width: ${this.calculateProgress()}%"></div>
              </div>
              <div class="inspection-progress-text">
                Section ${this.currentSectionIndex + 1} of ${this.sections.length}
              </div>
            </div>
            ` : ''}
            
            <!-- Section tabs (hidden when filter active) -->
            ${!this.statusFilter ? `
            <div class="inspection-section-tabs" id="sectionTabs">
              ${this.sections.map((s, i) => `
                <button class="section-tab ${i === this.currentSectionIndex ? 'active' : ''}" data-section="${i}">
                  ${s.icon || ''} ${s.name}
                </button>
              `).join('')}
            </div>
            ` : `
            <div class="filter-active-header">
              <span class="filter-active-label">Showing all <strong>${this.statusFilter}</strong> items across all sections</span>
            </div>
            `}
          </div>

          <!-- Body - Current Section Items or Filtered View -->
          <div class="inspection-body" id="inspectionBody">
            ${this.statusFilter ? this.renderFilteredView() : (currentSection ? this.renderSection(currentSection) : '<p>No sections</p>')}
          </div>

          <!-- Footer -->
          <div class="inspection-footer">
            <div class="inspection-counts">
              <span class="count-badge pass ${this.statusFilter === 'pass' ? 'active-filter' : ''}" data-filter="pass" title="Click to filter">${counts.passCount} ✓</span>
              <span class="count-badge attention ${this.statusFilter === 'attention' ? 'active-filter' : ''}" data-filter="attention" title="Click to filter">${counts.attentionCount} —</span>
              <span class="count-badge fail ${this.statusFilter === 'fail' ? 'active-filter' : ''}" data-filter="fail" title="Click to filter">${counts.failCount} !</span>
              ${this.statusFilter ? `<span class="count-badge clear-filter" data-filter="clear" title="Show all">✕</span>` : ''}
            </div>
            <div class="inspection-actions">
              ${this.statusFilter ? `
                <button class="btn-primary" id="clearFilterBtn">
                  Show All
                </button>
              ` : `
                <button class="btn-secondary" id="prevSectionBtn" ${this.currentSectionIndex === 0 ? 'disabled' : ''}>
                  ← Prev
                </button>
                ${this.currentSectionIndex === this.sections.length - 1 ? `
                  <button class="btn-primary" id="finishInspectionBtn">
                    Finish
                  </button>
                ` : `
                  <button class="btn-primary" id="nextSectionBtn">
                    Next →
                  </button>
                `}
              `}
            </div>
          </div>
        </div>
      </div>
    `;

    document.body.insertAdjacentHTML('beforeend', html);
    this.modalElement = document.getElementById('inspectionFormModal');
    
    this.injectStyles();
    this.scrollSectionTabIntoView();
  }

  renderSection(section) {
    if (!section || !section.items) return '';

    return `
      <div class="inspection-section" data-section-index="${section.sectionIndex}">
        <div class="section-header">
          <span class="section-icon">${section.icon || ''}</span>
          <span class="section-name">${section.name}</span>
        </div>
        <div class="inspection-items">
          ${section.items.map((item, itemIndex) => this.renderItem(item, section.sectionIndex, itemIndex)).join('')}
        </div>
      </div>
    `;
  }

  // Render filtered view - shows all matching items from ALL sections
  renderFilteredView() {
    if (!this.statusFilter) return '';

    const statusLabels = {
      'pass': 'Passed',
      'attention': 'Needs Attention', 
      'fail': 'Failed'
    };

    let totalMatches = 0;
    let sectionsHtml = '';

    this.sections.forEach((section, sectionIdx) => {
      const matchingItems = section.items.filter(item => item.status === this.statusFilter);
      
      if (matchingItems.length > 0) {
        totalMatches += matchingItems.length;
        
        sectionsHtml += `
          <div class="filtered-section-group">
            <div class="filtered-section-title">
              <span class="section-icon">${section.icon || ''}</span>
              <span>${section.name}</span>
              <span class="filtered-section-count">${matchingItems.length}</span>
            </div>
            <div class="inspection-items">
              ${matchingItems.map(item => {
                const originalIndex = section.items.indexOf(item);
                return this.renderItem(item, sectionIdx, originalIndex);
              }).join('')}
            </div>
          </div>
        `;
      }
    });

    if (totalMatches === 0) {
      return `
        <div class="filter-empty-message">
          <div class="filter-empty-icon">${this.statusFilter === 'pass' ? '✓' : this.statusFilter === 'attention' ? '—' : '!'}</div>
          <p>No ${statusLabels[this.statusFilter].toLowerCase()} items found</p>
        </div>
      `;
    }

    return `
      <div class="filtered-view">
        ${sectionsHtml}
      </div>
    `;
  }

  renderItem(item, sectionIndex, itemIndex) {
    const statusInfo = getStatusInfo(item.status);
    // Support both old format (notes string) and new format (entries array)
    const entries = item.entries || [];
    const hasEntries = entries.length > 0;
    // Also support legacy mediaIds at item level
    const legacyMedia = item.mediaIds || [];

    return `
      <div class="inspection-item ${item.status}" data-section="${sectionIndex}" data-item="${itemIndex}">
        <div class="item-main">
          <div class="item-name">${item.name}</div>
          <div class="item-status-buttons">
            ${['pass', 'attention', 'fail', 'n/a'].map(status => {
              const info = getStatusInfo(status);
              return `
                <button class="status-btn ${status} ${item.status === status ? 'active' : ''}" 
                        data-status="${status}" 
                        title="${info.label}">
                  ${info.icon}
                </button>
              `;
            }).join('')}
          </div>
        </div>
        
        ${item.status === 'attention' || item.status === 'fail' ? `
          <div class="item-details">
            <div class="priority-selector">
              <label>Priority:</label>
              ${['low', 'medium', 'high'].map(p => `
                <button class="priority-btn ${p} ${item.priority === p ? 'active' : ''}" data-priority="${p}">
                  ${p.charAt(0).toUpperCase() + p.slice(1)}
                </button>
              `).join('')}
            </div>
            
            <!-- Existing entries -->
            ${hasEntries ? `
              <div class="item-entries">
                ${entries.map((entry, entryIndex) => `
                  <div class="entry-card" data-entry-index="${entryIndex}">
                    <div class="entry-header">
                      <span class="entry-label">Note ${entryIndex + 1}</span>
                      <button class="entry-delete-btn" data-entry-index="${entryIndex}" title="Delete entry">&times;</button>
                    </div>
                    ${entry.note ? `<div class="entry-note">${entry.note}</div>` : ''}
                    ${entry.mediaIds && entry.mediaIds.length > 0 ? `
                      <div class="entry-media-thumbs">
                        ${entry.mediaIds.map(mediaId => {
                          const media = this.mediaCache.get(mediaId);
                          if (!media) return '';
                          return `
                            <div class="media-thumb" data-media-id="${mediaId}" data-entry-index="${entryIndex}">
                              <img src="${media.url}" alt="Photo" />
                              <button class="media-delete-btn" data-media-id="${mediaId}">&times;</button>
                            </div>
                          `;
                        }).join('')}
                      </div>
                    ` : ''}
                  </div>
                `).join('')}
              </div>
            ` : ''}
            
            <!-- Legacy media (for backwards compatibility) -->
            ${legacyMedia.length > 0 && !hasEntries ? `
              <div class="item-media-thumbs">
                ${legacyMedia.map(mediaId => {
                  const media = this.mediaCache.get(mediaId);
                  if (!media) return '';
                  return `
                    <div class="media-thumb" data-media-id="${mediaId}">
                      <img src="${media.url}" alt="Photo" />
                      <button class="media-delete-btn">&times;</button>
                    </div>
                  `;
                }).join('')}
              </div>
            ` : ''}
            
            <!-- Add new entry form -->
            <div class="add-entry-form">
              <div class="add-entry-row">
                <input type="text" class="item-notes-input" placeholder="Add a note (e.g., Front Left Tire - 3mm tread)..." />
                <button class="item-photo-btn" title="Add photo">
                  +
                </button>
                <button class="item-add-entry-btn" title="Add entry">
                  Add
                </button>
              </div>
            </div>
          </div>
        ` : ''}
      </div>
    `;
  }

  // =============================================
  // EVENT LISTENERS
  // =============================================

  attachEventListeners() {
    if (!this.modalElement) return;

    // Back button
    document.getElementById('inspectionBackBtn')?.addEventListener('click', () => {
      this.confirmClose();
    });

    // Section tabs
    document.querySelectorAll('.section-tab').forEach(tab => {
      tab.addEventListener('click', (e) => {
        const sectionIndex = parseInt(e.currentTarget.dataset.section);
        this.goToSection(sectionIndex);
      });
    });

    // Prev/Next buttons
    document.getElementById('prevSectionBtn')?.addEventListener('click', () => {
      this.goToSection(this.currentSectionIndex - 1);
    });
    document.getElementById('nextSectionBtn')?.addEventListener('click', () => {
      this.goToSection(this.currentSectionIndex + 1);
    });

    // Finish button
    document.getElementById('finishInspectionBtn')?.addEventListener('click', () => {
      this.finishInspection();
    });

    // Clear filter button (Show All)
    document.getElementById('clearFilterBtn')?.addEventListener('click', () => {
      this.statusFilter = null;
      this.render();
      this.attachEventListeners();
    });

    // Count badge filter clicks
    this.modalElement.querySelectorAll('.count-badge[data-filter]').forEach(badge => {
      badge.addEventListener('click', (e) => {
        const filter = e.currentTarget.dataset.filter;
        if (filter === 'clear') {
          this.statusFilter = null;
        } else if (this.statusFilter === filter) {
          // Clicking same filter again clears it
          this.statusFilter = null;
        } else {
          this.statusFilter = filter;
        }
        this.render();
        this.attachEventListeners();
      });
    });

    // Status buttons
    this.modalElement.addEventListener('click', (e) => {
      const statusBtn = e.target.closest('.status-btn');
      if (statusBtn) {
        const item = statusBtn.closest('.inspection-item');
        const sectionIndex = parseInt(item.dataset.section);
        const itemIndex = parseInt(item.dataset.item);
        const status = statusBtn.dataset.status;
        this.setItemStatus(sectionIndex, itemIndex, status);
      }

      const priorityBtn = e.target.closest('.priority-btn');
      if (priorityBtn) {
        const item = priorityBtn.closest('.inspection-item');
        const sectionIndex = parseInt(item.dataset.section);
        const itemIndex = parseInt(item.dataset.item);
        const priority = priorityBtn.dataset.priority;
        this.setItemPriority(sectionIndex, itemIndex, priority);
      }

      // Add entry button
      const addEntryBtn = e.target.closest('.item-add-entry-btn');
      if (addEntryBtn) {
        const item = addEntryBtn.closest('.inspection-item');
        const sectionIndex = parseInt(item.dataset.section);
        const itemIndex = parseInt(item.dataset.item);
        const input = item.querySelector('.item-notes-input');
        const noteText = input?.value?.trim() || '';
        this.addEntry(sectionIndex, itemIndex, noteText);
      }

      // Photo button - now adds to pending entry or creates new entry with just photo
      const photoBtn = e.target.closest('.item-photo-btn');
      if (photoBtn) {
        const item = photoBtn.closest('.inspection-item');
        const sectionIndex = parseInt(item.dataset.section);
        const itemIndex = parseInt(item.dataset.item);
        const input = item.querySelector('.item-notes-input');
        const noteText = input?.value?.trim() || '';
        this.capturePhotoForEntry(sectionIndex, itemIndex, noteText);
      }

      // Delete entry button
      const entryDeleteBtn = e.target.closest('.entry-delete-btn');
      if (entryDeleteBtn) {
        const item = entryDeleteBtn.closest('.inspection-item');
        const sectionIndex = parseInt(item.dataset.section);
        const itemIndex = parseInt(item.dataset.item);
        const entryIndex = parseInt(entryDeleteBtn.dataset.entryIndex);
        this.deleteEntry(sectionIndex, itemIndex, entryIndex);
      }

      const mediaDeleteBtn = e.target.closest('.media-delete-btn');
      if (mediaDeleteBtn) {
        const thumb = mediaDeleteBtn.closest('.media-thumb');
        const mediaId = thumb.dataset.mediaId;
        const entryIndex = thumb.dataset.entryIndex;
        const item = thumb.closest('.inspection-item');
        const sectionIndex = parseInt(item.dataset.section);
        const itemIndex = parseInt(item.dataset.item);
        this.deleteMedia(mediaId, sectionIndex, itemIndex, entryIndex ? parseInt(entryIndex) : null);
      }
    });

    // Touch swipe for section navigation
    const body = document.getElementById('inspectionBody');
    body?.addEventListener('touchstart', this.handleTouchStart, { passive: true });
    body?.addEventListener('touchend', this.handleTouchEnd, { passive: true });

    // Keyboard navigation
    document.addEventListener('keydown', this.handleKeydown);

    // Close on backdrop click - just save and close, don't delete
    this.modalElement.addEventListener('click', (e) => {
      if (e.target.classList.contains('inspection-modal-backdrop')) {
        this.saveAndClose();
      }
    });
  }

  handleTouchStart(e) {
    this.touchStartX = e.touches[0].clientX;
    this.touchStartY = e.touches[0].clientY;
  }

  handleTouchEnd(e) {
    const touchEndX = e.changedTouches[0].clientX;
    const touchEndY = e.changedTouches[0].clientY;
    const diffX = touchEndX - this.touchStartX;
    const diffY = touchEndY - this.touchStartY;

    // Only handle horizontal swipes (ignore vertical scrolling)
    if (Math.abs(diffX) > 50 && Math.abs(diffX) > Math.abs(diffY)) {
      if (diffX > 0) {
        // Swipe right - go to previous section
        this.goToSection(this.currentSectionIndex - 1);
      } else {
        // Swipe left - go to next section
        this.goToSection(this.currentSectionIndex + 1);
      }
    }
  }

  handleKeydown(e) {
    if (e.key === 'Escape') {
      this.saveAndClose();
    } else if (e.key === 'ArrowLeft' && !e.target.matches('input, textarea')) {
      this.goToSection(this.currentSectionIndex - 1);
    } else if (e.key === 'ArrowRight' && !e.target.matches('input, textarea')) {
      this.goToSection(this.currentSectionIndex + 1);
    }
  }

  // =============================================
  // ACTIONS
  // =============================================

  goToSection(index) {
    if (index < 0 || index >= this.sections.length) return;
    this.currentSectionIndex = index;
    // Don't reset filter when changing sections - user might want to see all fails across sections
    this.render();
    this.attachEventListeners();
  }

  async setItemStatus(sectionIndex, itemIndex, status) {
    if (!this.sections[sectionIndex]?.items[itemIndex]) return;

    this.sections[sectionIndex].items[itemIndex].status = status;
    
    // Clear priority and entries if setting to pass or n/a
    if (status === 'pass' || status === 'n/a') {
      this.sections[sectionIndex].items[itemIndex].priority = null;
      this.sections[sectionIndex].items[itemIndex].entries = [];
      this.sections[sectionIndex].items[itemIndex].notes = ''; // legacy
    }

    this.isDirty = true;
    this.scheduleAutoSave();
    this.render();
    this.attachEventListeners();
  }

  async setItemPriority(sectionIndex, itemIndex, priority) {
    if (!this.sections[sectionIndex]?.items[itemIndex]) return;

    this.sections[sectionIndex].items[itemIndex].priority = priority;
    this.isDirty = true;
    this.scheduleAutoSave();

    // Just update the button states without full re-render
    const item = this.modalElement.querySelector(`[data-section="${sectionIndex}"][data-item="${itemIndex}"]`);
    item?.querySelectorAll('.priority-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.priority === priority);
    });
  }

  // Add a new entry (note + optional photos)
  async addEntry(sectionIndex, itemIndex, noteText) {
    if (!this.sections[sectionIndex]?.items[itemIndex]) return;
    if (!noteText) {
      alert('Please enter a note before adding.');
      return;
    }

    // Initialize entries array if needed
    if (!this.sections[sectionIndex].items[itemIndex].entries) {
      this.sections[sectionIndex].items[itemIndex].entries = [];
    }

    // Add new entry
    this.sections[sectionIndex].items[itemIndex].entries.push({
      note: noteText,
      mediaIds: []
    });

    this.isDirty = true;
    this.scheduleAutoSave();
    this.render();
    this.attachEventListeners();
  }

  // Delete an entry
  async deleteEntry(sectionIndex, itemIndex, entryIndex) {
    if (!this.sections[sectionIndex]?.items[itemIndex]?.entries?.[entryIndex]) return;
    
    if (!confirm('Delete this note and its photos?')) return;

    // Delete associated media first
    const entry = this.sections[sectionIndex].items[itemIndex].entries[entryIndex];
    if (entry.mediaIds) {
      for (const mediaId of entry.mediaIds) {
        try {
          await deleteInspectionMedia(mediaId);
          this.mediaCache.delete(mediaId);
        } catch (e) {
          console.warn('Could not delete media:', mediaId);
        }
      }
    }

    // Remove entry
    this.sections[sectionIndex].items[itemIndex].entries.splice(entryIndex, 1);

    this.isDirty = true;
    this.scheduleAutoSave();
    this.render();
    this.attachEventListeners();
  }

  // Capture photo and add to a new entry (with optional note)
  async capturePhotoForEntry(sectionIndex, itemIndex, noteText) {
    // Create hidden file input
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*,video/*';
    input.capture = 'environment'; // Use back camera on mobile
    
    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      this.showLoading('Uploading...');

      const result = await uploadInspectionMedia(
        this.inspection.id,
        sectionIndex,
        itemIndex,
        file
      );

      this.hideLoading();

      if (result) {
        // Add to media cache
        this.mediaCache.set(result.id, { url: result.url, type: result.type });
        
        // Initialize entries array if needed
        if (!this.sections[sectionIndex].items[itemIndex].entries) {
          this.sections[sectionIndex].items[itemIndex].entries = [];
        }

        // Create new entry with photo (and note if provided)
        this.sections[sectionIndex].items[itemIndex].entries.push({
          note: noteText || '',
          mediaIds: [result.id]
        });
        
        this.isDirty = true;
        this.scheduleAutoSave();
        this.render();
        this.attachEventListeners();
      } else {
        this.showError('Failed to upload photo');
      }
    };

    input.click();
  }

  async deleteMedia(mediaId, sectionIndex = null, itemIndex = null, entryIndex = null) {
    if (!confirm('Delete this photo?')) return;

    this.showLoading('Deleting...');
    const success = await deleteInspectionMedia(mediaId);
    this.hideLoading();

    if (success) {
      // Remove from cache
      this.mediaCache.delete(mediaId);
      
      // Remove from specific entry if provided
      if (sectionIndex !== null && itemIndex !== null && entryIndex !== null) {
        const entry = this.sections[sectionIndex]?.items[itemIndex]?.entries?.[entryIndex];
        if (entry?.mediaIds) {
          entry.mediaIds = entry.mediaIds.filter(id => id !== mediaId);
        }
      } else {
        // Remove from all items (legacy support)
        this.sections.forEach(section => {
          section.items.forEach(item => {
            if (item.mediaIds) {
              item.mediaIds = item.mediaIds.filter(id => id !== mediaId);
            }
            if (item.entries) {
              item.entries.forEach(entry => {
                if (entry.mediaIds) {
                  entry.mediaIds = entry.mediaIds.filter(id => id !== mediaId);
                }
              });
            }
          });
        });
      }

      this.isDirty = true;
      this.scheduleAutoSave();
      this.render();
      this.attachEventListeners();
    } else {
      this.showError('Failed to delete photo');
    }
  }

  // =============================================
  // AUTO-SAVE
  // =============================================

  scheduleAutoSave() {
    if (this.autoSaveTimeout) {
      clearTimeout(this.autoSaveTimeout);
    }

    this.autoSaveTimeout = setTimeout(() => {
      this.save();
    }, 2000); // Auto-save after 2 seconds of inactivity
  }

  async save() {
    if (!this.isDirty || !this.inspection) return;

    try {
      await updateInspectionSections(
        this.inspection.id,
        this.sections,
        this.inspection.unsafe_to_drive
      );
      this.isDirty = false;
      console.log('✅ Inspection auto-saved');
    } catch (e) {
      console.error('Auto-save failed:', e);
    }
  }

  // =============================================
  // FINISH / CLOSE
  // =============================================

  async finishInspection() {
    // Save any pending changes
    await this.save();

    // Update status to ready_for_review
    await updateInspectionStatus(this.inspection.id, 'ready_for_review');

    // Show summary
    this.showSummary();
  }

  showSummary() {
    const counts = calculateCounts(this.sections);
    const grade = calculateGrade(counts, this.inspection?.unsafe_to_drive);
    const gradeInfo = getGradeInfo(grade);

    const html = `
      <div class="inspection-summary-overlay">
        <div class="inspection-summary-card">
          <div class="summary-grade" style="background-color: ${gradeInfo.bgColor}; color: ${gradeInfo.color}">
            <span class="grade-letter">${grade}</span>
            <span class="grade-label">${gradeInfo.label}</span>
          </div>
          <div class="summary-counts">
            <div class="summary-count pass">
              <span class="count-number">${counts.passCount}</span>
              <span class="count-label">Passed</span>
            </div>
            <div class="summary-count attention">
              <span class="count-number">${counts.attentionCount}</span>
              <span class="count-label">Attention</span>
            </div>
            <div class="summary-count fail">
              <span class="count-number">${counts.failCount}</span>
              <span class="count-label">Failed</span>
            </div>
          </div>
          ${counts.highPriorityCount > 0 ? `
            <div class="summary-warning">
              ⚠️ ${counts.highPriorityCount} high priority item${counts.highPriorityCount > 1 ? 's' : ''} need${counts.highPriorityCount === 1 ? 's' : ''} attention
            </div>
          ` : ''}
          <div class="summary-actions">
            <button class="btn-secondary" id="continueEditingBtn">Continue Editing</button>
            <button class="btn-primary" id="closeInspectionBtn">Done</button>
          </div>
        </div>
      </div>
    `;

    this.modalElement.insertAdjacentHTML('beforeend', html);

    document.getElementById('continueEditingBtn')?.addEventListener('click', () => {
      this.modalElement.querySelector('.inspection-summary-overlay')?.remove();
    });

    document.getElementById('closeInspectionBtn')?.addEventListener('click', () => {
      this.close(true);
    });
  }

  confirmClose() {
    // Show confirmation modal that will DELETE the inspection if user confirms
    this.showDeleteConfirmModal();
  }

  // Save progress and close - user can resume later
  async saveAndClose() {
    // Save any pending changes
    await this.save();
    
    // Update status to in_progress if still draft
    if (this.inspection?.status === 'draft') {
      await updateInspectionStatus(this.inspection.id, 'in_progress');
    }
    
    // Close the modal
    this.close(true);
  }

  showDeleteConfirmModal() {
    // Remove existing confirm modal if any
    document.getElementById('inspectionDeleteConfirmModal')?.remove();

    const html = `
      <div class="inspection-confirm-overlay" id="inspectionDeleteConfirmModal">
        <div class="inspection-confirm-card">
          <div class="confirm-icon">⚠️</div>
          <h3 class="confirm-title">Delete Inspection?</h3>
          <p class="confirm-message">This inspection will be erased and you will need to start over. Are you sure you want to continue?</p>
          <div class="confirm-actions">
            <button class="btn-secondary" id="cancelDeleteInspection">Cancel</button>
            <button class="btn-danger" id="confirmDeleteInspection">Delete & Exit</button>
          </div>
        </div>
      </div>
    `;

    this.modalElement.insertAdjacentHTML('beforeend', html);

    document.getElementById('cancelDeleteInspection')?.addEventListener('click', () => {
      document.getElementById('inspectionDeleteConfirmModal')?.remove();
    });

    document.getElementById('confirmDeleteInspection')?.addEventListener('click', async () => {
      document.getElementById('inspectionDeleteConfirmModal')?.remove();
      
      // Delete the inspection from the database
      if (this.inspection?.id) {
        try {
          await deleteInspection(this.inspection.id);
          console.log('✅ Inspection deleted');
        } catch (e) {
          console.error('Failed to delete inspection:', e);
        }
      }
      
      // Reset state and go back to template selection
      this.resetAndShowTemplateSelection();
    });
  }

  close(saved = true) {
    // Remove event listeners
    document.removeEventListener('keydown', this.handleKeydown);
    
    // Clear auto-save timeout
    if (this.autoSaveTimeout) {
      clearTimeout(this.autoSaveTimeout);
    }

    // Remove modal
    this.modalElement?.remove();
    this.modalElement = null;

    // Callback
    if (this.onCloseCallback) {
      this.onCloseCallback(saved ? this.inspection : null);
    }
  }

  resetAndShowTemplateSelection() {
    // Remove event listeners
    document.removeEventListener('keydown', this.handleKeydown);
    
    // Clear auto-save timeout
    if (this.autoSaveTimeout) {
      clearTimeout(this.autoSaveTimeout);
    }

    // Remove current modal
    this.modalElement?.remove();
    this.modalElement = null;

    // Reset state
    this.inspection = null;
    this.sections = [];
    this.currentSectionIndex = 0;
    this.mediaCache.clear();
    this.isDirty = false;

    // Show template selection again
    this.showTemplateSelection();
  }

  // =============================================
  // HELPERS
  // =============================================

  calculateProgress() {
    let totalItems = 0;
    let completedItems = 0;

    this.sections.forEach(section => {
      section.items.forEach(item => {
        totalItems++;
        if (item.status !== 'pass' || item.status === 'n/a') {
          // Count items that have been actively set (not just default pass)
          // For simplicity, count all items with any status as "complete"
          completedItems++;
        }
      });
    });

    // For now, base progress on section navigation
    return Math.round(((this.currentSectionIndex + 1) / this.sections.length) * 100);
  }

  scrollSectionTabIntoView() {
    const tabs = document.getElementById('sectionTabs');
    const activeTab = tabs?.querySelector('.section-tab.active');
    if (activeTab && tabs) {
      activeTab.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    }
  }

  async loadMedia() {
    if (!this.inspection) return;

    const media = await getInspectionMedia(this.inspection.id);
    media.forEach(m => {
      this.mediaCache.set(m.id, { url: m.media_url, type: m.media_type });
    });
  }

  showLoading(message = 'Loading...') {
    const existing = document.getElementById('inspectionLoadingOverlay');
    if (existing) existing.remove();

    const html = `
      <div class="inspection-loading-overlay" id="inspectionLoadingOverlay">
        <div class="loading-spinner"></div>
        <div class="loading-message">${message}</div>
      </div>
    `;
    document.body.insertAdjacentHTML('beforeend', html);
  }

  hideLoading() {
    document.getElementById('inspectionLoadingOverlay')?.remove();
  }

  showError(message) {
    alert(message); // Simple for now, can enhance later
  }

  // =============================================
  // STYLES
  // =============================================

  injectStyles() {
    if (document.getElementById('inspectionModalStyles')) return;

    const styles = `
      <style id="inspectionModalStyles">
        /* Modal Base */
        .inspection-modal-backdrop {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0, 0, 0, 0.6);
          z-index: 99999;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .inspection-form-modal,
        .inspection-template-modal {
          background: white;
          border-radius: 12px;
          width: 100%;
          max-width: 500px;
          max-height: 95vh;
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }

        @media (max-width: 540px) {
          .inspection-form-modal,
          .inspection-template-modal {
            max-width: 100%;
            height: 100%;
            max-height: 100%;
            border-radius: 0;
          }
        }

        /* Template Selection */
        .template-selection-body {
          padding: 16px;
        }

        .vehicle-info-banner {
          background: #f3f4f6;
          padding: 12px 16px;
          border-radius: 8px;
          margin-bottom: 16px;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        .vehicle-text {
          font-weight: 600;
          color: #1f2937;
        }

        .mileage-text {
          color: #6b7280;
          font-size: 14px;
        }

        .template-cards-grid {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .template-card {
          display: flex;
          align-items: center;
          gap: 16px;
          padding: 16px;
          border: 2px solid #e5e7eb;
          border-radius: 12px;
          cursor: pointer;
          transition: all 0.2s;
        }

        .template-card:hover {
          border-color: #3b82f6;
          background: #eff6ff;
        }

        .template-card:active {
          transform: scale(0.98);
        }

        .template-icon {
          font-size: 32px;
          min-width: 48px;
          text-align: center;
        }

        .template-info {
          flex: 1;
        }

        .template-name {
          font-weight: 600;
          font-size: 16px;
          color: #1f2937;
        }

        .template-desc {
          color: #6b7280;
          font-size: 14px;
          margin-top: 2px;
        }

        .template-time {
          color: #9ca3af;
          font-size: 12px;
          margin-top: 4px;
        }

        /* Inspection Header */
        .inspection-header {
          background: #f9fafb;
          border-bottom: 1px solid #e5e7eb;
          padding: 0;
        }

        .inspection-header-top {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 12px 16px;
        }

        .inspection-back-btn {
          background: none;
          border: none;
          padding: 8px;
          cursor: pointer;
          border-radius: 8px;
          color: #6b7280;
        }

        .inspection-back-btn:hover {
          background: #e5e7eb;
        }

        .inspection-title-area {
          flex: 1;
        }

        .inspection-title {
          font-weight: 600;
          font-size: 16px;
          color: #1f2937;
        }

        .inspection-subtitle {
          font-size: 13px;
          color: #6b7280;
        }

        .inspection-grade-badge {
          font-size: 20px;
          font-weight: 700;
          width: 40px;
          height: 40px;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 8px;
        }

        /* Progress */
        .inspection-progress {
          padding: 8px 16px;
          border-top: 1px solid #e5e7eb;
        }

        .inspection-progress-bar {
          height: 4px;
          background: #e5e7eb;
          border-radius: 2px;
          overflow: hidden;
        }

        .inspection-progress-fill {
          height: 100%;
          background: #3b82f6;
          transition: width 0.3s ease;
        }

        .inspection-progress-text {
          font-size: 12px;
          color: #6b7280;
          margin-top: 4px;
          text-align: right;
        }

        /* Section Tabs */
        .inspection-section-tabs {
          display: flex;
          overflow-x: auto;
          gap: 8px;
          padding: 12px 16px;
          -webkit-overflow-scrolling: touch;
          scrollbar-width: none;
        }

        .inspection-section-tabs::-webkit-scrollbar {
          display: none;
        }

        .section-tab {
          flex-shrink: 0;
          padding: 8px 16px;
          border: 1px solid #e5e7eb;
          border-radius: 20px;
          background: white;
          font-size: 13px;
          cursor: pointer;
          white-space: nowrap;
          transition: all 0.2s;
        }

        .section-tab.active {
          background: #3b82f6;
          border-color: #3b82f6;
          color: white;
        }

        .section-tab:not(.active):hover {
          border-color: #3b82f6;
          color: #3b82f6;
        }

        /* Body */
        .inspection-body {
          flex: 1;
          overflow-y: auto;
          padding: 16px;
        }

        .section-header {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 16px;
        }

        .section-icon {
          font-size: 20px;
        }

        .section-name {
          font-weight: 600;
          font-size: 18px;
          color: #1f2937;
        }

        /* Inspection Items */
        .inspection-items {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .inspection-item {
          background: white;
          border: 1px solid #e5e7eb;
          border-radius: 8px;
          padding: 12px;
          transition: all 0.2s;
        }

        .inspection-item.pass {
          border-left: 3px solid #10b981;
        }

        .inspection-item.attention {
          border-left: 3px solid #f59e0b;
          background: #fffbeb;
        }

        .inspection-item.fail {
          border-left: 3px solid #ef4444;
          background: #fef2f2;
        }

        .item-main {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .item-name {
          flex: 1;
          font-size: 14px;
          color: #1f2937;
        }

        .item-status-buttons {
          display: flex;
          gap: 4px;
        }

        .status-btn {
          width: 36px;
          height: 36px;
          border-radius: 6px;
          border: 2px solid #e5e7eb;
          background: white;
          cursor: pointer;
          font-size: 13px;
          font-weight: 600;
          transition: all 0.15s;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .status-btn.pass { border-color: #d1fae5; color: #10b981; background: #f0fdf4; }
        .status-btn.pass.active { background: #10b981; color: white; border-color: #10b981; }

        .status-btn.attention { border-color: #fef3c7; color: #92400e; background: #fef3c7; }
        .status-btn.attention.active { background: #f59e0b; color: white; border-color: #f59e0b; }

        .status-btn.fail { border-color: #fee2e2; color: #991b1b; background: #fee2e2; }
        .status-btn.fail.active { background: #ef4444; color: white; border-color: #ef4444; }

        .status-btn.n\\/a { border-color: #e5e7eb; color: #6b7280; background: #f9fafb; font-size: 10px; }
        .status-btn.n\\/a.active { background: #6b7280; color: white; border-color: #6b7280; }

        /* Item Details */
        .item-details {
          margin-top: 12px;
          padding-top: 12px;
          border-top: 1px solid #e5e7eb;
        }

        .priority-selector {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 12px;
        }

        .priority-selector label {
          font-size: 13px;
          color: #6b7280;
        }

        .priority-btn {
          padding: 4px 12px;
          border-radius: 4px;
          border: 1px solid #e5e7eb;
          background: white;
          font-size: 12px;
          cursor: pointer;
        }

        .priority-btn.low.active { background: #f3f4f6; border-color: #6b7280; }
        .priority-btn.medium.active { background: #fef3c7; border-color: #f59e0b; color: #92400e; }
        .priority-btn.high.active { background: #fee2e2; border-color: #ef4444; color: #991b1b; }

        .item-notes-row {
          display: flex;
          gap: 8px;
        }

        .item-notes-input {
          flex: 1;
          padding: 8px 12px;
          border: 1px solid #e5e7eb;
          border-radius: 6px;
          font-size: 14px;
        }

        .item-photo-btn {
          padding: 8px 12px;
          border: 1px solid #e5e7eb;
          border-radius: 6px;
          background: white;
          cursor: pointer;
          font-size: 16px;
        }

        .item-photo-btn:hover {
          background: #f3f4f6;
        }

        .item-add-entry-btn {
          padding: 8px 16px;
          border: none;
          border-radius: 6px;
          background: #3b82f6;
          color: white;
          cursor: pointer;
          font-size: 14px;
          font-weight: 500;
        }

        .item-add-entry-btn:hover {
          background: #2563eb;
        }

        .add-entry-form {
          margin-top: 12px;
        }

        .add-entry-row {
          display: flex;
          gap: 8px;
        }

        /* Entry Cards */
        .item-entries {
          display: flex;
          flex-direction: column;
          gap: 8px;
          margin-bottom: 12px;
        }

        .entry-card {
          background: #f9fafb;
          border: 1px solid #e5e7eb;
          border-radius: 8px;
          padding: 10px;
        }

        .entry-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 6px;
        }

        .entry-label {
          font-size: 11px;
          font-weight: 600;
          color: #6b7280;
          text-transform: uppercase;
        }

        .entry-delete-btn {
          width: 20px;
          height: 20px;
          border-radius: 50%;
          background: #ef4444;
          color: white;
          border: none;
          font-size: 14px;
          line-height: 1;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 0;
        }

        .entry-delete-btn:hover {
          background: #dc2626;
        }

        .entry-note {
          font-size: 14px;
          color: #1f2937;
          line-height: 1.4;
        }

        .entry-media-thumbs {
          display: flex;
          gap: 6px;
          margin-top: 8px;
          overflow-x: auto;
        }

        /* Media Thumbs */
        .item-media-thumbs {
          display: flex;
          gap: 8px;
          margin-top: 12px;
          overflow-x: auto;
        }

        .media-thumb {
          position: relative;
          width: 64px;
          height: 64px;
          flex-shrink: 0;
        }

        .media-thumb img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          border-radius: 6px;
        }

        .media-delete-btn {
          position: absolute;
          top: -4px;
          right: -4px;
          width: 16px;
          height: 16px;
          border-radius: 50%;
          background: #ef4444;
          color: white;
          border: none;
          font-size: 10px;
          line-height: 1;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 0;
        }

        /* Footer */
        .inspection-footer {
          background: #f9fafb;
          border-top: 1px solid #e5e7eb;
          padding: 12px 16px;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        .inspection-counts {
          display: flex;
          gap: 8px;
        }

        .count-badge {
          padding: 4px 8px;
          border-radius: 4px;
          font-size: 12px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.15s;
          user-select: none;
        }

        .count-badge:hover {
          transform: scale(1.05);
          box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }

        .count-badge.pass { background: #dcfce7; color: #166534; }
        .count-badge.attention { background: #fef3c7; color: #92400e; }
        .count-badge.fail { background: #fee2e2; color: #991b1b; }

        .count-badge.active-filter {
          outline: 3px solid currentColor;
          outline-offset: 1px;
          transform: scale(1.1);
        }

        .count-badge.clear-filter {
          background: #f3f4f6;
          color: #6b7280;
          font-size: 14px;
          padding: 4px 10px;
        }

        .count-badge.clear-filter:hover {
          background: #e5e7eb;
        }

        .filter-empty-message {
          text-align: center;
          padding: 40px 24px;
          color: #9ca3af;
        }

        .filter-empty-icon {
          font-size: 48px;
          margin-bottom: 12px;
          opacity: 0.5;
        }

        .filter-empty-message p {
          margin: 0;
          font-size: 16px;
        }

        /* Filter Active Header */
        .filter-active-header {
          padding: 12px 16px;
          background: #f3f4f6;
          border-top: 1px solid #e5e7eb;
        }

        .filter-active-label {
          font-size: 13px;
          color: #6b7280;
          text-transform: capitalize;
        }

        .filter-active-label strong {
          color: #374151;
        }

        /* Filtered View */
        .filtered-view {
          display: flex;
          flex-direction: column;
          gap: 20px;
        }

        .filtered-section-group {
          background: #f9fafb;
          border-radius: 8px;
          padding: 12px;
        }

        .filtered-section-title {
          display: flex;
          align-items: center;
          gap: 8px;
          font-weight: 600;
          font-size: 14px;
          color: #374151;
          margin-bottom: 12px;
          padding-bottom: 8px;
          border-bottom: 1px solid #e5e7eb;
        }

        .filtered-section-title .section-icon {
          font-size: 16px;
        }

        .filtered-section-count {
          margin-left: auto;
          background: #e5e7eb;
          color: #6b7280;
          font-size: 12px;
          font-weight: 600;
          padding: 2px 8px;
          border-radius: 10px;
        }

        .inspection-actions {
          display: flex;
          gap: 8px;
        }

        .btn-primary {
          background: #3b82f6;
          color: white;
          border: none;
          padding: 8px 16px;
          border-radius: 6px;
          font-size: 14px;
          font-weight: 500;
          cursor: pointer;
        }

        .btn-primary:hover {
          background: #2563eb;
        }

        .btn-secondary {
          background: white;
          color: #374151;
          border: 1px solid #d1d5db;
          padding: 8px 16px;
          border-radius: 6px;
          font-size: 14px;
          font-weight: 500;
          cursor: pointer;
        }

        .btn-secondary:hover {
          background: #f3f4f6;
        }

        .btn-secondary:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        /* Summary Overlay */
        .inspection-summary-overlay {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0, 0, 0, 0.5);
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 20px;
        }

        .inspection-summary-card {
          background: white;
          border-radius: 16px;
          padding: 24px;
          text-align: center;
          max-width: 320px;
          width: 100%;
        }

        .summary-grade {
          display: inline-flex;
          flex-direction: column;
          align-items: center;
          padding: 20px 40px;
          border-radius: 12px;
          margin-bottom: 20px;
        }

        .grade-letter {
          font-size: 48px;
          font-weight: 700;
        }

        .grade-label {
          font-size: 14px;
          font-weight: 500;
        }

        .summary-counts {
          display: flex;
          justify-content: center;
          gap: 20px;
          margin-bottom: 16px;
        }

        .summary-count {
          text-align: center;
        }

        .summary-count .count-number {
          display: block;
          font-size: 24px;
          font-weight: 700;
        }

        .summary-count.pass .count-number { color: #10b981; }
        .summary-count.attention .count-number { color: #f59e0b; }
        .summary-count.fail .count-number { color: #ef4444; }

        .summary-count .count-label {
          font-size: 12px;
          color: #6b7280;
        }

        .summary-warning {
          background: #fef3c7;
          color: #92400e;
          padding: 12px;
          border-radius: 8px;
          font-size: 14px;
          margin-bottom: 16px;
        }

        .summary-actions {
          display: flex;
          gap: 12px;
          justify-content: center;
        }

        /* Loading Overlay */
        .inspection-loading-overlay {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(255, 255, 255, 0.9);
          z-index: 10001;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
        }

        .loading-spinner {
          width: 40px;
          height: 40px;
          border: 3px solid #e5e7eb;
          border-top-color: #3b82f6;
          border-radius: 50%;
          animation: spin 0.8s linear infinite;
        }

        @keyframes spin {
          to { transform: rotate(360deg); }
        }

        .loading-message {
          margin-top: 12px;
          color: #6b7280;
          font-size: 14px;
        }

        /* Confirm Overlay */
        .inspection-confirm-overlay {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0, 0, 0, 0.5);
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 20px;
          z-index: 10;
        }

        .inspection-confirm-card {
          background: white;
          border-radius: 16px;
          padding: 24px;
          text-align: center;
          max-width: 320px;
          width: 100%;
        }

        .confirm-icon {
          font-size: 48px;
          margin-bottom: 12px;
        }

        .confirm-title {
          font-size: 18px;
          font-weight: 600;
          color: #1f2937;
          margin: 0 0 8px 0;
        }

        .confirm-message {
          font-size: 14px;
          color: #6b7280;
          margin: 0 0 20px 0;
          line-height: 1.5;
        }

        .confirm-actions {
          display: flex;
          gap: 12px;
          justify-content: center;
        }

        .btn-danger {
          background: #ef4444;
          color: white;
          border: none;
          padding: 8px 16px;
          border-radius: 6px;
          font-size: 14px;
          font-weight: 500;
          cursor: pointer;
        }

        .btn-danger:hover {
          background: #dc2626;
        }
      </style>
    `;

    document.head.insertAdjacentHTML('beforeend', styles);
  }
}

// Create singleton instance
export const inspectionForm = new InspectionFormModal();

// Global access
if (typeof window !== 'undefined') {
  window.InspectionFormModal = InspectionFormModal;
  window.inspectionForm = inspectionForm;
}
