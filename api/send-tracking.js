/**
 * API: Send Tracking Link via SMS and/or Email
 * 
 * Endpoint: POST /api/send-tracking
 * 
 * This endpoint:
 * 1. Validates the appointment exists and belongs to the shop
 * 2. Gets customer contact info (email/phone)
 * 3. Generates a secure token for public tracking
 * 4. Sends email via Resend API
 * 5. Sends SMS via Twilio (with link to mobile tracker)
 */

const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

module.exports = async function handler(req, res) {
  console.log('[SendTracking] API called');
  
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { 
      appointmentId, 
      shopId, 
      sendEmail, 
      sendSms, 
      customerEmail, 
      customerPhone,
      customerName,
      trackingCode  // The appointment's existing tracking code (from frontend)
    } = req.body;

    // Validate required fields
    if (!appointmentId || !shopId) {
      return res.status(400).json({ error: 'appointmentId and shopId are required' });
    }

    if (!sendEmail && !sendSms) {
      return res.status(400).json({ error: 'At least one of sendEmail or sendSms must be true' });
    }

    if (sendEmail && !customerEmail) {
      return res.status(400).json({ error: 'customerEmail is required when sendEmail is true' });
    }

    if (sendSms && !customerPhone) {
      return res.status(400).json({ error: 'customerPhone is required when sendSms is true' });
    }

    // Initialize Supabase
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    
    if (!supabaseUrl || !supabaseKey) {
      console.error('Missing Supabase credentials');
      return res.status(500).json({ error: 'Server configuration error' });
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Fetch appointment from data table
    const { data: shopData, error: dataError } = await supabase
      .from('data')
      .select('appointments, customers')
      .eq('shop_id', shopId)
      .single();

    if (dataError || !shopData) {
      console.error('Failed to fetch shop data:', dataError);
      return res.status(404).json({ error: 'Shop data not found' });
    }

    const appointment = (shopData.appointments || []).find(apt => apt.id === appointmentId);

    if (!appointment) {
      return res.status(404).json({ error: 'Appointment not found' });
    }

    console.log('[SendTracking] Appointment loaded:', {
      id: appointment.id,
      status: appointment.status,
      vehicle: appointment.vehicle
    });

    // Get shop info
    const { data: shop, error: shopError } = await supabase
      .from('shops')
      .select('name, phone, email, logo')
      .eq('id', shopId)
      .single();

    if (shopError) {
      console.warn('Could not fetch shop info:', shopError);
    }

    const shopName = shop?.name || 'Business';

    // Get vehicle info for better messaging
    const customer = shopData.customers?.find(c => c.id === appointment.customer_id);
    const vehicleInfo = customer?.vehicles?.find(v => v.id === appointment.vehicle_id);
    const vehicleDisplay = vehicleInfo 
      ? `${vehicleInfo.year || ''} ${vehicleInfo.make || ''} ${vehicleInfo.model || ''}`.trim()
      : appointment.vehicle || 'your vehicle';

    // Check for existing valid token first
    let token;
    let shortCode;
    let isExistingToken = false;
    
    // Use the appointment's tracking code if provided
    const appointmentTrackingCode = trackingCode || null;
    
    const { data: existingTokens, error: fetchTokenError } = await supabase
      .from('appointment_tokens')
      .select('token, short_code, expires_at')
      .eq('appointment_id', appointmentId)
      .eq('shop_id', shopId)
      .gte('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(1);

    if (fetchTokenError) {
      console.warn('Error checking for existing token:', fetchTokenError);
    }

    if (existingTokens && existingTokens.length > 0) {
      // Reuse existing token
      token = existingTokens[0].token;
      shortCode = existingTokens[0].short_code;
      isExistingToken = true;
      console.log('[SendTracking] Reusing existing token for appointment:', appointmentId);
      
      // Update sent_via and recipient info on existing token
      const sentVia = [];
      if (sendEmail) sentVia.push('email');
      if (sendSms) sentVia.push('sms');
      
      // Also update short_code if we have the appointment's tracking code and it differs
      const updatePayload = {
        sent_via: sentVia,
        recipient_email: customerEmail || null,
        recipient_phone: customerPhone || null
      };
      
      // If the appointment has a tracking code and it's different from the stored short_code, update it
      if (appointmentTrackingCode && appointmentTrackingCode !== shortCode) {
        updatePayload.short_code = appointmentTrackingCode;
        shortCode = appointmentTrackingCode;
        console.log('[SendTracking] Updating short_code to match appointment tracking code:', appointmentTrackingCode);
      }
      
      await supabase
        .from('appointment_tokens')
        .update(updatePayload)
        .eq('token', token);
    } else {
      // Generate new secure token
      token = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 30); // 30 days expiry

      // Store token in database
      const sentVia = [];
      if (sendEmail) sentVia.push('email');
      if (sendSms) sentVia.push('sms');

      // Use the appointment's tracking code as the short_code if provided
      const insertPayload = {
        token,
        appointment_id: appointmentId,
        shop_id: shopId,
        expires_at: expiresAt.toISOString(),
        sent_via: sentVia,
        recipient_email: customerEmail || null,
        recipient_phone: customerPhone || null
      };
      
      // If we have the appointment's tracking code, use it as the short_code
      if (appointmentTrackingCode) {
        insertPayload.short_code = appointmentTrackingCode;
        console.log('[SendTracking] Using appointment tracking code as short_code:', appointmentTrackingCode);
      }

      const { data: newTokenData, error: tokenError } = await supabase
        .from('appointment_tokens')
        .insert(insertPayload)
        .select('short_code')
        .single();

      if (tokenError) {
        console.error('Failed to create token:', tokenError);
        return res.status(500).json({ error: 'Failed to create tracking link' });
      }
      
      shortCode = newTokenData?.short_code || appointmentTrackingCode;
      console.log('[SendTracking] Created new token for appointment:', appointmentId, 'with short_code:', shortCode);
    }

    // Build tracking URLs
    const baseUrl = process.env.APP_BASE_URL || 'https://xpose.management';
    // Email uses the regular tracker page
    const trackingUrl = `${baseUrl}/public-tracking.html?token=${token}`;
    // SMS uses the mobile-optimized tracker page (no code entry needed)
    const mobileTrackingUrl = `${baseUrl}/public-tracking-mobile.html?token=${token}`;

    const results = { email: null, sms: null };

    // Send Email via Resend
    if (sendEmail && customerEmail) {
      const resendKey = process.env.RESEND_API_KEY;
      
      if (resendKey) {
        try {
          const emailHtml = buildTrackingEmailHtml({
            shopName,
            customerName: customerName || 'Customer',
            vehicleDisplay,
            scheduledDate: appointment.date,
            trackingUrl,
            shopLogo: shop?.logo,
            status: appointment.status || 'scheduled'
          });
          
          const emailSubject = `Track Your ${vehicleDisplay} - ${shopName}`;

          const emailResponse = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${resendKey}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              from: `${shopName} <service@xpose.management>`,
              to: [customerEmail],
              subject: emailSubject,
              html: emailHtml
            })
          });

          const emailResult = await emailResponse.json();
          
          if (emailResponse.ok) {
            results.email = { success: true, id: emailResult.id };
            console.log('✅ Tracking email sent:', emailResult.id);
          } else {
            results.email = { success: false, error: emailResult.message || 'Email failed' };
            console.error('❌ Email send failed:', emailResult);
          }
        } catch (emailErr) {
          results.email = { success: false, error: emailErr.message };
          console.error('❌ Email error:', emailErr);
        }
      } else {
        results.email = { success: false, error: 'Email service not configured' };
        console.warn('⚠️ RESEND_API_KEY not set');
      }
    }

    // Send SMS via Twilio - uses mobile tracking URL
    if (sendSms && customerPhone) {
      const twilioSid = process.env.TWILIO_ACCOUNT_SID;
      const twilioAuth = process.env.TWILIO_AUTH_TOKEN;
      
      if (twilioSid && twilioAuth) {
        try {
          // Get the shop's Twilio number
          const { data: twilioNumber } = await supabase
            .from('shop_twilio_numbers')
            .select('phone_number')
            .eq('shop_id', shopId)
            .single();

          if (twilioNumber?.phone_number) {
            const scheduledDate = appointment.preferred_date 
              ? new Date(appointment.preferred_date).toLocaleDateString()
              : 'soon';

            // Use the mobile tracking URL for SMS (token-based, no code entry)
            const smsBody = `${shopName}: Track your ${vehicleDisplay} status here: ${mobileTrackingUrl}`;

            // Format phone number to E.164
            let toPhone = customerPhone.replace(/\D/g, '');
            if (toPhone.length === 10) toPhone = '1' + toPhone;
            if (!toPhone.startsWith('+')) toPhone = '+' + toPhone;

            const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Messages.json`;
            const auth = Buffer.from(`${twilioSid}:${twilioAuth}`).toString('base64');

            const smsResponse = await fetch(twilioUrl, {
              method: 'POST',
              headers: {
                'Authorization': `Basic ${auth}`,
                'Content-Type': 'application/x-www-form-urlencoded'
              },
              body: new URLSearchParams({
                To: toPhone,
                From: twilioNumber.phone_number,
                Body: smsBody
              })
            });

            const smsResult = await smsResponse.json();

            if (smsResponse.ok) {
              results.sms = { success: true, sid: smsResult.sid };
              console.log('✅ Tracking SMS sent:', smsResult.sid);
            } else {
              results.sms = { success: false, error: smsResult.message || 'SMS failed' };
              console.error('❌ SMS send failed:', smsResult);
            }
          } else {
            results.sms = { success: false, error: 'No Twilio number configured for this shop' };
            console.warn('⚠️ No Twilio number for shop:', shopId);
          }
        } catch (smsErr) {
          results.sms = { success: false, error: smsErr.message };
          console.error('❌ SMS error:', smsErr);
        }
      } else {
        results.sms = { success: false, error: 'SMS service not configured' };
        console.warn('⚠️ Twilio credentials not set');
      }
    }

    // Return results
    const success = (sendEmail ? results.email?.success : true) && (sendSms ? results.sms?.success : true);
    
    return res.status(success ? 200 : 207).json({
      success,
      trackingUrl,
      mobileTrackingUrl,
      token,
      shortCode,
      isExistingToken,
      results
    });

  } catch (error) {
    console.error('❌ Send tracking error:', error);
    return res.status(500).json({ error: 'Internal server error', details: error.message });
  }
};

/**
 * Build HTML email content for tracking link
 */
function buildTrackingEmailHtml({ shopName, customerName, vehicleDisplay, scheduledDate, trackingUrl, shopLogo, status }) {
  const logoHtml = shopLogo 
    ? `<img src="${shopLogo}" alt="${shopName}" style="max-height: 60px; margin-bottom: 20px;">`
    : '';

  const formattedDate = scheduledDate 
    ? new Date(scheduledDate).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
    : 'soon';

  const statusText = status === 'in-progress' 
    ? 'is currently being serviced'
    : status === 'completed'
    ? 'service has been completed'
    : `is scheduled for ${formattedDate}`;

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Track Your Vehicle - ${shopName}</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f5f5f5;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f5f5f5; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
          <!-- Header -->
          <tr>
            <td style="padding: 30px; text-align: center; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);">
              ${logoHtml}
              <h1 style="margin: 0; color: #ffffff; font-size: 24px;">${shopName}</h1>
            </td>
          </tr>
          
          <!-- Content -->
          <tr>
            <td style="padding: 40px 30px;">
              <p style="margin: 0 0 20px; font-size: 16px; color: #333;">
                Hi ${customerName},
              </p>
              <p style="margin: 0 0 30px; font-size: 16px; color: #333;">
                Your ${vehicleDisplay} ${statusText}. You can track the status of your vehicle in real-time using the link below.
              </p>
              
              <!-- Vehicle Info Box -->
              <table width="100%" cellpadding="0" cellspacing="0" style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 8px; margin-bottom: 30px;">
                <tr>
                  <td style="padding: 25px; color: white;">
                    <div style="font-size: 14px; opacity: 0.9; margin-bottom: 8px;">Your Vehicle</div>
                    <div style="font-size: 20px; font-weight: 700; margin-bottom: 12px;">${vehicleDisplay}</div>
                    <div style="font-size: 14px; opacity: 0.9;">Status: ${status.replace('-', ' ').toUpperCase()}</div>
                  </td>
                </tr>
              </table>
              
              <!-- CTA Button -->
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center">
                    <a href="${trackingUrl}" style="display: inline-block; padding: 16px 40px; background-color: #1e40af; color: #ffffff; text-decoration: none; border-radius: 8px; font-size: 16px; font-weight: 600;">
                      Track Your Vehicle
                    </a>
                  </td>
                </tr>
              </table>
              
              <p style="margin: 30px 0 0; font-size: 14px; color: #666; text-align: center;">
                This link will expire in 30 days.
              </p>
            </td>
          </tr>
          
          <!-- Footer -->
          <tr>
            <td style="padding: 20px 30px; background-color: #f8fafc; border-top: 1px solid #e5e5e5;">
              <p style="margin: 0; font-size: 12px; color: #999; text-align: center;">
                This tracking link was sent from ${shopName} via 
                <a href="https://xpose.management" style="color: #1e40af;">Xpose Management</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();
}
