/**
 * Appointment Tracking Helper
 * 
 * Handles sending tracking links to customers via SMS/Email
 * Mirrors the invoice sending functionality
 */

const appointmentTracker = {
  /**
   * Send tracking link to customer
   * @param {Object} params
   * @param {string} params.appointmentId - The appointment ID
   * @param {string} params.shopId - The shop ID
   * @param {boolean} params.sendEmail - Whether to send email
   * @param {boolean} params.sendSms - Whether to send SMS
   * @param {string} params.customerEmail - Customer email (required if sendEmail)
   * @param {string} params.customerPhone - Customer phone (required if sendSms)
   * @param {string} params.customerName - Customer name for personalization
   * @returns {Promise<Object>} Result object with success status and details
   */
  async sendTrackingLink({
    appointmentId,
    shopId,
    sendEmail = false,
    sendSms = false,
    customerEmail = null,
    customerPhone = null,
    customerName = 'Customer',
    trackingCode = null  // The appointment's existing tracking code
  }) {
    try {
      console.log('[AppointmentTracker] Sending tracking link...', {
        appointmentId,
        shopId,
        sendEmail,
        sendSms
      });

      // For local development: Check if API endpoint exists
      // Set SKIP_DEV_MOCK=true in localStorage to test real API calls in development
      const isDevelopment = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
      const skipMock = localStorage.getItem('SKIP_DEV_MOCK') === 'true';
      
      if (isDevelopment && !skipMock) {
        console.warn('[AppointmentTracker] Running in development mode - API call will be simulated');
        
        // In development, we need a tracking code to simulate properly
        if (!trackingCode) {
          console.warn('[AppointmentTracker] ⚠️ No tracking code provided - appointment may not have a token yet.');
          console.warn('[AppointmentTracker] In production, the token would be created/fetched from the database.');
        }
        
        // Use the appointment's actual tracking code (passed in), or a placeholder
        const mockToken = 'dev_' + Math.random().toString(36).substring(2, 15);
        const actualCode = trackingCode || 'NO-CODE';
        const mockTrackingUrl = `${window.location.origin}/public-tracking.html?token=${mockToken}`;
        const mockMobileTrackingUrl = `${window.location.origin}/public-tracking-mobile.html?token=${mockToken}`;
        
        console.log('🎫 Appointment tracking code:', actualCode);
        console.log('📱 Mobile tracker URL:', mockMobileTrackingUrl);
        console.log('🖥️ Kiosk URL:', `${window.location.origin}/public-tracking-kiosk.html`);
        console.log('✅ In production: Customer receives SMS with link, can also use code on kiosk');
        console.log('');
        console.log('💡 TIP: To test the tracker, use the KIOSK page and enter the code:', actualCode);
        console.log('   ➜', `${window.location.origin}/public-tracking-kiosk.html`);
        
        return {
          success: true,
          trackingUrl: mockTrackingUrl,
          mobileTrackingUrl: mockMobileTrackingUrl,
          token: mockToken,
          shortCode: actualCode,  // Use the appointment's actual tracking code
          kioskUrl: `${window.location.origin}/public-tracking-kiosk.html`,
          results: {
            email: sendEmail ? { success: true, id: 'dev_email_' + Date.now() } : null,
            sms: sendSms ? { success: true, sid: 'dev_sms_' + Date.now() } : null
          },
          development: true
        };
      }

      const response = await fetch('/api/send-tracking', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          appointmentId,
          shopId,
          sendEmail,
          sendSms,
          customerEmail,
          customerPhone,
          customerName,
          trackingCode  // Pass the appointment's tracking code to API
        })
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to send tracking link');
      }

      console.log('[AppointmentTracker] Tracking link sent successfully:', result);
      return {
        success: true,
        trackingUrl: result.trackingUrl,
        mobileTrackingUrl: result.mobileTrackingUrl,
        token: result.token,
        shortCode: result.shortCode,
        results: result.results
      };

    } catch (error) {
      console.error('[AppointmentTracker] Error sending tracking link:', error);
      return {
        success: false,
        error: error.message
      };
    }
  },

  /**
   * Auto-send tracking link when appointment is created/updated
   * @param {Object} appointment - The appointment object
   * @param {Object} customer - The customer object
   * @param {string} shopId - The shop ID
   * @param {Object} options - Send options
   */
  async autoSendOnCreate(appointment, customer, shopId, options = {}) {
    const {
      sendEmail = true,
      sendSms = true
    } = options;

    // Get customer contact info
    const customerEmail = customer?.email || null;
    const customerPhone = customer?.phone || null;
    const customerName = customer ? `${customer.first_name || ''} ${customer.last_name || ''}`.trim() : 'Customer';

    // Only send if we have at least one contact method
    if (!customerEmail && !customerPhone) {
      console.warn('[AppointmentTracker] No customer contact info available');
      return { success: false, error: 'No customer contact information' };
    }

    return await this.sendTrackingLink({
      appointmentId: appointment.id,
      shopId,
      sendEmail: sendEmail && !!customerEmail,
      sendSms: sendSms && !!customerPhone,
      customerEmail,
      customerPhone,
      customerName
    });
  },

  /**
   * Get tracking URL for an appointment (without sending)
   * Useful for displaying in the UI or copying to clipboard
   * @param {string} token - The tracking token
   * @returns {string} Full tracking URL
   */
  getTrackingUrl(token) {
    const baseUrl = window.location.origin;
    return `${baseUrl}/public-tracking.html?token=${token}`;
  },

  /**
   * Show success message with tracking link options
   * @param {Object} result - Result from sendTrackingLink
   */
  showSuccessMessage(result) {
    const messages = [];
    
    if (result.results?.email?.success) {
      messages.push('✅ Email sent');
    }
    if (result.results?.sms?.success) {
      messages.push('✅ SMS sent');
    }
    
    if (messages.length === 0) {
      return 'Tracking link created';
    }
    
    return messages.join(' | ');
  },

  /**
   * Format error message
   * @param {Object} result - Result from sendTrackingLink
   */
  getErrorMessage(result) {
    const errors = [];
    
    if (result.results?.email && !result.results.email.success) {
      errors.push(`Email: ${result.results.email.error}`);
    }
    if (result.results?.sms && !result.results.sms.success) {
      errors.push(`SMS: ${result.results.sms.error}`);
    }
    
    return errors.join(' | ') || result.error || 'Failed to send tracking link';
  }
};

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = appointmentTracker;
}

// Also expose to window for browser use
if (typeof window !== 'undefined') {
  window.appointmentTracker = appointmentTracker;
}
