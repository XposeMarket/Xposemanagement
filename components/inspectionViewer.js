/**
 * components/inspectionViewer.js
 * Read-only Inspection Viewer Component
 * 
 * Used for:
 * - Admin reviewing completed inspections
 * - Customer viewing shared inspection reports
 * - Displaying inspection summary on job/appointment modals
 */

import { 
  INSPECTION_STATUSES, 
  INSPECTION_GRADES,
  getStatusInfo,
  getGradeInfo
} from '../helpers/inspection-templates.js';

import {
  getInspectionById,
  getInspectionByShareToken,
  getInspectionMedia,
  getInspectionRecommendations
} from '../helpers/inspection-api.js';

// =============================================
// INSPECTION VIEWER CLASS
// =============================================

export class InspectionViewer {
  constructor() {
    this.modalElement = null;
    this.inspection = null;
    this.media = [];
    this.recommendations = [];
    this.onCloseCallback = null;
    this.isCustomerView = false;
  }

  // =============================================
  // OPEN VIEWER
  // =============================================

  /**
   * Open the inspection viewer
   * @param {object} options
   * @param {string} options.inspectionId - ID to load
   * @param {string} options.shareToken - Or share token for customer view
   * @param {boolean} options.customerView - If true, shows customer-friendly version
   * @param {function} options.onClose - Callback when modal closes
   */
  async open(options = {}) {
    this.isCustomerView = options.customerView || !!options.shareToken;
    this.onCloseCallback = options.onClose;

    this.showLoading();

    // Load inspection
    if (options.shareToken) {
      this.inspection = await getInspectionByShareToken(options.shareToken);
    } else if (options.inspectionId) {
      this.inspection = await getInspectionById(options.inspectionId);
    }

    if (!this.inspection) {
      this.hideLoading();
      alert('Inspection not found');
      return;
    }

    // Load media and recommendations
    this.media = await getInspectionMedia(this.inspection.id);
    this.recommendations = await getInspectionRecommendations(this.inspection.id);

    this.hideLoading();
    this.render();
    this.attachEventListeners();
  }

  // =============================================
  // RENDER
  // =============================================

  render() {
    this.modalElement?.remove();

    const grade = this.inspection.grade || 'C';
    const gradeInfo = getGradeInfo(grade);

    const html = `
      <div class="modal-backdrop inspection-viewer-backdrop" id="inspectionViewerModal">
        <div class="modal-card inspection-viewer-modal">
          <!-- Header -->
          <div class="viewer-header">
            <div class="viewer-header-content">
              <button class="viewer-close-btn" id="closeViewerBtn">&times;</button>
              <div class="viewer-title">${this.isCustomerView ? 'Your Vehicle Inspection Report' : 'Inspection Report'}</div>
            </div>
          </div>

          <!-- Body -->
          <div class="viewer-body">
            <!-- Grade Card -->
            <div class="viewer-grade-card" style="background: linear-gradient(135deg, ${gradeInfo.bgColor}, white);">
              <div class="grade-main">
                <div class="grade-circle" style="background: ${gradeInfo.color}">
                  ${grade}
                </div>
                <div class="grade-text">
                  <div class="grade-label">${gradeInfo.label}</div>
                  <div class="grade-description">${gradeInfo.description}</div>
                </div>
              </div>
              ${this.inspection.unsafe_to_drive ? `
                <div class="unsafe-warning">
                  ⚠️ <strong>Safety Alert:</strong> This vehicle has been flagged as unsafe to drive.
                </div>
              ` : ''}
            </div>

            <!-- Health Meter -->
            <div class="viewer-health-meter">
              <div class="health-title">Vehicle Health</div>
              <div class="health-bars">
                <div class="health-bar">
                  <div class="health-bar-label">
                    <span class="status-dot pass"></span>
                    Passed
                  </div>
                  <div class="health-bar-track">
                    <div class="health-bar-fill pass" style="width: ${this.getPercentage('pass')}%"></div>
                  </div>
                  <span class="health-bar-count">${this.inspection.pass_count || 0}</span>
                </div>
                <div class="health-bar">
                  <div class="health-bar-label">
                    <span class="status-dot attention"></span>
                    Needs Attention
                  </div>
                  <div class="health-bar-track">
                    <div class="health-bar-fill attention" style="width: ${this.getPercentage('attention')}%"></div>
                  </div>
                  <span class="health-bar-count">${this.inspection.attention_count || 0}</span>
                </div>
                <div class="health-bar">
                  <div class="health-bar-label">
                    <span class="status-dot fail"></span>
                    Failed
                  </div>
                  <div class="health-bar-track">
                    <div class="health-bar-fill fail" style="width: ${this.getPercentage('fail')}%"></div>
                  </div>
                  <span class="health-bar-count">${this.inspection.fail_count || 0}</span>
                </div>
              </div>
            </div>

            ${this.isCustomerView ? this.renderCustomerView() : this.renderFullView()}
          </div>

          <!-- Footer -->
          <div class="viewer-footer">
            <div class="viewer-meta">
              Inspected by ${this.inspection.inspector_name || 'Staff'} 
              on ${new Date(this.inspection.created_at).toLocaleDateString()}
            </div>
            ${!this.isCustomerView ? `
              <button class="btn-primary" id="editInspectionBtn">Edit Inspection</button>
            ` : ''}
          </div>
        </div>
      </div>
    `;

    document.body.insertAdjacentHTML('beforeend', html);
    this.modalElement = document.getElementById('inspectionViewerModal');
    this.injectStyles();
  }

