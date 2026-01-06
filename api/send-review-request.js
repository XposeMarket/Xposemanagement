// Vercel Serverless Function: Send Google Review Request
// Sends SMS and/or email asking customer to leave a Google review

module.exports = async (req, res) => {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { invoiceId, shopId, customerEmail, customerPhone, customerName, googleReviewUrl, sendEmail, sendSms } = req.body;

    console.log('[ReviewRequest] Incoming request:', { invoiceId, shopId, customerEmail, customerPhone, googleReviewUrl, sendEmail, sendSms });

    if (!googleReviewUrl) {
      return res.status(400).json({ error: 'Google Business URL is required' });
    }

    if (!customerEmail && !customerPhone) {
      return res.status(400).json({ error: 'Customer email or phone is required' });
    }

    // Initialize Supabase client
    const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ADMIN_KEY;

    if (!supabaseUrl || !supabaseKey) {
      console.error('[ReviewRequest] Supabase credentials not configured');
      return res.status(500).json({ error: 'Server configuration error' });
    }

    const { createClient } = require('@supabase/supabase-js');
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get shop info for personalized message
    const { data: shopData } = await supabase
      .from('shops')
      .select('name, google_business_name')
      .eq('id', shopId)
      .single();

    const shopName = shopData?.google_business_name || shopData?.name || 'our business';
    
    // Create message
    const message = `Hi ${customerName || 'there'}! Thank you for choosing ${shopName}! We'd love to hear about your experience. Please leave us a review: ${googleReviewUrl}`;

    const results = {
      email: { sent: false, success: false },
      sms: { sent: false, success: false }
    };

    // Send via email if requested
    if (sendEmail && customerEmail) {
      try {
        const RESEND_API_KEY = process.env.RESEND_API_KEY || 're_123';
        
        const emailHtml = `
          <!DOCTYPE html>
          <html>
          <head>
            <meta charset="utf-8">
            <style>
              body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
              .container { max-width: 600px; margin: 0 auto; padding: 20px; }
              .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
              .content { background: #f9fafb; padding: 30px; border-radius: 0 0 8px 8px; }
              .review-button { display: inline-block; background: #10b981; color: white; padding: 15px 30px; text-decoration: none; border-radius: 6px; font-weight: bold; margin: 20px 0; }
              .stars { font-size: 2rem; color: #fbbf24; }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="header">
                <h1 style="margin:0;font-size:1.75rem;">⭐ Share Your Experience</h1>
              </div>
              <div class="content">
                <p>Hi ${customerName || 'there'}!</p>
                <p>Thank you for choosing <strong>${shopName}</strong>! We hope you had a great experience with us.</p>
                <p>We'd love to hear your feedback. Your review helps us improve and helps others find us!</p>
                <div style="text-align:center;margin:30px 0;">
                  <div class="stars">⭐ ⭐ ⭐ ⭐ ⭐</div>
                  <a href="${googleReviewUrl}" class="review-button">Leave a Google Review</a>
                </div>
                <p style="color:#6b7280;font-size:0.875rem;">Thank you for your time!</p>
                <p style="color:#6b7280;font-size:0.875rem;">— The team at ${shopName}</p>
              </div>
            </div>
          </body>
          </html>
        `;

        const emailResponse = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${RESEND_API_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            from: 'Xpose <noreply@xposemanagement.com>',
            to: customerEmail,
            subject: `⭐ We'd love your feedback, ${customerName || ''}!`,
            html: emailHtml
          })
        });

        results.email.sent = true;
        if (emailResponse.ok) {
          results.email.success = true;
          console.log('[ReviewRequest] Email sent successfully to:', customerEmail);
        } else {
          const errorData = await emailResponse.json().catch(() => ({}));
          results.email.error = errorData.message || 'Email send failed';
          console.error('[ReviewRequest] Email send failed:', errorData);
        }
      } catch (e) {
        results.email.error = e.message;
        console.error('[ReviewRequest] Email error:', e);
      }
    }

    // Send via SMS if requested
    if (sendSms && customerPhone) {
      try {
        // Get Twilio credentials for this shop
        const { data: twilioData } = await supabase
          .from('shop_twilio_numbers')
          .select('*')
          .eq('shop_id', shopId)
          .eq('active', true)
          .limit(1);

        if (!twilioData || twilioData.length === 0) {
          results.sms.error = 'No active Twilio number configured for this shop';
          console.error('[ReviewRequest] No Twilio number found for shop:', shopId);
        } else {
          const twilioConfig = twilioData[0];
          const accountSid = twilioConfig.account_sid || process.env.TWILIO_ACCOUNT_SID;
          const authToken = twilioConfig.auth_token || process.env.TWILIO_AUTH_TOKEN;
          const fromNumber = twilioConfig.phone_number;

          if (!accountSid || !authToken || !fromNumber) {
            results.sms.error = 'Twilio credentials incomplete';
            console.error('[ReviewRequest] Twilio credentials incomplete');
          } else {
            const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
            const twilioAuth = Buffer.from(`${accountSid}:${authToken}`).toString('base64');

            const smsResponse = await fetch(twilioUrl, {
              method: 'POST',
              headers: {
                'Authorization': `Basic ${twilioAuth}`,
                'Content-Type': 'application/x-www-form-urlencoded'
              },
              body: new URLSearchParams({
                To: customerPhone,
                From: fromNumber,
                Body: message
              })
            });

            results.sms.sent = true;
            if (smsResponse.ok) {
              results.sms.success = true;
              console.log('[ReviewRequest] SMS sent successfully to:', customerPhone);
            } else {
              const errorData = await smsResponse.json().catch(() => ({}));
              results.sms.error = errorData.message || 'SMS send failed';
              console.error('[ReviewRequest] SMS send failed:', errorData);
            }
          }
        }
      } catch (e) {
        results.sms.error = e.message;
        console.error('[ReviewRequest] SMS error:', e);
      }
    }

    // Return success if at least one method succeeded
    const success = results.email.success || results.sms.success;

    return res.status(success ? 200 : 500).json({
      success,
      results
    });

  } catch (error) {
    console.error('[ReviewRequest] Unexpected error:', error);
    return res.status(500).json({ error: 'Internal server error: ' + error.message });
  }
};
