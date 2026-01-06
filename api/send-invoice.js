/**
 * API: Send Invoice via Email and/or SMS
 * 
 * Endpoint: POST /api/send-invoice
 * 
 * This endpoint:
 * 1. Validates the invoice exists and belongs to the shop
 * 2. Gets customer contact info (email/phone)
 * 3. Generates a secure token for public invoice viewing
 * 4. Sends email via Resend API
 * 5. Sends SMS via Twilio
 * 
 * Required env vars:
 * - SUPABASE_URL
 * - SUPABASE_SERVICE_ROLE_KEY
 * - RESEND_API_KEY
 * - TWILIO_ACCOUNT_SID
 * - TWILIO_AUTH_TOKEN
 * - APP_BASE_URL (e.g., https://xposemanagement.com)
 */

const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

module.exports = async function handler(req, res) {
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
      invoiceId, 
      shopId, 
      sendEmail, 
      sendSms, 
      customerEmail, 
      customerPhone,
      customerName 
    } = req.body;

    // Validate required fields
    if (!invoiceId || !shopId) {
      return res.status(400).json({ error: 'invoiceId and shopId are required' });
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

    // First, try to get invoice from invoices table (has most up-to-date status)
    const { data: invoiceRow, error: invoiceError } = await supabase
      .from('invoices')
      .select('*')
      .eq('id', invoiceId)
      .eq('shop_id', shopId)
      .single();

    let invoice = null;
    
    if (invoiceRow) {
      // Use invoice from invoices table (has current status)
      invoice = invoiceRow;
      console.log('[SendInvoice] Using invoice from invoices table with status:', invoice.status);
    } else {
      // Fallback to data table JSONB
      const { data: shopData, error: dataError } = await supabase
        .from('data')
        .select('invoices, settings')
        .eq('shop_id', shopId)
        .single();

      if (dataError || !shopData) {
        console.error('Failed to fetch shop data:', dataError);
        return res.status(404).json({ error: 'Shop data not found' });
      }

      invoice = (shopData.invoices || []).find(inv => inv.id === invoiceId);
      console.log('[SendInvoice] Using invoice from data JSONB with status:', invoice?.status);
    }
    if (!invoice) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    // Get shop info for the email
    const { data: shop, error: shopError } = await supabase
      .from('shops')
      .select('name, phone, email, logo')
      .eq('id', shopId)
      .single();

    if (shopError) {
      console.warn('Could not fetch shop info:', shopError);
    }

    const shopName = shop?.name || 'Business';

    // Generate secure token
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30); // 30 days expiry

    // Store token in database
    const sentVia = [];
    if (sendEmail) sentVia.push('email');
    if (sendSms) sentVia.push('sms');

    const { error: tokenError } = await supabase
      .from('invoice_tokens')
      .insert({
        token,
        invoice_id: invoiceId,
        shop_id: shopId,
        expires_at: expiresAt.toISOString(),
        sent_via: sentVia,
        recipient_email: customerEmail || null,
        recipient_phone: customerPhone || null
      });

    if (tokenError) {
      console.error('Failed to create token:', tokenError);
      return res.status(500).json({ error: 'Failed to create invoice link' });
    }

    // Build invoice URL
    const baseUrl = process.env.APP_BASE_URL || 'https://xposemanagement.com';
    const invoiceUrl = `${baseUrl}/public-invoice.html?token=${token}`;

    // Calculate invoice total for the message
    const items = invoice.items || [];
    const subtotal = items.reduce((sum, itm) => sum + ((itm.qty || 1) * (itm.price || 0)), 0);
    const taxAmount = subtotal * ((invoice.tax_rate || 0) / 100);
    const discountAmount = subtotal * ((invoice.discount || 0) / 100);
    const grandTotal = subtotal + taxAmount - discountAmount;

    const results = { email: null, sms: null };
    
    // Check if invoice is already paid
    const isPaid = invoice.status && invoice.status.toLowerCase() === 'paid';

    // Send Email via Resend
    if (sendEmail && customerEmail) {
      const resendKey = process.env.RESEND_API_KEY;
      
      if (resendKey) {
        try {
          const emailHtml = buildEmailHtml({
            shopName,
            customerName: customerName || 'Customer',
            invoiceNumber: invoice.number || invoice.id,
            grandTotal: grandTotal.toFixed(2),
            invoiceUrl,
            shopLogo: shop?.logo,
            isPaid: isPaid
          });
          
          const emailSubject = isPaid 
            ? `Paid Invoice #${invoice.number || invoice.id} - Thank You!`
            : `Invoice #${invoice.number || invoice.id} from ${shopName}`;

          const emailResponse = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${resendKey}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              from: `${shopName} <invoices@xposemanagement.com>`,
              to: [customerEmail],
              subject: emailSubject,
              html: emailHtml
            })
          });

          const emailResult = await emailResponse.json();
          
          if (emailResponse.ok) {
            results.email = { success: true, id: emailResult.id };
            console.log('✅ Invoice email sent:', emailResult.id);
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

    // Send SMS via Twilio
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
            const smsBody = isPaid
              ? `${shopName}: Your Invoice #${invoice.number || invoice.id} has been paid, thank you! You can view your paid invoice below: ${invoiceUrl}`
              : `${shopName}: Your invoice #${invoice.number || invoice.id} for $${grandTotal.toFixed(2)} is ready. View it here: ${invoiceUrl}`;

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
              console.log('✅ Invoice SMS sent:', smsResult.sid);
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
      invoiceUrl,
      token,
      results
    });

  } catch (error) {
    console.error('❌ Send invoice error:', error);
    return res.status(500).json({ error: 'Internal server error', details: error.message });
  }
};