  renderCustomerView() {
    // Customer view: Show only items needing attention with recommendations
    const attentionItems = this.getItemsByStatus(['attention', 'fail']);
    
    if (attentionItems.length === 0) {
      return `
        <div class="viewer-section">
          <div class="all-good-message">
            ✅ Great news! Your vehicle passed all inspection points.
          </div>
        </div>
      `;
    }

    return `
      <div class="viewer-section">
        <div class="section-title">Items Needing Attention</div>
        <div class="attention-items-list">
          ${attentionItems.map(item => this.renderCustomerItem(item)).join('')}
        </div>
      </div>

      ${this.recommendations.length > 0 ? `
        <div class="viewer-section">
          <div class="section-title">Recommended Services</div>
          <div class="recommendations-list">
            ${this.recommendations.map(rec => this.renderRecommendation(rec)).join('')}
          </div>
        </div>
      ` : ''}
    `;
  }

  renderCustomerItem(item) {
    const statusInfo = getStatusInfo(item.status);
    const itemMedia = this.media.filter(m => 
      m.section_index === item.sectionIndex && m.item_index === item.itemIndex
    );

    return `
      <div class="attention-item ${item.status}">
        <div class="attention-item-header">
          <span class="status-badge" style="background: ${statusInfo.bgColor}; color: ${statusInfo.color}">
            ${statusInfo.icon} ${statusInfo.label}
          </span>
          ${item.priority === 'high' ? '<span class="priority-badge">High Priority</span>' : ''}
        </div>
        <div class="attention-item-name">${item.sectionName} - ${item.name}</div>
        ${item.notes ? `<div class="attention-item-notes">${item.notes}</div>` : ''}
        ${itemMedia.length > 0 ? `
          <div class="attention-item-photos">
            ${itemMedia.map(m => `
              <img src="${m.media_url}" alt="Inspection photo" class="attention-photo" data-url="${m.media_url}" />
            `).join('')}
          </div>
        ` : ''}
      </div>
    `;
  }

  renderRecommendation(rec) {
    return `
      <div class="recommendation-card">
        <div class="recommendation-name">${rec.service_name}</div>
        ${rec.description ? `<div class="recommendation-desc">${rec.description}</div>` : ''}
        <div class="recommendation-price">$${rec.total_price?.toFixed(2) || '0.00'}</div>
        <div class="recommendation-actions">
          <button class="btn-approve" data-rec-id="${rec.id}">✓ Approve</button>
          <button class="btn-decline" data-rec-id="${rec.id}">✗ Decline</button>
        </div>
      </div>
    `;
  }

  renderFullView() {
    // Full staff view: Show all sections and items
    const sections = this.inspection.sections || [];

    return sections.map(section => `
      <div class="viewer-section">
        <div class="section-title">
          ${section.icon || ''} ${section.name}
        </div>
        <div class="section-items">
          ${(section.items || []).map((item, itemIndex) => 
            this.renderFullItem(item, section.sectionIndex, itemIndex, section.name)
          ).join('')}
        </div>
      </div>
    `).join('');
  }

