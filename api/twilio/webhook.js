/**
 * Twilio Incoming SMS Webhook
 * Handles incoming messages from Twilio and saves them to Supabase
 */


const { createClient } = require('@supabase/supabase-js');
// Import notification helper (ESM import workaround for CJS)
const { createShopNotification } = require('../../lib/shop-notifications.js');

module.exports = async function handler(req, res) {
  // Log everything for debugging
  console.log('🔔 Webhook called!', {
    method: req.method,
    body: req.body,
    headers: req.headers
  });

  // Only accept POST requests
  if (req.method !== 'POST') {
    console.log('❌ Wrong method:', req.method);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Initialize Supabase client
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    console.log('🔑 Supabase config:', {
      hasUrl: !!supabaseUrl,
      hasKey: !!supabaseKey,
      url: supabaseUrl
    });

      try {
        // Normalize phone for lookups (keep + and digits)
        const normalizedFrom = From ? (From + '').replace(/[^+\d]/g, '') : From;

        // Resolve customer name from `customers` table (best effort)
        let customerName = null;
        try {
          // Try exact match first
          const { data: custExact } = await supabase
            .from('customers')
            .select('first_name,last_name,phone')
            .eq('phone', normalizedFrom)
            .limit(1)
            .maybeSingle();

          if (custExact) {
            customerName = `${custExact.first_name || ''} ${custExact.last_name || ''}`.trim() || custExact.phone;
          } else {
            // Try a loose match by phone substring (handles formatting differences)
            const { data: custLike } = await supabase
              .from('customers')
              .select('first_name,last_name,phone')
              .ilike('phone', `%${normalizedFrom ? normalizedFrom.replace(/^\+/, '') : ''}%`)
              .limit(1)
              .maybeSingle();
            if (custLike) {
              customerName = `${custLike.first_name || ''} ${custLike.last_name || ''}`.trim() || custLike.phone;
            }
          }
        } catch (e) {
          console.warn('[Webhook] Customer lookup failed:', e && e.message);
        }

        // Fallback to thread-stored customer name if available
        if (!customerName) {
          try {
            const { data: threadDetails } = await supabase
              .from('threads')
              .select('customer_first,customer_last')
              .eq('id', thread.id)
              .maybeSingle();
            if (threadDetails) {
              const first = threadDetails.customer_first || '';
              const last = threadDetails.customer_last || '';
              customerName = `${first} ${last}`.trim() || null;
            }
          } catch (e) {
            // ignore
          }
        }

        // Format preview (10 chars, add ellipsis if longer)
        let preview = '';
        if (Body && Body.length > 10) {
          preview = Body.substring(0, 10) + '...';
        } else if (Body) {
          preview = Body;
        } else if (media.length > 0) {
          preview = '[Media message]';
        } else {
          preview = '[No content]';
        }

        const who = customerName ? `${customerName}` : (From || 'Unknown');
        const notifTitle = `New SMS: ${preview}`;
        const notifMsg = `${who}${From ? ' (' + From + ')' : ''} sent: "${preview}"`;

        // Fire notification (best-effort)
        createShopNotification({
          supabase,
          shopId,
          type: 'sms',
          category: 'messages',
          title: notifTitle,
          message: notifMsg,
          relatedId: message.id,
          relatedType: 'message',
          metadata: {
            threadId: thread.id,
            from: From,
            normalized_from: normalizedFrom,
            to: To,
            preview,
            customer_name: customerName || null
          },
          priority: 'normal',
          createdBy: null
        });
        console.log('🔔 Notification triggered for new SMS (with customer lookup)');
      } catch (notifErr) {
        console.error('❌ Error creating notification:', notifErr);
      }
      }
    }

    // Save message to database
    const { data: message, error: messageError } = await supabase
      .from('messages')
      .insert({
        thread_id: thread.id,
        twilio_message_id: MessageSid,
        from_number: From,
        to_number: To,
        body: Body || '',
        direction: 'inbound',
        status: 'received',
        media: media.length > 0 ? media : null
      })
      .select()
      .single();

    console.log('💾 Message save result:', { message, messageError });


    if (messageError) {
      console.error('❌ Error saving message:', messageError);
    } else {
      console.log('✅ Message saved successfully:', message.id);

      // --- Improved Notification Logic ---
      try {
        // Format preview (10 chars, add ellipsis if longer)
        let preview = '';
        if (Body && Body.length > 10) {
          preview = Body.substring(0, 10) + '...';
        } else if (Body) {
          preview = Body;
        } else if (media.length > 0) {
          preview = '[Media message]';
        } else {
          preview = '[No content]';
        }

        // Format sender info (phone, could be improved with contact lookup)
        const sender = From ? `From: ${From}` : 'Unknown sender';

        // Notification title and message
        const notifTitle = `New SMS: ${preview}`;
        // Include sender and the 10-char preview in the notification message
        const notifMsg = `${sender} — ${preview}`;

        // Fire notification (await not required, but can be added if needed)
        createShopNotification({
          supabase,
          shopId,
          type: 'sms',
          category: 'messages',
          title: notifTitle,
          message: notifMsg,
          relatedId: message.id,
          relatedType: 'message',
          metadata: {
            threadId: thread.id,
            from: From,
            to: To,
            preview
          },
          priority: 'normal',
          createdBy: null
        });
        console.log('🔔 Notification triggered for new SMS');
      } catch (notifErr) {
        console.error('❌ Error creating notification:', notifErr);
      }
      // --- End Notification Logic ---
    }

    // Respond to Twilio with empty TwiML
    res.setHeader('Content-Type', 'text/xml');
    return res.status(200).send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');

  } catch (error) {
    console.error('❌ Webhook error:', error);
    // Always return 200 to Twilio to prevent retries
    res.setHeader('Content-Type', 'text/xml');
    return res.status(200).send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
  }
};