/**
 * Build HTML email content
 */
function buildEmailHtml({ shopName, customerName, invoiceNumber, grandTotal, invoiceUrl, shopLogo, isPaid = false }) {
  const logoHtml = shopLogo 
    ? `<img src="${shopLogo}" alt="${shopName}" style="max-height: 60px; margin-bottom: 20px;">`
    : '';

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Invoice from ${shopName}</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f5f5f5;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f5f5f5; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
          <!-- Header -->
          <tr>
            <td style="padding: 30px; text-align: center; background-color: #1e40af;">
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
                ${isPaid ? 'Your invoice has been paid - thank you for your business!' : 'Thank you for your business! Your invoice is ready for viewing.'}
              </p>
              
              <!-- Invoice Summary Box -->
              <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f8fafc; border-radius: 8px; margin-bottom: 30px;">
                <tr>
                  <td style="padding: 25px;">
                    <table width="100%">
                      <tr>
                        <td style="font-size: 14px; color: #666;">Invoice Number</td>
                        <td align="right" style="font-size: 16px; font-weight: 600; color: #333;">#${invoiceNumber}</td>
                      </tr>
                      <tr>
                        <td colspan="2" style="padding: 10px 0;">
                          <hr style="border: none; border-top: 1px solid #e5e5e5; margin: 0;">
                        </td>
                      </tr>
                      <tr>
                        <td style="font-size: 14px; color: #666;">${isPaid ? 'Amount Paid' : 'Amount Due'}</td>
                        <td align="right" style="font-size: 24px; font-weight: 700; color: ${isPaid ? '#10b981' : '#1e40af'};">$${grandTotal}</td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
              
              <!-- CTA Button -->
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center">
                    <a href="${invoiceUrl}" style="display: inline-block; padding: 16px 40px; background-color: #1e40af; color: #ffffff; text-decoration: none; border-radius: 8px; font-size: 16px; font-weight: 600;">
                      View Invoice
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
                This invoice was sent from ${shopName} via 
                <a href="https://xposemanagement.com" style="color: #1e40af;">Xpose Management</a>
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