  renderFullItem(item, sectionIndex, itemIndex, sectionName) {
    const statusInfo = getStatusInfo(item.status);
    const itemMedia = this.media.filter(m => 
      m.section_index === sectionIndex && m.item_index === itemIndex
    );

    return `
      <div class="full-item ${item.status}">
        <div class="full-item-row">
          <span class="full-item-name">${item.name}</span>
          <span class="full-item-status" style="background: ${statusInfo.bgColor}; color: ${statusInfo.color}">
            ${statusInfo.icon}
          </span>
        </div>
        ${item.status !== 'pass' && item.status !== 'n/a' ? `
          <div class="full-item-details">
            ${item.priority ? `<span class="priority-tag ${item.priority}">${item.priority} priority</span>` : ''}
            ${item.notes ? `<span class="item-note">${item.notes}</span>` : ''}
          </div>
        ` : ''}
        ${itemMedia.length > 0 ? `
          <div class="full-item-photos">
            ${itemMedia.map(m => `
              <img src="${m.media_url}" alt="Photo" class="item-photo-thumb" data-url="${m.media_url}" />
            `).join('')}
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

    // Close button
    document.getElementById('closeViewerBtn')?.addEventListener('click', () => {
      this.close();
    });

    // Edit button (for staff)
    document.getElementById('editInspectionBtn')?.addEventListener('click', () => {
      this.openEditor();
    });

    // Photo click to enlarge
    this.modalElement.querySelectorAll('.attention-photo, .item-photo-thumb').forEach(img => {
      img.addEventListener('click', () => {
        this.showFullImage(img.dataset.url);
      });
    });

    // Backdrop click
    this.modalElement.addEventListener('click', (e) => {
      if (e.target.classList.contains('inspection-viewer-backdrop')) {
        this.close();
      }
    });

    // Recommendation buttons
    this.modalElement.querySelectorAll('.btn-approve, .btn-decline').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const recId = e.currentTarget.dataset.recId;
        const isApprove = e.currentTarget.classList.contains('btn-approve');
        this.handleRecommendationAction(recId, isApprove);
      });
    });

    // Escape key
    document.addEventListener('keydown', this.handleKeydown.bind(this));
  }

  handleKeydown(e) {
    if (e.key === 'Escape') {
      this.close();
    }
  }

  // =============================================
  // ACTIONS
  // =============================================

  showFullImage(url) {
    const overlay = document.createElement('div');
    overlay.className = 'image-overlay';
    overlay.innerHTML = `
      <div class="image-overlay-content">
        <button class="image-close-btn">&times;</button>
        <img src="${url}" alt="Full size photo" />
      </div>
    `;
    
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay || e.target.classList.contains('image-close-btn')) {
        overlay.remove();
      }
    });

    document.body.appendChild(overlay);
  }

  async handleRecommendationAction(recId, isApprove) {
    // This would integrate with the recommendations API
    console.log(`Recommendation ${recId}: ${isApprove ? 'approved' : 'declined'}`);
    // TODO: Call updateRecommendationStatus
  }

  openEditor() {
    this.close();
    // Open the editor modal
    if (window.inspectionForm) {
      window.inspectionForm.open({
        inspectionId: this.inspection.id,
        onClose: () => {
          // Optionally refresh the viewer
        }
      });
    }
  }

  close() {
    document.removeEventListener('keydown', this.handleKeydown);
    this.modalElement?.remove();
    this.modalElement = null;

    if (this.onCloseCallback) {
      this.onCloseCallback();
    }
  }

  // =============================================
  // HELPERS
  // =============================================

  getPercentage(status) {
    const total = (this.inspection.pass_count || 0) + 
                  (this.inspection.attention_count || 0) + 
                  (this.inspection.fail_count || 0);
    if (total === 0) return 0;

    const count = status === 'pass' ? this.inspection.pass_count :
                  status === 'attention' ? this.inspection.attention_count :
                  this.inspection.fail_count;

    return Math.round((count / total) * 100);
  }

  getItemsByStatus(statuses) {
    const items = [];
    const sections = this.inspection.sections || [];

    sections.forEach(section => {
      (section.items || []).forEach((item, itemIndex) => {
        if (statuses.includes(item.status)) {
          items.push({
            ...item,
            sectionIndex: section.sectionIndex,
            sectionName: section.name,
            itemIndex
          });
        }
      });
    });

    // Sort by priority (high first)
    return items.sort((a, b) => {
      const priorityOrder = { high: 0, medium: 1, low: 2, null: 3 };
      return (priorityOrder[a.priority] || 3) - (priorityOrder[b.priority] || 3);
    });
  }

  showLoading() {
    const html = `
      <div class="inspection-loading-overlay" id="viewerLoadingOverlay">
        <div class="loading-spinner"></div>
        <div class="loading-message">Loading inspection...</div>
      </div>
    `;
    document.body.insertAdjacentHTML('beforeend', html);
  }

  hideLoading() {
    document.getElementById('viewerLoadingOverlay')?.remove();
  }

  // =============================================
  // STYLES
  // =============================================

  injectStyles() {
    if (document.getElementById('inspectionViewerStyles')) return;

    const styles = `
      <style id="inspectionViewerStyles">
        .inspection-viewer-backdrop {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0, 0, 0, 0.6);
          z-index: 9999;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .inspection-viewer-modal {
          background: white;
          border-radius: 12px;
          width: 100%;
          max-width: 600px;
          max-height: 95vh;
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }

        @media (max-width: 640px) {
          .inspection-viewer-modal {
            max-width: 100%;
            height: 100%;
            max-height: 100%;
            border-radius: 0;
          }
        }

        .viewer-header {
          background: #1f2937;
          color: white;
          padding: 16px;
        }

        .viewer-header-content {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .viewer-close-btn {
          background: none;
          border: none;
          color: white;
          font-size: 24px;
          cursor: pointer;
          padding: 4px 8px;
          line-height: 1;
        }

        .viewer-title {
          font-size: 18px;
          font-weight: 600;
        }

        .viewer-body {
          flex: 1;
          overflow-y: auto;
          padding: 16px;
        }

        /* Grade Card */
        .viewer-grade-card {
          border-radius: 12px;
          padding: 20px;
          margin-bottom: 16px;
        }

        .grade-main {
          display: flex;
          align-items: center;
          gap: 16px;
        }

        .grade-circle {
          width: 64px;
          height: 64px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 32px;
          font-weight: 700;
          color: white;
        }

        .grade-text {
          flex: 1;
        }

        .grade-label {
          font-size: 20px;
          font-weight: 600;
          color: #1f2937;
        }

        .grade-description {
          color: #6b7280;
          font-size: 14px;
        }

        .unsafe-warning {
          margin-top: 16px;
          padding: 12px;
          background: #fee2e2;
          border-radius: 8px;
          color: #991b1b;
          font-size: 14px;
        }

        /* Health Meter */
        .viewer-health-meter {
          background: #f9fafb;
          border-radius: 12px;
          padding: 16px;
          margin-bottom: 16px;
        }

        .health-title {
          font-weight: 600;
          margin-bottom: 12px;
          color: #1f2937;
        }

        .health-bars {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .health-bar {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .health-bar-label {
          width: 120px;
          font-size: 13px;
          color: #6b7280;
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .status-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
        }

        .status-dot.pass { background: #10b981; }
        .status-dot.attention { background: #f59e0b; }
        .status-dot.fail { background: #ef4444; }

        .health-bar-track {
          flex: 1;
          height: 8px;
          background: #e5e7eb;
          border-radius: 4px;
          overflow: hidden;
        }

        .health-bar-fill {
          height: 100%;
          border-radius: 4px;
          transition: width 0.5s ease;
        }

        .health-bar-fill.pass { background: #10b981; }
        .health-bar-fill.attention { background: #f59e0b; }
        .health-bar-fill.fail { background: #ef4444; }

        .health-bar-count {
          width: 30px;
          text-align: right;
          font-size: 14px;
          font-weight: 600;
          color: #374151;
        }

        /* Sections */
        .viewer-section {
          margin-bottom: 20px;
        }

        .section-title {
          font-size: 16px;
          font-weight: 600;
          color: #1f2937;
          margin-bottom: 12px;
          padding-bottom: 8px;
          border-bottom: 1px solid #e5e7eb;
        }

        .all-good-message {
          text-align: center;
          padding: 40px 20px;
          background: #dcfce7;
          border-radius: 12px;
          color: #166534;
          font-size: 18px;
        }

        /* Attention Items (Customer View) */
        .attention-items-list {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .attention-item {
          background: white;
          border: 1px solid #e5e7eb;
          border-radius: 8px;
          padding: 12px;
        }

        .attention-item.attention {
          border-left: 3px solid #f59e0b;
          background: #fffbeb;
        }

        .attention-item.fail {
          border-left: 3px solid #ef4444;
          background: #fef2f2;
        }

        .attention-item-header {
          display: flex;
          gap: 8px;
          margin-bottom: 8px;
        }

        .status-badge {
          padding: 4px 8px;
          border-radius: 4px;
          font-size: 12px;
          font-weight: 600;
        }

        .priority-badge {
          padding: 4px 8px;
          border-radius: 4px;
          font-size: 12px;
          font-weight: 600;
          background: #fee2e2;
          color: #991b1b;
        }

        .attention-item-name {
          font-weight: 500;
          color: #1f2937;
        }

        .attention-item-notes {
          margin-top: 4px;
          font-size: 14px;
          color: #6b7280;
        }

        .attention-item-photos {
          display: flex;
          gap: 8px;
          margin-top: 8px;
          overflow-x: auto;
        }

        .attention-photo {
          width: 80px;
          height: 80px;
          object-fit: cover;
          border-radius: 8px;
          cursor: pointer;
          flex-shrink: 0;
        }

        /* Recommendations */
        .recommendations-list {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .recommendation-card {
          background: white;
          border: 1px solid #e5e7eb;
          border-radius: 8px;
          padding: 12px;
        }

        .recommendation-name {
          font-weight: 600;
          color: #1f2937;
        }

        .recommendation-desc {
          font-size: 14px;
          color: #6b7280;
          margin-top: 4px;
        }

        .recommendation-price {
          font-size: 18px;
          font-weight: 600;
          color: #10b981;
          margin: 8px 0;
        }

        .recommendation-actions {
          display: flex;
          gap: 8px;
        }

        .btn-approve {
          flex: 1;
          padding: 8px;
          background: #10b981;
          color: white;
          border: none;
          border-radius: 6px;
          cursor: pointer;
          font-weight: 500;
        }

        .btn-decline {
          flex: 1;
          padding: 8px;
          background: #f3f4f6;
          color: #6b7280;
          border: none;
          border-radius: 6px;
          cursor: pointer;
          font-weight: 500;
        }

        /* Full View Items */
        .section-items {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .full-item {
          padding: 8px 12px;
          border-radius: 6px;
          background: white;
        }

        .full-item.pass { background: #f0fdf4; }
        .full-item.attention { background: #fffbeb; }
        .full-item.fail { background: #fef2f2; }

        .full-item-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        .full-item-name {
          font-size: 14px;
          color: #1f2937;
        }

        .full-item-status {
          padding: 2px 8px;
          border-radius: 4px;
          font-size: 12px;
          font-weight: 600;
        }

        .full-item-details {
          margin-top: 4px;
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          align-items: center;
        }

        .priority-tag {
          font-size: 11px;
          padding: 2px 6px;
          border-radius: 4px;
          text-transform: uppercase;
        }

        .priority-tag.low { background: #f3f4f6; color: #6b7280; }
        .priority-tag.medium { background: #fef3c7; color: #92400e; }
        .priority-tag.high { background: #fee2e2; color: #991b1b; }

        .item-note {
          font-size: 13px;
          color: #6b7280;
          font-style: italic;
        }

        .full-item-photos {
          display: flex;
          gap: 6px;
          margin-top: 6px;
        }

        .item-photo-thumb {
          width: 48px;
          height: 48px;
          object-fit: cover;
          border-radius: 4px;
          cursor: pointer;
        }

        /* Footer */
        .viewer-footer {
          background: #f9fafb;
          border-top: 1px solid #e5e7eb;
          padding: 12px 16px;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        .viewer-meta {
          font-size: 13px;
          color: #6b7280;
        }

        /* Image Overlay */
        .image-overlay {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0, 0, 0, 0.9);
          z-index: 10001;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .image-overlay-content {
          position: relative;
          max-width: 95%;
          max-height: 95%;
        }

        .image-overlay-content img {
          max-width: 100%;
          max-height: 90vh;
          border-radius: 8px;
        }

        .image-close-btn {
          position: absolute;
          top: -40px;
          right: 0;
          background: none;
          border: none;
          color: white;
          font-size: 32px;
          cursor: pointer;
        }
      </style>
    `;

    document.head.insertAdjacentHTML('beforeend', styles);
  }
}

// Create singleton instance
export const inspectionViewer = new InspectionViewer();

// Global access
if (typeof window !== 'undefined') {
  window.InspectionViewer = InspectionViewer;
  window.inspectionViewer = inspectionViewer;
}
